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

    Start(owner, steps, modifiers := "", target := "", profile := "", chord := "", background := false, section := "", scriptOwner := "") {
        if chord != "" && this.latches.Has(owner)
            return
        if this.runs.Has(owner) {
            if chord = ""
                return
            ; A fresh physical press owns a new activation. A previous wait or delay
            ; must not consume it; cancel that run before sending the new prefix.
            this.Cancel(owner)
        }
        this.nextId++
        MouseGetPos &x, &y
        execution := {id: this.nextId, owner: owner, target: target, profile: profile,
            modifiers: modifiers, chord: chord, triggerHeld: true, x: x, y: y,
            locked: false, cancelled: false, section: section, scriptOwner: scriptOwner, background: background && !BehaviorContextActive(target, profile), task: this.Task(Map("type", "sequence", "steps", steps)), failure: 0}
        this.runs[owner] := execution
        if chord != ""
            this.latches[owner] := chord
        SetTimer this.callback, 5
        this.Tick()
        return execution
    }

    Task(node) {
        this.nextId++
        return {node: node, id: "node:" this.nextId, started: false, done: false,
            children: [], index: 1, due: 0, input: 0, callback: 0, held: false, keys: []}
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
                if (!execution.background && !BehaviorContextActive(execution.target, execution.profile)) || (execution.profile != "" && !enabled.Get(execution.profile, false)) {
                    this.Cancel(owner)
                    continue
                }
                if execution.chord != "" && !this.latches.Has(owner)
                    execution.triggerHeld := false
                try {
                    this.Advance(execution.task, execution, A_TickCount)
                    if execution.task.done && !execution.cancelled
                        this.Cancel(owner)
                } catch Error as failure {
                    execution.failure := failure
                    if !execution.cancelled {
                        this.Cancel(owner)
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

    Advance(task, execution, now) {
        if task.done || execution.cancelled
            return
        node := task.node
        kind := node["type"]
        if execution.background && !BehaviorContextActive(execution.target, execution.profile)
            && InStr("|press|hold|repeat|mousepress|send|waitfor|goto|restorecursor|lock|script|", "|" kind "|")
            throw TargetError("Input behavior requires the target app to be focused.")
        first := !task.started
        if first {
            task.started := true
            if kind = "sequence" || kind = "parallel"
                for child in node["steps"]
                    task.children.Push(this.Task(child))
        }
        if kind = "sequence" {
            while task.index <= task.children.Length {
                child := task.children[task.index]
                this.Advance(child, execution, now)
                if execution.cancelled || !child.done
                    return
                task.index++
            }
        } else if kind = "parallel" {
            complete := true
            for child in task.children {
                this.Advance(child, execution, now)
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
        } else if kind = "hold" || kind = "press" {
            if first && (kind = "press" || execution.triggerHeld) {
                task.held := true
                keys := RegExReplace(node["key"], "[,\s]+", " ")
                task.keys := HoldKeyList(keys)
                HoldChordDown(task.id, keys, "", execution.modifiers, false, this.physicalOwner)
                duration := Integer(node.Get("duration", "30"))
                task.due := now + duration
                if kind = "press" && duration <= 6 {
                    SpinHold(duration)
                    task.due := now
                }
            }
            if task.held && (kind = "hold" ? execution.triggerHeld : now < task.due)
                return
            this.Release(task)
        } else if kind = "repeat" {
            if !execution.triggerHeld {
                this.Release(task)
            } else {
                if task.children.Length {
                    this.Advance(task.children[1], execution, now)
                    if !task.children[1].done
                        return
                }
                if now >= task.due {
                    child := this.Task(Map("type", "press", "key", node["key"], "duration", node["hold"]))
                    task.children := [child]
                    task.due := now + Integer(node["interval"])
                    this.Advance(child, execution, now)
                }
                return
            }
        } else if kind = "waitfor" {
            if first {
                task.input := BehaviorInputWait(node["key"], execution.target, execution.profile)
                task.callback := task.input.OnInput.Bind(task.input)
                StartBehaviorInput(task.callback)
            }
            if IsObject(task.input.error)
                throw task.input.error
            if !task.input.completed
                return
            this.Release(task)
        } else if kind = "mousepress" {
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
                DoMousePress(task.mouse.button, execution.target, MousePressFlags(node["key"], execution.modifiers))
                if task.held {
                    ; Window clicks are queued. Keep their modifiers owned while the target
                    ; consumes the click, without blocking other branches or cancellation.
                    task.due := A_TickCount + 30
                    return
                }
            }
            this.Release(task)
        } else if kind = "send" {
            SendBehaviorText(node["text"])
        } else if kind = "state" {
            SendRuntimeAction(execution.profile, "state", node["stateId"], node.Get("action", "toggle"))
        } else if kind = "startoverlay" {
            SendRuntimeAction(execution.profile, "overlay", node["itemId"], node.Get("restart", false) ? "restart" : "start")
        } else if kind = "stopoverlay" {
            SendRuntimeAction(execution.profile, "overlay", node["itemId"], "stop")
        } else if kind = "bar" {
            SendRuntimeAction(execution.profile, "bar", node["itemId"], node["value"])
        } else if kind = "script" {
            SendRuntimeAction(execution.profile, "script", node["scriptId"], execution.section)
        } else if kind = "savecursor" {
            MouseGetPos &x, &y
            execution.x := x, execution.y := y
        } else if kind = "restorecursor" {
            this.Unlock(execution)
            SendMode "Event"
            SetMouseDelay -1
            MouseMove execution.x, execution.y, 0
        } else if kind = "lock" {
            execution.locked := true
            BlockInput "MouseMove"
        } else if kind = "goto" {
            GetGameViewport(&x, &y, &width, &height, execution.target)
            SendMode "Event"
            SetMouseDelay -1
            MouseMove x + ResolveCoord(node["x"], width), y + ResolveCoord(node["y"], height), 0
        } else if kind = "resolution" {
            SendBehaviorCommand(kind, execution.target, "&width=" node["width"] "&height=" node["height"])
        } else if kind = "borderless" || kind = "fit" || kind = "stretch" || kind = "killprocess" {
            SendBehaviorCommand(kind, execution.target)
        } else {
            throw ValueError("Unsupported behavior node: " kind)
        }
        task.done := true
    }

    Release(task) {
        global heldOutputCounts, syntheticDown, copilotCtrlHeld
        failure := 0
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
    }

    Cancel(owner) {
        if !this.runs.Has(owner)
            return
        execution := this.runs[owner]
        execution.cancelled := true
        ; Input delivery can yield to a new activation of the same hotkey. Detach
        ; this run before cleanup so it cannot delete or resume that replacement.
        this.runs.Delete(owner)
        try this.Release(execution.task)
        catch Error as failure
            ReportBehaviorError(execution.profile, failure.Message)
        finally {
            this.Unlock(execution)
        }
    }

    CancelProfile(profile) {
        owners := []
        for owner, execution in this.runs
            if execution.profile = profile || execution.scriptOwner = profile
                owners.Push(owner)
        for owner in owners
            this.Cancel(owner)
    }

    CancelSection(profile, section) {
        owners := []
        for owner, execution in this.runs
            if (execution.profile = profile && execution.section = section) || (section = "scripts" && execution.scriptOwner = profile)
                owners.Push(owner)
        for owner in owners
            this.Cancel(owner)
    }

    Stop(*) {
        owners := []
        for owner in this.runs
            owners.Push(owner)
        for owner in owners
            this.Cancel(owner)
        this.latches.Clear()
        SetTimer this.callback, 0
    }
}

StartBehaviorRun(owner, steps, modifiers := "", target := "", profile := "", chord := "", background := false, section := "", scriptOwner := "") {
    global behaviorRuntime
    return behaviorRuntime.Start(owner, steps, modifiers, target, profile, chord, background, section, scriptOwner)
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

