#Requires AutoHotkey v2.0
#SingleInstance Off
#NoTrayIcon
#Warn All, StdOut

global copilotState := {}, copilotShiftSuppressed := false
global copilotCtrlHeld := false, copilotCtrlReleasePending := false
global heldOutputCounts := Map(), syntheticDown := Map()
global nativeEvents := [], nativeSending := false
OnError(NativeOutputFailure)

callback := CallbackCreate(ObserveNativeOutput, "", 3)
hook := DllCall("SetWindowsHookExW", "Int", 13, "Ptr", callback,
    "Ptr", DllCall("GetModuleHandleW", "Ptr", 0, "Ptr"), "UInt", 0, "Ptr")
if !hook
    throw Error("Could not install the isolated output observer.")
try {
    ; Consume test-generated events before any application receives them. Physical
    ; keyboard input passes through, and the test never changes the active window.
    nativeSending := true
    copilotState := {native: false, phase: "waiting", input: "", shiftHeld: false,
        shiftHeldBefore: false, winHeldBefore: false}
    CopilotDown()
    loop 5
        CopilotDown()
    Sleep 20
    downs := 0
    for event in nativeEvents {
        if event.vk = 0xA3 {
            AssertNative(event.sc = 0x1D && (event.flags & 1) && !(event.flags & 0x80), "Right Ctrl lost its extended down event.")
            downs++
        } else {
            AssertNative((event.vk = 0xA0 || event.vk = 0x5B) && (event.flags & 0x80),
                Format("The remap emitted an unrelated input: vk{:02X} sc{:03X} flags{:02X}.", event.vk, event.sc, event.flags))
        }
    }
    ; Blocking delivery leaves Windows' state up, so SendEvent can reconcile DownR
    ; with another down. Count/lifetime assertions belong to the state-owner tests;
    ; this fixture verifies native key codes and excludes unrelated key presses.
    AssertNative(downs >= 1, "Copilot did not emit a native Right Ctrl down.")
    FileAppend("PASS: native Copilot down emits only extended Right Ctrl and required modifier releases.`n", "*")
} finally {
    ; Consuming the down leaves Windows' state up. Keep cleanup intercepted too;
    ; its persistent-modifier reconciliation is not the native down batch under test.
    ReleaseCopilotHeld()
    nativeSending := false
    DllCall("UnhookWindowsHookEx", "Ptr", hook)
    CallbackFree callback
}
ExitApp 0

NativeTestGetKeyState(key, mode := "") {
    AssertNative(mode = "P", "Unexpected logical key-state query.")
    return false
}

ObserveNativeOutput(code, message, data) {
    if code >= 0 && nativeSending && (NumGet(data, 8, "UInt") & 0x10) {
        nativeEvents.Push({vk: NumGet(data, 0, "UInt"), sc: NumGet(data, 4, "UInt"), flags: NumGet(data, 8, "UInt")})
        return 1
    }
    return DllCall("CallNextHookEx", "Ptr", 0, "Int", code, "Ptr", message, "Ptr", data, "Ptr")
}

AssertNative(condition, message) {
    if !condition
        throw Error(message)
}

NativeOutputFailure(failure, *) {
    FileAppend("FAIL: " failure.Message "`n", "*")
    ExitApp 1
}
