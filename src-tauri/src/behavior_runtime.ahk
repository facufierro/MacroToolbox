; One executor owns all node trees. A tick advances ready branches without sleeping
; through another branch's delay, hold, or input wait.
class BehaviorExecutor {
    __New(physicalOwner := 0) {
        this.physicalOwner := physicalOwner
        this.runs := Map()
        this.latches := Map()
        this.nextId := 0
        this.ticking := false
        this.callback := this.Tick.Bind(this)
    }

    Start(owner, steps, modifiers := "", target := "", profile := "", chord := "", background := false, section := "", scriptOwner := "", cancelTriggers := 0, cancelOnOtherBehavior := false) {
        if chord = "" && BehaviorNeedsHotkey(steps)
            throw ValueError("This behavior requires a hotkey trigger.")
        if chord != "" && this.latches.Has(owner)
            return
        if this.runs.Has(owner) {
            if chord = ""
                return
            stoppingToggle := BehaviorHasToggle(this.runs[owner].task.node["steps"])
            if stoppingToggle
                this.latches[owner] := chord
            ; Toggle runs consume the next fresh press as Stop. Other runs restart
            ; from the prefix, replacing any previous wait or delay.
            this.Cancel(owner, "retriggered")
            if stoppingToggle
                return
        }
        this.nextId++
        MouseGetPos &x, &y
        execution := {id: this.nextId, owner: owner, target: target, profile: profile,
            startedAt: A_TickCount, activeStep: "setup",
            modifiers: modifiers, chord: chord, triggerHeld: true, x: x, y: y,
            cursorButtons: this.CursorButtons(), cursorClicks: Map(), cancelInputs: [], cancelCallback: 0, cancelOnOtherBehavior: cancelOnOtherBehavior,
            locked: false, cancelled: false, section: section, scriptOwner: scriptOwner, background: background && !BehaviorContextActive(target, profile), task: this.Task(Map("type", "sequence", "steps", steps)), failure: 0}
        this.runs[owner] := execution
        this.Trace(execution, "Run started; trigger=" chord "; " this.CursorState())
        if chord != ""
            this.latches[owner] := chord
        SetTimer this.callback, 5
        if cancelTriggers && cancelTriggers.Length {
            try {
                for cancelTrigger in cancelTriggers
                    execution.cancelInputs.Push(BehaviorInputWait(cancelTrigger, target, profile))
                execution.cancelCallback := this.CancelOnInput.Bind(this, execution)
                StartBehaviorInput(execution.cancelCallback)
            } catch Error as failure {
                execution.failure := failure
                this.Cancel(owner, "cancel trigger setup failed")
                ReportBehaviorError(profile, failure.Message)
                return execution
            }
        }
        this.CancelForNewBehavior(execution)
        this.Tick()
        return execution
    }

    CancelForNewBehavior(started) {
        owners := []
        for owner, execution in this.runs
            if execution.id < started.id && execution.cancelOnOtherBehavior
                owners.Push(owner)
        ; Cleanup can yield to a newer activation. This start must not cancel it.
        for owner in owners
            if this.runs.Has(owner) && this.runs[owner].id < started.id
                this.Cancel(owner, "another behavior started")
    }

    Task(node) {
        this.nextId++
        task := {node: node, id: "node:" this.nextId, started: false, done: false,
            children: [], index: 1, due: 0, input: 0, callback: 0, held: false, keys: [], requiresMouseRelease: false}
        if node["type"] = "sequence" || node["type"] = "parallel" {
            index := 1
            while index <= node["steps"].Length
                task.children.Push(this.NextTask(node["steps"], &index))
        } else if node["type"] = "press" && node.Get("doubleClick", false) && !node.Get("compatibility", false) {
            MousePressInput(node["key"])
            task.children := [this.Task(Map("type", "press", "key", node["key"])), this.Task(Map("type", "sleep", "ms", "30")), this.Task(Map("type", "press", "key", node["key"]))]
            task.children[1].requiresMouseRelease := true
            task.children[3].requiresMouseRelease := true
        }
        return task
    }

    NextTask(steps, &index) {
        task := this.Task(steps[index])
        index++
        if task.node["type"] = "waitfor" && !task.node.Has("key") {
            if index > steps.Length
                throw ValueError("Wait for requires a following action.")
            ; Pair before execution: the next action belongs to this wait.
            task.children.Push(this.NextTask(steps, &index))
        }
        return task
    }

    ReleaseTrigger(key) {
        released := []
        for owner, chord in this.latches
            for member in StrSplit(chord, " ")
                if member = key {
                    released.Push(owner)
                    break
                }
        for owner in released {
            this.latches.Delete(owner)
            if this.runs.Has(owner)
                this.runs[owner].triggerHeld := false
        }
    }

    ToggleModifiers(owner) {
        if !this.runs.Has(owner) || !BehaviorHasToggle(this.runs[owner].task.node["steps"])
            return ""
        return this.HeldModifiers(this.runs[owner].task)
    }

    OwnedModifiers() {
        modifiers := ""
        for owner, execution in this.runs
            modifiers .= this.HeldModifiers(execution.task)
        return modifiers
    }

    HeldModifiers(task) {
        modifiers := " "
        if task.held {
            for key in task.keys {
                if RegExMatch(key, "^(Ctrl|Shift|Alt)$")
                    key := "L" key
                if RegExMatch(key, "^(L|R)(Ctrl|Shift|Alt|Win)$")
                    modifiers .= key " "
                ; AltGr contributes a synthetic Left Ctrl alongside Right Alt.
                if key = "RAlt"
                    modifiers .= "LCtrl "
            }
        }
        for child in task.children
            modifiers .= this.HeldModifiers(child)
        return modifiers
    }

    Tick(*) {
        if this.ticking
            return
        this.ticking := true
        try {
            released := []
            for owner, chord in this.latches
                if !TriggerChordHeld(chord)
                    released.Push(owner)
            for owner in released
                this.latches.Delete(owner)
            owners := []
            for owner in this.runs
                owners.Push(owner)
            for owner in owners {
                if !this.runs.Has(owner)
                    continue
                execution := this.runs[owner]
                if !execution.background && !BehaviorContextActive(execution.target, execution.profile) {
                    this.Cancel(owner, "target lost focus")
                    continue
                }
                if execution.profile != "" && !enabled.Get(execution.profile, false) {
                    this.Cancel(owner, "profile disabled")
                    continue
                }
                if execution.chord != "" && !this.latches.Has(owner)
                    execution.triggerHeld := false
                try {
                    this.Advance(execution.task, execution)
                    if execution.task.done && !execution.cancelled
                        this.Cancel(owner, "completed")
                } catch Error as failure {
                    execution.failure := failure
                    if !execution.cancelled {
                        this.Cancel(owner, "step failed")
                        ReportBehaviorError(execution.profile, failure.Message)
                    }
                }
            }
            if !this.runs.Count && !this.latches.Count
                SetTimer this.callback, 0
        } finally {
            this.ticking := false
        }
    }

    Advance(task, execution, previousInput := 0) {
        global heldOutputCounts
        if task.done || execution.cancelled
            return
        node := task.node
        kind := node["type"]
        now := A_TickCount
        if execution.background && !BehaviorContextActive(execution.target, execution.profile)
            && (InStr("|press|hold|toggle|repeat|send|securesend|goto|restorecursor|lock|script|", "|" kind "|") || (kind = "waitfor" && node.Has("key")))
            throw TargetError("Input behavior requires the target app to be focused.")
        if !task.started && kind = "press" && node.Get("onRelease", false) && execution.triggerHeld
            return
        first := !task.started
        execution.activeStep := task.id " (" kind ")"
        if first {
            if task.requiresMouseRelease {
                keys := HoldKeyList(node["key"])
                button := keys[keys.Length]
                if PhysicalOwnsOutput(button, this.physicalOwner) || heldOutputCounts.Has(button)
                    throw Error("Normal double click requires the mouse button to be released. Enable Compatibility to click while it is held.")
            }
            task.started := true
            task.startedAt := A_TickCount
            this.Trace(execution, "Step " task.id " " kind " started" this.StepDetails(node))
        }
        if kind = "sequence" || (kind = "press" && task.children.Length) {
            while task.index <= task.children.Length {
                child := task.children[task.index]
                this.Advance(child, execution, task.index > 1 ? task.children[task.index - 1].input : previousInput)
                if execution.cancelled || !child.done
                    return
                task.index++
            }
        } else if kind = "parallel" {
            complete := true
            for child in task.children {
                this.Advance(child, execution, previousInput)
                if execution.cancelled
                    return
                complete := complete && child.done
            }
            if !complete
                return
        } else if kind = "sleep" {
            if first
                task.due := now + Integer(node["ms"])
            if now < task.due
                return
        } else if kind = "hold" || (kind = "press" && !node.Get("compatibility", false)) || kind = "toggle" {
            if first && (kind != "hold" || execution.triggerHeld) {
                task.held := true
                keys := RegExReplace(node["key"], "[,\s]+", " ")
                task.keys := HoldKeyList(keys)
                mouseOutput := kind = "toggle" ? {target: execution.target, flags: MousePressFlags(keys, execution.modifiers)} : 0
                HoldChordDown(task.id, keys, "", execution.modifiers, false, this.physicalOwner, mouseOutput)
                duration := Integer(node.Get("duration", "30"))
                task.due := now + duration
                if kind = "press" && duration <= 6 {
                    SpinHold(duration)
                    task.due := now
                }
            }
            if task.held
                AdvanceHeldOutputs(task.keys)
            if task.held && (kind = "toggle" || (kind = "hold" ? execution.triggerHeld : now < task.due))
                return
            this.Release(task)
        } else if kind = "repeat" {
            if !execution.triggerHeld {
                this.Release(task)
            } else {
                if task.children.Length {
                    this.Advance(task.children[1], execution)
                    if !task.children[1].done
                        return
                }
                if now >= task.due {
                    child := this.Task(Map("type", "press", "key", node["key"], "duration", node["hold"]))
                    task.children := [child]
                    task.due := now + Integer(node["interval"])
                    this.Advance(child, execution)
                }
                return
            }
        } else if kind = "waitfor" {
            condition := !node.Has("key") ? task.children[1].node : node
            inputCondition := node.Has("key") || condition["type"] = "press"
            if !inputCondition {
                this.Advance(task.children[1], execution, previousInput)
                if !task.children[1].done
                    return
            } else {
                if execution.background && !BehaviorContextActive(execution.target, execution.profile)
                    throw TargetError("Input behavior requires the target app to be focused.")
                if first {
                    task.input := BehaviorInputWait(condition["key"], execution.target, execution.profile,
                        condition.Get("onRelease", false), condition.Get("doubleClick", false), previousInput)
                    task.callback := task.input.OnInput.Bind(task.input)
                    StartBehaviorInput(task.callback)
                }
                if IsObject(task.input.error)
                    throw task.input.error
                if !task.input.completed
                    return
                this.Release(task)
            }
        } else if kind = "press" && node.Get("compatibility", false) {
            if first {
                task.mouse := MousePressInput(node["key"])
                task.keys := task.mouse.modifiers
                if task.keys.Length {
                    task.held := true
                    HoldChordDown(task.id, StrJoinKeys(task.keys), "", execution.modifiers, false, this.physicalOwner)
                    task.due := A_TickCount + 30
                }
            }
            if A_TickCount < task.due
                return
            if !task.mouse.clicked {
                task.mouse.clicked := true
                flags := MousePressFlags(node["key"], execution.modifiers)
                task.mouse.click := DoMousePress(task.mouse.button, execution.target, flags, node.Get("doubleClick", false), true)
                local click := task.mouse.click
                click.onTrace := this.Trace.Bind(this, execution)
                this.Trace(execution, "Mouse press prepared; method=Compatibility; hwnd=" click.target "; client=" click.position "; button=" click.keyName "; flags=" click.flags "; double=" click.doubleClick "; borrowedHold=" click.borrowed "; " this.CursorState())
                if task.mouse.click.borrowed
                    execution.cursorClicks[task.mouse.click.keyName] := task.mouse.click
            }
            if task.mouse.HasOwnProp("click") && !task.mouse.click.Advance()
                return
            this.Release(task)
        } else if kind = "send" {
            SendBehaviorText(node["text"])
        } else if kind = "securesend" {
            SendSecureText(node["credentialId"], execution.target, execution.profile)
        } else if kind = "state" {
            SendRuntimeAction(execution.profile, "state", node["stateId"], node.Get("action", "toggle"))
        } else if kind = "startoverlay" {
            for id in node["itemIds"] {
                SendRuntimeAction(execution.profile, "overlay", id, node.Get("restart", false) ? "restart" : "start")
                if execution.cancelled
                    return
            }
        } else if kind = "stopoverlay" {
            for id in node["itemIds"] {
                SendRuntimeAction(execution.profile, "overlay", id, "stop")
                if execution.cancelled
                    return
            }
        } else if kind = "bar" {
            SendRuntimeAction(execution.profile, "bar", node["itemId"], node["value"])
        } else if kind = "script" {
            SendRuntimeAction(execution.profile, "script", node["scriptId"], execution.section)
        } else if kind = "savecursor" {
            MouseGetPos &x, &y
            execution.x := x, execution.y := y
            execution.cursorButtons := this.CursorButtons()
            this.Trace(execution, "Cursor saved; " this.CursorState())
        } else if kind = "restorecursor" {
            this.RestoreCursor(execution)
        } else if kind = "lock" {
            if !execution.locked
                execution.cursorButtons := this.CursorButtons()
            execution.locked := true
            BlockInput "MouseMove"
            this.Trace(execution, "MouseMove lock requested; " this.CursorState())
        } else if kind = "goto" {
            GetGameViewport(&x, &y, &width, &height, execution.target)
            SendMode "Event"
            SetMouseDelay -1
            requestedX := x + ResolveCoord(node["x"], width), requestedY := y + ResolveCoord(node["y"], height)
            this.Trace(execution, "Move requested; coordinate=" node["x"] "," node["y"] "; viewport=" x "," y "," width "," height "; screen=" requestedX "," requestedY "; locked=" execution.locked "; " this.CursorState())
            MouseMove requestedX, requestedY, 0
            MouseGetPos &actualX, &actualY
            this.Trace(execution, "Move returned; requested=" requestedX "," requestedY "; actual=" actualX "," actualY "; " this.CursorState(), actualX != Round(requestedX) || actualY != Round(requestedY) ? "warn" : "info")
        } else if kind = "resolution" {
            SendBehaviorCommand(kind, execution.target, "&width=" node["width"] "&height=" node["height"])
        } else if kind = "borderless" || kind = "fit" || kind = "stretch" || kind = "killprocess" {
            SendBehaviorCommand(kind, execution.target)
        } else {
            throw ValueError("Unsupported behavior node: " kind)
        }
        task.done := true
        this.Trace(execution, "Step " task.id " " kind " completed; elapsed=" (A_TickCount - task.startedAt) "ms")
    }

    CancelOnInput(execution, wParam, lParam, msg, hwnd) {
        if execution.cancelled
            return
        for input in execution.cancelInputs {
            input.OnInput(wParam, lParam, msg, hwnd)
            if execution.cancelled
                return
            if IsObject(input.error) {
                execution.failure := input.error
                this.Cancel(execution.owner, "cancel input failed")
                ReportBehaviorError(execution.profile, input.error.Message)
                return
            } else if input.completed {
                this.Cancel(execution.owner, "cancel trigger pressed")
                return
            }
        }
        ; Leave WM_INPUT unhandled for Windows' raw input cleanup.
    }

    CursorButtons() {
        global heldOutputCounts
        buttons := Map()
        for key in ["lbutton", "rbutton", "mbutton", "xbutton1", "xbutton2"]
            if PhysicalOwnsOutput(key, this.physicalOwner) || heldOutputCounts.Has(key)
                buttons[key] := true
        return buttons
    }

    RestoreCursor(execution) {
        global heldOutputCounts
        clicks := execution.cursorClicks
        execution.cursorClicks := Map()
        ; Window clicks can interrupt a real hold. Resume it only after returning,
        ; so the intervening movement cannot drag the UI clicked by the macro.
        for key, mousePress in clicks
            if execution.cursorButtons.Has(key) && heldOutputCounts.Has(key)
                mousePress.Send(false)
        SendMode "Event"
        SetMouseDelay -1
        this.Trace(execution, "Restore cursor requested=" execution.x "," execution.y "; " this.CursorState())
        MouseMove execution.x, execution.y, 0
        MouseGetPos &actualX, &actualY
        this.Trace(execution, "Restore cursor returned; actual=" actualX "," actualY, actualX != execution.x || actualY != execution.y ? "warn" : "info")
        for key, mousePress in clicks
            if execution.cursorButtons.Has(key) && !execution.cancelled
                mousePress.ResumeHold(this.physicalOwner, MousePressFlags(""))
        this.Unlock(execution)
    }

    Release(task) {
        global heldOutputCounts, syntheticDown, copilotCtrlHeld
        failure := 0
        if task.HasOwnProp("mouse") && task.mouse.HasOwnProp("click") {
            try task.mouse.click.Close()
            catch Error as caught
                failure := caught
        }
        if task.held {
            task.held := false
            try HoldChordUp(task.id, this.physicalOwner)
            catch Error as caught {
                failure := caught
                ; A delivery failure must not abandon the other branches. Ownership
                ; has already been decremented; retry only this task's unshared ups.
                for key in task.keys
                    if !heldOutputCounts.Has(key) && syntheticDown.Has(key) && !PhysicalOwnsOutput(key, this.physicalOwner) && !(key = "RCtrl" && copilotCtrlHeld)
                        try SendOwnedKeyUp(key, true)
            }
        }
        if IsObject(task.callback) {
            try StopBehaviorInput(task.callback)
            catch Error as caught
                failure := caught
            task.callback := 0
        }
        for child in task.children
            try this.Release(child)
            catch Error as caught
                failure := caught
        if IsObject(failure)
            throw failure
    }

    Unlock(execution) {
        if !execution.locked
            return
        execution.locked := false
        for other in this.runs
            if this.runs[other].locked
                return
        BlockInput "MouseMoveOff"
        this.Trace(execution, "MouseMove lock released; " this.CursorState())
    }

    Cancel(owner, reason := "cancelled") {
        if !this.runs.Has(owner)
            return
        execution := this.runs[owner]
        execution.cancelled := true
        ; Input delivery can yield to a new activation of the same hotkey. Detach
        ; this run before cleanup so it cannot delete or resume that replacement.
        this.runs.Delete(owner)
        try {
            if IsObject(execution.cancelCallback) {
                try StopBehaviorInput(execution.cancelCallback)
                finally execution.cancelCallback := 0
            }
        } catch Error as failure
            ReportBehaviorError(execution.profile, failure.Message)
        try this.Release(execution.task)
        catch Error as failure
            ReportBehaviorError(execution.profile, failure.Message)
        finally {
            this.Unlock(execution)
            message := "Run ended; reason=" reason "; lastStep=" execution.activeStep "; elapsed=" (A_TickCount - execution.startedAt) "ms"
            if IsObject(execution.failure)
                message .= "; error=" execution.failure.Message "; line=" execution.failure.Line
            this.Trace(execution, message, IsObject(execution.failure) ? "error" : "info")
        }
    }

    Trace(execution, message, level := "info") {
        ; Diagnostic failures must not interrupt input cleanup or behavior execution.
        try RuntimeDiagnostics.Add(level, "Runtime", "run=" execution.id "; owner=" execution.owner "; profile=" execution.profile "; target=" execution.target "; section=" execution.section "; " message)
    }

    StepDetails(node) {
        ; Never serialize a node: Send text and Secure send payloads are private.
        details := ""
        for key in ["key", "duration", "ms", "interval", "hold", "onRelease", "doubleClick", "compatibility", "credentialId"]
            if node.Has(key)
                details .= "; " key "=" node[key]
        return details
    }

    CursorState() {
        MouseGetPos &x, &y
        try active := WinGetProcessName("A")
        catch Error
            active := "<none>"
        state := "cursor=" x "," y "; foregroundExe=" active "; buttons="
        for key in ["LButton", "RButton", "MButton", "XButton1", "XButton2"]
            state .= key ":P" GetKeyState(key, "P") "/L" GetKeyState(key) " "
        clip := Buffer(16, 0)
        if DllCall("GetClipCursor", "Ptr", clip)
            state .= "; clip=" NumGet(clip, 0, "Int") "," NumGet(clip, 4, "Int") "," NumGet(clip, 8, "Int") "," NumGet(clip, 12, "Int")
        return state
    }

    CancelProfile(profile) {
        owners := []
        for owner, execution in this.runs
            if execution.profile = profile || execution.scriptOwner = profile
                owners.Push(owner)
        for owner in owners
                this.Cancel(owner, "profile disabled or reconfigured")
    }

    CancelSection(profile, section) {
        owners := []
        for owner, execution in this.runs
            if (execution.profile = profile && execution.section = section) || (section = "scripts" && execution.scriptOwner = profile)
                owners.Push(owner)
        for owner in owners
                this.Cancel(owner, "section reconfigured")
    }

    Stop(*) {
        SetTimer this.callback, 0
        owners := []
        for owner in this.runs
            owners.Push(owner)
        failure := 0
        for owner in owners
            try this.Cancel(owner, "input host stopping")
            catch Error as caught
                failure := caught
        this.latches.Clear()
        if IsObject(failure)
            throw failure
    }
}

BehaviorNeedsHotkey(steps) {
    for node in steps {
        kind := node["type"]
        if kind = "toggle" || kind = "securesend" || (kind = "press" && node.Get("onRelease", false))
            return true
        if (kind = "sequence" || kind = "parallel") && BehaviorNeedsHotkey(node["steps"])
            return true
    }
    return false
}

BehaviorHasToggle(steps) {
    for node in steps {
        kind := node["type"]
        if kind = "toggle" || ((kind = "sequence" || kind = "parallel") && BehaviorHasToggle(node["steps"]))
            return true
    }
    return false
}

StartBehaviorRun(owner, steps, modifiers := "", target := "", profile := "", chord := "", background := false, section := "", scriptOwner := "", cancelTriggers := 0, cancelOnOtherBehavior := false) {
    global behaviorRuntime
    return behaviorRuntime.Start(owner, steps, modifiers, target, profile, chord, background, section, scriptOwner, cancelTriggers, cancelOnOtherBehavior)
}

SendRuntimeAction(profile, kind, id, value := "") {
    SendOverlayCommand("runtime?profile=" UriEncode(profile) "&kind=" UriEncode(kind) "&id=" UriEncode(id) "&value=" UriEncode(value))
}

ReportBehaviorError(profile, message) {
    try SendRuntimeAction(profile, "error", "", message)
    catch Error as failure
        OutputDebug "MacroToolbox: " message " (" failure.Message ")"
}

MousePressInput(keys) {
    parts := StrSplit(RegExReplace(Trim(keys), "\s+", " "), " ")
    button := parts.Pop()
    modifiers := parts.Length ? HoldKeyList(StrJoinKeys(parts)) : []
    if !RegExMatch(button, "i)^(?:[LRM]Button|XButton[12]|m[12])$")
        throw ValueError("mousepress requires a mouse button.")
    for name in modifiers
        if !RegExMatch(name, "i)^(?:L|R)?(?:Ctrl|Shift|Alt|Win)$")
            throw ValueError("mousepress requires modifiers followed by one mouse button.")
    return {button: button, modifiers: modifiers, clicked: false}
}

MousePressFlags(keys, triggerModifiers := "") {
    symbols := KeyModifierSymbols(keys)
    flags := InStr(symbols, "^") || (!InStr(triggerModifiers, "^") && GetKeyState("Ctrl")) ? 8 : 0
    if InStr(symbols, "+") || (!InStr(triggerModifiers, "+") && GetKeyState("Shift"))
        flags |= 4
    return flags
}

StrJoinKeys(parts) {
    result := ""
    for part in parts
        result .= (result = "" ? "" : " ") part
    return result
}

class RuntimeDiagnostics {
    static pending := []
    static inFlight := ""
    static request := 0

    static Add(level, source, message) {
        time := Buffer(8)
        DllCall("GetSystemTimeAsFileTime", "Ptr", time)
        at := (NumGet(time, 0, "Int64") - 116444736000000000) // 10000
        this.pending.Push('{"at":' at ',"level":' JsonString(level) ',"source":' JsonString(source) ',"message":' JsonString(message) '}')
    }

    static Flush(wait := false, *) {
        ; Batch outside the behavior tick. Asynchronous transport adds no per-step HTTP wait.
        try {
            if IsObject(this.request) {
                if !this.request.WaitForResponse(wait ? 1 : 0)
                    return
                if this.request.Status < 400
                    this.inFlight := ""
                this.request := 0
            }
            if this.inFlight = "" {
                if !this.pending.Length
                    return
                this.inFlight := "[" StrJoinDiagnosticEntries(this.pending) "]"
                this.pending := []
            }
            request := ComObject("WinHttp.WinHttpRequest.5.1")
            request.Open("POST", "http://127.0.0.1:17823/diagnostics", !wait)
            request.SetTimeouts(500, 500, 500, 500)
            request.SetRequestHeader("Content-Type", "application/json; charset=utf-8")
            request.Send(this.inFlight)
            if wait {
                if request.Status < 400
                    this.inFlight := ""
            } else
                this.request := request
        } catch Error {
            this.request := 0
            OutputDebug "MacroToolbox: diagnostic transport unavailable; retaining pending trace."
        }
    }
}

StrJoinDiagnosticEntries(entries) {
    result := ""
    for entry in entries
        result .= (result = "" ? "" : ",") entry
    return result
}

