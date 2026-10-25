#Requires AutoHotkey v2.0
#SingleInstance Off
#NoTrayIcon
#Warn All, StdOut

global syntheticDown := Map(), chordHolds := Map(), heldOutputCounts := Map(), mirroredMouseDown := Map()
global repeatDown := Map(), repeatChord := Map(), enabled := Map()
global behaviorClipboardBackup := "", behaviorClipboardPending := false, behaviorClipboardSequence := 0
global testEvents := [], testOnSend := 0, testReleaseTime := 0
global testCommands := false
global testAppEvents := false
global testWaitQueue := [], testFocusActive := true, testLogicalKeys := Map(), testBlockModes := []
global testActiveExe := "Active & App.exe"
global testHeldKeys := Map()
global testClicks := [], testClickFailure := false, testWindowId := 42, testWindowCriteria := ""
global testOnClick := 0, testClickFailAt := 0
global testCursor := {x: 450, y: 300}, testClient := {x: 100, y: 50}
global testNativeTarget := 0, testNativeMessages := []
global testMoves := [], testDragArmed := false, testDragged := false
OnError(TestUnhandledError)

RunTest("release precedes trailing delay and press", TestSequence)
RunTest("release during prefix skips the later hold", TestEarlyRelease)
RunTest("releasing a chord member resumes the sequence", TestChordRelease)
RunTest("another owner retains its held output", TestSharedOutput)
RunTest("standalone combined holds still release together", TestStandaloneHold)
RunTest("failed hold send releases owned input", TestFailedSend)
RunTest("partial hold failure preserves another owner", TestPartialFailure)
RunTest("window behaviors keep their configured target", TestWindowCommands)
RunTest("resolution keeps its target and dimensions", TestResolutionCommand)
RunTest("global resolution targets the active app", TestGlobalResolutionCommand)
RunTest("startoverlay routes its selected item without sending input", TestStartOverlay)
RunTest("waitfor pauses the chain until the selected mouse press", TestWaitForMouse)
RunTest("waitfor ignores an already held button until its next press", TestWaitForHeldButton)
RunTest("waitfor supports keyboard keys and multiple stages", TestWaitForStages)
RunTest("waitfor chord modifiers use the shared logical Right Ctrl", TestWaitForModifiers)
RunTest("waitfor continues after the original trigger is released", TestWaitForReleasedTrigger)
RunTest("waitfor cancels when the app loses focus", TestWaitForFocusLoss)
RunTest("waitfor cancels when its profile is disabled", TestWaitForDisabledProfile)
RunTest("waitfor rechecks focus on the activating press", TestWaitForFocusRace)
RunTest("cancelled waitfor releases mouse movement locking", TestWaitForLockCleanup)
RunTest("waitfor rejects an empty trigger", TestWaitForEmpty)
RunTest("press preserves unrelated held modifiers", TestPressModifiers)
RunTest("explicit trigger modifiers stay separate from unrelated modifiers", TestTriggerModifiers)
RunTest("press reuses an already held output modifier", TestHeldOutputModifier)
RunTest("exact AltGr matching rejects extra modifiers and retains synthesized Ctrl", TestExactAltGrModifiers)
RunTest("mousepress uses built-in window clicks for every mouse button", TestMousePressButtons)
RunTest("mousepress converts screen coordinates to client coordinates", TestMousePressCoordinates)
RunTest("mousepress keeps the profile target or uses the active app", TestMousePressTarget)
RunTest("mousepress reports invalid buttons and missing windows", TestMousePressInvalid)
RunTest("failed mousepress clicks restore delay and stop the sequence", TestMousePressFailure)
RunTest("mousepress clicks leave physical buttons and modifiers unchanged", TestMousePressHeldInput)
RunTest("mousepress stops restoring a button released during the tap", TestMousePressReleasedDuringTap)
RunTest("mousepress preserves another behavior's held button", TestMousePressSharedHold)
RunTest("mousepress releases window input after a failed held click", TestMousePressHeldFailure)
RunTest("mousepress exit cleanup leaves the window button released", TestMousePressExit)
RunTest("saved pressalt actions remain compatible", TestMousePressLegacyAlias)
RunTest("mousepress finishes a pickup before restoring the cursor", TestMousePressPickup)
RunTest("built-in ControlClick delivers a down/up pair to an isolated window", TestMousePressNativeWindow)
FileAppend("All 38 behavior tests passed.`n", "*")
ExitApp 0

RunTest(name, test) {
    global testEvents, testOnSend, testReleaseTime, testHeldKeys
    global testClicks, testClickFailure, testWindowId, testWindowCriteria, testCursor, testClient
    global testOnClick, testClickFailAt
    global testMoves, testDragArmed, testDragged
    global testAppEvents
    global testWaitQueue, testFocusActive, testLogicalKeys, testBlockModes, enabled
    testEvents := []
    testOnSend := 0
    testReleaseTime := 0
    testHeldKeys := Map()
    testAppEvents := false
    testWaitQueue := []
    testFocusActive := true
    testLogicalKeys := Map()
    testBlockModes := []
    enabled := Map()
    testClicks := []
    testClickFailure := false
    testOnClick := 0
    testClickFailAt := 0
    testMoves := []
    testDragArmed := false
    testDragged := false
    testWindowId := 42
    testWindowCriteria := ""
    testCursor := {x: 450, y: 300}
    testClient := {x: 100, y: 50}
    test.Call()
    Assert(testWaitQueue.Length = 0, name " left a queued wait transition")
    Assert(!syntheticDown.Count && !chordHolds.Count && !heldOutputCounts.Count, name " left input owned")
    Assert(!A_IsCritical, name " left the thread critical")
    FileAppend("PASS: " name "`n", "*")
}

TestSequence() {
    global testOnSend
    testOnSend := ScheduleSequenceRelease
    HoldBehaviorDown("test", "press(x);sleep(150);hold(XButton2);sleep(150);press(x)", "NumpadEnter")
    AssertKeys(["{blind}{x down}", "{blind}{x up}", "{blind}{xbutton2 downr}",
        "{blind}{xbutton2 up}", "{blind}{x down}", "{blind}{x up}"])
    Assert(testEvents[3]["time"] - testEvents[2]["time"] >= 150, "prefix delay was skipped")
    Assert(testEvents[5]["time"] - testReleaseTime >= 150, "trailing delay started before release")
}

ScheduleSequenceRelease(keys) {
    if InStr(keys, "{xbutton2 downr}")
        SetTimer ReleaseSequence, -60
}

ReleaseSequence(*) {
    global testReleaseTime
    Assert(testEvents.Length = 3, "trailing steps ran while the trigger was held")
    HoldBehaviorDown("test", "press(z);hold(XButton2)", "NumpadEnter")
    Assert(testEvents.Length = 3, "auto-repeat replayed the prefix")
    testReleaseTime := A_TickCount
    ReleaseTriggerHolds("NumpadEnter")
}

TestEarlyRelease() {
    global testOnSend
    testOnSend := ScheduleEarlyRelease
    HoldBehaviorDown("test", "press(x);sleep(150);hold(XButton2);sleep(150);press(x)", "NumpadEnter")
    AssertKeys(["{blind}{x down}", "{blind}{x up}", "{blind}{x down}", "{blind}{x up}"])
}

ScheduleEarlyRelease(keys) {
    if (keys = "{blind}{x down}" && chordHolds.Has("test"))
        SetTimer () => ReleaseTriggerHolds("NumpadEnter"), -1
}

TestChordRelease() {
    global testOnSend
    testOnSend := ScheduleChordRelease
    HoldBehaviorDown("test", "sleep(1);hold(XButton2);press(z)", "x NumpadEnter")
    AssertKeys(["{blind}{xbutton2 downr}", "{blind}{xbutton2 up}", "{blind}{z down}", "{blind}{z up}"])
}

ScheduleChordRelease(keys) {
    if InStr(keys, "{xbutton2 downr}")
        SetTimer () => ReleaseTriggerHolds("x"), -60
}

TestSharedOutput() {
    HoldChordDown("other", "XButton2", "F1")
    SetTimer ReleaseSharedOutput, -60
    HoldBehaviorDown("test", "sleep(1);hold(XButton2);press(z)", "NumpadEnter")
    Assert(heldOutputCounts["xbutton2"] = 1, "sequence released another owner's hold")
    AssertKeys(["{blind}{xbutton2 downr}", "{blind}{z down}", "{blind}{z up}"])
    HoldChordUp("other")
    Assert(testEvents[4]["keys"] = "{blind}{xbutton2 up}", "last owner did not release the mouse")
}

ReleaseSharedOutput(*) {
    Assert(heldOutputCounts["xbutton2"] = 2, "shared hold was not acquired")
    ReleaseTriggerHolds("NumpadEnter")
}

TestStandaloneHold() {
    HoldChordDown("test", "XButton2 RButton", "NumpadEnter")
    Assert(testEvents.Length = 2, "standalone hold did not press both buttons")
    ReleaseTriggerHolds("NumpadEnter")
    AssertKeys(["{blind}{xbutton2 downr}", "{blind}{rbutton downr}", "{blind}{rbutton up}{xbutton2 up}"])
}

TestFailedSend() {
    global testOnSend
    testOnSend := FailMouseDown
    failed := false
    try HoldBehaviorDown("test", "sleep(1);hold(XButton2);press(x)", "NumpadEnter")
    catch Error {
        failed := true
    }
    Assert(failed, "send failure was swallowed")
    AssertKeys(["{blind}{xbutton2 downr}", "{blind}{xbutton2 up}"])
}

TestPartialFailure() {
    global testOnSend
    HoldChordDown("other", "RButton", "F1")
    testOnSend := FailMouseDown
    failed := false
    try HoldBehaviorDown("test", "sleep(1);hold(XButton2 RButton);press(x)", "NumpadEnter")
    catch Error {
        failed := true
    }
    Assert(failed, "partial send failure was swallowed")
    Assert(heldOutputCounts["rbutton"] = 1, "failure released a key this sequence never acquired")
    AssertKeys(["{blind}{rbutton downr}", "{blind}{xbutton2 downr}", "{blind}{xbutton2 up}"])
    HoldChordUp("other")
}

WaitStep(key, down, result, callback := 0) {
    return Map("key", StrLower(key), "down", down, "result", result, "callback", callback)
}

TestWaitForMouse() {
    global testWaitQueue, testHeldKeys
    testWaitQueue := [
        WaitStep("LButton", true, false, () => testHeldKeys.Set("rbutton", true)),
        WaitStep("LButton", true, true)
    ]
    ExecuteBehavior("press(x);waitfor(LButton);press(y)", "", "Game.exe")
    AssertKeys(["{blind}{x down}", "{blind}{x up}", "{blind}{y down}", "{blind}{y up}"])
}

TestWaitForHeldButton() {
    global testWaitQueue, testHeldKeys
    testHeldKeys["lbutton"] := true
    testWaitQueue := [WaitStep("LButton", false, false), WaitStep("LButton", false, true), WaitStep("LButton", true, true)]
    ExecuteBehavior("press(x);waitfor(LButton);press(y)")
    AssertKeys(["{blind}{x down}", "{blind}{x up}", "{blind}{y down}", "{blind}{y up}"])
}

TestWaitForStages() {
    global testWaitQueue
    testWaitQueue := [WaitStep("SC025", true, true), WaitStep("LButton", true, false), WaitStep("LButton", true, true)]
    ExecuteBehavior("press(x);waitfor(SC025);press(y);waitfor(LButton);press(z)")
    AssertKeys(["{blind}{x down}", "{blind}{x up}", "{blind}{y down}", "{blind}{y up}", "{blind}{z down}", "{blind}{z up}"])
}

TestWaitForModifiers() {
    global testWaitQueue, testLogicalKeys
    testWaitQueue := [
        WaitStep("LButton", true, true),
        WaitStep("LButton", false, true),
        WaitStep("LButton", true, true, () => testLogicalKeys.Set("RCtrl", true))
    ]
    ExecuteBehavior("waitfor(rctrl LButton);press(y)")
    AssertKeys(["{blind}{y down}", "{blind}{y up}"])
}

TestWaitForReleasedTrigger() {
    global testWaitQueue
    testWaitQueue := [WaitStep("LButton", true, true, () => ReleaseTriggerHolds("q"))]
    HoldBehaviorDown("test", "press(x);waitfor(LButton);hold(XButton2);press(y)", "q")
    AssertKeys(["{blind}{x down}", "{blind}{x up}", "{blind}{y down}", "{blind}{y up}"])
}

LoseWaitFocus() {
    global testFocusActive
    testFocusActive := false
}

TestWaitForFocusLoss() {
    global testWaitQueue
    testWaitQueue := [WaitStep("LButton", true, false, LoseWaitFocus)]
    ExecuteBehavior("press(x);waitfor(LButton);press(y)", "", "Game.exe")
    AssertKeys(["{blind}{x down}", "{blind}{x up}"])
}

TestWaitForDisabledProfile() {
    global testWaitQueue, enabled
    enabled["profile"] := true
    testWaitQueue := [WaitStep("LButton", true, false, () => enabled.Set("profile", false))]
    ExecuteBehavior("press(x);waitfor(LButton);press(y)", "", "Game.exe", "", true, "profile")
    AssertKeys(["{blind}{x down}", "{blind}{x up}"])
}

TestWaitForFocusRace() {
    global testWaitQueue
    testWaitQueue := [WaitStep("LButton", true, true, LoseWaitFocus)]
    ExecuteBehavior("waitfor(LButton);press(y)", "", "Game.exe")
    AssertKeys([])
}

TestWaitForLockCleanup() {
    global testWaitQueue, testBlockModes
    testWaitQueue := [WaitStep("LButton", true, false, LoseWaitFocus)]
    ExecuteBehavior("lock;waitfor(LButton);press(y)", "", "Game.exe")
    Assert(testBlockModes.Length = 2 && testBlockModes[1] = "MouseMove" && testBlockModes[2] = "MouseMoveOff", "cancelled chain left mouse movement blocked")
    AssertKeys([])
}

TestWaitForEmpty() {
    failed := false
    try ExecuteBehavior("waitfor();press(y)")
    catch ValueError {
        failed := true
    }
    Assert(failed, "empty wait trigger was accepted")
    AssertKeys([])
}

TestStartOverlay() {
    global testAppEvents, testEvents
    testAppEvents := []
    ExecuteBehavior("startoverlay( timer & active );sleep(1);startoverlay(icon)", "", "Game.exe")
    Assert(testAppEvents.Length = 2, "startoverlay did not complete its sequence")
    Assert(testAppEvents[1]["event"] = "overlay_started", "startoverlay sent the wrong event")
    Assert(testAppEvents[1]["item"] = "timer & active", "startoverlay lost its selected item")
    Assert(testAppEvents[1]["state"] = "", "startoverlay confused item and state IDs")
    Assert(testAppEvents[2]["item"] = "icon", "startoverlay lost its second item")
    Assert(testEvents.Length = 0, "startoverlay sent keyboard or mouse input")
}

TestWindowCommands() {
    global testCommands
    testCommands := []
    ExecuteBehavior("borderless;stretch;fit", "", "Game & App.exe")
    Assert(testCommands.Length = 3, "window command was skipped")
    for index, command in ["borderless", "stretch", "fit"]
        Assert(testCommands[index] = command "?exe=[encoded:Game & App.exe]", "window command lost its configured target")
    Assert(testEvents.Length = 0, "window behavior sent keyboard or mouse input")
    ExecuteBehavior("fit", "", "")
    Assert(testCommands.Length = 3, "empty target sent a window command")
}

TestResolutionCommand() {
    global testCommands
    testCommands := []
    ExecuteBehavior("resolution(1280, 720);fit;resolution(1920,1080)", "", "Game & App.exe")
    Assert(testCommands.Length = 3, "resolution sequence was skipped")
    Assert(testCommands[1] = "resolution?exe=[encoded:Game & App.exe]&width=1280&height=720", "resolution lost its target or dimensions")
    Assert(testCommands[2] = "fit?exe=[encoded:Game & App.exe]", "resolution interrupted the next step")
    Assert(testCommands[3] = "resolution?exe=[encoded:Game & App.exe]&width=1920&height=1080", "second resolution was skipped")
    ExecuteBehavior("resolution(1280,720)", "", "")
    ExecuteBehavior("resolution(1.5,720);resolution(-1,720);resolution(1280,)", "", "Game.exe")
    Assert(testCommands.Length = 3, "invalid resolution or empty target sent a command")
    Assert(testEvents.Length = 0, "resolution sent keyboard or mouse input")
}

TestGlobalResolutionCommand() {
    global testCommands, testActiveExe
    testCommands := []
    ExecuteBehavior("resolution(1280,720)", "", "*")
    Assert(testCommands.Length = 1, "global resolution was skipped")
    Assert(testCommands[1] = "resolution?exe=[encoded:Active & App.exe]&width=1280&height=720", "global resolution did not use the active app")
    testActiveExe := ""
    try {
        ExecuteBehavior("resolution(1920,1080)", "", "*")
        Assert(testCommands.Length = 1, "missing active app sent a resolution command")
    } finally {
        testActiveExe := "Active & App.exe"
    }
}

TestPressModifiers() {
    global testEvents, testHeldKeys
    for key in ["LShift", "RShift", "LCtrl", "RCtrl", "LAlt", "RAlt", "LWin", "RWin"] {
        testEvents := []
        testHeldKeys := Map(key, true)
        ExecuteBehavior("press(y)")
        AssertKeys(["{blind}{y down}", "{blind}{y up}"])
        Assert(testHeldKeys[key], "press released " key)
    }
    testEvents := []
    testHeldKeys := Map("RCtrl", true, "LShift", true)
    ExecuteBehavior("press(y)")
    AssertKeys(["{blind}{y down}", "{blind}{y up}"])
}

TestTriggerModifiers() {
    global testHeldKeys
    testHeldKeys := Map("RAlt", true, "LCtrl", true, "LShift", true)
    ExecuteBehavior("press(Home)", "^!")
    AssertKeys(["{blind^!}{home down}", "{blind^!}{home up}"])
}

TestHeldOutputModifier() {
    global testHeldKeys
    testHeldKeys := Map("RCtrl", true, "RShift", true)
    ExecuteBehavior("press(rctrl y)")
    AssertKeys(["{blind}{y down}", "{blind}{y up}"])
}

TestExactAltGrModifiers() {
    global testHeldKeys
    testHeldKeys := Map("RAlt", true)
    Assert(TriggerModifiersAllowed("ralt 1"), "plain Right Alt requires a phantom Ctrl")
    testHeldKeys["LCtrl"] := true
    Assert(TriggerModifiersAllowed("ralt 1"), "AltGr's synthesized Ctrl blocked the binding")
    for key in ["RCtrl", "LShift", "RShift", "LAlt", "LWin", "RWin"] {
        testHeldKeys[key] := true
        Assert(!TriggerModifiersAllowed("ralt 1"), "exact AltGr accepted extra " key)
        testHeldKeys.Delete(key)
    }
    testHeldKeys["RShift"] := true
    Assert(TriggerModifiersAllowed("RALT RSHIFT 1"), "explicit Shift was rejected")
}

TestMousePressButtons() {
    previousDelay := A_ControlDelay
    for button, expected in Map("LButton", "Left", "RButton", "Right", "MButton", "Middle",
        "XButton1", "X1", "XButton2", "X2", "m1", "Left", "m2", "Right") {
        ExecuteBehavior("mousepress(" button ");press(y)", "", "Game.exe")
        clickEvent := testClicks[testClicks.Length]
        Assert(clickEvent.button = expected && clickEvent.count = 1, "mousepress sent the wrong button or count")
        Assert(clickEvent.position = "X350 Y250" && clickEvent.target = 42, "mousepress lost its position or window")
        Assert(clickEvent.options = "NA Pos", "mousepress changed focus or split the down/up pair")
    }
    Assert(testClicks.Length = 7 && testEvents.Length = 14, "mousepress skipped or duplicated sequence steps")
    Assert(A_ControlDelay = previousDelay, "mousepress changed control delay")
}

TestMousePressCoordinates() {
    global testCursor, testClient
    testCursor := {x: -1800, y: 155}
    testClient := {x: -1920, y: 25}
    ExecuteBehavior("mousepress(LButton)", "", "Game.exe")
    Assert(testClicks[1].position = "X120 Y130", "mousepress mishandled a monitor with negative screen coordinates")
    testCursor := {x: -1920, y: 25}
    ExecuteBehavior("mousepress(RButton)", "", "Game.exe")
    Assert(testClicks[2].position = "X0 Y0", "mousepress mishandled the client origin")
    Assert(testEvents.Length = 0, "mousepress used ordinary injected input")
}

TestMousePressTarget() {
    ExecuteBehavior("mousepress(LButton)", "", "Game & App.exe")
    Assert(testWindowCriteria = "ahk_exe Game & App.exe", "mousepress lost the configured target")
    ExecuteBehavior("mousepress(LButton)", "", "*")
    Assert(testWindowCriteria = "A", "global mousepress did not target the active window")
    ExecuteBehavior("mousepress(LButton)")
    Assert(testWindowCriteria = "A", "unconfigured mousepress did not target the active window")
}

TestMousePressInvalid() {
    global testWindowId
    failed := false
    try ExecuteBehavior("mousepress(ctrl LButton);press(y)")
    catch ValueError {
        failed := true
    }
    Assert(failed, "unsupported alternate button did not fail")
    testWindowId := 0
    failed := false
    try ExecuteBehavior("mousepress(LButton);press(y)", "", "Missing.exe")
    catch TargetError {
        failed := true
    }
    Assert(failed && testClicks.Length = 0 && testEvents.Length = 0, "missing target used fallback input or continued the sequence")
}

TestMousePressFailure() {
    global testClickFailure
    testClickFailure := true
    previousDelay := A_ControlDelay
    failed := false
    try ExecuteBehavior("mousepress(LButton);press(y)", "", "Game.exe")
    catch Error {
        failed := true
    }
    Assert(failed && A_ControlDelay = previousDelay, "failed mousepress click swallowed the error or changed delay")
    Assert(testClicks.Length = 1 && testEvents.Length = 0, "failed mousepress click used fallback input or continued the sequence")
}

TestMousePressHeldInput() {
    global testHeldKeys, testClicks
    for button in ["LButton", "RButton", "MButton", "XButton1", "XButton2", "m1", "m2"] {
        testClicks := []
        key := button = "m1" ? "lbutton" : button = "m2" ? "rbutton" : StrLower(button)
        testHeldKeys := Map(key, true, "RCtrl", true, "LShift", true, "LWin", true)
        ExecuteBehavior("mousepress(" button ")", "", "Game.exe")
        AssertClickOptions(["NA Pos U", "NA Pos", "NA Pos U"])
        Assert(testClicks[2].time - testClicks[1].time >= 30, "held button was not released long enough to re-press")
        Assert(testEvents.Length = 0, "mousepress sent global input")
        for heldKey, held in testHeldKeys
            Assert(held, "mousepress released physical " heldKey)
    }
}

TestMousePressReleasedDuringTap() {
    global testHeldKeys, testOnClick
    testHeldKeys := Map("lbutton", true)
    testOnClick := ReleaseMouseDuringTap
    ExecuteBehavior("mousepress(LButton)", "", "Game.exe")
    AssertClickOptions(["NA Pos U", "NA Pos", "NA Pos U"])
    Assert(!testHeldKeys["lbutton"], "mousepress ignored a physical release")
}

ReleaseMouseDuringTap(options) {
    global testHeldKeys
    if (options = "NA Pos U")
        testHeldKeys["lbutton"] := false
}

TestMousePressSharedHold() {
    HoldChordDown("other", "LButton", "F1")
    try {
        ExecuteBehavior("mousepress(LButton)", "", "Game.exe")
        AssertClickOptions(["NA Pos U", "NA Pos", "NA Pos D"])
        Assert(heldOutputCounts["lbutton"] = 1, "mousepress released another behavior's hold")
    } finally {
        HoldChordUp("other")
    }
}

TestMousePressHeldFailure() {
    global testHeldKeys, testClickFailAt, testClicks
    for failAt in [1, 2, 3] {
        testClicks := []
        testHeldKeys := Map("lbutton", true)
        testClickFailAt := failAt
        previousDelay := A_ControlDelay
        failed := false
        try ExecuteBehavior("mousepress(LButton);press(y)", "", "Game.exe")
        catch Error {
            failed := true
        }
        Assert(failed && A_ControlDelay = previousDelay, "mousepress failure swallowed its error or changed delay")
        Assert(testClicks[testClicks.Length].options = "NA Pos U", "failed mousepress left the window button down")
        Assert(!A_IsCritical && testEvents.Length = 0, "failed mousepress left the thread critical or continued the sequence")
    }
}

TestMousePressExit() {
    global testHeldKeys, testClicks
    testHeldKeys := Map("lbutton", true)
    FinishMousePress("X350 Y250", 42, "Left", "lbutton", "Exit")
    AssertClickOptions(["NA Pos U"])
    testHeldKeys := Map()
    testClicks := []
    heldOutputCounts["lbutton"] := 1
    try FinishMousePress("X350 Y250", 42, "Left", "lbutton", "Exit")
    finally heldOutputCounts.Delete("lbutton")
    AssertClickOptions(["NA Pos U"])
}

TestMousePressLegacyAlias() {
    ExecuteBehavior("pressalt(LButton)", "", "Game.exe")
    AssertClickOptions(["NA Pos"])
    Assert(testClicks[1].button = "Left", "legacy pressalt changed its button")
}

TestMousePressPickup() {
    global testHeldKeys, testOnClick
    testHeldKeys := Map("lbutton", true)
    testOnClick := TrackPickupClick
    ExecuteBehavior("press(lctrl 4);goto(72.4,61.5);sleep(20);pressalt(LButton);restorecursor", "", "Game.exe")
    Assert(!testDragged, "cursor restoration dragged the UI after the pickup")
    Assert(testMoves.Length = 2, "pickup skipped goto or cursor restoration")
    Assert(testMoves[1].x = 824 && testMoves[1].y = 542, "pickup moved to the wrong viewport position")
    Assert(testMoves[2].x = 450 && testMoves[2].y = 300, "pickup did not restore the original cursor")
    Assert(testClicks[2].position = "X724 Y492", "pickup clicked the wrong client coordinates")
    AssertClickOptions(["NA Pos U", "NA Pos", "NA Pos U"])
    Assert(testHeldKeys["lbutton"], "pickup changed the physical button state")
}

TrackPickupClick(options) {
    global testDragArmed
    ; A down at the pickup point can grab the UI; a complete click or up releases it.
    testDragArmed := options = "NA Pos D"
}

AssertClickOptions(expected) {
    Assert(testClicks.Length = expected.Length, "unexpected mousepress event count")
    for index, options in expected
        Assert(testClicks[index].options = options, "unexpected mousepress transition at " index)
}

TestMousePressNativeWindow() {
    global testWindowId, testNativeTarget, testNativeMessages, testHeldKeys
    window := Gui("+ToolWindow -Caption")
    messages := [0x201, 0x202, 0x204, 0x205, 0x207, 0x208, 0x20B, 0x20C]
    try {
        window.Show("Hide w400 h300")
        testWindowId := window.Hwnd
        testNativeTarget := window.Hwnd
        for message in messages
            OnMessage message, RecordNativeClick
        for button, downMessage in Map("LButton", 0x201, "RButton", 0x204, "MButton", 0x207,
            "XButton1", 0x20B, "XButton2", 0x20B) {
            for held in [false, true] {
                testHeldKeys := Map(StrLower(button), held)
                testNativeMessages := []
                ExecuteBehavior("mousepress(" button ")", "", "Test.exe")
                expected := held ? [downMessage + 1, downMessage, downMessage + 1, downMessage + 1]
                    : [downMessage, downMessage + 1]
                Assert(testNativeMessages.Length = expected.Length, "native mousepress delivered the wrong message count")
                for index, item in testNativeMessages {
                    Assert(item.message = expected[index], "native mousepress delivered the wrong button transition")
                    Assert((item.position & 0xFFFF) = 350 && (item.position >> 16 & 0xFFFF) = 250,
                        "native mousepress delivered the wrong client coordinates")
                    if (button = "XButton1" || button = "XButton2")
                        Assert((item.buttons >> 16) = (button = "XButton1" ? 1 : 2),
                            "native mousepress delivered the wrong side button")
                }
            }
        }
    } finally {
        for message in messages
            OnMessage message, RecordNativeClick, 0
        testNativeTarget := 0
        window.Destroy()
    }
    Assert(testEvents.Length = 0, "native mousepress emitted global input")
}

RecordNativeClick(buttons, position, message, hwnd) {
    if (hwnd = testNativeTarget)
        testNativeMessages.Push({buttons: buttons, position: position, message: message})
}

TestMouseGetPos(&x, &y, *) {
    x := testCursor.x
    y := testCursor.y
}

TestMouseMove(x, y, speed := 0) {
    global testCursor, testDragged
    if (testDragArmed && (testCursor.x != x || testCursor.y != y))
        testDragged := true
    testMoves.Push({x: x, y: y})
    testCursor := {x: x, y: y}
}

TestTryGetViewportFromApp(&x, &y, &width, &height) {
    x := 100
    y := 50
    width := 1000
    height := 800
    return true
}

TestWinExist(criteria) {
    global testWindowCriteria
    testWindowCriteria := criteria
    return testWindowId
}

TestWinGetClientPos(&x, &y, &width := unset, &height := unset, target := "") {
    Assert(target = testWindowId, "client position queried for the wrong window")
    x := testClient.x
    y := testClient.y
}

TestControlClick(position, target, text := "", button := "", count := 1, options := "") {
    testClicks.Push({position: position, target: target, button: button, count: count, options: options, time: A_TickCount})
    Assert(A_ControlDelay = -1, "mousepress click did not keep its down/up pair together")
    if IsObject(testOnClick)
        testOnClick.Call(options)
    if (testClickFailure || testClicks.Length = testClickFailAt)
        throw Error("simulated ControlClick failure")
    if testNativeTarget
        ControlClick(position, target,, button, count, options)
}

TestGetKeyState(key, mode := "") {
    global testHeldKeys, testLogicalKeys
    if (mode = "" && testLogicalKeys.Has(key))
        return testLogicalKeys[key]
    return testHeldKeys.Has(key) && testHeldKeys[key]
}

TestKeyWait(key, options := "") {
    global testWaitQueue, testEvents
    Assert(testWaitQueue.Length > 0, "unexpected wait for input")
    step := testWaitQueue.RemoveAt(1)
    Assert(StrLower(key) = step["key"], "waitfor observed the wrong trigger")
    Assert((InStr(options, "D") != 0) = step["down"], "waitfor accepted a held key without a fresh press")
    Assert(Mod(testEvents.Length, 2) = 0, "waitfor left a synthetic output down")
    if IsObject(step["callback"])
        step["callback"].Call()
    return step["result"]
}

TestWinActive(*) {
    global testFocusActive
    return testFocusActive
}

TestBlockInput(mode) {
    global testBlockModes
    testBlockModes.Push(mode)
}

TestWinGetProcessName(target) {
    global testActiveExe
    Assert(target = "A", "unexpected active-window target")
    if testActiveExe = ""
        throw Error("no active app")
    return testActiveExe
}

FailMouseDown(keys) {
    if InStr(keys, "{xbutton2 downr}")
        throw Error("simulated send failure")
}

TestSend(keys) {
    global testEvents
    keys := StrLower(keys)
    testEvents.Push(Map("keys", keys, "time", A_TickCount))
    if IsObject(testOnSend)
        testOnSend.Call(keys)
}

AssertKeys(expected) {
    Assert(testEvents.Length = expected.Length, "unexpected input event count")
    for index, keys in expected
        Assert(testEvents[index]["keys"] = keys, "unexpected input event at index " index)
}

Assert(condition, message) {
    if !condition
        throw Error(message)
}

TestUnhandledError(failure, *) {
    FileAppend("FAIL: " failure.Message " at line " failure.Line "`n", "*")
    ExitApp 1
}

SendOverlayCommand(command) {
    global testCommands
    if !IsObject(testCommands)
        throw Error("unexpected backend command")
    testCommands.Push(command)
}
SendAppEvent(eventType, hotkeyTrigger := "", stateId := "", itemId := "") {
    global testAppEvents
    if !IsObject(testAppEvents)
        throw Error("unexpected backend event")
    testAppEvents.Push(Map("event", eventType, "trigger", hotkeyTrigger, "state", stateId, "item", itemId))
}
UriEncode(value) {
    return "[encoded:" value "]"
}
CheckRepeatReleases(*) {
    throw Error("unexpected repeat timer")
}
