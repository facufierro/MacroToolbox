; Loaded automatically for managed AutoHotkey scripts.
class MacroToolbox {
    static Operation(kind, id := "", value := "") {
        request := ComObject("WinHttp.WinHttpRequest.5.1")
        request.Open("POST", EnvGet("MACROTOOLBOX_API_URL") "/runtime", false)
        request.SetRequestHeader("Content-Type", "application/json; charset=utf-8")
        request.SetTimeouts(1000, 1000, 1000, 5000)
        body := '{"profile":' this.Quote(EnvGet("MACROTOOLBOX_PROFILE_ID")) ',"kind":' this.Quote(kind)
            . ',"section":' this.Quote(EnvGet("MACROTOOLBOX_SECTION")) ',"script_owner":' this.Quote(EnvGet("MACROTOOLBOX_SCRIPT_OWNER"))
            . ',"id":' this.Quote(id) ',"value":' this.Quote(value) '}'
        request.Send(body)
        if request.Status >= 400
            throw Error(request.ResponseText)
        return request.ResponseText
    }
    static SetState(id) => this.Operation("state", id, "set")
    static ClearState(id) => this.Operation("state", id, "clear")
    static ToggleState(id) => this.Operation("state", id, "toggle")
    static StartOverlay(id, restart := false) => this.Operation("overlay", id, restart ? "restart" : "start")
    static StopOverlay(id) => this.Operation("overlay", id, "stop")
    static SetBar(id, value) => this.Operation("bar", id, value)
    static RunBehavior(json) => this.Operation("behavior", "", json)
    static RunScript(id) => this.Operation("script", id)
    static Snapshot() {
        request := ComObject("WinHttp.WinHttpRequest.5.1")
        request.Open("GET", EnvGet("MACROTOOLBOX_API_URL") "/runtime-state?profile=" EnvGet("MACROTOOLBOX_PROFILE_ID"), false)
        request.Send()
        if request.Status >= 400
            throw Error(request.ResponseText)
        return MacroToolboxJsonReader.Parse(request.ResponseText)
    }
    static Quote(value) {
        value := StrReplace(value, "\", "\\")
        value := StrReplace(value, '"', '\"')
        value := StrReplace(value, "`r", "\r")
        value := StrReplace(value, "`n", "\n")
        value := StrReplace(value, "`t", "\t")
        return '"' value '"'
    }
}
