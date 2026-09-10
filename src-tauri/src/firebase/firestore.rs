use super::{auth, crypto, request_json, CloudConfig};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// Base64 plus metadata remains below Firestore's 1 MiB document limit.
const CHUNK_BYTES: usize = 512 * 1024;
pub const CONFLICT: &str = "Cloud settings changed. Review the cloud copy before continuing.";

#[derive(Clone, Serialize, Deserialize)]
pub struct Head {
    pub revision: String,
    pub digest: String,
    pub chunks: usize,
    pub bytes: usize,
    pub saved_at: u64,
    #[serde(default)]
    pub update_time: String,
}

pub struct Store<'a> {
    client: &'a Client,
    token: &'a str,
    root: String,
    owner: String,
    #[cfg(test)]
    test_origin: Option<String>,
}

fn fields<T: Serialize>(value: &T) -> Result<Value, String> {
    Ok(
        json!({"payload": {"stringValue": serde_json::to_string(value).map_err(|e| e.to_string())?}}),
    )
}
fn read_head(document: &Value) -> Result<Head, String> {
    let payload = document["fields"]["payload"]["stringValue"]
        .as_str()
        .ok_or("Cloud backup metadata is missing.")?;
    let mut head: Head =
        serde_json::from_str(payload).map_err(|_| "Invalid cloud backup metadata.")?;
    if head.revision.len() != 43
        || !head
            .revision
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || head.digest.len() != 64
        || !head.digest.bytes().all(|b| b.is_ascii_hexdigit())
        || head.bytes == 0
        || head.chunks != head.bytes.div_ceil(CHUNK_BYTES)
    {
        return Err("Invalid cloud backup metadata.".into());
    }
    head.update_time = document["updateTime"]
        .as_str()
        .ok_or("Cloud backup timestamp is missing.")?
        .to_owned();
    Ok(head)
}

impl<'a> Store<'a> {
    pub fn new(client: &'a Client, config: &CloudConfig, account: &'a auth::Account) -> Self {
        let root = format!(
            "projects/{}/databases/(default)/documents",
            config.project_id
        );
        let owner = format!("{root}/MacroToolboxDB/{}", account.uid);
        Self {
            client,
            token: &account.id_token,
            root,
            owner,
            #[cfg(test)]
            test_origin: None,
        }
    }
    fn url(&self, path: &str) -> String {
        #[cfg(test)]
        if let Some(origin) = &self.test_origin {
            return format!("{origin}/v1/{path}");
        }
        format!("https://firestore.googleapis.com/v1/{path}")
    }
    async fn get(&self, name: &str) -> Result<Option<Value>, String> {
        let response = self
            .client
            .get(self.url(name))
            .bearer_auth(self.token)
            .send()
            .await
            .map_err(|_| "Cannot reach Firebase. Your settings remain on this computer.")?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        super::response_json(response).await.map(Some)
    }
    async fn commit(&self, writes: Vec<Value>) -> Result<Value, String> {
        request_json(
            self.client
                .post(self.url(&format!("{}:commit", self.root)))
                .bearer_auth(self.token)
                .header("Content-Type", "application/json")
                .body(json!({"writes":writes}).to_string()),
        )
        .await
    }
    pub async fn head(&self) -> Result<Option<Head>, String> {
        self.get(&self.owner)
            .await?
            .as_ref()
            .map(read_head)
            .transpose()
    }
    pub async fn upload(&self, bytes: &[u8], before: Option<&Head>) -> Result<Head, String> {
        let mut head = Head {
            revision: crypto::random_id()?,
            digest: crypto::digest(bytes)?,
            chunks: bytes.len().div_ceil(CHUNK_BYTES),
            bytes: bytes.len(),
            saved_at: auth::now(),
            update_time: String::new(),
        };
        let manifest = format!("{}/snapshots/{}", self.owner, head.revision);
        let created = self.commit(vec![json!({"update":{"name":manifest,"fields":fields(&head)?},"currentDocument":{"exists":false}})]).await?;
        let manifest_time = created["writeResults"][0]["updateTime"]
            .as_str()
            .ok_or("Firebase did not confirm the upload.")?;
        for (index, chunk) in bytes.chunks(CHUNK_BYTES).enumerate() {
            self.commit(vec![json!({"update":{"name":format!("{manifest}/chunks/{index}"),"fields":{"data":{"stringValue":STANDARD.encode(chunk)}}},"currentDocument":{"exists":false}})]).await?;
        }
        // Only a complete immutable upload becomes current. The precondition prevents
        // another computer's save being overwritten; verifying the manifest excludes pruned uploads.
        let precondition = before
            .map(|h| json!({"updateTime":h.update_time}))
            .unwrap_or(json!({"exists":false}));
        let result = self.commit(vec![
            json!({"update":{"name":self.owner,"fields":fields(&head)?},"currentDocument":precondition}),
            json!({"verify":manifest,"currentDocument":{"updateTime":manifest_time}}),
        ]).await?;
        head.update_time = result["writeResults"][0]["updateTime"]
            .as_str()
            .ok_or("Firebase did not confirm the save.")?
            .to_owned();
        if let Some(previous) = before {
            if let Ok(Some(document)) = self
                .get(&format!("{}/snapshots/{}", self.owner, previous.revision))
                .await
            {
                if let Ok(old) = read_head(&document) {
                    let _ = self.retire(&old, &head).await;
                }
            }
        }
        Ok(head)
    }
    pub async fn download(&self, head: &Head) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        for index in 0..head.chunks {
            let document = self
                .get(&format!(
                    "{}/snapshots/{}/chunks/{index}",
                    self.owner, head.revision
                ))
                .await?
                .ok_or("Cloud backup is incomplete. Local settings were kept.")?;
            let data = document["fields"]["data"]["stringValue"]
                .as_str()
                .ok_or("Cloud backup chunk is invalid.")?;
            let chunk = STANDARD
                .decode(data)
                .map_err(|_| "Cloud backup chunk is damaged.")?;
            let expected = (head.bytes - index * CHUNK_BYTES).min(CHUNK_BYTES);
            if chunk.len() != expected {
                return Err("Cloud backup chunk has the wrong size.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if crypto::digest(&bytes)? != head.digest {
            return Err("Cloud backup checksum did not match. Local settings were kept.".into());
        }
        Ok(bytes)
    }
    async fn retire(&self, old: &Head, current: &Head) -> Result<(), String> {
        let manifest = format!("{}/snapshots/{}", self.owner, old.revision);
        // Keep metadata until deletion finishes so interruptions can retry. Changing
        // it invalidates the original uploader's promotion precondition.
        self.commit(vec![json!({"verify":self.owner,"currentDocument":{"updateTime":current.update_time}}),
            json!({"update":{"name":manifest,"fields":fields(old)?},"currentDocument":{"updateTime":old.update_time}})]).await?;
        for start in (0..old.chunks).step_by(100) {
            let writes = (start..(start + 100).min(old.chunks))
                .map(|i| json!({"delete":format!("{manifest}/chunks/{i}")}))
                .collect();
            self.commit(writes).await?;
        }
        self.commit(vec![json!({"delete":manifest})]).await?;
        Ok(())
    }
    pub async fn prune(&self) -> Result<(), String> {
        // No paid TTL service: collect abandoned uploads after a day. Each deletion
        // verifies the current head and invalidates the manifest, excluding future promotion.
        let mut page = String::new();
        loop {
            let result = request_json(
                self.client
                    .get(self.url(&format!("{}/snapshots", self.owner)))
                    .bearer_auth(self.token)
                    .query(&[("pageSize", "100"), ("pageToken", page.as_str())]),
            )
            .await?;
            if let Some(documents) = result["documents"].as_array() {
                for document in documents {
                    let old = read_head(document)?;
                    if old.saved_at.saturating_add(86400) > auth::now() {
                        continue;
                    }
                    let Some(current) = self.head().await? else {
                        continue;
                    };
                    if old.revision == current.revision {
                        continue;
                    }
                    self.retire(&old, &current).await?;
                }
            }
            page = result["nextPageToken"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            if page.is_empty() {
                return Ok(());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    mod transport {
        use super::*;
        use std::{
            io::{Read, Write},
            net::TcpListener,
            sync::mpsc,
            thread,
            time::{Duration, Instant},
        };

        fn server(
            responses: Vec<(u16, Value)>,
        ) -> (
            String,
            mpsc::Receiver<(String, Value)>,
            thread::JoinHandle<()>,
        ) {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let origin = format!("http://{}", listener.local_addr().unwrap());
            listener.set_nonblocking(true).unwrap();
            let (send, receive) = mpsc::channel();
            let thread = thread::spawn(move || {
                for (status, body) in responses {
                    let start = Instant::now();
                    let mut stream = loop {
                        match listener.accept() {
                            Ok((stream, _)) => break stream,
                            Err(e)
                                if e.kind() == std::io::ErrorKind::WouldBlock
                                    && start.elapsed() < Duration::from_secs(10) =>
                            {
                                thread::sleep(Duration::from_millis(5))
                            }
                            Err(e) => panic!("Expected cloud request: {e}"),
                        }
                    };
                    stream
                        .set_read_timeout(Some(Duration::from_secs(5)))
                        .unwrap();
                    let mut bytes = Vec::new();
                    let mut buffer = [0u8; 8192];
                    let header_end = loop {
                        let n = stream.read(&mut buffer).unwrap();
                        assert_ne!(n, 0);
                        bytes.extend_from_slice(&buffer[..n]);
                        if let Some(end) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                            break end + 4;
                        }
                    };
                    let headers = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
                    let count = headers
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    while bytes.len() < header_end + count {
                        let n = stream.read(&mut buffer).unwrap();
                        assert_ne!(n, 0);
                        bytes.extend_from_slice(&buffer[..n]);
                    }
                    let payload = if count == 0 {
                        Value::Null
                    } else {
                        serde_json::from_slice(&bytes[header_end..header_end + count]).unwrap()
                    };
                    send.send((headers, payload)).unwrap();
                    let body = body.to_string();
                    write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
                }
            });
            (origin, receive, thread)
        }
        fn fixture() -> (Client, CloudConfig, auth::Account) {
            (
                Client::builder().no_proxy().build().unwrap(),
                CloudConfig {
                    project_id: "test-project".into(),
                    api_key: "key".into(),
                    desktop: super::super::super::DesktopConfig {
                        project_id: "test-project".into(),
                        client_id: "123.apps.googleusercontent.com".into(),
                        client_secret: String::new(),
                    },
                },
                auth::Account {
                    uid: "verified-user".into(),
                    email: "user@example.com".into(),
                    id_token: "test-token".into(),
                    refresh_token: String::new(),
                    expires_at: 0,
                },
            )
        }
        fn written(time: &str) -> (u16, Value) {
            (200, json!({"writeResults":[{"updateTime":time}]}))
        }
        #[test]
        fn uploads_all_chunks_before_publishing_and_restores_the_exact_bytes() {
            let bytes = vec![73; CHUNK_BYTES + 17];
            let mut responses = vec![
                written("manifest-time"),
                written("chunk-0"),
                written("chunk-1"),
                written("head-time"),
            ];
            responses.extend(bytes.chunks(CHUNK_BYTES).map(|chunk| {
                (
                    200,
                    json!({"fields":{"data":{"stringValue":STANDARD.encode(chunk)}}}),
                )
            }));
            let (origin, requests, server) = server(responses);
            let (client, config, account) = fixture();
            let mut store = Store::new(&client, &config, &account);
            store.test_origin = Some(origin);
            let head = tauri::async_runtime::block_on(store.upload(&bytes, None)).unwrap();
            assert_eq!(
                tauri::async_runtime::block_on(store.download(&head)).unwrap(),
                bytes
            );
            server.join().unwrap();
            let requests: Vec<_> = requests.into_iter().collect();
            assert_eq!(requests.len(), 6);
            for (headers, _) in &requests {
                assert!(headers
                    .to_lowercase()
                    .contains("authorization: bearer test-token"));
            }
            let writes = &requests[3].1["writes"];
            assert_eq!(writes[0]["currentDocument"], json!({"exists":false}));
            assert_eq!(
                writes[1]["currentDocument"],
                json!({"updateTime":"manifest-time"})
            );
            assert!(writes[0]["update"]["name"]
                .as_str()
                .unwrap()
                .ends_with("/MacroToolboxDB/verified-user"));
            assert!(writes[1]["verify"]
                .as_str()
                .unwrap()
                .ends_with(&head.revision));
            assert_eq!(head.chunks, 2);
        }
        #[test]
        fn failed_chunk_never_attempts_to_publish_a_partial_backup() {
            let (origin, requests, server) = server(vec![
                written("manifest-time"),
                (503, json!({"error":{"status":"UNAVAILABLE"}})),
            ]);
            let (client, config, account) = fixture();
            let mut store = Store::new(&client, &config, &account);
            store.test_origin = Some(origin);
            assert!(tauri::async_runtime::block_on(store.upload(b"setup", None)).is_err());
            server.join().unwrap();
            let requests: Vec<_> = requests.into_iter().collect();
            assert_eq!(requests.len(), 2);
            assert!(requests
                .iter()
                .all(|(_, body)| body["writes"][0]["update"]["name"]
                    .as_str()
                    .unwrap()
                    .contains("/snapshots/")));
        }
        #[test]
        fn stale_save_sends_precondition_and_surfaces_conflict() {
            let (origin, requests, server) = server(vec![
                written("manifest-time"),
                written("chunk-time"),
                (400, json!({"error":{"status":"FAILED_PRECONDITION"}})),
            ]);
            let (client, config, account) = fixture();
            let mut store = Store::new(&client, &config, &account);
            store.test_origin = Some(origin);
            let old = Head {
                revision: "a".repeat(43),
                digest: "a".repeat(64),
                chunks: 1,
                bytes: 1,
                saved_at: 1,
                update_time: "old-head-time".into(),
            };
            assert_eq!(
                tauri::async_runtime::block_on(store.upload(b"setup", Some(&old)))
                    .err()
                    .unwrap(),
                CONFLICT
            );
            server.join().unwrap();
            let requests: Vec<_> = requests.into_iter().collect();
            assert_eq!(
                requests[2].1["writes"][0]["currentDocument"],
                json!({"updateTime":"old-head-time"})
            );
        }
        #[test]
        fn rejects_downloaded_content_with_a_wrong_checksum() {
            let (origin, _requests, server) = server(vec![(
                200,
                json!({"fields":{"data":{"stringValue":STANDARD.encode(b"bad")}}}),
            )]);
            let (client, config, account) = fixture();
            let mut store = Store::new(&client, &config, &account);
            store.test_origin = Some(origin);
            let head = Head {
                revision: "a".repeat(43),
                digest: crypto::digest(b"yes").unwrap(),
                chunks: 1,
                bytes: 3,
                saved_at: 1,
                update_time: "time".into(),
            };
            assert!(tauri::async_runtime::block_on(store.download(&head))
                .unwrap_err()
                .contains("checksum"));
            server.join().unwrap();
        }
    }
    #[test]
    fn rejects_invalid_chunk_counts_and_paths() {
        let mut head = Head {
            revision: "a".repeat(43),
            digest: "a".repeat(64),
            chunks: 2,
            bytes: CHUNK_BYTES + 1,
            saved_at: 1,
            update_time: String::new(),
        };
        let document = |h: &Head| json!({"fields":fields(h).unwrap(),"updateTime":"time"});
        assert!(read_head(&document(&head)).is_ok());
        head.chunks = 1;
        assert!(read_head(&document(&head)).is_err());
        head.chunks = 2;
        head.revision = "../bad".into();
        assert!(read_head(&document(&head)).is_err());
    }
}
