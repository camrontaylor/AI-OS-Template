[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ScriptPath = Join-Path $RepoRoot "scripts\cron\cron-daemon.cjs"
$CronUiPath = Join-Path $PSScriptRoot "lib\cron-ui.ps1"
. $CronUiPath

Write-AgenticOsCronBanner `
    -Heading "Showing cron daemon logs" `
    -Subheading "Press Ctrl+C to stop following the live stream."
Write-AgenticOsCronInfo "Streaming the daemon output..."

node $ScriptPath logs @Arguments
$ExitCode = $LASTEXITCODE

if ($ExitCode -eq 0) {
    Write-AgenticOsCronSuccess "Log stream finished."
}

exit $ExitCode
