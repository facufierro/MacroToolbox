param(
    [string]$Version
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) {
    $env:PATH += ";$cargoBin"
}

$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
$tauriConfig = Get-Content $tauriConfigPath -Raw | ConvertFrom-Json
$gitTag = if ($Version) { $Version.Trim() } else { $env:HKM_RELEASE_VERSION }
if (-not $gitTag) {
    $latestTag = (& git describe --tags --abbrev=0 2>$null).Trim()
    if ($latestTag -match '^v?(\d+)\.(\d+)\.(\d+)$') {
        $gitTag = "v$($matches[1]).$($matches[2]).$([int]$matches[3] + 1)"
    } else {
        $gitTag = "v1.0.0"
    }
}
$tagName = if ($gitTag.StartsWith("v")) { $gitTag } else { "v$gitTag" }
$version = $tagName.TrimStart("v")
if (-not $version) {
    throw "Could not determine release version from git tag '$gitTag'."
}

$tauriConfig.version = $version
$tauriConfig | ConvertTo-Json -Depth 20 | Set-Content $tauriConfigPath

$cargoTomlPath = Join-Path $repoRoot "src-tauri\Cargo.toml"
$cargoToml = Get-Content $cargoTomlPath
$updatedCargoVersion = $false
$cargoToml = $cargoToml | ForEach-Object {
    if (-not $updatedCargoVersion -and $_ -match '^version\s*=\s*"') {
        $updatedCargoVersion = $true
        "version = `"$version`""
    } else {
        $_
    }
}
$cargoToml | Set-Content $cargoTomlPath

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

if (Test-Path $releaseDir) {
    Remove-Item -LiteralPath $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null

if (Test-Path $bundleDir) {
    Remove-Item -LiteralPath $bundleDir -Recurse -Force
}

npm run tauri build

$artifactPatterns = @(
    "nsis\*.exe",
    "msi\*.msi"
)

$copied = @()
foreach ($pattern in $artifactPatterns) {
    $matches = Get-ChildItem -Path (Join-Path $bundleDir $pattern) -File -ErrorAction SilentlyContinue
    foreach ($artifact in $matches) {
        if (-not $artifact.Name.Contains($version)) {
            continue
        }
        Copy-Item -LiteralPath $artifact.FullName -Destination $releaseDir
        $copied += $artifact.Name
    }
}

if ($copied.Count -eq 0) {
    throw "Build finished, but no release artifacts matching version $version were found in src-tauri\target\release\bundle"
}

Write-Host ""
Write-Host "Release artifacts copied to releases\${tagName}:"
$copied | ForEach-Object { Write-Host " - $_" }
Write-Host ""
Write-Host "Next:"
Write-Host "  git add ."
Write-Host "  git commit -m `"Release $tagName`""
Write-Host "  git tag $tagName"
Write-Host "  git push"
Write-Host "  git push origin $tagName"
