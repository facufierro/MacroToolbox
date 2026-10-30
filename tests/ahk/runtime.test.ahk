global behaviorRuntime := BehaviorExecutor(), runtimeActions := [], nativePosts := [], testOnPost := 0
global testHotkeys := [], testHotCriterion := 0
RunRuntimeTest("parallel branches make progress while a sibling holds", TestParallelHold)
RunRuntimeTest("sequences wait for their previous action", TestStructuredSequence)
RunRuntimeTest("focus loss cancels delays and releases owned keys", TestRuntimeFocusLoss)
RunRuntimeTest("disabling a profile cancels its nested work", TestRuntimeDisable)
RunRuntimeTest("cancelling one owner preserves another owner's hold", TestRuntimeSharedHold)
RunRuntimeTest("repeat works inside a parallel group and ends on release", TestNestedRepeat)
RunRuntimeTest("failed branches cancel and release their siblings", TestRuntimeFailure)
RunRuntimeTest("new runtime actions carry their owning profile", TestRuntimeOperations)
RunRuntimeTest("modified window clicks acquire and release their modifiers", TestModifiedMouse)
RunRuntimeTest("native clicks are processed before their modifiers are released", TestNativeModifiedMouse)
RunRuntimeTest("native double clicks are processed before their modifiers are released", TestNativeModifiedMouse.Bind(true))
RunRuntimeTest("double clicks deliver every button with native class semantics", TestNativeDoubleMouse)
RunRuntimeTest("double clicks preserve another behavior's held button", TestDoubleMouseSharedHold)
RunRuntimeTest("failed double clicks release modifiers and stop their sequence", TestDoubleMouseFailure)
RunRuntimeTest("mousepress supports sided modifiers and every mouse button", TestMouseModifierCombinations)
RunRuntimeTest("modified clicks share modifier ownership with parallel behaviors", TestMouseSharedModifiers)
RunRuntimeTest("modified clicks preserve physical and Copilot-held modifiers", TestMousePhysicalModifiers)
RunRuntimeTest("modified clicks cancel before delivery on focus loss or disable", TestMouseCancel)
RunRuntimeTest("failed modified click delivery releases its modifiers", TestMouseDeliveryFailure)
RunRuntimeTest("JSON preserves text, Unicode, and nested action groups", TestRuntimeJson)
RunRuntimeTest("native chords preserve independently held modifiers", TestRuntimePhysicalModifiers)
RunRuntimeTest("early trigger release skips later holds without skipping presses", TestRuntimeEarlyRelease)
RunRuntimeTest("repeated key combinations press every member", TestRuntimeRepeatChord)
RunRuntimeTest("cursor actions keep their target independently of overlays", TestRuntimeViewport)
RunRuntimeTest("live configuration preserves unrelated running behaviors", TestLiveConfiguration)
RunRuntimeTest("disabling one section preserves the other sections", TestSectionCancellation)
RunRuntimeTest("script work retains its calling section and defining owner", TestScriptSectionOwnership)
RunRuntimeTest("fresh presses resend the trigger while a previous chain waits for a click", TestRetriggerWaitingChain.Bind("press"))
RunRuntimeTest("fresh presses resend text while a previous chain waits for a click", TestRetriggerWaitingChain.Bind("send"))
RunRuntimeTest("fresh presses replace pending delays and release the previous run's inputs", TestRetriggerPendingSequence)
RunRuntimeTest("holding a trigger does not restart its behavior", TestHeldTriggerLatch)
RunRuntimeTest("physical releases clear every matching latch and preserve unrelated chords", TestCompletedChordRelease)
RunRuntimeTest("retriggering during input delivery cannot resume the cancelled activation", TestRetriggerDuringDelivery)
RunRuntimeTest("modified triggers consume repeats and release after their modifier goes up", TestModifiedTriggerConsumption.Bind(false))
RunRuntimeTest("a consumed modified trigger cannot fall through to its plain-key behavior", TestModifiedTriggerConsumption.Bind(true))
RunRuntimeTest("stopping a behavior still consumes its original trigger release", TestStoppedTriggerConsumption)
RunRuntimeTest("releasing a chord prefix does not leak its activating key", TestChordTriggerConsumption)
RunRuntimeTest("hook recovery clears consumed presses whose releases were lost", TestConsumedTriggerRecovery)
RunRuntimeTest("E sends complete taps while its cast waits for a click", TestConsumedSelfPress.Bind(false))
RunRuntimeTest("a quick E release preserves its configured tap duration", TestConsumedSelfPress.Bind(true))
RunRuntimeTest("consumed E preserves other behaviors holding the same output", TestConsumedSharedOutput)
RunRuntimeTest("consumed E preserves independent physical keys and modifiers", TestConsumedIndependentOutput)
RunRuntimeTest("failed delivery of a consumed key still releases its output", TestConsumedOutputFailure)
FileAppend("All 43 structured runtime tests passed.`n", "*")
ExitApp 0

RunRuntimeTest(name, test) {
    global runtimeActions, nativePosts, testOnPost, testHotkeys, testHotCriterion, behaviorRuntime
    runtimeActions := []
    nativePosts := []
    testOnPost := 0
    testHotkeys := []
    testHotCriterion := 0
    RunTest(name, test)
    Assert(behaviorRuntime.runs.Count = 0, name " left a running behavior")
    behaviorRuntime.Stop()
    behaviorRuntime := BehaviorExecutor()
}

Action(type, fields*) {
    result := Map("type", type)
    loop fields.Length // 2
        result[fields[A_Index * 2 - 1]] := fields[A_Index * 2]
    return result
}

AwaitRuns() {
    deadline := A_TickCount + 2000
    while behaviorRuntime.runs.Count {
        if A_TickCount > deadline
            throw Error("runtime did not complete")
        Sleep 5
    }
}

TestParallelHold() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("parallel", [Action("parallel", "steps", [Action("hold", "key", "x"),
        Action("sequence", "steps", [Action("sleep", "ms", "30"), Action("press", "key", "y")])])], "", "*", "", "q")
    Sleep 130
    Assert(testEvents.Length = 3, "held branch blocked the independent press")
    Assert(heldOutputCounts["x"] = 1 && !heldOutputCounts.Has("y"), "parallel ownership was lost")
    testHeldKeys["q"] := false
    AwaitRuns()
    Assert(InStr(testEvents[4]["keys"], "{x up}"), "trigger release did not end the held branch")
}

TestStructuredSequence() {
    StartBehaviorRun("sequence", [Action("press", "key", "x"), Action("sleep", "ms", "40"), Action("press", "key", "y")])
    AwaitRuns()
    Assert(testEvents.Length = 4, "sequence lost an input transition")
    Assert(testEvents[3]["time"] - testEvents[2]["time"] >= 40, "sequence skipped its delay")
}

TestRetriggerWaitingChain(type) {
    global testHeldKeys, testWaitQueue, testInputCallbacks, testRawPacket
    prefix := type = "press" ? Action("press", "key", "e") : Action("send", "text", "e")
    steps := [prefix, Action("waitfor", "key", "LButton"), Action("startoverlay", "itemId", "timer", "restart", true)]
    testHeldKeys := Map("e", true)
    testWaitQueue := [InputBatch([])]
    first := StartBehaviorRun("cast:e", steps, "", "Game.exe", "", "e")
    Sleep 80
    Assert(testInputCallbacks.Count = 1, "cast did not wait for its click")
    testHeldKeys["e"] := false
    BindingHost().Release("e")
    testHeldKeys["e"] := true
    testWaitQueue := [InputBatch([])]
    second := StartBehaviorRun("cast:e", steps, "", "Game.exe", "", "e")
    Assert(IsObject(second) && second.id != first.id, "fresh E press was swallowed by the old click wait")
    Sleep 80
    expected := type = "press" ? "{blind}{e downr}" : "{text}e"
    AssertKeys([expected, expected])
    Assert(testInputCallbacks.Count = 1, "retrigger left the old click observer registered")
    Assert(runtimeActions.Length = 0, "retrigger advanced the cancelled cast")
    testHeldKeys["e"] := false
    testRawPacket := InputEvent("LButton", true)["raw"]
    for callback in testInputCallbacks
        callback.Call(0, 42, 0xFF, A_ScriptHwnd)
    AwaitRuns()
    Assert(runtimeActions.Length = 1 && runtimeActions[1].id = "timer", "the current cast did not restart its timer once")
    Assert(testInputCallbacks.Count = 0, "completed cast left an input observer")
}

TestRetriggerPendingSequence() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    first := StartBehaviorRun("pending", [Action("parallel", "steps", [Action("hold", "key", "x"), Action("sleep", "ms", "1000")]), Action("press", "key", "z")], "", "*", "", "q")
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    testHeldKeys["q"] := true
    second := StartBehaviorRun("pending", [Action("press", "key", "y")], "", "*", "", "q")
    Assert(IsObject(second) && second.id != first.id, "pending sequence blocked a fresh press")
    Assert(!heldOutputCounts.Has("x"), "retrigger leaked the old run's held input")
    testHeldKeys["q"] := false
    AwaitRuns()
    AssertKeys(["{blind}{x downr}", "{blind}{x up}", "{blind}{y downr}", "{blind}{y up}"])
}

TestHeldTriggerLatch() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    first := StartBehaviorRun("latched", [Action("send", "text", "e")], "", "*", "", "q")
    StartBehaviorRun("latched", [Action("send", "text", "e")], "", "*", "", "q")
    AssertKeys(["{text}e"])
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    testHeldKeys["q"] := true
    second := StartBehaviorRun("latched", [Action("send", "text", "e")], "", "*", "", "q")
    Assert(IsObject(second) && second.id != first.id, "release did not rearm the trigger")
    AssertKeys(["{text}e", "{text}e"])
    testHeldKeys["q"] := false
    AwaitRuns()
}

TestCompletedChordRelease() {
    global testHeldKeys
    testHeldKeys := Map("q", true, "w", true, "RCtrl", true)
    StartBehaviorRun("plain", [Action("send", "text", "a")], "", "*", "", "q")
    StartBehaviorRun("chord", [Action("send", "text", "b")], "", "*", "", "RCtrl q")
    StartBehaviorRun("unrelated", [Action("send", "text", "c")], "", "*", "", "w")
    Assert(!behaviorRuntime.runs.Count && behaviorRuntime.latches.Count = 3, "completed behaviors lost their held-trigger latches")
    BindingHost().Release("q")
    Assert(behaviorRuntime.latches.Count = 3, "synthetic release cleared a physically held trigger")
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    Assert(behaviorRuntime.latches.Count = 1 && behaviorRuntime.latches.Has("unrelated"), "release cleared an unrelated chord or missed a completed chord")
    Assert(testHeldKeys["RCtrl"] && testHeldKeys["w"], "release altered independent physical keys")
    testHeldKeys["w"] := false
    BindingHost().Release("w")
    Assert(!behaviorRuntime.latches.Count, "final release left a completed behavior latched")
}

TestRetriggerDuringDelivery() {
    global testHeldKeys, testOnSend
    testHeldKeys := Map("q", true)
    testOnSend := RetriggerOnPrefix
    StartBehaviorRun("interrupted", [Action("send", "text", "prefix"), Action("send", "text", "stale-tail")], "", "*", "", "q")
    AwaitRuns()
    AssertKeys(["{text}prefix", "{text}replacement"])
    testHeldKeys["q"] := false
    BindingHost().Release("q")
}

RetriggerOnPrefix(keys) {
    global testHeldKeys, testOnSend
    if keys != "{text}prefix"
        return
    testOnSend := 0
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    testHeldKeys["q"] := true
    StartBehaviorRun("interrupted", [Action("send", "text", "replacement")], "", "*", "", "q")
}

TestRuntimeFocusLoss() {
    global testHeldKeys, testFocusActive
    testHeldKeys := Map("q", true)
    StartBehaviorRun("focus", [Action("parallel", "steps", [Action("hold", "key", "x"), Action("sequence", "steps", [Action("sleep", "ms", "150"), Action("press", "key", "z")])])], "", "Game.exe", "", "q")
    testFocusActive := false
    AwaitRuns()
    Assert(testEvents.Length = 2 && InStr(testEvents[2]["keys"], "{x up}"), "focus loss leaked input or ran a trailing action")
}

TestRuntimeDisable() {
    global testHeldKeys, enabled
    testHeldKeys := Map("q", true)
    enabled["profile"] := true
    StartBehaviorRun("disable", [Action("hold", "key", "x"), Action("press", "key", "z")], "", "*", "profile", "q")
    enabled["profile"] := false
    AwaitRuns()
    Assert(testEvents.Length = 2, "disabled behavior continued its sequence")
}

TestRuntimeSharedHold() {
    global testHeldKeys
    testHeldKeys := Map("q", true, "w", true)
    StartBehaviorRun("one", [Action("hold", "key", "x")], "", "*", "", "q")
    StartBehaviorRun("two", [Action("hold", "key", "x")], "", "*", "", "w")
    Assert(heldOutputCounts["x"] = 2 && testEvents.Length = 1, "shared output was pressed twice")
    behaviorRuntime.Cancel("one")
    Assert(heldOutputCounts["x"] = 1 && testEvents.Length = 1, "cancellation released another owner's output")
    testHeldKeys["w"] := false
    AwaitRuns()
    Assert(testEvents.Length = 2, "last owner did not release its output")
}

TestNestedRepeat() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("repeat", [Action("parallel", "steps", [Action("repeat", "key", "a", "interval", "30", "hold", "1"), Action("hold", "key", "b")])], "", "*", "", "q")
    Sleep 120
    Assert(testEvents.Length >= 5 && heldOutputCounts.Has("b"), "nested repeat did not run beside its sibling")
    testHeldKeys["q"] := false
    AwaitRuns()
}

TestRuntimeFailure() {
    global testOnSend, testHeldKeys
    testHeldKeys := Map("q", true)
    testOnSend := FailMouseDown
    StartBehaviorRun("failure", [Action("parallel", "steps", [Action("hold", "key", "x"), Action("press", "key", "XButton2")])], "", "*", "", "q")
    AwaitRuns()
    Assert(runtimeActions.Length = 1 && runtimeActions[1].kind = "error", "failure was not reported")
    Assert(!heldOutputCounts.Count, "failed branch left its sibling held")
}

TestRuntimeOperations() {
    global enabled
    enabled["profile"] := true
    StartBehaviorRun("operations", [Action("state", "stateId", "buff", "action", "set"), Action("bar", "itemId", "health", "value", "42"), Action("stopoverlay", "itemId", "timer")], "", "*", "profile")
    AwaitRuns()
    Assert(runtimeActions.Length = 3, "runtime operations were skipped")
    Assert(runtimeActions[1].profile = "profile" && runtimeActions[1].value = "set", "state operation lost its owner")
    Assert(runtimeActions[2].id = "health" && runtimeActions[3].value = "stop", "overlay operation lost its parameters")
}

TestModifiedMouse() {
    StartBehaviorRun("modified", [Action("mousepress", "key", "rctrl shift LButton")], "", "Game.exe")
    AwaitRuns()
    Assert(nativePosts.Length = 2, "modified mousepress lost its window click")
    AssertKeys(["{blind}{rctrl downr}", "{blind}{shift downr}", "{blind}{shift up}{rctrl up}"])
}

TestMouseModifierCombinations() {
    global nativePosts, testEvents, testClicks
    for modifier in ["ctrl", "lctrl", "rctrl", "shift", "lshift", "rshift", "alt", "lalt", "ralt", "win", "lwin", "rwin"] {
        for button in ["LButton", "RButton", "MButton", "XButton1", "XButton2"] {
            nativePosts := [], testEvents := [], testClicks := []
            StartBehaviorRun("combination", [Action("mousepress", "key", modifier " " button)])
            AwaitRuns()
            Assert(testEvents.Length = 2, "mousepress lost modifier transitions for " modifier " " button)
            Assert(!heldOutputCounts.Count && !syntheticDown.Count, "mousepress leaked " modifier)
            Assert(nativePosts.Length = 2 || testClicks.Length = 1, "mousepress lost " button)
            symbols := KeyModifierSymbols(modifier)
            flags := InStr(symbols, "^") ? 8 : (InStr(symbols, "+") ? 4 : 0)
            for message in nativePosts
                Assert((message.buttons & 12) = flags, "mousepress used incorrect modifier flags")
        }
    }
}

TestMouseSharedModifiers() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("held-modifier", [Action("hold", "key", "rctrl")], "", "*", "", "q")
    StartBehaviorRun("shared-click", [Action("mousepress", "key", "rctrl LButton")])
    Assert(heldOutputCounts["RCtrl"] = 2, "click did not acquire its own modifier reference")
    behaviorRuntime.Cancel("held-modifier")
    Assert(heldOutputCounts["RCtrl"] = 1 && testEvents.Length = 1, "another behavior released the click's modifier")
    AwaitRuns()
    AssertKeys(["{blind}{rctrl downr}", "{blind}{rctrl up}"])
}

TestMousePhysicalModifiers() {
    global testHeldKeys, testLogicalKeys, copilotCtrlHeld
    testHeldKeys := Map("RCtrl", true, "RShift", true)
    StartBehaviorRun("physical-click", [Action("mousepress", "key", "rctrl rshift LButton")])
    AwaitRuns()
    Assert(testEvents.Length = 0, "mousepress changed physically held modifiers")
    testHeldKeys := Map()
    testLogicalKeys["RCtrl"] := true
    copilotCtrlHeld := true
    try {
        StartBehaviorRun("copilot-click", [Action("mousepress", "key", "rctrl LButton")])
        AwaitRuns()
        Assert(testEvents.Length = 0, "mousepress repeated or released Copilot's Right Ctrl")
    } finally copilotCtrlHeld := false
}

TestMouseCancel() {
    global testFocusActive, enabled
    StartBehaviorRun("focus-click", [Action("mousepress", "key", "rctrl LButton")], "", "Game.exe")
    testFocusActive := false
    AwaitRuns()
    Assert(nativePosts.Length = 0, "focus loss still delivered a pending click")
    AssertKeys(["{blind}{rctrl downr}", "{blind}{rctrl up}"])
    testFocusActive := true
    enabled["profile"] := true
    StartBehaviorRun("disabled-click", [Action("mousepress", "key", "rctrl LButton")], "", "Game.exe", "profile")
    enabled["profile"] := false
    AwaitRuns()
    Assert(nativePosts.Length = 0, "disabled profile still delivered a pending click")
}

TestMouseDeliveryFailure() {
    global testOnPost
    testOnPost := FailMouseMessage
    StartBehaviorRun("failed-click", [Action("mousepress", "key", "rctrl LButton"), Action("press", "key", "x")])
    AwaitRuns()
    Assert(runtimeActions.Length = 1 && runtimeActions[1].kind = "error", "click delivery failure was hidden")
    Assert(nativePosts.Length = 2, "failed click did not attempt its button-up cleanup")
    AssertKeys(["{blind}{rctrl downr}", "{blind}{rctrl up}"])
}

FailMouseMessage(message) {
    if message = 0x201
        throw Error("simulated mouse message failure")
}

TestNativeModifiedMouse(doubleClick := false) {
    global testWindowId, testNativeTarget, testNativeMessages, testOnSend
    window := Gui("+ToolWindow -Caption")
    try {
        window.Show("Hide w400 h300")
        testWindowId := window.Hwnd
        testNativeTarget := window.Hwnd
        testNativeMessages := []
        testOnSend := TrackMouseModifiers
        OnMessage 0x201, RecordModifiedNativeClick
        OnMessage 0x202, RecordModifiedNativeClick
        OnMessage 0x203, RecordModifiedNativeClick
        StartBehaviorRun("native-modified", [Action("mousepress", "key", "rctrl shift LButton", "doubleClick", doubleClick)], "", "Test.exe")
        AwaitRuns()
        Sleep 20
        Assert(testNativeMessages.Length = (doubleClick ? 4 : 2), "modified click lost its native transitions")
        for item in testNativeMessages {
            Assert((item.buttons & 12) = 12, "modified click omitted Ctrl or Shift from its window message")
            Assert(item.ctrl && item.shift, "modifiers were released before the target processed its click")
        }
    } finally {
        behaviorRuntime.Stop()
        testOnSend := 0
        OnMessage 0x201, RecordModifiedNativeClick, 0
        OnMessage 0x202, RecordModifiedNativeClick, 0
        OnMessage 0x203, RecordModifiedNativeClick, 0
        testNativeTarget := 0
        window.Destroy()
    }
}

TestNativeDoubleMouse() {
    global testWindowId, testNativeTarget, testNativeMessages, testHeldKeys
    window := Gui("+ToolWindow -Caption")
    messages := [0x201, 0x202, 0x203, 0x204, 0x205, 0x206, 0x207, 0x208, 0x209, 0x20B, 0x20C, 0x20D]
    originalStyle := DllCall("GetClassLongW", "Ptr", window.Hwnd, "Int", -26, "UInt")
    try {
        window.Show("Hide w400 h300")
        testWindowId := window.Hwnd
        testNativeTarget := window.Hwnd
        for message in messages
            OnMessage message, RecordNativeClick
        for doubleClickStyle in [false, true] {
            DllCall("SetClassLongW", "Ptr", window.Hwnd, "Int", -26, "UInt", (originalStyle & ~8) | (doubleClickStyle ? 8 : 0), "UInt")
            for button, down in Map("LButton", 0x201, "RButton", 0x204, "MButton", 0x207,
                "XButton1", 0x20B, "XButton2", 0x20B, "m1", 0x201, "m2", 0x204) {
                for modifiers in ["", "rctrl shift "] {
                    for held in [false, true] {
                        physicalButton := button = "m1" ? "lbutton" : button = "m2" ? "rbutton" : StrLower(button)
                        testHeldKeys := Map(physicalButton, held)
                        testNativeMessages := []
                        StartBehaviorRun("double-click", [Action("mousepress", "key", modifiers button, "doubleClick", true)], "", "Test.exe")
                        AwaitRuns()
                        Sleep 20
                        secondDown := doubleClickStyle ? down + 2 : down
                        expected := held ? [down + 1, down, down + 1, secondDown, down + 1, down + 1]
                            : [down, down + 1, secondDown, down + 1]
                        Assert(testNativeMessages.Length = expected.Length, "double click lost or repeated transitions for " button)
                        for index, item in testNativeMessages {
                            Assert(item.message = expected[index], "double click used the wrong native transition")
                            Assert((item.position & 0xFFFF) = 350 && (item.position >> 16 & 0xFFFF) = 250, "double click changed its position")
                            Assert((item.buttons & 12) = (modifiers = "" ? 0 : 12), "double click lost its modifier flags")
                            if down = 0x20B
                                Assert(item.buttons >> 16 = (button = "XButton1" ? 1 : 2), "double click lost its side button")
                        }
                        Assert(testHeldKeys[physicalButton] = held, "double click changed the physical button state")
                    }
                }
            }
        }
    } finally {
        behaviorRuntime.Stop()
        DllCall("SetClassLongW", "Ptr", window.Hwnd, "Int", -26, "UInt", originalStyle, "UInt")
        for message in messages
            OnMessage message, RecordNativeClick, 0
        testNativeTarget := 0
        window.Destroy()
    }
}

TestDoubleMouseSharedHold() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("held-button", [Action("hold", "key", "LButton")], "", "*", "", "q")
    try {
        StartBehaviorRun("double-click", [Action("mousepress", "key", "LButton", "doubleClick", true)])
        Assert(nativePosts.Length = 4, "held button lost its double click")
        AssertClickOptions(["NA Pos U", "NA Pos D"])
        Assert(heldOutputCounts["lbutton"] = 1, "double click released the other behavior's button")
    } finally behaviorRuntime.Cancel("held-button")
}

TestDoubleMouseFailure() {
    global testOnPost
    testOnPost := FailSecondMousePress
    StartBehaviorRun("failed-double", [Action("mousepress", "key", "rctrl LButton", "doubleClick", true), Action("press", "key", "x")])
    AwaitRuns()
    Assert(runtimeActions.Length = 1 && runtimeActions[1].kind = "error", "double-click failure was hidden")
    Assert(nativePosts.Length = 4 && nativePosts[4].message = 0x202, "second click failure did not release the button")
    AssertKeys(["{blind}{rctrl downr}", "{blind}{rctrl up}"])
}

FailSecondMousePress(message) {
    if nativePosts.Length = 3
        throw Error("simulated second mouse press failure")
}

TrackMouseModifiers(keys) {
    global testLogicalKeys
    for key in ["RCtrl", "Shift"] {
        if InStr(keys, "{" key " down")
            testLogicalKeys[key] := true
        if InStr(keys, "{" key " up}")
            testLogicalKeys[key] := false
    }
}

RecordModifiedNativeClick(buttons, position, message, hwnd) {
    if hwnd = testNativeTarget
        testNativeMessages.Push({buttons: buttons, message: message,
            ctrl: TestGetKeyState("RCtrl"), shift: TestGetKeyState("Shift")})
}

TestRuntimeJson() {
    value := JsonReader.Parse('[{"type":"parallel","steps":[{"type":"send","text":"a;\n\u00f8\ud83d\ude00"}]}]')
    Assert(value[1]["steps"][1]["text"] = "a;`nø😀", "JSON altered user text")
    Assert(JsonReader.Parse(JsonString('a"\b')) = 'a"\b', "JSON request escaping changed text")
}

TestRuntimePhysicalModifiers() {
    global testHeldKeys, copilotCtrlHeld, testLogicalKeys
    testHeldKeys := Map("RCtrl", true, "RShift", true, "LWin", true)
    StartBehaviorRun("physical", [Action("press", "key", "rctrl rshift lwin x")])
    AwaitRuns()
    AssertKeys(["{blind}{x downr}", "{blind}{x up}"])
    copilotCtrlHeld := true
    testLogicalKeys["RCtrl"] := true
    try {
        testHeldKeys := Map()
        StartBehaviorRun("copilot", [Action("press", "key", "rctrl y")])
        AwaitRuns()
        Assert(testEvents.Length = 4, "behavior released or repeated the Copilot modifier")
    } finally copilotCtrlHeld := false
}

TestRuntimeEarlyRelease() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("early", [Action("sleep", "ms", "30"), Action("hold", "key", "x"), Action("press", "key", "y")], "", "*", "", "q")
    testHeldKeys["q"] := false
    AwaitRuns()
    AssertKeys(["{blind}{y downr}", "{blind}{y up}"])
}

TestRuntimeRepeatChord() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("chord-repeat", [Action("repeat", "key", "x y", "interval", "40", "hold", "1")], "", "*", "", "q")
    Sleep 100
    testHeldKeys["q"] := false
    AwaitRuns()
    Assert(testEvents.Length >= 6, "repeat lost its key combination")
    Assert(testEvents[1]["keys"] = "{blind}{x downr}" && testEvents[2]["keys"] = "{blind}{y downr}", "chord members were not held together")
    Assert(testEvents[3]["keys"] = "{blind}{y up}{x up}", "chord did not release together")
}

TestLiveConfiguration() {
    global testHeldKeys, enabled
    testHeldKeys := Map("q", true, "w", true)
    enabled := Map("one", true, "two", true)
    StartBehaviorRun("one:hold", [Action("hold", "key", "x")], "", "*", "one", "q")
    StartBehaviorRun("two:hold", [Action("hold", "key", "y")], "", "*", "two", "w")
    host := BindingHost()
    host.profiles := [Map("id", "one", "revision", "old", "armed", true), Map("id", "two", "revision", "same", "armed", true)]
    host.Apply([Map("id", "one", "revision", "new", "armed", false, "bindings", []), Map("id", "two", "revision", "same", "armed", true, "bindings", [])])
    Assert(!behaviorRuntime.runs.Has("one:hold") && behaviorRuntime.runs.Has("two:hold"), "configuration cancelled an unrelated behavior")
    Assert(!heldOutputCounts.Has("x") && heldOutputCounts["y"] = 1, "configuration released the wrong output")
    testHeldKeys["w"] := false
    AwaitRuns()
}

TestSectionCancellation() {
    global testHeldKeys, enabled
    testHeldKeys := Map("q", true, "w", true)
    enabled := Map("profile", true)
    StartBehaviorRun("keys", [Action("hold", "key", "x")], "", "*", "profile", "q", false, "hotkeys")
    StartBehaviorRun("events", [Action("hold", "key", "y")], "", "*", "profile", "w", false, "events")
    host := BindingHost()
    host.profiles := [Map("id", "profile", "armed", true, "revision", "before",
        "sectionRevisions", Map("hotkeys", "same", "events", "same", "scripts", "same"))]
    host.Apply([Map("id", "profile", "armed", true, "revision", "overlay-only", "bindings", [],
        "sectionRevisions", Map("hotkeys", "same", "events", "same", "scripts", "same"))])
    Assert(behaviorRuntime.runs.Count = 2, "an overlay-only change interrupted inputs")
    host.Apply([Map("id", "profile", "armed", true, "revision", "keys-disabled", "bindings", [],
        "sectionRevisions", Map("hotkeys", "disabled", "events", "same", "scripts", "same"))])
    Assert(!behaviorRuntime.runs.Has("keys") && behaviorRuntime.runs.Has("events"), "section disable cancelled unrelated work")
    Assert(!heldOutputCounts.Has("x") && heldOutputCounts.Has("y"), "section disable released another section's input")
    testHeldKeys["w"] := false
    AwaitRuns()
}

TestScriptSectionOwnership() {
    global enabled, testHeldKeys
    enabled := Map("caller", true, "library", true)
    StartBehaviorRun("script-call", [Action("script", "scriptId", "script")], "", "*", "caller", "", false, "events")
    AwaitRuns()
    Assert(runtimeActions[1].value = "events", "script launch lost its calling section")
    testHeldKeys := Map("q", true, "w", true)
    StartBehaviorRun("script-child", [Action("hold", "key", "x")], "", "*", "caller", "q", false, "events", "library")
    StartBehaviorRun("unrelated", [Action("hold", "key", "y")], "", "*", "caller", "w", false, "events")
    behaviorRuntime.CancelSection("library", "scripts")
    Assert(!behaviorRuntime.runs.Has("script-child") && behaviorRuntime.runs.Has("unrelated"), "script-owner disable lost the child scope")
    testHeldKeys["w"] := false
    AwaitRuns()
    StartBehaviorRun("script-child-2", [Action("hold", "key", "z")], "", "*", "caller", "q", false, "events", "library")
    behaviorRuntime.CancelSection("caller", "events")
    Assert(!behaviorRuntime.runs.Count, "calling-section disable left its script work running")
}

TriggerTestHost(plain := false, chord := "SC013", steps := 0) {
    global behaviorRuntime
    if !IsObject(steps)
        steps := [Action("press", "key", "NumpadEnter"), Action("send", "text", "!trade rep"),
            Action("press", "key", "NumpadEnter"), Action("press", "key", "Tab"),
            Action("startoverlay", "itemId", "rep", "restart", true)]
    binding := Map("key", "$<!SC013", "trigger", chord = "SC013" ? "lalt r" : "lalt q r", "modifiers", "!", "chord", chord,
        "prerequisites", chord = "SC013" ? "" : "q", "specificity", chord = "SC013" ? 0 : 1, "exact", true,
        "toggle", false, "section", "hotkeys", "steps", steps)
    bindings := [binding]
    if plain
        bindings.Push(Map("key", "$*SC013", "trigger", "r", "modifiers", "", "chord", "SC013",
            "prerequisites", "", "specificity", 0, "exact", false, "toggle", false,
            "section", "hotkeys", "steps", [Action("press", "key", "r")]))
    host := BindingHost()
    host.Apply([Map("id", "profile", "target", "Game.exe", "armed", true, "revision", "same", "bindings", bindings)])
    behaviorRuntime := BehaviorExecutor(host.PhysicalOwnsOutput.Bind(host))
    return host
}

SelfTriggerTestHost(steps, wildcard := false) {
    global behaviorRuntime
    binding := Map("key", wildcard ? "$*SC012" : "$SC012", "trigger", "e", "modifiers", "", "chord", "SC012",
        "prerequisites", "", "specificity", 0, "exact", !wildcard, "toggle", false, "section", "hotkeys", "steps", steps)
    host := BindingHost()
    host.Apply([Map("id", "profile", "target", "Game.exe", "armed", true, "revision", "same", "bindings", [binding])])
    behaviorRuntime := BehaviorExecutor(host.PhysicalOwnsOutput.Bind(host))
    return host
}

TestConsumedSelfPress(quick) {
    global testHeldKeys, testWaitQueue, testRawPacket
    host := SelfTriggerTestHost([Action("press", "key", "e", "duration", "80"), Action("waitfor", "key", "LButton"),
        Action("startoverlay", "itemId", "timer", "restart", true)])
    loop 2 {
        testHeldKeys := Map("e", true, "SC012", true)
        testWaitQueue := [InputBatch([])]
        DispatchTestHotkey("$SC012")
        if quick {
            testHeldKeys := Map()
            DispatchTestHotkey("$*SC012 up")
            Assert(testEvents.Length = (A_Index - 1) * 2 + 1, "physical E release shortened its configured tap")
        }
        Sleep 130
        Assert(testEvents.Length = A_Index * 2 && testEvents[A_Index * 2]["keys"] = "{blind}{e up}",
            "consuming E's physical release left its configured E press stuck down")
        Assert(testInputCallbacks.Count = 1, "E did not reach its click wait")
        testHeldKeys := Map()
        DispatchTestHotkey("$*SC012 up")
    }
    AssertKeys(["{blind}{e downr}", "{blind}{e up}", "{blind}{e downr}", "{blind}{e up}"])
    testRawPacket := InputEvent("LButton", true)["raw"]
    for callback in testInputCallbacks
        callback.Call(0, 42, 0xFF, A_ScriptHwnd)
    AwaitRuns()
    Assert(runtimeActions.Length = 1 && runtimeActions[1].id = "timer", "repeated E presses left stale casts waiting")
}

TestConsumedSharedOutput() {
    global testHeldKeys
    host := SelfTriggerTestHost([Action("hold", "key", "e")])
    testHeldKeys := Map("e", true, "SC012", true, "q", true)
    DispatchTestHotkey("$SC012")
    StartBehaviorRun("other", [Action("hold", "key", "e")], "", "Game.exe", "", "q")
    Sleep 60
    AssertKeys(["{blind}{e downr}"])
    Assert(heldOutputCounts["e"] = 2, "E lost a shared hold owner")
    behaviorRuntime.Cancel("profile:e")
    testHeldKeys["e"] := false
    testHeldKeys["SC012"] := false
    DispatchTestHotkey("$*SC012 up")
    Assert(testEvents.Length = 1 && heldOutputCounts["e"] = 1, "E released another behavior's output")
    testHeldKeys["q"] := false
    AwaitRuns()
    AssertKeys(["{blind}{e downr}", "{blind}{e up}"])
}

TestConsumedIndependentOutput() {
    global testHeldKeys
    host := SelfTriggerTestHost([Action("press", "key", "e x rctrl lshift lwin")], true)
    testHeldKeys := Map("e", true, "SC012", true, "x", true, "RCtrl", true, "LShift", true, "LWin", true)
    DispatchTestHotkey("$*SC012")
    AwaitRuns()
    AssertKeys(["{blind}{e downr}", "{blind}{x downr}", "{blind}{e up}"])
    for key in ["x", "RCtrl", "LShift", "LWin"]
        Assert(testHeldKeys[key], "consuming E altered independent physical " key)
    testHeldKeys["e"] := false
    testHeldKeys["SC012"] := false
    DispatchTestHotkey("$*SC012 up")
}

TestConsumedOutputFailure() {
    global testHeldKeys, testOnSend
    host := SelfTriggerTestHost([Action("press", "key", "e")])
    testHeldKeys := Map("e", true, "SC012", true)
    testOnSend := FailConsumedDown
    DispatchTestHotkey("$SC012")
    AwaitRuns()
    AssertKeys(["{blind}{e downr}", "{blind}{e up}"])
    Assert(runtimeActions.Length = 1 && runtimeActions[1].kind = "error", "failed E delivery was not reported")
    testHeldKeys := Map()
    DispatchTestHotkey("$*SC012 up")
}

FailConsumedDown(keys) {
    global testOnSend
    if InStr(keys, "{e downr}") {
        testOnSend := 0
        throw Error("simulated E delivery failure")
    }
}

TestModifiedTriggerConsumption(plain) {
    global testHeldKeys, testLogicalKeys
    testHeldKeys := Map("LAlt", true, "SC013", true)
    host := TriggerTestHost(plain)
    DispatchTestHotkey("$<!SC013")
    Assert(testEvents.Length = 1, "modified trigger did not start its configured command")
    ; Sending the command neutralizes Alt; releasing Alt physically has the same effect.
    testLogicalKeys["LAlt"] := false
    testHeldKeys["LAlt"] := false
    repeatEvent := DispatchTestHotkey("$*SC013")
    Assert(IsObject(repeatEvent) && !repeatEvent.passthrough, "Alt+R leaked a plain R repeat after Alt was released")
    AwaitRuns()
    AssertKeys(["{blind!}{numpadenter downr}", "{blind!}{numpadenter up}", "{text}!trade rep",
        "{blind!}{numpadenter downr}", "{blind!}{numpadenter up}", "{blind!}{tab downr}", "{blind!}{tab up}"])
    Assert(runtimeActions.Length = 1 && runtimeActions[1].id = "rep", "suppression altered the configured command")
    count := testEvents.Length
    DispatchTestHotkey("$*SC013")
    Assert(testEvents.Length = count, "a completed macro replayed while R stayed held")
    testHeldKeys["SC013"] := false
    releaseEvent := DispatchTestHotkey("$*SC013 up")
    Assert(IsObject(releaseEvent) && !releaseEvent.passthrough, "Alt+R leaked its R release to the app")
    testHeldKeys["SC013"] := true
    fresh := DispatchTestHotkey("$*SC013")
    if plain {
        Assert(IsObject(fresh), "fresh R did not activate its configured plain-key behavior")
        AwaitRuns()
        Assert(testEvents[count + 1]["keys"] = "{blind}{r downr}", "fresh plain R sent the wrong output")
    } else
        Assert(!IsObject(fresh), "fresh plain R remained blocked after releasing Alt+R")
    testHeldKeys["SC013"] := false
    DispatchTestHotkey("$*SC013 up")
}

TestStoppedTriggerConsumption() {
    global testHeldKeys
    testHeldKeys := Map("LAlt", true, "SC013", true)
    host := TriggerTestHost(false,, [Action("hold", "key", "x")])
    DispatchTestHotkey("$<!SC013")
    behaviorRuntime.Stop()
    testHeldKeys["LAlt"] := false
    testHeldKeys["SC013"] := false
    releaseEvent := DispatchTestHotkey("$*SC013 up")
    Assert(IsObject(releaseEvent) && !releaseEvent.passthrough, "stopping the behavior leaked its consumed key-up")
    testHeldKeys["SC013"] := true
    Assert(!IsObject(DispatchTestHotkey("$*SC013")), "stopping a behavior blocked a later plain R")
}

TestChordTriggerConsumption() {
    global testHeldKeys
    testHeldKeys := Map("LAlt", true, "q", true, "SC013", true)
    host := TriggerTestHost(false, "q SC013", [Action("hold", "key", "x")])
    DispatchTestHotkey("$<!SC013")
    testHeldKeys["q"] := false
    prefixRelease := DispatchTestHotkey("$*q up")
    Assert(IsObject(prefixRelease) && prefixRelease.passthrough, "the unconsumed chord prefix was blocked")
    AwaitRuns()
    testHeldKeys["LAlt"] := false
    repeatEvent := DispatchTestHotkey("$*SC013")
    Assert(IsObject(repeatEvent) && !repeatEvent.passthrough, "releasing a chord prefix leaked the held activating key")
    testHeldKeys["SC013"] := false
    releaseEvent := DispatchTestHotkey("$*SC013 up")
    Assert(IsObject(releaseEvent) && !releaseEvent.passthrough, "the chord's activating key-up leaked")
}

TestConsumedTriggerRecovery() {
    global testHeldKeys
    testHeldKeys := Map("LAlt", true, "SC013", true)
    host := TriggerTestHost(false,, [Action("sleep", "ms", "1000")])
    DispatchTestHotkey("$<!SC013")
    behaviorRuntime.Stop()
    testHeldKeys["LAlt"] := false
    host.ResetInput()
    Assert(!IsObject(DispatchTestHotkey("$*SC013")), "hook recovery left the old trigger consumed")
}

; Model HotIf variant selection without installing hooks or injecting global input.
TestHotkey(key, callback := "", options := "", *) {
    global testHotkeys, testHotCriterion
    identity := StrReplace(StrReplace(key, "$"), "~")
    for item in testHotkeys
        if item.key = identity && item.criterion = testHotCriterion {
            if IsObject(callback)
                item.callback := callback
            if !IsObject(callback) && (callback = "On" || callback = "Off")
                item.enabled := callback = "On"
            return
        }
    if IsObject(callback)
        testHotkeys.Push({key: identity, criterion: testHotCriterion, callback: callback,
            enabled: !InStr(options, "Off"), passthrough: InStr(key, "~") != 0})
}
TestHotIf(criterion := 0, *) {
    global testHotCriterion
    testHotCriterion := criterion
}
DispatchTestHotkey(key) {
    identity := StrReplace(StrReplace(key, "$"), "~")
    fallback := 0
    for item in testHotkeys {
        if item.key != identity || !item.enabled
            continue
        if !IsObject(item.criterion) {
            fallback := item
            continue
        }
        if item.criterion.Call(key) {
            item.callback.Call(key)
            return item
        }
    }
    if IsObject(fallback)
        fallback.callback.Call(key)
    return fallback
}

TestRuntimeAction(profile, kind, id, value := "") {
    runtimeActions.Push({profile: profile, kind: kind, id: id, value: value})
}

TestPostMessage(message, buttons, position, control := "", target := "") {
    nativePosts.Push({message: message, buttons: buttons, position: position})
    if IsObject(testOnPost)
        testOnPost.Call(message)
    if testNativeTarget
        PostMessage message, buttons, position,, target
}

TestRuntimeViewport() {
    StartBehaviorRun("viewport", [Action("goto", "x", "50", "y", "50")], "", "Game.exe")
    AwaitRuns()
    Assert(testViewportTarget = "Game.exe", "cursor action used an overlay's target")
    Assert(testMoves[1].x = 600 && testMoves[1].y = 450, "cursor action used the wrong viewport")
}
