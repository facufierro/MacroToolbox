use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// The db.json schema version. Bumped when the shape changes so `load_db` can migrate
/// older files. v10 stores Start/Stop overlay selections as target lists.
pub const CURRENT_DB_VERSION: u32 = 10;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Database {
    #[serde(default)]
    pub version: u32,
    #[serde(rename = "scopes", alias = "games")]
    pub games: Vec<Game>,
    pub settings: Settings,
    #[serde(default)]
    pub variables: Vec<Variable>,
}

pub use crate::variables::Variable;

pub fn validate_variables(variables: &[Variable]) -> Result<(), String> {
    crate::variables::validate_variables(variables)?;
    crate::behavior::validate_variable_behaviors(variables)
}

impl Database {
    pub fn move_hotkey(
        &mut self, source_game_id: &str, source_profile_id: &str, source_index: usize,
        expected: &Hotkey, target_game_id: &str, dependencies: Profile,
    ) -> Result<(), String> {
        if source_game_id == target_game_id && source_profile_id == dependencies.id { return Err("Choose a different profile.".into()); }
        let source = self.games.iter().find(|game| game.id == source_game_id)
            .and_then(|game| game.profiles.iter().find(|profile| profile.id == source_profile_id)).ok_or("Source profile not found.")?;
        if source.hotkeys.get(source_index) != Some(expected) { return Err("The dragged behavior changed. Drag it again.".into()); }
        let target = self.games.iter().find(|game| game.id == target_game_id)
            .and_then(|game| game.profiles.iter().find(|profile| profile.id == dependencies.id)).ok_or("Target profile not found.")?;
        let assigned = !matches!(&expected.trigger, crate::triggers::Trigger::Literal(value) if value.trim().is_empty());
        if assigned && target.hotkeys.iter().any(|hotkey| hotkey.trigger == expected.trigger) {
            return Err("The target profile already has this hotkey trigger.".into());
        }
        // Both owners are validated before either changes; save_database persists the move once.
        let source = self.games.iter_mut().find(|game| game.id == source_game_id).unwrap()
            .profiles.iter_mut().find(|profile| profile.id == source_profile_id).unwrap();
        let hotkey = source.hotkeys.remove(source_index);
        let game = self.games.iter_mut().find(|game| game.id == target_game_id).unwrap();
        game.profiles.iter_mut().find(|profile| profile.id == dependencies.id).unwrap().hotkeys.push(hotkey);
        game.merge_profile_dependencies(dependencies);
        Ok(())
    }

    pub fn move_overlay(
        &mut self, source_game_id: &str, source_profile_id: &str, selection: &OverlaySelection,
        target_game_id: &str, dependencies: Profile, target_group_id: Option<&str>,
    ) -> Result<(), String> {
        let origin = self.games.iter().find(|game| game.id == source_game_id).ok_or("Source folder not found.")?;
        let source = origin.profiles.iter().find(|profile| profile.id == source_profile_id).ok_or("Source profile not found.")?;
        let same_profile = source_game_id == target_game_id && source_profile_id == dependencies.id;
        let (mut group, mut items) = match selection {
            OverlaySelection::Overlay { group, items } => {
                if same_profile || target_group_id.is_some() { return Err("Choose a different profile.".into()); }
                let current: Vec<_> = resolve_profile_overlay_items(&origin.profiles, source).into_iter()
                    .filter(|item| item.group_id() == Some(group.id.as_str())).cloned().collect();
                if source.overlay_groups.iter().find(|candidate| candidate.id == group.id) != Some(group) || &current != items {
                    return Err("The dragged overlay changed. Drag it again.".into());
                }
                (Some(group.clone()), current)
            }
            OverlaySelection::OverlayPart { item } => {
                if source.overlay_items.iter().find(|candidate| overlay_item_id(candidate) == overlay_item_id(item)) != Some(item) {
                    return Err("The dragged overlay part changed. Drag it again.".into());
                }
                if same_profile && (target_group_id.is_none() || item.group_id() == target_group_id) {
                    return Err("Choose a different overlay destination.".into());
                }
                let group = resolve_profile_overlay_groups(&origin.profiles, source).into_iter()
                    .find(|group| Some(group.id.as_str()) == item.group_id()).cloned().ok_or("Overlay not found.")?;
                (Some(group), vec![item.clone()])
            }
        };
        let destination = self.games.iter().find(|game| game.id == target_game_id).ok_or("Target folder not found.")?;
        let target = destination.profiles.iter().find(|profile| profile.id == dependencies.id).ok_or("Target profile not found.")?;
        let target_groups = resolve_profile_overlay_groups(&destination.profiles, target);
        if let Some(id) = target_group_id {
            if !target_groups.iter().any(|group| group.id == id) { return Err("Target overlay not found.".into()); }
            for item in &mut items { item.set_group_id(id); }
            group = None;
        } else if matches!(selection, OverlaySelection::Overlay { .. }) {
            if target.overlay_groups.iter().any(|existing| group.as_ref().is_some_and(|group| group.id == existing.id)) {
                return Err("The target profile already has this overlay.".into());
            }
        } else if target_groups.iter().any(|existing| group.as_ref().is_some_and(|group| group.id == existing.id)) {
            group = None;
        }
        if !same_profile && target.overlay_items.iter()
            .any(|existing| items.iter().any(|item| overlay_item_id(item) == overlay_item_id(existing))) {
            return Err("The target profile already has an overlay part with this ID.".into());
        }
        let ids: HashSet<_> = items.iter().map(overlay_item_id).collect();
        // Validate the complete selection and destination before changing either owner.
        let source = self.games.iter_mut().find(|game| game.id == source_game_id).unwrap()
            .profiles.iter_mut().find(|profile| profile.id == source_profile_id).unwrap();
        if let OverlaySelection::Overlay { group, .. } = selection { source.overlay_groups.retain(|candidate| candidate.id != group.id); }
        source.overlay_items.retain(|item| !ids.contains(&overlay_item_id(item)));
        let destination = self.games.iter_mut().find(|game| game.id == target_game_id).unwrap();
        let target = destination.profiles.iter_mut().find(|profile| profile.id == dependencies.id).unwrap();
        if let Some(group) = group { target.overlay_groups.push(group); }
        target.overlay_items.extend(items);
        destination.merge_profile_dependencies(dependencies);
        Ok(())
    }

    pub fn reorder_folders(&mut self, ids: &[String]) -> Result<(), String> {
        let order: HashMap<_, _> = ids.iter().enumerate().map(|(index, id)| (id.as_str(), index)).collect();
        if ids.len() != self.games.len() || order.len() != ids.len()
            || self.games.iter().any(|game| !order.contains_key(game.id.as_str())) {
            return Err("Folder list changed. Try moving the folder again.".into());
        }
        self.games.sort_by_key(|game| order[game.id.as_str()]);
        Ok(())
    }
}

fn append_missing<T>(target: &mut Vec<T>, incoming: Vec<T>, key: fn(&T) -> String) {
    for value in incoming {
        if !target.iter().any(|existing| key(existing) == key(&value)) { target.push(value); }
    }
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
    #[serde(default)]
    pub subfolders: Vec<Subfolder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subfolder {
    pub id: String,
    pub name: String,
    #[serde(default = "default_subfolder_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub toggle_key: Option<String>,
}

fn default_subfolder_enabled() -> bool { true }

impl Game {
    fn merge_profile_dependencies(&mut self, mut dependencies: Profile) {
        append_missing(&mut self.states, dependencies.states, |state| state.id.clone());
        // Definitions already available in the destination folder keep their current owner.
        dependencies.scripts.retain(|script| !self.profiles.iter().any(|profile| profile.scripts.iter().any(|existing| existing.id == script.id)));
        dependencies.overlay_items.retain(|item| !self.profiles.iter().any(|profile| profile.overlay_items.iter().any(|existing| overlay_item_id(existing) == overlay_item_id(item))));
        dependencies.overlay_groups.retain(|group| !self.profiles.iter().any(|profile| profile.overlay_groups.iter().any(|existing| existing.id == group.id)));
        let target = self.profiles.iter_mut().find(|profile| profile.id == dependencies.id).unwrap();
        append_missing(&mut target.scripts, dependencies.scripts, |script| script.id.clone());
        append_missing(&mut target.overlay_items, dependencies.overlay_items, overlay_item_id);
        append_missing(&mut target.overlay_groups, dependencies.overlay_groups, |group| group.id.clone());
    }

    /// Subfolder activation gates a profile without changing its own armed state.
    pub fn profile_enabled(&self, profile: &Profile) -> bool {
        profile.subfolder_id.as_ref().map(|id| self.subfolders.iter().any(|folder| &folder.id == id && folder.enabled)).unwrap_or(true)
    }

    pub fn validate_subfolders(&self) -> Result<(), String> {
        let mut ids = HashSet::new();
        if self.subfolders.iter().any(|folder| folder.id.trim().is_empty() || folder.name.trim().is_empty() || !ids.insert(folder.id.as_str())) {
            return Err("Invalid or duplicate subfolder.".into());
        }
        if self.profiles.iter().any(|profile| profile.subfolder_id.as_deref().is_some_and(|id| !ids.contains(id))) {
            return Err("Profile subfolder not found.".into());
        }
        Ok(())
    }

    pub fn set_subfolder_enabled(&mut self, id: &str, enabled: bool) -> Result<(), String> {
        self.subfolders.iter_mut().find(|folder| folder.id == id).ok_or("Subfolder not found.")?.enabled = enabled;
        Ok(())
    }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subfolder_id: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

impl OverlayItem {
    fn group_id(&self) -> Option<&str> {
        match self {
            Self::Timer { group_id, .. } | Self::Icon { group_id, .. }
            | Self::Bar { group_id, .. } | Self::Text { group_id, .. } => group_id.as_deref(),
        }
    }

    fn set_group_id(&mut self, id: &str) {
        match self {
            Self::Timer { group_id, .. } | Self::Icon { group_id, .. }
            | Self::Bar { group_id, .. } | Self::Text { group_id, .. } => *group_id = Some(id.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OverlaySelection {
    Overlay { group: OverlayGroup, items: Vec<OverlayItem> },
    OverlayPart { item: OverlayItem },
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Hotkey {
    #[serde(default)]
    pub name: String,
    pub trigger: crate::triggers::Trigger,
    pub behavior: String,
    /// Missing values preserve legacy matching for literal triggers: unmodified keys accept
    /// held modifiers. Trigger lists require the configured modifier combination exactly.
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
            states: Vec::new(), states_disabled: false, subfolders: Vec::new(),
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
    let merged_subfolders = indices.iter().flat_map(|&i| db.games[i].subfolders.clone()).collect();
    db.games[keep].profiles = merged;
    db.games[keep].states = merged_states;
    db.games[keep].subfolders = merged_subfolders;
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
        // These versions share the folder-owned profile shape. Defaults, typed
        // variable deserialization, and normalization below upgrade their fields.
        3..=9 => {
            let mut db: Database = serde_json::from_value(value).map_err(|e| e.to_string())?;
            db.version = CURRENT_DB_VERSION;
            (db, true)
        }
        2 => {
            let legacy: legacy_v2::Database = serde_json::from_value(value).map_err(|e| e.to_string())?;
            (legacy_v2::migrate(legacy), true)
        }
        _ => {
            let legacy: legacy_v1::Database = serde_json::from_value(value).map_err(|e| e.to_string())?;
            (legacy_v1::migrate(legacy), true)
        }
    };

    let upgraded_behaviors = normalize_behaviors(&mut db)?;
    if migrated || upgraded_behaviors {
        let mut backup = path.as_os_str().to_owned();
        backup.push(format!(".v{}.bak", version.max(1)));
        std::fs::copy(path, std::path::Path::new(&backup))
            .map_err(|e| format!("Could not back up settings: {e}"))?;
    }

    // Self-heal the always-present global folder, then persist only when something changed.
    let added_global = ensure_global_folder(&mut db);
    let moved_states = normalize_states(&mut db);
    let grouped_overlays = normalize_overlays(&mut db);
    for game in &db.games { game.validate_subfolders()?; }
    if migrated || upgraded_behaviors || added_global || moved_states || grouped_overlays {
        save_db(path, &db)?;
    }
    Ok(db)
}

pub fn normalize_behaviors(db: &mut Database) -> Result<bool, String> {
    fn upgrade(source: &mut String) -> Result<bool, String> {
        if let Some(upgraded) = crate::behavior::upgrade_legacy_actions(source)? { *source = upgraded; return Ok(true); }
        Ok(false)
    }
    let mut changed = false;
    for game in &mut db.games {
        for profile in &mut game.profiles {
            for hotkey in &mut profile.hotkeys { changed |= upgrade(&mut hotkey.behavior)?; }
            for event in &mut profile.events { changed |= upgrade(&mut event.behavior)?; }
        }
    }
    for variable in &mut db.variables {
        if let crate::variables::VariableValue::Behavior(source) = &mut variable.value { changed |= upgrade(source)?; }
    }
    Ok(changed)
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
                    states: Vec::new(), states_disabled: false, subfolders: Vec::new(),
                    id: game.id.clone(),
                    name: game.name.clone(),
                    exe: "*".to_string(),
                    image: game.image.clone(),
                    profiles: global_profiles,
                });
                for (index, (exe, profiles)) in groups.into_iter().enumerate() {
                    games.push(NewGame {
                        states: Vec::new(), states_disabled: false, subfolders: Vec::new(),
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
                    states: Vec::new(), states_disabled: false, subfolders: Vec::new(),
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
                    states: Vec::new(), states_disabled: false, subfolders: Vec::new(),
                    id,
                    name,
                    exe,
                    image: game.image.clone(),
                    profiles,
                });
            }
        }

        NewDatabase { version: CURRENT_DB_VERSION, games, settings: legacy.settings, variables: Vec::new() }
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
                super::Game { states: Vec::new(), states_disabled: false, subfolders: Vec::new(), id: g.id, name: g.name, exe: g.exe, image: g.image, profiles }
            })
            .collect();
        NewDatabase { version: CURRENT_DB_VERSION, games, settings: legacy.settings, variables: Vec::new() }
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
    normalize_behaviors(&mut db)?;
    normalize_states(&mut db);
    normalize_overlays(&mut db);
    for game in &db.games { game.validate_subfolders()?; }
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
    key_of: fn(&T) -> Option<K>,
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
        if let Some(slot) = resolved.iter_mut().find(|entry| key.is_some() && key_of(*entry) == key) {
            *slot = value;
        } else {
            resolved.push(value);
        }
    }

    // Owned entries fill their existing slots in saved order; inherited entries keep theirs.
    let owned = select(profile);
    let own_index = |entry: &T| owned.iter().position(|value| std::ptr::eq(value, entry));
    let mut ordered: Vec<_> = resolved.iter().copied().filter(|entry| own_index(entry).is_some()).collect();
    ordered.sort_by_key(|entry| own_index(entry));
    let mut ordered = ordered.into_iter();
    for slot in &mut resolved {
        if own_index(slot).is_some() { *slot = ordered.next().unwrap(); }
    }
    resolved
}

pub fn resolve_profile_hotkeys<'a>(profiles: &'a [Profile], profile: &'a Profile) -> Vec<&'a Hotkey> {
    let mut visited = HashSet::new();
    resolve_profile_entries(
        profiles,
        profile,
        |current| current.hotkeys.as_slice(),
        // Unassigned copies do not override one another or inherited drafts.
        |hotkey| match &hotkey.trigger {
            crate::triggers::Trigger::Literal(trigger) if trigger.trim().is_empty() => None,
            trigger => Some(trigger.clone()),
        },
        &mut visited,
    )
}

pub fn resolve_profile_events<'a>(profiles: &'a [Profile], profile: &'a Profile) -> Vec<&'a BehaviorEvent> {
    let mut visited = HashSet::new();
    resolve_profile_entries(
        profiles,
        profile,
        |current| current.events.as_slice(),
        |event| Some(event.event.clone()),
        &mut visited,
    )
}

pub fn resolve_profile_states<'a>(profiles: &'a [Profile], profile: &'a Profile) -> Vec<&'a ProfileState> {
    let mut visited = HashSet::new();
    resolve_profile_entries(
        profiles,
        profile,
        |current| current.states.as_slice(),
        |state| Some(state.id.clone()),
        &mut visited,
    )
}

pub fn resolve_profile_overlay_items<'a>(profiles: &'a [Profile], profile: &'a Profile) -> Vec<&'a OverlayItem> {
    let mut visited = HashSet::new();
    resolve_profile_entries(
        profiles,
        profile,
        |current| current.overlay_items.as_slice(),
        |item| Some(overlay_item_id(item)),
        &mut visited,
    )
}

pub fn resolve_profile_overlay_groups<'a>(profiles: &'a [Profile], profile: &'a Profile) -> Vec<&'a OverlayGroup> {
    resolve_profile_entries(profiles, profile, |current| current.overlay_groups.as_slice(), |group| Some(group.id.clone()), &mut HashSet::new())
}

pub fn profile_has_overlay(profiles: &[Profile], profile: &Profile) -> bool {
    !profile.overlay_disabled && !resolve_profile_overlay_items(profiles, profile).is_empty()
}

#[cfg(test)]
mod tests {
    use super::{legacy_v2, load_db, resolve_profile_events, Hotkey, Profile};

    #[test]
    fn overlay_selections_upgrade_across_versions_and_reopen_without_rewriting() {
        for version in [3, 8, 9] {
            let path = std::env::temp_dir().join(format!("macrotoolbox-overlay-targets-{version}-{}.json",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
            let behavior = serde_json::json!([{"type":"sequence","steps":[{"type":"waitfor","key":"LButton"},
                {"type":"startoverlay","itemId":"first","restart":true},{"type":"stopoverlay","itemIds":["first","second"]}]}]).to_string();
            let source = serde_json::json!({"version":version,"settings":{"ahk_exe":"ahk.exe"},
                "variables":[{"id":"shared","name":"Shared","type":"behavior","value":"stopoverlay(second);restartoverlay(first)"}],
                "scopes":[{"id":"global","name":"Global","exe":"*"},{"id":"game","name":"Game","exe":"game.exe",
                    "subfolders":[{"id":"group","name":"Group","enabled":false}],
                    "profiles":[{"id":"p","name":"P","armed":true,"subfolder_id":"group","hotkeys":[{"trigger":"q","behavior":behavior}],
                        "events":[{"event":"focus_gained","behavior":"startoverlay(first)"}],
                        "overlay_groups":[{"id":"first","name":"First"},{"id":"second","name":"Second"}]}]}]}).to_string();
            std::fs::write(&path,&source).unwrap();
            let db = load_db(&path).unwrap();
            let profile = &db.games[1].profiles[0];
            let upgraded: serde_json::Value = serde_json::from_str(&profile.hotkeys[0].behavior).unwrap();
            assert_eq!(upgraded[0]["steps"],serde_json::json!([
                {"type":"waitfor"},{"type":"mousepress","key":"LButton"},
                {"type":"startoverlay","itemIds":["first"],"restart":true},{"type":"stopoverlay","itemIds":["first","second"]}]));
            let event: serde_json::Value = serde_json::from_str(&profile.events[0].behavior).unwrap();
            assert_eq!(event[0]["itemIds"],serde_json::json!(["first"]));
            let crate::variables::VariableValue::Behavior(shared) = &db.variables[0].value else { panic!("wrong variable type"); };
            let shared: serde_json::Value = serde_json::from_str(shared).unwrap();
            assert_eq!(shared[0]["itemIds"],serde_json::json!(["second"]));
            assert_eq!(shared[1]["itemIds"],serde_json::json!(["first"]));
            assert_eq!(profile.subfolder_id.as_deref(),Some("group"));
            assert!(profile.armed); assert!(!db.games[1].subfolders[0].enabled);
            assert_eq!(profile.overlay_groups.len(),2);
            let backup = std::path::PathBuf::from(format!("{}.v{version}.bak",path.display()));
            assert_eq!(std::fs::read_to_string(&backup).unwrap(),source);
            let saved = std::fs::read(&path).unwrap();
            let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
            load_db(&path).unwrap();
            assert_eq!(std::fs::read(&path).unwrap(),saved);
            assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(),modified);
            assert_eq!(std::fs::read_to_string(&backup).unwrap(),source);
            std::fs::remove_file(path).unwrap(); std::fs::remove_file(backup).unwrap();
        }
    }

    #[test]
    fn invalid_overlay_migration_leaves_original_settings_intact() {
        let path = std::env::temp_dir().join(format!("macrotoolbox-overlay-targets-failure-{}.json",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let source = serde_json::json!({"version":9,"settings":{"ahk_exe":""},"scopes":[{"id":"game","name":"Game","profiles":[{
            "id":"p","name":"P","hotkeys":[{"trigger":"q","behavior":"[{\"type\":\"startoverlay\",\"itemIds\":[\"a\"],\"itemId\":\"b\"}]"}]}]}]}).to_string();
        std::fs::write(&path,&source).unwrap();
        assert!(load_db(&path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(),source);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn legacy_waits_upgrade_with_backup_across_skipped_versions_and_reopen_unchanged() {
        for version in [3,5,7,8] {
            let path = std::env::temp_dir().join(format!("macrotoolbox-waits-{version}-{}.json",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
            let hotkey = serde_json::json!([
                {"type":"sequence","steps":[{"type":"waitfor","key":{"variable":"keys"}},
                    {"type":"securesend","credentialId":"b8483943-e86c-41aa-a593-7388833369cd"}]}
            ]).to_string();
            let source = serde_json::json!({"version":version,"settings":{"ahk_exe":"ahk.exe"},
                "variables":[{"id":"keys","name":"Keys","type":"keys","value":"rctrl LButton"},
                    {"id":"shared","name":"Shared","type":"behavior","value":"waitfor(LButton);send(done)"}],
                "scopes":[{"id":"global","name":"Global","exe":"*"},{"id":"game","name":"Game","exe":"game.exe",
                    "subfolders":[{"id":"group","name":"Group","enabled":false,"toggle_key":"rctrl n"}],
                    "profiles":[{"id":"profile","name":"Profile","armed":true,"subfolder_id":"group",
                        "hotkeys":[{"trigger":"q","behavior":hotkey}],"events":[{"event":"focus_gained","behavior":"waitfor(rctrl x);send(event)"}]}]}]
            }).to_string();
            std::fs::write(&path,&source).unwrap();
            let upgraded = load_db(&path).unwrap();
            let backup = std::path::PathBuf::from(format!("{}.v{version}.bak",path.display()));
            assert_eq!(std::fs::read_to_string(&backup).unwrap(),source);
            assert_eq!(upgraded.version,super::CURRENT_DB_VERSION);
            let profile = &upgraded.games[1].profiles[0];
            let steps: serde_json::Value = serde_json::from_str(&profile.hotkeys[0].behavior).unwrap();
            assert_eq!(steps[0]["steps"][0],serde_json::json!({"type":"waitfor"}));
            assert_eq!(steps[0]["steps"][1],serde_json::json!({"type":"press","key":{"variable":"keys"}}));
            assert_eq!(steps[0]["steps"][2]["credentialId"],"b8483943-e86c-41aa-a593-7388833369cd");
            assert_eq!(profile.subfolder_id.as_deref(),Some("group"));
            assert!(profile.armed); assert!(!upgraded.games[1].subfolders[0].enabled);
            let event: serde_json::Value = serde_json::from_str(&profile.events[0].behavior).unwrap();
            assert_eq!(event[1],serde_json::json!({"type":"press","key":"rctrl x"}));
            let shared = match &upgraded.variables[1].value { crate::variables::VariableValue::Behavior(value) => value, _ => panic!("wrong variable type") };
            assert_eq!(serde_json::from_str::<serde_json::Value>(shared).unwrap()[1],serde_json::json!({"type":"mousepress","key":"LButton"}));
            let saved = std::fs::read(&path).unwrap();
            let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
            load_db(&path).unwrap();
            assert_eq!(std::fs::read(&path).unwrap(),saved);
            assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(),modified);
            assert_eq!(std::fs::read_to_string(&backup).unwrap(),source);
            std::fs::remove_file(path).unwrap(); std::fs::remove_file(backup).unwrap();
        }
    }

    #[test]
    fn failed_wait_upgrade_leaves_original_settings_untouched() {
        let path = std::env::temp_dir().join(format!("macrotoolbox-waits-failure-{}.json",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let source = serde_json::json!({"version":8,"settings":{"ahk_exe":""},"scopes":[{"id":"game","name":"Game","profiles":[{
            "id":"p","name":"P","hotkeys":[{"trigger":"q","behavior":"[{\"type\":\"waitfor\",\"key\":4}]"}]}]}]}).to_string();
        std::fs::write(&path,&source).unwrap();
        assert!(load_db(&path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(),source);
        std::fs::remove_file(path).unwrap();
    }

    fn overlay_move_fixture() -> super::Database {
        let mut db = hotkey_move_fixture();
        db.games[0].states = serde_json::from_value(serde_json::json!([{"id":"buff","name":"Buff","duration_ms":5000}])).unwrap();
        db.games[0].profiles[0].overlay_groups = serde_json::from_value(serde_json::json!([
            {"id":"magic","name":"Magic","x":15,"y":25,"layout":"row","gap":6,"disabled":true},
            {"id":"empty","name":"Empty"}
        ])).unwrap();
        db.games[0].profiles[0].overlay_items = serde_json::from_value(serde_json::json!([
            {"id":"timer","name":"Saved timer","type":"timer","group_id":"magic","x":3,"y":4,"duration_ms":5000,"color":"#ffffff","font_size":22,"timer_state_id":"buff","start_with_overlay":true,"show_only_running":true},
            {"id":"icon","name":"Saved icon","type":"icon","group_id":"magic","x":1,"y":2,"w":48,"h":64,"src":"data:image/png;base64,image","visible_while_timer_id":"timer"},
            {"id":"bar","name":"Saved bar","type":"bar","group_id":"magic","x":0,"y":0,"w":200,"h":20,"color":"#aabbcc","max_value":100},
            {"id":"text","name":"Saved text","type":"text","group_id":"magic","x":5,"y":6,"content":"Literal overlay text","font_size":18,"color":"#ffffff"}
        ])).unwrap();
        db.games[0].profiles.push(serde_json::from_value(serde_json::json!({"id":"same","name":"Same","armed":false})).unwrap());
        db
    }

    fn overlay_selection(db: &super::Database) -> super::OverlaySelection {
        super::OverlaySelection::Overlay {
            group: db.games[0].profiles[0].overlay_groups[0].clone(),
            items: db.games[0].profiles[0].overlay_items.clone(),
        }
    }

    #[test]
    fn overlay_moves_transfer_all_parts_and_keep_settings_references_and_activation() {
        for (target_game, target_id) in [("source-app","same"),("target-app","target")] {
            let mut db = overlay_move_fixture();
            let selection = overlay_selection(&db);
            let source_before = serde_json::to_value(&db.games[0].profiles[0]).unwrap();
            let target_game_index = usize::from(target_game == "target-app");
            let target_index = db.games[target_game_index].profiles.iter().position(|profile| profile.id == target_id).unwrap();
            let target_before = serde_json::to_value(&db.games[target_game_index].profiles[target_index]).unwrap();
            let mut dependencies = db.games[target_game_index].profiles[target_index].clone();
            dependencies.states = db.games[0].states.clone();
            db.move_overlay("source-app","source",&selection,target_game,dependencies,None).unwrap();
            let source = &db.games[0].profiles[0];
            assert_eq!(source.overlay_groups.iter().map(|group| group.id.as_str()).collect::<Vec<_>>(),["empty"]);
            assert!(source.overlay_items.is_empty());
            assert_eq!(serde_json::to_value(&source.hotkeys).unwrap(),source_before["hotkeys"]);
            let target = &db.games[target_game_index].profiles[target_index];
            assert_eq!(target.overlay_items,match &selection { super::OverlaySelection::Overlay { items, .. } => items.clone(), _ => unreachable!() });
            assert_eq!(target.overlay_groups[0],match &selection { super::OverlaySelection::Overlay { group, .. } => group.clone(), _ => unreachable!() });
            assert!(!target.armed);
            assert_eq!(serde_json::to_value(&target.hotkeys).unwrap(),target_before["hotkeys"]);
            assert_eq!(serde_json::to_value(&target.subfolder_id).unwrap(),target_before.get("subfolder_id").cloned().unwrap_or(serde_json::Value::Null));
            assert!(db.games[target_game_index].states.iter().any(|state| state.id == "buff"));
            let path = std::env::temp_dir().join(format!("macrotoolbox-overlay-move-{}.json",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
            super::save_db(&path,&db).unwrap();
            assert_eq!(serde_json::to_value(load_db(&path).unwrap()).unwrap(),serde_json::to_value(&db).unwrap());
            std::fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn overlay_parts_move_independently_between_groups_and_profiles() {
        let mut db = overlay_move_fixture();
        let icon = db.games[0].profiles[0].overlay_items[1].clone();
        let part = super::OverlaySelection::OverlayPart { item: icon.clone() };
        let dependencies = db.games[0].profiles[0].clone();
        db.move_overlay("source-app","source",&part,"source-app",dependencies,Some("empty")).unwrap();
        assert_eq!(db.games[0].profiles[0].overlay_groups.len(),2);
        assert_eq!(db.games[0].profiles[0].overlay_items.len(),4);
        let mut moved = db.games[0].profiles[0].overlay_items.iter().find(|item| super::overlay_item_id(item) == "icon").unwrap().clone();
        assert_eq!(moved.group_id(),Some("empty"));
        moved.set_group_id("magic");
        assert_eq!(moved,icon);
        let current = db.games[0].profiles[0].overlay_items.iter().find(|item| super::overlay_item_id(item) == "icon").unwrap().clone();
        let dependencies = db.games[1].profiles[0].clone();
        db.move_overlay("source-app","source",&super::OverlaySelection::OverlayPart { item: current },"target-app",dependencies,None).unwrap();
        assert_eq!(db.games[0].profiles[0].overlay_items.len(),3);
        assert_eq!(db.games[1].profiles[0].overlay_items.len(),1);
        assert_eq!(db.games[1].profiles[0].overlay_groups[0].id,"empty");
        assert_eq!(db.games[1].profiles[0].overlay_items[0].group_id(),Some("empty"));
    }

    #[test]
    fn overlays_can_move_into_descendants_and_empty_overlays_move_without_parts() {
        let mut db = overlay_move_fixture();
        let selection = overlay_selection(&db);
        db.games[0].profiles[1].parent_id = Some("source".into());
        let dependencies = db.games[0].profiles[1].clone();
        db.move_overlay("source-app","source",&selection,"source-app",dependencies,None).unwrap();
        assert_eq!(db.games[0].profiles[1].overlay_groups[0].id,"magic");
        assert_eq!(db.games[0].profiles[1].overlay_items.len(),4);
        assert!(db.games[0].profiles[0].overlay_items.is_empty());
        let empty = super::OverlaySelection::Overlay { group: db.games[0].profiles[0].overlay_groups[0].clone(), items: vec![] };
        let dependencies = db.games[1].profiles[0].clone();
        db.move_overlay("source-app","source",&empty,"target-app",dependencies,None).unwrap();
        assert_eq!(db.games[1].profiles[0].overlay_groups[0].id,"empty");
        assert!(db.games[1].profiles[0].overlay_items.is_empty());
    }

    #[test]
    fn invalid_overlay_selections_and_destinations_leave_both_owners_unchanged() {
        let mut db = overlay_move_fixture();
        let selection = overlay_selection(&db);
        let target = db.games[1].profiles[0].clone();
        let before = serde_json::to_value(&db).unwrap();
        for (source_game,source_id,target_game,target_id,group_id) in [
            ("source-app","source","source-app","source",None),
            ("missing","source","target-app","target",None),
            ("source-app","missing","target-app","target",None),
            ("source-app","source","missing","target",None),
            ("source-app","source","target-app","missing",None),
            ("source-app","source","target-app","target",Some("missing")),
        ] {
            let mut dependencies = target.clone(); dependencies.id = target_id.into();
            assert!(db.move_overlay(source_game,source_id,&selection,target_game,dependencies,group_id).is_err());
            assert_eq!(serde_json::to_value(&db).unwrap(),before);
        }
        let mut stale = selection.clone();
        if let super::OverlaySelection::Overlay { items, .. } = &mut stale { items.pop(); }
        assert!(db.move_overlay("source-app","source",&stale,"target-app",target.clone(),None).is_err());
        assert_eq!(serde_json::to_value(&db).unwrap(),before);
        if let super::OverlaySelection::Overlay { group, .. } = &selection { db.games[1].profiles[0].overlay_groups.push(group.clone()); }
        let group_collision = serde_json::to_value(&db).unwrap();
        assert!(db.move_overlay("source-app","source",&selection,"target-app",target.clone(),None).is_err());
        assert_eq!(serde_json::to_value(&db).unwrap(),group_collision);
        db.games[1].profiles[0].overlay_groups.clear();
        let icon = db.games[0].profiles[0].overlay_items[1].clone();
        let part = super::OverlaySelection::OverlayPart { item: icon.clone() };
        let mut stale_part = part.clone();
        if let super::OverlaySelection::OverlayPart { item } = &mut stale_part { item.set_group_id("empty"); }
        assert!(db.move_overlay("source-app","source",&stale_part,"target-app",target.clone(),None).is_err());
        assert_eq!(serde_json::to_value(&db).unwrap(),before);
        assert!(db.move_overlay("source-app","source",&part,"source-app",db.games[0].profiles[0].clone(),Some("magic")).is_err());
        assert_eq!(serde_json::to_value(&db).unwrap(),before);
        db.games[1].profiles[0].overlay_items.push(icon);
        let collision = serde_json::to_value(&db).unwrap();
        assert!(db.move_overlay("source-app","source",&selection,"target-app",target,None).is_err());
        assert_eq!(serde_json::to_value(&db).unwrap(),collision);
    }

    fn hotkey_move_fixture() -> super::Database {
        serde_json::from_value(serde_json::json!({
            "version":super::CURRENT_DB_VERSION,"settings":{"ahk_exe":""},"scopes":[
                {"id":"source-app","name":"Source","exe":"source.exe","profiles":[
                    {"id":"source","name":"Source","armed":true,"hotkeys":[
                        {"name":"Move me","trigger":"f1","behavior":"press(x)","allow_extra_modifiers":false,"state_id":"state"},
                        {"name":"Leave me","trigger":"f2","behavior":"press(y)"}]}]},
                {"id":"target-app","name":"Target","exe":"target.exe","subfolders":[{"id":"off","name":"Off","enabled":false}],
                 "states":[{"id":"existing-state","name":"Existing"}],"profiles":[
                    {"id":"target","name":"Keep name","armed":false,"subfolder_id":"off","hotkeys_disabled":true,
                     "hotkeys":[{"name":"Existing","trigger":"f3","behavior":"press(z)"}],
                     "scripts":[{"id":"existing-script","name":"Keep script","trigger":"hotkey","source":"code","code":"keep"}]},
                    {"id":"sibling","name":"Sibling","scripts":[{"id":"shared-script","trigger":"hotkey","source":"code","code":"shared"}]}]},
                {"id":"global","name":"Global","exe":"*"}
            ]
        })).unwrap()
    }

    #[test]
    fn hotkey_move_preserves_owners_and_destination_settings_and_persists_once() {
        let mut db = hotkey_move_fixture();
        let expected = db.games[0].profiles[0].hotkeys[0].clone();
        let source_before = serde_json::to_value(&db.games[0]).unwrap();
        let mut dependencies: Profile = serde_json::from_value(serde_json::json!({
            "id":"target","name":"Stale name","armed":true,"states":[
                {"id":"state","name":"State"},{"id":"existing-state","name":"Stale state"}],
            "hotkeys":[{"trigger":"f4","behavior":"send(stale)"}],"scripts":[
                {"id":"existing-script","name":"Stale script","trigger":"launch","source":"code"},
                {"id":"shared-script","trigger":"launch","source":"code"},
                {"id":"new-script","trigger":"hotkey","source":"code","code":"print('hello')"}],
            "overlay_groups":[{"id":"overlay","name":"Overlay"}],
            "overlay_items":[{"type":"timer","id":"timer","name":"Timer","group_id":"overlay","duration_ms":5000,"color":"#fff","font_size":22,"x":0,"y":0}]
        })).unwrap();
        db.move_hotkey("source-app","source",0,&expected,"target-app",dependencies.clone()).unwrap();
        let target = &db.games[1].profiles[0];
        assert_eq!(target.name,"Keep name");
        assert!(!target.armed);
        assert!(target.hotkeys_disabled);
        assert_eq!(target.subfolder_id.as_deref(),Some("off"));
        assert_eq!(target.hotkeys.len(),2);
        assert_eq!(target.hotkeys[1],expected);
        assert_eq!(target.hotkeys[0].name,"Existing");
        assert_eq!(target.scripts.iter().map(|script| script.id.as_str()).collect::<Vec<_>>(),["existing-script","new-script"]);
        assert_eq!(target.scripts[0].code,"keep");
        assert_eq!(target.overlay_groups[0].id,"overlay");
        assert_eq!(super::overlay_item_id(&target.overlay_items[0]),"timer");
        assert!(target.states.is_empty());
        assert_eq!(db.games[1].states.iter().map(|state| state.name.as_str()).collect::<Vec<_>>(),["Existing","State"]);
        let mut expected_source = source_before;
        expected_source["profiles"][0]["hotkeys"].as_array_mut().unwrap().remove(0);
        assert_eq!(serde_json::to_value(&db.games[0]).unwrap(),expected_source);

        let path = std::env::temp_dir().join(format!("macrotoolbox-move-{}.json",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        super::save_db(&path,&db).unwrap();
        assert_eq!(serde_json::to_value(load_db(&path).unwrap()).unwrap(),serde_json::to_value(&db).unwrap());
        std::fs::remove_file(path).unwrap();

        dependencies.id = "sibling".into();
        db.move_hotkey("target-app","target",1,&expected,"target-app",dependencies).unwrap();
        assert_eq!(db.games[1].profiles[0].hotkeys.len(),1);
        assert_eq!(db.games[1].profiles[1].hotkeys,[expected]);
        assert_eq!(db.games[1].profiles[1].scripts.len(),1);
    }

    #[test]
    fn invalid_or_stale_hotkey_moves_are_atomic_and_unassigned_copies_stay_distinct() {
        let mut db = hotkey_move_fixture();
        let expected = db.games[0].profiles[0].hotkeys[0].clone();
        let before = serde_json::to_value(&db).unwrap();
        let target = db.games[1].profiles[0].clone();
        for (game,profile,index,target_game,target_id) in [
            ("source-app","source",0,"source-app","source"),
            ("missing","source",0,"target-app","target"),
            ("source-app","missing",0,"target-app","target"),
            ("source-app","source",1,"target-app","target"),
            ("source-app","source",9,"target-app","target"),
            ("source-app","source",0,"missing","target"),
            ("source-app","source",0,"target-app","missing"),
        ] {
            let mut dependencies = target.clone(); dependencies.id = target_id.into();
            assert!(db.move_hotkey(game,profile,index,&expected,target_game,dependencies).is_err());
            assert_eq!(serde_json::to_value(&db).unwrap(),before);
        }
        let mut stale = expected.clone(); stale.behavior = "send(changed)".into();
        assert!(db.move_hotkey("source-app","source",0,&stale,"target-app",target.clone()).is_err());
        assert_eq!(serde_json::to_value(&db).unwrap(),before);
        db.games[1].profiles[0].hotkeys.push(expected.clone());
        let before_conflict = serde_json::to_value(&db).unwrap();
        assert!(db.move_hotkey("source-app","source",0,&expected,"target-app",target.clone()).is_err());
        assert_eq!(serde_json::to_value(&db).unwrap(),before_conflict);
        db.games[0].profiles[0].hotkeys[0].trigger = "".into();
        db.games[1].profiles[0].hotkeys[1].trigger = "".into();
        let blank = db.games[0].profiles[0].hotkeys[0].clone();
        db.move_hotkey("source-app","source",0,&blank,"target-app",target).unwrap();
        assert_eq!(db.games[1].profiles[0].hotkeys.iter().filter(|hotkey| hotkey.trigger == blank.trigger).count(),2);
    }

    #[test]
    fn folder_reordering_is_atomic_and_persists_without_changing_folder_contents() {
        let mut db: super::Database = serde_json::from_value(serde_json::json!({
            "version": super::CURRENT_DB_VERSION, "settings": {"ahk_exe": ""}, "scopes": [
                {"id": "global", "name": "Global", "exe": "*"},
                {"id": "game", "name": "Game", "exe": "game.exe", "profiles": [{"id": "p", "name": "Profile"}]}
            ]
        })).unwrap();
        let before = serde_json::to_value(&db).unwrap();
        for ids in [vec!["global"], vec!["game", "game"], vec!["game", "unknown"]] {
            assert!(db.reorder_folders(&ids.into_iter().map(String::from).collect::<Vec<_>>()).is_err());
            assert_eq!(serde_json::to_value(&db).unwrap(), before);
        }
        db.reorder_folders(&["game".into(), "global".into()]).unwrap();
        let path = std::env::temp_dir().join(format!("macrotoolbox-order-{}.json", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        super::save_db(&path, &db).unwrap();
        let loaded = load_db(&path).unwrap();
        assert_eq!(loaded.games.iter().map(|game| game.id.as_str()).collect::<Vec<_>>(), ["game", "global"]);
        assert_eq!(serde_json::to_value(&loaded).unwrap()["scopes"][0], before["scopes"][1]);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn owned_overrides_follow_saved_order_and_inherited_entries_keep_their_slots() {
        let profiles: Vec<Profile> = serde_json::from_value(serde_json::json!([
            {"id":"parent", "name":"Parent", "hotkeys":[
                {"trigger":"a", "behavior":"press(a)"}, {"trigger":"b", "behavior":"press(b)"}, {"trigger":"c", "behavior":"press(c)"}]},
            {"id":"child", "name":"Child", "parent_id":"parent", "hotkeys":[
                {"trigger":"d", "behavior":"press(d)"}, {"trigger":"b", "behavior":"send(override)"}]}
        ])).unwrap();
        let resolved = super::resolve_profile_hotkeys(&profiles, &profiles[1]);
        assert_eq!(resolved.iter().map(|entry| entry.trigger.resolve(&[]).unwrap().join(",")).collect::<Vec<_>>(), ["a", "d", "c", "b"]);
        assert_eq!(resolved[3].behavior, "send(override)");
        assert_eq!(profiles[0].hotkeys.iter().map(|entry| entry.trigger.resolve(&[]).unwrap().join(",")).collect::<Vec<_>>(), ["a", "b", "c"]);
    }

    #[test]
    fn unassigned_copies_remain_distinct_across_inheritance_and_reopening_settings() {
        let db: super::Database = serde_json::from_value(serde_json::json!({
            "version": super::CURRENT_DB_VERSION, "settings": {"ahk_exe":""}, "scopes":[{
                "id":"game", "name":"Game", "exe":"game.exe", "profiles":[
                    {"id":"parent", "name":"Parent", "hotkeys":[
                        {"name":"Original", "trigger":"f1", "behavior":"press(x)"},
                        {"name":"Parent copy", "trigger":"", "behavior":"press(x)"},
                        {"name":"Parent copy", "trigger":"", "behavior":"press(x)"}]},
                    {"id":"child", "name":"Child", "parent_id":"parent", "hotkeys":[
                        {"name":"Copy", "trigger":"", "behavior":"press(x)"},
                        {"name":"Copy of copy", "trigger":" ", "behavior":"press(x)"},
                        {"name":"Override", "trigger":"f1", "behavior":"press(y)"}]}
                ]
            }]
        })).unwrap();
        let path = std::env::temp_dir().join(format!("macrotoolbox-copies-{}.json", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        super::save_db(&path, &db).unwrap();
        let mut loaded = load_db(&path).unwrap();
        assert_eq!(serde_json::to_value(&loaded).unwrap(), serde_json::to_value(&db).unwrap());
        let profiles = &loaded.games[0].profiles;
        let resolved = super::resolve_profile_hotkeys(profiles, &profiles[1]);
        assert_eq!(resolved.iter().map(|entry| entry.name.as_str()).collect::<Vec<_>>(),
            ["Copy", "Parent copy", "Parent copy", "Copy of copy", "Override"]);
        assert!(std::ptr::eq(resolved[0], &profiles[1].hotkeys[0]));
        assert!(std::ptr::eq(resolved[2], &profiles[0].hotkeys[2]));
        assert_eq!(resolved[4].behavior, "press(y)");
        loaded.games[0].profiles[1].hotkeys.swap(0, 1);
        let profiles = &loaded.games[0].profiles;
        assert_eq!(super::resolve_profile_hotkeys(profiles, &profiles[1]).iter().map(|entry| entry.name.as_str()).collect::<Vec<_>>(),
            ["Copy of copy", "Parent copy", "Parent copy", "Copy", "Override"]);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn v7_settings_upgrade_without_reassigning_profiles_and_subfolder_switches_persist() {
        let path = std::env::temp_dir().join(format!("macrotoolbox-subfolders-{}.json", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let source = serde_json::json!({"version":7,"settings":{"ahk_exe":"ahk.exe"},
            "variables":[{"id":"delay","name":"Delay","type":"number","value":150}],
            "scopes":[{"id":"game","name":"Game","exe":"game.exe","states":[{"id":"buff","name":"Buff"}],
                "profiles":[{"id":"keys","name":"Keys","armed":true,"toggle_hotkeys_key":"rctrl f1",
                    "hotkeys":[{"trigger":"rctrl o","behavior":"sleep($delay);send(hello)"}]},
                    {"id":"off","name":"Off","armed":false}]}]}).to_string();
        std::fs::write(&path, &source).unwrap();
        let mut db = load_db(&path).unwrap();
        let backup = path.with_extension("json.v7.bak");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), source);
        assert!(db.games[0].subfolders.is_empty());
        assert!(db.games[0].profiles[0].subfolder_id.is_none());
        assert!(db.games[0].profile_enabled(&db.games[0].profiles[0]));
        assert_eq!(db.games[0].profiles[0].hotkeys[0].behavior, "sleep($delay);send(hello)");
        assert_eq!(db.variables[0].id, "delay");
        db.games[0].subfolders.push(super::Subfolder { id:"combat".into(),name:"Combat".into(),enabled:true,toggle_key:Some("rctrl f2".into()) });
        db.games[0].profiles[0].subfolder_id = Some("combat".into());
        let armed = db.games[0].profiles.iter().map(|profile| profile.armed).collect::<Vec<_>>();
        db.games[0].set_subfolder_enabled("combat", false).unwrap();
        assert!(!db.games[0].profile_enabled(&db.games[0].profiles[0]));
        assert!(db.games[0].set_subfolder_enabled("missing", true).is_err());
        super::save_db(&path, &db).unwrap();
        let saved = std::fs::read(&path).unwrap();
        let mut reopened = load_db(&path).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), saved);
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), source);
        assert!(!reopened.games[0].subfolders[0].enabled);
        assert_eq!(reopened.games[0].subfolders[0].toggle_key.as_deref(), Some("rctrl f2"));
        reopened.games[0].set_subfolder_enabled("combat", true).unwrap();
        assert!(reopened.games[0].profile_enabled(&reopened.games[0].profiles[0]));
        assert_eq!(reopened.games[0].profiles.iter().map(|profile| profile.armed).collect::<Vec<_>>(), armed);
        reopened.games[0].profiles[0].subfolder_id = Some("missing".into());
        assert!(reopened.games[0].validate_subfolders().is_err());
        assert!(super::save_db(&path, &reopened).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), saved);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_file(backup).unwrap();
    }

    #[test]
    fn legacy_databases_default_variables_and_new_definitions_round_trip() {
        let path = std::env::temp_dir().join(format!("macrotoolbox-variables-{}.json", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::write(&path, r#"{"version":5,"scopes":[],"settings":{"ahk_exe":""}}"#).unwrap();
        let mut db = load_db(&path).unwrap();
        assert_eq!(db.version, super::CURRENT_DB_VERSION);
        assert!(db.variables.is_empty());
        db.variables.push(super::Variable { id: "buff".into(), name: "buff timer".into(), value: 5000.0.into() });
        super::save_db(&path, &db).unwrap();
        assert_eq!(load_db(&path).unwrap().variables, db.variables);
        std::fs::remove_file(path.with_extension("json.v5.bak")).unwrap();
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn v6_number_variables_upgrade_automatically_and_preserve_the_original_database() {
        let path = std::env::temp_dir().join(format!("macrotoolbox-v6-variables-{}.json", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let source = r#"{"version":6,"scopes":[],"settings":{"ahk_exe":""},"variables":[{"id":"timer","name":"Sleep timer","value":100}]}"#;
        std::fs::write(&path, source).unwrap();
        let migrated = load_db(&path).unwrap();
        assert_eq!(migrated.version, super::CURRENT_DB_VERSION);
        assert_eq!(migrated.variables[0].value, crate::variables::VariableValue::Number(100.0));
        assert_eq!(serde_json::to_value(&migrated).unwrap()["variables"][0]["type"], "number");
        let backup = std::path::PathBuf::from(format!("{}.v6.bak", path.display()));
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), source);
        assert_eq!(load_db(&path).unwrap().variables, migrated.variables);
        std::fs::remove_file(&path).unwrap(); std::fs::remove_file(backup).unwrap();
    }

    #[test]
    fn skipped_schema_versions_upgrade_with_backups_and_reopen_without_rewriting() {
        for version in 0..super::CURRENT_DB_VERSION {
            let path = std::env::temp_dir().join(format!("macrotoolbox-upgrade-{version}-{}.json", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
            let mut fixture = serde_json::json!({
                "version": version,
                "scopes": [{"id":"game", "name":"Game", "exe":"game.exe", "profiles":[{
                    "id":"keys", "name":"Keys", "armed":true,
                    "hotkeys":[{"trigger":"rctrl o", "behavior":"send(ø)"}],
                    "states":[{"id":"buff", "name":"Buff", "duration_ms":5000}]
                }]}],
                "settings":{"ahk_exe":"AutoHotkey64.exe", "close_to_tray":true}
            });
            if version == 0 { fixture.as_object_mut().unwrap().remove("version"); }
            if version <= 1 { fixture["scopes"][0]["active_profile"] = serde_json::json!("keys"); }
            if version == 2 { fixture["scopes"][0]["profiles"][0]["exe"] = serde_json::json!("game.exe"); }
            let source = fixture.to_string();
            std::fs::write(&path, &source).unwrap();
            let migrated = load_db(&path).unwrap();
            let backup = std::path::PathBuf::from(format!("{}.v{}.bak", path.display(), version.max(1)));
            assert_eq!(std::fs::read_to_string(&backup).unwrap(), source);
            assert_eq!(migrated.version, super::CURRENT_DB_VERSION);
            assert_eq!(migrated.games[0].id, "game");
            assert_eq!(migrated.games[0].exe, "game.exe");
            assert_eq!(migrated.games[0].states[0].id, "buff");
            let profile = &migrated.games[0].profiles[0];
            assert!(profile.armed);
            assert_eq!(profile.id, "keys");
            assert_eq!(profile.hotkeys[0].behavior, "send(ø)");
            assert_eq!(migrated.settings.ahk_exe, "AutoHotkey64.exe");
            assert!(migrated.settings.close_to_tray);
            let saved = std::fs::read(&path).unwrap();
            let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
            load_db(&path).unwrap();
            assert_eq!(std::fs::read(&path).unwrap(), saved);
            assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), modified);
            assert_eq!(std::fs::read_to_string(&backup).unwrap(), source);
            std::fs::remove_file(path).unwrap();
            std::fs::remove_file(backup).unwrap();
        }
    }

    #[test]
    fn failed_upgrade_backup_leaves_the_original_settings_untouched() {
        let path = std::env::temp_dir().join(format!("macrotoolbox-upgrade-failure-{}.json", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let source = r#"{"version":5,"scopes":[],"settings":{"ahk_exe":""}}"#;
        let backup = std::path::PathBuf::from(format!("{}.v5.bak", path.display()));
        std::fs::write(&path, source).unwrap();
        std::fs::create_dir(&backup).unwrap();
        assert!(load_db(&path).unwrap_err().contains("Could not back up settings"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), source);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(backup).unwrap();
    }

    #[test]
    fn a_newer_unsupported_schema_is_never_downgraded_or_overwritten() {
        let path = std::env::temp_dir().join(format!("macrotoolbox-future-schema-{}.json", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let version = super::CURRENT_DB_VERSION + 1;
        let source = serde_json::json!({"version":version, "future_data":{"preserve":true}}).to_string();
        std::fs::write(&path, &source).unwrap();
        assert!(load_db(&path).unwrap_err().contains("requires a newer MacroToolbox version"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), source);
        assert!(!path.with_extension(format!("json.v{version}.bak")).exists());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn number_variable_definitions_require_unique_ids_names_and_finite_values() {
        let variable = super::Variable { id: "buff".into(), name: "buff timer".into(), value: 5000.0.into() };
        assert!(super::validate_variables(std::slice::from_ref(&variable)).is_ok());
        for other in [variable.clone(), super::Variable { id: "other".into(), name: " BUFF TIMER ".into(), ..variable.clone() }] {
            assert!(super::validate_variables(&[variable.clone(), other]).is_err());
        }
        for other in [super::Variable { value: f64::INFINITY.into(), ..variable.clone() },
            super::Variable { name: " ".into(), ..variable.clone() }, super::Variable { id: "".into(), ..variable }] {
            assert!(super::validate_variables(&[other]).is_err());
        }
    }

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
            if trigger == &crate::triggers::Trigger::from("f1") && behavior == "press(1)"));
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
