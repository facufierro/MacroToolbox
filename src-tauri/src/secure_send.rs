use std::collections::HashSet;
use serde::Deserialize;
use crate::{behavior::{Action, valid_credential_id}, config::{Database, Profile}};

// This request is never serialized, cloned, or included in Debug output.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordDraft { pub credential_id: String, password: String }

impl Drop for PasswordDraft {
    fn drop(&mut self) { wipe(unsafe { self.password.as_mut_vec() }); }
}

fn wipe(bytes: &mut [u8]) {
    for byte in bytes { unsafe { std::ptr::write_volatile(byte, 0); } }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

fn action_ids(actions: &[Action], ids: &mut HashSet<String>) {
    for action in actions {
        match action {
            Action::Securesend { credential_id } => { ids.insert(credential_id.clone()); }
            Action::Sequence { steps } | Action::Parallel { steps } => action_ids(steps, ids),
            _ => {}
        }
    }
}

pub fn profile_ids(profile: &Profile) -> HashSet<String> {
    let mut ids = HashSet::new();
    for source in profile.hotkeys.iter().map(|hotkey| &hotkey.behavior).chain(profile.events.iter().map(|event| &event.behavior)) {
        if let Ok(actions) = crate::behavior::parse(source) { action_ids(&actions, &mut ids); }
    }
    ids
}

pub fn database_ids(db: &Database) -> HashSet<String> {
    db.games.iter().flat_map(|game| &game.profiles).flat_map(profile_ids).collect()
}

/// Newly written credentials are rolled back unless the profile was persisted.
pub struct PasswordWrite { created: Vec<String> }

impl PasswordWrite {
    pub fn prepare(drafts: &[PasswordDraft], profile: &Profile) -> Result<Self, String> {
        let referenced = profile_ids(profile);
        let mut pending = Self { created: Vec::new() };
        for draft in drafts {
            if !valid_credential_id(&draft.credential_id) || !referenced.contains(&draft.credential_id) {
                return Err("Invalid Secure send credential reference.".into());
            }
            if draft.password.is_empty() || draft.password.contains('\0') || draft.password.encode_utf16().count() * 2 > 2560 {
                return Err("Enter a password of at most 1280 UTF-16 characters without null characters.".into());
            }
            // Edits receive a new ID; the previous credential is never overwritten by a draft.
            if native::exists(&draft.credential_id)? { return Err("Secure send credential already exists. Reopen the hotkey and enter the password again.".into()); }
            native::write(&draft.credential_id, &draft.password)?;
            pending.created.push(draft.credential_id.clone());
        }
        Ok(pending)
    }

    pub fn commit(mut self) { self.created.clear(); }
}

impl Drop for PasswordWrite {
    fn drop(&mut self) {
        for id in &self.created {
            if native::delete(id).is_err() { eprintln!("Secure send: could not roll back a new Windows credential."); }
        }
    }
}

pub fn retire_unused(previous: HashSet<String>, db: &Database) {
    let current = database_ids(db);
    for id in previous.difference(&current) {
        if valid_credential_id(id) && native::delete(id).is_err() {
            eprintln!("Secure send: could not remove an unused Windows credential.");
        }
    }
}

#[cfg(windows)]
mod native {
    use std::{ffi::c_void, ptr};

    const PREFIX: &str = "MacroToolbox/SecureSend/";
    #[repr(C)]
    struct FileTime { low: u32, high: u32 }
    #[repr(C)]
    struct Credential {
        flags: u32, kind: u32, target: *mut u16, comment: *mut u16, written: FileTime,
        size: u32, blob: *mut u8, persist: u32, attribute_count: u32, attributes: *mut c_void,
        alias: *mut u16, username: *mut u16,
    }
    #[link(name = "advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const Credential, flags: u32) -> i32;
        fn CredReadW(target: *const u16, kind: u32, flags: u32, credential: *mut *mut Credential) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(memory: *mut c_void);
    }

    fn target(id: &str) -> Vec<u16> { format!("{PREFIX}{id}\0").encode_utf16().collect() }

    struct ReadCredential(*mut Credential);
    impl Drop for ReadCredential {
        fn drop(&mut self) {
            unsafe {
                let credential = &*self.0;
                if !credential.blob.is_null() {
                    super::wipe(std::slice::from_raw_parts_mut(credential.blob, credential.size as usize));
                }
                CredFree(self.0.cast());
            }
        }
    }

    pub fn exists(id: &str) -> Result<bool, String> {
        let mut credential = ptr::null_mut();
        if unsafe { CredReadW(target(id).as_ptr(), 1, 0, &mut credential) } == 0 {
            return if std::io::Error::last_os_error().raw_os_error() == Some(1168) { Ok(false) }
                else { Err("Windows Credential Manager is unavailable.".into()) };
        }
        let _credential = ReadCredential(credential);
        Ok(true)
    }

    pub fn write(id: &str, password: &str) -> Result<(), String> {
        let mut target = target(id);
        let mut username: Vec<u16> = "MacroToolbox\0".encode_utf16().collect();
        let mut blob: Vec<u16> = password.encode_utf16().collect();
        let credential = Credential { flags: 0, kind: 1, target: target.as_mut_ptr(), comment: ptr::null_mut(),
            written: FileTime { low: 0, high: 0 }, size: (blob.len() * 2) as u32, blob: blob.as_mut_ptr().cast(),
            persist: 2, attribute_count: 0, attributes: ptr::null_mut(), alias: ptr::null_mut(), username: username.as_mut_ptr() };
        let saved = unsafe { CredWriteW(&credential, 0) } != 0;
        super::wipe(unsafe { std::slice::from_raw_parts_mut(blob.as_mut_ptr().cast(), blob.len() * 2) });
        if saved { Ok(()) } else { Err("Could not save the password in Windows Credential Manager.".into()) }
    }

    pub fn delete(id: &str) -> Result<(), String> {
        if unsafe { CredDeleteW(target(id).as_ptr(), 1, 0) } != 0 || std::io::Error::last_os_error().raw_os_error() == Some(1168) { Ok(()) }
        else { Err("Could not remove the Windows credential.".into()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(ids: &[String]) -> Profile {
        serde_json::from_value(serde_json::json!({"id":"profile","name":"Secure","armed":true,"hotkeys":[{
            "trigger":"f1","behavior":serde_json::json!([{"type":"sequence","steps":ids.iter().map(|id| serde_json::json!({"type":"securesend","credentialId":id})).collect::<Vec<_>>()}]).to_string()
        }]})).unwrap()
    }

    #[test]
    fn references_are_scoped_ids_and_drafts_reject_unbound_or_invalid_passwords() {
        let id = "b8483943-e86c-41aa-a593-7388833369cd".to_string();
        assert!(valid_credential_id(&id));
        for value in ["", "../another-credential", "b8483943-e86c-41aa-a593-7388833369cD"] { assert!(!valid_credential_id(value)); }
        for password in ["".to_string(), "x\0y".to_string(), "🚀".repeat(641)] {
            let error = PasswordWrite::prepare(&[PasswordDraft {credential_id:id.clone(),password}], &profile(std::slice::from_ref(&id))).err().unwrap();
            assert!(error.starts_with("Enter a password"));
        }
        assert!(PasswordWrite::prepare(&[PasswordDraft {credential_id:id.clone(),password:"fixture-only".into()}], &profile(&[])).is_err());
        assert_eq!(profile_ids(&profile(std::slice::from_ref(&id))), HashSet::from([id]));
    }

    #[cfg(windows)]
    #[test]
    fn windows_credentials_rollback_commit_and_live_until_the_last_profile_reference() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let id = format!("{:08x}-0000-4000-8000-{:012x}", std::process::id(), stamp & 0xffffffffffff);
        struct Cleanup(String);
        impl Drop for Cleanup { fn drop(&mut self) { let _ = native::delete(&self.0); } }
        let _cleanup = Cleanup(id.clone());
        let profile = profile(std::slice::from_ref(&id));
        let drafts = [PasswordDraft { credential_id:id.clone(), password:"fixture-only: +!^{Enter};ø🚀".into() }];
        assert!(!native::exists(&id).unwrap());
        let pending = PasswordWrite::prepare(&drafts, &profile).unwrap();
        assert!(native::exists(&id).unwrap());
        drop(pending);
        assert!(!native::exists(&id).unwrap());
        PasswordWrite::prepare(&drafts, &profile).unwrap().commit();
        assert!(native::exists(&id).unwrap());
        assert!(PasswordWrite::prepare(&drafts, &profile).is_err());
        let mut db = Database::default();
        crate::config::ensure_global_folder(&mut db);
        db.games[0].profiles = vec![profile.clone(), profile];
        db.games[0].profiles[1].id = "copy".into();
        let before = database_ids(&db);
        db.games[0].profiles.remove(0);
        retire_unused(before.clone(), &db);
        assert!(native::exists(&id).unwrap());
        db.games[0].profiles.clear();
        retire_unused(before, &db);
        assert!(!native::exists(&id).unwrap());
    }
}

#[cfg(not(windows))]
mod native {
    pub fn exists(_: &str) -> Result<bool, String> { Err("Secure send requires Windows.".into()) }
    pub fn write(_: &str, _: &str) -> Result<(), String> { Err("Secure send requires Windows.".into()) }
    pub fn delete(_: &str) -> Result<(), String> { Err("Secure send requires Windows.".into()) }
}
