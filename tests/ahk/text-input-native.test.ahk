#Requires AutoHotkey v2.0
#SingleInstance Off
#NoTrayIcon
#Warn All, StdOut

global enabled := Map(), behaviorClipboardBackup := "", behaviorClipboardPending := false, behaviorClipboardSequence := 0
global modifierEvents := [], capturedText := "", trackModifiers := false
global releaseAtText := false, ownerReleased := false
OnError(TextInputFailure)
InstallKeybdHook true, true
callback := CallbackCreate(ObserveTextModifiers, "", 3)
hook := DllCall("SetWindowsHookExW", "Int", 13, "Ptr", callback,
    "Ptr", DllCall("GetModuleHandleW", "Ptr", 0, "Ptr"), "UInt", 0, "Ptr")
if !hook
    throw Error("Could not observe modifier transitions.")
global fixtureCleaned := false
OnExit CleanupTextFixture
try {
    SetKeyDelay -1, -1
    for scenario in [{secure: false, release: false}, {secure: true, release: false}, {secure: false, release: true}, {secure: true, release: true}] {
        secure := scenario.secure
        fixtureText := "fixture-only +!^{Enter};ø"
        if secure
            fixtureCredential := SecureCredentialFixture(fixtureText)
        ; Emulate a Ctrl supplied by another remapper, without registering a
        ; persistent AHK DownR owner. The observer consumes all fixture text.
        DllCall("keybd_event", "UChar", 0xA3, "UChar", 0x1D, "UInt", 1, "UPtr", 0)
        Sleep 20
        if !(DllCall("GetAsyncKeyState", "Int", 0xA3, "Short") & 0x8000)
            throw Error("The test Ctrl hold was not established.")
        modifierEvents := [], capturedText := "", trackModifiers := true
        releaseAtText := scenario.release, ownerReleased := false
        if secure
            SendSecureText(fixtureCredential.id, "*")
        else
            SendBehaviorText(fixtureText)
        Sleep 20
        trackModifiers := false
        if scenario.release {
            if !ownerReleased || !modifierEvents.Length
                throw Error("The owner's mid-send Ctrl release was not observed.")
            for event in modifierEvents
                if !(event.flags & 0x80)
                    throw Error("Literal text reasserted Ctrl after its owner's mid-send release.")
        } else if modifierEvents.Length
            throw Error("Literal text released or reasserted the held Ctrl modifier: events=" modifierEvents.Length " firstVk=" modifierEvents[1].vk " flags=" modifierEvents[1].flags)
        if !!(DllCall("GetAsyncKeyState", "Int", 0xA3, "Short") & 0x8000) = scenario.release
            throw Error("Literal text did not preserve its owner's Ctrl state.")
        if capturedText != fixtureText
            throw Error("Literal text changed while Ctrl was held.")
        DllCall("keybd_event", "UChar", 0xA3, "UChar", 0x1D, "UInt", 3, "UPtr", 0)
        Sleep 20
        if DllCall("GetAsyncKeyState", "Int", 0xA3, "Short") & 0x8000
            throw Error("Ctrl remained down after its owner's release.")
        FileAppend("PASS: " (secure ? "Secure send" : "Type text") (scenario.release ? " respects Ctrl released during output." : " preserves external Ctrl without extra modifier events.") "`n", "*")
    }
} finally CleanupTextFixture()
ExitApp 0

CleanupTextFixture(*) {
    global trackModifiers, fixtureCleaned
    if fixtureCleaned
        return
    fixtureCleaned := true
    trackModifiers := false
    DllCall("keybd_event", "UChar", 0xA3, "UChar", 0x1D, "UInt", 3, "UPtr", 0)
    DllCall("UnhookWindowsHookEx", "Ptr", hook)
    CallbackFree callback
}

Assert(condition, message) {
    if !condition
        throw Error(message)
}

FixtureWinGetProcessName(*) {
    return "MacroToolbox-fixture.exe"
}

ObserveTextModifiers(code, message, data) {
    global capturedText, releaseAtText, ownerReleased
    if code >= 0 && trackModifiers {
        vk := NumGet(data, 0, "UInt"), flags := NumGet(data, 8, "UInt")
        if (vk = 0xA3 || vk = 0xA2) && (flags & 0x10)
            modifierEvents.Push({vk: vk, flags: flags})
        else if flags & 0x10 {
            if vk = 0xE7 && !(flags & 0x80) {
                capturedText .= Chr(NumGet(data, 4, "UInt"))
                if releaseAtText {
                    releaseAtText := false, ownerReleased := true
                    DllCall("keybd_event", "UChar", 0xA3, "UChar", 0x1D, "UInt", 3, "UPtr", 0)
                }
            }
            ; Consume fixture output before it can reach any application.
            return 1
        }
    }
    return DllCall("CallNextHookEx", "Ptr", 0, "Int", code, "Ptr", message, "Ptr", data, "Ptr")
}

TextInputFailure(failure, *) {
    FileAppend("FAIL: " failure.Message "`n", "*")
    ExitApp 1
}
