function Get-TestSourceHash([string]$ProjectPath) {
    $paths = @(
        Get-ChildItem -LiteralPath (Join-Path $ProjectPath 'src-tauri/src') -Recurse -File |
            Where-Object { $_.Extension -in @('.rs', '.ahk', '.py') } | ForEach-Object { $_.FullName }
        Get-ChildItem -LiteralPath (Join-Path $ProjectPath 'tests/fixtures') -File | ForEach-Object { $_.FullName }
        Join-Path $ProjectPath 'src-tauri/Cargo.toml'
        Join-Path $ProjectPath 'src-tauri/tauri.conf.json'
        if (Test-Path -LiteralPath (Join-Path $ProjectPath 'src-tauri/Cargo.lock')) { Join-Path $ProjectPath 'src-tauri/Cargo.lock' }
    ) | Sort-Object
    $entries = foreach ($path in $paths) { "$path`n$((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash)" }
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes(($entries -join "`n")))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
