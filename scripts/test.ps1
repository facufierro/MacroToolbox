param([switch]$SkipRust)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectPath
. (Join-Path $PSScriptRoot 'test-artifacts.ps1')

& node node_modules/typescript/bin/tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw 'Type checks failed.' }
& node --experimental-strip-types --test tests/*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'JavaScript tests failed.' }
& python -B -m unittest discover -s tests -p test_script_api.py
if ($LASTEXITCODE -ne 0) { throw 'Python API tests failed.' }
foreach ($engine in @('behavior', 'copilot', 'runtime')) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'test-ahk-behavior.ps1') -Engine $engine
    if ($LASTEXITCODE -ne 0) { throw "AutoHotkey $engine tests failed." }
}

if (-not $SkipRust) {
    $manifestPath = Join-Path $projectPath 'src-tauri/target/test-artifacts.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Rust test binaries are missing. Use the Build action button, then run tests again.' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.sourceHash -ne (Get-TestSourceHash $projectPath)) { throw 'Rust test binaries are out of date. Use the Build action button, then run tests again.' }
    foreach ($executable in $manifest.executables) {
        # Native window tests share process-wide magnification and desktop state.
        & $executable --test-threads=1
        if ($LASTEXITCODE -ne 0) { throw "Rust tests failed: $executable" }
    }
}
Write-Output 'All requested checks passed.'
