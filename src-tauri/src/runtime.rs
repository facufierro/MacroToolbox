use std::collections::{BTreeMap, HashSet};
use serde::{Deserialize, Serialize};
use crate::config::{self, Database, OverlayConfig, OverlayItem};

#[derive(Clone, Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeState {
    pub flags: BTreeMap<String, bool>,
    pub timers: BTreeMap<String, u64>,
    pub item_timers: BTreeMap<String, u64>,
    pub hidden_items: BTreeMap<String, bool>,
    pub values: BTreeMap<String, f64>,
}

#[derive(Clone, Default, Serialize)]
pub struct Snapshot { pub config: OverlayConfig, pub runtime: RuntimeState, pub revision: u64 }

#[derive(Default)]
struct FolderRuntime { snapshot: Snapshot, profiles: HashSet<String> }

/// Persistent runtime state is independent of focus and of the overlay webview.
/// Definitions are reconciled by identity; disabled owners lose their own resources.
#[derive(Default)]
pub struct Runtime {
    folders: BTreeMap<String, FolderRuntime>,
    disabled: HashSet<String>,
    selected: Option<String>,
    commands: Vec<BehaviorRequest>,
    next_command: u64,
    revision: u64,
}

#[derive(Serialize)]
pub struct BehaviorRequest { owner: String, #[serde(flatten)] scope: ExecutionScope, target: String, steps: Vec<crate::behavior::Action> }

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
pub struct ExecutionScope {
    pub profile: String,
    #[serde(default)]
    pub section: String,
    #[serde(default)]
    pub script_owner: String,
}

impl ExecutionScope {
    pub fn section(&self) -> &str { if self.section.is_empty() { "scripts" } else { &self.section } }

    pub fn is_active(&self, db: &Database) -> bool {
        db.games.iter().any(|game| {
            game.profiles.iter().any(|profile| profile.id == self.profile && profile.armed && profile.section_enabled(self.section()))
                && (self.script_owner.is_empty() || game.profiles.iter().any(|profile| profile.id == self.script_owner && profile.armed && !profile.scripts_disabled))
        })
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

pub fn item_id(item: &OverlayItem) -> &str {
    match item {
        OverlayItem::Timer { id, .. } | OverlayItem::Icon { id, .. }
        | OverlayItem::Bar { id, .. } | OverlayItem::Text { id, .. } => id,
    }
}

fn visibility_state(item: &OverlayItem) -> Option<&str> {
    match item {
        OverlayItem::Timer { state_id, .. } | OverlayItem::Icon { state_id, .. }
        | OverlayItem::Bar { state_id, .. } | OverlayItem::Text { state_id, .. } => state_id.as_deref(),
    }
}

fn item_group(item: &OverlayItem) -> Option<&str> {
    match item {
        OverlayItem::Timer { group_id, .. } | OverlayItem::Icon { group_id, .. }
        | OverlayItem::Bar { group_id, .. } | OverlayItem::Text { group_id, .. } => group_id.as_deref(),
    }
}

impl Runtime {
    pub fn enqueue(&mut self, db: &Database, scope: &ExecutionScope, source: &str) -> Result<(), String> {
        let profile = scope.profile.as_str();
        let game = db.games.iter().find(|game| game.profiles.iter().any(|candidate| candidate.id == profile && candidate.armed)).ok_or("Profile is unavailable.")?;
        if !self.enabled(profile) { return Err("Profile is disabled.".into()); }
        if !scope.is_active(db) || (!scope.script_owner.is_empty() && !self.enabled(&scope.script_owner)) { return Err("Behavior source is disabled.".into()); }
        let steps = crate::behavior::resolve(source, &db.variables)?;
        crate::behavior::validate(&steps)?;
        self.next_command += 1;
        let mut scope = scope.clone(); scope.section = scope.section().to_string();
        self.commands.push(BehaviorRequest { owner: format!("{profile}:script:{}", self.next_command), scope, target: game.exe.clone(), steps });
        Ok(())
    }

    pub fn take_commands(&mut self) -> Vec<BehaviorRequest> { std::mem::take(&mut self.commands) }

    pub fn reconcile(&mut self, db: &Database, now: u64) {
        self.revision += 1;
        let existing_ids: HashSet<_> = db.games.iter().flat_map(|game| game.profiles.iter().filter(|profile| profile.armed).map(|profile| profile.id.clone())).collect();
        self.disabled.retain(|id| existing_ids.contains(id));
        self.folders.retain(|id, _| db.games.iter().any(|game| &game.id == id));
        for game in &db.games {
            let folder = self.folders.entry(game.id.clone()).or_default();
            let previous = folder.snapshot.config.clone();
            let mut config = OverlayConfig { profile_id: Some(game.id.clone()), ..Default::default() };
            folder.profiles.clear();
            config.states = game.states.clone();
            config.states_disabled = game.states_disabled;
            let states: HashSet<String> = game.states.iter().filter(|_| !game.states_disabled).map(|state| state.id.clone()).collect();
            let mut items = HashSet::new();
            let mut groups = HashSet::new();
            let mut enabled_groups = HashSet::new();
            let mut disabled_items = HashSet::new();
            for profile in game.profiles.iter().filter(|profile| profile.armed && !self.disabled.contains(&profile.id)) {
                folder.profiles.insert(profile.id.clone());
                let profile_groups = config::resolve_profile_overlay_groups(&game.profiles, profile);
                for group in profile_groups.iter().copied() {
                    if groups.insert(group.id.clone()) { config.groups.push(group.clone()); }
                    if profile.overlay_disabled || group.disabled { disabled_items.insert(group.id.clone()); }
                    else { enabled_groups.insert(group.id.clone()); }
                }
                for item in config::resolve_profile_overlay_items(&game.profiles, profile) {
                    let disabled_group = item_group(item).is_some_and(|id| profile_groups.iter().any(|group| group.id == id && group.disabled));
                    if profile.overlay_disabled || disabled_group { disabled_items.insert(item_id(item).to_string()); }
                    else if items.insert(item_id(item).to_string()) { config.items.push(item.clone()); }
                }
            }
            config.disabled_items = disabled_items.into_iter().filter(|id| !items.contains(id) && !enabled_groups.contains(id)).collect();
            config.disabled_items.sort();
            let runtime = &mut folder.snapshot.runtime;
            for item in &config.items {
                if previous.items.iter().any(|old| item_id(old) == item_id(item) && visibility_state(old) != visibility_state(item)) {
                    runtime.hidden_items.remove(item_id(item));
                }
            }
            runtime.flags.retain(|id, _| states.contains(id));
            runtime.timers.retain(|id, _| states.contains(id));
            runtime.item_timers.retain(|id, _| items.contains(id));
            runtime.hidden_items.retain(|id, _| items.contains(id) || groups.contains(id));
            runtime.values.retain(|id, _| items.contains(id));
            folder.snapshot.config = config;
            let start: Vec<_> = folder.snapshot.config.items.iter().filter_map(|item| {
                if let OverlayItem::Timer { id, start_with_overlay: true, .. } = item {
                    let already_started = previous.items.iter().any(|old| matches!(old, OverlayItem::Timer { id: old_id, start_with_overlay: true, .. } if old_id == id));
                    if !already_started { return Some(id.clone()); }
                }
                None
            }).collect();
            for id in start { folder.snapshot.start_item(&id, false, now); }
        }
        self.commands.retain(|request| !self.disabled.contains(&request.scope.profile) && !self.disabled.contains(&request.scope.script_owner) && request.scope.is_active(db));
    }

    pub fn enabled(&self, profile: &str) -> bool { !self.disabled.contains(profile) }

    pub fn set_enabled(&mut self, db: &Database, profile: &str, enabled: bool, now: u64) -> Result<(), String> {
        if !db.games.iter().any(|game| game.profiles.iter().any(|p| p.id == profile && p.armed)) {
            return Err("Profile is not enabled in the configuration.".into());
        }
        if enabled { self.disabled.remove(profile); } else { self.disabled.insert(profile.into()); }
        self.reconcile(db, now);
        Ok(())
    }

    pub fn select_profile(&mut self, profile: Option<&str>) {
        self.revision += 1;
        self.selected = profile.and_then(|profile| self.folders.iter().find(|(_, folder)| folder.profiles.contains(profile)).map(|(id, _)| id.clone()));
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut snapshot = self.selected.as_ref().and_then(|id| self.folders.get(id)).map(|folder| folder.snapshot.clone()).unwrap_or_default();
        snapshot.revision = self.revision;
        snapshot
    }

    pub fn profile_snapshot(&self, profile: &str) -> Option<Snapshot> {
        self.folders.values().find(|folder| folder.profiles.contains(profile)).map(|folder| {
            let mut snapshot = folder.snapshot.clone(); snapshot.revision = self.revision; snapshot
        })
    }

    pub fn action(&mut self, profile: &str, kind: &str, id: &str, value: &str, now: u64) -> Result<(), String> {
        let folder = self.folders.values_mut().find(|folder| folder.profiles.contains(profile)).ok_or("Profile is disabled or unavailable.")?;
        let snapshot = &mut folder.snapshot;
        if matches!(kind, "overlay" | "bar") && snapshot.config.disabled_items.iter().any(|disabled| disabled == id) { return Ok(()); }
        match kind {
            "state" => snapshot.change_state(id, value, now)?,
            "overlay" => {
                if !snapshot.config.items.iter().any(|item| item_id(item) == id) && !snapshot.config.groups.iter().any(|group| group.id == id) { return Err(format!("Overlay part \"{id}\" is unavailable for profile \"{profile}\".")); }
                match value {
                    "start" | "restart" => snapshot.start_item(id, value == "restart", now),
                    "stop" => snapshot.stop_item(id),
                    _ => return Err("Unknown overlay operation.".into()),
                }
            }
            "bar" => {
                if !snapshot.config.items.iter().any(|item| matches!(item, OverlayItem::Bar { id: item_id, .. } if item_id == id)) { return Err("Bar is unavailable.".into()); }
                let number = value.parse::<f64>().map_err(|_| "Invalid bar value.")?;
                if !number.is_finite() { return Err("Invalid bar value.".into()); }
                snapshot.runtime.values.insert(id.into(), number);
            }
            _ => return Err("Unknown runtime operation.".into()),
        }
        self.revision += 1;
        Ok(())
    }

    pub fn dismiss(&mut self, id: &str) -> Result<(), String> {
        let folder = self.selected.as_ref().and_then(|id| self.folders.get_mut(id)).ok_or("No active overlay.")?;
        let item = folder.snapshot.config.items.iter().find(|item| item_id(item) == id).ok_or("Overlay item is unavailable.")?.clone();
        if let Some(group) = item_group(&item).filter(|id| folder.snapshot.config.groups.iter().any(|group| group.id == *id)) {
            folder.snapshot.stop_item(group);
        } else if let Some(state) = visibility_state(&item) {
            folder.snapshot.runtime.flags.remove(state);
            folder.snapshot.runtime.timers.remove(state);
            for related in &folder.snapshot.config.items {
                if visibility_state(related) == Some(state) { folder.snapshot.runtime.item_timers.remove(item_id(related)); }
            }
        } else {
            folder.snapshot.runtime.hidden_items.insert(id.into(), true);
            folder.snapshot.runtime.item_timers.remove(id);
        }
        self.revision += 1;
        Ok(())
    }
}

impl Snapshot {
    fn active(&self, id: &str, now: u64) -> bool {
        self.runtime.flags.get(id) == Some(&true) || self.runtime.timers.get(id).is_some_and(|end| *end > now)
    }

    fn activate(&mut self, id: &str, restart: bool, now: u64) {
        if self.config.states_disabled { return; }
        if self.active(id, now) && !restart { return; }
        let duration = self.config.states.iter().find(|state| state.id == id).and_then(|state| state.duration_ms).unwrap_or(0);
        if duration > 0 { self.runtime.timers.insert(id.into(), now + duration); self.runtime.flags.remove(id); }
        else { self.runtime.flags.insert(id.into(), true); self.runtime.timers.remove(id); }
    }

    fn change_state(&mut self, id: &str, operation: &str, now: u64) -> Result<(), String> {
        let definition = self.config.states.iter().find(|state| state.id == id).ok_or("State is unavailable.")?;
        if self.config.states_disabled { return Ok(()); }
        let timed = definition.duration_ms.unwrap_or(0) > 0;
        let enter = match operation {
            "set" => !self.active(id, now),
            "toggle" => timed || !self.active(id, now),
            "clear" => false,
            _ => return Err("Unknown state operation.".into()),
        };
        if operation == "set" && self.active(id, now) { return Ok(()); }
        if enter {
            self.activate(id, true, now);
            let items: Vec<_> = self.config.items.iter().filter(|item| visibility_state(item) == Some(id)).cloned().collect();
            for item in items { self.runtime.hidden_items.remove(item_id(&item)); self.start_timer(&item, true, now); }
        } else { self.runtime.flags.remove(id); self.runtime.timers.remove(id); }
        Ok(())
    }

    fn start_timer(&mut self, item: &OverlayItem, restart: bool, now: u64) {
        if let OverlayItem::Timer { id, timer_state_id, duration_ms, .. } = item {
            let linked = timer_state_id.as_deref().filter(|id| self.config.states.iter().any(|state| state.id == *id && state.duration_ms.unwrap_or(0) > 0));
            if let Some(id) = linked { self.activate(id, restart, now); }
            else if restart || !self.runtime.item_timers.get(id).is_some_and(|end| *end > now) { self.runtime.item_timers.insert(id.clone(), now + duration_ms); }
        }
    }

    fn start_item(&mut self, id: &str, restart: bool, now: u64) {
        if self.config.disabled_items.iter().any(|disabled| disabled == id) { return; }
        if self.config.groups.iter().any(|group| group.id == id) {
            self.runtime.hidden_items.remove(id);
            let members: Vec<_> = self.config.items.iter().filter(|item| item_group(item) == Some(id)).map(|item| item_id(item).to_string()).collect();
            for member in members { self.start_item(&member, restart, now); }
            return;
        }
        let Some(item) = self.config.items.iter().find(|item| item_id(item) == id).cloned() else { return; };
        self.runtime.hidden_items.remove(id);
        if let Some(group) = item_group(&item) { self.runtime.hidden_items.remove(group); }
        if let Some(state) = visibility_state(&item) {
            self.activate(state, false, now);
            let related: Vec<_> = self.config.items.iter().filter(|related| visibility_state(related) == Some(state)).cloned().collect();
            for related in related { self.start_timer(&related, restart && item_id(&related) == id, now); }
        }
        self.start_timer(&item, restart, now);
    }

    fn stop_item(&mut self, id: &str) {
        self.runtime.hidden_items.insert(id.into(), true);
        self.runtime.item_timers.remove(id);
        if self.config.groups.iter().any(|group| group.id == id) {
            for item in self.config.items.iter().filter(|item| item_group(item) == Some(id)) {
                self.runtime.item_timers.remove(item_id(item));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> Database {
        serde_json::from_value(serde_json::json!({"scopes":[{"id":"game","name":"Game","exe":"game.exe","states":[{"id":"buff","name":"Buff","duration_ms":1000}],"profiles":[
            {"id":"keys","name":"Keys","armed":true},
            {"id":"overlay","name":"Overlay","kind":"overlay","armed":true,"overlay_items":[
                {"type":"timer","id":"timer","x":0,"y":0,"duration_ms":500,"timer_state_id":"buff"},
                {"type":"bar","id":"health","x":0,"y":0,"w":100,"h":10,"color":"#fff","max_value":100}
            ]}]}],"settings":{"ahk_exe":"","python_exe":""}})).unwrap()
    }
    #[test]
    fn script_behavior_requests_resolve_shared_variables_without_changing_the_source() {
        let mut db = database();
        db.variables.push(config::NumberVariable { id: "pause".into(), name: "sleep timer".into(), value: 50.0 });
        let mut runtime = Runtime::default(); runtime.reconcile(&db, 0);
        let scope = ExecutionScope { profile: "keys".into(), ..Default::default() };
        let source = "sleep($pause);send($pause)";
        runtime.enqueue(&db, &scope, source).unwrap();
        let commands = runtime.take_commands();
        assert!(matches!(&commands[0].steps[0], crate::behavior::Action::Sleep { ms } if ms == "50"));
        assert!(matches!(&commands[0].steps[1], crate::behavior::Action::Send { text } if text == "$pause"));
        assert!(runtime.enqueue(&db, &scope, "sleep($missing)").is_err());
        assert!(runtime.take_commands().is_empty());
    }
    #[test]
    fn folder_state_is_shared_and_focus_does_not_restart_deadlines() {
        let mut runtime = Runtime::default(); let db = database();
        runtime.reconcile(&db, 100);
        runtime.action("keys", "state", "buff", "set", 200).unwrap();
        runtime.select_profile(Some("overlay"));
        assert_eq!(runtime.snapshot().runtime.timers["buff"], 1200);
        runtime.select_profile(None); runtime.reconcile(&db, 400); runtime.select_profile(Some("overlay"));
        assert_eq!(runtime.snapshot().runtime.timers["buff"], 1200);
        runtime.action("overlay", "state", "buff", "set", 500).unwrap();
        assert_eq!(runtime.snapshot().runtime.timers["buff"], 1200);
    }
    #[test]
    fn disabling_only_removes_resources_of_the_disabled_owner() {
        let mut runtime = Runtime::default(); let db = database(); runtime.reconcile(&db, 0);
        runtime.action("keys", "state", "buff", "set", 10).unwrap();
        runtime.action("keys", "overlay", "timer", "start", 10).unwrap();
        runtime.set_enabled(&db, "overlay", false, 20).unwrap();
        let snapshot = runtime.profile_snapshot("keys").unwrap();
        assert!(snapshot.config.items.is_empty());
        assert_eq!(snapshot.runtime.timers["buff"], 1010);
        assert!(runtime.action("overlay", "state", "buff", "clear", 30).is_err());
        runtime.set_enabled(&db, "keys", false, 30).unwrap();
        runtime.set_enabled(&db, "overlay", true, 40).unwrap();
        assert_eq!(runtime.profile_snapshot("overlay").unwrap().runtime.timers["buff"], 1010);
    }
    #[test]
    fn explicit_start_restart_stop_and_bar_values_use_the_same_state_owner() {
        let mut runtime = Runtime::default(); let db = database(); runtime.reconcile(&db, 0);
        runtime.action("keys", "overlay", "timer", "start", 10).unwrap();
        runtime.action("keys", "overlay", "timer", "start", 20).unwrap();
        assert_eq!(runtime.profile_snapshot("keys").unwrap().runtime.timers["buff"], 1010);
        runtime.action("keys", "overlay", "timer", "restart", 30).unwrap();
        assert_eq!(runtime.profile_snapshot("keys").unwrap().runtime.timers["buff"], 1030);
        runtime.action("keys", "overlay", "timer", "stop", 40).unwrap();
        runtime.action("keys", "bar", "health", "42", 40).unwrap();
        let snapshot = runtime.profile_snapshot("keys").unwrap();
        assert!(snapshot.runtime.hidden_items["timer"]);
        assert_eq!(snapshot.runtime.values["health"], 42.0);
    }

    #[test]
    fn untimed_states_toggle_and_explicit_entry_is_idempotent() {
        let mut db = database(); db.games[0].states[0].duration_ms = None;
        let mut runtime = Runtime::default(); runtime.reconcile(&db, 0);
        runtime.action("keys", "state", "buff", "toggle", 10).unwrap();
        assert!(runtime.profile_snapshot("overlay").unwrap().runtime.flags["buff"]);
        runtime.action("overlay", "state", "buff", "toggle", 20).unwrap();
        assert!(!runtime.profile_snapshot("keys").unwrap().runtime.flags.contains_key("buff"));
        for now in [30, 40] { runtime.action("keys", "state", "buff", "set", now).unwrap(); }
        assert!(runtime.profile_snapshot("keys").unwrap().runtime.flags["buff"]);
        runtime.action("keys", "state", "buff", "clear", 50).unwrap();
        assert!(!runtime.profile_snapshot("keys").unwrap().runtime.flags.contains_key("buff"));
    }

    #[test]
    fn all_overlay_profiles_share_the_folder_countdown_and_dismissal() {
        let mut db = database();
        db.games[0].profiles.push(serde_json::from_value(serde_json::json!({"id":"second","name":"Second","kind":"overlay","armed":true,
            "overlay_items":[{"type":"timer","id":"second-timer","x":0,"y":0,"duration_ms":500,"state_id":"buff","timer_state_id":"buff"},
                {"type":"text","id":"label","x":0,"y":0,"content":"Buff","font_size":16,"color":"#fff","state_id":"buff"}]})).unwrap());
        let mut runtime = Runtime::default(); runtime.reconcile(&db, 0);
        runtime.action("keys", "state", "buff", "set", 100).unwrap();
        runtime.select_profile(Some("second"));
        assert_eq!(runtime.snapshot().config.items.len(), 4);
        assert_eq!(runtime.snapshot().runtime.timers["buff"], 1100);
        runtime.dismiss("label").unwrap();
        assert!(!runtime.snapshot().runtime.timers.contains_key("buff"));
        runtime.action("second", "state", "buff", "toggle", 200).unwrap();
        assert_eq!(runtime.snapshot().runtime.timers["buff"], 1200);
    }

    #[test]
    fn automatic_timers_start_on_enable_and_survive_focus_and_edits() {
        let mut db = database();
        if let OverlayItem::Timer { start_with_overlay, timer_state_id, .. } = &mut db.games[0].profiles[1].overlay_items[0] { *start_with_overlay = true; *timer_state_id = None; }
        let mut runtime = Runtime::default(); runtime.reconcile(&db, 100);
        runtime.select_profile(Some("overlay"));
        assert_eq!(runtime.snapshot().runtime.item_timers["timer"], 600);
        runtime.select_profile(None); runtime.reconcile(&db, 300); runtime.select_profile(Some("overlay"));
        assert_eq!(runtime.snapshot().runtime.item_timers["timer"], 600);
        runtime.set_enabled(&db, "overlay", false, 400).unwrap();
        runtime.set_enabled(&db, "overlay", true, 500).unwrap();
        assert_eq!(runtime.profile_snapshot("overlay").unwrap().runtime.item_timers["timer"], 1000);
    }

    #[test]
    fn timed_toggle_restarts_but_start_and_entry_preserve_a_running_deadline() {
        let db = database(); let mut runtime = Runtime::default(); runtime.reconcile(&db, 0);
        runtime.action("keys", "state", "buff", "toggle", 100).unwrap();
        runtime.action("keys", "state", "buff", "set", 200).unwrap();
        runtime.action("keys", "overlay", "timer", "start", 300).unwrap();
        assert_eq!(runtime.profile_snapshot("keys").unwrap().runtime.timers["buff"], 1100);
        runtime.action("keys", "state", "buff", "toggle", 400).unwrap();
        assert_eq!(runtime.profile_snapshot("keys").unwrap().runtime.timers["buff"], 1400);
    }

    #[test]
    fn folders_and_deleted_resources_have_independent_lifetimes() {
        let mut db = database(); let mut other = db.games[0].clone(); other.id = "other".into();
        for profile in &mut other.profiles { profile.id.push_str("-other"); }
        db.games.push(other);
        let mut runtime = Runtime::default(); runtime.reconcile(&db, 0);
        runtime.action("keys", "state", "buff", "set", 100).unwrap();
        assert!(runtime.profile_snapshot("keys-other").unwrap().runtime.timers.is_empty());
        db.games[0].states.clear(); runtime.reconcile(&db, 200);
        assert!(!runtime.profile_snapshot("keys").unwrap().runtime.timers.contains_key("buff"));
        assert!(runtime.action("keys", "state", "missing", "set", 200).is_err());
        assert!(runtime.action("keys", "bar", "health", "NaN", 200).is_err());
    }

    #[test]
    fn unavailable_overlay_errors_identify_the_exact_reference_and_calling_profile() {
        let db = database(); let mut runtime = Runtime::default(); runtime.reconcile(&db, 0);
        let error = runtime.action("keys", "overlay", "deleted-timer", "restart", 100).unwrap_err();
        assert!(error.contains("deleted-timer")); assert!(error.contains("keys"));
        assert!(runtime.profile_snapshot("keys").unwrap().runtime.item_timers.is_empty());
    }

    #[test]
    fn commands_are_validated_and_keep_their_calling_context() {
        let db = database(); let mut runtime = Runtime::default(); runtime.reconcile(&db, 0);
        let scope = ExecutionScope { profile: "keys".into(), ..Default::default() };
        runtime.enqueue(&db, &scope, "press(x)").unwrap();
        let commands = runtime.take_commands();
        assert_eq!(commands[0].scope.profile, "keys"); assert_eq!(commands[0].target, "game.exe");
        assert!(runtime.take_commands().is_empty());
        assert!(runtime.enqueue(&db, &scope, "repeat(x,0)").is_err());
        runtime.set_enabled(&db, "keys", false, 10).unwrap();
        assert!(runtime.enqueue(&db, &scope, "press(x)").is_err());
    }

    #[test]
    fn disabled_overlay_groups_drop_only_their_owned_timers_and_ignore_activation() {
        let mut db = database();
        let profile = &mut db.games[0].profiles[1];
        profile.overlay_groups = vec![serde_json::from_value(serde_json::json!({"id":"group","name":"Group"})).unwrap()];
        if let OverlayItem::Timer { group_id, timer_state_id, .. } = &mut profile.overlay_items[0] {
            *group_id = Some("group".into()); *timer_state_id = None;
        }
        profile.overlay_items.push(serde_json::from_value(serde_json::json!({"type":"timer","id":"other","x":0,"y":0,"duration_ms":2000})).unwrap());
        let mut runtime = Runtime::default(); runtime.reconcile(&db, 0);
        runtime.action("keys", "overlay", "group", "start", 100).unwrap();
        runtime.action("keys", "overlay", "other", "start", 100).unwrap();
        db.games[0].profiles[1].overlay_groups[0].disabled = true;
        runtime.reconcile(&db, 200);
        let snapshot = runtime.profile_snapshot("keys").unwrap();
        assert!(!snapshot.runtime.item_timers.contains_key("timer"));
        assert_eq!(snapshot.runtime.item_timers["other"], 2100);
        assert!(snapshot.config.disabled_items.iter().any(|id| id == "group"));
        runtime.action("keys", "overlay", "group", "restart", 300).unwrap();
        assert!(!runtime.profile_snapshot("keys").unwrap().runtime.item_timers.contains_key("timer"));
        db.games[0].profiles[1].overlay_groups[0].disabled = false;
        runtime.reconcile(&db, 350);
        runtime.action("keys", "overlay", "group", "restart", 400).unwrap();
        assert_eq!(runtime.profile_snapshot("keys").unwrap().runtime.item_timers["timer"], 900);
        db.games[0].profiles[1].overlay_disabled = true;
        runtime.reconcile(&db, 450);
        runtime.action("keys", "overlay", "other", "restart", 500).unwrap();
        runtime.action("keys", "bar", "health", "42", 500).unwrap();
        let snapshot = runtime.profile_snapshot("keys").unwrap();
        assert!(snapshot.runtime.item_timers.is_empty());
        assert!(snapshot.runtime.values.is_empty());
    }

    #[test]
    fn shared_states_switch_clears_states_across_profiles_without_stopping_independent_timers() {
        let mut db = database();
        db.games[0].profiles[1].overlay_items.push(serde_json::from_value(serde_json::json!({"type":"timer","id":"other","x":0,"y":0,"duration_ms":2000})).unwrap());
        let mut runtime = Runtime::default(); runtime.reconcile(&db, 0);
        runtime.action("keys", "state", "buff", "set", 100).unwrap();
        runtime.action("keys", "overlay", "other", "start", 100).unwrap();
        db.games[0].states_disabled = true;
        runtime.reconcile(&db, 200);
        runtime.action("overlay", "state", "buff", "set", 300).unwrap();
        for profile in ["keys", "overlay"] {
            let snapshot = runtime.profile_snapshot(profile).unwrap();
            assert!(snapshot.config.states_disabled);
            assert!(snapshot.runtime.timers.is_empty()); assert!(snapshot.runtime.flags.is_empty());
            assert_eq!(snapshot.runtime.item_timers["other"], 2100);
        }
        db.games[0].states_disabled = false;
        runtime.reconcile(&db, 400);
        assert!(runtime.profile_snapshot("keys").unwrap().runtime.timers.is_empty());
        runtime.action("keys", "state", "buff", "set", 500).unwrap();
        assert_eq!(runtime.profile_snapshot("keys").unwrap().runtime.timers["buff"], 1500);
    }

    #[test]
    fn script_behavior_scope_depends_on_both_the_calling_section_and_script_owner() {
        let mut db = database(); let mut runtime = Runtime::default(); runtime.reconcile(&db, 0);
        let scope = ExecutionScope { profile: "keys".into(), section: "events".into(), script_owner: "overlay".into() };
        assert!(scope.is_active(&db));
        runtime.enqueue(&db, &scope, "hold(a)").unwrap();
        db.games[0].profiles[0].hotkeys_disabled = true;
        runtime.reconcile(&db, 10);
        assert_eq!(runtime.take_commands().len(), 1);
        runtime.enqueue(&db, &scope, "hold(a)").unwrap();
        db.games[0].profiles[0].events_disabled = true;
        runtime.reconcile(&db, 20);
        assert!(!scope.is_active(&db)); assert!(runtime.take_commands().is_empty());
        assert!(runtime.enqueue(&db, &scope, "hold(a)").is_err());
        db.games[0].profiles[0].events_disabled = false;
        runtime.reconcile(&db, 30);
        runtime.enqueue(&db, &scope, "hold(a)").unwrap();
        db.games[0].profiles[1].scripts_disabled = true;
        runtime.reconcile(&db, 40);
        assert!(!scope.is_active(&db)); assert!(runtime.take_commands().is_empty());
        assert!(runtime.enqueue(&db, &scope, "hold(a)").is_err());
    }

    #[test]
    fn unified_profiles_own_group_parts_and_start_stop_them_together() {
        let mut db = database();
        let profile = &mut db.games[0].profiles[1];
        profile.kind = "hotkeys".into();
        profile.overlay_groups = vec![serde_json::from_value(serde_json::json!({
            "id":"group","name":"Buff","layout":"row","visible_while_timer_id":"timer"
        })).unwrap()];
        if let OverlayItem::Timer { group_id, timer_state_id, .. } = &mut profile.overlay_items[0] {
            *group_id = Some("group".into()); *timer_state_id = None;
        }
        profile.overlay_items.push(serde_json::from_value(serde_json::json!({
            "type":"icon","id":"icon","x":0,"y":0,"w":32,"h":32,"src":null,"group_id":"group"
        })).unwrap());
        let mut runtime = Runtime::default(); runtime.reconcile(&db, 0);
        runtime.select_profile(Some("keys"));
        assert_eq!(runtime.snapshot().config.groups.len(), 1);
        runtime.action("keys", "overlay", "group", "start", 100).unwrap();
        assert_eq!(runtime.snapshot().runtime.item_timers["timer"], 600);
        runtime.action("keys", "overlay", "group", "start", 200).unwrap();
        assert_eq!(runtime.snapshot().runtime.item_timers["timer"], 600);
        runtime.action("keys", "overlay", "group", "restart", 200).unwrap();
        assert_eq!(runtime.snapshot().runtime.item_timers["timer"], 700);
        runtime.dismiss("icon").unwrap();
        assert!(runtime.snapshot().runtime.hidden_items["group"]);
        assert!(!runtime.snapshot().runtime.item_timers.contains_key("timer"));
        runtime.action("keys", "overlay", "timer", "restart", 250).unwrap();
        assert!(!runtime.snapshot().runtime.hidden_items.contains_key("group"));
        assert!(!runtime.snapshot().runtime.hidden_items.contains_key("icon"));
        runtime.action("keys", "overlay", "group", "stop", 275).unwrap();
        assert!(runtime.snapshot().runtime.hidden_items["group"]);
        assert!(!runtime.snapshot().runtime.item_timers.contains_key("timer"));
        runtime.action("keys", "overlay", "group", "restart", 300).unwrap();
        assert!(!runtime.snapshot().runtime.hidden_items.contains_key("icon"));
        runtime.set_enabled(&db, "overlay", false, 400).unwrap();
        assert!(runtime.snapshot().config.groups.is_empty());
        assert!(runtime.snapshot().runtime.item_timers.is_empty());
        assert!(runtime.action("keys", "overlay", "group", "start", 500).is_err());
    }
}
