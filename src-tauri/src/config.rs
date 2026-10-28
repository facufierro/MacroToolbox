use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// The db.json schema version. Bumped when the shape changes so `load_db` can migrate
/// older files. v5 moves state definitions into their target folder.
pub const CURRENT_DB_VERSION: u32 = 5;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Database {
    #[serde(default)]
    pub version: u32,
    #[serde(rename = "scopes", alias = "games")]
    pub games: Vec<Game>,
    pub settings: Settings,
}

/// A folder owns one target executable shared by all of its profiles.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Game {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub exe: String,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub profiles: Vec<Profile>,
    #[serde(default)]
    pub states: Vec<ProfileState>,
    #[serde(default)]
    pub states_disabled: bool,
}

/// A user script owned by a profile. It runs either when its hotkey is pressed (while the
/// folder's app is focused) or when the folder's app is launched. The body is either inline
/// code typed by the user or a path to a script file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Script {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_script_enabled")]
    pub enabled: bool,
    /// "hotkey" | "launch"
    pub trigger: String,
    /// The key combo when `trigger` is "hotkey".
    #[serde(default)]
    pub hotkey: String,
    /// "python" | "autohotkey". Missing on older saved scripts, which were always Python.
    #[serde(default = "default_script_language")]
    pub language: String,
    /// "code" | "path"
    pub source: String,
    /// Inline Python or AutoHotkey code when `source` is "code".
    #[serde(default)]
    pub code: String,
    /// Path to a `.py` or `.ahk` file when `source` is "path".
    #[serde(default)]
    pub path: String,
}

fn default_script_enabled() -> bool {
    true
}

fn default_script_language() -> String {
    "python".to_string()
}

fn default_profile_kind() -> String {
    "hotkeys".to_string()
}

/// A profile owns behaviors, scripts, overlay items, and states that run against its folder's
/// target executable. Arming controls whether those behaviors are active.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// Legacy category retained for saved configurations. Every profile may contain all parts.
    #[serde(default = "default_profile_kind")]
    pub kind: String,
    #[serde(default)]
    pub armed: bool,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub hotkeys: Vec<Hotkey>,
    #[serde(default)]
    pub events: Vec<BehaviorEvent>,
    #[serde(default)]
    pub states: Vec<ProfileState>,
    #[serde(default)]
    pub overlay_items: Vec<OverlayItem>,
    #[serde(default)]
    pub overlay_triggers: Vec<OverlayTrigger>,
    #[serde(default)]
    pub overlay_groups: Vec<OverlayGroup>,
    #[serde(default)]
    pub scripts: Vec<Script>,
    #[serde(default)]
    pub overlay_disabled: bool,
    #[serde(default)]
    pub hotkeys_disabled: bool,
    #[serde(default)]
    pub events_disabled: bool,
    #[serde(default)]
    pub scripts_disabled: bool,
    #[serde(default)]
    pub toggle_hotkeys_key: Option<String>,
    #[serde(default)]
    pub toggle_overlay_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_group_layout")]
    pub layout: String,
    #[serde(default = "default_group_gap")]
    pub gap: u32,
    #[serde(default)]
    pub visible_while_timer_id: Option<String>,
}

impl Profile {
    pub fn section_enabled(&self, section: &str) -> bool {
        match section {
            "hotkeys" => !self.hotkeys_disabled,
            "events" => !self.events_disabled,
            "scripts" => !self.scripts_disabled,
            "overlay" => !self.overlay_disabled,
            _ => false,
        }
    }
}

fn default_group_layout() -> String { "free".into() }
fn default_group_gap() -> u32 { 8 }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OverlayConfig {
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub items: Vec<OverlayItem>,
    #[serde(default)]
    pub groups: Vec<OverlayGroup>,
    #[serde(default)]
    pub disabled_items: Vec<String>,
    #[serde(default)]
    pub states_disabled: bool,
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

fn default_timer_background() -> bool {
    true
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
        #[serde(default = "default_timer_background")]
        show_background: bool,
        #[serde(default)]
        state_id: Option<String>,
        #[serde(default)]
        group_id: Option<String>,
        #[serde(default)]
        visible_while_timer_id: Option<String>,
        #[serde(default)]
        timer_state_id: Option<String>,
        #[serde(default)]
        start_with_overlay: bool,
        #[serde(default)]
        show_only_running: bool,
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
        group_id: Option<String>,
        #[serde(default)]
        visible_while_timer_id: Option<String>,
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
        group_id: Option<String>,
        #[serde(default)]
        visible_while_timer_id: Option<String>,
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
        group_id: Option<String>,
        #[serde(default)]
        visible_while_timer_id: Option<String>,
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
    /// Missing values preserve legacy matching: unmodified keys accept held modifiers,
    /// while triggers with explicit modifiers require their existing modifier combination.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_extra_modifiers: Option<bool>,
    #[serde(default)]
    pub state_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehaviorEvent {
    pub event: String,
    pub behavior: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(default)]
    pub library_width: Option<u16>,
    pub ahk_exe: String,
    /// Python interpreter used to run scripts. Empty falls back to `python` then the
    /// Windows `py` launcher.
    #[serde(default)]
    pub python_exe: String,
    #[serde(default)]
    pub open_to_tray: bool,
    #[serde(default)]
    pub close_to_tray: bool,
    #[serde(default)]
    pub launch_on_startup: bool,
}

/// The reserved id of the always-present "Global" folder. It is a permanent container (never
/// deleted); whatever profiles live inside it are entirely user-managed.
pub const GLOBAL_FOLDER_ID: &str = "global";

/// Guarantee exactly one Global folder (reserved id `GLOBAL_FOLDER_ID`) always exists. Creates an
/// empty one if missing, and collapses any duplicates (a past bug created more than one) into a
/// single folder, preserving every profile. Its contents are never touched otherwise. Returns
/// true if it changed anything.
pub fn ensure_global_folder(db: &mut Database) -> bool {
    let indices: Vec<usize> = db.games.iter().enumerate()
        .filter(|(_, g)| g.id == GLOBAL_FOLDER_ID)
        .map(|(i, _)| i)
        .collect();

    if indices.is_empty() {
        db.games.push(Game {
            states: Vec::new(), states_disabled: false,
            id: GLOBAL_FOLDER_ID.to_string(),
            name: "Global".to_string(),
            exe: "*".to_string(),
            image: None,
            profiles: Vec::new(),
        });
        return true;
    }
    if indices.len() == 1 {
        let global = &mut db.games[indices[0]];
        if global.exe != "*" {
            global.exe = "*".to_string();
            return true;
        }
        return false;
    }
    // Merge every duplicate Global folder's profiles into the first, then drop the extras.
    let keep = indices[0];
    let merged: Vec<Profile> = indices.iter().flat_map(|&i| db.games[i].profiles.clone()).collect();
    let merged_states = indices.iter().flat_map(|&i| db.games[i].states.clone()).collect();
    db.games[keep].profiles = merged;
    db.games[keep].states = merged_states;
    db.games[keep].exe = "*".to_string();
    for &i in indices.iter().skip(1).rev() {
        db.games.remove(i);
    }
    true
}

pub fn load_db(path: &Path) -> Result<Database, String> {
    if !path.exists() {
        let mut db = Database { version: CURRENT_DB_VERSION, ..Default::default() };
        ensure_global_folder(&mut db);
        save_db(path, &db)?;
        return Ok(db);
    }
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let version = value.get("version").and_then(|v| v.as_u64()).unwrap_or(0) as u32;

    let (mut db, migrated) = match version {
        v if v > CURRENT_DB_VERSION => return Err(format!("Settings schema v{v} requires a newer MacroToolbox version.")),
        v if v == CURRENT_DB_VERSION => {
            (serde_json::from_value(value).map_err(|e| e.to_string())?, false)
        }
        4 => {
            let mut db: Database = serde_json::from_value(value).map_err(|e| e.to_string())?;
            let mut backup = path.as_os_str().to_owned(); backup.push(".v4.bak");
            std::fs::copy(path, std::path::Path::new(&backup)).map_err(|e| format!("Could not back up settings: {e}"))?;
            db.version = CURRENT_DB_VERSION;
            (db, true)
        }
        3 => {
            let mut db: Database = serde_json::from_value(value).map_err(|e| e.to_string())?;
            let mut backup = path.as_os_str().to_owned();
            backup.push(".v3.bak");
            let _ = std::fs::copy(path, std::path::Path::new(&backup));
            db.version = CURRENT_DB_VERSION;
            (db, true)
        }
        2 => {
            let legacy: legacy_v2::Database = serde_json::from_value(value).map_err(|e| e.to_string())?;
            let mut backup = path.as_os_str().to_owned();
            backup.push(".v2.bak");
            let _ = std::fs::copy(path, std::path::Path::new(&backup));
            (legacy_v2::migrate(legacy), true)
        }
        _ => {
            let legacy: legacy_v1::Database = serde_json::from_value(value).map_err(|e| e.to_string())?;
            let mut backup = path.as_os_str().to_owned();
            backup.push(".v1.bak");
            let _ = std::fs::copy(path, std::path::Path::new(&backup));
            (legacy_v1::migrate(legacy), true)
        }
    };

    // Self-heal the always-present global folder, then persist only when something changed.
    let added_global = ensure_global_folder(&mut db);
    let moved_states = normalize_states(&mut db);
    let grouped_overlays = normalize_overlays(&mut db);
    if migrated || added_global || moved_states || grouped_overlays {
        save_db(path, &db)?;
    }
    Ok(db)
}

/// Reads v2's profile-owned executable shape and groups profiles under folder-owned targets.
/// A folder containing several targets is split so every profile keeps its activation behavior.
mod legacy_v2 {
    use super::{Database as NewDatabase, Game as NewGame, Profile, Settings, CURRENT_DB_VERSION, GLOBAL_FOLDER_ID};
    use serde::Deserialize;
    use std::collections::HashSet;

    #[derive(Deserialize)]
    pub struct Database {
        #[serde(rename = "scopes", alias = "games", default)]
        pub games: Vec<Game>,
        #[serde(default)]
        pub settings: Settings,
    }

    #[derive(Deserialize)]
    pub struct Game {
        pub id: String,
        #[serde(default)]
        pub name: String,
        #[serde(default)]
        pub image: Option<String>,
        #[serde(default)]
        pub profiles: Vec<LegacyProfile>,
    }

    #[derive(Deserialize)]
    pub struct LegacyProfile {
        #[serde(default)]
        pub exe: String,
        #[serde(flatten)]
        pub profile: Profile,
    }

    fn normalized_exe(exe: &str) -> String {
        exe.trim().to_string()
    }

    fn target_label(exe: &str) -> &str {
        match exe {
            "*" => "Any app",
            "" => "No app",
            value => value,
        }
    }

    fn split_id(
        original_id: &str,
        ordinal: usize,
        reserved: &HashSet<String>,
        allocated: &mut HashSet<String>,
    ) -> String {
        let mut suffix = ordinal;
        loop {
            let candidate = format!("{original_id}-target-{suffix}");
            if !reserved.contains(&candidate) && allocated.insert(candidate.clone()) {
                return candidate;
            }
            suffix += 1;
        }
    }

    fn materialize_cross_target_inheritance(profiles: &mut [LegacyProfile]) {
        let snapshots: Vec<Profile> = profiles.iter().map(|entry| entry.profile.clone()).collect();
        for index in 0..profiles.len() {
            let Some(parent_id) = snapshots[index].parent_id.as_deref() else { continue };
            let Some(parent_index) = snapshots.iter().position(|profile| profile.id == parent_id) else { continue };
            if normalized_exe(&profiles[index].exe)
                .eq_ignore_ascii_case(&normalized_exe(&profiles[parent_index].exe))
            {
                continue;
            }

            let profile = &snapshots[index];
            profiles[index].profile.hotkeys = super::resolve_profile_hotkeys(&snapshots, profile)
                .into_iter()
                .cloned()
                .collect();
            profiles[index].profile.states = super::resolve_profile_states(&snapshots, profile)
                .into_iter()
                .cloned()
                .collect();
            profiles[index].profile.overlay_items = super::resolve_profile_overlay_items(&snapshots, profile)
                .into_iter()
                .cloned()
                .collect();
            profiles[index].profile.parent_id = None;
        }
    }

    pub fn migrate(legacy: Database) -> NewDatabase {
        let reserved: HashSet<String> = legacy.games.iter().map(|game| game.id.clone()).collect();
        let mut allocated = HashSet::new();
        let mut games = Vec::new();

        for mut game in legacy.games {
            materialize_cross_target_inheritance(&mut game.profiles);
            let mut groups: Vec<(String, Vec<Profile>)> = Vec::new();
            for entry in game.profiles {
                let exe = normalized_exe(&entry.exe);
                if let Some((_, profiles)) = groups
                    .iter_mut()
                    .find(|(target, _)| target.eq_ignore_ascii_case(&exe))
                {
                    profiles.push(entry.profile);
                } else {
                    groups.push((exe, vec![entry.profile]));
                }
            }

            if game.id == GLOBAL_FOLDER_ID {
                allocated.insert(game.id.clone());
                let global_index = groups.iter().position(|(exe, _)| exe == "*");
                let global_profiles = global_index
                    .map(|index| groups.remove(index).1)
                    .unwrap_or_default();
                games.push(NewGame {
                    states: Vec::new(), states_disabled: false,
                    id: game.id.clone(),
                    name: game.name.clone(),
                    exe: "*".to_string(),
                    image: game.image.clone(),
                    profiles: global_profiles,
                });
                for (index, (exe, profiles)) in groups.into_iter().enumerate() {
                    games.push(NewGame {
                        states: Vec::new(), states_disabled: false,
                        id: split_id(&game.id, index + 2, &reserved, &mut allocated),
                        name: format!("{} ({})", game.name, target_label(&exe)),
                        exe,
                        image: game.image.clone(),
                        profiles,
                    });
                }
                continue;
            }

            if groups.is_empty() {
                allocated.insert(game.id.clone());
                games.push(NewGame {
                    states: Vec::new(), states_disabled: false,
                    id: game.id,
                    name: game.name,
                    exe: String::new(),
                    image: game.image,
                    profiles: Vec::new(),
                });
                continue;
            }

            let multiple_targets = groups.len() > 1;
            for (index, (exe, profiles)) in groups.into_iter().enumerate() {
                let id = if index == 0 {
                    allocated.insert(game.id.clone());
                    game.id.clone()
                } else {
                    split_id(&game.id, index + 1, &reserved, &mut allocated)
                };
                let name = if multiple_targets {
                    format!("{} ({})", game.name, target_label(&exe))
                } else {
                    game.name.clone()
                };
                games.push(NewGame {
                    states: Vec::new(), states_disabled: false,
                    id,
                    name,
                    exe,
                    image: game.image.clone(),
                    profiles,
                });
            }
        }

        NewDatabase { version: CURRENT_DB_VERSION, games, settings: legacy.settings }
    }
}

/// Reads the pre-v2 db.json shape (exe/scripts/toggle-keys/overlay_disabled on the Scope, plus
/// `active_profile`) and writes it directly into the current folder-owned executable shape.
mod legacy_v1 {
    use super::{Database as NewDatabase, Profile, Script, Settings, CURRENT_DB_VERSION};
    use serde::Deserialize;

    #[derive(Deserialize)]
    pub struct Database {
        #[serde(rename = "scopes", alias = "games", default)]
        pub games: Vec<Game>,
        #[serde(default)]
        pub settings: Settings,
    }

    #[derive(Deserialize)]
    pub struct Game {
        pub id: String,
        #[serde(default)]
        pub name: String,
        #[serde(default)]
        pub exe: String,
        #[serde(default)]
        pub image: Option<String>,
        #[serde(default)]
        pub active_profile: Option<String>,
        // Deserialized as the NEW Profile — the new fields simply default and are filled below.
        #[serde(default)]
        pub profiles: Vec<Profile>,
        #[serde(default)]
        pub overlay_disabled: bool,
        #[serde(default)]
        pub toggle_hotkeys_key: Option<String>,
        #[serde(default)]
        pub toggle_overlay_key: Option<String>,
        #[serde(default)]
        pub scripts: Vec<Script>,
    }

    pub fn migrate(legacy: Database) -> NewDatabase {
        let games = legacy
            .games
            .into_iter()
            .map(|g| {
                // Which profile ends up armed: the one that was active; or, for the old global
                // "*" scope (which had no active_profile but always ran its first profile via
                // sync_global_scope), the first profile — otherwise its hotkeys would go dead.
                let armed_id: Option<String> = match g.active_profile.clone() {
                    Some(id) => Some(id),
                    None if g.exe.trim() == "*" => g.profiles.first().map(|p| p.id.clone()),
                    None => None,
                };
                let profiles = g
                    .profiles
                    .into_iter()
                    .map(|mut p| {
                        p.overlay_disabled = g.overlay_disabled;
                        p.toggle_hotkeys_key = g.toggle_hotkeys_key.clone();
                        p.toggle_overlay_key = g.toggle_overlay_key.clone();
                        p.armed = armed_id.as_deref() == Some(p.id.as_str());
                        // Scope-wide scripts applied to every profile in the scope; give each
                        // profile its own copy with a unique id so they keep firing per-app.
                        p.scripts = g
                            .scripts
                            .iter()
                            .cloned()
                            .map(|mut s| {
                                s.id = format!("{}-{}", p.id, s.id);
                                s
                            })
                            .collect();
                        p
                    })
                    .collect();
                super::Game { states: Vec::new(), states_disabled: false, id: g.id, name: g.name, exe: g.exe, image: g.image, profiles }
            })
            .collect();
        NewDatabase { version: CURRENT_DB_VERSION, games, settings: legacy.settings }
    }
}

/// Profile state lists are accepted only as a legacy/import boundary. The folder
/// is the sole persisted owner, including when the importing profile is disabled.
pub fn normalize_states(db: &mut Database) -> bool {
    let mut changed = false;
    for game in &mut db.games {
        let mut ids = HashSet::new();
        game.states.retain(|state| { let keep = ids.insert(state.id.clone()); changed |= !keep; keep });
        for profile in &mut game.profiles {
            changed |= !profile.states.is_empty();
            for state in std::mem::take(&mut profile.states) {
                if ids.insert(state.id.clone()) { game.states.push(state); }
            }
        }
    }
    changed
}

/// Every part belongs to an overlay. Legacy standalone parts keep their identity,
/// coordinates and action references inside a container with no added offset.
pub fn normalize_overlays(db: &mut Database) -> bool {
    let mut changed = false;
    for game in &mut db.games {
        let mut visited = HashSet::new();
        let mut reserved: HashSet<String> = game.profiles.iter().flat_map(|profile|
            profile.overlay_groups.iter().map(|group| group.id.clone()).chain(profile.overlay_items.iter().map(overlay_item_id))
        ).collect();
        for index in 0..game.profiles.len() {
            changed |= normalize_profile_overlays(&mut game.profiles, index, &mut visited, &mut reserved);
        }
    }
    changed
}

fn normalize_profile_overlays(profiles: &mut [Profile], index: usize, visited: &mut HashSet<usize>, reserved: &mut HashSet<String>) -> bool {
    if !visited.insert(index) { return false; }
    let parent = profiles[index].parent_id.as_ref().and_then(|id| profiles.iter().position(|profile| &profile.id == id));
    let mut changed = parent.is_some_and(|parent| normalize_profile_overlays(profiles, parent, visited, reserved));
    let mut groups: HashSet<String> = resolve_profile_overlay_groups(profiles, &profiles[index]).iter().map(|group| group.id.clone()).collect();
    let inherited: HashMap<String, String> = parent.map(|parent| resolve_profile_overlay_items(profiles, &profiles[parent])).unwrap_or_default().iter().filter_map(|item| match item {
        OverlayItem::Timer { id, group_id: Some(group), .. } | OverlayItem::Icon { id, group_id: Some(group), .. }
        | OverlayItem::Bar { id, group_id: Some(group), .. } | OverlayItem::Text { id, group_id: Some(group), .. } => Some((id.clone(), group.clone())),
        _ => None,
    }).collect();
    let profile = &mut profiles[index];
    for item in &mut profile.overlay_items {
        let (id, name, group_id) = match item {
            OverlayItem::Timer { id, name, group_id, .. } | OverlayItem::Icon { id, name, group_id, .. }
            | OverlayItem::Bar { id, name, group_id, .. } | OverlayItem::Text { id, name, group_id, .. } => (id, name, group_id),
        };
        if group_id.as_ref().is_some_and(|id| groups.contains(id)) { continue; }
        if group_id.is_none() {
            if let Some(parent_group) = inherited.get(id.as_str()).filter(|id| groups.contains(id.as_str())) {
                *group_id = Some(parent_group.clone()); changed = true; continue;
            }
        }
        let container = group_id.clone().unwrap_or_else(|| {
            let mut candidate = format!("overlay:{id}");
            while reserved.contains(&candidate) { candidate.push('_'); }
            candidate
        });
        reserved.insert(container.clone());
        groups.insert(container.clone());
        profile.overlay_groups.push(OverlayGroup { id: container.clone(), name: if name.is_empty() { "Overlay".into() } else { name.clone() },
            disabled: false, x: 0.0, y: 0.0, layout: "free".into(), gap: default_group_gap(), visible_while_timer_id: None });
        *group_id = Some(container);
        changed = true;
    }
    changed
}

pub fn save_db(path: &Path, db: &Database) -> Result<(), String> {
    // Stamp the current version on every write so a fresh default or any caller's db is
    // correctly versioned and never re-migrates on the next load.
    let mut db = db.clone();
    normalize_states(&mut db);
    normalize_overlays(&mut db);
    db.version = CURRENT_DB_VERSION;
    let content = serde_json::to_string_pretty(&db).map_err(|e| e.to_string())?;
    // Write to a temp file then rename, so an interrupted write can't corrupt db.json.
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp);
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
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

pub fn resolve_profile_events<'a>(profiles: &'a [Profile], profile: &'a Profile) -> Vec<&'a BehaviorEvent> {
    let mut visited = HashSet::new();
    resolve_profile_entries(
        profiles,
        profile,
        |current| current.events.as_slice(),
        |event| event.event.clone(),
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

pub fn resolve_profile_overlay_groups<'a>(profiles: &'a [Profile], profile: &'a Profile) -> Vec<&'a OverlayGroup> {
    resolve_profile_entries(profiles, profile, |current| current.overlay_groups.as_slice(), |group| group.id.clone(), &mut HashSet::new())
}

pub fn profile_has_overlay(profiles: &[Profile], profile: &Profile) -> bool {
    !profile.overlay_disabled && !resolve_profile_overlay_items(profiles, profile).is_empty()
}

#[cfg(test)]
mod tests {
    use super::{legacy_v2, load_db, resolve_profile_events, Hotkey, Profile};

    #[test]
    fn overlay_groups_and_direct_timer_visibility_round_trip_with_legacy_defaults() {
        let profile: Profile = serde_json::from_value(serde_json::json!({
            "id":"all", "name":"All", "kind":"hotkeys",
            "overlay_groups":[{"id":"group","name":"Buff"}],
            "overlay_items":[{"type":"icon","id":"icon","x":0,"y":0,"w":32,"h":32,"src":null,
                "group_id":"group","visible_while_timer_id":"timer"}]
        })).unwrap();
        assert_eq!(profile.overlay_groups[0].layout, "free");
        assert_eq!(profile.overlay_groups[0].gap, 8);
        assert_eq!(profile.overlay_groups[0].x, 0.0);
        let data = serde_json::to_value(&profile).unwrap();
        assert_eq!(data["overlay_items"][0]["visible_while_timer_id"], "timer");
        assert!(super::profile_has_overlay(std::slice::from_ref(&profile), &profile));
    }

    #[test]
    fn standalone_parts_gain_containers_without_changing_their_ids_positions_or_actions() {
        let mut db: super::Database = serde_json::from_value(serde_json::json!({"scopes":[{"id":"folder","name":"Folder","profiles":[
            {"id":"profile","name":"Profile","hotkeys":[{"trigger":"e","behavior":"restartoverlay(timer)"}],
             "overlay_items":[{"type":"timer","id":"timer","name":"Buff","x":25,"y":70,"duration_ms":5000}]}
        ]}],"settings":{"ahk_exe":""}})).unwrap();
        assert!(super::normalize_overlays(&mut db));
        let profile = &db.games[0].profiles[0];
        let group = &profile.overlay_groups[0];
        assert_eq!(group.name, "Buff"); assert_eq!(group.layout, "free");
        assert_eq!((group.x, group.y), (0.0, 0.0));
        let part = serde_json::to_value(&profile.overlay_items[0]).unwrap();
        assert_eq!(part["id"], "timer"); assert_eq!(part["x"].as_f64(), Some(25.0)); assert_eq!(part["y"].as_f64(), Some(70.0));
        assert_eq!(part["group_id"], group.id); assert_eq!(profile.hotkeys[0].behavior, "restartoverlay(timer)");
        assert!(!super::normalize_overlays(&mut db));
    }

    #[test]
    fn normalization_respects_inherited_containers_even_when_children_are_stored_first() {
        let mut db: super::Database = serde_json::from_value(serde_json::json!({"scopes":[{"id":"folder","name":"Folder","profiles":[
            {"id":"child","name":"Child","parent_id":"base","overlay_items":[{"type":"timer","id":"timer","x":40,"y":50,"duration_ms":10000}]},
            {"id":"base","name":"Base","overlay_items":[{"type":"timer","id":"timer","x":10,"y":20,"duration_ms":5000}]}
        ]}],"settings":{"ahk_exe":""}})).unwrap();
        assert!(super::normalize_overlays(&mut db));
        let profiles = &db.games[0].profiles;
        assert!(profiles[0].overlay_groups.is_empty());
        let group = &profiles[1].overlay_groups[0];
        let child = serde_json::to_value(&profiles[0].overlay_items[0]).unwrap();
        assert_eq!(child["group_id"], group.id);
        assert_eq!(super::resolve_profile_overlay_groups(profiles, &profiles[0]).len(), 1);
        assert!(!super::normalize_overlays(&mut db));
    }

    #[test]
    fn normalization_keeps_explicit_membership_and_recovers_missing_container_definitions() {
        let mut db: super::Database = serde_json::from_value(serde_json::json!({"scopes":[{"id":"folder","name":"Folder","profiles":[
            {"id":"profile","name":"Profile","overlay_groups":[{"id":"existing","name":"Existing","layout":"column"}],
             "overlay_items":[{"type":"text","id":"text","group_id":"existing","x":0,"y":0,"font_size":16,"color":"#fff","content":"Label"},
                 {"type":"timer","id":"timer","group_id":"missing","x":0,"y":0,"duration_ms":5000},
                 {"type":"timer","id":"other","group_id":"missing","x":0,"y":0,"duration_ms":5000}]}
        ]}],"settings":{"ahk_exe":""}})).unwrap();
        assert!(super::normalize_overlays(&mut db));
        let profile = &db.games[0].profiles[0];
        assert_eq!(profile.overlay_groups.len(), 2);
        assert_eq!(profile.overlay_groups[0].layout, "column");
        assert_eq!(profile.overlay_groups[1].id, "missing");
        assert!(!super::normalize_overlays(&mut db));
    }

    #[test]
    fn legacy_profile_states_move_to_one_folder_definition_even_when_disabled() {
        let mut db: super::Database = serde_json::from_value(serde_json::json!({"scopes":[{"id":"folder","name":"Folder","profiles":[
            {"id":"one","name":"One","states":[{"id":"buff","name":"Buff","duration_ms":1000}]},
            {"id":"two","name":"Two","states":[{"id":"buff","name":"Buff","duration_ms":2000},{"id":"other","name":"Other"}]}
        ]}],"settings":{"ahk_exe":""}})).unwrap();
        assert!(super::normalize_states(&mut db));
        assert_eq!(db.games[0].states.len(), 2);
        assert_eq!(db.games[0].states[0].duration_ms, Some(1000));
        assert!(db.games[0].profiles.iter().all(|profile| profile.states.is_empty()));
        assert!(!super::normalize_states(&mut db));
    }

    #[test]
    fn v4_settings_are_backed_up_before_folder_state_migration() {
        let path = std::env::temp_dir().join(format!("macrotoolbox-v4-{}.json", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let source = serde_json::json!({"version":4,"scopes":[{"id":"folder","name":"Folder","profiles":[{"id":"keys","name":"Keys","states":[{"id":"buff","name":"Buff"}]}]}],"settings":{"ahk_exe":""}}).to_string();
        std::fs::write(&path, &source).unwrap();
        let migrated = load_db(&path).unwrap();
        assert_eq!(migrated.version, super::CURRENT_DB_VERSION);
        assert_eq!(migrated.games[0].states[0].id, "buff");
        let backup = std::path::PathBuf::from(format!("{}.v4.bak", path.display()));
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), source);
        std::fs::remove_file(&path).unwrap(); std::fs::remove_file(backup).unwrap();
    }

    #[test]
    fn timer_background_preserves_legacy_appearance_and_round_trips_both_options() {
        let mut value = serde_json::json!({
            "type": "timer", "id": "timer", "x": 0, "y": 0, "duration_ms": 10000
        });
        let legacy: super::OverlayItem = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(legacy).unwrap()["show_background"], true);
        for show_background in [false, true] {
            value["show_background"] = serde_json::json!(show_background);
            let timer: super::OverlayItem = serde_json::from_value(value.clone()).unwrap();
            let saved = serde_json::to_value(timer).unwrap();
            assert_eq!(saved["show_background"], show_background);
            let reloaded: super::OverlayItem = serde_json::from_value(saved).unwrap();
            assert_eq!(serde_json::to_value(reloaded).unwrap()["show_background"], show_background);
        }
    }

    #[test]
    fn timer_start_with_overlay_defaults_off_and_round_trips() {
        let mut value = serde_json::json!({
            "type": "timer", "id": "timer", "x": 0, "y": 0, "duration_ms": 10000
        });
        let legacy: super::OverlayItem = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(legacy).unwrap()["start_with_overlay"], false);
        value["start_with_overlay"] = serde_json::json!(true);
        let enabled: super::OverlayItem = serde_json::from_value(value).unwrap();
        let saved = serde_json::to_value(enabled).unwrap();
        assert_eq!(saved["start_with_overlay"], true);
        let reloaded: super::OverlayItem = serde_json::from_value(saved).unwrap();
        assert_eq!(serde_json::to_value(reloaded).unwrap()["start_with_overlay"], true);
    }

    #[test]
    fn running_only_timer_visibility_preserves_legacy_defaults_and_round_trips() {
        let mut value = serde_json::json!({
            "type": "timer", "id": "timer", "x": 0, "y": 0, "duration_ms": 10000
        });
        let legacy: super::OverlayItem = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(legacy).unwrap()["show_only_running"], false);
        value["show_only_running"] = serde_json::json!(true);
        let enabled: super::OverlayItem = serde_json::from_value(value).unwrap();
        let saved = serde_json::to_value(enabled).unwrap();
        let reloaded: super::OverlayItem = serde_json::from_value(saved).unwrap();
        assert_eq!(serde_json::to_value(reloaded).unwrap()["show_only_running"], true);
    }

    #[test]
    fn hotkey_extra_modifier_option_is_optional_and_round_trips() {
        let legacy = serde_json::json!({ "trigger": "1", "behavior": "press(2)" });
        let old: Hotkey = serde_json::from_value(legacy.clone()).unwrap();
        assert_eq!(old.allow_extra_modifiers, None);
        assert!(serde_json::to_value(&old).unwrap().get("allow_extra_modifiers").is_none());
        for allow in [false, true] {
            let mut value = legacy.clone();
            value["allow_extra_modifiers"] = serde_json::json!(allow);
            let hotkey: Hotkey = serde_json::from_value(value).unwrap();
            assert_eq!(hotkey.allow_extra_modifiers, Some(allow));
            let saved = serde_json::to_value(&hotkey).unwrap();
            assert_eq!(saved["allow_extra_modifiers"], serde_json::json!(allow));
            let copied: Hotkey = serde_json::from_value(saved).unwrap();
            assert_eq!(copied.allow_extra_modifiers, Some(allow));
        }
    }

    #[test]
    fn v3_database_adds_empty_events_and_advances_the_schema() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("macrotoolbox-v3-{unique}.json"));
        std::fs::write(&path, serde_json::json!({
            "version": 3,
            "scopes": [{
                "id": "games",
                "name": "Games",
                "exe": "Game.exe",
                "profiles": [{ "id": "profile", "name": "Profile" }]
            }],
            "settings": { "ahk_exe": "" }
        }).to_string()).unwrap();

        let migrated = load_db(&path).unwrap();

        assert_eq!(migrated.version, super::CURRENT_DB_VERSION);
        assert!(migrated.games[0].profiles[0].events.is_empty());
        assert!(path.with_extension("json.v3.bak").exists());
        let _ = std::fs::remove_file(path.with_extension("json.v3.bak"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn v2_migration_splits_multi_target_folders_and_preserves_inheritance() {
        let legacy: legacy_v2::Database = serde_json::from_value(serde_json::json!({
            "version": 2,
            "scopes": [{
                "id": "games",
                "name": "Games",
                "profiles": [{
                    "id": "base",
                    "name": "Base",
                    "exe": "First.exe",
                    "hotkeys": [{ "trigger": "f1", "behavior": "press(1)" }]
                }, {
                    "id": "child",
                    "name": "Child",
                    "exe": "Second.exe",
                    "parent_id": "base"
                }]
            }]
        })).unwrap();

        let migrated = legacy_v2::migrate(legacy);

        assert_eq!(migrated.version, super::CURRENT_DB_VERSION);
        assert_eq!(migrated.games.len(), 2);
        assert_eq!(migrated.games[0].exe, "First.exe");
        assert_eq!(migrated.games[1].exe, "Second.exe");
        let child = &migrated.games[1].profiles[0];
        assert_eq!(child.parent_id, None);
        assert!(matches!(child.hotkeys.as_slice(), [Hotkey { trigger, behavior, .. }]
            if trigger == "f1" && behavior == "press(1)"));
    }

    #[test]
    fn event_inheritance_overrides_by_event_kind() {
        let profiles: Vec<Profile> = serde_json::from_value(serde_json::json!([{
            "id": "base",
            "name": "Base",
            "kind": "events",
            "events": [
                { "event": "app_started", "behavior": "borderless" },
                { "event": "focus_gained", "behavior": "press(F5)" }
            ]
        }, {
            "id": "child",
            "name": "Child",
            "kind": "events",
            "parent_id": "base",
            "events": [{ "event": "focus_gained", "behavior": "press(F6)" }]
        }])).unwrap();

        let resolved = resolve_profile_events(&profiles, &profiles[1]);

        assert_eq!(resolved.len(), 2);
        assert_eq!(resolved[0].event, "app_started");
        assert_eq!(resolved[0].behavior, "borderless");
        assert_eq!(resolved[1].event, "focus_gained");
        assert_eq!(resolved[1].behavior, "press(F6)");
    }
}
