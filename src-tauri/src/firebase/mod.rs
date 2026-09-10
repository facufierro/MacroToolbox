mod auth;
mod crypto;
mod firestore;
mod snapshot;

use crate::{config, AppState};
use reqwest::{Client, RequestBuilder, Response};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize, Deserialize)]
pub struct DesktopConfig {
    pub project_id: String,
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CloudConfig {
    pub project_id: String,
    pub api_key: String,
    pub desktop: DesktopConfig,
}

impl CloudConfig {
    fn validate(&self) -> Result<(), String> {
        if self.project_id != self.desktop.project_id
            || self.project_id.is_empty()
            || !self
                .project_id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(
                "Import a Google Desktop OAuth JSON file from your Firebase project.".into(),
            );
        }
        if !self
            .desktop
            .client_id
            .ends_with(".apps.googleusercontent.com")
            || self.desktop.client_id.contains(char::is_whitespace)
        {
            return Err("The Google desktop client ID is invalid.".into());
        }
        if self.api_key.is_empty()
            || !self
                .api_key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err("Enter your Firebase Web API key.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct Baseline {
    revision: Option<String>,
    digest: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Session {
    account: auth::Account,
    baseline: Baseline,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct SavedState {
    config: Option<CloudConfig>,
    session: Option<Session>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    configured: bool,
    project_id: Option<String>,
    account: Option<String>,
    phase: String,
    message: String,
    saved_at: Option<u64>,
    revision: Option<String>,
}

struct LocalState {
    saved: SavedState,
    status: CloudStatus,
}

pub struct Firebase {
    directory: PathBuf,
    client: Client,
    operation: Mutex<()>,
    local: Mutex<LocalState>,
    cancelled: AtomicBool,
}

async fn request_json(request: RequestBuilder) -> Result<Value, String> {
    response_json(
        request
            .send()
            .await
            .map_err(|_| "Cannot reach Firebase/Google. Your settings remain on this computer.")?,
    )
    .await
}

async fn response_json(response: Response) -> Result<Value, String> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|_| "Cloud response was interrupted. Try again.")?;
    let value: Value =
        serde_json::from_str(&body).map_err(|_| "Cloud service returned an invalid response.")?;
    if status.is_success() {
        return Ok(value);
    }
    let code = value["error"]["status"].as_str().unwrap_or_default();
    if matches!(code, "FAILED_PRECONDITION" | "ALREADY_EXISTS" | "ABORTED") {
        return Err(firestore::CONFLICT.into());
    }
    let detail = value["error"]["message"].as_str().unwrap_or_default();
    if status.as_u16() == 401
        || detail.contains("INVALID_REFRESH_TOKEN")
        || detail.contains("TOKEN_EXPIRED")
        || detail.contains("USER_DISABLED")
    {
        return Err("Your login session expired or was revoked. Sign in again.".into());
    }
    if status.as_u16() == 403 {
        return Err(
            "Firebase denied access. Check the supplied Firestore rules and API key restrictions."
                .into(),
        );
    }
    if status.as_u16() == 429 {
        return Err("Firebase's free quota is temporarily exhausted. Local changes are safe and will retry.".into());
    }
    if detail.contains("OPERATION_NOT_ALLOWED") {
        return Err("Enable Google sign-in in Firebase Authentication.".into());
    }
    if detail.contains("INVALID_IDP_RESPONSE") || detail.contains("INVALID_CREDENTIAL") {
        return Err("Firebase could not accept this Google client. Add its client ID to the Google provider's allowed client IDs.".into());
    }
    Err(format!("Google/Firebase request failed (HTTP {}). Check the project and desktop login configuration.", status.as_u16()))
}

#[derive(Debug, PartialEq)]
enum Decision {
    Current,
    Upload,
    Choice,
    Restore,
}

fn decide(
    baseline: &Baseline,
    local: &str,
    remote: Option<&firestore::Head>,
    choice: Option<&str>,
) -> Result<Decision, String> {
    match choice {
        Some("local") => return Ok(Decision::Upload),
        Some("cloud") if remote.is_some() => return Ok(Decision::Restore),
        Some(_) => return Err("Choose an available local or cloud copy.".into()),
        None => (),
    }
    if let Some(head) = remote {
        // Also recovers an upload whose successful commit response was lost.
        if head.digest == local {
            return Ok(Decision::Current);
        }
        if baseline.revision.as_deref() != Some(&head.revision) {
            return Ok(Decision::Choice);
        }
        if baseline.digest.as_deref() == Some(local) {
            return Ok(Decision::Current);
        }
        Ok(Decision::Upload)
    } else if baseline.revision.is_some() {
        Ok(Decision::Choice)
    } else {
        Ok(Decision::Upload)
    }
}

impl Firebase {
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        let mut warning = None;
        let saved: SavedState = match std::fs::read(directory.join("firebase-session.bin")) {
            Ok(bytes) => match crypto::unprotect(&bytes).and_then(|plain| {
                serde_json::from_slice(&plain)
                    .map_err(|_| "Saved Firebase session is damaged.".into())
            }) {
                Ok(saved) => saved,
                Err(error) => {
                    warning = Some(error);
                    SavedState::default()
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => SavedState::default(),
            Err(e) => {
                warning = Some(format!("Could not read the saved login: {e}"));
                SavedState::default()
            }
        };
        if let Some(config) = &saved.config {
            config.validate()?;
        }
        let status = CloudStatus {
            configured: false,
            project_id: None,
            account: None,
            phase: "idle".into(),
            message: warning.unwrap_or_else(|| "Sign in to save your setup automatically.".into()),
            saved_at: None,
            revision: None,
        };
        Ok(Self {
            directory,
            client: Client::builder()
                .timeout(Duration::from_secs(60))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|e| e.to_string())?,
            operation: Mutex::new(()),
            local: Mutex::new(LocalState { saved, status }),
            cancelled: AtomicBool::new(false),
        })
    }
    pub fn status(&self) -> CloudStatus {
        let local = self.local.lock().unwrap();
        let mut status = local.status.clone();
        status.configured = local.saved.config.is_some();
        status.project_id = local.saved.config.as_ref().map(|c| c.project_id.clone());
        status.account = local
            .saved
            .session
            .as_ref()
            .map(|s| s.account.email.clone());
        status
    }
    fn publish(
        &self,
        app: &tauri::AppHandle,
        phase: &str,
        message: &str,
        head: Option<&firestore::Head>,
    ) {
        {
            let mut local = self.local.lock().unwrap();
            local.status.phase = phase.into();
            local.status.message = message.into();
            if let Some(head) = head {
                local.status.saved_at = Some(head.saved_at);
                local.status.revision = Some(head.revision.clone());
            } else if phase == "choice" || phase == "idle" {
                local.status.saved_at = None;
                local.status.revision = None;
            }
        }
        let _ = app.emit("firebase-status", self.status());
    }
    pub fn mark_pending(&self, app: &tauri::AppHandle) {
        {
            let mut local = self.local.lock().unwrap();
            if local.saved.session.is_none()
                || matches!(local.status.phase.as_str(), "choice" | "signing_in")
            {
                return;
            }
            if local.status.phase != "syncing" {
                local.status.phase = "pending".into();
            }
            local.status.message = "Changes saved locally; waiting for cloud backup.".into();
        }
        let _ = app.emit("firebase-status", self.status());
    }
    fn save(&self, saved: SavedState) -> Result<(), String> {
        let bytes = crypto::protect(&serde_json::to_vec(&saved).map_err(|e| e.to_string())?)?;
        let temporary = self.directory.join("firebase-session.tmp");
        std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(temporary, self.directory.join("firebase-session.bin"))
            .map_err(|e| e.to_string())?;
        self.local.lock().unwrap().saved = saved;
        Ok(())
    }
    fn capture(&self, app: &tauri::AppHandle) -> Result<snapshot::Capture, String> {
        let state = app.state::<AppState>();
        let _lock = state.db_access.lock().unwrap();
        snapshot::capture(config::load_db(&state.db_path)?)
    }
    async fn sync(
        &self,
        app: &tauri::AppHandle,
        choice: Option<&str>,
        expected: Option<&str>,
    ) -> Result<(), String> {
        let mut saved = self.local.lock().unwrap().saved.clone();
        let config = saved
            .config
            .clone()
            .ok_or("Connect your Firebase project first.")?;
        let mut session = saved.session.clone().ok_or("Sign in with Google first.")?;
        let expiry = session.account.expires_at;
        session.account.refresh(&self.client, &config).await?;
        if session.account.expires_at != expiry {
            saved.session = Some(session.clone());
            self.save(saved.clone())?;
        }
        let capture = self.capture(app)?;
        let digest = crypto::digest(&capture.bytes)?;
        let store = firestore::Store::new(&self.client, &config, &session.account);
        let head = store.head().await?;
        if choice.is_some() && head.as_ref().map(|h| h.revision.as_str()) != expected {
            return Err(firestore::CONFLICT.into());
        }
        let decision = if !capture.missing.is_empty() && choice.is_none() && head.is_some() {
            Decision::Choice
        } else {
            decide(&session.baseline, &digest, head.as_ref(), choice)?
        };
        if decision == Decision::Choice {
            self.publish(
                app,
                "choice",
                "A cloud copy is available. Choose which setup to keep.",
                head.as_ref(),
            );
            return Ok(());
        }
        self.publish(app, "syncing", "Saving your setup…", head.as_ref());
        let (confirmed, baseline_digest) = match decision {
            Decision::Upload => {
                if !capture.missing.is_empty() {
                    return Err(format!("Backup stopped: cannot read linked script {}. Restore that file or choose the cloud copy.", capture.missing[0]));
                }
                let uploaded = store.upload(&capture.bytes, head.as_ref()).await?;
                (uploaded, digest.clone())
            }
            Decision::Restore => {
                self.publish(app, "syncing", "Restoring your cloud setup…", head.as_ref());
                let remote = head.as_ref().unwrap();
                let bytes = store.download(remote).await?;
                let snapshot = snapshot::decode(&bytes)?;
                if store.head().await?.as_ref().map(|h| &h.revision) != Some(&remote.revision) {
                    return Err(firestore::CONFLICT.into());
                }
                let state = app.state::<AppState>();
                let _lock = state.db_access.lock().unwrap();
                let before = snapshot::capture(config::load_db(&state.db_path)?)?;
                if crypto::digest(&before.bytes)? != digest {
                    return Err(
                        "Local settings changed during download. Review the copies again.".into(),
                    );
                }
                let recovery = self.directory.join("before-cloud-restore");
                std::fs::create_dir_all(&recovery).map_err(|e| e.to_string())?;
                std::fs::write(
                    recovery.join(format!("{}-{}.json", auth::now(), crypto::random_id()?)),
                    before.bytes,
                )
                .map_err(|e| e.to_string())?;
                let database = snapshot.materialize(&self.directory)?;
                config::save_db(&state.db_path, &database)?;
                #[cfg(windows)]
                state.script_jobs.lock().unwrap().clear();
                crate::clear_overlay(app);
                crate::set_overlay_visible(app, false);
                crate::sync_hotkeys(&state, &database);
                crate::sync_autostart(app, database.settings.launch_on_startup);
                let restored_digest = crypto::digest(&snapshot::capture(database)?.bytes)?;
                let _ = app.emit("firebase-restored", ());
                (remote.clone(), restored_digest)
            }
            Decision::Current => (
                head.clone().ok_or("Cloud copy disappeared.")?,
                digest.clone(),
            ),
            Decision::Choice => unreachable!(),
        };
        if session.baseline.revision.as_deref() != Some(&confirmed.revision)
            || session.baseline.digest.as_deref() != Some(&baseline_digest)
        {
            session.baseline = Baseline {
                revision: Some(confirmed.revision.clone()),
                digest: Some(baseline_digest.clone()),
            };
            saved.session = Some(session);
            self.save(saved)?;
        }
        let state = app.state::<AppState>();
        let _lock = state.db_access.lock().unwrap();
        let latest = snapshot::capture(config::load_db(&state.db_path)?)?;
        if latest.missing.is_empty() && crypto::digest(&latest.bytes)? == baseline_digest {
            self.publish(
                app,
                "saved",
                "Your cloud backup is up to date.",
                Some(&confirmed),
            );
        } else {
            self.publish(
                app,
                "pending",
                "Newer changes are waiting for the next backup.",
                Some(&confirmed),
            );
        }
        Ok(())
    }
    fn finish(
        &self,
        app: &tauri::AppHandle,
        result: Result<(), String>,
    ) -> Result<CloudStatus, String> {
        if let Err(error) = result {
            if error == firestore::CONFLICT {
                // Refresh metadata on the next explicit check before accepting a choice.
                self.publish(
                    app,
                    "error",
                    &format!("{error} Select Sync now to refresh."),
                    None,
                );
            } else {
                self.publish(app, "error", &error, None);
            }
            return Err(error);
        }
        Ok(self.status())
    }
    pub fn start(app: tauri::AppHandle) {
        std::thread::spawn(move || {
            let mut cleanup_at = 0;
            loop {
                std::thread::sleep(Duration::from_secs(30));
                let service = app.state::<Firebase>();
                let Ok(_operation) = service.operation.try_lock() else {
                    continue;
                };
                let status = service.status();
                if status.account.is_none() || status.phase == "choice" {
                    continue;
                }
                let result = tauri::async_runtime::block_on(service.sync(&app, None, None));
                let succeeded = result.is_ok();
                let _ = service.finish(&app, result);
                if succeeded && auth::now() >= cleanup_at {
                    cleanup_at = auth::now() + 3600;
                    let saved = service.local.lock().unwrap().saved.clone();
                    if let (Some(config), Some(session)) = (saved.config, saved.session) {
                        // Cleanup failure must never misreport a completed backup as unsaved.
                        let _ = tauri::async_runtime::block_on(
                            firestore::Store::new(&service.client, &config, &session.account)
                                .prune(),
                        );
                    }
                }
            }
        });
    }
}

#[tauri::command]
pub fn firebase_status(service: tauri::State<Firebase>) -> CloudStatus {
    service.status()
}

#[tauri::command]
pub fn firebase_cancel_login(service: tauri::State<Firebase>) {
    service.cancelled.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub async fn firebase_configure(
    app: tauri::AppHandle,
    api_key: String,
    desktop_json: String,
) -> Result<CloudStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let service = app.state::<Firebase>();
        let _operation = service.operation.lock().unwrap();
        if service.status().account.is_some() { return Err("Sign out before changing Firebase projects.".into()); }
        #[derive(Deserialize)] struct Download { installed: DesktopConfig }
        let config = match serde_json::from_str::<CloudConfig>(&desktop_json) {
            Ok(config) => config,
            Err(_) => {
                let desktop = serde_json::from_str::<Download>(&desktop_json).map_err(|_| "Choose the downloaded Google Desktop OAuth JSON or an exported connection file, not a service-account key.")?.installed;
                CloudConfig { project_id: desktop.project_id.clone(), api_key: api_key.trim().into(), desktop }
            }
        };
        config.validate()?;
        service.save(SavedState { config: Some(config), session: None })?;
        service.publish(&app, "idle", "Firebase connected. Sign in with Google to start.", None);
        Ok(service.status())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn firebase_export_config(service: tauri::State<Firebase>) -> Result<String, String> {
    let local = service.local.lock().unwrap();
    let config = local
        .saved
        .config
        .as_ref()
        .ok_or("Connect Firebase first.")?;
    serde_json::to_string_pretty(config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn firebase_login(app: tauri::AppHandle) -> Result<CloudStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let service = app.state::<Firebase>();
        let _operation = service.operation.lock().unwrap();
        service.cancelled.store(false, Ordering::Relaxed);
        service.publish(
            &app,
            "signing_in",
            "Complete Google sign-in in your browser.",
            None,
        );
        let result = tauri::async_runtime::block_on(async {
            let mut saved = service.local.lock().unwrap().saved.clone();
            let config = saved
                .config
                .as_ref()
                .ok_or("Connect your Firebase project first.")?;
            let account = auth::login(&app, &service.client, config, &service.cancelled).await?;
            let baseline = saved
                .session
                .as_ref()
                .filter(|s| s.account.uid == account.uid)
                .map(|s| s.baseline.clone())
                .unwrap_or_default();
            saved.session = Some(Session { account, baseline });
            service.save(saved)?;
            service.sync(&app, None, None).await
        });
        service.finish(&app, result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn firebase_logout(app: tauri::AppHandle) -> Result<CloudStatus, String> {
    let service = app.state::<Firebase>();
    service.cancelled.store(true, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let service = app.state::<Firebase>();
        let _operation = service.operation.lock().unwrap();
        let mut saved = service.local.lock().unwrap().saved.clone();
        saved.session = None;
        service.save(saved)?;
        service.publish(
            &app,
            "idle",
            "Signed out. Your local setup and cloud backup are kept.",
            None,
        );
        Ok(service.status())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn firebase_sync(
    app: tauri::AppHandle,
    choice: Option<String>,
    expected_revision: Option<String>,
) -> Result<CloudStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let service = app.state::<Firebase>();
        let _operation = service.operation.lock().unwrap();
        let result = tauri::async_runtime::block_on(service.sync(
            &app,
            choice.as_deref(),
            expected_revision.as_deref(),
        ));
        service.finish(&app, result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn connection_is_local_and_survives_restart() {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../target/firebase-runtime-tests")
            .join(crypto::random_id().unwrap());
        std::fs::create_dir_all(&directory).unwrap();
        let firebase = Firebase::new(directory.clone()).unwrap();
        assert!(!firebase.status().configured);
        firebase
            .save(SavedState {
                config: Some(CloudConfig {
                    project_id: "test-project".into(),
                    api_key: "test-key".into(),
                    desktop: DesktopConfig {
                        project_id: "test-project".into(),
                        client_id: "123.apps.googleusercontent.com".into(),
                        client_secret: String::new(),
                    },
                }),
                session: None,
            })
            .unwrap();
        let restarted = Firebase::new(directory.clone()).unwrap();
        assert!(restarted.status().configured);
        assert_eq!(restarted.status().project_id.as_deref(), Some("test-project"));
        assert!(restarted.status().account.is_none());
        std::fs::remove_file(directory.join("firebase-session.bin")).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    fn head(revision: &str, digest: &str) -> firestore::Head {
        firestore::Head {
            revision: revision.into(),
            digest: digest.into(),
            chunks: 1,
            bytes: 1,
            saved_at: 1,
            update_time: "time".into(),
        }
    }
    #[test]
    fn fresh_installation_and_remote_changes_require_a_choice() {
        assert_eq!(
            decide(
                &Baseline::default(),
                "local",
                Some(&head("remote", "cloud")),
                None
            )
            .unwrap(),
            Decision::Choice
        );
        let baseline = Baseline {
            revision: Some("old".into()),
            digest: Some("local".into()),
        };
        assert_eq!(
            decide(&baseline, "local", Some(&head("new", "cloud")), None).unwrap(),
            Decision::Choice
        );
        assert_eq!(
            decide(&baseline, "edited", Some(&head("new", "cloud")), None).unwrap(),
            Decision::Choice
        );
        assert_eq!(
            decide(&baseline, "local", None, None).unwrap(),
            Decision::Choice
        );
    }
    #[test]
    fn offline_edits_lost_acknowledgements_and_explicit_choices() {
        let baseline = Baseline {
            revision: Some("old".into()),
            digest: Some("local".into()),
        };
        assert_eq!(
            decide(&baseline, "edited", Some(&head("old", "cloud")), None).unwrap(),
            Decision::Upload
        );
        assert_eq!(
            decide(&baseline, "edited", Some(&head("new", "edited")), None).unwrap(),
            Decision::Current
        );
        assert_eq!(
            decide(
                &baseline,
                "local",
                Some(&head("old", "different-restored-paths")),
                None
            )
            .unwrap(),
            Decision::Current
        );
        assert_eq!(
            decide(
                &baseline,
                "local",
                Some(&head("new", "cloud")),
                Some("cloud")
            )
            .unwrap(),
            Decision::Restore
        );
        assert_eq!(
            decide(&baseline, "local", None, Some("local")).unwrap(),
            Decision::Upload
        );
        assert!(decide(&baseline, "local", None, Some("cloud")).is_err());
    }
    #[test]
    fn rejects_config_from_different_projects_or_arbitrary_hosts() {
        let mut config = CloudConfig {
            project_id: "test-project".into(),
            api_key: "public-key".into(),
            desktop: DesktopConfig {
                project_id: "test-project".into(),
                client_id: "123.apps.googleusercontent.com".into(),
                client_secret: String::new(),
            },
        };
        assert!(config.validate().is_ok());
        config.project_id = "../elsewhere".into();
        assert!(config.validate().is_err());
        config.project_id = "different-project".into();
        assert!(config.validate().is_err());
    }
}
