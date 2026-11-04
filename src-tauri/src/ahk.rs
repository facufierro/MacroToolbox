use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};

use crate::behavior;
use crate::config::{self, Profile};

const GLOBAL_GAME_EXE: &str = "*";

/// A kill-on-close Windows Job Object holding the manager's AutoHotkey process. The manager
/// (owned by the app for its whole lifetime) holds the only handle, so if the app process dies
/// for any reason — clean quit, crash, or taskkill — the OS closes the handle and terminates the
/// AutoHotkey process. This prevents an orphaned AutoHotkey64.exe from locking the bundled
/// binary and breaking the updater. Mirrors the job used for launched user scripts.
#[cfg(target_os = "windows")]
struct AhkJob(winapi::um::winnt::HANDLE);

#[cfg(target_os = "windows")]
unsafe impl Send for AhkJob {}

#[cfg(target_os = "windows")]
impl AhkJob {
    fn new() -> Self {
        use winapi::um::jobapi2::{CreateJobObjectW, SetInformationJobObject};
        use winapi::um::winnt::{
            JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
            if !handle.is_null() {
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &mut info as *mut _ as *mut winapi::ctypes::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
            }
            AhkJob(handle)
        }
    }

    fn assign(&self, child: &Child) {
        use std::os::windows::io::AsRawHandle;
        use winapi::um::jobapi2::AssignProcessToJobObject;
        if self.0.is_null() {
            return;
        }
        unsafe {
            AssignProcessToJobObject(self.0, child.as_raw_handle() as winapi::um::winnt::HANDLE);
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for AhkJob {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { winapi::um::handleapi::CloseHandle(self.0); }
        }
    }
}

/// Keep the AutoHotkey process responsive while the app sits idle in the tray. Windows drops
/// idle background processes into EcoQoS power throttling, which adds latency to the low-level
/// keyboard hook that dispatches every hotkey — so the first keypress after an idle stretch
/// lands late (feels like a "cold start") before the throttled process spins back up. Opting
/// out of throttling and nudging the priority above idle keeps hotkey dispatch prompt.
#[cfg(target_os = "windows")]
fn keep_process_responsive(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use winapi::um::processthreadsapi::SetPriorityClass;

    const ABOVE_NORMAL_PRIORITY_CLASS: u32 = 0x0000_8000; // not in the enabled winapi features

    let handle = child.as_raw_handle() as winapi::um::winnt::HANDLE;
    if handle.is_null() {
        return;
    }
    disable_power_throttling(handle);
    unsafe { SetPriorityClass(handle, ABOVE_NORMAL_PRIORITY_CLASS); }
}

/// Ask AutoHotkey's hidden main window to close so its OnExit input cleanup runs. Returns
/// false when no window for this child exists, in which case waiting cannot help.
#[cfg(target_os = "windows")]
fn request_graceful_exit(child: &Child) -> bool {
    use winapi::shared::minwindef::{BOOL, DWORD, LPARAM, TRUE};
    use winapi::shared::windef::HWND;
    use winapi::um::winuser::{EnumWindows, GetWindowThreadProcessId, PostMessageW, WM_CLOSE};

    struct ExitRequest {
        pid: DWORD,
        posted: bool,
    }

    unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let request = &mut *(lparam as *mut ExitRequest);
        let mut window_pid = 0;
        GetWindowThreadProcessId(hwnd, &mut window_pid);
        if window_pid == request.pid && PostMessageW(hwnd, WM_CLOSE, 0, 0) != 0 {
            request.posted = true;
        }
        TRUE
    }

    let mut request = ExitRequest {
        pid: child.id(),
        posted: false,
    };
    unsafe { EnumWindows(Some(enum_window), &mut request as *mut _ as LPARAM); }
    request.posted
}

fn stop_process(mut child: Child) {
    #[cfg(target_os = "windows")]
    if request_graceful_exit(&child) {
        let deadline = Instant::now() + Duration::from_millis(750);
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(_) => break,
            }
        }
    }

    let _ = child.kill();
    let _ = child.wait();
}

/// Opt a process out of Windows EcoQoS "Efficiency Mode" power throttling. Idle in the tray with
/// no visible window, Windows throttles the app — and Efficiency Mode extends across the process
/// tree to the child AutoHotkey process that dispatches hotkeys. A throttled process's low-level
/// keyboard hook times out and Windows drops it, leaving hotkeys dead until the process is
/// scheduled again (a standalone AHK script, not being a throttled background child, never hits
/// this). Applied to BOTH the AHK child and the app process itself, so the tree stays un-throttled.
#[cfg(target_os = "windows")]
pub fn disable_power_throttling(process: winapi::um::winnt::HANDLE) {
    use winapi::um::processthreadsapi::SetProcessInformation;

    // Not in winapi 0.3.9: the ProcessPowerThrottling info class (4) and its state struct.
    // Declared locally to match <winnt.h>/<processthreadsapi.h>.
    const PROCESS_POWER_THROTTLING: u32 = 4;
    const PROCESS_POWER_THROTTLING_CURRENT_VERSION: u32 = 1;
    const PROCESS_POWER_THROTTLING_EXECUTION_SPEED: u32 = 0x1;

    #[repr(C)]
    struct ProcessPowerThrottlingState {
        version: u32,
        control_mask: u32,
        state_mask: u32,
    }

    if process.is_null() {
        return;
    }
    unsafe {
        // ControlMask selects the policy we manage; StateMask 0 = leave EcoQoS explicitly OFF.
        let mut state = ProcessPowerThrottlingState {
            version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            control_mask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            state_mask: 0,
        };
        SetProcessInformation(
            process,
            PROCESS_POWER_THROTTLING,
            &mut state as *mut _ as *mut winapi::ctypes::c_void,
            std::mem::size_of::<ProcessPowerThrottlingState>() as u32,
        );
    }
}

/// Default precise key-down duration (ms) for a repeat tap when the behavior doesn't
/// specify one. Kept small so a game that acts on the key per frame registers ~one press.

pub struct AhkManager {
    process: Option<Child>,
    expected_revision: Option<String>,
    active_revision: Option<String>,
    launched_executable: Option<String>,
    bundled_ahk_exe: Option<PathBuf>,
    #[cfg(target_os = "windows")]
    job: AhkJob,
}

impl AhkManager {
    pub fn validate(&self, configured: &str, script: &Path) -> Result<(), String> {
        let executable = resolve_ahk_exe(configured, self.bundled_ahk_exe.as_deref());
        let mut command = Command::new(&executable);
        command.args(["/ErrorStdOut", "/Validate"]).arg(script);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let output = command.output().map_err(|error| format!("Could not validate input configuration: {error}"))?;
        if !output.status.success() {
            return Err(format!("Input configuration rejected: {}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr)));
        }
        Ok(())
    }

    pub fn new(resource_dir: Option<PathBuf>) -> Self {
        Self {
            process: None,
            expected_revision: None,
            active_revision: None,
            launched_executable: None,
            bundled_ahk_exe: resource_dir
                .map(|dir| dir.join("resources").join("autohotkey").join("AutoHotkey64.exe"))
                .filter(|path| path.exists()),
            #[cfg(target_os = "windows")]
            job: AhkJob::new(),
        }
    }

    pub fn launch(&mut self, ahk_exe: &str, script_path: &Path) -> Result<(), String> {
        self.active_revision = None;
        // Let the old script release every synthetic input it owns before replacing it.
        if let Some(old) = self.process.take() {
            stop_process(old);
        }

        // AutoHotkeyUX.exe is a launcher that spawns a child and exits — use the v2
        // interpreter directly so we can track the process.
        let exe = resolve_ahk_exe(ahk_exe, self.bundled_ahk_exe.as_deref());

        let child = Command::new(&exe)
            .arg(script_path)
            .spawn()
            .map_err(|e| format!("Failed to launch '{exe}': {e}. Check the bundled AutoHotkey file or the path in Settings."))?;
        // Tie the process to a kill-on-close job so it can never outlive the app — a crash or
        // hard-kill that skips kill() would otherwise orphan this AutoHotkey process, and a
        // lingering AutoHotkey64.exe keeps the bundled binary locked so the updater's file
        // replacement fails ("Unable to uninstall!").
        #[cfg(target_os = "windows")]
        self.job.assign(&child);
        #[cfg(target_os = "windows")]
        keep_process_responsive(&child);
        self.launched_executable = Some(exe);
        self.process = Some(child);
        Ok(())
    }

    pub fn expect_revision(&mut self, revision: String) {
        if self.expected_revision.as_ref() != Some(&revision) { self.active_revision = None; }
        self.expected_revision = Some(revision);
    }
    pub fn activate_revision(&mut self, revision: String) { self.active_revision = Some(revision); }
    pub fn is_active(&mut self) -> bool { self.is_running() && self.expected_revision.is_some() && self.expected_revision == self.active_revision }
    pub fn uses_executable(&self, configured: &str) -> bool { self.launched_executable.as_deref() == Some(self.executable_path(configured).as_str()) }

    /// Resolve the configured interpreter exactly as manager-owned scripts do, including the
    /// bundled AutoHotkey v2 executable when no custom path is configured.
    pub fn executable_path(&self, configured: &str) -> String {
        resolve_ahk_exe(configured, self.bundled_ahk_exe.as_deref())
    }

    pub fn kill(&mut self) {
        self.active_revision = None;
        if let Some(child) = self.process.take() {
            stop_process(child);
        }
    }

    pub fn is_running(&mut self) -> bool {
        if let Some(child) = self.process.as_mut() {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    }

    /// Re-apply the responsiveness settings (un-throttle + priority) to the running process.
    /// The one-shot opt-out at launch doesn't hold: Windows re-applies Efficiency Mode to a
    /// background app's whole process tree each time it drops to the tray, re-throttling this
    /// AutoHotkey process. Called periodically so it stays exempt for as long as it runs.
    pub fn keep_responsive(&mut self) {
        #[cfg(target_os = "windows")]
        if let Some(child) = self.process.as_ref() {
            keep_process_responsive(child);
        }
    }
}

fn resolve_ahk_exe(configured: &str, bundled: Option<&Path>) -> String {
    if configured.is_empty() {
        if let Some(path) = bundled {
            return path.to_string_lossy().into_owned();
        }
        return "AutoHotkey.exe".to_string();
    }
    // If user pointed to AutoHotkeyUX.exe, find the real v2 interpreter next to it
    let path = std::path::Path::new(configured);
    if path.file_name().and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("AutoHotkeyUX.exe"))
        .unwrap_or(false)
    {
        // Try sibling directories: ../v2/AutoHotkey64.exe
        let candidates = ["AutoHotkey64.exe", "AutoHotkey.exe"];
        let parent = path.parent().and_then(|p| p.parent()); // UX/../ = _App/
        if let Some(base) = parent {
            for sub in &["v2", ""] {
                for name in &candidates {
                    let candidate = if sub.is_empty() {
                        base.join(name)
                    } else {
                        base.join(sub).join(name)
                    };
                    if candidate.exists() {
                        return candidate.to_string_lossy().into_owned();
                    }
                }
            }
        }
    }
    configured.to_string()
}

/// One armed profile plus the sibling slice it needs to resolve `parent_id` inheritance.
pub struct ProfileContext<'a> {
    pub siblings: &'a [Profile],
    pub profile: &'a Profile,
    pub exe: &'a str,
}

fn runtime_binding(trigger: &str, steps: Vec<behavior::Action>, toggle: bool, allow_extra: Option<bool>, section: &str) -> serde_json::Value {
    let modifiers = trigger_modifier_symbols(trigger);
    let base = trigger_to_key(trigger);
    // Controls remain reachable while behaviors own extra modifiers.
    let key = if toggle || allow_extra.unwrap_or(modifiers.is_empty()) || behavior::has_toggle(&steps) { format!("$*{}", base.trim_start_matches(&['$', '*'][..])) } else { base };
    let chord = trigger_physical_chord_keys(trigger);
    let prerequisites = trigger_chord_keys(trigger);
    serde_json::json!({"key":key, "trigger":trigger, "modifiers":modifiers, "chord":chord.join(" "),
        "prerequisites":prerequisites[..prerequisites.len().saturating_sub(1)].join(" "), "specificity":prerequisites.len().saturating_sub(1),
        "exact":allow_extra == Some(false), "toggle":toggle, "steps":steps, "section":section})
}

// A subfolder's control stays available independently of its member profiles.
pub fn subfolder_controls(game: &config::Game) -> Vec<serde_json::Value> {
    if game.exe.trim().is_empty() { return Vec::new(); }
    game.subfolders.iter().filter_map(|folder| {
        let trigger = folder.toggle_key.as_deref().filter(|key| !key.trim().is_empty())?;
        let mut binding = runtime_binding(trigger, Vec::new(), true, None, "");
        binding["subfolder"] = serde_json::json!(folder.id);
        binding["folder"] = serde_json::json!(game.id);
        Some(serde_json::json!({"id":format!("subfolder:{}:{}", game.id, folder.id), "target":game.exe.trim(),
            "armed":true,"overlay":false,"bindings":[binding],"events":{},"launchScripts":[],"sections":{},
            "revision":format!("{}:{}:{}", game.exe, trigger, folder.enabled), "subfolderEnabled":folder.enabled}))
    }).collect()
}

/// Serialize validated behavior data for the persistent input host.
pub fn runtime_config(profiles: &[ProfileContext], variables: &[config::Variable]) -> Result<String, String> {
    use serde_json::json;
    use std::hash::{Hash, Hasher};
    let mut ordered: Vec<_> = profiles.iter().collect();
    ordered.sort_by_key(|ap| ap.exe.trim() == GLOBAL_GAME_EXE);
    let mut result = Vec::new();
    for ap in ordered {
        if ap.exe.trim().is_empty() { continue; }
        let profile = ap.profile;
        let mut bindings = Vec::new();
        let mut hotkeys = Vec::new();
        for hotkey in config::resolve_profile_hotkeys(ap.siblings, profile).into_iter().filter(|_| profile.armed && !profile.hotkeys_disabled) {
            for trigger in hotkey.trigger.resolve(variables)? { hotkeys.push((hotkey, trigger)); }
        }
        hotkeys.sort_by_key(|(_, trigger)| std::cmp::Reverse(trigger_chord_keys(trigger).len()));
        for (hotkey, trigger) in hotkeys {
            let mut steps = behavior::resolve(&hotkey.behavior, variables, Some(&trigger))?;
            if profile.armed { behavior::validate(&steps, true).map_err(|error| format!("{} / {}: {error}", profile.name, trigger))?; }
            if let Some(state_id) = &hotkey.state_id { steps.push(behavior::Action::State { state_id: state_id.clone(), action: behavior::StateAction::Toggle }); }
            let extra_modifiers = hotkey.allow_extra_modifiers.or_else(|| matches!(&hotkey.trigger, crate::triggers::Trigger::Variable(_)).then_some(false));
            let mut binding = runtime_binding(&trigger, steps, false, extra_modifiers, "hotkeys");
            binding["cancelTriggers"] = json!(hotkey.cancel_triggers);
            binding["cancelOnOtherBehavior"] = json!(hotkey.cancel_on_other_behavior);
            bindings.push(binding);
        }
        for script in profile.scripts.iter().filter(|script| profile.armed && !profile.scripts_disabled && script.enabled && script.trigger == "hotkey" && !script.hotkey.trim().is_empty()) {
            bindings.push(runtime_binding(&script.hotkey, vec![behavior::Action::Script { script_id: script.id.clone() }], false, None, "scripts"));
        }
        let mut toggles = HashSet::new();
        for trigger in [profile.toggle_hotkeys_key.as_deref(), profile.toggle_overlay_key.as_deref()].into_iter().flatten().filter(|trigger| profile.armed && !trigger.trim().is_empty()) {
            if toggles.insert(trigger) { bindings.push(runtime_binding(trigger, Vec::new(), true, None, "")); }
        }
        let mut events = serde_json::Map::new();
        for event in config::resolve_profile_events(ap.siblings, profile).into_iter().filter(|_| profile.armed && !profile.events_disabled) {
            let steps = behavior::resolve(&event.behavior, variables, None)?;
            if profile.armed { behavior::validate(&steps, false)?; }
            events.insert(event.event.clone(), serde_json::to_value(steps).map_err(|error| error.to_string())?);
        }
        let mut data = json!({"id":profile.id, "target":ap.exe.trim(), "armed":profile.armed,
            "overlay":config::profile_has_overlay(ap.siblings, profile), "bindings":bindings, "events":events,
            "sections":{"hotkeys":!profile.hotkeys_disabled,"events":!profile.events_disabled,"scripts":!profile.scripts_disabled},
            "launchScripts":profile.scripts.iter().filter(|script| !profile.scripts_disabled && script.enabled && script.trigger == "launch").map(|script| script.id.clone()).collect::<Vec<_>>()});
        let mut revisions = serde_json::Map::new();
        for section in ["hotkeys", "events", "scripts"] {
            let inputs: Vec<_> = data["bindings"].as_array().unwrap().iter().filter(|binding| binding["section"].as_str() == Some(section)).collect();
            let definition = json!({"armed":profile.armed,"target":ap.exe.trim(),"enabled":profile.section_enabled(section),
                "bindings":inputs,"events":if section == "events" { Some(&data["events"]) } else { None },
                "scripts":if section == "scripts" { Some(&profile.scripts) } else { None }});
            let mut hash = std::collections::hash_map::DefaultHasher::new();
            definition.to_string().hash(&mut hash);
            revisions.insert(section.into(), json!(hash.finish().to_string()));
        }
        data["sectionRevisions"] = serde_json::Value::Object(revisions);
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        data.to_string().hash(&mut hash);
        data["revision"] = json!(hash.finish().to_string());
        result.push(data);
    }
    serde_json::to_string(&result).map_err(|error| error.to_string())
}

pub fn input_script() -> String {
    [include_str!("input_host.ahk"), COPILOT_ENGINE, BEHAVIOR_ENGINE,
        BEHAVIOR_RUNTIME, include_str!("json.ahk"), include_str!("runtime_host.ahk")].join("\n")
}

/// AutoHotkey Blind-mode exclusions for modifiers contributed by a trigger. Exclusions suppress
/// those modifiers only while output is sent, so a held trigger modifier remains usable for the
/// next keypress. RAlt includes Ctrl because Windows implements AltGr as LCtrl+RAlt.
fn trigger_modifier_symbols(trigger: &str) -> String {
    let mut symbols = String::new();
    for part in trigger.split_whitespace() {
        let required = match part.to_ascii_lowercase().as_str() {
            "ctrl" | "lctrl" | "rctrl" => "^",
            "shift" | "lshift" | "rshift" => "+",
            "alt" | "lalt" => "!",
            "ralt" => "^!",
            "win" | "lwin" | "rwin" => "#",
            _ => "",
        };
        for symbol in required.chars() {
            if !symbols.contains(symbol) {
                symbols.push(symbol);
            }
        }
    }
    symbols
}

fn is_trigger_modifier(part: &str) -> bool {
    matches!(
        part,
        "ctrl" | "lctrl" | "rctrl"
            | "shift" | "lshift" | "rshift"
            | "alt" | "lalt" | "ralt"
            | "win" | "lwin" | "rwin"
    )
}

fn normalize_trigger_key(mut key: String) -> String {
    if let Some(rest) = key.strip_prefix('f') {
        if rest.parse::<u32>().is_ok() {
            key = format!("F{rest}");
        }
    }
    if let Some(sc) = layout_scancode(&key).or_else(|| us_scancode(&key).map(String::from)) {
        key = sc;
    }
    key
}

/// Every non-modifier in a trigger, converted to the physical key name used by AHK.
/// The final key activates the binding; all earlier keys form its held chord condition.
fn trigger_chord_keys(trigger: &str) -> Vec<String> {
    trigger
        .trim()
        .to_lowercase()
        .split_whitespace()
        .filter(|part| !is_trigger_modifier(part))
        .map(|part| normalize_trigger_key(part.to_string()))
        .collect()
}

fn trigger_physical_chord_keys(trigger: &str) -> Vec<String> {
    let keys = trigger_chord_keys(trigger);
    if !keys.is_empty() {
        return keys;
    }
    let modifier_key = trigger_bare_key(trigger);
    if modifier_key.is_empty() {
        Vec::new()
    } else {
        vec![modifier_key]
    }
}

/// The bare key of a trigger with modifiers stripped, AHK-cased: "shift win f23" ->
/// "F23"; a modifier-only trigger like "win" -> "LWin".
fn trigger_bare_key(trigger: &str) -> String {
    let trigger = trigger.trim().to_lowercase();
    let mut key = String::new();
    let mut modifier_key = String::new();
    for part in trigger.split_whitespace() {
        match part {
            "ctrl"   => modifier_key = "Control".to_string(),
            "lctrl"  => modifier_key = "LControl".to_string(),
            "rctrl"  => modifier_key = "RControl".to_string(),
            "shift"  => modifier_key = "Shift".to_string(),
            "lshift" => modifier_key = "LShift".to_string(),
            "rshift" => modifier_key = "RShift".to_string(),
            "alt"    => modifier_key = "Alt".to_string(),
            "lalt"   => modifier_key = "LAlt".to_string(),
            "ralt"   => modifier_key = "RAlt".to_string(),
            "win"    => modifier_key = "LWin".to_string(),
            "lwin"   => modifier_key = "LWin".to_string(),
            "rwin"   => modifier_key = "RWin".to_string(),
            k        => key = k.to_string(),
        }
    }
    if key.is_empty() {
        return modifier_key;
    }
    normalize_trigger_key(key)
}

/// Scancode of the key that produces this character on the user's active keyboard
/// layout, so a trigger binds the key the user means by that character — on QWERTZ
/// "z" is a different physical key than on QWERTY. Letters/digits only: that is the
/// set the recorder stores as characters. Punctuation is stored by physical position
/// (e.code), so resolving it as a character would bind the wrong key (on German, "["
/// lives on AltGr+8 — not the Ü key the user actually pressed). None when the
/// character doesn't exist on the layout (e.g. Cyrillic); us_scancode is the fallback.
fn layout_scancode(key: &str) -> Option<String> {
    let mut chars = key.chars();
    let c = chars.next()?;
    if chars.next().is_some() || !c.is_ascii_alphanumeric() {
        return None;
    }
    use winapi::um::winuser::{GetKeyboardLayout, MapVirtualKeyExW, VkKeyScanExW, MAPVK_VK_TO_VSC};
    unsafe {
        let hkl = GetKeyboardLayout(0);
        let vk = VkKeyScanExW(c as u16, hkl);
        if vk == -1 {
            return None;
        }
        let sc = MapVirtualKeyExW((vk & 0xFF) as u32, MAPVK_VK_TO_VSC, hkl);
        if sc == 0 {
            return None;
        }
        Some(format!("SC{sc:03X}"))
    }
}

/// Scancode names (US-QWERTY positions) for keys whose single-character AHK names
/// resolve through the ACTIVE keyboard layout. Fallback when the character isn't on
/// the active layout — a name like "q" doesn't exist on e.g. a Cyrillic layout, so
/// the hotkey would never fire there; the US position is the best guess.
fn us_scancode(key: &str) -> Option<&'static str> {
    Some(match key {
        "a" => "SC01E", "b" => "SC030", "c" => "SC02E", "d" => "SC020",
        "e" => "SC012", "f" => "SC021", "g" => "SC022", "h" => "SC023",
        "i" => "SC017", "j" => "SC024", "k" => "SC025", "l" => "SC026",
        "m" => "SC032", "n" => "SC031", "o" => "SC018", "p" => "SC019",
        "q" => "SC010", "r" => "SC013", "s" => "SC01F", "t" => "SC014",
        "u" => "SC016", "v" => "SC02F", "w" => "SC011", "x" => "SC02D",
        "y" => "SC015", "z" => "SC02C",
        "1" => "SC002", "2" => "SC003", "3" => "SC004", "4" => "SC005",
        "5" => "SC006", "6" => "SC007", "7" => "SC008", "8" => "SC009",
        "9" => "SC00A", "0" => "SC00B",
        "-" => "SC00C", "=" => "SC00D", "[" => "SC01A", "]" => "SC01B",
        "\\" => "SC02B", ";" => "SC027", "'" => "SC028", "`" => "SC029",
        "," => "SC033", "." => "SC034", "/" => "SC035",
        _ => return None,
    })
}

fn trigger_to_key(trigger: &str) -> String {
    let trigger = trigger.trim().to_lowercase();
    let mut mods = String::new();
    let mut key = String::new();
    let mut modifier_key = String::new();
    // On AltGr layouts RAlt always comes with a synthetic LCtrl held, which would
    // block a non-wildcard ralt hotkey from ever firing; `*` tolerates it (AHK
    // still prefers a non-wildcard hotkey when one matches exactly).
    let mut altgr = false;

    for part in trigger.split_whitespace() {
        match part {
            "ctrl"  => { mods.push('^'); modifier_key = "Control".to_string(); }
            "lctrl" => { mods.push_str("<^"); modifier_key = "LControl".to_string(); }
            "rctrl" => { mods.push_str(">^"); modifier_key = "RControl".to_string(); }
            "shift" => { mods.push('+'); modifier_key = "Shift".to_string(); }
            "lshift" => { mods.push_str("<+"); modifier_key = "LShift".to_string(); }
            "rshift" => { mods.push_str(">+"); modifier_key = "RShift".to_string(); }
            "alt"   => { mods.push('!'); modifier_key = "Alt".to_string(); }
            "lalt" => { mods.push_str("<!"); modifier_key = "LAlt".to_string(); }
            "ralt" => { mods.push_str(">!"); modifier_key = "RAlt".to_string(); altgr = true; }
            "win" => { mods.push('#'); modifier_key = "LWin".to_string(); }
            "lwin" => { mods.push_str("<#"); modifier_key = "LWin".to_string(); }
            "rwin" => { mods.push_str(">#"); modifier_key = "RWin".to_string(); }
            k       => key = k.to_string(),
        }
    }

    let wild = if altgr { "*" } else { "" };
    if key.is_empty() {
        if modifier_key.is_empty() {
            return modifier_key;
        }
        return format!("{wild}{modifier_key}");
    }

    key = normalize_trigger_key(key);

    format!("${wild}{mods}{key}")
}

const COPILOT_ENGINE: &str = r###"WindowsOwnsCopilotKey() {
    return RegRead("HKCU\Software\Microsoft\Windows\Shell\BrandedKey", "BrandedKeyChoiceType", "") = "RightControl"
}

SendCopilotKeys(keys) {
    previousDelay := A_KeyDelay, previousDuration := A_KeyDuration
    previousSendLevel := SendLevel(1)
    ; Modifier handoffs must finish before the next physical key reaches the app.
    SetKeyDelay -1, -1
    try SendEvent(keys)
    finally {
        SetKeyDelay previousDelay, previousDuration
        SendLevel(previousSendLevel)
    }
}

ReleaseStaleCopilotModifiers() {
    global copilotState
    if copilotState.native
        return
    if !GetKeyState("RCtrl", "P")
        SendCopilotKeys("{Blind}{RCtrl up}")
    if !GetKeyState("LWin", "P")
        SendCopilotKeys("{Blind}{LWin up}")
    if !GetKeyState("LShift", "P")
        SendCopilotKeys("{Blind}{LShift up}")
}

ReleaseCopilotCtrl() {
    global copilotCtrlHeld, copilotCtrlReleasePending, heldOutputCounts, syntheticDown
    if !copilotCtrlHeld
        return
    copilotCtrlHeld := false
    if heldOutputCounts.Has("RCtrl") {
        syntheticDown["RCtrl"] := true
        return
    }
    ; A physical Right Ctrl owns its hold until its own release; clear our DownR afterward.
    if GetKeyState("RCtrl", "P") {
        copilotCtrlReleasePending := true
        SetTimer CheckCopilotRelease, 10
    } else {
        copilotCtrlReleasePending := false
        SetTimer CheckCopilotRelease, 0
        SendCopilotKeys("{Blind}{RCtrl up}")
    }
}

ReleaseCopilotHeld(*) {
    global copilotState, copilotCtrlReleasePending
    if copilotState.native
        return
    SetTimer PassCopilotKeys, 0
    StopCopilotPrefix()
    ReleaseCopilotCtrl()
    if copilotCtrlReleasePending && !GetKeyState("RCtrl", "P")
        SendCopilotKeys("{Blind}{RCtrl up}")
    copilotCtrlReleasePending := false
    if !GetKeyState("LWin", "P")
        SendCopilotKeys("{Blind}{LWin up}")
    if !GetKeyState("LShift", "P")
        SendCopilotKeys("{Blind}{LShift up}")
}

CheckCopilotRelease(*) {
    global copilotCtrlReleasePending, heldOutputCounts, syntheticDown
    if !copilotCtrlReleasePending {
        SetTimer CheckCopilotRelease, 0
        return
    }
    if !GetKeyState("RCtrl", "P") {
        copilotCtrlReleasePending := false
        SetTimer CheckCopilotRelease, 0
        if heldOutputCounts.Has("RCtrl")
            syntheticDown["RCtrl"] := true
        else
            SendCopilotKeys("{Blind}{RCtrl up}")
    }
}

StopCopilotPrefix() {
    global copilotState
    if IsObject(copilotState.input)
        copilotState.input.Stop()
    copilotState.input := ""
}

CopilotPrefixKey(direction, input, vk, sc) {
    global copilotState
    ; The first non-chord key proves this is an ordinary Win shortcut. Its event was blocked
    ; until this callback, so Win always reaches Windows before that key, even within 30 ms.
    if IsObject(copilotState.input) && copilotState.input == input
        PassCopilotKeys()
    SendCopilotKeys(Format("{Blind}{vk{:02X}sc{:03X} " direction "}", vk, sc))
}

PassCopilotKeys() {
    global copilotState, copilotShiftSuppressed
    if copilotState.phase != "waiting"
        return
    copilotState.phase := "win_held"
    SetTimer PassCopilotKeys, 0
    StopCopilotPrefix()
    keys := "{Blind}{LWin downR}"
    if copilotShiftSuppressed && GetKeyState("LShift", "P") {
        copilotState.shiftHeld := true
        keys .= "{LShift downR}"
    }
    copilotShiftSuppressed := false
    SendCopilotKeys(keys)
}

CopilotWinDown() {
    global copilotState
    copilotState.winHeldBefore := copilotState.phase = "win_held"
    copilotState.shiftHeldBefore := copilotState.shiftHeld
    copilotState.phase := "waiting"
    StopCopilotPrefix()
    input := InputHook("V")
    input.MinSendLevel := 101
    input.KeyOpt("{All}", "SN")
    input.KeyOpt("{LWin}{LShift}{F23}{SC06E}", "-SN+V")
    input.OnKeyDown := CopilotPrefixKey.Bind("down")
    input.OnKeyUp := CopilotPrefixKey.Bind("up")
    copilotState.input := input
    input.Start()
    SetTimer PassCopilotKeys, -30
}

CopilotWinUp() {
    global copilotState
    if copilotState.phase = "copilot" && copilotState.winHeldBefore && !GetKeyState("LWin", "P") {
        copilotState.winHeldBefore := false
        SendCopilotKeys("{Blind}{LWin up}")
    }
    if copilotState.phase = "waiting"
        PassCopilotKeys()
    if copilotState.phase = "win_held" {
        copilotState.phase := "idle"
        SendCopilotKeys("{Blind}{LWin up}")
    }
}

CopilotShiftDown() {
    global copilotShiftSuppressed
    copilotShiftSuppressed := true
}

ObserveCopilotShiftDown() {
    global copilotState
    copilotState.shiftHeld := true
}

ObserveCopilotShiftUp() {
    global copilotState, copilotShiftSuppressed
    copilotState.shiftHeld := false
    copilotShiftSuppressed := false
}

CopilotDown() {
    global copilotState, copilotShiftSuppressed
    global copilotCtrlHeld, copilotCtrlReleasePending
    if copilotCtrlHeld
        return
    previousCritical := Critical()
    try {
        ; Ownership was captured at Win-down. A prefix timeout may have passed this
        ; chord's Win/Shift already; those are still Copilot modifiers to neutralize.
        SetTimer PassCopilotKeys, 0
        copilotState.phase := "copilot"
        copilotShiftSuppressed := false
        copilotCtrlHeld := true
        copilotCtrlReleasePending := false
        SetTimer CheckCopilotRelease, 0
        keys := "{Blind}"
        ; The Win prefix is suppressed or already modified by Copilot's Shift.
        ; An extra menu-mask keystroke would become the game's first input.
        if !copilotState.shiftHeldBefore
            keys .= "{LShift up}"
        if !copilotState.winHeldBefore
            keys .= "{LWin up}"
        SendCopilotKeys(keys "{RCtrl downR}")
    } finally {
        ; Keep the prefix suppressing physical keys until Right Ctrl is delivered.
        ; Critical defers their callbacks so replay observes the completed handoff.
        try StopCopilotPrefix()
        finally Critical previousCritical
    }
}

CopilotUp() {
    global copilotState
    if copilotState.phase = "copilot"
        copilotState.phase := copilotState.winHeldBefore ? "win_held" : "idle"
    ReleaseCopilotCtrl()
}

; Our level-1 sends must reach Windows and level-0 profile hotkeys without retriggering the
; modifier filters. Physical Shift outside the Copilot prefix always passes through.
#InputLevel 1
#HotIf !copilotState.native
$*LWin::CopilotWinDown()
$*LWin up::CopilotWinUp()
#HotIf !copilotState.native && copilotState.phase = "waiting"
$*LShift::CopilotShiftDown()
#HotIf !copilotState.native
~$*LShift::ObserveCopilotShiftDown()
~$*LShift up::ObserveCopilotShiftUp()
#InputLevel 0
$*SC06E::CopilotDown()
$*SC06E up::CopilotUp()
#HotIf
"###;

const BEHAVIOR_RUNTIME: &str = include_str!("behavior_runtime.ahk");

const BEHAVIOR_ENGINE: &str = r###"; Resolve a single-character key name for sending. When the character exists on the
; active layout, keep the name: AHK then picks that layout's key (and shift state), so
; "y" types y on QWERTZ too — a fixed US scancode would press the wrong key there.
; The US-QWERTY scancode is only a fallback for layouts where the character doesn't
; exist at all (e.g. Cyrillic), where the name would fail to resolve.
PhysKey(key) {
    static sc := Map(
        "a", "SC01E", "b", "SC030", "c", "SC02E", "d", "SC020",
        "e", "SC012", "f", "SC021", "g", "SC022", "h", "SC023",
        "i", "SC017", "j", "SC024", "k", "SC025", "l", "SC026",
        "m", "SC032", "n", "SC031", "o", "SC018", "p", "SC019",
        "q", "SC010", "r", "SC013", "s", "SC01F", "t", "SC014",
        "u", "SC016", "v", "SC02F", "w", "SC011", "x", "SC02D",
        "y", "SC015", "z", "SC02C",
        "1", "SC002", "2", "SC003", "3", "SC004", "4", "SC005",
        "5", "SC006", "6", "SC007", "7", "SC008", "8", "SC009",
        "9", "SC00A", "0", "SC00B",
        "-", "SC00C", "=", "SC00D", "[", "SC01A", "]", "SC01B",
        "\", "SC02B", ";", "SC027", "'", "SC028", "``", "SC029",
        ",", "SC033", ".", "SC034", "/", "SC035")
    if sc.Has(key) {
        try {
            if (GetKeySC(key))
                return key
        }
        return sc[key]
    }
    return key
}

; AltGr's synthesized LCtrl is part of RAlt, but other undeclared modifiers are not.
TriggerModifiersAllowed(trigger, requireHeld := false, ownModifiers := "") {
    global copilotCtrlHeld
    static keys := Map("ctrl", "LCtrl RCtrl", "lctrl", "LCtrl", "rctrl", "RCtrl",
        "shift", "LShift RShift", "lshift", "LShift", "rshift", "RShift",
        "alt", "LAlt RAlt", "lalt", "LAlt", "ralt", "LCtrl RAlt",
        "win", "LWin RWin", "lwin", "LWin", "rwin", "RWin")
    allowed := " "
    for part in StrSplit(RegExReplace(StrLower(Trim(trigger)), "\s+", " "), " ") {
        if keys.Has(part) {
            allowed .= keys[part] " "
            if requireHeld {
                held := false
                for key in StrSplit(part = "ralt" ? "RAlt" : keys[part], " ")
                    held := held || GetKeyState(key)
                if !held
                    return false
            }
        }
    }
    for key in ["LCtrl", "RCtrl", "LShift", "RShift", "LAlt", "RAlt", "LWin", "RWin"]
        if GetKeyState(key) && !InStr(allowed, " " key " ")
            && !(InStr(ownModifiers, " " key " ") && !GetKeyState(key, "P") && !(key = "RCtrl" && copilotCtrlHeld))
            return false
    return true
}

; Exclude only trigger modifiers which are absent from the output. AutoHotkey releases those
; modifiers around this send and restores them immediately afterward, so holding a trigger
; modifier continues to work for subsequent keypresses.
BlindFor(triggerModifiers, outputModifiers := "") {
    for symbol in ["^", "+", "!", "#"]
        if InStr(outputModifiers, symbol)
            triggerModifiers := StrReplace(triggerModifiers, symbol)
    return "{Blind" triggerModifiers "}"
}

SendBehaviorCommand(command, configuredExe, parameters := "") {
    targetExe := configuredExe
    if (targetExe = "*") {
        try {
            targetExe := WinGetProcessName("A")
        } catch Error {
            return
        }
    }
    if (targetExe != "")
        SendOverlayCommand(command "?exe=" UriEncode(targetExe) parameters)
}

BehaviorContextActive(configuredExe, enabledKey) {
    global enabled
    if (enabledKey != "" && (!enabled.Has(enabledKey) || !enabled[enabledKey]))
        return false
    return configuredExe = "" || configuredExe = "*" || WinActive("ahk_exe " configuredExe)
}

; Latch physical transitions instead of sampling a held state: a quick click or a hotkey
; interrupting this thread can otherwise finish before KeyWait sees it. Raw input observes
; the same hardware without consuming it or replacing the shared AutoHotkey keyboard hook.
class BehaviorInputWait {
    __New(keyStr, configuredExe, enabledKey, onRelease := false, doubleClick := false, previousInput := 0) {
        if Trim(keyStr) = ""
            throw ValueError("waitfor requires a key or mouse button.")
        this.keys := HoldKeyList(RegExReplace(Trim(keyStr), "[,\s]+", " "))
        this.key := this.keys.Pop()
        this.vk := GetKeyVK(this.key)
        this.sc := GetKeySC(this.key)
        if !this.vk && !this.sc
            throw ValueError("Invalid waitfor key: " this.key)
        this.released := !GetKeyState(this.key, "P")
        this.completed := false
        this.error := 0
        this.configuredExe := configuredExe
        this.enabledKey := enabledKey
        this.onRelease := onRelease
        this.requiredClicks := doubleClick ? 2 : 1
        ; A release wait can observe an already-held input, unless the preceding
        ; wait has consumed that press. Consecutive waits need distinct presses.
        consumedPress := IsObject(previousInput) && previousInput.vk = this.vk && previousInput.sc = this.sc
        this.presses := onRelease && !consumedPress && !this.released && this.ModifiersHeld() ? 1 : 0
        this.lastPress := A_TickCount
        this.waitingRelease := this.presses > 0
    }

    Observe(down) {
        if !down {
            this.released := true
            if this.onRelease && this.waitingRelease && this.presses >= this.requiredClicks && BehaviorContextActive(this.configuredExe, this.enabledKey)
                this.completed := true
            this.waitingRelease := false
            return
        }
        if !this.released || this.completed
            return
        this.released := false
        if !BehaviorContextActive(this.configuredExe, this.enabledKey)
            return
        if !this.ModifiersHeld()
            return
        if this.requiredClicks > 1 && A_TickCount - this.lastPress > DllCall("GetDoubleClickTime", "UInt")
            this.presses := 0
        this.lastPress := A_TickCount
        this.presses++
        this.waitingRelease := true
        if !this.onRelease && this.presses >= this.requiredClicks
            this.completed := true
    }

    ModifiersHeld() {
        for prerequisite in this.keys {
            mode := RegExMatch(prerequisite, "i)^(?:L|R)?(?:Ctrl|Shift|Alt|Win)$") ? "" : "P"
            if !GetKeyState(prerequisite, mode)
                return false
        }
        return true
    }

    OnInput(wParam, lParam, msg, hwnd) {
        if this.completed || IsObject(this.error)
            return
        try this.ReadInput(lParam)
        catch Error as err
            this.error := err
        ; Leave WM_INPUT unhandled so DefWindowProc performs Windows' required cleanup.
    }

    ReadInput(lParam) {
        raw := ReadBehaviorInput(lParam)
        headerSize := 8 + 2 * A_PtrSize
        inputType := NumGet(raw, 0, "UInt")
        if inputType = 0 {
            static buttons := Map("lbutton", 1, "rbutton", 4, "mbutton", 16, "xbutton1", 64, "xbutton2", 256)
            key := StrLower(this.key)
            if !buttons.Has(key)
                return
            flags := NumGet(raw, headerSize + 4, "UShort")
            if flags & buttons[key]
                this.Observe(true)
            if flags & (buttons[key] << 1)
                this.Observe(false)
        } else if inputType = 1 {
            flags := NumGet(raw, headerSize + 2, "UShort")
            sc := NumGet(raw, headerSize, "UShort") | (flags & 2 ? 0x100 : 0)
            vk := NumGet(raw, headerSize + 6, "UShort")
            matches := this.sc ? sc = this.sc : vk = this.vk
            if RegExMatch(this.key, "i)^(Ctrl|Shift|Alt)$")
                matches := vk = this.vk
            if matches
                this.Observe(!(flags & 1))
        }
    }
}

; Native behavior input boundary. Device delivery belongs to the AHK process, always to
; A_ScriptHwnd, so concurrent waits cannot unregister each other's devices. Each wait owns
; only its message callback; Windows releases the device registration with the process.
StartBehaviorInput(callback) {
    deviceSize := 8 + A_PtrSize
    devices := Buffer(2 * deviceSize, 0)
    for index, usage in [2, 6] {
        offset := (index - 1) * deviceSize
        NumPut("UShort", 1, "UShort", usage, "UInt", 0x100, "Ptr", A_ScriptHwnd, devices, offset)
    }
    if !DllCall("RegisterRawInputDevices", "Ptr", devices, "UInt", 2, "UInt", deviceSize)
        throw OSError()
    OnMessage 0xFF, callback
}

StopBehaviorInput(callback) {
    OnMessage 0xFF, callback, 0
}

ReadBehaviorInput(handle) {
    size := 0
    headerSize := 8 + 2 * A_PtrSize
    if DllCall("GetRawInputData", "Ptr", handle, "UInt", 0x10000003, "Ptr", 0, "UInt*", &size, "UInt", headerSize, "UInt") = 0xFFFFFFFF
        throw OSError()
    raw := Buffer(size)
    if DllCall("GetRawInputData", "Ptr", handle, "UInt", 0x10000003, "Ptr", raw, "UInt*", &size, "UInt", headerSize, "UInt") = 0xFFFFFFFF
        throw OSError()
    return raw
}
; End native behavior input boundary.

WindowMouseInput(keyName, configuredExe) {
    static buttons := Map("lbutton", "Left", "rbutton", "Right", "mbutton", "Middle",
        "xbutton1", "X1", "xbutton2", "X2")
    keyName := StrLower(keyName)
    if (keyName = "m1")
        keyName := "lbutton"
    else if (keyName = "m2")
        keyName := "rbutton"
    if !buttons.Has(keyName)
        throw ValueError("mousepress requires a mouse button.")
    target := WinExist(configuredExe = "" || configuredExe = "*" ? "A" : "ahk_exe " configuredExe)
    if !target
        throw TargetError("Target window not found for mousepress.")
    return {target: target, button: buttons[keyName], keyName: keyName}
}

WindowMousePosition(target) {
    MouseGetPos &screenX, &screenY
    WinGetClientPos &clientX, &clientY,,, target
    return "X" (screenX - clientX) " Y" (screenY - clientY)
}

DoMousePress(keyName, configuredExe := "", modifierFlags := 0, doubleClick := false, deferred := false) {
    input := WindowMouseInput(keyName, configuredExe)
    operation := WindowMousePress(WindowMousePosition(input.target), input.target, input.button, input.keyName, modifierFlags, doubleClick)
    if deferred
        return operation
    try {
        while !operation.Advance()
            Sleep 5
    } finally operation.Close()
}

class WindowMouseHold {
    __New(keyName, output) {
        this.input := WindowMouseInput(keyName, output.target)
        this.flags := output.flags
        this.due := A_TickCount + 30
        this.down := false
    }

    Advance() {
        if !this.down && A_TickCount >= this.due {
            ; Publish the down before delivery so failure cleanup can release it.
            this.down := true
            this.Send(true)
        }
    }

    Up() {
        if this.down {
            this.Send(false)
            this.down := false
        }
    }

    Send(down) {
        previousDelay := A_ControlDelay
        SetControlDelay -1
        try WindowClick(WindowMousePosition(this.input.target), this.input.target, this.input.button,
            down ? "NA Pos D" : "NA Pos U", this.flags)
        finally SetControlDelay previousDelay
    }
}

class WindowMousePress {
    __New(position, target, button, keyName, flags, doubleClick) {
        global heldOutputCounts
        this.position := position, this.target := target, this.button := button
        this.keyName := keyName, this.flags := flags
        this.doubleClick := doubleClick
        this.borrowed := GetKeyState(keyName, "P") || heldOutputCounts.Has(keyName)
        this.phase := this.borrowed ? 0 : 1
        this.due := 0, this.down := false, this.closed := false
        this.cleanup := this.Close.Bind(this)
        OnExit this.cleanup
    }

    Advance() {
        if this.closed
            return true
        if A_TickCount < this.due
            return false
        if this.phase = (this.doubleClick ? 5 : 3) {
            this.Close()
            return true
        }
        ; Keep each down, release, and inter-click gap observable to an app's
        ; input loop. Queue messages like ControlClick instead of bypassing it.
        down := this.phase = 1 || this.phase = 3
        if down
            this.down := true
        this.Send(down, this.phase = 3)
        this.down := down
        this.phase++
        this.due := A_TickCount + 30
        return false
    }

    Send(down, secondDown := false, position := "", flags := unset) {
        previousDelay := A_ControlDelay
        SetControlDelay -1
        flags := flags ?? this.flags
        try WindowClick(position = "" ? this.position : position, this.target, this.button, down ? "NA Pos D" : "NA Pos U",
            flags, secondDown, this.doubleClick || flags)
        finally SetControlDelay previousDelay
    }

    ResumeHold(physicalOwner := 0, flags := 0) {
        global heldOutputCounts
        if !PhysicalOwnsOutput(this.keyName, physicalOwner) && !heldOutputCounts.Has(this.keyName)
            return
        MouseGetPos &x, &y
        WinGetClientPos &clientX, &clientY,,, this.target
        position := "X" (x - clientX) " Y" (y - clientY)
        try {
            this.Send(true, false, position, flags)
            if !PhysicalOwnsOutput(this.keyName, physicalOwner) && !heldOutputCounts.Has(this.keyName)
                this.Send(false, false, position, flags)
        } catch Error as failure {
            try this.Send(false, false, position, flags)
            throw failure
        }
    }

    Close(exitReason := "", *) {
        if this.closed
            return
        this.closed := true
        OnExit this.cleanup, 0
        this.cleanup := 0
        try {
            if this.down
                this.Send(false)
        } finally {
            if this.borrowed
                FinishMousePress(this.position, this.target, this.button, this.keyName, exitReason, this.flags)
        }
    }
}

FinishMousePress(position, target, button, keyName, exitReason := "", modifierFlags := 0, *) {
    global heldOutputCounts
    ; Reasserting a physical hold here starts another press on the clicked UI, so a
    ; later restorecursor drags it. Only an explicit hold behavior owns a remaining down.
    ; Restore cursor resumes interrupted physical holds at their saved position instead.
    ; Exit cleanup has already released those behavior-owned holds.
    held := exitReason = "" && heldOutputCounts.Has(keyName)
    previousDelay := A_ControlDelay
    SetControlDelay -1
    try WindowClick(position, target, button, held ? "NA Pos D" : "NA Pos U", modifierFlags)
    finally SetControlDelay previousDelay
}

WindowClick(position, target, button, options, flags := 0, secondDown := false, explicitMessages := false) {
    if !flags && !secondDown && !explicitMessages {
        ControlClick(position, target,, button, 1, options)
        return
    }
    ; ControlClick omits MK_CONTROL/MK_SHIFT and does not synthesize WM_*DBLCLK.
    if !RegExMatch(position, "^X(-?\d+) Y(-?\d+)$", &coordinates)
        throw ValueError("Invalid window click position.")
    point := Buffer(8)
    NumPut("Int", Integer(coordinates[1]), "Int", Integer(coordinates[2]), point)
    current := target
    loop {
        child := DllCall("ChildWindowFromPointEx", "Ptr", current, "Int64", NumGet(point, 0, "Int64"), "UInt", 7, "Ptr")
        if !child || child = current
            break
        DllCall("MapWindowPoints", "Ptr", current, "Ptr", child, "Ptr", point, "UInt", 1)
        current := child
    }
    packed := (NumGet(point, 0, "Int") & 0xFFFF) | ((NumGet(point, 4, "Int") & 0xFFFF) << 16)
    messages := Map("Left", [0x201, 1, 0], "Right", [0x204, 2, 0], "Middle", [0x207, 16, 0],
        "X1", [0x20B, 32, 1 << 16], "X2", [0x20B, 64, 2 << 16])
    message := messages[button]
    doubleMessage := secondDown && (DllCall("GetClassLongW", "Ptr", current, "Int", -26, "UInt") & 8)
    if InStr(options, " D") {
        down := doubleMessage ? message[1] + 2 : message[1]
        PostMessage down, flags | message[2] | message[3], packed,, current
    } else {
        PostMessage message[1] + 1, flags | message[3], packed,, current
    }
}

; Passwords remain outside binding data and are read only at the moment of delivery.
SendSecureText(credentialId, target := "", profile := "") {
    credential := 0, blob := 0, size := 0, password := ""
    try {
        if !RegExMatch(credentialId, "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
            throw ValueError("Invalid credential reference.")
        if !DllCall("Advapi32\CredReadW", "WStr", "MacroToolbox/SecureSend/" credentialId, "UInt", 1, "UInt", 0, "Ptr*", &credential)
            throw Error("Password unavailable.")
        size := NumGet(credential, A_PtrSize = 8 ? 32 : 24, "UInt")
        blob := NumGet(credential, A_PtrSize = 8 ? 40 : 28, "Ptr")
        if !blob || !size || Mod(size, 2) || size > 2560
            throw Error("Invalid credential data.")
        if !BehaviorContextActive(target, profile)
            throw TargetError("Target unavailable.")
        password := StrGet(blob, size // 2, "UTF-16")
        ; Never use the ordinary text action's application-specific clipboard fallback.
        SendLiteralText(password)
    } catch Error {
        ; Input APIs may include their arguments in errors. Do not forward those errors.
        throw Error("Secure send failed. Enter the password again or check the target app.")
    } finally {
        if password != ""
            DllCall("msvcrt\memset", "Ptr", StrPtr(password), "Int", 0, "UPtr", StrLen(password) * 2, "CDecl Ptr")
        password := ""
        if blob && size
            DllCall("msvcrt\memset", "Ptr", blob, "Int", 0, "UPtr", size, "CDecl Ptr")
        if credential
            DllCall("Advapi32\CredFree", "Ptr", credential)
    }
}

SendLiteralText(text) {
    global heldOutputCounts
    if text = ""
        return
    ; AHK's text sender restores its initial modifier snapshot for each character,
    ; even in Blind mode. Send only text packets so a native Ctrl-up stays up.
    ; Alt still has to be neutralized: otherwise Windows delivers system characters.
    altKeys := []
    inputSize := A_PtrSize = 8 ? 40 : 28, keyOffset := A_PtrSize = 8 ? 8 : 4
    inputs := Buffer(inputSize * 2, 0)
    loop 2 {
        offset := (A_Index - 1) * inputSize
        NumPut("UInt", 1, inputs, offset)
        ; KEY_IGNORE_LEVEL from the bundled AHK's keyboard_mouse.h: literal text
        ; must not activate SCxxx bindings for its Unicode packet scan codes.
        NumPut("UPtr", 0xFFC3D44D - A_SendLevel, inputs, offset + keyOffset + (A_PtrSize = 8 ? 16 : 12))
    }
    try {
        for key in ["LAlt", "RAlt"] {
            if GetKeyState(key) {
                altKeys.Push(key)
                SendEvent("{Blind}{" key " up}")
            }
        }
        index := 0
        while index < StrLen(text) {
            if A_IsSuspended
                return
            code := NumGet(StrPtr(text), index++ * 2, "UShort")
            if code = 13 && index < StrLen(text) && NumGet(StrPtr(text), index * 2, "UShort") = 10
                index++
            vk := code = 13 || code = 10 ? 13 : code = 9 || code = 8 ? code : 0
            scan := vk ? 0 : code, flags := vk ? 0 : 4
            loop 2 {
                offset := (A_Index - 1) * inputSize + keyOffset
                NumPut("UShort", vk, "UShort", scan, "UInt", flags | (A_Index = 2 ? 2 : 0), inputs, offset)
            }
            SendLiteralInput(inputs, inputSize)
            if A_KeyDelay >= 0
                Sleep A_KeyDelay
        }
    } finally {
        DllCall("msvcrt\memset", "Ptr", inputs.Ptr, "Int", 0, "UPtr", inputs.Size, "CDecl Ptr")
        for key in altKeys {
            if GetKeyState(key, "P") || heldOutputCounts.Get(key, 0) || (key = "LAlt" && heldOutputCounts.Get("Alt", 0))
                SendEvent("{Blind}{" key " down}")
        }
    }
}

SendLiteralInput(inputs, inputSize) {
    sent := DllCall("SendInput", "UInt", 2, "Ptr", inputs, "Int", inputSize, "UInt")
    if sent != 2 {
        if sent = 1
            DllCall("SendInput", "UInt", 1, "Ptr", inputs.Ptr + inputSize, "Int", inputSize, "UInt")
        throw Error("Text input could not be delivered.")
    }
}

SendBehaviorText(text) {
    global behaviorClipboardBackup, behaviorClipboardPending, behaviorClipboardSequence
    try {
        activeExe := WinGetProcessName("A")
    } catch Error {
        activeExe := ""
    }

    ; WhatsApp's packaged editor does not reliably consume the KEYEVENTF_UNICODE packets used
    ; by Text mode. Paste through the clipboard there, preserving every clipboard format; other
    ; applications keep the immediate Unicode-packet path.
    if (activeExe != "WhatsApp.Root.exe" && activeExe != "WhatsApp.exe") {
        SendLiteralText(text)
        return
    }

    if !behaviorClipboardPending {
        behaviorClipboardBackup := ClipboardAll()
        behaviorClipboardPending := true
        behaviorClipboardSequence := DllCall("GetClipboardSequenceNumber", "UInt")
    }

    try {
        A_Clipboard := text
        if !ClipWait(0.5) {
            RestoreBehaviorClipboard()
            return
        }
        behaviorClipboardSequence := DllCall("GetClipboardSequenceNumber", "UInt")
        SendEvent("^v")
        ; WhatsApp reads clipboard data asynchronously after handling the paste shortcut. A
        ; one-shot timer keeps this hotkey available for another character while it does so.
        SetTimer RestoreBehaviorClipboard, -500
    } catch Error as err {
        RestoreBehaviorClipboard()
        throw err
    }
}

RestoreBehaviorClipboard(*) {
    global behaviorClipboardBackup, behaviorClipboardPending, behaviorClipboardSequence
    if !behaviorClipboardPending
        return

    ; Do not overwrite clipboard content the user copied after this macro started.
    sequenceUnchanged := behaviorClipboardSequence = DllCall("GetClipboardSequenceNumber", "UInt")
    behaviorClipboardPending := false
    behaviorClipboardSequence := 0
    if sequenceUnchanged
        try A_Clipboard := behaviorClipboardBackup
    behaviorClipboardBackup := ""
}

ResolveCoord(value, size) {
    numeric := Number(value)
    if (Abs(numeric) <= 100)
        return Round((numeric / 100) * size)
    return Round(numeric)
}

GetGameViewport(&x, &y, &w, &h, target := "") {
    if !TryGetViewportFromApp(&x, &y, &w, &h, target)
        throw TargetError("Target viewport is unavailable.")
}

TryGetViewportFromApp(&x, &y, &w, &h, target := "") {
    try {
        xhr := ComObject("WinHttp.WinHttpRequest.5.1")
        xhr.Open("GET", "http://127.0.0.1:17823/viewport?exe=" UriEncode(target), false)
        xhr.SetTimeouts(500, 500, 500, 500)
        xhr.Send()
        if (xhr.Status != 200)
            return false

        parts := StrSplit(Trim(xhr.ResponseText), ",")
        if (parts.Length != 4)
            return false

        x := Integer(parts[1])
        y := Integer(parts[2])
        w := Integer(parts[3])
        h := Integer(parts[4])
        return (w > 0 && h > 0)
    } catch Error {
        return false
    }
}

SendKeyEvents(keys, preserveHooks) {
    if preserveHooks
        SendEvent(keys)
    else
        SendInput(keys)
}

SendOwnedKeyDown(keyName, preserveHooks, downMode := "Down", blind := "{Blind}") {
    global syntheticDown
    ; Record ownership first so an ExitApp arriving between these statements can only cause
    ; a harmless extra key-up, never leave an unowned synthetic key-down behind.
    syntheticDown[keyName] := true
    SendKeyEvents(blind "{" keyName " " downMode "}", preserveHooks)
}

SendOwnedKeyUp(keyName, preserveHooks, blind := "{Blind}") {
    global syntheticDown
    output := syntheticDown.Get(keyName, 0)
    if IsObject(output)
        output.Up()
    else
        SendKeyEvents(blind "{" keyName " Up}", preserveHooks)
    if syntheticDown.Has(keyName) && syntheticDown[keyName] = output
        syntheticDown.Delete(keyName)
}

ReleaseSyntheticHeld(*) {
    global syntheticDown
    SetKeyDelay -1, -1
    SetMouseDelay -1
    ; Never cancel a real held input. Its eventual hardware key-up will clear Windows' logical
    ; state; everything not physically held is state owned solely by this script and must go up.
    for keyName in syntheticDown {
        if !GetKeyState(keyName, "P") {
            if IsObject(syntheticDown[keyName])
                syntheticDown[keyName].Up()
            else
                SendEvent("{Blind}{" keyName " Up}")
        }
    }
    syntheticDown.Clear()
}

AcquireModifier(modKey, preserveHooks := false, blind := "{Blind}") {
    if (modKey = "" || GetKeyState(modKey))
        return false
    try SendOwnedKeyDown(modKey, preserveHooks, "DownTemp", blind)
    catch Error as failure {
        if !GetKeyState(modKey, "P")
            SendOwnedKeyUp(modKey, preserveHooks, blind)
        throw failure
    }
    return true
}

ReleaseModifier(modKey, owned, preserveHooks := false, blind := "{Blind}") {
    if !owned
        return
    ; If the user physically pressed it while the action ran, their eventual physical key-up
    ; owns the release; sending one here would cancel the real held modifier.
    if !GetKeyState(modKey, "P")
        SendOwnedKeyUp(modKey, preserveHooks, blind)
}

; True while every physical keyboard key or mouse button in a recorded chord remains down.
; #HotIf uses this for the keys before the final activating key, and held/repeat actions use
; the full chord so releasing any member ends the action.
TriggerChordHeld(chordKeys) {
    for keyName in StrSplit(chordKeys, " ") {
        if (keyName != "" && !GetKeyState(keyName, "P"))
            return false
    }
    return chordKeys != ""
}

; A held remap. Its trigger owns one reference to every output until the primary key-up
; hotkey or the independent physical-release monitor observes that the trigger is no longer
; held. Reference counts let several triggers safely hold the same output. This mirrors how
; AutoHotkey implements native key remapping:
;   - Blind exclusions suppress trigger modifiers only for the output key event, then restore
;     them so a held modifier can activate another hotkey without being pressed again.
;   - Each physical trigger owns one output reference. Hardware auto-repeat is ignored so a held
;     output remains one uninterrupted down rather than repeating while the trigger stays held.
; Global key-up handlers release owners independently of profile enabled/focus conditions.
HoldKeyDown(owner, keyStr, triggerModifiers := "", ordered := true, mouseOutput := 0) {
    global chordHolds
    SetKeyDelay -1, -1
    SetMouseDelay -1
    blind := BlindFor(triggerModifiers, KeyModifierSymbols(keyStr))
    keys := HoldKeyList(keyStr)
    state := chordHolds[owner]
    for index, keyName in keys {
        ; Track each acquisition before its send can fail; later keys remain unowned.
        state["keys"] := (state["keys"] = "") ? keyName : state["keys"] " " keyName
        AcquireHeldOutput(keyName, blind, mouseOutput)
        ; Preserve the configured order as distinct transitions: the first output remains down
        ; before the next one is pressed. Some games miss simultaneous synthetic mouse downs.
        if (ordered && index < keys.Length)
            Sleep 30
    }
}

HoldKeyUp(keyStr, triggerModifiers := "", physicalOwner := 0) {
    SetKeyDelay -1, -1
    SetMouseDelay -1
    keys := HoldKeyList(keyStr)
    blind := BlindFor(triggerModifiers, KeyModifierSymbols(keyStr))
    ReleaseHeldOutputsTogether(keys, blind, physicalOwner)
}

PhysicalOwnsOutput(keyName, physicalOwner := 0) {
    return IsObject(physicalOwner) ? physicalOwner.Call(keyName) : GetKeyState(keyName, "P")
}

AcquireHeldOutput(keyName, blind, mouseOutput := 0) {
    global heldOutputCounts, syntheticDown
    count := heldOutputCounts.Has(keyName) ? heldOutputCounts[keyName] : 0
    heldOutputCounts[keyName] := count + 1
    if (count = 0) && !(RegExMatch(keyName, "i)^(?:L|R)?(?:Ctrl|Shift|Alt|Win)$") && GetKeyState(keyName)) {
        if IsObject(mouseOutput) && RegExMatch(keyName, "i)^(?:[LRM]Button|XButton[12])$")
            ; The shared output retains its delivery owner until its last holder
            ; stops, including when another behavior borrowed that mouse button.
            syntheticDown[keyName] := WindowMouseHold(keyName, mouseOutput)
        else
            SendOwnedKeyDown(keyName, true, "DownR", blind)
    }
}

AdvanceHeldOutputs(keys) {
    global syntheticDown
    for keyName in keys
        if syntheticDown.Has(keyName) && IsObject(syntheticDown[keyName])
            syntheticDown[keyName].Advance()
}

ReleaseHeldOutputsTogether(keys, blind, physicalOwner := 0) {
    global heldOutputCounts, syntheticDown, copilotCtrlHeld
    releases := []
    index := keys.Length
    while (index >= 1) {
        keyName := keys[index]
        if heldOutputCounts.Has(keyName) {
            count := heldOutputCounts[keyName]
            if (count > 1)
                heldOutputCounts[keyName] := count - 1
            else {
                heldOutputCounts.Delete(keyName)
                if syntheticDown.Has(keyName) {
                    if !PhysicalOwnsOutput(keyName, physicalOwner) && !(keyName = "RCtrl" && copilotCtrlHeld)
                        releases.Push(keyName)
                    else
                        syntheticDown.Delete(keyName)
                }
            }
        }
        index--
    }
    if (releases.Length = 0)
        return

    ; Window buttons go up before their modifiers. Native outputs still share one
    ; event batch, and failure of either delivery path must not abandon the other.
    events := blind, nativeReleases := [], failure := 0
    for keyName in releases {
        if IsObject(syntheticDown[keyName]) {
            try SendOwnedKeyUp(keyName, true, blind)
            catch Error as caught
                failure := caught
        } else {
            events .= "{" keyName " Up}"
            nativeReleases.Push(keyName)
        }
    }
    if nativeReleases.Length {
        try {
            SendKeyEvents(events, true)
            for keyName in nativeReleases
                if syntheticDown.Has(keyName) && !IsObject(syntheticDown[keyName])
                    syntheticDown.Delete(keyName)
        } catch Error as caught
            failure := caught
    }
    if IsObject(failure)
        throw failure
}

; Track every single-key or multi-input trigger independently. Global key-up handlers call
; ReleaseTriggerHolds for every physical member, so releasing any member ends its whole chord.
HoldChordDown(owner, keyStr, chordKeys, triggerModifiers := "", ordered := true, physicalOwner := 0, mouseOutput := 0) {
    global chordHolds
    ; Keep a trigger-up buffered until the ordered down sequence is complete. Otherwise a quick
    ; release during its inter-key delay could release the first output before the second is owned.
    previousCritical := Critical()
    try {
        ; Hardware auto-repeat invokes the press hotkey again while the trigger stays down.
        ; The existing owner represents that uninterrupted hold, so emit no additional downs.
        if chordHolds.Has(owner)
            return
        chordHolds[owner] := Map(
            "keys", "",
            "chord", chordKeys,
            "modifiers", triggerModifiers
        )
        HoldKeyDown(owner, keyStr, triggerModifiers, ordered, mouseOutput)
    } catch Error as err {
        HoldChordUp(owner, physicalOwner)
        throw err
    } finally {
        Critical previousCritical
    }
}

; Register before the first step so a release during the prefix also ends ownership. Only
; registration is critical: the release hotkey must be able to interrupt a waiting hold step.
HoldChordUp(owner, physicalOwner := 0) {
    global chordHolds
    if !chordHolds.Has(owner)
        return
    state := chordHolds[owner]
    chordHolds.Delete(owner)
    if (state["keys"] != "")
        HoldKeyUp(state["keys"], state["modifiers"], physicalOwner)
}

HoldKeyList(keyStr) {
    held := []
    for part in StrSplit(Trim(StrLower(keyStr)), " ") {
        if (part = "ctrl")
            held.Push("Ctrl")
        else if (part = "lctrl")
            held.Push("LCtrl")
        else if (part = "rctrl")
            held.Push("RCtrl")
        else if (part = "shift")
            held.Push("Shift")
        else if (part = "lshift")
            held.Push("LShift")
        else if (part = "rshift")
            held.Push("RShift")
        else if (part = "alt")
            held.Push("Alt")
        else if (part = "lalt")
            held.Push("LAlt")
        else if (part = "ralt")
            held.Push("RAlt")
        else if (part = "win")
            held.Push("LWin")
        else if (part = "lwin")
            held.Push("LWin")
        else if (part = "rwin")
            held.Push("RWin")
        else {
            if (part = "m1")
                part := "lbutton"
            else if (part = "m2")
                part := "rbutton"
            if RegExMatch(part, "i)^f(\d+)$", &m)
                part := "F" m[1]
            held.Push(PhysKey(part))
        }
    }
    return held
}

KeyModifierSymbols(keyStr) {
    symbols := ""
    for part in StrSplit(Trim(StrLower(keyStr)), " ") {
        if (part = "ctrl" || part = "lctrl" || part = "rctrl")
            symbols .= "^"
        else if (part = "shift" || part = "lshift" || part = "rshift")
            symbols .= "+"
        else if (part = "alt" || part = "lalt" || part = "ralt")
            symbols .= "!"
        else if (part = "win" || part = "lwin" || part = "rwin")
            symbols .= "#"
    }
    return symbols
}

; Busy-wait for `ms` milliseconds using the high-resolution performance counter. AHK's
; Sleep can't reliably hold a key for only a few ms (its granularity floors near 15ms),
; and a repeat aimed at a game that acts on a key every frame it is held needs the key
; down for a short, EXACT window (about one frame) so it registers exactly one press.
SpinHold(ms) {
    static freq := 0
    if (!freq)
        DllCall("QueryPerformanceFrequency", "Int64*", &freq)
    t0 := 0
    t := 0
    DllCall("QueryPerformanceCounter", "Int64*", &t0)
    limit := t0 + Round(ms * freq / 1000)
    loop {
        DllCall("QueryPerformanceCounter", "Int64*", &t)
    } until (t >= limit)
}

"###;

#[cfg(test)]
mod tests {
    use super::*;
    fn profile(source: &str) -> Profile {
        serde_json::from_value(serde_json::json!({"id":"profile","name":"Keys","armed":true,"hotkeys":[{"trigger":"rctrl o","behavior":source}]})).unwrap()
    }
    #[test]
    fn every_composition_uses_the_same_structured_execution_contract() {
        let profile = profile(r#"[{"type":"parallel","steps":[{"type":"hold","key":"LButton"},{"type":"repeat","key":"a","interval":"100","hold":"6"}]}]"#);
        let profiles = [ProfileContext { siblings: std::slice::from_ref(&profile), profile: &profile, exe:"Game.exe" }];
        let config: serde_json::Value = serde_json::from_str(&runtime_config(&profiles, &[]).unwrap()).unwrap();
        let binding = &config[0]["bindings"][0];
        assert_eq!(binding["steps"][0]["type"], "parallel");
        assert_eq!(binding["modifiers"], "^");
        assert_eq!(binding["trigger"], "rctrl o");
        assert_eq!(config[0]["target"], "Game.exe");
    }
    #[test]
    fn cancel_triggers_belong_to_each_hotkey_binding_and_leave_actions_unchanged() {
        let mut profile = profile("waitfor(LButton);send(done)");
        profile.hotkeys[0].cancel_triggers = vec!["RButton".into(), "Esc".into()];
        profile.hotkeys[0].cancel_on_other_behavior = true;
        profile.hotkeys[0].trigger = serde_json::from_value(serde_json::json!({"variable":"shortcuts"})).unwrap();
        let variables = [serde_json::from_value(serde_json::json!({"id":"shortcuts","name":"Shortcuts","type":"triggers","value":["e","rctrl e"]})).unwrap()];
        let contexts = [ProfileContext { siblings: std::slice::from_ref(&profile), profile: &profile, exe: "Game.exe" }];
        let data: serde_json::Value = serde_json::from_str(&runtime_config(&contexts, &variables).unwrap()).unwrap();
        let expected = serde_json::to_value(behavior::parse(&profile.hotkeys[0].behavior).unwrap()).unwrap();
        for binding in data[0]["bindings"].as_array().unwrap() {
            assert_eq!(binding["cancelTriggers"], serde_json::json!(["RButton", "Esc"]));
            assert_eq!(binding["cancelOnOtherBehavior"], true);
            assert_eq!(binding["steps"], expected);
        }
        let cancelled_revision = data[0]["sectionRevisions"]["hotkeys"].clone();
        profile.hotkeys[0].cancel_triggers.clear();
        let contexts = [ProfileContext { siblings: std::slice::from_ref(&profile), profile: &profile, exe: "Game.exe" }];
        let data: serde_json::Value = serde_json::from_str(&runtime_config(&contexts, &variables).unwrap()).unwrap();
        assert_eq!(data[0]["bindings"][0]["cancelTriggers"], serde_json::json!([]));
        assert_ne!(data[0]["sectionRevisions"]["hotkeys"], cancelled_revision);
        let enabled_revision = data[0]["sectionRevisions"]["hotkeys"].clone();
        profile.hotkeys[0].cancel_on_other_behavior = false;
        let contexts = [ProfileContext { siblings: std::slice::from_ref(&profile), profile: &profile, exe: "Game.exe" }];
        let data: serde_json::Value = serde_json::from_str(&runtime_config(&contexts, &variables).unwrap()).unwrap();
        assert_eq!(data[0]["bindings"][0]["cancelOnOtherBehavior"], false);
        assert_ne!(data[0]["sectionRevisions"]["hotkeys"], enabled_revision);
    }
    #[test]
    fn toggle_bindings_reach_the_shared_hook_with_exact_modifier_matching_preserved() {
        for toggle in [false, true] {
            let source = if toggle { r#"[{"type":"sequence","steps":[{"type":"toggle","key":"rshift w"}]}]"# } else { "hold(rshift w)" };
            let mut profile = profile(source);
            profile.hotkeys[0].allow_extra_modifiers = Some(false);
            let profiles = [ProfileContext { siblings: std::slice::from_ref(&profile), profile: &profile, exe: "Game.exe" }];
            let config: serde_json::Value = serde_json::from_str(&runtime_config(&profiles, &[]).unwrap()).unwrap();
            let binding = &config[0]["bindings"][0];
            assert_eq!(binding["key"].as_str().unwrap().starts_with("$*>^"), toggle);
            assert_eq!(binding["exact"], true);
            assert_eq!(binding["trigger"], "rctrl o");
        }
    }
    #[test]
    fn profile_controls_reach_the_hook_while_output_modifiers_are_held() {
        let mut profile = profile("press(x)");
        profile.toggle_hotkeys_key = Some("lctrl lshift `".into());
        let profiles = vec![profile];
        let contexts = [ProfileContext { siblings: &profiles, profile: &profiles[0], exe: "Game.exe" }];
        let data: serde_json::Value = serde_json::from_str(&runtime_config(&contexts, &[]).unwrap()).unwrap();
        let control = data[0]["bindings"].as_array().unwrap().iter().find(|binding| binding["toggle"] == true).unwrap();
        assert_eq!(control["key"], "$*<^<+SC029");
        assert_eq!(control["trigger"], "lctrl lshift `");
    }

    #[test]
    fn subfolder_controls_remain_available_with_no_enabled_members_and_use_the_shared_hook() {
        let mut game: config::Game = serde_json::from_value(serde_json::json!({"id":"game","name":"Game","exe":"Game.exe",
            "subfolders":[{"id":"combat","name":"Combat","enabled":false,"toggle_key":"rctrl shift n"}]})).unwrap();
        let controls = subfolder_controls(&game);
        assert_eq!(controls.len(), 1);
        assert_eq!(controls[0]["armed"], true);
        assert_eq!(controls[0]["subfolderEnabled"], false);
        assert_eq!(controls[0]["target"], "Game.exe");
        let binding = &controls[0]["bindings"][0];
        assert_eq!(binding["subfolder"], "combat");
        assert_eq!(binding["folder"], "game");
        assert_eq!(binding["toggle"], true);
        assert_eq!(binding["key"], "$*>^+n");
        assert!(binding["steps"].as_array().unwrap().is_empty());
        game.set_subfolder_enabled("combat", true).unwrap();
        assert_ne!(subfolder_controls(&game)[0]["revision"], controls[0]["revision"]);
    }
    #[test]
    fn changes_update_data_without_replacing_the_shared_hook_script() {
        let first = profile("press(x)"); let second = profile("press(y)");
        let a = [ProfileContext { siblings: std::slice::from_ref(&first), profile: &first, exe:"Game.exe" }];
        let b = [ProfileContext { siblings: std::slice::from_ref(&second), profile: &second, exe:"Game.exe" }];
        assert_eq!(input_script(), input_script());
        assert_ne!(runtime_config(&a, &[]).unwrap(), runtime_config(&b, &[]).unwrap());
    }
    #[test]
    fn shared_variables_resolve_in_inherited_bindings_and_events_and_update_revisions() {
        let mut base = profile("sleep($buff);send($buff)");
        base.id = "base".into();
        base.events = vec![config::BehaviorEvent { event: "focus_gained".into(), behavior: "sleep($buff)".into() }];
        let mut child = profile(""); child.id = "child".into(); child.parent_id = Some(base.id.clone()); child.hotkeys.clear();
        let siblings = [base, child];
        let contexts: Vec<_> = siblings.iter().map(|profile| ProfileContext { siblings: &siblings, profile, exe: "Game.exe" }).collect();
        let mut variables = [config::Variable { id: "buff".into(), name: "buff timer".into(), value: 5000.0.into() }];
        let before: serde_json::Value = serde_json::from_str(&runtime_config(&contexts, &variables).unwrap()).unwrap();
        for data in before.as_array().unwrap() {
            assert_eq!(data["bindings"][0]["steps"][0]["ms"], "5000");
            assert_eq!(data["bindings"][0]["steps"][1]["text"], "$buff");
            assert_eq!(data["events"]["focus_gained"][0]["ms"], "5000");
        }
        variables[0].name = "renamed timer".into();
        let renamed: serde_json::Value = serde_json::from_str(&runtime_config(&contexts, &variables).unwrap()).unwrap();
        assert_eq!(before, renamed);
        variables[0].value = 6000.0.into();
        let after: serde_json::Value = serde_json::from_str(&runtime_config(&contexts, &variables).unwrap()).unwrap();
        for index in 0..2 {
            assert_eq!(after[index]["bindings"][0]["steps"][0]["ms"], "6000");
            assert_ne!(before[index]["sectionRevisions"]["hotkeys"], after[index]["sectionRevisions"]["hotkeys"]);
            assert_ne!(before[index]["sectionRevisions"]["events"], after[index]["sectionRevisions"]["events"]);
            assert_eq!(before[index]["sectionRevisions"]["scripts"], after[index]["sectionRevisions"]["scripts"]);
        }
        assert_eq!(siblings[0].hotkeys[0].behavior, "sleep($buff);send($buff)");
        assert!(runtime_config(&contexts, &[]).is_err());
    }
    #[test]
    fn trigger_lists_expand_inherited_bindings_and_replay_each_matched_shortcut() {
        let source = r#"[{"type":"press","key":{"source":"trigger"},"onRelease":true},{"type":"press","key":"e"}]"#;
        let mut base = profile(source); base.id = "base".into();
        base.hotkeys[0].trigger = serde_json::from_value(serde_json::json!({"variable":"casts"})).unwrap();
        let mut child = profile(""); child.id = "child".into(); child.parent_id = Some(base.id.clone()); child.hotkeys.clear();
        let siblings = [base, child];
        let contexts: Vec<_> = siblings.iter().map(|profile| ProfileContext { siblings: &siblings, profile, exe: "Game.exe" }).collect();
        let mut variables: Vec<config::Variable> = serde_json::from_value(serde_json::json!([
            {"id":"casts","name":"Cast shortcuts","type":"triggers","value":["lctrl 1","lctrl 2","lctrl 3"]}
        ])).unwrap();
        let before: serde_json::Value = serde_json::from_str(&runtime_config(&contexts, &variables).unwrap()).unwrap();
        for data in before.as_array().unwrap() {
            let bindings = data["bindings"].as_array().unwrap();
            assert_eq!(bindings.len(), 3);
            for (index, binding) in bindings.iter().enumerate() {
                let trigger = format!("lctrl {}", index + 1);
                assert_eq!(binding["trigger"], trigger);
                assert_eq!(binding["modifiers"], "^");
                assert_eq!(binding["exact"], true);
                assert_eq!(binding["steps"], serde_json::json!([
                    {"type":"press","key":trigger,"onRelease":true},{"type":"press","key":"e"}
                ]));
            }
        }
        variables[0].name = "Renamed shortcuts".into();
        assert_eq!(runtime_config(&contexts, &variables).unwrap(), before.to_string());
        variables[0].value = crate::variables::VariableValue::Triggers(vec!["rctrl shift o".into()]);
        let after: serde_json::Value = serde_json::from_str(&runtime_config(&contexts, &variables).unwrap()).unwrap();
        for index in 0..2 {
            assert_eq!(after[index]["bindings"].as_array().unwrap().len(), 1);
            assert_eq!(after[index]["bindings"][0]["steps"][0]["key"], "rctrl shift o");
            assert_ne!(before[index]["sectionRevisions"]["hotkeys"], after[index]["sectionRevisions"]["hotkeys"]);
            assert_eq!(before[index]["sectionRevisions"]["events"], after[index]["sectionRevisions"]["events"]);
        }
        assert_eq!(siblings[0].hotkeys[0].behavior, source);
        assert!(runtime_config(&contexts, &[]).is_err());
        let mut overridden = siblings.clone();
        let mut replacement = overridden[0].hotkeys[0].clone(); replacement.behavior = "press(v)".into();
        overridden[1].hotkeys.push(replacement);
        let context = [ProfileContext { siblings: &overridden, profile: &overridden[1], exe: "Game.exe" }];
        let data: serde_json::Value = serde_json::from_str(&runtime_config(&context, &variables).unwrap()).unwrap();
        assert_eq!(data[0]["bindings"][0]["steps"][0]["key"], "v");
    }

    #[test]
    fn copied_trigger_dependent_hotkeys_stay_inactive_until_assigned_a_shortcut() {
        let source = r#"[{"type":"press","key":{"source":"trigger"},"onRelease":true},{"type":"toggle","key":"w"}]"#;
        let mut profile = profile(source);
        let mut copy = profile.hotkeys[0].clone();
        copy.trigger = "".into();
        behavior::validate(&behavior::resolve_template(&copy.behavior, &[]).unwrap(), true).unwrap();
        profile.hotkeys.push(copy);
        // Reopening saved settings must preserve the unassigned copy without registering it.
        let mut profile: Profile = serde_json::from_str(&serde_json::to_string(&profile).unwrap()).unwrap();
        let data = |profile: &Profile| -> serde_json::Value {
            let contexts = [ProfileContext { siblings: std::slice::from_ref(profile), profile, exe: "Game.exe" }];
            serde_json::from_str(&runtime_config(&contexts, &[]).unwrap()).unwrap()
        };
        let before = data(&profile);
        assert_eq!(before[0]["bindings"].as_array().unwrap().len(), 1);
        assert_eq!(before[0]["bindings"][0]["trigger"], "rctrl o");
        assert_eq!(profile.hotkeys[1].behavior, source);
        profile.hotkeys[1].trigger = "rctrl p".into();
        let after = data(&profile);
        assert_eq!(after[0]["bindings"].as_array().unwrap().len(), 2);
        let copy = after[0]["bindings"].as_array().unwrap().iter().find(|binding| binding["trigger"] == "rctrl p").unwrap();
        assert_eq!(copy["steps"][0]["key"], "rctrl p");
        assert_eq!(copy["steps"][0]["onRelease"], true);
        assert_eq!(copy["steps"][1]["type"], "toggle");
    }

    #[test]
    fn secure_send_bindings_contain_references_without_retrieving_passwords() {
        let source = r#"[{"type":"securesend","credentialId":"b8483943-e86c-41aa-a593-7388833369cd"}]"#;
        let profile = profile(source);
        let data: serde_json::Value = serde_json::from_str(&runtime_config(&[ProfileContext {
            siblings:std::slice::from_ref(&profile),profile:&profile,exe:"Game.exe"
        }], &[]).unwrap()).unwrap();
        assert_eq!(data[0]["bindings"][0]["steps"], serde_json::from_str::<serde_json::Value>(source).unwrap());
        assert!(data[0]["bindings"][0]["steps"][0].get("text").is_none());
        assert!(data[0]["bindings"][0]["steps"][0].get("password").is_none());
    }
    #[test]
    fn invalid_active_behaviors_fail_before_activation() {
        let profile = profile("repeat(a,0)");
        assert!(runtime_config(&[ProfileContext {siblings:std::slice::from_ref(&profile),profile:&profile,exe:"*"}], &[]).is_err());
    }
    #[test]
    fn disabled_drafts_do_not_register_or_validate_native_bindings() {
        let mut profile = profile("future(action)"); profile.armed = false;
        let data: serde_json::Value = serde_json::from_str(&runtime_config(&[ProfileContext {siblings:std::slice::from_ref(&profile),profile:&profile,exe:"*"}], &[]).unwrap()).unwrap();
        assert!(data[0]["bindings"].as_array().unwrap().is_empty());
    }
    #[test]
    fn exact_altgr_and_ordinary_modifiers_retain_their_meaning() {
        assert_eq!(trigger_modifier_symbols("ralt left"), "^!");
        assert_eq!(trigger_modifier_symbols("rctrl shift o"), "^+");
        assert_eq!(trigger_bare_key("ctrl"), "Control");
        assert_eq!(trigger_bare_key("lctrl"), "LControl");
        assert_eq!(trigger_bare_key("rctrl"), "RControl");
        assert_eq!(trigger_bare_key("XButton2"), "xbutton2");
    }
    #[test]
    fn copilot_and_profiles_keep_one_hook_with_the_required_send_levels() {
        let script = input_script();
        assert!(script.contains("$*SC06E::CopilotDown()"));
        assert!(script.contains("SendCopilotKeys(keys \"{RCtrl downR}\")"));
        assert!(script.contains("SendEvent(keys)"));
        assert!(script.contains("native: WindowsOwnsCopilotKey()"));
        assert!(script.contains("#HotIf !copilotState.native"));
        assert!(!COPILOT_ENGINE.contains("GetAsyncKeyState"));
    }

    #[test]
    fn every_profile_category_can_publish_overlay_parts_with_its_bindings() {
        for kind in ["hotkeys", "events", "scripts", "overlay"] {
            let mut profile = profile("press(x)"); profile.kind = kind.into();
            profile.overlay_items = vec![serde_json::from_value(serde_json::json!({"type":"text","id":"label","x":0,"y":0,"font_size":16,"color":"#fff","content":"Buff"})).unwrap()];
            let data: serde_json::Value = serde_json::from_str(&runtime_config(&[ProfileContext { siblings: std::slice::from_ref(&profile), profile: &profile, exe:"Game.exe" }], &[]).unwrap()).unwrap();
            assert_eq!(data[0]["overlay"], true);
            assert!(!data[0]["bindings"].as_array().unwrap().is_empty());
            profile.overlay_disabled = true;
            let data: serde_json::Value = serde_json::from_str(&runtime_config(&[ProfileContext { siblings: std::slice::from_ref(&profile), profile: &profile, exe:"Game.exe" }], &[]).unwrap()).unwrap();
            assert_eq!(data[0]["overlay"], false);
        }
    }

    #[test]
    fn section_switches_filter_only_their_bindings_and_keep_independent_revisions() {
        let mut profile = profile("press(x)");
        profile.events = vec![serde_json::from_value(serde_json::json!({"event":"focus_gained","behavior":"press(y)"})).unwrap()];
        profile.scripts = vec![
            serde_json::from_value(serde_json::json!({"id":"script","trigger":"hotkey","hotkey":"f9","source":"code"})).unwrap(),
            serde_json::from_value(serde_json::json!({"id":"launch","trigger":"launch","source":"code"})).unwrap(),
        ];
        let configuration = |profile: &Profile| -> serde_json::Value {
            serde_json::from_str(&runtime_config(&[ProfileContext { siblings: std::slice::from_ref(profile), profile, exe:"Game.exe" }], &[]).unwrap()).unwrap()
        };
        let before = configuration(&profile);
        profile.hotkeys_disabled = true;
        profile.hotkeys[0].behavior = "unknown(draft)".into();
        let after = configuration(&profile);
        assert_eq!(after[0]["bindings"].as_array().unwrap().len(), 1);
        assert_eq!(after[0]["bindings"][0]["section"], "scripts");
        assert_ne!(before[0]["sectionRevisions"]["hotkeys"], after[0]["sectionRevisions"]["hotkeys"]);
        assert_eq!(before[0]["sectionRevisions"]["events"], after[0]["sectionRevisions"]["events"]);
        assert_eq!(before[0]["sectionRevisions"]["scripts"], after[0]["sectionRevisions"]["scripts"]);
        profile.events_disabled = true;
        profile.scripts_disabled = true;
        let disabled = configuration(&profile);
        assert!(disabled[0]["bindings"].as_array().unwrap().is_empty());
        assert!(disabled[0]["events"].as_object().unwrap().is_empty());
        assert!(disabled[0]["launchScripts"].as_array().unwrap().is_empty());
    }
}
