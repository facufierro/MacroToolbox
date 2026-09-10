use super::{crypto, request_json, CloudConfig};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri_plugin_opener::OpenerExt;

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Account {
    pub uid: String,
    pub email: String,
    pub id_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

impl Account {
    pub async fn refresh(&mut self, client: &Client, config: &CloudConfig) -> Result<(), String> {
        if self.expires_at > now() + 120 {
            return Ok(());
        }
        let result = request_json(
            client
                .post("https://securetoken.googleapis.com/v1/token")
                .query(&[("key", &config.api_key)])
                .form(&[
                    ("grant_type", "refresh_token"),
                    ("refresh_token", self.refresh_token.as_str()),
                ]),
        )
        .await?;
        if result["user_id"].as_str() != Some(&self.uid) {
            return Err("The refreshed account did not match. Sign in again.".into());
        }
        self.id_token = field(&result, "id_token")?;
        self.refresh_token = field(&result, "refresh_token")?;
        self.expires_at = now()
            + field(&result, "expires_in")?
                .parse::<u64>()
                .map_err(|_| "Invalid session expiry.")?;
        Ok(())
    }
}

fn field(value: &serde_json::Value, name: &str) -> Result<String, String> {
    value[name]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| format!("Sign-in response is missing {name}."))
}

fn callback(target: &str, state: &str) -> Result<Option<String>, String> {
    if !target.starts_with("/?") {
        return Err("Unrecognized sign-in callback.".into());
    }
    let url = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "Invalid sign-in callback.")?;
    let values: Vec<_> = url.query_pairs().collect();
    let states: Vec<_> = values.iter().filter(|(k, _)| k == "state").collect();
    if states.len() != 1 || states[0].1 != state {
        return Err("Sign-in state did not match.".into());
    }
    if values.iter().any(|(k, _)| k == "error") {
        return Ok(None);
    }
    let codes: Vec<_> = values.iter().filter(|(k, _)| k == "code").collect();
    if codes.len() != 1 || codes[0].1.is_empty() {
        return Err("Sign-in code is missing or ambiguous.".into());
    }
    Ok(Some(codes[0].1.to_string()))
}

pub async fn login(
    app: &tauri::AppHandle,
    client: &Client,
    config: &CloudConfig,
    cancel: &AtomicBool,
) -> Result<Account, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|_| "Could not open the local sign-in callback.")?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let redirect = format!(
        "http://127.0.0.1:{}/",
        listener.local_addr().map_err(|e| e.to_string())?.port()
    );
    let state = crypto::random_id()?;
    let verifier = crypto::random_id()?;
    let challenge = URL_SAFE_NO_PAD.encode(crypto::hash(verifier.as_bytes())?);
    let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("client_id", config.desktop.client_id.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("response_type", "code"),
        ("scope", "openid email profile"),
        ("state", state.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("prompt", "select_account"),
    ]);
    app.opener()
        .open_url(url.to_string(), None::<&str>)
        .map_err(|_| "Could not open your browser.")?;
    let started = Instant::now();
    let code = loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Sign-in cancelled.".into());
        }
        if started.elapsed() > Duration::from_secs(300) {
            return Err("Sign-in timed out. Try again.".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
                stream.set_write_timeout(Some(Duration::from_secs(2))).ok();
                let mut buffer = Vec::new();
                let mut chunk = [0u8; 1024];
                while buffer.len() < 16384 && !buffer.windows(4).any(|b| b == b"\r\n\r\n") {
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => buffer.extend_from_slice(&chunk[..n]),
                    }
                }
                let request = String::from_utf8_lossy(&buffer);
                let mut parts = request
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .split_whitespace();
                let method = parts.next();
                let result = if method == Some("GET") {
                    callback(parts.next().unwrap_or_default(), &state)
                } else {
                    Err("Invalid request.".into())
                };
                let message = match &result {
                    Ok(Some(_)) => "Return to MacroToolbox to finish signing in.",
                    Ok(None) => "Sign-in cancelled. You can return to MacroToolbox.",
                    Err(_) => "Invalid sign-in callback. Return to MacroToolbox and try again.",
                };
                let status = if result.is_ok() {
                    "200 OK"
                } else {
                    "400 Bad Request"
                };
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{message}", message.len());
                // Unrelated local requests cannot complete/cancel this login attempt.
                if let Ok(code) = result {
                    break code.ok_or("Google sign-in was declined.")?;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(_) => return Err("Local sign-in callback failed.".into()),
        }
    };
    let mut form = vec![
        ("client_id", config.desktop.client_id.as_str()),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("grant_type", "authorization_code"),
    ];
    if !config.desktop.client_secret.is_empty() {
        form.push(("client_secret", config.desktop.client_secret.as_str()));
    }
    let google = request_json(
        client
            .post("https://oauth2.googleapis.com/token")
            .form(&form),
    )
    .await?;
    let google_id = field(&google, "id_token")?;
    let mut encoded = Url::parse("http://localhost/").unwrap();
    encoded
        .query_pairs_mut()
        .append_pair("id_token", &google_id)
        .append_pair("providerId", "google.com");
    // Firebase verifies the Google credential and returns the authoritative Firebase UID.
    let result = request_json(client.post("https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp")
        .query(&[("key", &config.api_key)]).header("Content-Type", "application/json")
        .body(json!({"postBody": encoded.query().unwrap(), "requestUri": redirect, "returnSecureToken": true}).to_string())).await?;
    let uid = field(&result, "localId")?;
    if uid.contains('/') || uid == "." || uid == ".." {
        return Err("Invalid Firebase account ID.".into());
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("Sign-in cancelled.".into());
    }
    Ok(Account {
        uid,
        email: field(&result, "email")?,
        id_token: field(&result, "idToken")?,
        refresh_token: field(&result, "refreshToken")?,
        expires_at: now()
            + field(&result, "expiresIn")?
                .parse::<u64>()
                .map_err(|_| "Invalid session expiry.")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_callback_injection_and_wrong_state() {
        assert_eq!(
            callback("/?code=ok&state=expected", "expected").unwrap(),
            Some("ok".into())
        );
        for input in [
            "/?code=a&state=wrong",
            "/?code=a&code=b&state=expected",
            "/?code=a&state=expected&state=wrong",
            "//evil/?code=a&state=expected",
        ] {
            assert!(callback(input, "expected").is_err());
        }
        assert_eq!(
            callback("/?state=expected&error=access_denied", "expected").unwrap(),
            None
        );
    }
}
