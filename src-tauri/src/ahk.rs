use std::path::Path;
use std::process::{Child, Command};

use crate::config::{self, Profile};

pub struct AhkManager {
    process: Option<Child>,
}

impl AhkManager {
    pub fn new() -> Self {
        Self { process: None }
    }

    pub fn launch(&mut self, ahk_exe: &str, script_path: &Path) -> Result<(), String> {
        self.kill();

        // AutoHotkeyUX.exe is a launcher that spawns a child and exits — use the v2
        // interpreter directly so we can track the process.
        let exe = resolve_ahk_exe(ahk_exe);

        let child = Command::new(&exe)
            .arg(script_path)
            .spawn()
            .map_err(|e| format!("Failed to launch '{exe}': {e}. Check the AutoHotkey path in Settings."))?;
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

fn resolve_ahk_exe(configured: &str) -> String {
    if configured.is_empty() {
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
    toggle_hotkeys_key: Option<&str>,
    toggle_overlay_key: Option<&str>,
    profiles: &[Profile],
    profile: &Profile,
) -> String {
    let resolved = config::resolve_profile_hotkeys(profiles, profile);
    let mut hotkey_lines = String::new();

    for hk in resolved {
        let ahk_key = trigger_to_key(&hk.trigger);
        if ahk_key.is_empty() { continue; }
        let behavior = hk.behavior.replace('"', "\"\"");
        let trigger = hk.trigger.replace('"', "\"\"");
        hotkey_lines.push_str(&format!(
            "{ahk_key}:: {{\n    SendAppEvent(\"hotkey_triggered\", \"{trigger}\")\n    ExecuteBehavior(\"{behavior}\")\n}}\n"
        ));
    }

    let toggle_key = toggle_hotkeys_key
        .and_then(|k| { let k = trigger_to_key(k); if k.is_empty() { None } else { Some(k) } })
        .unwrap_or_else(|| "$`".to_string());

    let overlay_toggle_block = toggle_overlay_key
        .and_then(|k| { let k = trigger_to_key(k); if k.is_empty() { None } else { Some(k) } })
        .filter(|k| k != &toggle_key)
        .map(|k| format!("{k}:: ToggleEnabled()\n"))
        .unwrap_or_default();

    let header = format!(
        r###"#Requires AutoHotkey v2.0
#SingleInstance Force

CoordMode "Pixel", "Screen"
CoordMode "Mouse", "Screen"
SetTitleMatchMode 2

global enabled := true
global overlayVisible := false
GroupAdd "GAME", "ahk_exe {exe}"
OnExit HideOverlayOnExit

SendOverlayCommand(path) {{
    try {{
        xhr := ComObject("WinHttp.WinHttpRequest.5.1")
        xhr.Open("GET", "http://127.0.0.1:17823/" path, false)
        xhr.Send()
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
    shouldShow := enabled && WinActive("ahk_group GAME")
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

#HotIf WinActive("ahk_group GAME")
{toggle_key}:: ToggleEnabled()
{overlay_toggle_block}
#HotIf

#HotIf WinActive("ahk_group GAME") && enabled
{hotkey_lines}
#HotIf

"###
    );

    header + BEHAVIOR_ENGINE
}

fn trigger_to_key(trigger: &str) -> String {
    let trigger = trigger.trim().to_lowercase();
    let mut mods = String::new();
    let mut key = String::new();

    for part in trigger.split_whitespace() {
        match part {
            "ctrl"  => mods.push('^'),
            "shift" => mods.push('+'),
            "alt"   => mods.push('!'),
            k       => key = k.to_string(),
        }
    }

    if key.is_empty() {
        return String::new();
    }

    if let Some(rest) = key.strip_prefix('f') {
        if rest.parse::<u32>().is_ok() {
            key = format!("F{rest}");
        }
    }

    format!("${mods}{key}")
}

const BEHAVIOR_ENGINE: &str = r#"ExecuteBehavior(str) {
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
    }
    return false
}

DoPress(keyStr) {
    mods := ""
    key  := ""
    for part in StrSplit(Trim(StrLower(keyStr)), " ") {
        if (part = "ctrl")
            mods .= "^"
        else if (part = "shift")
            mods .= "+"
        else if (part = "alt")
            mods .= "!"
        else
            key := part
    }
    if RegExMatch(key, "i)^f(\d+)$", &m)
        key := "F" m[1]
    if (key = "m1" || key = "m2") {
        phys    := (key = "m1") ? "LButton" : "RButton"
        wasHeld := GetKeyState(phys, "P")
        if InStr(mods, "^")
            SendInput("{Ctrl Down}")
        if InStr(mods, "+")
            SendInput("{Shift Down}")
        if InStr(mods, "!")
            SendInput("{Alt Down}")
        if wasHeld
            SendInput("{" phys " Up}")
        Sleep 30
        SendInput("{" phys " Down}")
        Sleep 30
        SendInput("{" phys " Up}")
        if InStr(mods, "!")
            SendInput("{Alt Up}")
        if InStr(mods, "+")
            SendInput("{Shift Up}")
        if InStr(mods, "^")
            SendInput("{Ctrl Up}")
        return
    }
    if InStr(mods, "^")
        SendInput("{Ctrl Down}")
    if InStr(mods, "+")
        SendInput("{Shift Down}")
    if InStr(mods, "!")
        SendInput("{Alt Down}")
    if (mods != "")
        Sleep 20
    SendInput("{" key " Down}")
    Sleep 30
    SendInput("{" key " Up}")
    if (mods != "")
        Sleep 20
    if InStr(mods, "!")
        SendInput("{Alt Up}")
    if InStr(mods, "+")
        SendInput("{Shift Up}")
    if InStr(mods, "^")
        SendInput("{Ctrl Up}")
}"#;
