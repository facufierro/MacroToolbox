param(
    [Parameter(Mandatory = $true)]
    [string]$ActionName,

    [Parameter(Mandatory = $true)]
    [string]$CommandText,

    [switch]$SkipNotification
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$exitCode = 1

try {
    $childCommand = @"
$CommandText
`$commandSucceeded = `$?
if (`$null -ne `$LASTEXITCODE) { exit `$LASTEXITCODE }
if (-not `$commandSucceeded) { exit 1 }
"@
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCommand))
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encodedCommand
    $exitCode = $LASTEXITCODE
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
}
finally {
    if (-not $SkipNotification) {
        $notifier = Join-Path $env:USERPROFILE '.codex\notify.ps1'
        if (Test-Path -LiteralPath $notifier) {
            $payload = [ordered]@{
                type = 'action-button-complete'
                cwd = $repoRoot
                'last-assistant-message' = "$ActionName finished with exit code $exitCode."
            } | ConvertTo-Json -Compress

            & $notifier $payload
        }
        else {
            Write-Warning 'Codex completion notifier not found at ~/.codex/notify.ps1.'
        }
    }
}

exit $exitCode
