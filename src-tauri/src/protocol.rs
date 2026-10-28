use tokio::io::AsyncReadExt;

#[derive(Debug)]
pub struct Request { pub path: String, pub body: Vec<u8> }

/// TCP reads are not message boundaries. Read the complete HTTP header and the
/// declared body before interpreting a command, including large behavior trees.
pub async fn read_request<R: tokio::io::AsyncRead + Unpin>(stream: &mut R) -> Result<Request, String> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") { break end + 4; }
        let count = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if count == 0 { return Err("Incomplete HTTP header.".into()); }
        bytes.extend_from_slice(&chunk[..count]);
    };
    let header = std::str::from_utf8(&bytes[..header_end]).map_err(|_| "Invalid HTTP header.")?;
    let path = header.lines().next().and_then(|line| line.split_whitespace().nth(1)).ok_or("Missing request path.")?.to_string();
    let mut length = 0usize;
    for line in header.lines().skip(1) {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") { length = value.trim().parse().map_err(|_| "Invalid Content-Length.")?; }
            if name.eq_ignore_ascii_case("transfer-encoding") { return Err("Transfer-Encoding is not supported.".into()); }
        }
    }
    while bytes.len() - header_end < length {
        let count = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if count == 0 { return Err("Incomplete HTTP body.".into()); }
        bytes.extend_from_slice(&chunk[..count]);
    }
    Ok(Request { path, body: bytes[header_end..header_end + length].to_vec() })
}

#[derive(serde::Deserialize)]
pub struct RuntimeAction {
    #[serde(flatten)] pub scope: crate::runtime::ExecutionScope,
    pub kind: String,
    #[serde(default)] pub id: String,
    #[serde(default)] pub value: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[test]
    fn fragmented_requests_preserve_large_unicode_behavior_payloads() {
        tokio::runtime::Builder::new_current_thread().build().unwrap().block_on(async {
            let body = serde_json::json!({"profile":"keys","kind":"behavior","value":"ø😀;".repeat(2000)}).to_string();
            let expected = body.as_bytes().to_vec();
            let request = format!("POST /runtime HTTP/1.1\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            let (mut client, mut server) = tokio::io::duplex(31);
            let writer = tokio::spawn(async move {
                for chunk in request.as_bytes().chunks(7) { client.write_all(chunk).await.unwrap(); }
            });
            let received = read_request(&mut server).await.unwrap();
            assert_eq!(received.path, "/runtime"); assert_eq!(received.body, expected);
            writer.await.unwrap();
        });
    }

    #[test]
    fn truncated_bodies_fail_instead_of_executing_partial_commands() {
        tokio::runtime::Builder::new_current_thread().build().unwrap().block_on(async {
            let (mut client, mut server) = tokio::io::duplex(256);
            client.write_all(b"POST /runtime HTTP/1.1\r\nContent-Length: 10\r\n\r\n{}").await.unwrap();
            drop(client);
            assert!(read_request(&mut server).await.unwrap_err().contains("Incomplete HTTP body"));
        });
    }
}
