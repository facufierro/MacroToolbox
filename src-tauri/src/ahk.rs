use std::path::{Path, PathBuf};
use std::process::{Child, Command};

use crate::config::{self, Profile};

const GLOBAL_GAME_EXE: &str = "*";

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
        let behavior = escape_ahk_string(&hk.behavior);
        let trigger = escape_ahk_string(&hk.trigger);
        hotkey_lines.push_str(&format!(
            "{ahk_key}:: {{\n    SendAppEvent(\"hotkey_triggered\", \"{trigger}\")\n    ExecuteBehavior(\"{behavior}\")\n}}\n"
        ));
    }

    let toggle_key = toggle_hotkeys_key
        .and_then(|k| { let k = trigger_to_key(k); if k.is_empty() { None } else { Some(k) } })
        .unwrap_or_else(|| "$`".to_string());

    let overlay_toggle_block = toggle_overlay_key
        .filter(|_| overlay_enabled)
        .and_then(|k| { let k = trigger_to_key(k); if k.is_empty() { None } else { Some(k) } })
        .filter(|k| k != &toggle_key)
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
    let toggle_scope = if global_game {
        format!("{toggle_key}:: ToggleEnabled()\n{overlay_toggle_block}")
    } else {
        format!("#HotIf WinActive(\"ahk_group GAME\")\n{toggle_key}:: ToggleEnabled()\n{overlay_toggle_block}#HotIf\n")
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

DoPress(keyStr) {
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
        if (ctrlKey  != "") SendInput("{" ctrlKey  " Down}")
        if (shiftKey != "") SendInput("{" shiftKey " Down}")
        if (altKey   != "") SendInput("{" altKey   " Down}")
        if wasHeld
            SendInput("{" phys " Up}")
        Sleep 30
        SendInput("{" phys " Down}")
        Sleep 30
        SendInput("{" phys " Up}")
        if (altKey   != "") SendInput("{" altKey   " Up}")
        if (shiftKey != "") SendInput("{" shiftKey " Up}")
        if (ctrlKey  != "") SendInput("{" ctrlKey  " Up}")
        return
    }
    if (ctrlKey  != "") SendInput("{" ctrlKey  " Down}")
    if (shiftKey != "") SendInput("{" shiftKey " Down}")
    if (altKey   != "") SendInput("{" altKey   " Down}")
    if (mods != "")
        Sleep 20
    SendInput("{" key " Down}")
    Sleep 30
    SendInput("{" key " Up}")
    if (mods != "")
        Sleep 20
    if (altKey   != "") SendInput("{" altKey   " Up}")
    if (shiftKey != "") SendInput("{" shiftKey " Up}")
    if (ctrlKey  != "") SendInput("{" ctrlKey  " Up}")
}

DoPressKey(keyName) {
    SendInput("{" keyName " Down}")
    Sleep 30
    SendInput("{" keyName " Up}")
}"###;
