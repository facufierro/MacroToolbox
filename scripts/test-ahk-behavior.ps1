param(
    [ValidateSet('behavior', 'copilot', 'runtime')]
    [string]$Engine = 'behavior'
)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$ahkPath = Join-Path $projectPath 'src-tauri/resources/autohotkey/AutoHotkey64.exe'
$source = [IO.File]::ReadAllText((Join-Path $projectPath 'src-tauri/src/ahk.rs'))
$engineName = $(if ($Engine -eq 'runtime') { 'BEHAVIOR' } else { $Engine.ToUpperInvariant() }) + '_ENGINE'
$engineSource = [regex]::Match($source, '(?s)const ' + $engineName + ': &str = r###"(.*?)"###;')
if (-not $engineSource.Success) { throw "AutoHotkey $Engine engine not found" }
$engineText = $engineSource.Groups[1].Value
if ($Engine -eq 'runtime') {
    foreach ($file in @('behavior_runtime.ahk', 'json.ahk', 'runtime_host.ahk')) {
        $engineText += [Environment]::NewLine + [IO.File]::ReadAllText((Join-Path $projectPath "src-tauri/src/$file"))
    }
}

if ($Engine -in @('behavior', 'runtime')) {
    $engineText += [Environment]::NewLine + [IO.File]::ReadAllText((Join-Path $projectPath 'tests/ahk/legacy-fixture.ahk'))
}

# Exercise production input primitives and the structured executor with an isolated test sink.
# No keyboard/mouse hooks or injected global input are needed. Native checks use a hidden
# fixture window and register raw input only inside this short-lived test process.
$isolatedEngine = [regex]::Replace($engineText, '\bSend(Input|Event)\b', 'TestSend')
$isolatedEngine = [regex]::Replace($isolatedEngine, '\bGetKeyState\b', 'TestGetKeyState')
if ($Engine -in @('behavior', 'runtime')) {
    $nativeInput = [regex]::Match($engineSource.Groups[1].Value, '(?ms)^; Native behavior input boundary\..*?^; End native behavior input boundary\.').Value
    if (-not $nativeInput) { throw 'Behavior input boundary not found' }
    $isolatedEngine = $isolatedEngine.Replace($nativeInput, '')
    foreach ($native in @('StartBehaviorInput', 'StopBehaviorInput', 'ReadBehaviorInput')) {
        $isolatedEngine = [regex]::Replace($isolatedEngine, '\b' + $native + '\b', 'Test' + $native)
        $nativeInput = [regex]::Replace($nativeInput, '\b' + $native + '\b', 'Native' + $native)
    }
    $isolatedEngine += [Environment]::NewLine + $nativeInput
    $isolatedEngine = [regex]::Replace($isolatedEngine, '\bWinGetProcessName\b', 'TestWinGetProcessName')
    foreach ($native in @('ControlClick', 'MouseGetPos', 'WinGetClientPos', 'WinExist', 'WinActive', 'BlockInput')) {
        $isolatedEngine = [regex]::Replace($isolatedEngine, '\b' + $native + '\b', 'Test' + $native)
    }
    $isolatedEngine = [regex]::Replace($isolatedEngine, '(?m)^(\s*)MouseMove\b', '${1}TestMouseMove')
    $isolatedEngine = [regex]::Replace($isolatedEngine, '(?m)^(\s*if !?)TryGetViewportFromApp\b', '${1}TestTryGetViewportFromApp')
}
if ($Engine -eq 'runtime') {
    $isolatedEngine = [regex]::Replace($isolatedEngine, '\bPostMessage\b', 'TestPostMessage')
    $isolatedEngine = [regex]::Replace($isolatedEngine, '\bHotkey\b', 'TestHotkey')
    $isolatedEngine = [regex]::Replace($isolatedEngine, '\bHotIf\b', 'TestHotIf')
    $isolatedEngine = [regex]::Replace($isolatedEngine, '\bSendRuntimeAction\b(?=\()', 'TestRuntimeAction')
    # The fixture supplies the operation sink; keep the production error-reporting path.
    $isolatedEngine = [regex]::Replace($isolatedEngine, '(?ms)^TestRuntimeAction\(profile, kind, id, value := ""\) \{.*?^\}', '')
}
if ($Engine -eq 'copilot') {
    foreach ($binding in @('$*LWin::CopilotWinDown()', '$*LWin up::CopilotWinUp()', '$*LShift::CopilotShiftDown()', '~$*LShift::ObserveCopilotShiftDown()', '~$*LShift up::ObserveCopilotShiftUp()')) {
        if (-not $engineSource.Groups[1].Value.Contains($binding)) { throw "Modifier filter binding missing: $binding" }
    }
    # Call the real input-owner functions with physical/logical state and timers supplied by
    # the fixture. Strip all hotkey declarations so this test cannot install keyboard hooks.
    $isolatedEngine = [regex]::Replace($isolatedEngine, '(?m)^~?\$\*[^\r\n]+::[^\r\n]+\r?\n', '')
    $isolatedEngine = [regex]::Replace($isolatedEngine, '\bSetTimer\b', 'TestSetTimer')
    $isolatedEngine = [regex]::Replace($isolatedEngine, '\bInputHook\b', 'TestInputHook')
}
$fixture = [IO.File]::ReadAllText((Join-Path $projectPath "tests/ahk/$Engine.test.ahk"))
if ($Engine -eq 'runtime') {
    $baseFixture = [IO.File]::ReadAllText((Join-Path $projectPath 'tests/ahk/behavior.test.ahk'))
    $baseFixture = [regex]::Replace($baseFixture, '(?m)^RunTest\([^\r\n]*\)\r?\n|^FileAppend\("All 44[^\r\n]*\r?\n|^ExitApp 0\r?\n', '')
    $fixture = $baseFixture + [Environment]::NewLine + $fixture
}
$testPath = Join-Path ([IO.Path]::GetTempPath()) ("MacroToolbox-$Engine-" + [Guid]::NewGuid().ToString('N') + '.ahk')
$process = $null
$stages = @(@{ Source = $isolatedEngine; Validate = ''; Name = "$Engine tests" })
# /Validate checks the production declarations and native boundary without executing them.
$validationSource = $engineText
if ($Engine -in @('behavior', 'runtime')) { $validationSource += [Environment]::NewLine + $nativeInput }
$stages = @(@{ Source = $validationSource; Validate = '/Validate '; Name = "$Engine syntax validation" }) + $stages
if ($Engine -eq 'runtime') {
    $fullSource = [IO.File]::ReadAllText((Join-Path $projectPath 'src-tauri/src/input_host.ahk'))
    $fullSource += [Environment]::NewLine + [regex]::Match($source, '(?s)const COPILOT_ENGINE: &str = r###"(.*?)"###;').Groups[1].Value
    $fullSource += [Environment]::NewLine + $engineSource.Groups[1].Value
    foreach ($file in @('behavior_runtime.ahk', 'json.ahk', 'runtime_host.ahk')) {
        $fullSource += [Environment]::NewLine + [IO.File]::ReadAllText((Join-Path $projectPath "src-tauri/src/$file"))
    }
    $stages += @{ Source = $fullSource; Validate = '/Validate '; Name = 'Complete input host syntax validation'; NoFixture = $true }
    $apiSource = [IO.File]::ReadAllText((Join-Path $projectPath 'src-tauri/src/script_api.ahk'))
    $apiSource += [Environment]::NewLine + [IO.File]::ReadAllText((Join-Path $projectPath 'src-tauri/src/json.ahk')).Replace('JsonReader', 'MacroToolboxJsonReader')
    $stages += @{ Source = $apiSource; Validate = '/Validate '; Name = 'Script API syntax validation'; NoFixture = $true }
}
try {
    foreach ($stage in $stages) {
        $prefix = if ($stage.NoFixture) { '' } else { $fixture }
        [IO.File]::WriteAllText($testPath, $prefix + [Environment]::NewLine + $stage.Source, [Text.UTF8Encoding]::new($true))
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = $ahkPath
        $start.Arguments = '/ErrorStdOut ' + $stage.Validate + '"' + $testPath + '"'
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $process = [Diagnostics.Process]::Start($start)
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) {
            $process.Kill()
            $process.WaitForExit()
            throw "$($stage.Name) timed out"
        }
        $output = $stdout.GetAwaiter().GetResult()
        $errors = $stderr.GetAwaiter().GetResult()
        if ($output) { Write-Output $output.TrimEnd() }
        if ($errors) { Write-Output $errors.TrimEnd() }
        if ($process.ExitCode -ne 0) { throw "$($stage.Name) failed (exit $($process.ExitCode))" }
        $process.Dispose()
        $process = $null
    }
} finally {
    if ($process) { $process.Dispose() }
    Remove-Item -LiteralPath $testPath -ErrorAction SilentlyContinue
}
