; Legacy sequence fixtures exercise the production input primitives.
WaitForTrigger(keyStr, configuredExe := "", enabledKey := "") {
    input := BehaviorInputWait(keyStr, configuredExe, enabledKey)
    callback := input.OnInput.Bind(input)
    try {
        StartBehaviorInput(callback)
        loop {
            if IsObject(input.error)
                throw input.error
            if !BehaviorContextActive(configuredExe, enabledKey)
                return false
            if input.completed
                return true
            Sleep 10
        }
    } finally {
        StopBehaviorInput(callback)
    }
}

ExecuteBehavior(str, triggerModifiers := "", configuredExe := "", holdOwner := "", preserveHooks := false, enabledKey := "") {
    global chordHolds
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
            } else if (token = "borderless") {
                SendBehaviorCommand("borderless", configuredExe)
            } else if (token = "killprocess") {
                SendBehaviorCommand("killprocess", configuredExe)
            } else if (token = "stretch") {
                SendBehaviorCommand("stretch", configuredExe)
            } else if (token = "fit") {
                SendBehaviorCommand("fit", configuredExe)
            } else if RegExMatch(token, "i)^resolution\((\d+)\s*,\s*(\d+)\)$", &m) {
                SendBehaviorCommand("resolution", configuredExe, "&width=" m[1] "&height=" m[2])
            } else if RegExMatch(token, "i)^goto\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)$", &m) {
                SendMode "Event"
                SetMouseDelay -1
                GetGameViewport(&gameX, &gameY, &gameW, &gameH)
                MouseMove gameX + ResolveCoord(m[1], gameW), gameY + ResolveCoord(m[2], gameH), 0
            } else if RegExMatch(token, "i)^press\((.+)\)$", &m) {
                for k in StrSplit(m[1], ",")
                    DoPress(Trim(k), 30, false, preserveHooks, triggerModifiers)
                Sleep 30
            } else if RegExMatch(token, "i)^(?:mousepress|pressalt)\((.+)\)$", &m) {
                DoMousePress(Trim(m[1]), configuredExe)
                Sleep 30
            } else if RegExMatch(token, "i)^repeat\((.+?),\s*(\d+)(?:,\s*\d+)?\)$", &m) {
                DoPress(Trim(m[1]), 30, false, preserveHooks, triggerModifiers)
                Sleep 30
            } else if RegExMatch(token, "i)^hold\((.+)\)$", &m) {
                if (holdOwner = "") {
                    DoPress(Trim(m[1]), 30, false, false, triggerModifiers)
                } else {
                    HoldBehaviorKey(holdOwner, Trim(m[1]), triggerModifiers)
                }
            } else if RegExMatch(token, "i)^state\((.+)\)$", &m) {
                SendAppEvent("state_triggered", "", Trim(m[1]))
            } else if RegExMatch(token, "i)^startoverlay\((.+)\)$", &m) {
                SendAppEvent("overlay_started", "", "", Trim(m[1]))
            } else if RegExMatch(token, "i)^restartoverlay\((.+)\)$", &m) {
                SendAppEvent("overlay_restarted", "", "", Trim(m[1]))
            } else if RegExMatch(token, "i)^sleep\((\d+)\)$", &m) {
                Sleep Integer(m[1])
            } else if RegExMatch(token, "i)^waitfor\((.*)\)$", &m) {
                if !WaitForTrigger(Trim(m[1]), configuredExe, enabledKey)
                    return
            } else if RegExMatch(token, "i)^send\((.+)\)$", &m) {
                SendBehaviorText(m[1])
            }
        }
    } finally {
        if locked
            BlockInput "MouseMoveOff"
    }
}


HoldBehaviorDown(owner, behavior, chordKeys, triggerModifiers := "", configuredExe := "", enabledKey := "") {
    global chordHolds
    previousCritical := Critical()
    try {
        if chordHolds.Has(owner)
            return
        chordHolds[owner] := Map(
            "keys", "",
            "chord", chordKeys,
            "modifiers", triggerModifiers
        )
    } finally {
        Critical previousCritical
    }
    try {
        ; Keep both input hooks installed while a preceding press(...) is emitted. SendEvent at
        ; the hotkey's default input level cannot retrigger this script's hook hotkeys, and the
        ; hook retains the trigger's physical-down state until its real release.
        ExecuteBehavior(behavior, triggerModifiers, configuredExe, owner, true, enabledKey)
    } finally {
        HoldChordUp(owner)
    }
}

; A sequence resumes after the trigger's release handler has released its held outputs.
; Observe ownership, not synthesized key state, so mouse triggers and held chords use the
; same release event as standalone remaps. A trigger released during an earlier step cannot
; acquire a new hold afterward.
HoldBehaviorKey(owner, keyStr, triggerModifiers := "") {
    global chordHolds
    previousCritical := Critical()
    try {
        if !chordHolds.Has(owner)
            return
        HoldKeyDown(owner, keyStr, triggerModifiers)
    } finally {
        Critical previousCritical
    }
    while chordHolds.Has(owner)
        Sleep 10
}


ReleaseTriggerHolds(triggerKey) {
    global chordHolds
    released := []
    for owner, state in chordHolds {
        for chordKey in StrSplit(state["chord"], " ") {
            if (chordKey = triggerKey) {
                released.Push(owner)
                break
            }
        }
    }
    for owner in released
        HoldChordUp(owner)
}


DoPress(keyStr, holdMs := 30, spin := false, preserveHooks := false, triggerModifiers := "") {
    ; SendEvent keeps AutoHotkey's physical-input hooks installed. Repeat taps need those
    ; hooks throughout every synthetic input so unrelated physical releases cannot disappear.
    if preserveHooks {
        SetKeyDelay -1, -1
        SetMouseDelay -1
    }
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
    key := PhysKey(key)
    blind := BlindFor(triggerModifiers, mods)
    ; Mouse-button taps always preserve the mouse hook, even outside a repeat. Otherwise a
    ; physical button-up can race the tap's temporary logical-state restoration.
    if ((key = "m1" || key = "m2") && !preserveHooks) {
        preserveHooks := true
        SetKeyDelay -1, -1
        SetMouseDelay -1
    }
    ; If no key was given, the modifier itself is the key to press
    if (key = "") {
        if (mods = "<^")
            DoPressKey("LCtrl", preserveHooks, blind)
        else if (mods = ">^")
            DoPressKey("RCtrl", preserveHooks, blind)
        else if (mods = "^")
            DoPressKey("Ctrl", preserveHooks, blind)
        else if (mods = "<+")
            DoPressKey("LShift", preserveHooks, blind)
        else if (mods = ">+")
            DoPressKey("RShift", preserveHooks, blind)
        else if (mods = "+")
            DoPressKey("Shift", preserveHooks, blind)
        else if (mods = "<!")
            DoPressKey("LAlt", preserveHooks, blind)
        else if (mods = ">!")
            DoPressKey("RAlt", preserveHooks, blind)
        else if (mods = "!")
            DoPressKey("Alt", preserveHooks, blind)
        else if (mods = "<#")
            DoPressKey("LWin", preserveHooks, blind)
        else if (mods = ">#")
            DoPressKey("RWin", preserveHooks, blind)
        else if (mods = "#")
            DoPressKey("LWin", preserveHooks, blind)
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
    winKey := InStr(mods, ">#") ? "RWin" : InStr(mods, "#") ? "LWin" : ""
    ctrlOwned := false
    shiftOwned := false
    altOwned := false
    winOwned := false
    try {
        ; Acquire inside the protected region so a failed send cannot strand an earlier modifier.
        ctrlOwned := AcquireModifier(ctrlKey, preserveHooks, blind)
        shiftOwned := AcquireModifier(shiftKey, preserveHooks, blind)
        altOwned := AcquireModifier(altKey, preserveHooks, blind)
        winOwned := AcquireModifier(winKey, preserveHooks, blind)
        if (key = "m1" || key = "m2") {
            phys := (key = "m1") ? "LButton" : "RButton"
            wasHeld := GetKeyState(phys, "P")
            if mirroredMouseDown.Has(phys)
                ReleaseMirroredMouse(phys, preserveHooks)
            else if wasHeld
                SendKeyEvents(blind "{" phys " Up}", preserveHooks)
            Sleep 30
            SendOwnedKeyDown(phys, preserveHooks, "Down", blind)
            try {
                Sleep 30
            } finally {
                SendOwnedKeyUp(phys, preserveHooks, blind)
            }
            ; With the hook preserved, do not restore a logical mouse-down after the user
            ; physically released the button during this tap. The mirror remains owner-tracked
            ; so a release racing this check is still observed and forwarded as an up.
            if (wasHeld && GetKeyState(phys, "P"))
                MirrorPhysicalMouseDown(phys, preserveHooks)
            return
        }
        if (mods != "")
            Sleep 20
        SendOwnedKeyDown(key, preserveHooks, "Down", blind)
        try {
            if (spin)
                SpinHold(holdMs)  ; precise sub-Sleep-granularity hold for the repeat tap
            else
                Sleep holdMs
        } finally {
            SendOwnedKeyUp(key, preserveHooks, blind)  ; always release, even if the hold throws
        }
        if (mods != "")
            Sleep 20
    } finally {
        ReleaseModifier(winKey, winOwned, preserveHooks, blind)
        ReleaseModifier(altKey, altOwned, preserveHooks, blind)
        ReleaseModifier(shiftKey, shiftOwned, preserveHooks, blind)
        ReleaseModifier(ctrlKey, ctrlOwned, preserveHooks, blind)
    }
}


MirrorPhysicalMouseDown(keyName, preserveHooks) {
    global mirroredMouseDown
    mirroredMouseDown[keyName] := true
    SendOwnedKeyDown(keyName, preserveHooks)
    SetTimer CheckMirroredMouseReleases, 10
}

ReleaseMirroredMouse(keyName, preserveHooks := true) {
    global mirroredMouseDown
    SendOwnedKeyUp(keyName, preserveHooks)
    if mirroredMouseDown.Has(keyName)
        mirroredMouseDown.Delete(keyName)
}

CheckMirroredMouseReleases(*) {
    global mirroredMouseDown
    released := []
    for keyName in mirroredMouseDown {
        if !GetKeyState(keyName, "P")
            released.Push(keyName)
    }
    for keyName in released
        ReleaseMirroredMouse(keyName)
    if (mirroredMouseDown.Count = 0)
        SetTimer CheckMirroredMouseReleases, 0
}

DoPressKey(keyName, preserveHooks := false, blind := "{Blind}") {
    if GetKeyState(keyName)
        return
    SendOwnedKeyDown(keyName, preserveHooks, "DownTemp", blind)
    try {
        Sleep 30
    } finally {
        if !GetKeyState(keyName, "P")
            SendOwnedKeyUp(keyName, preserveHooks, blind)
    }
}

; Acquire only modifier state that this action owns. A macro must never release a modifier
; which was already held by the user or by the Copilot remap.
