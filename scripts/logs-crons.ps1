[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ScriptPath = Join-Path $RepoRoot "command-centre\scripts\cron-daemon.cjs"
$CronUiPath = Join-Path $PSScriptRoot "lib\cron-ui.ps1"
. $CronUiPath

Write-AiOsCronBanner `
    -Heading "Showing cron daemon logs" `
    -Subheading "Press Ctrl+C to stop following the live stream."
Write-AiOsCronInfo "Streaming the daemon output..."

node $ScriptPath logs @Arguments
$ExitCode = $LASTEXITCODE

if ($ExitCode -eq 0) {
    Write-AiOsCronSuccess "Log stream finished."
}

exit $ExitCode
