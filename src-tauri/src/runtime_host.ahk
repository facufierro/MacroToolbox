; Bindings are data. Updating a profile keeps the input hooks and unrelated runs alive.
class BindingHost {
    __New() {
        this.source := ""
        this.rejected := ""
        this.pendingRevision := ""
        this.profiles := []
        this.bindings := Map()
        this.criteria := Map()
        this.releases := Map()
        this.consumed := Map()
        this.triggerGuards := Map()
        this.targets := Map()
        this.focus := ""
        this.visible := false
    }

    Reload() {
        source := FileRead(A_ScriptDir "\runtime.json", "UTF-8")
        if source = this.source || source = this.rejected
            return
        try {
            document := JsonReader.Parse(source)
            this.Apply(document["profiles"])
            this.source := source
            this.rejected := ""
            this.pendingRevision := document["revision"]
        } catch Error as failure {
            this.rejected := source
            ReportBehaviorError("", failure.Message)
            throw failure
        }
    }

    Apply(profiles) {
        global enabled, behaviorRuntime
        bindings := Map()
        for profile in profiles {
            if profile["armed"]
                for event, steps in profile.Get("events", Map())
                    this.ValidatePlan(steps)
            for binding in profile["bindings"] {
                if profile["armed"] {
                    this.ValidatePlan(binding["steps"])
                    for cancelTrigger in binding.Get("cancelTriggers", []) {
                        for cancelKey in HoldKeyList(RegExReplace(cancelTrigger, "[,\s]+", " "))
                            if !GetKeyVK(cancelKey) && !GetKeySC(cancelKey)
                                throw ValueError("Unknown cancel trigger key: " cancelKey)
                    }
                }
                key := binding["key"]
                if !bindings.Has(key)
                    bindings[key] := []
                binding["profile"] := profile
                this.GuardTrigger(binding["chord"])
                insertion := bindings[key].Length + 1
                for index, previous in bindings[key] {
                    previousSpecific := previous["profile"]["target"] != "*"
                    specific := profile["target"] != "*"
                    if (specific && !previousSpecific) || (specific = previousSpecific && binding["specificity"] > previous["specificity"]) {
                        insertion := index
                        break
                    }
                }
                bindings[key].InsertAt(insertion, binding)
                if !this.criteria.Has(key) {
                    criterion := this.Allowed.Bind(this, key)
                    HotIf criterion
                    try Hotkey key, this.Activate.Bind(this, key), "Off I0"
                    finally HotIf()
                    this.criteria[key] := criterion
                }
                for released in StrSplit(binding["chord"], " ") {
                    if released = "" || this.releases.Has(released)
                        continue
                    HotIf()
                    Hotkey "~*" released " up", this.Release.Bind(this, released), "On I0"
                    this.releases[released] := true
                }
            }
        }
        for old in this.profiles {
            replacement := 0
            for profile in profiles
                if profile["id"] = old["id"]
                    replacement := profile
            if !IsObject(replacement)
                behaviorRuntime.CancelProfile(old["id"])
            else if replacement["revision"] != old["revision"] {
                if replacement.Has("sectionRevisions") && old.Has("sectionRevisions") {
                    for section, revision in old["sectionRevisions"]
                        if replacement["sectionRevisions"].Get(section, "") != revision
                            behaviorRuntime.CancelSection(old["id"], section)
                } else
                    behaviorRuntime.CancelProfile(old["id"])
            }
            if !IsObject(replacement) && enabled.Has(old["id"])
                enabled.Delete(old["id"])
        }
        previous := Map()
        for old in this.profiles
            previous[old["id"]] := old
        for profile in profiles {
            id := profile["id"]
            if profile.Has("enabled") {
                enabled[id] := profile["armed"] && profile["enabled"]
                if !enabled[id]
                    behaviorRuntime.CancelProfile(id)
            } else if !previous.Has(id) || previous[id]["armed"] != profile["armed"]
                enabled[id] := profile["armed"]
        }
        this.profiles := profiles
        this.bindings := bindings
        for key, criterion in this.criteria {
            HotIf criterion
            try Hotkey key, bindings.Has(key) ? "On" : "Off"
            finally HotIf()
        }
    }

    ValidatePlan(steps) {
        for index, node in steps {
            kind := node["type"]
            if kind = "waitfor" && !node.Has("key") && index = steps.Length
                throw ValueError("Wait for requires a following action.")
            if kind = "parallel" || kind = "sequence"
                this.ValidatePlan(node["steps"])
            if kind = "press" || kind = "hold" || kind = "toggle" || kind = "repeat" || (kind = "waitfor" && node.Has("key")) {
                for key in HoldKeyList(RegExReplace(node["key"], "[,\s]+", " "))
                    if !GetKeyVK(key) && !GetKeySC(key)
                        throw ValueError("Unknown input key: " key)
            }
        }
    }

    Matches(binding) {
        global enabled, behaviorRuntime
        profile := binding["profile"]
        return profile["armed"] && profile.Get("folderEnabled", true) && (binding["toggle"] || enabled.Get(profile["id"], false))
            && (profile["target"] = "*" || WinActive("ahk_exe " profile["target"]))
            && (binding["prerequisites"] = "" || TriggerChordHeld(binding["prerequisites"]))
            && (binding["toggle"] ? TriggerModifiersAllowed(binding["trigger"], true, behaviorRuntime.OwnedModifiers())
                : !binding["exact"] || TriggerModifiersAllowed(binding["trigger"], false,
                    behaviorRuntime.ToggleModifiers(profile["id"] ":" binding["trigger"])))
    }

    Find(key) {
        if !this.bindings.Has(key)
            return 0
        first := 0
        for binding in this.bindings[key] {
            if !this.Matches(binding)
                continue
            ; A profile's own behavior must not swallow the shortcut that disables it.
            if binding["toggle"]
                return binding
            if !IsObject(first)
                first := binding
        }
        ; A non-wildcard behavior can win AHK's native dispatch over a wildcard
        ; profile control. Resolve that collision before executing either action.
        if IsObject(first)
            for otherKey, bindings in this.bindings
                for binding in bindings
                    if binding["toggle"] && binding["chord"] = first["chord"] && this.Matches(binding)
                        return binding
        return first
    }

    ToggleProfiles(selected) {
        global enabled, behaviorRuntime
        if selected.Has("subfolder") {
            value := !selected["profile"]["subfolderEnabled"]
            ; Release the group's input locally before persisting its switch state.
            if !value
                for profile in this.profiles
                    if profile.Get("folder", "") = selected["folder"] && profile.Get("subfolder", "") = selected["subfolder"] {
                        enabled[profile["id"]] := false
                        behaviorRuntime.CancelProfile(profile["id"])
                    }
            try SendRuntimeAction(selected["folder"], "subfolder", selected["subfolder"], value ? "1" : "0")
            catch Error as failure
                ReportBehaviorError("", failure.Message)
            finally {
                this.source := ""
                this.Reload()
            }
            return
        }
        profiles := Map(selected["profile"]["id"], true)
        ; Equivalent shortcuts can have different native names (modifier order or
        ; generic/sided Ctrl). Match the held shortcut, not just its native key string.
        for key, bindings in this.bindings
            for binding in bindings
                if binding["toggle"] && !binding.Has("subfolder") && binding["chord"] = selected["chord"] && this.Matches(binding)
                    profiles[binding["profile"]["id"]] := true
        value := true
        for id in profiles
            if enabled.Get(id, false)
                value := false
        ; Stopping input cannot depend on a successful HTTP round trip. Disable
        ; the entire group before publishing the change, including active holds.
        if !value {
            for id in profiles
                enabled[id] := false
            for id in profiles
                behaviorRuntime.CancelProfile(id)
        }
        try {
            SendProfilesEnabled(profiles, value)
            if value
                for id in profiles
                    enabled[id] := true
        } catch Error as failure
            ReportBehaviorError("", failure.Message)
    }

    Allowed(key, *) {
        return IsObject(this.Find(key))
    }

    TriggerKey(chord) {
        keys := StrSplit(chord, " ")
        return keys[keys.Length]
    }

    GuardTrigger(chord) {
        key := this.TriggerKey(chord)
        if this.triggerGuards.Has(key)
            return
        ; Register before plain-key variants. A consumed physical press stays consumed
        ; across modifier changes, completed/cancelled behaviors, and profile reloads.
        criterion := this.Consumes.Bind(this, key)
        HotIf criterion
        try {
            Hotkey "$*" key, this.IgnoreRepeat.Bind(this), "On I0"
            Hotkey "$*" key " up", this.Release.Bind(this, key), "On I0"
        } finally HotIf()
        this.triggerGuards[key] := criterion
    }

    Consumes(key, *) {
        return this.consumed.Has(key)
    }

    PhysicalOwnsOutput(key) {
        if !GetKeyState(key, "P")
            return false
        ; A consumed trigger never reached the app. Its physical hold cannot own
        ; an output sent by a behavior, even when named E instead of SC012.
        scan := GetKeySC(key)
        for trigger in this.consumed
            if key = trigger || (scan && scan = GetKeySC(trigger))
                return false
        return true
    }

    IgnoreRepeat(*) {
    }

    ResetInput() {
        this.consumed.Clear()
    }

    Activate(key, *) {
        binding := this.Find(key)
        if !IsObject(binding)
            return
        trigger := this.TriggerKey(binding["chord"])
        if this.consumed.Has(trigger)
            return
        this.consumed[trigger] := true
        profile := binding["profile"]
        if binding["toggle"] {
            this.ToggleProfiles(binding)
            return
        }
        StartBehaviorRun(profile["id"] ":" binding["trigger"], binding["steps"], binding["modifiers"],
            profile["target"], profile["id"], binding["chord"], false, binding.Get("section", "hotkeys"), "", binding.Get("cancelTriggers", []), binding.Get("cancelOnOtherBehavior", false))
    }

    Release(key, *) {
        global behaviorRuntime
        if GetKeyState(key, "P")
            return
        if this.consumed.Has(key)
            this.consumed.Delete(key)
        behaviorRuntime.ReleaseTrigger(key)
    }

    Tick(*) {
        global enabled
        try {
            this.Reload()
            if this.pendingRevision != "" {
                SendOverlayCommand("activated?revision=" UriEncode(this.pendingRevision))
                this.pendingRevision := ""
            }
            observed := Map()
            for profile in this.profiles {
                target := profile["target"]
                if target = "*" || observed.Has(target)
                    continue
                observed[target] := true
                current := {running: ProcessExist(target) != 0, ready: WinExist("ahk_exe " target) != 0, focused: WinActive("ahk_exe " target) != 0}
                if this.targets.Has(target) {
                    previous := this.targets[target]
                    if previous.focused && !current.focused
                        SendOverlayCommand("target-blur?exe=" UriEncode(target))
                    for event, occurred in Map("app_started", !previous.running && current.running,
                        "app_stopped", previous.running && !current.running, "window_ready", !previous.ready && current.ready,
                        "focus_gained", !previous.focused && current.focused, "focus_lost", previous.focused && !current.focused) {
                        if occurred
                            this.Dispatch(target, event)
                    }
                }
                this.targets[target] := current
            }
            focus := ""
            for profile in this.profiles {
                if profile["overlay"] && profile["armed"] && enabled.Get(profile["id"], false)
                    && (profile["target"] = "*" || WinActive("ahk_exe " profile["target"])) {
                    focus := profile["id"]
                    break
                }
            }
            if focus != this.focus {
                SendOverlayCommand("focus?id=" UriEncode(focus))
                this.focus := focus
            }
            visible := focus != ""
            if visible != this.visible {
                SendOverlayCommand(visible ? "show" : "hide")
                this.visible := visible
            }
            for request in JsonReader.Parse(SendOverlayCommand("commands"))
                for profile in this.profiles
                    if profile["id"] = request["profile"] && profile["armed"] && enabled.Get(profile["id"], false) && profile.Get("sections", Map()).Get(request.Get("section", "scripts"), true)
                        StartBehaviorRun(request["owner"], request["steps"], "", request["target"], request["profile"], "", false, request.Get("section", "scripts"), request.Get("script_owner", ""))
        } catch Error as failure {
            OutputDebug "MacroToolbox runtime: " failure.Message
        }
    }

    Dispatch(target, event) {
        global enabled
        for profile in this.profiles {
            if profile["target"] != target || !profile["armed"] || !enabled.Get(profile["id"], false)
                continue
            if event = "app_started"
                for script in profile["launchScripts"]
                    SendRuntimeAction(profile["id"], "script", script)
            if profile["events"].Has(event)
                StartBehaviorRun(profile["id"] ":event:" event ":" A_TickCount, profile["events"][event], "", target, profile["id"], "", true, "events")
        }
    }
}

SendProfilesEnabled(profiles, value) {
    command := "profiles-enabled?value=" (value ? "1" : "0")
    for id in profiles
        command .= "&profile=" UriEncode(id)
    SendOverlayCommand(command)
}
