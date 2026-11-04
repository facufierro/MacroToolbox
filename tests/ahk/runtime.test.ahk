global behaviorRuntime := BehaviorExecutor(), runtimeActions := [], nativePosts := [], testOnPost := 0
global testHotkeys := [], testHotCriterion := 0
global copilotState := {native: false, input: ""}, copilotCtrlReleasePending := false, copilotShiftSuppressed := false
global testInputSuspended := false, recoveryTimerTicks := 0
global inputErrorUnwound := false, inputErrorContinued := false
global literalPackets := [], literalBuffer := 0, literalFailure := false, literalDeliveryResults := [], literalDeliveryCalls := []
global suspendDuringText := false
global literalOnPacket := 0
global testOnProfilesEnabled := 0
global testOnRuntimeAction := 0
RunRuntimeTest("Wait for awaits its next mouse action including On release", TestNextWaitMouse.Bind(false))
RunRuntimeTest("Wait for retains the next mouse action's double click", TestNextWaitMouse.Bind(true))
RunRuntimeTest("Wait for observes the next mouse press without replaying it", TestNextWaitPress)
RunRuntimeTest("Wait for can observe release of an already held mouse button", TestNextWaitHeldRelease)
RunRuntimeTest("consecutive waits require a new click before awaiting its release", TestConsecutiveWaitRelease.Bind("LButton", false, false))
RunRuntimeTest("consecutive keyboard waits require a new press before awaiting its release", TestConsecutiveWaitRelease.Bind("x", false, false))
RunRuntimeTest("a consecutive double-click wait requires two fresh clicks", TestConsecutiveWaitRelease.Bind("LButton", true, false))
RunRuntimeTest("a following nested sequence cannot reuse the previous wait's press", TestConsecutiveWaitRelease.Bind("LButton", false, true))
RunRuntimeTest("consecutive waits preserve releases of a different held input", TestConsecutiveWaitDifferentInput)
RunRuntimeTest("Wait for completes an overlay restart exactly once before continuing", TestNextWaitOverlay)
RunRuntimeTest("Start overlay starts every selected target before continuing", TestOverlayBatch.Bind(false, false))
RunRuntimeTest("Restart overlay restarts every selected target before continuing", TestOverlayBatch.Bind(false, true))
RunRuntimeTest("Stop overlay stops every selected target before continuing", TestOverlayBatch.Bind(true, false))
RunRuntimeTest("a failed overlay batch stops remaining targets and following actions", TestOverlayBatchFailure)
RunRuntimeTest("cancelling an overlay batch stops its remaining targets", TestOverlayBatchCancel)
RunRuntimeTest("Wait for awaits a following group without duplicating its actions", TestNextWaitGroup)
RunRuntimeTest("Wait for owns its next branch without blocking parallel siblings", TestNextWaitParallel)
RunRuntimeTest("focus loss cancels the next action pending inside Wait for", TestNextWaitCancel.Bind(false))
RunRuntimeTest("profile disable cancels the next action pending inside Wait for", TestNextWaitCancel.Bind(true))
RunRuntimeTest("missing next actions reject the whole plan before running any prefix", TestNextWaitInvalid)
RunRuntimeTest("a failed awaited action stops the sequence and reports its error", TestNextWaitFailure)
RunRuntimeTest("Wait for retains a following hold until its original trigger releases", TestNextWaitHold)
RunRuntimeTest("Wait for can await an overlay action in a background event", TestNextWaitBackground)
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
RunRuntimeTest("double clicks focus the text control before a following text step", TestDoubleClickTextFocus)
RunRuntimeTest("On release double clicks focus the text control before Secure send", TestDoubleClickTextFocus.Bind(true))
RunRuntimeTest("double clicks finish native delivery before a following behavior step", TestDoubleClickDeliveryOrder)
RunRuntimeTest("single clicks remain observable across input frames before typing", TestMouseClickFrames.Bind(false))
RunRuntimeTest("double clicks remain observable across input frames before typing", TestMouseClickFrames.Bind(true))
RunRuntimeTest("single clicks cancel between transitions and release their owned input", TestMouseClickCancellation.Bind(false))
RunRuntimeTest("double clicks cancel between transitions and release their owned input", TestMouseClickCancellation.Bind(true))
RunRuntimeTest("double clicks preserve another behavior's held button", TestDoubleMouseSharedHold)
RunRuntimeTest("failed double clicks release modifiers and stop their sequence", TestDoubleMouseFailure)
RunRuntimeTest("failed button-up delivery retries release and stops following input", TestMouseReleaseFailure)
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
RunRuntimeTest("Restore cursor resumes held mouse buttons after returning from a single click", TestCursorHeldButtons.Bind(false))
RunRuntimeTest("Restore cursor resumes held mouse buttons after returning from a double click", TestCursorHeldButtons.Bind(true))
RunRuntimeTest("implicit and explicit cursor saves retain their position and held buttons", TestCursorSavedState)
RunRuntimeTest("Lock cursor captures buttons pressed after the behavior started", TestCursorLockSnapshot)
RunRuntimeTest("Restore cursor respects releases and buttons first pressed after locking", TestCursorChangedButtons)
RunRuntimeTest("Restore cursor does not replay a consumed mouse trigger", TestCursorConsumedButton)
RunRuntimeTest("Restore cursor leaves uninterrupted physical holds alone", TestCursorUntouchedButton)
RunRuntimeTest("Restore cursor preserves another behavior's held button without dragging the clicked UI", TestCursorSharedHold)
RunRuntimeTest("cancellation unlocks the cursor without resuming an interrupted hold", TestCursorCancellation)
RunRuntimeTest("a button released during cursor restoration stays released", TestCursorResumeCleanup.Bind(false))
RunRuntimeTest("failed cursor restoration releases its window input and unlocks", TestCursorResumeCleanup.Bind(true))
RunRuntimeTest("native cursor restoration resumes the hold at the original client position", TestNativeCursorRestore)
RunRuntimeTest("live configuration preserves unrelated running behaviors", TestLiveConfiguration)
RunRuntimeTest("disabling one section preserves the other sections", TestSectionCancellation)
RunRuntimeTest("script work retains its calling section and defining owner", TestScriptSectionOwnership)
RunRuntimeTest("a shared profile toggle disables and reenables every matching profile once per press", TestSharedProfileToggle)
RunRuntimeTest("subfolder controls release their members and remain reachable while disabled", TestSubfolderToggle)
RunRuntimeTest("shared toggles include equivalent modifier orders and generic Ctrl", TestEquivalentProfileToggles)
RunRuntimeTest("shared toggles synchronize mixed states and skip inactive or disarmed profiles", TestScopedProfileToggle)
RunRuntimeTest("a profile toggle takes priority over a behavior using the same shortcut", TestProfileTogglePriority)
RunRuntimeTest("shared toggles require every configured modifier", TestProfileToggleRequiredModifiers)
RunRuntimeTest("shared toggles accept Copilot's logical Right Ctrl", TestCopilotProfileToggle)
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
RunRuntimeTest("On release waits without owning output and taps exactly once", TestReleasePress)
RunRuntimeTest("On release mouse press waits before acquiring modifiers or clicking", TestReleaseMouse.Bind(false))
RunRuntimeTest("On release mouse press preserves double clicks", TestReleaseMouse.Bind(true))
RunRuntimeTest("a release branch waits independently in a parallel group", TestReleaseParallel)
RunRuntimeTest("release before a delayed action does not rearm its wait", TestReleaseBeforeStep)
RunRuntimeTest("focus loss cancels pending release actions", TestReleaseCancellation.Bind(false))
RunRuntimeTest("profile disable cancels pending release actions", TestReleaseCancellation.Bind(true))
RunRuntimeTest("a released chord member unblocks On release actions", TestReleaseChord)
RunRuntimeTest("fresh hotkey presses each deliver one release action", TestReleaseRetrigger)
RunRuntimeTest("release actions preserve physical and Copilot-held modifiers", TestReleaseModifiers)
RunRuntimeTest("release actions without a trigger fail before executing any prefix", TestReleaseRequiresTrigger)
RunRuntimeTest("On release can tap its own consumed trigger", TestReleaseSelfPress)
RunRuntimeTest("expanded shortcuts replay their own keys and a shared E step", TestExpandedMatchedShortcuts.Bind(false))
RunRuntimeTest("expanded shortcuts retain matched output until their own release", TestExpandedMatchedShortcuts.Bind(true))
RunRuntimeTest("Secure send reads a local credential once per fresh hotkey press without the clipboard", TestSecureHotkey)
RunRuntimeTest("Secure send cancels pending output on focus loss", TestSecureCancellation.Bind(false))
RunRuntimeTest("Secure send cancels pending output on profile disable", TestSecureCancellation.Bind(true))
RunRuntimeTest("Secure send without a hotkey rejects its entire action tree before a prefix runs", TestSecureRequiresTrigger)
RunRuntimeTest("a missing secure credential reports a safe error and stops the sequence", TestSecureMissing)
RunRuntimeTest("secure input failures redact API arguments before reaching the console", TestSecureFailureRedaction)
RunRuntimeTest("Secure send keeps its position in a nested sequence", TestSecureSequence)
RunRuntimeTest("unhandled errors stop work and release remapped input and mouse locking", TestInputFailure.Bind(false))
RunRuntimeTest("error recovery preserves Windows-owned Ctrl and independent physical modifiers", TestInputFailure.Bind(true))
RunRuntimeTest("error recovery still unlocks input when executor cleanup fails", TestInputFailureCleanupError)
RunRuntimeTest("an unhandled timer error unwinds after disabling input and releasing locks", TestUnhandledInputFailure)
RunRuntimeTest("literal text preserves Unicode, line endings, Tab, and Backspace without modifier input", TestLiteralPackets)
RunRuntimeTest("literal text clears its packet buffer after a delivery failure", TestLiteralPacketFailure)
RunRuntimeTest("partial text delivery releases its unfinished key and reports a safe error", TestPartialLiteralDelivery)
RunRuntimeTest("suspension interrupts an in-progress text send and clears its buffer", TestSuspendedLiteralText)
RunRuntimeTest("text neutralizes either Alt and restores only current physical or macro owners", TestLiteralAltOwnership)
RunRuntimeTest("text restores both held Alt keys after input failure or suspension", TestLiteralAltCleanup)
RunRuntimeTest("Toggle keys holds through trigger release and stops once on the next fresh press", TestToggleKeys)
RunRuntimeTest("a second press cancels a toggle's delayed prefix without replaying it", TestTogglePending)
RunRuntimeTest("stopping a nested toggle cancels sibling waits and mouse locks", TestToggleNested)
RunRuntimeTest("toggle cleanup runs on focus loss, disabling, edits and exit", TestToggleCancellation)
RunRuntimeTest("stopping a toggle preserves another owner's held output", TestToggleSharedOutput)
RunRuntimeTest("toggle cleanup preserves native Right Ctrl, Shift and Win", TestToggleModifiers.Bind(true))
RunRuntimeTest("toggle cleanup preserves Copilot-owned Right Ctrl, Shift and Win", TestToggleModifiers.Bind(false))
RunRuntimeTest("a toggle can hold its own consumed trigger and release it on the next press", TestToggleSelfTrigger)
RunRuntimeTest("toggle actions without a hotkey reject the whole tree before its prefix", TestToggleRequiresTrigger)
RunRuntimeTest("a failed toggle releases its output and permits a fresh activation", TestToggleFailure)
RunRuntimeTest("exact toggle shortcuts ignore their own held modifiers while stopping", TestToggleOwnedModifiers.Bind(false))
RunRuntimeTest("exact toggle shortcuts distinguish physical and Copilot modifiers from their own output", TestToggleOwnedModifiers.Bind(true))
RunRuntimeTest("mouse toggles hold every button and modified combination until the next press", TestMouseToggleButtons)
RunRuntimeTest("mouse toggles share the first output owner until its last reference stops", TestMouseToggleShared)
RunRuntimeTest("stopping mouse toggles preserves an independently held physical button", TestMouseTogglePhysical)
RunRuntimeTest("mouse toggle cancellation releases the button and modifiers", TestMouseToggleCancellation.Bind(false))
RunRuntimeTest("cancelling a pending mouse toggle sends no click", TestMouseToggleCancellation.Bind(true))
RunRuntimeTest("failed mouse toggle downs release the button and modifiers", TestMouseToggleFailure.Bind(false))
RunRuntimeTest("failed mouse toggle ups retry release without abandoning modifiers", TestMouseToggleFailure.Bind(true))
RunRuntimeTest("mousepress preserves a toggled window button", TestMouseToggleClick)
RunRuntimeTest("native mouse toggles hold once and release at the current cursor position", TestNativeMouseToggle)
RunRuntimeTest("the shared profile shortcut stops active mouse toggles and rejects later hotkeys", TestProfileToggleStopsMouse)
RunRuntimeTest("shared profile disable stops input before a failed synchronization and permits retry", TestProfileToggleSyncFailure)
RunRuntimeTest("runtime profile status survives reloads and resumes from the switch", TestProfileEnabledReload)
RunRuntimeTest("profile controls ignore macro-owned extra modifiers while preserving physical exactness", TestProfileToggleHeldModifiers)
RunRuntimeTest("profile controls take priority across native wildcard and exact key variants", TestProfileToggleNativePriority)
RunRuntimeTest("retriggering during window button release preserves the new output owner", TestMouseToggleRetrigger)
FileAppend("All 151 structured runtime tests passed.`n", "*")
ExitApp 0

TestNextWaitMouse(doubleClick) {
    global testHeldKeys, testLogicalKeys, testWaitQueue
    testHeldKeys := Map("q", true)
    testLogicalKeys := Map("RCtrl", true, "Shift", true)
    testWaitQueue := [InputBatch([])]
    StartBehaviorRun("next-mouse", [Action("waitfor"), Action("mousepress", "key", "rctrl shift LButton", "onRelease", true, "doubleClick", doubleClick),
        Action("send", "text", "done")], "", "Game.exe", "", "q")
    Sleep 60
    Assert(!testEvents.Length && !nativePosts.Length && testInputCallbacks.Count = 1, "Wait for did not observe the following mouse action")
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    Sleep 10
    Assert(!testEvents.Length, "original hotkey release satisfied the next mouse action")
    loop doubleClick ? 2 : 1 {
        DeliverNextWaitInput("LButton", true)
        Assert(!testEvents.Length, "On release completed on button down")
        DeliverNextWaitInput("LButton", false)
    }
    AwaitRuns()
    Assert(!nativePosts.Length && !testClicks.Length, "Wait for replayed the physical click")
    AssertKeys(["{text}done"])
}

DeliverNextWaitInput(key, down) {
    global testRawPacket
    testRawPacket := InputEvent(key, down)["raw"]
    for callback in testInputCallbacks
        callback.Call(0, 42, 0xFF, A_ScriptHwnd)
    Sleep 10
}

TestNextWaitPress() {
    global testWaitQueue
    testWaitQueue := [InputBatch([InputEvent("LButton", true), InputEvent("LButton", false)])]
    StartBehaviorRun("next-press", [Action("waitfor"), Action("mousepress", "key", "LButton"), Action("send", "text", "done")])
    AwaitRuns()
    AssertKeys(["{text}done"])
    Assert(!nativePosts.Length && !testClicks.Length, "migrated wait sent an extra mouse click")
}

TestNextWaitHeldRelease() {
    global testWaitQueue, testHeldKeys
    testHeldKeys := Map("lbutton", true, "q", true)
    testWaitQueue := [InputBatch([])]
    StartBehaviorRun("next-held-release", [Action("waitfor"), Action("mousepress", "key", "LButton", "onRelease", true), Action("send", "text", "done")], "", "*", "", "q")
    DeliverNextWaitInput("LButton", false)
    AwaitRuns()
    AssertKeys(["{text}done"])
}

TestConsecutiveWaitRelease(key, doubleClick, grouped) {
    global testWaitQueue, testHeldKeys
    testHeldKeys := Map("q", true)
    testWaitQueue := [InputBatch([]), InputBatch([])]
    kind := key = "LButton" ? "mousepress" : "press"
    steps := [Action("send", "text", "prefix"), Action("waitfor"), Action(kind, "key", key)]
    releaseAction := Action(kind, "key", key, "onRelease", true)
    if kind = "mousepress"
        releaseAction["doubleClick"] := doubleClick
    following := [Action("waitfor"), releaseAction,
        Action("press", "key", "f1"), Action("press", "key", "v")]
    if grouped
        steps.Push(Action("sequence", "steps", following))
    else
        steps.Push(following*)
    StartBehaviorRun("spellbook", steps, "", "Game.exe", "", "q")
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    testHeldKeys[StrLower(key)] := true
    DeliverNextWaitInput(key, true)
    Assert(testEvents.Length = 1 && testInputCallbacks.Count = 1 && !testWaitQueue.Length, "second wait did not start after the first press")
    DeliverNextWaitInput(key, true)
    testHeldKeys[StrLower(key)] := false
    DeliverNextWaitInput(key, false)
    Sleep 50
    Assert(testEvents.Length = 1 && behaviorRuntime.runs.Count = 1 && testInputCallbacks.Count = 1, "the first click also completed the second wait")
    loop doubleClick ? 2 : 1 {
        testHeldKeys[StrLower(key)] := true
        DeliverNextWaitInput(key, true)
        Assert(testEvents.Length = 1, "second wait completed before the fresh input released")
        testHeldKeys[StrLower(key)] := false
        DeliverNextWaitInput(key, false)
        if doubleClick && A_Index = 1
            Assert(testEvents.Length = 1, "double-click wait completed after only one fresh click")
    }
    AwaitRuns()
    AssertKeys(["{text}prefix", "{blind}{f1 downr}", "{blind}{f1 up}", "{blind}{v downr}", "{blind}{v up}"])
    Assert(!nativePosts.Length && !testClicks.Length && !testInputCallbacks.Count, "consecutive waits replayed a click or retained an observer")
}

TestConsecutiveWaitDifferentInput() {
    global testWaitQueue, testHeldKeys
    testHeldKeys := Map("q", true, "lbutton", true)
    testWaitQueue := [InputBatch([]), InputBatch([])]
    StartBehaviorRun("different-input", [Action("waitfor"), Action("press", "key", "x"),
        Action("waitfor"), Action("mousepress", "key", "LButton", "onRelease", true),
        Action("send", "text", "done")], "", "*", "", "q")
    DeliverNextWaitInput("x", true)
    Assert(!testEvents.Length && testInputCallbacks.Count = 1 && !testWaitQueue.Length, "second wait did not start independently")
    testHeldKeys["lbutton"] := false
    DeliverNextWaitInput("LButton", false)
    AwaitRuns()
    AssertKeys(["{text}done"])
    testHeldKeys["q"] := false
    BindingHost().Release("q")
}

TestNextWaitOverlay() {
    global testOnRuntimeAction
    testOnRuntimeAction := CheckNextOverlayAcknowledgement
    StartBehaviorRun("next-overlay", [Action("waitfor"), Action("startoverlay", "itemIds", ["timer"], "restart", true), Action("send", "text", "done")])
    AwaitRuns()
    Assert(runtimeActions.Length = 1 && runtimeActions[1].id = "timer" && runtimeActions[1].value = "restart", "Wait for changed or duplicated the next overlay operation")
    AssertKeys(["{text}done"])
}

TestOverlayBatch(stop, restart) {
    global testOnRuntimeAction, enabled
    enabled["profile"] := true
    testOnRuntimeAction := CheckOverlayBatchOrder
    StartBehaviorRun("overlay-batch", [Action("waitfor"), stop
        ? Action("stopoverlay", "itemIds", ["first", "second", "part"])
        : Action("startoverlay", "itemIds", ["first", "second", "part"], "restart", restart), Action("send", "text", "done")], "", "*", "profile")
    AwaitRuns()
    Assert(runtimeActions.Length = 3, "overlay batch skipped or repeated a target")
    expected := stop ? "stop" : restart ? "restart" : "start"
    for index, id in ["first", "second", "part"]
        Assert(runtimeActions[index].id = id && runtimeActions[index].value = expected && runtimeActions[index].profile = "profile", "overlay batch changed a selected target, mode, or owning profile")
    AssertKeys(["{text}done"])
}

CheckOverlayBatchOrder(profile, kind, id, value) {
    Assert(!testEvents.Length, "behavior continued before every selected overlay completed")
}

TestOverlayBatchFailure() {
    global testOnRuntimeAction
    testOnRuntimeAction := FailOverlayBatch
    StartBehaviorRun("overlay-batch", [Action("startoverlay", "itemIds", ["first", "second", "must-not-run"]), Action("send", "text", "must not run")])
    AwaitRuns()
    Assert(!testEvents.Length && runtimeActions.Length = 2 && runtimeActions[1].id = "first" && runtimeActions[2].kind = "error", "failed overlay batch continued or lost its error")
}

FailOverlayBatch(profile, kind, id, value) {
    if id = "second"
        throw Error("simulated overlay batch failure")
}

TestOverlayBatchCancel() {
    global testOnRuntimeAction
    testOnRuntimeAction := CancelOverlayBatch
    StartBehaviorRun("overlay-batch", [Action("stopoverlay", "itemIds", ["first", "must-not-run"]), Action("send", "text", "must not run")])
    AwaitRuns()
    Assert(!testEvents.Length && runtimeActions.Length = 1 && runtimeActions[1].id = "first", "cancelled overlay batch continued")
}

CancelOverlayBatch(profile, kind, id, value) {
    behaviorRuntime.Cancel("overlay-batch")
}

CheckNextOverlayAcknowledgement(profile, kind, id, value) {
    Assert(kind = "overlay" && id = "timer" && value = "restart", "Wait for replaced the next action")
    Sleep 25
    Assert(!testEvents.Length, "Wait for continued before the overlay operation returned")
}

TestNextWaitGroup() {
    start := A_TickCount
    StartBehaviorRun("next-group", [Action("waitfor"), Action("sequence", "steps", [Action("sleep", "ms", "50"),
        Action("press", "key", "x")]), Action("send", "text", "done")])
    AwaitRuns()
    AssertKeys(["{blind}{x downr}", "{blind}{x up}", "{text}done"])
    Assert(testEvents[1]["time"] - start >= 50, "awaited group skipped its delay")
}

TestNextWaitParallel() {
    StartBehaviorRun("next-parallel", [Action("parallel", "steps", [Action("waitfor"), Action("sequence", "steps", [
        Action("sleep", "ms", "50"), Action("send", "text", "ready")]), Action("send", "text", "independent")]), Action("send", "text", "complete")])
    AwaitRuns()
    AssertKeys(["{text}independent", "{text}ready", "{text}complete"])
}

TestNextWaitCancel(disable) {
    global testHeldKeys, testFocusActive, enabled, testWaitQueue
    enabled["profile"] := true
    testHeldKeys := Map("q", true)
    testWaitQueue := [InputBatch([])]
    StartBehaviorRun("next-cancel", [Action("lock"), Action("waitfor"), Action("mousepress", "key", "LButton", "onRelease", true),
        Action("send", "text", "must not run")], "", "Game.exe", "profile", "q")
    if disable
        enabled["profile"] := false
    else
        testFocusActive := false
    AwaitRuns()
    Assert(!testEvents.Length && !nativePosts.Length && !testInputCallbacks.Count, "cancelled wait delivered its pending action")
    Assert(testBlockModes[testBlockModes.Length] = "MouseMoveOff", "cancelled wait left mouse input locked")
}

TestNextWaitInvalid() {
    for steps in [[Action("send", "text", "prefix"), Action("waitfor")], [Action("send", "text", "prefix"),
        Action("parallel", "steps", [Action("press", "key", "x"), Action("waitfor")])]] {
        rejected := false
        try StartBehaviorRun("next-invalid", steps)
        catch ValueError
            rejected := true
        Assert(rejected && !testEvents.Length && !behaviorRuntime.runs.Count, "orphan wait executed part of its plan")
        rejected := false
        try BindingHost().ValidatePlan(steps)
        catch ValueError
            rejected := true
        Assert(rejected, "input host accepted an orphan wait")
    }
}

TestNextWaitFailure() {
    global testOnRuntimeAction
    testOnRuntimeAction := FailNextOverlayOperation
    StartBehaviorRun("next-failure", [Action("waitfor"), Action("startoverlay", "itemIds", ["timer"], "restart", true), Action("send", "text", "must not run")])
    AwaitRuns()
    Assert(!testEvents.Length && runtimeActions.Length = 1 && runtimeActions[1].kind = "error", "awaited operation failure continued or lost its error")
}

FailNextOverlayOperation(profile, kind, id, value) {
    if kind = "overlay"
        throw Error("simulated awaited operation failure")
}

TestNextWaitHold() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("next-hold", [Action("waitfor"), Action("hold", "key", "rctrl x"), Action("send", "text", "done")], "", "*", "", "q")
    Sleep 50
    Assert(testEvents.Length = 2 && behaviorRuntime.runs.Count = 1, "Wait for did not retain the following hold")
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    AwaitRuns()
    Assert(testEvents[testEvents.Length]["keys"] = "{text}done" && !heldOutputCounts.Count, "awaited hold did not release before continuing")
}

TestNextWaitBackground() {
    global testFocusActive
    testFocusActive := false
    StartBehaviorRun("next-background", [Action("waitfor"), Action("startoverlay", "itemIds", ["timer"], "restart", true)], "", "Game.exe", "", "", true)
    AwaitRuns()
    Assert(runtimeActions.Length = 1 && runtimeActions[1].kind = "overlay", "generic Wait for was incorrectly treated as an input action")
}

TestToggleOwnedModifiers(sided) {
    global testHeldKeys, testLogicalKeys, testOnSend, copilotCtrlHeld
    host := SelfTriggerTestHost([Action("sequence", "steps", [Action("toggle", "key", sided ? "rctrl rshift ralt rwin w" : "ctrl shift alt win w")])], true)
    binding := host.bindings["$*SC012"][1]
    binding["exact"] := true
    testOnSend := ObserveToggleModifiers
    testHeldKeys := Map("e", true, "SC012", true)
    DispatchTestHotkey("$*SC012")
    testHeldKeys := Map()
    DispatchTestHotkey("$*SC012 up")
    Assert(!TriggerModifiersAllowed("e"), "toggle did not establish its logical modifiers")
    Assert(host.Matches(binding), "toggle's own modifiers blocked its stop shortcut")
    Assert(!TriggerModifiersAllowed("x"), "toggle relaxed ordinary hotkey matching")
    if sided {
        testLogicalKeys["LCtrl"] := true
        Assert(host.Matches(binding), "toggle's AltGr output blocked its own stop shortcut")
        testHeldKeys["LCtrl"] := true
        Assert(!host.Matches(binding), "AltGr output hid an independent physical Left Ctrl")
        testHeldKeys["LCtrl"] := false, testLogicalKeys["LCtrl"] := false
    }
    for key in sided ? ["RCtrl", "RShift", "RAlt", "RWin"] : ["LCtrl", "LShift", "LAlt", "LWin"] {
        testHeldKeys[key] := true
        Assert(!host.Matches(binding), "toggle ignored an independently held physical " key)
        testHeldKeys[key] := false
    }
    if sided {
        copilotCtrlHeld := true
        Assert(!host.Matches(binding), "toggle ignored Copilot-owned Right Ctrl")
        copilotCtrlHeld := false
    }
    testHeldKeys["e"] := true, testHeldKeys["SC012"] := true
    Assert(IsObject(DispatchTestHotkey("$*SC012")), "stop shortcut did not reach the generated hook")
    Assert(!behaviorRuntime.runs.Count && !heldOutputCounts.Count, "toggle with modifier output could not stop")
    testHeldKeys := Map()
    DispatchTestHotkey("$*SC012 up")
    Assert(TriggerModifiersAllowed("e"), "stopped toggle left a modifier logically down")
    testOnSend := 0
}

ObserveToggleModifiers(keys) {
    for key in ["Ctrl", "Shift", "Alt", "LWin", "RCtrl", "RShift", "RAlt", "RWin"] {
        logical := RegExMatch(key, "^(Ctrl|Shift|Alt)$") ? "L" key : key
        if InStr(keys, "{" StrLower(key) " downr}")
            testLogicalKeys[logical] := true
        if InStr(keys, "{" StrLower(key) " up}")
            testLogicalKeys[logical] := false
    }
}

ReleaseToggleKey(key := "q") {
    testHeldKeys[key] := false
    behaviorRuntime.ReleaseTrigger(key)
}

TestToggleKeys() {
    global testHeldKeys
    steps := [Action("toggle", "key", "w")]
    testHeldKeys := Map("q", true)
    StartBehaviorRun("toggle", steps, "", "*", "", "q")
    StartBehaviorRun("toggle", steps, "", "*", "", "q")
    ReleaseToggleKey()
    Sleep 60
    AssertKeys(["{blind}{w downr}"])
    Assert(behaviorRuntime.runs.Count = 1, "toggle ended when its trigger was released")
    testHeldKeys["q"] := true
    StartBehaviorRun("toggle", steps, "", "*", "", "q")
    StartBehaviorRun("toggle", steps, "", "*", "", "q")
    AssertKeys(["{blind}{w downr}", "{blind}{w up}"])
    Assert(!behaviorRuntime.runs.Count && behaviorRuntime.latches.Has("toggle"), "stopping a toggle did not debounce the off press")
    ReleaseToggleKey()
    testHeldKeys["q"] := true
    StartBehaviorRun("toggle", steps, "", "*", "", "q")
    Assert(testEvents.Length = 3, "a fresh third press did not restart the toggle")
    ReleaseToggleKey()
    behaviorRuntime.Cancel("toggle")
    AssertKeys(["{blind}{w downr}", "{blind}{w up}", "{blind}{w downr}", "{blind}{w up}"])
}

TestTogglePending() {
    global testHeldKeys
    steps := [Action("send", "text", "prefix"), Action("sleep", "ms", "150"), Action("toggle", "key", "w")]
    testHeldKeys := Map("q", true)
    StartBehaviorRun("delayed-toggle", steps, "", "*", "", "q")
    ReleaseToggleKey()
    testHeldKeys["q"] := true
    StartBehaviorRun("delayed-toggle", steps, "", "*", "", "q")
    Sleep 200
    AssertKeys(["{text}prefix"])
    Assert(!behaviorRuntime.runs.Count, "second press did not stop the delayed toggle")
    ReleaseToggleKey()
}

TestToggleNested() {
    global testHeldKeys, testWaitQueue
    testHeldKeys := Map("q", true), testWaitQueue := [InputBatch([])]
    steps := [Action("lock"), Action("parallel", "steps", [Action("sequence", "steps", [Action("toggle", "key", "w LButton")]),
        Action("waitfor", "key", "x")]), Action("send", "text", "must not run")]
    StartBehaviorRun("nested-toggle", steps, "", "*", "", "q")
    ReleaseToggleKey()
    Assert(testInputCallbacks.Count = 1, "parallel wait did not start")
    testHeldKeys["q"] := true
    StartBehaviorRun("nested-toggle", steps, "", "*", "", "q")
    Assert(!testInputCallbacks.Count && !behaviorRuntime.runs.Count, "stopping toggle left a sibling wait running")
    Assert(testBlockModes[testBlockModes.Length] = "MouseMoveOff", "stopping toggle left the cursor locked")
    AssertKeys(["{blind}{w downr}", "{blind}{w up}"])
    Assert(!testClicks.Length, "stopping a pending nested toggle delivered a click")
    ReleaseToggleKey()
}

TestToggleCancellation() {
    global testHeldKeys, testFocusActive, enabled
    for mode in ["focus", "profile", "section", "edit", "exit"] {
        testHeldKeys := Map("q", true), testFocusActive := true, enabled["profile"] := true
        steps := [Action("toggle", "key", "w")]
        StartBehaviorRun("cleanup-toggle", steps, "", "Game.exe", "profile", "q", false, "hotkeys")
        ReleaseToggleKey()
        switch mode {
            case "focus": testFocusActive := false
            case "profile": enabled["profile"] := false
            case "section": behaviorRuntime.CancelSection("profile", "hotkeys")
            case "edit": behaviorRuntime.CancelProfile("profile")
            case "exit": behaviorRuntime.Stop()
        }
        AwaitRuns()
        Assert(!heldOutputCounts.Count && !syntheticDown.Count, mode " left a toggled key held")
        testFocusActive := true, enabled["profile"] := true
        Sleep 20
        Assert(!behaviorRuntime.runs.Count, "returning to the app restarted a stopped toggle")
    }
}

TestToggleSharedOutput() {
    global testHeldKeys
    testHeldKeys := Map("q", true, "z", true)
    steps := [Action("toggle", "key", "w")]
    StartBehaviorRun("shared-toggle", steps, "", "*", "", "q")
    ReleaseToggleKey()
    StartBehaviorRun("other-owner", [Action("hold", "key", "w")], "", "*", "", "z")
    Assert(heldOutputCounts["w"] = 2, "toggle did not share the existing output owner")
    testHeldKeys["q"] := true
    StartBehaviorRun("shared-toggle", steps, "", "*", "", "q")
    AssertKeys(["{blind}{w downr}"])
    Assert(heldOutputCounts["w"] = 1, "stopping a toggle released another owner's key")
    ReleaseToggleKey()
    testHeldKeys["z"] := false
    AwaitRuns()
    AssertKeys(["{blind}{w downr}", "{blind}{w up}"])
}

TestToggleModifiers(native) {
    global testHeldKeys, testLogicalKeys, copilotCtrlHeld
    testHeldKeys := Map("q", true, "LShift", true, "LWin", true)
    testLogicalKeys := Map("RCtrl", true), copilotCtrlHeld := !native
    if native
        testHeldKeys["RCtrl"] := true
    steps := [Action("toggle", "key", "rctrl lshift lwin w")]
    try {
        StartBehaviorRun("modifier-toggle", steps, "", "*", "", "q")
        ReleaseToggleKey()
        testHeldKeys["q"] := true
        StartBehaviorRun("modifier-toggle", steps, "", "*", "", "q")
        AssertKeys(["{blind}{w downr}", "{blind}{w up}"])
        Assert(testLogicalKeys["RCtrl"] && testHeldKeys["LShift"] && testHeldKeys["LWin"], "toggle changed independent modifiers")
        ReleaseToggleKey()
    } finally copilotCtrlHeld := false
}

TestToggleSelfTrigger() {
    global testHeldKeys
    host := SelfTriggerTestHost([Action("toggle", "key", "e")])
    loop 2 {
        testHeldKeys := Map("e", true, "SC012", true)
        DispatchTestHotkey("$SC012")
        DispatchTestHotkey("$*SC012")
        testHeldKeys := Map()
        event := DispatchTestHotkey("$*SC012 up")
        Assert(IsObject(event) && !event.passthrough, "toggle leaked its consumed trigger release")
        Assert(testEvents.Length = A_Index, "toggle leaked a repeat or released its first hold too early")
    }
    AssertKeys(["{blind}{e downr}", "{blind}{e up}"])
}

TestToggleRequiresTrigger() {
    failed := false
    try StartBehaviorRun("event", [Action("send", "text", "must not run"), Action("sequence", "steps", [Action("toggle", "key", "w")])])
    catch ValueError
        failed := true
    Assert(failed && !testEvents.Length && !behaviorRuntime.runs.Count, "triggerless toggle ran a prefix or acquired input")
    failed := false
    try BindingHost().ValidatePlan([Action("toggle", "key", "fixture_unknown_key")])
    catch ValueError
        failed := true
    Assert(failed, "toggle bypassed validation of its output keys")
}

TestToggleFailure() {
    global testHeldKeys, testOnSend
    testHeldKeys := Map("q", true), testOnSend := FailToggleDown
    steps := [Action("toggle", "key", "x")]
    StartBehaviorRun("failed-toggle", steps, "", "*", "", "q")
    AssertKeys(["{blind}{x downr}", "{blind}{x up}"])
    Assert(!behaviorRuntime.runs.Count && runtimeActions.Length = 1, "toggle input failure did not stop and report")
    ReleaseToggleKey()
    testHeldKeys["q"] := true
    StartBehaviorRun("failed-toggle", steps, "", "*", "", "q")
    Assert(behaviorRuntime.runs.Count = 1, "a failed toggle prevented a fresh activation")
    ReleaseToggleKey()
    behaviorRuntime.Cancel("failed-toggle")
}

AwaitMouseToggle() {
    deadline := A_TickCount + 2000
    while !nativePosts.Length && !testClicks.Length {
        Assert(A_TickCount < deadline, "mouse toggle did not deliver its held button")
        Sleep 5
    }
}

TestMouseToggleButtons() {
    global testHeldKeys, testEvents, nativePosts
    for mouseKey, downMessage in Map("LButton", 0x201, "RButton", 0x204, "MButton", 0x207,
        "XButton1", 0x20B, "XButton2", 0x20B, "m1", 0x201, "m2", 0x204) {
        testHeldKeys := Map("q", true), testEvents := [], nativePosts := []
        steps := [Action("toggle", "key", "lctrl rshift " mouseKey)]
        StartBehaviorRun("mouse-toggle", steps, "", "Game.exe", "", "q")
        Assert(!nativePosts.Length, "mouse toggle did not let its modifiers settle")
        ReleaseToggleKey()
        AwaitMouseToggle()
        Sleep 40
        Assert(nativePosts.Length = 1 && nativePosts[1].message = downMessage, "mouse toggle clicked instead of holding, or repeated its down")
        Assert((nativePosts[1].buttons & 12) = 12, "mouse toggle omitted Ctrl or Shift")
        AssertKeys(["{blind}{lctrl downr}", "{blind}{rshift downr}"])
        testHeldKeys["q"] := true
        StartBehaviorRun("mouse-toggle", steps, "", "Game.exe", "", "q")
        Assert(nativePosts.Length = 2 && nativePosts[2].message = downMessage + 1, "second toggle press did not release the button")
        AssertKeys(["{blind}{lctrl downr}", "{blind}{rshift downr}", "{blind}{rshift up}{lctrl up}"])
        Assert(!behaviorRuntime.runs.Count && !syntheticDown.Count && !heldOutputCounts.Count, "mouse toggle left owned input")
        ReleaseToggleKey()
    }
}

TestMouseToggleShared() {
    global testHeldKeys
    testHeldKeys := Map("q", true, "w", true)
    steps := [Action("toggle", "key", "rctrl LButton")]
    StartBehaviorRun("first-mouse", steps, "", "Game.exe", "", "q")
    StartBehaviorRun("second-mouse", steps, "", "Game.exe", "", "w")
    AwaitMouseToggle()
    Assert(nativePosts.Length = 1 && heldOutputCounts["lbutton"] = 2, "shared toggle pressed the button twice")
    behaviorRuntime.Cancel("first-mouse")
    Assert(nativePosts.Length = 1 && heldOutputCounts["lbutton"] = 1, "stopping one toggle released its shared button")
    behaviorRuntime.Cancel("second-mouse")
    Assert(nativePosts.Length = 2 && nativePosts[2].message = 0x202, "last toggle did not release its shared button")
    AssertKeys(["{blind}{rctrl downr}", "{blind}{rctrl up}"])
    ReleaseToggleKey(), ReleaseToggleKey("w")
}

TestMouseTogglePhysical() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("physical-mouse", [Action("toggle", "key", "LButton")], "", "Game.exe", "", "q")
    AwaitMouseToggle()
    testHeldKeys["lbutton"] := true
    behaviorRuntime.Cancel("physical-mouse")
    AssertClickOptions(["NA Pos D"])
    Assert(!syntheticDown.Count && !heldOutputCounts.Count && testHeldKeys["lbutton"], "stopping toggle released an independent physical hold")
    ReleaseToggleKey()
}

TestMouseToggleCancellation(pending) {
    global testHeldKeys, nativePosts, testEvents, enabled, testFocusActive
    for reason in ["focus", "disable", "edit", "section", "exit"] {
        testHeldKeys := Map("q", true), nativePosts := [], testEvents := [], testFocusActive := true, enabled["profile"] := true
        StartBehaviorRun("cancel-mouse", [Action("toggle", "key", "rctrl LButton")], "", "Game.exe", "profile", "q", false, "hotkeys")
        if !pending
            AwaitMouseToggle()
        switch reason {
            case "focus": testFocusActive := false
            case "disable": enabled["profile"] := false
            case "edit": behaviorRuntime.CancelProfile("profile")
            case "section": behaviorRuntime.CancelSection("profile", "hotkeys")
            case "exit": behaviorRuntime.Stop()
        }
        AwaitRuns()
        Sleep 40
        if pending
            Assert(!nativePosts.Length, "cancelled pending mouse toggle clicked later")
        else
            Assert(nativePosts.Length = 2 && nativePosts[2].message = 0x202, "cancelled mouse toggle left its button down")
        AssertKeys(["{blind}{rctrl downr}", "{blind}{rctrl up}"])
        Assert(!syntheticDown.Count && !heldOutputCounts.Count, "cancelled mouse toggle left owned input")
        ReleaseToggleKey()
    }
    testFocusActive := true
}

TestMouseToggleFailure(onRelease) {
    global testHeldKeys, testOnPost
    testHeldKeys := Map("q", true)
    testOnPost := FailToggleMouseMessage.Bind(onRelease)
    StartBehaviorRun("failed-mouse-toggle", [Action("toggle", "key", "rctrl LButton")], "", "Game.exe", "", "q")
    if onRelease {
        AwaitMouseToggle()
        behaviorRuntime.Cancel("failed-mouse-toggle")
    }
    AwaitRuns()
    Assert(nativePosts.Length = (onRelease ? 3 : 2) && nativePosts[nativePosts.Length].message = 0x202, "failed mouse toggle did not release or retry its button")
    AssertKeys(["{blind}{rctrl downr}", "{blind}{rctrl up}"])
    Assert(runtimeActions.Length = 1 && runtimeActions[1].kind = "error", "mouse toggle delivery error was hidden")
    Assert(!syntheticDown.Count && !heldOutputCounts.Count, "failed mouse toggle left owned input")
    ReleaseToggleKey()
}

FailToggleMouseMessage(onRelease, message) {
    if nativePosts.Length = (onRelease ? 2 : 1)
        throw Error("simulated mouse toggle delivery failure")
}

TestMouseToggleClick() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("toggled-button", [Action("toggle", "key", "LButton")], "", "Game.exe", "", "q")
    AwaitMouseToggle()
    StartBehaviorRun("click-toggled-button", [Action("mousepress", "key", "LButton")], "", "Game.exe")
    deadline := A_TickCount + 2000
    while behaviorRuntime.runs.Has("click-toggled-button") {
        Assert(A_TickCount < deadline, "click did not finish alongside a mouse toggle")
        Sleep 5
    }
    AssertClickOptions(["NA Pos D", "NA Pos U", "NA Pos D", "NA Pos U", "NA Pos D"])
    Assert(heldOutputCounts["lbutton"] = 1, "click released the toggle's ownership")
    behaviorRuntime.Cancel("toggled-button")
    Assert(testClicks.Length = 6 && testClicks[6].options = "NA Pos U", "stopping toggle did not release the resumed hold")
    ReleaseToggleKey()
}

TestNativeMouseToggle() {
    global testWindowId, testNativeTarget, testNativeMessages, testHeldKeys, testCursor
    window := Gui("+ToolWindow -Caption")
    try {
        window.Show("Hide w400 h300")
        testWindowId := window.Hwnd, testNativeTarget := window.Hwnd
        testNativeMessages := [], testHeldKeys := Map("q", true)
        OnMessage 0x201, RecordNativeClick
        OnMessage 0x202, RecordNativeClick
        steps := [Action("toggle", "key", "lctrl LButton")]
        StartBehaviorRun("native-mouse-toggle", steps, "", "Test.exe", "", "q")
        ReleaseToggleKey()
        AwaitMouseToggle()
        Sleep 60
        Assert(testNativeMessages.Length = 1 && testNativeMessages[1].message = 0x201 && (testNativeMessages[1].buttons & 8), "native toggle did not deliver one Ctrl+button down")
        testCursor := {x: 480, y: 320}, testHeldKeys["q"] := true
        StartBehaviorRun("native-mouse-toggle", steps, "", "Test.exe", "", "q")
        Sleep 20
        Assert(testNativeMessages.Length = 2 && testNativeMessages[2].message = 0x202, "native toggle did not release its button")
        Assert(testNativeMessages[2].position = (380 | (270 << 16)), "native button release used a stale cursor position")
        AssertKeys(["{blind}{lctrl downr}", "{blind}{lctrl up}"])
        ReleaseToggleKey()
    } finally {
        behaviorRuntime.Stop()
        OnMessage 0x201, RecordNativeClick, 0
        OnMessage 0x202, RecordNativeClick, 0
        testNativeTarget := 0
        window.Destroy()
    }
}

TestProfileToggleStopsMouse() {
    global enabled, behaviorRuntime, testHeldKeys
    profile := ToggleTestProfile("professions")
    binding := Map("key", "$*SC032", "trigger", "m", "modifiers", "", "chord", "SC032",
        "prerequisites", "", "specificity", 0, "exact", false, "toggle", false, "section", "hotkeys",
        "steps", [Action("toggle", "key", "lctrl LButton")])
    profile["bindings"].Push(binding)
    host := BindingHost()
    host.Apply([profile, ToggleTestProfile("main")])
    behaviorRuntime := BehaviorExecutor(host.PhysicalOwnsOutput.Bind(host))
    testHeldKeys := Map("SC032", true)
    DispatchTestHotkey("$*SC032")
    testHeldKeys["SC032"] := false
    DispatchTestHotkey("$*SC032 up")
    AwaitMouseToggle()
    testHeldKeys["LCtrl"] := true, testHeldKeys["LShift"] := true
    PressProfileToggle(host)
    Assert(!enabled["professions"] && !enabled["main"], "shared shortcut did not disable its profiles")
    Assert(!behaviorRuntime.runs.Count && !heldOutputCounts.Count, "shared shortcut did not stop the mouse toggle")
    testHeldKeys["SC032"] := true
    Assert(!IsObject(DispatchTestHotkey("$*SC032")), "disabled profile still started a mouse toggle")
    Assert(nativePosts.Length = 2 && nativePosts[2].message = 0x202, "disabling profile left a mouse button held")
}

TestProfileToggleSyncFailure() {
    global testHeldKeys, testOnProfilesEnabled, enabled, testEvents
    host := BindingHost()
    host.Apply([ToggleTestProfile("main"), ToggleTestProfile("buffs"), ToggleTestProfile("spells")])
    testHeldKeys := Map("LCtrl", true, "LShift", true, "q", true)
    StartBehaviorRun("main:hold", [Action("hold", "key", "x")], "", "*", "main", "q")
    StartBehaviorRun("buffs:hold", [Action("hold", "key", "y")], "", "*", "buffs", "q")
    testOnProfilesEnabled := FailStoppedProfileSync
    PressProfileToggle(host)
    Assert(!enabled["main"] && !enabled["buffs"] && !enabled["spells"], "failed synchronization left profiles enabled")
    Assert(!behaviorRuntime.runs.Count && !heldOutputCounts.Count && !testInputSuspended, "failed synchronization left held input or suspended the input host")
    Assert(runtimeActions.Length = 1 && runtimeActions[1].kind = "error", "failed synchronization was hidden")
    testOnProfilesEnabled := 0
    PressProfileToggle(host)
    Assert(enabled["main"] && enabled["buffs"] && enabled["spells"], "profile shortcut could not recover after a failed synchronization")
}

FailStoppedProfileSync(profiles, value) {
    Assert(!value && profiles.Count = 3, "profile disable was not published as one group")
    for id in profiles
        Assert(!enabled[id], "a profile was still enabled when synchronization began")
    Assert(!behaviorRuntime.runs.Count && !heldOutputCounts.Count, "synchronization began before held inputs stopped")
    throw Error("simulated profile synchronization failure")
}

TestProfileEnabledReload() {
    global enabled, testHeldKeys
    profile := ToggleTestProfile("main")
    profile["enabled"] := false
    host := BindingHost()
    host.Apply([profile])
    Assert(!enabled["main"], "runtime-disabled profile became active on reload")
    updated := ToggleTestProfile("main")
    updated["enabled"] := false, updated["revision"] := "edited"
    host.Apply([updated])
    Assert(!enabled["main"], "editing a runtime-disabled profile enabled it")
    updated := ToggleTestProfile("main")
    updated["enabled"] := true
    host.Apply([updated])
    Assert(enabled["main"], "switch enable did not resume the profile")
    testHeldKeys["q"] := true
    StartBehaviorRun("main:hold", [Action("hold", "key", "x")], "", "*", "main", "q")
    updated := ToggleTestProfile("main")
    updated["enabled"] := false
    host.Apply([updated])
    Assert(!enabled["main"] && !behaviorRuntime.runs.Count && !heldOutputCounts.Count, "runtime reload did not stop the disabled profile's held input")
}

TestProfileToggleHeldModifiers() {
    global enabled, testHeldKeys, testLogicalKeys, testOnSend
    host := BindingHost()
    host.Apply([ToggleTestProfile("main",, "$*<^<+SC029"), ToggleTestProfile("buffs",, "$*<^<+SC029")])
    testHeldKeys := Map("LCtrl", true, "LShift", true, "q", true)
    testOnSend := ObserveToggleModifiers
    StartBehaviorRun("main:toggle", [Action("toggle", "key", "ralt w")], "", "*", "main", "q")
    Assert(!TriggerModifiersAllowed("lctrl lshift " Chr(96), true), "fixture did not establish an extra output modifier")
    testHeldKeys["RAlt"] := true
    Assert(!IsObject(host.Find("$*<^<+SC029")), "profile control ignored an independently held physical modifier")
    testHeldKeys["RAlt"] := false
    testHeldKeys["LShift"] := false
    Assert(!IsObject(host.Find("$*<^<+SC029")), "profile control accepted a missing required modifier")
    testHeldKeys["LShift"] := true
    PressProfileToggle(host, "$*<^<+SC029")
    Assert(!enabled["main"] && !enabled["buffs"] && !behaviorRuntime.runs.Count, "held output modifiers blocked shared profile disable")
    Assert(!syntheticDown.Count && !heldOutputCounts.Count, "profile control left its toggle held")
}

TestProfileToggleNativePriority() {
    global testHeldKeys, enabled
    profile := ToggleTestProfile("main",, "$*<^<+SC029")
    stretch := profile["bindings"][1].Clone()
    stretch["key"] := "$<^<+SC029", stretch["toggle"] := false
    stretch["steps"] := [Action("send", "text", "must not run")]
    profile["bindings"].InsertAt(1, stretch)
    host := BindingHost()
    host.Apply([profile])
    testHeldKeys := Map("LCtrl", true, "LShift", true)
    PressProfileToggle(host)
    Assert(!enabled["main"] && !testEvents.Length, "native exact-key behavior intercepted the wildcard profile control")
    PressProfileToggle(host, "$*<^<+SC029")
    Assert(enabled["main"], "wildcard profile control could not re-enable the profile")
}

TestMouseToggleRetrigger() {
    global testHeldKeys, testOnClick
    testHeldKeys := Map("q", true, "w", true)
    StartBehaviorRun("old-mouse", [Action("toggle", "key", "LButton")], "", "Game.exe", "", "q")
    AwaitMouseToggle()
    testOnClick := ReplaceMouseToggleOnRelease
    behaviorRuntime.Cancel("old-mouse")
    Sleep 60
    AssertClickOptions(["NA Pos D", "NA Pos U", "NA Pos D"])
    Assert(heldOutputCounts["lbutton"] = 1 && syntheticDown.Has("lbutton"), "old button release deleted its replacement's output owner")
    behaviorRuntime.Cancel("replacement-mouse")
    Assert(testClicks.Length = 4 && testClicks[4].options = "NA Pos U", "replacement button could not release its output")
    ReleaseToggleKey(), ReleaseToggleKey("w")
}

ReplaceMouseToggleOnRelease(options) {
    global testOnClick
    if options != "NA Pos U"
        return
    testOnClick := 0
    StartBehaviorRun("replacement-mouse", [Action("toggle", "key", "LButton")], "", "Game.exe", "", "w")
}

FailToggleDown(keys) {
    global testOnSend
    if InStr(keys, "{x downr}") {
        testOnSend := 0
        throw Error("fixture toggle delivery failure")
    }
}

TestLiteralAltOwnership() {
    global testHeldKeys, testLogicalKeys, heldOutputCounts, testEvents, literalOnPacket
    for key in ["LAlt", "RAlt"] {
        for physical in [true, false] {
            for released in [false, true] {
                testEvents := []
                testHeldKeys := Map("LShift", true, "LWin", true)
                testLogicalKeys := Map("RCtrl", true, key, true)
                heldOutputCounts := Map()
                if physical
                    testHeldKeys[key] := true
                else
                    heldOutputCounts[key] := 1
                literalOnPacket := released ? ReleaseTextAlt.Bind(key) : 0
                try NativeSendLiteralText("!trade rep")
                finally literalOnPacket := 0
                expected := ["{blind}{" StrLower(key) " up}"]
                if !released
                    expected.Push("{blind}{" StrLower(key) " down}")
                AssertKeys(expected)
                Assert(testLogicalKeys["RCtrl"] && testHeldKeys["LShift"] && testHeldKeys["LWin"], "Alt text changed an independent modifier")
                AssertLiteralBufferCleared()
            }
        }
    }
}

ReleaseTextAlt(key) {
    global literalOnPacket
    literalOnPacket := 0
    testHeldKeys[key] := false
    if heldOutputCounts.Has(key)
        heldOutputCounts.Delete(key)
}

TestLiteralAltCleanup() {
    global testHeldKeys, testLogicalKeys, testEvents, literalFailure, suspendDuringText, testInputSuspended
    for failure in [true, false] {
        testEvents := [], testHeldKeys := Map("LAlt", true, "RAlt", true), testLogicalKeys := Map("RCtrl", true)
        literalFailure := failure, suspendDuringText := !failure, testInputSuspended := false
        failed := false
        try NativeSendLiteralText("!trade rep")
        catch Error
            failed := true
        finally literalFailure := false, suspendDuringText := false, testInputSuspended := false
        Assert(failed = failure, "Alt cleanup changed text delivery's failure result")
        AssertKeys(["{blind}{lalt up}", "{blind}{ralt up}", "{blind}{lalt down}", "{blind}{ralt down}"])
        AssertLiteralBufferCleared()
    }
}

TestLiteralPackets() {
    global literalPackets, literalBuffer
    literalPackets := []
    previousDelay := A_KeyDelay
    SetKeyDelay -1
    try NativeSendLiteralText("Aø🚀`r`n`n`t`b")
    finally SetKeyDelay previousDelay
    expected := [[0, 65], [0, 248], [0, 0xD83D], [0, 0xDE80], [13, 0], [13, 0], [9, 0], [8, 0]]
    Assert(literalPackets.Length = expected.Length, "text encoding lost Unicode or changed CRLF normalization")
    for index, packet in literalPackets {
        Assert(packet.vk = expected[index][1] && packet.scan = expected[index][2], "text packet changed a code unit or control key")
        Assert(packet.flags = (packet.vk ? 0 : 4) && packet.up = (packet.flags | 2), "text packet did not pair down and up")
        Assert(packet.extra = 0xFFC3D44D - A_SendLevel, "text packet can retrigger a scan-code hotkey")
    }
    AssertLiteralBufferCleared()
    NativeSendLiteralText("")
    Assert(literalPackets.Length = expected.Length, "empty text sent input")
}

TestLiteralPacketFailure() {
    global literalFailure
    literalFailure := true, failed := false
    try NativeSendLiteralText("fixture-sensitive-text")
    catch Error
        failed := true
    finally literalFailure := false
    Assert(failed, "text delivery failure was swallowed")
    AssertLiteralBufferCleared()
}

AssertLiteralBufferCleared() {
    loop literalBuffer.Size
        Assert(NumGet(literalBuffer, A_Index - 1, "UChar") = 0, "literal text remained in its native packet buffer")
}

TestLiteralInput(inputs, inputSize) {
    global literalBuffer, testInputSuspended
    literalBuffer := inputs
    keyOffset := A_PtrSize = 8 ? 8 : 4
    literalPackets.Push({vk: NumGet(inputs, keyOffset, "UShort"), scan: NumGet(inputs, keyOffset + 2, "UShort"),
        flags: NumGet(inputs, keyOffset + 4, "UInt"), up: NumGet(inputs, inputSize + keyOffset + 4, "UInt"),
        extra: NumGet(inputs, keyOffset + (A_PtrSize = 8 ? 16 : 12), "UPtr")})
    if literalFailure
        throw Error("fixture input failure")
    if IsObject(literalOnPacket)
        literalOnPacket.Call()
    if suspendDuringText
        testInputSuspended := true
}

TestSuspendedLiteralText() {
    global literalPackets, suspendDuringText
    literalPackets := [], suspendDuringText := true
    try NativeSendLiteralText("fixture must stop")
    finally suspendDuringText := false
    Assert(literalPackets.Length = 1, "suspended text continued sending after input was disabled")
    AssertLiteralBufferCleared()
}

TestPartialLiteralDelivery() {
    global literalDeliveryResults, literalDeliveryCalls
    size := A_PtrSize = 8 ? 40 : 28, inputs := Buffer(size * 2, 0)
    for delivered in [0, 1, 2] {
        literalDeliveryResults := delivered = 1 ? [1, 1] : [delivered]
        literalDeliveryCalls := [], failed := false
        try NativeSendLiteralInput(inputs, size)
        catch Error as failure {
            failed := true
            Assert(failure.Message = "Text input could not be delivered.", "text delivery exposed API arguments")
        }
        Assert(failed = (delivered != 2), "partial text delivery was accepted")
        Assert(literalDeliveryCalls.Length = (delivered = 1 ? 2 : 1), "partial text delivery did not send the required key-up")
        if delivered = 1
            Assert(literalDeliveryCalls[2].count = 1 && literalDeliveryCalls[2].pointer = inputs.Ptr + size, "partial delivery retried a key-down instead of its key-up")
    }
}

TestTextDelivery(countType, count, pointerType, pointer, sizeType, size, returnType) {
    literalDeliveryCalls.Push({count: count, pointer: IsObject(pointer) ? pointer.Ptr : pointer})
    return literalDeliveryResults.RemoveAt(1)
}

TestInputFailure(native) {
    global testHeldKeys, testLogicalKeys, copilotState, copilotCtrlHeld, testInputSuspended, recoveryTimerTicks, testOnSend
    testHeldKeys := Map("q", true)
    testLogicalKeys := Map("RCtrl", true)
    copilotState := {native: native, input: ""}, copilotCtrlHeld := !native
    testInputSuspended := false, recoveryTimerTicks := 0
    execution := StartBehaviorRun("failed-input", [Action("lock"), Action("hold", "key", "x RShift"), Action("send", "text", "must not run")], "^", "*", "", "q")
    testHeldKeys["RShift"] := true, testHeldKeys["LWin"] := true
    SetTimer TickRuntimeHost, 10
    SetTimer CheckHookHealth, 10
    testOnSend := RequireInputSuspended
    result := HandleInputFailure(Error("fixture-sensitive-api-argument", -1, "fixture-sensitive-extra"), "Return")
    Sleep 30
    Assert(result = 1 && testInputSuspended, "unhandled error left hotkeys enabled or requested a modal error dialog")
    Assert(!recoveryTimerTicks, "error recovery allowed polling or hook recovery to restart input")
    Assert(execution.cancelled && !execution.locked && !behaviorRuntime.runs.Count && !behaviorRuntime.latches.Count, "error recovery left a run or mouse lock active")
    Assert(!syntheticDown.Count && !heldOutputCounts.Count && !chordHolds.Count && !copilotCtrlHeld, "error recovery left owned input behind")
    for event in testEvents {
        Assert(!InStr(event["keys"], "{rshift up}") && !InStr(event["keys"], "{lwin up}"), "error recovery released an independent physical modifier")
        if native
            Assert(!InStr(event["keys"], "{rctrl up}"), "error recovery released Windows-owned Right Ctrl")
    }
    Assert(testBlockModes[testBlockModes.Length - 1] = "Off" && testBlockModes[testBlockModes.Length] = "MouseMoveOff", "error recovery did not clear input and mouse movement blocking")
    Assert(runtimeActions.Length = 1 && InStr(runtimeActions[1].value, "Input disabled") && !InStr(runtimeActions[1].value, "fixture-sensitive"), "unexpected input error leaked API arguments or was not reported")
    copilotState := {native: false, input: ""}
}

class FailingUnlockExecutor extends BehaviorExecutor {
    Unlock(execution) {
        super.Unlock(execution)
        if execution.owner = "first-failure"
            throw Error("fixture cleanup failure")
    }
}

TestInputFailureCleanupError() {
    global behaviorRuntime, testInputSuspended, testOnSend, testHeldKeys
    behaviorRuntime := FailingUnlockExecutor()
    testHeldKeys := Map("q", true)
    StartBehaviorRun("first-failure", [Action("lock"), Action("hold", "key", "x")], "", "*", "", "q")
    StartBehaviorRun("second-failure", [Action("lock"), Action("hold", "key", "y")], "", "*", "", "q")
    testInputSuspended := false, testOnSend := RequireInputSuspended
    Assert(HandleInputFailure(Error("fixture failure"), "Return") = 1, "cleanup failure escaped the error handler")
    Assert(!behaviorRuntime.runs.Count && !behaviorRuntime.latches.Count && !syntheticDown.Count && !heldOutputCounts.Count && testBlockModes[testBlockModes.Length] = "MouseMoveOff", "cleanup failure abandoned other runs, owned keys, or mouse unlocking")
    behaviorRuntime := BehaviorExecutor()
}

RequireInputSuspended(*) {
    Assert(testInputSuspended, "error recovery released input before disabling hotkeys")
}

TestSuspend(value) {
    global testInputSuspended
    testInputSuspended := value
}

TickRuntimeHost(*) {
    global recoveryTimerTicks
    recoveryTimerTicks++
}

CheckHookHealth(*) {
    global recoveryTimerTicks
    recoveryTimerTicks++
}

TestUnhandledInputFailure() {
    global testHeldKeys, testInputSuspended, inputErrorUnwound, inputErrorContinued
    testHeldKeys := Map("q", true)
    execution := StartBehaviorRun("unhandled-error", [Action("lock"), Action("hold", "key", "x")], "", "*", "", "q")
    testInputSuspended := false, inputErrorUnwound := false, inputErrorContinued := false
    OnError TestUnhandledError, 0
    OnError HandleInputFailure
    try {
        SetTimer ThrowInputFixtureError, -1
        Sleep 60
    } finally {
        OnError HandleInputFailure, 0
        OnError TestUnhandledError
    }
    Assert(testInputSuspended && execution.cancelled && !execution.locked && !syntheticDown.Count, "the actual unhandled-error callback did not release input")
    Assert(inputErrorUnwound && !inputErrorContinued && runtimeActions.Length = 1, "the failed thread continued or its cleanup did not unwind")
}

ThrowInputFixtureError() {
    global inputErrorUnwound, inputErrorContinued
    try {
        RaiseInputFixtureError()
        inputErrorContinued := true
    } finally inputErrorUnwound := true
}

RaiseInputFixtureError() {
    throw Error("fixture-sensitive-unhandled-error")
}

SecureFixtureId() {
    guid := Buffer(16, 0), text := Buffer(78, 0)
    if DllCall("ole32\CoCreateGuid", "Ptr", guid, "Int") != 0
        throw Error("Could not create the credential fixture ID")
    DllCall("ole32\StringFromGUID2", "Ptr", guid, "Ptr", text, "Int", 39)
    return StrLower(Trim(StrGet(text), "{}"))
}

class SecureCredentialFixture {
    __New(password) {
        this.id := SecureFixtureId()
        this.target := "MacroToolbox/SecureSend/" this.id
        target := Buffer(StrPut(this.target, "UTF-16") * 2, 0)
        StrPut(this.target, target, "UTF-16")
        username := Buffer(StrPut("MacroToolbox", "UTF-16") * 2, 0)
        StrPut("MacroToolbox", username, "UTF-16")
        blob := Buffer((StrLen(password) + 1) * 2, 0)
        StrPut(password, blob, "UTF-16")
        credential := Buffer(A_PtrSize = 8 ? 80 : 52, 0)
        NumPut("UInt", 1, credential, 4)
        NumPut("Ptr", target.Ptr, credential, 8)
        NumPut("UInt", StrLen(password) * 2, credential, A_PtrSize = 8 ? 32 : 24)
        NumPut("Ptr", blob.Ptr, credential, A_PtrSize = 8 ? 40 : 28)
        NumPut("UInt", 2, credential, A_PtrSize = 8 ? 48 : 32)
        NumPut("Ptr", username.Ptr, credential, A_PtrSize = 8 ? 72 : 48)
        saved := DllCall("Advapi32\CredWriteW", "Ptr", credential, "UInt", 0)
        saveError := A_LastError
        DllCall("msvcrt\memset", "Ptr", blob.Ptr, "Int", 0, "UPtr", blob.Size, "CDecl Ptr")
        Assert(saved, "Could not save the temporary Windows credential (Windows error " saveError ")")
    }
    __Delete() {
        if this.HasOwnProp("target")
            DllCall("Advapi32\CredDeleteW", "WStr", this.target, "UInt", 1, "UInt", 0)
    }
}

TestSecureHotkey() {
    global testHeldKeys, testActiveExe
    secret := "fixture-only +!^{Enter};ø🚀"
    credential := SecureCredentialFixture(secret)
    host := SelfTriggerTestHost([Action("securesend", "credentialId", credential.id)])
    previousExe := testActiveExe
    testActiveExe := "WhatsApp.exe"
    beforeClipboard := DllCall("GetClipboardSequenceNumber", "UInt")
    try {
        loop 2 {
            testHeldKeys := Map("SC012", true)
            DispatchTestHotkey("$SC012")
            AwaitRuns()
            Assert(testEvents.Length = A_Index && testEvents[A_Index]["keys"] = "{text}" secret, "Secure send changed literal text or sent the wrong credential")
            DispatchTestHotkey("$*SC012")
            Assert(testEvents.Length = A_Index, "holding the trigger repeated the password")
            testHeldKeys["SC012"] := false
            DispatchTestHotkey("$*SC012 up")
        }
        Assert(beforeClipboard = DllCall("GetClipboardSequenceNumber", "UInt") && !behaviorClipboardPending, "Secure send put a password on the clipboard")
    } finally testActiveExe := previousExe
}

TestSecureCancellation(disable) {
    global testHeldKeys, testFocusActive, enabled
    credential := SecureCredentialFixture("fixture-only")
    testHeldKeys := Map("q", true), enabled["profile"] := true
    StartBehaviorRun("secure-cancel", [Action("sleep", "ms", "40"), Action("securesend", "credentialId", credential.id)], "", "Game.exe", "profile", "q")
    if disable
        enabled["profile"] := false
    else
        testFocusActive := false
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    AwaitRuns()
    Assert(!testEvents.Length && !runtimeActions.Length, "cancelled secure output was delivered")
}

TestSecureRequiresTrigger() {
    failed := false
    try StartBehaviorRun("secure-no-trigger", [Action("press", "key", "Tab"), Action("sequence", "steps", [Action("securesend", "credentialId", SecureFixtureId())])])
    catch ValueError as failure
        failed := InStr(failure.Message, "hotkey trigger")
    Assert(failed && !testEvents.Length && !behaviorRuntime.runs.Count, "Secure send executed a prefix without a hotkey")
}

TestSecureMissing() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("secure-missing", [Action("securesend", "credentialId", SecureFixtureId()), Action("send", "text", "must not run")], "", "*", "", "q")
    Assert(!testEvents.Length && runtimeActions.Length = 1 && runtimeActions[1].kind = "error", "missing password did not fail safely")
    Assert(InStr(runtimeActions[1].value, "Secure send failed"), "missing password reported an unrelated error")
    testHeldKeys["q"] := false
    AwaitRuns()
}

TestSecureFailureRedaction() {
    global testHeldKeys, testOnSend
    secret := "fixture-sensitive-api-argument"
    credential := SecureCredentialFixture(secret)
    testHeldKeys := Map("q", true), testOnSend := FailSecureFixtureSend
    StartBehaviorRun("secure-failure", [Action("securesend", "credentialId", credential.id), Action("send", "text", "must not run")], "", "*", "", "q")
    Assert(testEvents.Length = 1 && runtimeActions.Length = 1 && runtimeActions[1].kind = "error", "secure failure continued its sequence")
    Assert(!InStr(runtimeActions[1].value, secret) && InStr(runtimeActions[1].value, "Secure send failed"), "password leaked through an input API error")
    testHeldKeys["q"] := false
    AwaitRuns()
}

FailSecureFixtureSend(keys) {
    throw Error("input failure containing arguments: " keys)
}

TestSecureSequence() {
    global testHeldKeys
    secret := "fixture-only"
    credential := SecureCredentialFixture(secret)
    testHeldKeys := Map("q", true)
    StartBehaviorRun("secure-order", [Action("sequence", "steps", [Action("press", "key", "Tab"), Action("securesend", "credentialId", credential.id), Action("send", "text", "done")])], "", "*", "", "q")
    AwaitRuns()
    AssertKeys(["{blind}{tab downr}", "{blind}{tab up}", "{text}" secret, "{text}done"])
    testHeldKeys["q"] := false
    BindingHost().Release("q")
}

RunRuntimeTest(name, test) {
    global runtimeActions, nativePosts, testOnPost, testHotkeys, testHotCriterion, behaviorRuntime
    global testInputSuspended, testOnProfilesEnabled, testOnRuntimeAction
    runtimeActions := []
    nativePosts := []
    testOnPost := 0
    testHotkeys := []
    testHotCriterion := 0
    testInputSuspended := false
    testOnProfilesEnabled := 0
    testOnRuntimeAction := 0
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

TestReleasePress() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("release", [Action("press", "key", "x", "onRelease", true)], "", "*", "", "q")
    Sleep 70
    Assert(testEvents.Length = 0 && !heldOutputCounts.Count && behaviorRuntime.runs.Count = 1, "release action started before release")
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    AwaitRuns()
    BindingHost().Release("q")
    AssertKeys(["{blind}{x downr}", "{blind}{x up}"])
}

TestReleaseMouse(doubleClick) {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("release-click", [Action("mousepress", "key", "rctrl shift LButton", "onRelease", true, "doubleClick", doubleClick)], "", "Game.exe", "", "q")
    Sleep 70
    Assert(!testEvents.Length && !nativePosts.Length && !heldOutputCounts.Count, "release click acquired input before release")
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    AwaitRuns()
    Assert(nativePosts.Length = (doubleClick ? 4 : 2), "release click lost its click count")
    AssertKeys(["{blind}{rctrl downr}", "{blind}{shift downr}", "{blind}{shift up}{rctrl up}"])
}

TestReleaseParallel() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("release-parallel", [Action("parallel", "steps", [Action("press", "key", "x", "onRelease", true),
        Action("sequence", "steps", [Action("press", "key", "y"), Action("sleep", "ms", "20"), Action("send", "text", "ready")])])], "", "*", "", "q")
    Sleep 100
    AssertKeys(["{blind}{y downr}", "{blind}{y up}", "{text}ready"])
    testHeldKeys["q"] := false
    AwaitRuns()
    Assert(testEvents.Length = 5 && testEvents[4]["keys"] = "{blind}{x downr}", "release branch blocked or duplicated its sibling")
}

TestReleaseBeforeStep() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("early-release", [Action("sleep", "ms", "50"), Action("press", "key", "x", "onRelease", true), Action("send", "text", "done")], "", "*", "", "q")
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    AwaitRuns()
    AssertKeys(["{blind}{x downr}", "{blind}{x up}", "{text}done"])
}

TestReleaseCancellation(disable) {
    global testHeldKeys, enabled, testFocusActive
    enabled["profile"] := true
    testHeldKeys := Map("q", true)
    StartBehaviorRun("cancel-release", [Action("parallel", "steps", [Action("press", "key", "x", "onRelease", true),
        Action("mousepress", "key", "rctrl LButton", "onRelease", true)])], "", "Game.exe", "profile", "q")
    if disable
        enabled["profile"] := false
    else
        testFocusActive := false
    AwaitRuns()
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    Assert(!testEvents.Length && !nativePosts.Length && !testClicks.Length, "cancelled release action still delivered input")
}

TestReleaseChord() {
    global testHeldKeys
    testHeldKeys := Map("q", true, "w", true)
    StartBehaviorRun("release-chord", [Action("press", "key", "x", "onRelease", true)], "", "*", "", "q w")
    testHeldKeys["q"] := false
    BindingHost().Release("q")
    AwaitRuns()
    AssertKeys(["{blind}{x downr}", "{blind}{x up}"])
}

TestReleaseRetrigger() {
    global testHeldKeys
    steps := [Action("press", "key", "x", "onRelease", true)]
    loop 2 {
        testHeldKeys := Map("q", true)
        execution := StartBehaviorRun("release-repeat", steps, "", "*", "", "q")
        Assert(IsObject(execution), "fresh press could not arm its release action")
        Assert(!IsObject(StartBehaviorRun("release-repeat", steps, "", "*", "", "q")), "held trigger restarted a release action")
        testHeldKeys["q"] := false
        BindingHost().Release("q")
        AwaitRuns()
    }
    AssertKeys(["{blind}{x downr}", "{blind}{x up}", "{blind}{x downr}", "{blind}{x up}"])
}

TestReleaseModifiers() {
    global testHeldKeys, testLogicalKeys, copilotCtrlHeld
    testHeldKeys := Map("q", true, "RCtrl", true, "RShift", true, "LWin", true)
    StartBehaviorRun("physical-release", [Action("press", "key", "rctrl rshift lwin x", "onRelease", true)], "", "*", "", "q")
    testHeldKeys["q"] := false
    AwaitRuns()
    AssertKeys(["{blind}{x downr}", "{blind}{x up}"])
    copilotCtrlHeld := true
    testLogicalKeys["RCtrl"] := true
    try {
        testHeldKeys := Map("q", true)
        StartBehaviorRun("copilot-release", [Action("press", "key", "rctrl y", "onRelease", true)], "", "*", "", "q")
        testHeldKeys["q"] := false
        AwaitRuns()
        Assert(testEvents.Length = 4, "release action repeated or released Copilot's Right Ctrl")
    } finally copilotCtrlHeld := false
}

TestReleaseRequiresTrigger() {
    failed := false
    try StartBehaviorRun("no-trigger", [Action("press", "key", "x"), Action("sequence", "steps", [Action("mousepress", "key", "LButton", "onRelease", true)])])
    catch ValueError as failure
        failed := InStr(failure.Message, "hotkey trigger")
    Assert(failed && !testEvents.Length && !behaviorRuntime.runs.Count, "a triggerless release action ran its prefix or waited forever")
}

TestReleaseSelfPress() {
    global testHeldKeys
    host := BindingHost()
    behaviorRuntime.physicalOwner := host.PhysicalOwnsOutput.Bind(host)
    host.consumed["e"] := true
    testHeldKeys := Map("e", true)
    StartBehaviorRun("self-release", [Action("press", "key", "e", "onRelease", true)], "", "*", "", "e")
    Assert(!testEvents.Length, "self release tapped before the trigger was up")
    testHeldKeys["e"] := false
    host.Release("e")
    AwaitRuns()
    AssertKeys(["{blind}{e downr}", "{blind}{e up}"])
}

TestExpandedMatchedShortcuts(onRelease) {
    global testHeldKeys, behaviorRuntime, testEvents
    bindings := []
    loop 3 {
        trigger := "lctrl " A_Index, scan := "SC00" (A_Index + 1)
        bindings.Push(Map("key", "$<^" scan, "trigger", trigger, "modifiers", "^", "chord", scan,
            "prerequisites", "", "specificity", 0, "exact", true, "toggle", false, "section", "hotkeys",
            "steps", [Action("press", "key", trigger, "onRelease", onRelease), Action("press", "key", "e")]))
    }
    host := BindingHost()
    host.Apply([Map("id", "profile", "target", "Game.exe", "armed", true, "revision", "list", "bindings", bindings)])
    behaviorRuntime := BehaviorExecutor(host.PhysicalOwnsOutput.Bind(host))
    loop 3 {
        testEvents := []
        scan := "SC00" (A_Index + 1), number := String(A_Index)
        testHeldKeys := Map("LCtrl", true, scan, true, number, true)
        Assert(IsObject(DispatchTestHotkey("$<^" scan)), "list shortcut did not activate")
        if onRelease {
            Assert(!testEvents.Length, "matched release sent output before its trigger was released")
            testHeldKeys[scan] := false, testHeldKeys[number] := false
            DispatchTestHotkey("$*" scan " up")
        }
        AwaitRuns()
        AssertKeys(["{blind}{" number " downr}", "{blind}{" number " up}", "{blind^}{e downr}", "{blind^}{e up}"])
        Assert(testHeldKeys["LCtrl"] && !heldOutputCounts.Count && !syntheticDown.Count, "matched shortcut changed the physical modifier or left held output")
        testHeldKeys[scan] := false, testHeldKeys[number] := false
        DispatchTestHotkey("$*" scan " up")
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
    steps := [prefix, Action("waitfor", "key", "LButton"), Action("startoverlay", "itemIds", ["timer"], "restart", true)]
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
    StartBehaviorRun("operations", [Action("state", "stateId", "buff", "action", "set"), Action("bar", "itemId", "health", "value", "42"), Action("stopoverlay", "itemIds", ["timer"])], "", "*", "profile")
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
            Assert(nativePosts.Length = 2 || testClicks.Length = 2, "mousepress lost " button)
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
                        Assert(DllCall("GetForegroundWindow", "Ptr") != window.Hwnd, "mouse delivery activated its initially inactive target")
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

TestDoubleClickTextFocus(secure := false) {
    global testWindowId, testNativeTarget, testCursor, testOnSend, testExpectedFocus, testHeldKeys
    window := Gui("+ToolWindow -Caption")
    field := window.AddEdit("x10 y10 w200 h30", "first second")
    other := window.AddEdit("x10 y60 w200 h30", "other")
    try {
        window.Show("Hide w400 h300")
        testWindowId := window.Hwnd, testNativeTarget := window.Hwnd
        testCursor := {x: 130, y: 70}
        testExpectedFocus := field.Hwnd
        DllCall("SetFocus", "Ptr", other.Hwnd)
        Assert(DllCall("GetFocus", "Ptr") = other.Hwnd, "text fixture did not establish initial focus")
        ; SetFocus may activate its parent. Attribute activation to mouse delivery
        ; only when the fixture was still inactive after its own focus setup.
        foregroundAfterSetup := DllCall("GetForegroundWindow", "Ptr")
        testOnSend := CheckDoubleClickTextFocus
        if secure
            credential := SecureCredentialFixture("fixture")
        output := secure ? Action("securesend", "credentialId", credential.id) : Action("send", "text", "fixture")
        testHeldKeys := Map("q", true)
        StartBehaviorRun("focus-text", [Action("mousepress", "key", "LButton", "doubleClick", true, "onRelease", secure), output], "", "Test.exe", "", "q")
        if secure {
            Assert(DllCall("GetFocus", "Ptr") = other.Hwnd && !testEvents.Length, "release click focused or typed before release")
            testHeldKeys["q"] := false
            BindingHost().Release("q")
        }
        AwaitRuns()
        Assert(!runtimeActions.Length, "typing ran before the double click focused its text control" (runtimeActions.Length ? ": " runtimeActions[1].value : ""))
        Assert(foregroundAfterSetup = window.Hwnd || DllCall("GetForegroundWindow", "Ptr") != window.Hwnd, "targeted mouse messages activated the hidden fixture window")
    } finally {
        behaviorRuntime.Stop()
        testOnSend := 0, testNativeTarget := 0
        window.Destroy()
    }
}

CheckDoubleClickTextFocus(keys) {
    global testExpectedFocus
    Assert(DllCall("GetFocus", "Ptr") = testExpectedFocus, "double click did not focus the text control before typing")
    start := Buffer(4, 0), end := Buffer(4, 0)
    SendMessage 0xB0, start.Ptr, end.Ptr,, testExpectedFocus
    Assert(NumGet(end, 0, "UInt") > NumGet(start, 0, "UInt"), "double click did not select a word in the text control")
}

TestDoubleClickDeliveryOrder() {
    global testWindowId, testNativeTarget, testNativeMessages, testOnSend
    window := Gui("+ToolWindow -Caption")
    try {
        window.Show("Hide w400 h300")
        testWindowId := window.Hwnd, testNativeTarget := window.Hwnd, testNativeMessages := []
        for message in [0x201, 0x202, 0x203]
            OnMessage message, RecordNativeClick
        testOnSend := CheckDoubleClickDelivered
        StartBehaviorRun("double-delivery", [Action("mousepress", "key", "LButton", "doubleClick", true), Action("send", "text", "fixture")], "", "Test.exe")
        AwaitRuns()
        Assert(!runtimeActions.Length, "a following step ran before the target processed its double click")
    } finally {
        behaviorRuntime.Stop()
        testOnSend := 0, testNativeTarget := 0
        for message in [0x201, 0x202, 0x203]
            OnMessage message, RecordNativeClick, 0
        window.Destroy()
    }
}

CheckDoubleClickDelivered(keys) {
    Assert(testNativeMessages.Length = 4, "double-click messages were still queued when the next step ran")
}

TestMouseClickFrames(doubleClick) {
    global testWindowId, testNativeTarget, testOnSend
    window := Gui("+ToolWindow -Caption")
    state := {down: false, previous: false, presses: 0, released: false}
    messageHandler := (buttons, position, message, hwnd) => hwnd = window.Hwnd ? (state.down := message != 0x202) : 0
    frame := (*) => SampleMouseFrame(state)
    try {
        window.Show("Hide w400 h300")
        testWindowId := window.Hwnd, testNativeTarget := window.Hwnd
        for message in [0x201, 0x202, 0x203]
            OnMessage message, messageHandler
        SetTimer frame, 10
        expected := doubleClick ? 2 : 1
        testOnSend := (keys) => Assert(state.presses = expected && state.released, "typing preceded observable clicks and their final release")
        StartBehaviorRun("frame-click", [Action("mousepress", "key", "LButton", "doubleClick", doubleClick), Action("send", "text", "fixture")], "", "Test.exe")
        AwaitRuns()
        Assert(!runtimeActions.Length && state.presses = expected && state.released, "clicks collapsed within one input frame")
    } finally {
        behaviorRuntime.Stop()
        SetTimer frame, 0
        testOnSend := 0, testNativeTarget := 0
        for message in [0x201, 0x202, 0x203]
            OnMessage message, messageHandler, 0
        window.Destroy()
    }
}

SampleMouseFrame(state) {
    if state.down && !state.previous
        state.presses++
    state.previous := state.down
    state.released := state.presses > 0 && !state.down
}

TestMouseClickCancellation(doubleClick) {
    global nativePosts, testEvents, testFocusActive, enabled, testOnPost
    for disable in [false, true] {
        loop doubleClick ? 4 : 2 {
            nativePosts := [], testEvents := [], testFocusActive := true, enabled["profile"] := true
            testOnPost := InterruptMouseClick.Bind(disable, A_Index)
            StartBehaviorRun("cancel-click", [Action("mousepress", "key", "rctrl LButton", "doubleClick", doubleClick), Action("send", "text", "must not run")], "", "Game.exe", "profile")
            AwaitRuns()
            Assert(nativePosts.Length = A_Index + Mod(A_Index, 2) && nativePosts[nativePosts.Length].message = 0x202, "cancelling a click left a down or delivered a later click")
            AssertKeys(["{blind}{rctrl downr}", "{blind}{rctrl up}"])
            Assert(!runtimeActions.Length && !heldOutputCounts.Count && !syntheticDown.Count, "cancelled click leaked input or reported an error")
        }
    }
    testFocusActive := true, enabled["profile"] := true, testOnPost := 0
}

InterruptMouseClick(disable, afterMessage, message) {
    global testFocusActive, enabled
    if nativePosts.Length = afterMessage {
        if disable
            enabled["profile"] := false
        else
            testFocusActive := false
    }
}

TestDoubleMouseSharedHold() {
    global testHeldKeys
    testHeldKeys := Map("q", true)
    StartBehaviorRun("held-button", [Action("hold", "key", "LButton")], "", "*", "", "q")
    try {
        StartBehaviorRun("double-click", [Action("mousepress", "key", "LButton", "doubleClick", true)])
        deadline := A_TickCount + 2000
        while behaviorRuntime.runs.Has("double-click") {
            Assert(A_TickCount < deadline, "double click did not complete alongside another hold")
            Sleep 5
        }
        Assert(nativePosts.Length = 5, "held button lost its double click or initial release")
        AssertClickOptions(["NA Pos D"])
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

TestMouseReleaseFailure() {
    global testOnPost
    testOnPost := FailMouseRelease
    StartBehaviorRun("failed-mouse-reply", [Action("mousepress", "key", "rctrl LButton"), Action("press", "key", "x")])
    AwaitRuns()
    Assert(runtimeActions.Length = 1 && runtimeActions[1].kind = "error", "failed button-up continued its sequence")
    Assert(nativePosts.Length = 3 && nativePosts[2].message = 0x202 && nativePosts[3].message = 0x202, "failed button-up omitted release recovery")
    AssertKeys(["{blind}{rctrl downr}", "{blind}{rctrl up}"])
}

FailMouseRelease(message) {
    if message = 0x202 && nativePosts.Length = 2
        throw Error("simulated button-up delivery failure")
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

ToggleTestProfile(id, trigger := "lctrl lshift", key := "$<^<+SC029", target := "*", armed := true) {
    binding := Map("key", key, "trigger", trigger " " Chr(96), "modifiers", "^+", "chord", "SC029",
        "prerequisites", "", "specificity", 0, "exact", false, "toggle", true, "section", "", "steps", [])
    return Map("id", id, "target", target, "armed", armed, "revision", "same", "bindings", [binding])
}

PressProfileToggle(host, key := "$<^<+SC029") {
    global testHeldKeys
    testHeldKeys["SC029"] := true
    DispatchTestHotkey(key)
    testHeldKeys["SC029"] := false
    DispatchTestHotkey("$*SC029 up")
}

class SubfolderTestHost extends BindingHost {
    Reload(*) {
        this.reloads += 1
        if this.HasOwnProp("restore")
            this.Apply(this.restore)
    }
}

TestSubfolderToggle() {
    global enabled, testHeldKeys, testSubfolderFailure
    testSubfolderFailure := false
    control := ToggleTestProfile("subfolder-control")
    control["subfolderEnabled"] := true
    binding := control["bindings"][1]
    binding["subfolder"] := "combat"
    binding["folder"] := "game"
    main := ToggleTestProfile("main")
    paused := ToggleTestProfile("paused")
    other := ToggleTestProfile("other", "rctrl", "$>^SC029")
    for profile in [main, paused] {
        profile["folder"] := "game"
        profile["subfolder"] := "combat"
        profile["folderEnabled"] := true
    }
    other["folder"] := "game"
    other["subfolder"] := "other"
    host := SubfolderTestHost()
    host.reloads := 0
    profiles := [control, main, paused, other]
    host.Apply(profiles)
    enabled["paused"] := false
    testHeldKeys := Map("LCtrl", true, "LShift", true, "SC029", true, "q", true)
    StartBehaviorRun("main:hold", [Action("hold", "key", "x")], "", "*", "main", "q")
    StartBehaviorRun("other:hold", [Action("hold", "key", "y")], "", "*", "other", "q")
    DispatchTestHotkey("$<^<+SC029")
    DispatchTestHotkey("$<^<+SC029")
    Assert(!enabled["main"] && !enabled["paused"] && enabled["other"], "subfolder changed another group's activation")
    Assert(!heldOutputCounts.Has("x") && heldOutputCounts.Has("y"), "subfolder cancellation released the wrong input owner")
    Assert(runtimeActions.Length = 1 && runtimeActions[1].kind = "subfolder" && runtimeActions[1].profile = "game" && runtimeActions[1].id = "combat" && runtimeActions[1].value = "0", "subfolder toggle did not persist one group transition")
    Assert(host.reloads = 1, "held shortcut repeated the subfolder transition")
    testHeldKeys["SC029"] := false
    DispatchTestHotkey("$*SC029 up")
    control["subfolderEnabled"] := false
    for profile in [main, paused] {
        profile["folderEnabled"] := false
        profile["enabled"] := false
    }
    host.Apply(profiles)
    Assert(!host.Matches(main["bindings"][1]), "a profile shortcut bypassed its disabled subfolder")
    PressProfileToggle(host)
    Assert(runtimeActions.Length = 2 && runtimeActions[2].value = "1", "disabled subfolder could not be reenabled")
    Assert(!enabled["main"] && !enabled["paused"], "reenabling started members before the persisted configuration arrived")
    control["subfolderEnabled"] := true
    main["folderEnabled"] := true
    paused["folderEnabled"] := true
    main["enabled"] := true
    host.Apply(profiles)
    Assert(enabled["main"] && !enabled["paused"] && enabled["other"], "reenabling lost independent profile choices")
    Assert(!heldOutputCounts.Has("x") && heldOutputCounts.Has("y"), "reenabling restarted canceled work")
    host.restore := profiles
    testSubfolderFailure := true
    try host.ToggleProfiles(binding)
    finally testSubfolderFailure := false
    Assert(host.reloads = 3 && enabled["main"] && !enabled["paused"], "failed switch did not reload the persisted activation state")
    Assert(runtimeActions[runtimeActions.Length].kind = "error", "failed subfolder save was not reported")
    behaviorRuntime.CancelProfile("other")
}

TestSharedProfileToggle() {
    global enabled, testHeldKeys
    profiles := [ToggleTestProfile("main"), ToggleTestProfile("buffs"), ToggleTestProfile("spells")]
    host := BindingHost()
    host.Apply(profiles)
    testHeldKeys := Map("LCtrl", true, "LShift", true, "SC029", true, "q", true)
    StartBehaviorRun("main:hold", [Action("hold", "key", "x")], "", "*", "main", "q")
    StartBehaviorRun("buffs:hold", [Action("hold", "key", "y")], "", "*", "buffs", "q")
    DispatchTestHotkey("$<^<+SC029")
    for id in ["main", "buffs", "spells"]
        Assert(!enabled[id], "shared toggle left " id " enabled")
    Assert(!behaviorRuntime.runs.Count && !heldOutputCounts.Count, "shared disable retained running inputs")
    Assert(runtimeActions.Length = 3, "shared disable did not notify every profile")
    DispatchTestHotkey("$<^<+SC029")
    Assert(runtimeActions.Length = 3, "holding the toggle reversed its state")
    testHeldKeys["LShift"] := false
    testHeldKeys["SC029"] := false
    DispatchTestHotkey("$*SC029 up")
    Assert(!host.consumed.Has("SC029"), "releasing Shift first left the toggle consumed")
    testHeldKeys["LShift"] := true
    PressProfileToggle(host)
    for id in ["main", "buffs", "spells"]
        Assert(enabled[id], "shared toggle did not reenable " id)
    Assert(runtimeActions.Length = 6, "reenabling did not notify every profile")
    host.Apply(profiles)
    PressProfileToggle(host)
    for id in ["main", "buffs", "spells"]
        Assert(!enabled[id], "configuration refresh broke the shared toggle")
}

TestEquivalentProfileToggles() {
    global enabled, testHeldKeys
    main := ToggleTestProfile("main")
    main["bindings"].Push(ToggleTestProfile("duplicate", "lshift lctrl", "$<+<^SC029")["bindings"][1])
    host := BindingHost()
    host.Apply([main, ToggleTestProfile("consumables", "lshift ctrl", "$<+^SC029"),
        ToggleTestProfile("right-ctrl", "rctrl lshift", "$>^<+SC029"), ToggleTestProfile("ctrl-only", "lctrl", "$<^SC029")])
    testHeldKeys := Map("LCtrl", true, "LShift", true)
    loop 2 {
        PressProfileToggle(host)
        Assert(enabled["main"] = (A_Index = 2) && enabled["consumables"] = (A_Index = 2), "equivalent shortcuts did not toggle together")
        Assert(enabled["right-ctrl"] && enabled["ctrl-only"], "shared toggle changed a different modifier combination")
        Assert(runtimeActions.Length = A_Index * 2, "duplicate toggle fields toggled a profile twice")
    }
}

TestScopedProfileToggle() {
    global enabled, testHeldKeys, testFocusActive
    host := BindingHost()
    host.Apply([ToggleTestProfile("one"), ToggleTestProfile("two"),
        ToggleTestProfile("inactive",,, "Other.exe"), ToggleTestProfile("disarmed",,, "*", false)])
    enabled["one"] := false
    testFocusActive := false
    testHeldKeys := Map("LCtrl", true, "LShift", true)
    PressProfileToggle(host)
    Assert(!enabled["one"] && !enabled["two"], "mixed profile states did not close together")
    Assert(enabled["inactive"] && !enabled["disarmed"], "shared toggle changed an unavailable profile")
    PressProfileToggle(host)
    Assert(enabled["one"] && enabled["two"], "closed profile group did not reopen")
}

TestProfileTogglePriority() {
    global enabled, testHeldKeys
    profile := ToggleTestProfile("main")
    behavior := profile["bindings"][1].Clone()
    behavior["toggle"] := false
    behavior["section"] := "hotkeys"
    behavior["steps"] := [Action("press", "key", "x")]
    profile["bindings"].InsertAt(1, behavior)
    host := BindingHost()
    host.Apply([profile])
    testHeldKeys := Map("LCtrl", true, "LShift", true)
    enabled["main"] := false
    PressProfileToggle(host)
    Assert(enabled["main"], "toggle could not enable its profile")
    PressProfileToggle(host)
    Assert(!enabled["main"], "ordinary behavior prevented its profile from disabling")
    Assert(testEvents.Length = 0, "toggle shortcut also ran its ordinary behavior")
}

TestProfileToggleRequiredModifiers() {
    global enabled, testHeldKeys
    host := BindingHost()
    host.Apply([ToggleTestProfile("ctrl", "lctrl", "$<^SC029"), ToggleTestProfile("ctrl-shift"),
        ToggleTestProfile("altgr", "ralt", "$*>!SC029")])
    testHeldKeys := Map("LCtrl", true)
    PressProfileToggle(host, "$<^SC029")
    Assert(!enabled["ctrl"], "Ctrl shortcut did not disable its profile")
    Assert(enabled["ctrl-shift"] && enabled["altgr"], "shared toggle matched missing Shift or AltGr")
}

TestCopilotProfileToggle() {
    global enabled, testHeldKeys, testLogicalKeys
    host := BindingHost()
    host.Apply([ToggleTestProfile("right", "rctrl lshift", "$>^<+SC029"), ToggleTestProfile("generic", "ctrl lshift", "$^<+SC029")])
    testHeldKeys := Map("LShift", true)
    testLogicalKeys := Map("RCtrl", true)
    loop 2 {
        PressProfileToggle(host, "$>^<+SC029")
        Assert(enabled["right"] = (A_Index = 2) && enabled["generic"] = (A_Index = 2), "shared toggle ignored remapped logical Right Ctrl")
    }
    Assert(!TestGetKeyState("RCtrl", "P") && TestGetKeyState("RCtrl"), "toggle changed Copilot's modifier ownership")
}

TriggerTestHost(plain := false, chord := "SC013", steps := 0) {
    global behaviorRuntime
    if !IsObject(steps)
        steps := [Action("press", "key", "NumpadEnter"), Action("send", "text", "!trade rep"),
            Action("press", "key", "NumpadEnter"), Action("press", "key", "Tab"),
            Action("startoverlay", "itemIds", ["rep"], "restart", true)]
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
        Action("startoverlay", "itemIds", ["timer"], "restart", true)])
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
    global testSubfolderFailure
    if kind = "subfolder" && IsSet(testSubfolderFailure) && testSubfolderFailure
        throw Error("simulated subfolder save failure")
    if IsObject(testOnRuntimeAction)
        testOnRuntimeAction.Call(profile, kind, id, value)
    runtimeActions.Push({profile: profile, kind: kind, id: id, value: value})
}

TestSendProfilesEnabled(profiles, value) {
    if IsObject(testOnProfilesEnabled)
        testOnProfilesEnabled.Call(profiles, value)
    for id in profiles
        TestRuntimeAction(id, "enabled", "", value ? "1" : "0")
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

CursorClickSteps(button := "LButton", doubleClick := false) {
    return [Action("lock"), Action("goto", "x", "20", "y", "20"),
        Action("mousepress", "key", button, "doubleClick", doubleClick), Action("restorecursor")]
}

TestCursorHeldButtons(doubleClick) {
    global testHeldKeys, testClicks, nativePosts, testMoves, testCursor
    global testOnClick, testDragArmed, testDragged
    testOnClick := TrackPickupClick
    for button in ["LButton", "RButton", "MButton", "XButton1", "XButton2", "m1", "m2"] {
        key := button = "m1" ? "lbutton" : button = "m2" ? "rbutton" : StrLower(button)
        testHeldKeys := Map(key, true, "RCtrl", true, "LShift", true, "LWin", true)
        testClicks := [], nativePosts := [], testMoves := [], testCursor := {x: 450, y: 300}
        testDragArmed := false, testDragged := false
        steps := CursorClickSteps(button, doubleClick)
        steps.Push(Action("restorecursor"))
        StartBehaviorRun("restore-held", steps, "", "Game.exe")
        AwaitRuns()
        Assert(!testDragged, "restoration dragged the UI clicked by the behavior")
        Assert(testMoves[2].x = 450 && testMoves[2].y = 300, "restoration lost the saved position")
        if doubleClick {
            Assert(nativePosts.Length = 6, "restoration lost the double click or resumed the hold twice")
            Assert(nativePosts[6].position = (350 | (250 << 16)), "double-click hold resumed at the clicked position")
        } else {
            AssertClickOptions(["NA Pos U", "NA Pos D", "NA Pos U", "NA Pos U", "NA Pos D"])
            Assert(testClicks[5].position = "X350 Y250", "hold resumed before the cursor returned")
        }
        Assert(!testEvents.Length, "cursor restoration sent global input")
        for heldKey, held in testHeldKeys
            Assert(held, "restoration disturbed physical " heldKey)
    }
}

TestCursorSavedState() {
    global testHeldKeys, testCursor, testClicks, testMoves
    for explicitSave in [false, true] {
        testHeldKeys := Map("lbutton", true)
        testClicks := [], testMoves := [], testCursor := {x: 450, y: 300}
        steps := [Action("sleep", "ms", "30")]
        if explicitSave
            steps.Push(Action("savecursor"))
        steps.Push(Action("goto", "x", "20", "y", "20"), Action("mousepress", "key", "LButton"), Action("restorecursor"))
        StartBehaviorRun("saved-state", steps, "", "Game.exe")
        testCursor := {x: 500, y: 330}
        AwaitRuns()
        expected := explicitSave ? "X400 Y280" : "X350 Y250"
        Assert(testClicks.Length = 5 && testClicks[5].position = expected, "cursor save did not retain its position and held button together")
    }
}

TestCursorLockSnapshot() {
    global testHeldKeys
    steps := [Action("sleep", "ms", "30")]
    for node in CursorClickSteps()
        steps.Push(node)
    StartBehaviorRun("lock-state", steps, "", "Game.exe")
    testHeldKeys["lbutton"] := true
    AwaitRuns()
    AssertClickOptions(["NA Pos U", "NA Pos D", "NA Pos U", "NA Pos U", "NA Pos D"])
}

TestCursorChangedButtons() {
    global testHeldKeys, testClicks, testOnClick
    for initiallyHeld in [false, true] {
        testClicks := [], testHeldKeys := Map("lbutton", initiallyHeld)
        steps := CursorClickSteps()
        steps.InsertAt(3, Action("sleep", "ms", "30"))
        StartBehaviorRun("changed-state", steps, "", "Game.exe")
        testHeldKeys["lbutton"] := !initiallyHeld
        AwaitRuns()
        expected := initiallyHeld ? ["NA Pos D", "NA Pos U"] : ["NA Pos U", "NA Pos D", "NA Pos U", "NA Pos U"]
        AssertClickOptions(expected)
    }
    testClicks := [], testHeldKeys := Map("lbutton", true), testOnClick := ReleaseMouseDuringTap
    StartBehaviorRun("released-during-click", CursorClickSteps(), "", "Game.exe")
    AwaitRuns()
    AssertClickOptions(["NA Pos U", "NA Pos D", "NA Pos U", "NA Pos U"])
}

TestCursorConsumedButton() {
    global behaviorRuntime, testHeldKeys
    host := BindingHost()
    host.consumed["lbutton"] := true
    behaviorRuntime := BehaviorExecutor(host.PhysicalOwnsOutput.Bind(host))
    testHeldKeys := Map("lbutton", true)
    StartBehaviorRun("consumed-cursor", CursorClickSteps(), "", "Game.exe", "", "lbutton")
    AwaitRuns()
    AssertClickOptions(["NA Pos U", "NA Pos D", "NA Pos U", "NA Pos U"])
}

TestCursorUntouchedButton() {
    global testHeldKeys
    testHeldKeys := Map("lbutton", true)
    StartBehaviorRun("untouched-cursor", [Action("lock"), Action("goto", "x", "20", "y", "20"), Action("restorecursor")])
    AwaitRuns()
    Assert(!testClicks.Length && !testEvents.Length && testHeldKeys["lbutton"], "restoration replayed an uninterrupted hold")
}

TestCursorSharedHold() {
    global testOnClick
    testOnClick := TrackPickupClick
    HoldChordDown("other-button", "LButton", "")
    try {
        StartBehaviorRun("shared-cursor", CursorClickSteps(), "", "Game.exe")
        AwaitRuns()
        AssertClickOptions(["NA Pos U", "NA Pos D", "NA Pos U", "NA Pos D", "NA Pos U", "NA Pos D"])
        Assert(!testDragged && testClicks[6].position = "X350 Y250", "shared hold dragged the clicked UI or resumed at the wrong position")
        Assert(heldOutputCounts["lbutton"] = 1, "restoration changed another behavior's ownership")
    } finally HoldChordUp("other-button")
}

TestCursorCancellation() {
    global testHeldKeys, testClicks, testFocusActive, enabled
    for reason in ["cancel", "focus", "disable"] {
        testClicks := [], testHeldKeys := Map("lbutton", true), testFocusActive := true, enabled["profile"] := true
        steps := CursorClickSteps()
        steps.InsertAt(4, Action("sleep", "ms", "500"))
        StartBehaviorRun("cancel-cursor", steps, "", "Game.exe", "profile")
        deadline := A_TickCount + 2000
        while testClicks.Length < 4 {
            Assert(A_TickCount < deadline, "cursor click did not complete")
            Sleep 5
        }
        if reason = "focus"
            testFocusActive := false
        else if reason = "disable"
            enabled["profile"] := false
        else
            behaviorRuntime.Cancel("cancel-cursor")
        AwaitRuns()
        AssertClickOptions(["NA Pos U", "NA Pos D", "NA Pos U", "NA Pos U"])
        Assert(testBlockModes[testBlockModes.Length] = "MouseMoveOff", "cancellation left the cursor locked")
    }
    testFocusActive := true
}

TestCursorResumeCleanup(fail) {
    global testHeldKeys, testOnClick
    testHeldKeys := Map("lbutton", true)
    testOnClick := InterruptCursorResume.Bind(fail)
    steps := CursorClickSteps()
    steps.Push(Action("send", "text", "tail"))
    StartBehaviorRun("restore-cleanup", steps, "", "Game.exe")
    AwaitRuns()
    AssertClickOptions(["NA Pos U", "NA Pos D", "NA Pos U", "NA Pos U", "NA Pos D", "NA Pos U"])
    Assert(testBlockModes[testBlockModes.Length] = "MouseMoveOff", "restoration failure left the cursor locked")
    if fail
        Assert(runtimeActions.Length = 1 && runtimeActions[1].kind = "error" && !testEvents.Length, "failed restoration continued the sequence or hid its error")
    else
        Assert(!testHeldKeys["lbutton"] && testEvents.Length = 1, "restoration ignored a physical release")
}

InterruptCursorResume(fail, options) {
    global testHeldKeys
    recordedClick := testClicks[testClicks.Length]
    if options = "NA Pos D" && recordedClick.position = "X350 Y250" {
        if fail
            throw Error("simulated cursor restoration failure")
        testHeldKeys["lbutton"] := false
    }
}

TestNativeCursorRestore() {
    global testWindowId, testNativeTarget, testNativeMessages, testHeldKeys
    window := Gui("+ToolWindow -Caption")
    try {
        window.Show("Hide w400 h300")
        testWindowId := window.Hwnd, testNativeTarget := window.Hwnd
        testNativeMessages := [], testHeldKeys := Map("lbutton", true)
        OnMessage 0x201, RecordNativeClick
        OnMessage 0x202, RecordNativeClick
        StartBehaviorRun("native-cursor", CursorClickSteps(), "", "Test.exe")
        AwaitRuns()
        Sleep 20
        Assert(testNativeMessages.Length = 5, "native restoration lost a click transition or the resumed hold")
        final := testNativeMessages[5]
        Assert(final.message = 0x201 && final.position = (350 | (250 << 16)), "native hold resumed at the wrong client position")
        previousDelay := A_ControlDelay
        SetControlDelay -1
        try WindowClick("X350 Y250", window.Hwnd, "Left", "NA Pos U")
        finally SetControlDelay previousDelay
        Sleep 20
        Assert(testNativeMessages.Length = 6 && testNativeMessages[6].message = 0x202, "resumed hold could not be released")
    } finally {
        behaviorRuntime.Stop()
        OnMessage 0x201, RecordNativeClick, 0
        OnMessage 0x202, RecordNativeClick, 0
        testNativeTarget := 0
        window.Destroy()
    }
}
