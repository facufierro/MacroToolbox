use std::path::{Path, PathBuf};
use std::process::{Child, Command};

use crate::config::{self, Profile};

const GLOBAL_GAME_EXE: &str = "*";

/// Default precise key-down duration (ms) for a repeat tap when the behavior doesn't
/// specify one. Kept small so a game that acts on the key per frame registers ~one press.
const DEFAULT_REPEAT_HOLD_MS: u64 = 6;

/// Always-on remap of the Microsoft Copilot key to Right Ctrl, run as its own persistent
/// AutoHotkey process. The Copilot key fires LWin+LShift+F23 (scancode SC06E) ~1ms apart;
/// this 3-state machine holds LWin/LShift for 30ms and, only if the Copilot scancode
/// follows, turns the whole thing into Right Ctrl. Real Win/Shift presses pass through
/// untouched (after a ~30ms delay). Based on the open-source `copilot-key-fix` script.
pub const COPILOT_FIX_SCRIPT: &str = r#"#Requires AutoHotkey v2.0
#SingleInstance Force

global state := "idle"
global shiftSuppressed := false

; LWin: intercept and hold briefly to see whether the Copilot key's F23 follows.
$*LWin::{
    global state
    state := "waiting"
    SetTimer(PassKeys, -30)
}

$*LWin up::{
    global state, shiftSuppressed
    if state = "waiting" {
        SetTimer(PassKeys, 0)
        state := "idle"
        if shiftSuppressed {
            shiftSuppressed := false
            SendInput "{LWin down}{LShift down}{LWin up}"
        } else {
            SendInput "{LWin down}{LWin up}"
        }
    } else if state = "lwin_passed" {
        state := "idle"
        SendInput "{LWin up}"
    }
}

; LShift: only swallow it while we're waiting to see the Copilot key.
$*LShift::{
    global state, shiftSuppressed
    if state = "waiting" {
        shiftSuppressed := true
    } else {
        shiftSuppressed := false
        SendInput "{LShift down}"
    }
}

$*LShift up::{
    global shiftSuppressed
    if shiftSuppressed {
        shiftSuppressed := false
    } else {
        SendInput "{LShift up}"
    }
}

; 30ms passed without F23 -> these were real Win/Shift presses; pass them through.
PassKeys() {
    global state, shiftSuppressed
    if state = "waiting" {
        state := "lwin_passed"
        if shiftSuppressed {
            shiftSuppressed := false
            SendInput "{LWin down}{LShift down}"
        } else {
            SendInput "{LWin down}"
        }
    }
}

; F23 (scancode SC06E) = the Copilot key -> hold Right Ctrl.
$*SC06E::{
    global state, shiftSuppressed
    SetTimer(PassKeys, 0)
    state := "copilot"
    shiftSuppressed := false
    SendInput "{RCtrl down}"
}

$*SC06E up::{
    global state
    if state = "copilot" {
        state := "idle"
        SendInput "{RCtrl up}"
    }
}

; Safety: release everything if this script exits cleanly.
OnExit(ReleaseHeld)
ReleaseHeld(*) {
    SendInput "{RCtrl up}{LWin up}{LShift up}"
}
"#;

pub struct AhkManager {
    process: Option<Child>,
    bundled_ahk_exe: Option<PathBuf>,
}

impl AhkManager {
    pub fn new(resource_dir: Option<PathBuf>) -> Self {
        Self {
            process: None,
            bundled_ahk_exe: resource_dir
                .map(|dir| dir.join("resources").join("autohotkey").join("AutoHotkey64.exe"))
                .filter(|path| path.exists()),
        }
    }

    pub fn launch(&mut self, ahk_exe: &str, script_path: &Path) -> Result<(), String> {
        // Kill old process in the background so we don't block waiting for it to exit.
        // AHK's #SingleInstance Force also causes the old instance to exit on its own.
        if let Some(mut old) = self.process.take() {
            std::thread::spawn(move || {
                let _ = old.kill();
                let _ = old.wait();
            });
        }

        // AutoHotkeyUX.exe is a launcher that spawns a child and exits — use the v2
        // interpreter directly so we can track the process.
        let exe = resolve_ahk_exe(ahk_exe, self.bundled_ahk_exe.as_deref());

        let child = Command::new(&exe)
            .arg(script_path)
            .spawn()
            .map_err(|e| format!("Failed to launch '{exe}': {e}. Check the bundled AutoHotkey file or the path in Settings."))?;
        self.process = Some(child);
        Ok(())
    }

    pub fn kill(&mut self) {
        if let Some(mut child) = self.process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn is_running(&mut self) -> bool {
        if let Some(child) = self.process.as_mut() {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
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

pub fn generate_script(
    exe: &str,
    overlay_enabled: bool,
    toggle_hotkeys_key: Option<&str>,
    toggle_overlay_key: Option<&str>,
    profiles: &[Profile],
    profile: &Profile,
) -> String {
    let global_game = exe.trim() == GLOBAL_GAME_EXE;
    let resolved = config::resolve_profile_hotkeys(profiles, profile);
    let mut hotkey_lines = String::new();

    for hk in resolved {
        let ahk_key = trigger_to_key(&hk.trigger);
        if ahk_key.is_empty() { continue; }
        let trigger = escape_ahk_string(&hk.trigger);

        // A behavior that is exactly one hold(...) becomes a true held remap: the key
        // stays down while the hotkey is held. That needs a release signal, so emit a
        // wildcard key-up hotkey (fires on the trigger's main key going up regardless
        // of modifier order) next to the press hotkey.
        if let (Some(hold_arg), Some(up_key)) = (parse_pure_hold(&hk.behavior), up_hotkey(&hk.trigger)) {
            let keys = escape_ahk_string(&hold_arg);
            hotkey_lines.push_str(&format!(
                "{ahk_key}:: {{\n    SendAppEvent(\"hotkey_triggered\", \"{trigger}\")\n    HoldKeyDown(\"{keys}\")\n}}\n{up_key}:: HoldKeyUp(\"{keys}\")\n"
            ));
            continue;
        }

        // A behavior that is exactly one repeat(...) becomes a hold-to-repeat: the key is
        // pressed every `interval` ms while the trigger is held. The timer stops itself when
        // the trigger's physical key is released (polled each tick), so NO key-up hotkey is
        // emitted: a `*key up` hotkey gets re-triggered by the key-up events this repeat
        // injects, which tears down and restarts the timer on every OS key-repeat — making
        // the repeat run at the OS key-repeat rate instead of the configured interval.
        if let Some((repeat_keys, interval, hold)) = parse_pure_repeat(&hk.behavior) {
            let poll_key = trigger_bare_key(&hk.trigger);
            if !poll_key.is_empty() {
                let keys = escape_ahk_string(&repeat_keys);
                let poll_key = escape_ahk_string(&poll_key);
                // Per-app scopes must keep the repeat confined to the game window; the loop
                // isn't gated by #HotIf, so the tick re-checks WinActive itself.
                let require_active = if global_game { "false" } else { "true" };
                hotkey_lines.push_str(&format!(
                    "{ahk_key}:: {{\n    SendAppEvent(\"hotkey_triggered\", \"{trigger}\")\n    RepeatHold(\"{keys}\", {interval}, \"{poll_key}\", {require_active}, {hold})\n}}\n"
                ));
                continue;
            }
        }

        let behavior = escape_ahk_string(&hk.behavior);
        hotkey_lines.push_str(&format!(
            "{ahk_key}:: {{\n    SendAppEvent(\"hotkey_triggered\", \"{trigger}\")\n    ExecuteBehavior(\"{behavior}\")\n}}\n"
        ));
    }

    // Only bind a toggle-hotkeys key when the user explicitly set one. Defaulting to
    // backtick would globally hijack that key in an all-scopes scope (and it is the
    // console key in many games).
    let toggle_key = toggle_hotkeys_key
        .and_then(|k| { let k = trigger_to_key(k); if k.is_empty() { None } else { Some(k) } });

    let overlay_toggle_block = toggle_overlay_key
        .filter(|_| overlay_enabled)
        .and_then(|k| { let k = trigger_to_key(k); if k.is_empty() { None } else { Some(k) } })
        .filter(|k| Some(k) != toggle_key.as_ref())
        .map(|k| format!("{k}:: ToggleEnabled()\n"))
        .unwrap_or_default();

    let game_group = if global_game {
        String::new()
    } else {
        format!("GroupAdd \"GAME\", \"ahk_exe {}\"\n", escape_ahk_string(exe))
    };
    let overlay_visibility_condition = if global_game {
        if overlay_enabled { "enabled".to_string() } else { "false".to_string() }
    } else {
        if overlay_enabled { "enabled && WinActive(\"ahk_group GAME\")".to_string() } else { "false".to_string() }
    };
    let toggle_hotkeys_line = toggle_key
        .map(|k| format!("{k}:: ToggleEnabled()\n"))
        .unwrap_or_default();
    let toggle_scope = if global_game {
        format!("{toggle_hotkeys_line}{overlay_toggle_block}")
    } else if toggle_hotkeys_line.is_empty() && overlay_toggle_block.is_empty() {
        String::new()
    } else {
        format!("#HotIf WinActive(\"ahk_group GAME\")\n{toggle_hotkeys_line}{overlay_toggle_block}#HotIf\n")
    };
    let hotkey_scope = if global_game {
        format!("#HotIf enabled\n{hotkey_lines}#HotIf\n")
    } else {
        format!("#HotIf WinActive(\"ahk_group GAME\") && enabled\n{hotkey_lines}#HotIf\n")
    };

    let header = format!(
        r###"#Requires AutoHotkey v2.0
#SingleInstance Force

CoordMode "Pixel", "Screen"
CoordMode "Mouse", "Screen"
SetTitleMatchMode 2

global enabled := true
global overlayVisible := false
{game_group}OnExit HideOverlayOnExit

SendOverlayCommand(path) {{
    try {{
        xhr := ComObject("WinHttp.WinHttpRequest.5.1")
        xhr.Open("GET", "http://127.0.0.1:17823/" path, false)
        xhr.Send()
    }} catch Error {{
    }}
}}

UriEncode(str) {{
    result := ""
    loop parse, str
    {{
        code := Ord(A_LoopField)
        if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A) || code = 0x2D || code = 0x2E || code = 0x5F || code = 0x7E)
            result .= Chr(code)
        else
            result .= Format("%{{:02X}}", code)
    }}
    return result
}}

SendAppEvent(eventType, hotkeyTrigger := "", stateId := "") {{
    path := "event?type=" UriEncode(eventType)
    if (hotkeyTrigger != "")
        path .= "&hotkey_trigger=" UriEncode(hotkeyTrigger)
    if (stateId != "")
        path .= "&state_id=" UriEncode(stateId)
    SendOverlayCommand(path)
}}

SyncOverlay(*) {{
    global enabled, overlayVisible
    shouldShow := {overlay_visibility_condition}
    if (shouldShow = overlayVisible)
        return
    overlayVisible := shouldShow
    SendOverlayCommand(shouldShow ? "show" : "hide")
}}

ToggleEnabled(*) {{
    global enabled
    enabled := !enabled
    SyncOverlay()
}}

HideOverlayOnExit(*) {{
    global overlayVisible
    if !overlayVisible
        return
    overlayVisible := false
    SendOverlayCommand("hide")
}}

SetTimer SyncOverlay, 200
SyncOverlay()

; Windows silently removes low-level hooks when the system sleeps or the hook
; times out while the process is throttled in the background (idle in the tray),
; leaving hotkeys dead even though this script is still running. Install both hooks
; up front and reinstall them on wake and whenever the keyboard hook looks dropped.
InstallKeybdHook true, true
InstallMouseHook true, true
global lastHookReinstall := 0

ReinstallHooks() {{
    global lastHookReinstall
    lastHookReinstall := A_TickCount
    InstallKeybdHook true, true
    InstallMouseHook true, true
}}

OnMessage 0x218, OnPowerBroadcast  ; WM_POWERBROADCAST

OnPowerBroadcast(wParam, lParam, msg, hwnd) {{
    ; PBT_APMRESUMESUSPEND (0x7) / PBT_APMRESUMEAUTOMATIC (0x12): just woke up.
    if (wParam = 0x7 || wParam = 0x12)
        ReinstallHooks()
}}

CheckHookHealth(*) {{
    global lastHookReinstall
    ; A_TimeIdle is the OS-wide idle time (GetLastInputInfo); A_TimeIdleKeyboard is
    ; how long this script's keyboard hook has gone without a keystroke. If the OS
    ; just registered input but the keyboard hook has been silent far longer, Windows
    ; dropped the hook - reinstall it. Watching the keyboard hook itself (instead of
    ; A_TimeIdlePhysical) keeps mouse movement from masking a dead keyboard hook,
    ; which is what left hotkeys permanently dead after idling in the tray.
    if (A_TimeIdle < 1000 && A_TimeIdleKeyboard > 10000 && A_TickCount - lastHookReinstall > 10000)
        ReinstallHooks()
}}
SetTimer CheckHookHealth, 1000

{toggle_scope}
{hotkey_scope}

"###
    );

    header + BEHAVIOR_ENGINE
}

/// Escape a string for safe embedding inside an AHK v2 double-quoted string literal.
/// The backtick is AHK's escape character, so it must be handled first; an unescaped
/// backtick (or quote / newline) in user text would otherwise terminate the string
/// early and shift every following brace, producing an unparseable script.
fn escape_ahk_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '`'  => out.push_str("``"),
            '"'  => out.push_str("`\""),
            '\n' => out.push_str("`n"),
            '\r' => out.push_str("`r"),
            '\t' => out.push_str("`t"),
            _    => out.push(ch),
        }
    }
    out
}

/// If `behavior` is exactly a single `hold(...)` action, return its inner key string.
/// A multi-step behavior (containing `;`) is not treated as a remap.
fn parse_pure_hold(behavior: &str) -> Option<String> {
    let b = behavior.trim();
    let lower = b.to_lowercase();
    if !lower.starts_with("hold(") || !b.ends_with(')') {
        return None;
    }
    let inner = b[5..b.len() - 1].trim();
    if inner.is_empty() || inner.contains(';') {
        return None;
    }
    Some(inner.to_string())
}

/// If `behavior` is exactly a single `repeat(<keys>, <interval_ms>)` action, return the
/// key string (which may carry modifiers) and the interval. A multi-step behavior
/// (containing `;`) is not treated as a hold-to-repeat.
/// Parses `repeat(<keys>, <interval>[, <hold>])`. Returns (keys, interval_ms, hold_ms).
/// `hold` (the precise key-down duration of each tap) is optional and defaults to
/// DEFAULT_REPEAT_HOLD_MS. The key part never contains a comma (modifiers are
/// space-separated), so splitting on commas is unambiguous.
fn parse_pure_repeat(behavior: &str) -> Option<(String, u64, u64)> {
    let b = behavior.trim();
    let lower = b.to_lowercase();
    if !lower.starts_with("repeat(") || !b.ends_with(')') {
        return None;
    }
    let inner = b["repeat(".len()..b.len() - 1].trim();
    if inner.contains(';') {
        return None;
    }
    let parts: Vec<&str> = inner.splitn(3, ',').collect();
    if parts.len() < 2 {
        return None;
    }
    let keys = parts[0].trim();
    let interval = parts[1].trim().parse::<u64>().ok()?;
    let hold = match parts.get(2) {
        Some(h) => h.trim().parse::<u64>().ok()?,
        None => DEFAULT_REPEAT_HOLD_MS,
    };
    if keys.is_empty() || interval == 0 {
        return None;
    }
    Some((keys.to_string(), interval, hold))
}

/// The wildcard key-up hotkey that releases a held remap, e.g. trigger "shift win f23"
/// -> "*F23 up". `*` makes it fire on the key release regardless of modifier state.
/// Returns None when the trigger resolves to no key.
fn up_hotkey(trigger: &str) -> Option<String> {
    let key = trigger_bare_key(trigger);
    if key.is_empty() { None } else { Some(format!("*{key} up")) }
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
    if let Some(rest) = key.strip_prefix('f') {
        if rest.parse::<u32>().is_ok() {
            key = format!("F{rest}");
        }
    }
    key
}

fn trigger_to_key(trigger: &str) -> String {
    let trigger = trigger.trim().to_lowercase();
    let mut mods = String::new();
    let mut key = String::new();
    let mut modifier_key = String::new();

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
            "ralt" => { mods.push_str(">!"); modifier_key = "RAlt".to_string(); }
            "win" => { mods.push('#'); modifier_key = "LWin".to_string(); }
            "lwin" => { mods.push_str("<#"); modifier_key = "LWin".to_string(); }
            "rwin" => { mods.push_str(">#"); modifier_key = "RWin".to_string(); }
            k       => key = k.to_string(),
        }
    }

    if key.is_empty() {
        return modifier_key;
    }

    if let Some(rest) = key.strip_prefix('f') {
        if rest.parse::<u32>().is_ok() {
            key = format!("F{rest}");
        }
    }

    format!("${mods}{key}")
}

const BEHAVIOR_ENGINE: &str = r###"ExecuteBehavior(str) {
    MouseGetPos &savedX, &savedY
    locked := false
    try {
        for token in StrSplit(str, ";") {
            token := Trim(token)
            if (token = "")
                continue
            if (token = "savecursor") {
                MouseGetPos &savedX, &savedY
            } else if (token = "restorecursor") {
                if locked {
                    BlockInput "MouseMoveOff"
                    locked := false
                }
                SendMode "Event"
                SetMouseDelay -1
                MouseMove savedX, savedY, 0
            } else if (token = "lock") {
                BlockInput "MouseMove"
                locked := true
            } else if RegExMatch(token, "i)^goto\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)$", &m) {
                SendMode "Event"
                SetMouseDelay -1
                GetGameViewport(&gameX, &gameY, &gameW, &gameH)
                MouseMove gameX + ResolveCoord(m[1], gameW), gameY + ResolveCoord(m[2], gameH), 0
            } else if RegExMatch(token, "i)^press\((.+)\)$", &m) {
                for k in StrSplit(m[1], ",")
                    DoPress(Trim(k))
                Sleep 30
            } else if RegExMatch(token, "i)^repeat\((.+?),\s*(\d+)(?:,\s*\d+)?\)$", &m) {
                DoPress(Trim(m[1]))
                Sleep 30
            } else if RegExMatch(token, "i)^hold\((.+)\)$", &m) {
                DoPress(Trim(m[1]))
            } else if RegExMatch(token, "i)^state\((.+)\)$", &m) {
                SendAppEvent("state_triggered", "", Trim(m[1]))
            } else if RegExMatch(token, "i)^sleep\((\d+)\)$", &m) {
                Sleep Integer(m[1])
            } else if RegExMatch(token, "i)^send\((.+)\)$", &m) {
                SendInput("{Text}" m[1])
            }
        }
    } finally {
        if locked
            BlockInput "MouseMoveOff"
    }
}

ResolveCoord(value, size) {
    numeric := Number(value)
    if (Abs(numeric) <= 100)
        return Round((numeric / 100) * size)
    return Round(numeric)
}

GetGameViewport(&x, &y, &w, &h) {
    if TryGetViewportFromApp(&x, &y, &w, &h)
        return

    WinGetClientPos &x, &y, &w, &h, "A"
    bestArea := 0

    for childHwnd in WinGetControlsHwnd("A") {
        if !DllCall("IsWindowVisible", "ptr", childHwnd, "int")
            continue

        rect := Buffer(16, 0)
        if !DllCall("GetWindowRect", "ptr", childHwnd, "ptr", rect.Ptr, "int")
            continue

        left := NumGet(rect, 0, "int")
        top := NumGet(rect, 4, "int")
        right := NumGet(rect, 8, "int")
        bottom := NumGet(rect, 12, "int")

        childX := Max(left, x)
        childY := Max(top, y)
        childRight := Min(right, x + w)
        childBottom := Min(bottom, y + h)
        childW := childRight - childX
        childH := childBottom - childY
        if (childW <= 0 || childH <= 0)
            continue

        area := childW * childH
        if (area > bestArea) {
            bestArea := area
            x := childX
            y := childY
            w := childW
            h := childH
        }
    }
}

TryGetViewportFromApp(&x, &y, &w, &h) {
    try {
        xhr := ComObject("WinHttp.WinHttpRequest.5.1")
        xhr.Open("GET", "http://127.0.0.1:17823/viewport", false)
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

DoPress(keyStr, holdMs := 30, spin := false) {
    mods := ""
    key  := ""
    for part in StrSplit(Trim(StrLower(keyStr)), " ") {
        if (part = "ctrl")
            mods .= "^"
        else if (part = "lctrl")
            mods .= "<^"
        else if (part = "rctrl")
            mods .= ">^"
        else if (part = "shift")
            mods .= "+"
        else if (part = "lshift")
            mods .= "<+"
        else if (part = "rshift")
            mods .= ">+"
        else if (part = "alt")
            mods .= "!"
        else if (part = "lalt")
            mods .= "<!"
        else if (part = "ralt")
            mods .= ">!"
        else if (part = "win")
            mods .= "#"
        else if (part = "lwin")
            mods .= "<#"
        else if (part = "rwin")
            mods .= ">#"
        else
            key := part
    }
    if RegExMatch(key, "i)^f(\d+)$", &m)
        key := "F" m[1]
    ; If no key was given, the modifier itself is the key to press
    if (key = "") {
        if (mods = "<^")
            DoPressKey("LCtrl")
        else if (mods = ">^")
            DoPressKey("RCtrl")
        else if (mods = "^")
            DoPressKey("Ctrl")
        else if (mods = "<+")
            DoPressKey("LShift")
        else if (mods = ">+")
            DoPressKey("RShift")
        else if (mods = "+")
            DoPressKey("Shift")
        else if (mods = "<!")
            DoPressKey("LAlt")
        else if (mods = ">!")
            DoPressKey("RAlt")
        else if (mods = "!")
            DoPressKey("Alt")
        else if (mods = "<#")
            DoPressKey("LWin")
        else if (mods = ">#")
            DoPressKey("RWin")
        else if (mods = "#")
            DoPressKey("LWin")
        return
    }
    ctrlKey := ""
    if InStr(mods, "<^")
        ctrlKey := "LCtrl"
    else if InStr(mods, ">^")
        ctrlKey := "RCtrl"
    else if InStr(mods, "^")
        ctrlKey := "Ctrl"
    shiftKey := ""
    if InStr(mods, "<+")
        shiftKey := "LShift"
    else if InStr(mods, ">+")
        shiftKey := "RShift"
    else if InStr(mods, "+")
        shiftKey := "Shift"
    altKey := ""
    if InStr(mods, "<!")
        altKey := "LAlt"
    else if InStr(mods, ">!")
        altKey := "RAlt"
    else if InStr(mods, "!")
        altKey := "Alt"
    if (key = "m1" || key = "m2") {
        phys    := (key = "m1") ? "LButton" : "RButton"
        wasHeld := GetKeyState(phys, "P")
        SendModState(ctrlKey,  "Down")
        SendModState(shiftKey, "Down")
        SendModState(altKey,   "Down")
        if wasHeld
            SendInput("{" phys " Up}")
        Sleep 30
        SendInput("{" phys " Down}")
        Sleep 30
        SendInput("{" phys " Up}")
        SendModState(altKey,   "Up")
        SendModState(shiftKey, "Up")
        SendModState(ctrlKey,  "Up")
        return
    }
    SendModState(ctrlKey,  "Down")
    SendModState(shiftKey, "Down")
    SendModState(altKey,   "Down")
    if (mods != "")
        Sleep 20
    SendInput("{" key " Down}")
    try {
        if (spin)
            SpinHold(holdMs)  ; precise sub-Sleep-granularity hold for the repeat tap
        else
            Sleep holdMs
    } finally {
        SendInput("{" key " Up}")   ; always release, even if the hold throws, so no key sticks
    }
    if (mods != "")
        Sleep 20
    SendModState(altKey,   "Up")
    SendModState(shiftKey, "Up")
    SendModState(ctrlKey,  "Up")
}

DoPressKey(keyName) {
    SendInput("{" keyName " Down}")
    Sleep 30
    SendInput("{" keyName " Up}")
}

; Press or release a modifier only if one is set. The SendInput is kept on its own
; line: AHK v2 misparses a "{" string literal in a one-line "if" body as a block.
SendModState(modKey, dir) {
    if (modKey != "")
        SendInput("{" modKey " " dir "}")
}

; A held remap. The press hotkey calls HoldKeyDown and a paired wildcard key-up
; hotkey calls HoldKeyUp, so the key stays down for exactly as long as the trigger is
; held (e.g. a forced Copilot key behaving as Ctrl). This mirrors how AutoHotkey
; implements native key remapping:
;   - {Blind} leaves the trigger's own modifiers untouched while sending.
;   - DownR re-presses the key on the hardware's auto-repeat so it stays down.
; A key-up hotkey is the only reliable release signal: the press hotkey suppresses
; the trigger, so its logical/physical state can't be polled for release.
HoldKeyDown(keyStr) {
    for k in HoldKeyList(keyStr)
        SendInput("{Blind}{" k " DownR}")
}

HoldKeyUp(keyStr) {
    keys := HoldKeyList(keyStr)
    i := keys.Length
    while (i >= 1) {
        SendInput("{Blind}{" keys[i] " Up}")
        i--
    }
}

HoldKeyList(keyStr) {
    held := []
    key := ""
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
        else
            key := part
    }
    if RegExMatch(key, "i)^f(\d+)$", &m)
        key := "F" m[1]
    if (key != "")
        held.Push(key)
    return held
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

; Hold-to-repeat. The press hotkey runs this loop for exactly as long as the trigger's
; physical key is held, pressing `keys` once per `interval` ms. Because it occupies the
; hotkey's single thread for the whole hold (#MaxThreadsPerHotkey is 1 by default), the
; trigger's OS key-repeat — and any key events this loop itself injects — cannot re-enter
; it, so there is only ever one loop and the rate is the interval, not the OS repeat rate.
; Each press holds the key down for exactly `holdMs` (precise busy-wait), tunable so a game
; that reads the key per frame can be made to register exactly one press per interval.
RepeatHold(keys, interval, triggerKey, requireGameActive, holdMs) {
    global enabled
    while GetKeyState(triggerKey, "P") {
        ; Pause (don't fire) while hotkeys are toggled off or the game window is not focused
        ; — so the repeat can't leak into other apps — but keep looping until release.
        if (!enabled || (requireGameActive && !WinActive("ahk_group GAME"))) {
            Sleep 15
            continue
        }
        start := A_TickCount
        DoPress(keys, holdMs, true)
        elapsed := A_TickCount - start
        if (elapsed < interval)
            Sleep interval - elapsed
    }
}"###;
