global behaviorRuntime := BehaviorExecutor(), runtimeActions := [], nativePosts := [], testOnPost := 0
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
FileAppend("All 29 structured runtime tests passed.`n", "*")
ExitApp 0

RunRuntimeTest(name, test) {
    global runtimeActions, nativePosts, testOnPost
    runtimeActions := []
    nativePosts := []
    testOnPost := 0
    RunTest(name, test)
    Assert(behaviorRuntime.runs.Count = 0, name " left a running behavior")
    behaviorRuntime.Stop()
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

TestNativeModifiedMouse() {
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
        StartBehaviorRun("native-modified", [Action("mousepress", "key", "rctrl shift LButton")], "", "Test.exe")
        AwaitRuns()
        Sleep 20
        Assert(testNativeMessages.Length = 2, "modified click lost its native transitions")
        for item in testNativeMessages {
            Assert((item.buttons & 12) = 12, "modified click omitted Ctrl or Shift from its window message")
            Assert(item.ctrl && item.shift, "modifiers were released before the target processed its click")
        }
    } finally {
        behaviorRuntime.Stop()
        testOnSend := 0
        OnMessage 0x201, RecordModifiedNativeClick, 0
        OnMessage 0x202, RecordModifiedNativeClick, 0
        testNativeTarget := 0
        window.Destroy()
    }
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

TestHotkey(*) {
}
TestHotIf(*) {
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
