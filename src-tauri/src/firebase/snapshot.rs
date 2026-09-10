use super::crypto;
use crate::config::{self, Database};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    format: u32,
    pub database: Database,
    files: BTreeMap<String, String>,
}

pub struct Capture {
    pub bytes: Vec<u8>,
    pub missing: Vec<String>,
}

fn linked_paths(db: &Database) -> BTreeSet<String> {
    db.games
        .iter()
        .flat_map(|g| &g.profiles)
        .flat_map(|p| &p.scripts)
        .filter(|s| s.source == "path" && !s.path.is_empty())
        .map(|s| s.path.clone())
        .collect()
}

pub fn capture(database: Database) -> Result<Capture, String> {
    let mut files = BTreeMap::new();
    let mut missing = Vec::new();
    for path in linked_paths(&database) {
        match std::fs::read(&path) {
            Ok(bytes) => {
                files.insert(path, STANDARD.encode(bytes));
            }
            Err(_) => missing.push(path),
        }
    }
    let snapshot = Snapshot {
        format: 1,
        database,
        files,
    };
    Ok(Capture {
        bytes: serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?,
        missing,
    })
}

pub fn decode(bytes: &[u8]) -> Result<Snapshot, String> {
    let snapshot: Snapshot =
        serde_json::from_slice(bytes).map_err(|_| "Cloud backup has an invalid format.")?;
    if snapshot.format != 1 || snapshot.database.version != config::CURRENT_DB_VERSION {
        return Err("This backup requires a different MacroToolbox version.".into());
    }
    if snapshot.files.keys().cloned().collect::<BTreeSet<_>>() != linked_paths(&snapshot.database) {
        return Err("Cloud backup is missing linked scripts or contains unexpected files.".into());
    }
    let mut folders = BTreeSet::new();
    let mut profiles = BTreeSet::new();
    for game in &snapshot.database.games {
        if game.id.is_empty() || !folders.insert(&game.id) {
            return Err("Cloud backup contains duplicate or empty folder IDs.".into());
        }
        for profile in &game.profiles {
            if profile.id.is_empty() || !profiles.insert(&profile.id) {
                return Err("Cloud backup contains duplicate or empty profile IDs.".into());
            }
        }
    }
    for data in snapshot.files.values() {
        STANDARD
            .decode(data)
            .map_err(|_| "A linked script is damaged.")?;
    }
    Ok(snapshot)
}

impl Snapshot {
    pub fn materialize(mut self, directory: &Path) -> Result<Database, String> {
        let mut paths = BTreeMap::new();
        for (original, data) in self.files {
            let bytes = STANDARD
                .decode(data)
                .map_err(|_| "A linked script is damaged.")?;
            let parent = directory
                .join("restored-scripts")
                .join(crypto::digest(original.as_bytes())?);
            std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
            let extension = match Path::new(&original).extension().and_then(|e| e.to_str()) {
                Some("py") => "py",
                Some("ahk") => "ahk",
                _ => "txt",
            };
            let mut path = parent.join(format!("{}.{}", crypto::digest(&bytes)?, extension));
            if path.exists() && std::fs::read(&path).map_err(|e| e.to_string())? != bytes {
                path = parent.join(format!("{}.{}", crypto::random_id()?, extension));
            }
            if !path.exists() {
                std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            }
            paths.insert(original, path.to_string_lossy().into_owned());
        }
        for script in self
            .database
            .games
            .iter_mut()
            .flat_map(|g| &mut g.profiles)
            .flat_map(|p| &mut p.scripts)
        {
            if script.source == "path" {
                if let Some(path) = paths.get(&script.path) {
                    script.path = path.clone();
                }
            }
        }
        config::ensure_global_folder(&mut self.database);
        Ok(self.database)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_incompatible_or_incomplete_backups() {
        let mut db = Database::default();
        db.version = config::CURRENT_DB_VERSION;
        let captured = capture(db).unwrap();
        assert!(decode(&captured.bytes).is_ok());
        let mut value: serde_json::Value = serde_json::from_slice(&captured.bytes).unwrap();
        value["format"] = 9.into();
        assert!(decode(&serde_json::to_vec(&value).unwrap()).is_err());
        value["format"] = 1.into();
        value["files"]["C:/unexpected.py"] = "YQ==".into();
        assert!(decode(&serde_json::to_vec(&value).unwrap()).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn linked_scripts_survive_loss_without_overwriting_local_files() {
        let root = std::env::temp_dir().join(format!(
            "macrotoolbox-firebase-{}",
            crypto::random_id().unwrap()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let original = root.join("original.py");
        std::fs::write(&original, "print('saved')").unwrap();
        let db: Database = serde_json::from_value(serde_json::json!({"version":4,"settings":{"ahk_exe":"","open_to_tray":false,"close_to_tray":false},"scopes":[{"id":"global","name":"Global","exe":"*","profiles":[{"id":"p","name":"P","scripts":[{"id":"s","trigger":"launch","source":"path","path":original}]}]}]})).unwrap();
        let backup = capture(db.clone()).unwrap();
        std::fs::remove_file(original).unwrap();
        assert_eq!(capture(db).unwrap().missing.len(), 1);
        let restored = decode(&backup.bytes).unwrap().materialize(&root).unwrap();
        let path = &restored.games[0].profiles[0].scripts[0].path;
        assert!(Path::new(path).starts_with(root.join("restored-scripts")));
        assert_eq!(std::fs::read_to_string(path).unwrap(), "print('saved')");
        std::fs::write(path, "local edits").unwrap();
        let again = decode(&backup.bytes).unwrap().materialize(&root).unwrap();
        assert_ne!(&again.games[0].profiles[0].scripts[0].path, path);
        assert_eq!(std::fs::read_to_string(path).unwrap(), "local edits");
        std::fs::remove_dir_all(root).unwrap();
    }
}
