use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Database {
    pub games: Vec<Game>,
    pub settings: Settings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Game {
    pub id: String,
    pub name: String,
    pub exe: String,
    pub image: Option<String>,
    pub active_profile: Option<String>,
    pub profiles: Vec<Profile>,
    #[serde(default)]
    pub toggle_hotkeys_key: Option<String>,
    #[serde(default)]
    pub toggle_overlay_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub hotkeys: Vec<Hotkey>,
    #[serde(default)]
    pub overlay_items: Vec<OverlayItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OverlayItem {
    Timer { id: String, x: f64, y: f64, duration_ms: u64, label: String },
    Icon  { id: String, x: f64, y: f64, w: u32, h: u32, src: Option<String> },
    Bar   { id: String, x: f64, y: f64, w: u32, h: u32, color: String, max_value: f64 },
    Text  { id: String, x: f64, y: f64, font_size: u32, color: String, content: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hotkey {
    pub trigger: String,
    pub behavior: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub ahk_exe: String,
}

pub fn load_db(path: &Path) -> Result<Database, String> {
    if !path.exists() {
        return Ok(Database::default());
    }
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub fn save_db(path: &Path, db: &Database) -> Result<(), String> {
    let content = serde_json::to_string_pretty(db).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}
