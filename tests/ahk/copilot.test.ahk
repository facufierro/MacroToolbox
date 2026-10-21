#Requires AutoHotkey v2.0
#SingleInstance Off
#NoTrayIcon
#Warn All, StdOut

global copilotState := {}, copilotShiftSuppressed := false
global copilotCtrlHeld := false, copilotCtrlReleasePending := false
global physical := Map(), logical := Map(), sent := [], timers := Map(), chordModifiers := []
OnError(TestUnhandledError)

RunTest("quick Win+R forwards Win before R", TestQuickWinR)
RunTest("held Win+R forwards through the shared hook", TestHeldWinR)
RunTest("queued key-up is forwarded after the prefix stops", TestQueuedKeyUp)
RunTest("ordinary Win+Shift retains Shift", TestWinShift)
RunTest("ordinary Shift passes through", TestOrdinaryShift)
RunTest("queued Copilot modifiers do not leak", TestQueuedChord)
RunTest("Copilot+Shift+N keeps Right Ctrl and Shift", TestCopilotShiftN)
RunTest("RCtrl+O and RCtrl+Shift+O stay distinct", TestAccentModifiers)
RunTest("Copilot holds until key-up without repeat", TestHeldCopilot)
RunTest("physical Right Ctrl keeps ownership", TestPhysicalRightCtrl)
RunTest("physical Win and Shift keep ownership", TestPhysicalModifiers)
RunTest("physical Win keeps ownership without adding Shift", TestPhysicalWin)
RunTest("physical Win releases during a Copilot hold", TestPhysicalWinRelease)
RunTest("physical Shift before Copilot stays down", TestPhysicalShift)
RunTest("hook recovery releases and reacquires Right Ctrl", TestRecovery)
RunTest("exit cleanup preserves physical modifiers", TestExitCleanup)
FileAppend("All 16 Copilot tests passed." Chr(10), "*")
ExitApp 0

RunTest(name, test) {
    global copilotState, copilotShiftSuppressed, copilotCtrlHeld, copilotCtrlReleasePending
    global physical, logical, sent, timers, chordModifiers
    copilotState := {phase: "idle", input: "", shiftHeld: false, shiftHeldBefore: false, winHeldBefore: false}
    copilotShiftSuppressed := false
    copilotCtrlHeld := false
    copilotCtrlReleasePending := false
    physical := Map()
    logical := Map()
    sent := []
    timers := Map()
    chordModifiers := []
    test.Call()
    Assert(!logical.Get("RCtrl", false), name " left Right Ctrl down")
    Assert(!logical.Get("LWin", false) && !logical.Get("LShift", false), name " left Win/Shift down")
    Assert(!copilotCtrlHeld && !copilotCtrlReleasePending, name " left Ctrl owned")
    Assert(!IsObject(copilotState.input), name " left the prefix running")
    Assert(A_SendLevel = 0, name " leaked the remap send level")
    FileAppend("PASS: " name Chr(10), "*")
}

TestQuickWinR() {
    NativeDown("LWin")
    Assert(ExternalModifiers() = "", "candidate Copilot Win leaked before detection")
    NativeDown("r")
    Assert(sent[1] = "{Blind}{LWin downR}", "Win did not reach Windows before R")
    Assert(sent[2] = "{Blind}{vk52sc013 down}", "first shortcut key was lost")
    Assert(ExternalModifiers() = "Win", "quick shortcut lost Win")
    NativeUp("r")
    NativeUp("LWin")
    Assert(copilotState.phase = "idle", "quick shortcut left the prefix pending")
}

TestHeldWinR() {
    NativeDown("LWin")
    PassCopilotKeys()
    Assert(ExternalModifiers() = "Win", "held Win did not reach Windows")
    NativeDown("r")
    NativeUp("r")
    NativeUp("LWin")
    Assert(sent.Length = 2, "held Win did not have exactly one down/up pair")
}

TestQueuedKeyUp() {
    NativeDown("LWin")
    input := copilotState.input
    ; Both events were suppressed before either callback could run.
    input.OnKeyDown.Call(input, 0x52, 0x013)
    Assert(!input.InProgress, "first key did not stop the prefix")
    input.OnKeyUp.Call(input, 0x52, 0x013)
    Assert(!logical.Get("r", false), "queued key-up was lost after Stop")
    Assert(sent.Length = 3, "queued key events were lost or duplicated")
    NativeUp("LWin")
}

TestWinShift() {
    NativeDown("LWin")
    NativeDown("LShift")
    Assert(ExternalModifiers() = "", "candidate Copilot Shift leaked")
    PassCopilotKeys()
    Assert(ExternalModifiers() = "Shift Win", "ordinary Win+Shift lost a modifier")
    NativeUp("LShift")
    NativeUp("LWin")
}

TestOrdinaryShift() {
    NativeDown("LShift")
    Assert(ExternalModifiers() = "Shift", "ordinary physical Shift was withheld")
    NativeUp("LShift")
    Assert(sent.Length = 0, "ordinary Shift was replaced with synthetic input")
}

TestQueuedChord() {
    global physical
    ; Physical state may advance before the Win/Shift handler threads run. Ownership must
    ; follow observed event order, not mistake the chord's queued Shift for an existing hold.
    physical["LShift"] := true
    CopilotWinDown()
    CopilotShiftDown()
    Assert(ExternalModifiers() = "", "built-in modifiers reached the application before F23")
    CopilotDown()
    Assert(ExternalModifiers() = "RCtrl", "queued chord Shift leaked into an unshifted shortcut")
    CopilotUp()
    NativeUp("LShift")
    NativeUp("LWin")
}

TestCopilotShiftN() {
    BeginCopilot()
    Assert(ExternalModifiers() = "RCtrl", "Copilot's built-in Win/Shift leaked")
    NativeDown("LShift")
    Assert(ExternalModifiers() = "RCtrl Shift", "external Shift+N would lose Right Ctrl or Shift")
    EndCopilot()
    Assert(logical.Get("LShift", false), "Copilot release cancelled the user's Shift")
    NativeUp("LShift")
}

TestAccentModifiers() {
    BeginCopilot()
    Assert(ExternalModifiers() = "RCtrl", "rctrl o would acquire Shift")
    NativeDown("LShift")
    Assert(ExternalModifiers() = "RCtrl Shift", "rctrl shift o would lose Shift")
    NativeUp("LShift")
    Assert(ExternalModifiers() = "RCtrl", "Shift stuck after the uppercase shortcut")
    EndCopilot()
}

TestHeldCopilot() {
    BeginCopilot()
    Loop 100 {
        CopilotDown()
        CheckCopilotRelease()
    }
    Assert(sent.Length = 1, "a held Copilot repeated or released Right Ctrl")
    Assert(logical.Get("RCtrl", false), "Right Ctrl did not remain held")
    Assert(!logical.Get("LCtrl", false), "Copilot became Left Ctrl")
    Assert(InStr(sent[1], "{vkE8}") < InStr(sent[1], "{LWin up}"), "Start was not masked before Win release")
    EndCopilot()
    Assert(sent.Length = 2, "Copilot release did not send exactly one Ctrl up")
}

TestPhysicalRightCtrl() {
    NativeDown("RCtrl")
    BeginCopilot()
    EndCopilot()
    CheckCopilotRelease()
    Assert(logical.Get("RCtrl", false), "remap released physical Right Ctrl")
    Assert(copilotCtrlReleasePending, "physical owner was not retained")
    NativeUp("RCtrl")
    CheckCopilotRelease()
}

TestPhysicalModifiers() {
    NativeDown("LShift")
    NativeDown("LWin")
    PassCopilotKeys()
    BeginCopilot()
    Assert(ExternalModifiers() = "RCtrl Shift Win", "independently held Win or Shift was released")
    EndCopilot()
    Assert(ExternalModifiers() = "Shift Win", "Copilot release cancelled independent modifiers")
    NativeUp("LShift")
    NativeUp("LWin")
}

TestPhysicalShift() {
    NativeDown("LShift")
    BeginCopilot()
    Assert(ExternalModifiers() = "RCtrl Shift", "existing physical Shift was neutralized")
    EndCopilot()
    NativeUp("LShift")
}

TestPhysicalWin() {
    NativeDown("LWin")
    PassCopilotKeys()
    BeginCopilot()
    Assert(ExternalModifiers() = "RCtrl Win", "Copilot added Shift to an independently held Win")
    EndCopilot()
    Assert(ExternalModifiers() = "Win", "Copilot release cancelled physical Win")
    NativeUp("LWin")
}

TestPhysicalWinRelease() {
    NativeDown("LWin")
    PassCopilotKeys()
    BeginCopilot()
    NativeUp("LWin")
    Assert(ExternalModifiers() = "RCtrl", "physical Win stayed down after its release")
    EndCopilot()
    Assert(copilotState.phase = "idle", "Copilot release restored an already released Win")
}

TestRecovery() {
    BeginCopilot()
    ReleaseCopilotCtrl()
    Assert(!logical.Get("RCtrl", false), "dead hook generation retained Ctrl")
    CopilotDown()
    Assert(logical.Get("RCtrl", false), "held Copilot did not reacquire Ctrl")
    EndCopilot()
}

TestExitCleanup() {
    NativeDown("LWin")
    NativeDown("LShift")
    NativeDown("RCtrl")
    PassCopilotKeys()
    BeginCopilot()
    ReleaseCopilotHeld()
    Assert(ExternalModifiers() = "RCtrl Shift Win", "exit cleanup cancelled physical input")
    NativeUp("RCtrl")
    NativeUp("LShift")
    NativeUp("LWin")
}

BeginCopilot() {
    global chordModifiers, logical
    chordModifiers := []
    for key in ["LWin", "LShift"] {
        if !physical.Get(key, false)
            chordModifiers.Push(key)
        if key = "LWin" {
            CopilotWinDown()
            continue
        }
        if physical.Get(key, false)
            continue
        if copilotState.phase = "waiting"
            CopilotShiftDown()
        else {
            logical[key] := true
            ObserveCopilotShiftDown()
        }
    }
    CopilotDown()
}

EndCopilot() {
    global logical
    CopilotUp()
    for key in chordModifiers {
        if physical.Get(key, false)
            continue
        if key = "LWin"
            CopilotWinUp()
        else {
            logical[key] := false
            ObserveCopilotShiftUp()
        }
    }
}

NativeDown(key) {
    global physical, logical
    physical[key] := true
    if key = "LWin"
        CopilotWinDown()
    else if key = "LShift" {
        if copilotState.phase = "waiting"
            CopilotShiftDown()
        else {
            logical[key] := true
            ObserveCopilotShiftDown()
        }
    } else if IsObject(copilotState.input) && copilotState.input.InProgress {
        codes := Map("r", [0x52, 0x013], "RCtrl", [0xA3, 0x11D])[key]
        input := copilotState.input
        input.OnKeyDown.Call(input, codes[1], codes[2])
    } else
        logical[key] := true
}

NativeUp(key) {
    global physical, logical
    physical[key] := false
    if key = "LWin"
        CopilotWinUp()
    else {
        logical[key] := false
        if key = "LShift"
            ObserveCopilotShiftUp()
    }
}

ExternalModifiers() {
    modifiers := ""
    for key in ["LCtrl", "RCtrl"]
        if logical.Get(key, false)
            modifiers .= key " "
    if logical.Get("LShift", false) || logical.Get("RShift", false)
        modifiers .= "Shift "
    if logical.Get("LWin", false) || logical.Get("RWin", false)
        modifiers .= "Win "
    return Trim(modifiers)
}

class TestInputHook {
    __New(options) {
        Assert(options = "V", "prefix must leave the chord keys visible to hotkeys")
        this.options := []
        this.MinSendLevel := 0
        this.InProgress := false
    }
    KeyOpt(keys, options) {
        this.options.Push([keys, options])
    }
    Start() {
        Assert(this.MinSendLevel = 101, "prefix would capture its own forwarded events")
        Assert(this.options[1][1] = "{All}" && this.options[1][2] = "SN", "first shortcut key would pass before Win")
        Assert(this.options[2][1] = "{LWin}{LShift}{F23}{SC06E}" && this.options[2][2] = "-SN+V", "prefix would intercept the Copilot chord handlers")
        this.InProgress := true
    }
    Stop() {
        this.InProgress := false
    }
}

TestGetKeyState(key, mode := "") {
    Assert(mode = "P", "unexpected logical key-state query")
    Assert(key != "F23" && key != "SC06E", "Copilot release must not poll F23")
    return physical.Get(key, false)
}

TestSetTimer(callback, period) {
    global timers
    timers[callback.Name] := period
}

TestSend(keys) {
    global sent, logical
    Assert(A_SendLevel = 1, "remapped input bypassed the shared hook's send level")
    sent.Push(keys)
    position := 1
    while RegExMatch(keys, "\{(LCtrl|RCtrl|LWin|LShift|vk52sc013|vkA3sc11D) (up|downR|down)\}", &match, position) {
        key := Map("vk52sc013", "r", "vkA3sc11D", "RCtrl").Get(match[1], match[1])
        logical[key] := match[2] != "up"
        position := match.Pos + match.Len
    }
}

Assert(condition, message) {
    if !condition
        throw Error(message)
}

TestUnhandledError(failure, *) {
    FileAppend("FAIL: " failure.Message " at line " failure.Line Chr(10), "*")
    ExitApp 1
}
