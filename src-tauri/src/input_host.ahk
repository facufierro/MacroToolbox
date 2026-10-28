#Requires AutoHotkey v2.0
#SingleInstance Force
#NoTrayIcon
A_MaxHotkeysPerInterval := 1000
CoordMode "Pixel", "Screen"
CoordMode "Mouse", "Screen"
SetTitleMatchMode 2

global enabled := Map(), syntheticDown := Map(), chordHolds := Map(), heldOutputCounts := Map()
global copilotState := {phase: GetKeyState("LWin", "P") ? "win_held" : "idle", input: "",
    shiftHeld: GetKeyState("LShift", "P"), shiftHeldBefore: false, winHeldBefore: false}
global copilotShiftSuppressed := false, copilotCtrlHeld := false, copilotCtrlReleasePending := false
global behaviorClipboardBackup := "", behaviorClipboardPending := false, behaviorClipboardSequence := 0
global behaviorRuntime := BehaviorExecutor(), runtimeHost := BindingHost()
OnExit behaviorRuntime.Stop.Bind(behaviorRuntime)
OnExit ReleaseSyntheticHeld
OnExit ReleaseCopilotHeld
OnExit RestoreBehaviorClipboard
ReleaseStaleCopilotModifiers()
SetTimer runtimeHost.Tick.Bind(runtimeHost), 100
runtimeHost.Tick()

SendOverlayCommand(path) {
    request := ComObject("WinHttp.WinHttpRequest.5.1")
    request.Open("GET", "http://127.0.0.1:17823/" path, false)
    request.SetTimeouts(500, 500, 500, 500)
    request.Send()
    if request.Status >= 400
        throw Error(request.ResponseText)
    return request.ResponseText
}

UriEncode(value) {
    bytes := Buffer(StrPut(value, "UTF-8"))
    length := StrPut(value, bytes, "UTF-8") - 1
    result := ""
    loop length {
        code := NumGet(bytes, A_Index - 1, "UChar")
        if (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A) || InStr("-_.~", Chr(code))
            result .= Chr(code)
        else
            result .= Format("%{:02X}", code)
    }
    return result
}

; Windows silently removes low-level hooks when the system sleeps or the hook
; times out while the process is throttled in the background (idle in the tray),
; leaving hotkeys dead even though this script is still running. Install both hooks
; up front and reinstall them after a wake or a detected process stall.
InstallKeybdHook true, true
InstallMouseHook true, true
global lastHealthTick := A_TickCount

ReinstallHooks() {
    InstallKeybdHook true, true
    InstallMouseHook true, true
    ; If the old hook missed Copilot's key-up, its synthetic Ctrl belongs to that dead hook
    ; generation. Release it now; a still-held Copilot key will reacquire Ctrl on key repeat.
    ReleaseCopilotCtrl()
}

OnMessage 0x218, OnPowerBroadcast  ; WM_POWERBROADCAST

OnPowerBroadcast(wParam, lParam, msg, hwnd) {
    ; PBT_APMRESUMESUSPEND (0x7) / PBT_APMRESUMEAUTOMATIC (0x12): just woke up.
    if (wParam = 0x7 || wParam = 0x12)
        ReinstallHooks()
}

CheckHookHealth(*) {
    global lastHealthTick
    ; This 1-second timer firing far late means the process was throttled or suspended (idle in
    ; the tray under Efficiency Mode, or a real sleep). Windows drops the low-level hooks in that
    ; state, so reinstall them the instant we run again — this is what makes hotkeys recover
    ; promptly after the process resumes.
    gap := A_TickCount - lastHealthTick
    lastHealthTick := A_TickCount
    if (gap > 3000) {
        ReinstallHooks()
    }
}
SetTimer CheckHookHealth, 1000

