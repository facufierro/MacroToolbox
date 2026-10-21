param(
    [ValidateSet('behavior', 'copilot')]
    [string]$Engine = 'behavior'
)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$ahkPath = Join-Path $projectPath 'src-tauri/resources/autohotkey/AutoHotkey64.exe'
$source = [IO.File]::ReadAllText((Join-Path $projectPath 'src-tauri/src/ahk.rs'))
$engineName = $Engine.ToUpperInvariant() + '_ENGINE'
$engineSource = [regex]::Match($source, '(?s)const ' + $engineName + ': &str = r###"(.*?)"###;')
if (-not $engineSource.Success) { throw "AutoHotkey $Engine engine not found" }

# Exercise the production interpreter with input delivery replaced by an in-memory test sink.
# No keyboard/mouse hooks or external application processes are needed. One test
# delivers ControlClick messages to a hidden fixture window without global input.
$isolatedEngine = [regex]::Replace($engineSource.Groups[1].Value, '\bSend(Input|Event)\b', 'TestSend')
$isolatedEngine = [regex]::Replace($isolatedEngine, '\bGetKeyState\b', 'TestGetKeyState')
if ($Engine -eq 'behavior') {
    $isolatedEngine = [regex]::Replace($isolatedEngine, '\bWinGetProcessName\b', 'TestWinGetProcessName')
    foreach ($native in @('ControlClick', 'MouseGetPos', 'WinGetClientPos', 'WinExist')) {
        $isolatedEngine = [regex]::Replace($isolatedEngine, '\b' + $native + '\b', 'Test' + $native)
    }
    $isolatedEngine = [regex]::Replace($isolatedEngine, '(?m)^(\s*)MouseMove\b', '${1}TestMouseMove')
    $isolatedEngine = [regex]::Replace($isolatedEngine, '(?m)^(\s*if )TryGetViewportFromApp\b', '${1}TestTryGetViewportFromApp')
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
$testPath = Join-Path ([IO.Path]::GetTempPath()) ("MacroToolbox-$Engine-" + [Guid]::NewGuid().ToString('N') + '.ahk')
$process = $null
$stages = @(@{ Source = $isolatedEngine; Validate = ''; Name = "$Engine tests" })
if ($Engine -eq 'copilot') {
    # /Validate loads the real hotkey declarations without executing the script.
    # It does not install the production keyboard hook or send any input.
    $stages = @(@{ Source = $engineSource.Groups[1].Value; Validate = '/Validate '; Name = 'Copilot hotkey syntax validation' }) + $stages
}
try {
    foreach ($stage in $stages) {
        [IO.File]::WriteAllText($testPath, $fixture + [Environment]::NewLine + $stage.Source, [Text.UTF8Encoding]::new($true))
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
