use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Database {
    #[serde(rename = "scopes", alias = "games")]
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
    pub overlay_disabled: bool,
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
    pub states: Vec<ProfileState>,
    #[serde(default)]
    pub overlay_items: Vec<OverlayItem>,
    #[serde(default)]
    pub overlay_triggers: Vec<OverlayTrigger>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OverlayConfig {
    #[serde(default)]
    pub items: Vec<OverlayItem>,
    #[serde(default)]
    pub states: Vec<ProfileState>,
    #[serde(default)]
    pub hotkeys: Vec<OverlayHotkeyStateBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileState {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayHotkeyStateBinding {
    pub trigger: String,
    #[serde(default)]
    pub state_id: Option<String>,
}

fn default_overlay_display_mode() -> String {
    "always".to_string()
}

fn default_timer_color() -> String {
    "#ffffff".to_string()
}

fn default_timer_font_size() -> u32 {
    22
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OverlayItem {
    Timer {
        id: String,
        #[serde(default)]
        name: String,
        x: f64,
        y: f64,
        duration_ms: u64,
        #[serde(default = "default_timer_color")]
        color: String,
        #[serde(default = "default_timer_font_size")]
        font_size: u32,
        #[serde(default)]
        state_id: Option<String>,
        #[serde(default)]
        timer_state_id: Option<String>,
        #[serde(default)]
        visible_when: Option<String>,
        #[serde(default = "default_overlay_display_mode")]
        display_mode: String,
        #[serde(default)]
        hotkey_trigger: Option<String>,
        #[serde(default)]
        show_duration_ms: Option<u64>,
        #[serde(default)]
        timer_key: Option<String>,
    },
    Icon  {
        id: String,
        #[serde(default)]
        name: String,
        x: f64,
        y: f64,
        w: u32,
        h: u32,
        src: Option<String>,
        #[serde(default)]
        state_id: Option<String>,
        #[serde(default)]
        visible_when: Option<String>,
        #[serde(default = "default_overlay_display_mode")]
        display_mode: String,
        #[serde(default)]
        hotkey_trigger: Option<String>,
        #[serde(default)]
        show_duration_ms: Option<u64>,
    },
    Bar   {
        id: String,
        #[serde(default)]
        name: String,
        x: f64,
        y: f64,
        w: u32,
        h: u32,
        color: String,
        max_value: f64,
        #[serde(default)]
        state_id: Option<String>,
        #[serde(default)]
        visible_when: Option<String>,
        #[serde(default = "default_overlay_display_mode")]
        display_mode: String,
        #[serde(default)]
        hotkey_trigger: Option<String>,
        #[serde(default)]
        show_duration_ms: Option<u64>,
    },
    Text  {
        id: String,
        #[serde(default)]
        name: String,
        x: f64,
        y: f64,
        font_size: u32,
        color: String,
        content: String,
        #[serde(default)]
        state_id: Option<String>,
        #[serde(default)]
        visible_when: Option<String>,
        #[serde(default = "default_overlay_display_mode")]
        display_mode: String,
        #[serde(default)]
        hotkey_trigger: Option<String>,
        #[serde(default)]
        show_duration_ms: Option<u64>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayTrigger {
    pub id: String,
    pub event: String,
    #[serde(default)]
    pub hotkey_trigger: Option<String>,
    pub action: String,
    pub state_key: String,
    #[serde(default)]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hotkey {
    #[serde(default)]
    pub name: String,
    pub trigger: String,
    pub behavior: String,
    #[serde(default)]
    pub state_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub ahk_exe: String,
    #[serde(default)]
    pub open_to_tray: bool,
    #[serde(default)]
    pub close_to_tray: bool,
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

fn overlay_item_id(item: &OverlayItem) -> String {
    match item {
        OverlayItem::Timer { id, .. }
        | OverlayItem::Icon { id, .. }
        | OverlayItem::Bar { id, .. }
        | OverlayItem::Text { id, .. } => id.clone(),
    }
}

fn resolve_profile_entries<'a, T, F, K>(
    profiles: &'a [Profile],
    profile: &'a Profile,
    select: F,
    key_of: fn(&T) -> K,
    visited: &mut HashSet<&'a str>,
) -> Vec<&'a T>
where
    F: Copy + Fn(&'a Profile) -> &'a [T],
    K: PartialEq,
{
    if !visited.insert(profile.id.as_str()) {
        return vec![];
    }

    let mut resolved = match &profile.parent_id {
        Some(parent_id) => profiles
            .iter()
            .find(|candidate| candidate.id == *parent_id)
            .map(|parent| resolve_profile_entries(profiles, parent, select, key_of, visited))
            .unwrap_or_default(),
        None => vec![],
    };

    for value in select(profile) {
        let key = key_of(value);
        if let Some(slot) = resolved.iter_mut().find(|entry| key_of(*entry) == key) {
            *slot = value;
        } else {
            resolved.push(value);
        }
    }

    resolved
}

pub fn resolve_profile_hotkeys<'a>(profiles: &'a [Profile], profile: &'a Profile) -> Vec<&'a Hotkey> {
    let mut visited = HashSet::new();
    resolve_profile_entries(
        profiles,
        profile,
        |current| current.hotkeys.as_slice(),
        |hotkey| hotkey.trigger.clone(),
        &mut visited,
    )
}

pub fn resolve_profile_states<'a>(profiles: &'a [Profile], profile: &'a Profile) -> Vec<&'a ProfileState> {
    let mut visited = HashSet::new();
    resolve_profile_entries(
        profiles,
        profile,
        |current| current.states.as_slice(),
        |state| state.id.clone(),
        &mut visited,
    )
}

pub fn resolve_profile_overlay_items<'a>(profiles: &'a [Profile], profile: &'a Profile) -> Vec<&'a OverlayItem> {
    let mut visited = HashSet::new();
    resolve_profile_entries(
        profiles,
        profile,
        |current| current.overlay_items.as_slice(),
        overlay_item_id,
        &mut visited,
    )
}
