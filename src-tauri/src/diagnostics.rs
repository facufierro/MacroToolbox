use std::{fs::{File, OpenOptions}, io::Write, path::Path, sync::Mutex};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    #[serde(default)]
    pub id: usize,
    pub at: u64,
    pub level: Level,
    pub source: String,
    pub message: String,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level { Info, Warn, Error }

struct Session { entries: Vec<Entry>, file: Option<File> }
pub struct Diagnostics(Mutex<Session>);

impl Diagnostics {
    pub fn new(data_dir: &Path) -> Self {
        let path = data_dir.join("logs").join(format!("diagnostics-{}-{}.jsonl", crate::runtime::now_ms(), std::process::id()));
        let file = std::fs::create_dir_all(path.parent().unwrap())
            .and_then(|_| OpenOptions::new().create_new(true).write(true).open(&path));
        let mut session = Session { entries: Vec::new(), file: None };
        let (level, message) = match file {
            Ok(file) => {
                session.file = Some(file);
                (Level::Info, format!("MacroToolbox {}; session pid={}; diagnostic file={}", env!("CARGO_PKG_VERSION"), std::process::id(), path.display()))
            }
            Err(error) => (Level::Warn, format!("Could not create diagnostic file: {error}. Logs remain available in Console / Copy.")),
        };
        session.push(Entry { id: 0, at: crate::runtime::now_ms(), level, source: "App".into(), message });
        Self(Mutex::new(session))
    }
}

impl Session {
    fn push(&mut self, mut entry: Entry) -> Entry {
        entry.id = self.entries.len() + 1;
        if let Some(file) = &mut self.file {
            let result = serde_json::to_writer(&mut *file, &entry).map_err(std::io::Error::other)
                .and_then(|_| file.write_all(b"\n"));
            if let Err(error) = result { eprintln!("Could not write diagnostics: {error}"); }
        }
        self.entries.push(entry.clone());
        entry
    }
}

// Callers supply diagnostic metadata only, never behavior trees, request bodies or passwords.
pub fn record(app: &tauri::AppHandle, level: Level, source: &str, message: String) {
    receive(app, vec![Entry { id: 0, at: crate::runtime::now_ms(), level, source: source.into(), message }]);
}

pub fn receive(app: &tauri::AppHandle, entries: Vec<Entry>) {
    let diagnostics = app.state::<Diagnostics>();
    let mut session = diagnostics.0.lock().unwrap();
    for entry in entries {
        let entry = session.push(entry);
        let _ = app.emit("console-entry", entry);
    }
}

#[tauri::command]
pub fn get_console_entries(state: State<Diagnostics>) -> Vec<Entry> {
    state.0.lock().unwrap().entries.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_orders_entries_without_replacing_the_producer_timestamp() {
        let mut session = Session { entries: Vec::new(), file: None };
        for at in [200, 100] {
            session.push(Entry { id: 99, at, level: Level::Info, source: "Runtime".into(), message: "step completed".into() });
        }
        assert_eq!(session.entries.iter().map(|entry| (entry.id, entry.at)).collect::<Vec<_>>(), [(1, 200), (2, 100)]);
    }

    #[test]
    fn session_writes_replayable_json_lines() {
        let path = std::env::temp_dir().join(format!("macrotoolbox-diagnostics-test-{}-{}.jsonl", std::process::id(), crate::runtime::now_ms()));
        let file = OpenOptions::new().create_new(true).write(true).open(&path).unwrap();
        let mut session = Session { entries: Vec::new(), file: Some(file) };
        session.push(Entry { id: 0, at: 1234, level: Level::Error, source: "Save".into(), message: "CredWriteW failed\nWindows error 1312".into() });
        drop(session);
        let text = std::fs::read_to_string(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert_eq!(text.lines().count(), 1);
        let entry: Entry = serde_json::from_str(text.trim()).unwrap();
        assert_eq!(entry.id, 1);
        assert_eq!(entry.at, 1234);
        assert_eq!(entry.message, "CredWriteW failed\nWindows error 1312");
    }
}
