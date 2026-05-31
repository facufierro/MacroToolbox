use std::path::Path;
use std::process::{Child, Command};

use crate::config::Profile;

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

pub fn generate_script(exe: &str, game_name: &str, profile: &Profile) -> String {
    let mut hotkey_lines = String::new();

    for hk in &profile.hotkeys {
        let ahk_key = trigger_to_key(&hk.trigger);
        if ahk_key.is_empty() {
            continue;
        }
        let behavior = hk.behavior.replace('"', "\"\"");
        hotkey_lines.push_str(&format!(
            "{ahk_key}:: ExecuteBehavior(\"{behavior}\")\n"
        ));
    }

    let safe_name = game_name.replace('"', "\"\"");

    let header = format!(
        r###"#Requires AutoHotkey v2.0
#SingleInstance Force

CoordMode "Pixel", "Screen"
CoordMode "Mouse", "Screen"
SetTitleMatchMode 2

global enabled := false
GroupAdd "GAME", "ahk_exe {exe}"

#HotIf WinActive("ahk_group GAME")
$`:: {{
    global enabled
    enabled := !enabled
    TrayTip(enabled ? "ON" : "OFF", "{safe_name}", 1)
}}
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
            } else if RegExMatch(token, "i)^goto\((\d+)\s*,\s*(\d+)\)$", &m) {
                SendMode "Event"
                SetMouseDelay -1
                MouseMove Integer(m[1]), Integer(m[2]), 0
            } else if RegExMatch(token, "i)^press\((.+)\)$", &m) {
                for k in StrSplit(m[1], ",")
                    DoPress(Trim(k))
                Sleep 30
            } else if RegExMatch(token, "i)^hold\((.+)\)$", &m) {
                DoPress(Trim(m[1]))
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
