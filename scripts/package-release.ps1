$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) {
    $env:PATH += ";$cargoBin"
}

$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
$tauriConfig = Get-Content $tauriConfigPath -Raw | ConvertFrom-Json
$version = $tauriConfig.version
if (-not $version) {
    throw "Could not read version from src-tauri\tauri.conf.json"
}

$tagName = "v$version"
$releaseDir = Join-Path $repoRoot "releases\$tagName"
$bundleDir = Join-Path $repoRoot "src-tauri\target\release\bundle"
$sourceAhkExe = $env:HKM_AHK_EXE
if (-not $sourceAhkExe) {
    $sourceAhkExe = "D:\Apps\AutoHotkey\_App\v2\AutoHotkey64.exe"
}
$bundledAhkDir = Join-Path $repoRoot "src-tauri\resources\autohotkey"
$bundledAhkExe = Join-Path $bundledAhkDir "AutoHotkey64.exe"

if (-not (Test-Path -LiteralPath $sourceAhkExe -PathType Leaf)) {
    throw "AutoHotkey v2 not found at '$sourceAhkExe'. Set HKM_AHK_EXE to the AutoHotkey64.exe path."
}
New-Item -ItemType Directory -Path $bundledAhkDir -Force | Out-Null
Copy-Item -LiteralPath $sourceAhkExe -Destination $bundledAhkExe -Force

npm run tauri build

if (Test-Path $releaseDir) {
    Remove-Item -LiteralPath $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null

$artifactPatterns = @(
    "nsis\*.exe",
    "msi\*.msi"
)

$copied = @()
foreach ($pattern in $artifactPatterns) {
    $matches = Get-ChildItem -Path (Join-Path $bundleDir $pattern) -File -ErrorAction SilentlyContinue
    foreach ($artifact in $matches) {
        Copy-Item -LiteralPath $artifact.FullName -Destination $releaseDir
        $copied += $artifact.Name
    }
}

if ($copied.Count -eq 0) {
    throw "Build finished, but no release artifacts were found in src-tauri\target\release\bundle"
}

Write-Host ""
Write-Host "Release artifacts copied to releases\${tagName}:"
$copied | ForEach-Object { Write-Host " - $_" }
Write-Host ""
Write-Host "Commit releases\$tagName, push it, then tag the same version ($tagName) to publish."
