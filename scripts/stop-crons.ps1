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
    -Heading "Stopping managed cron daemon" `
    -Subheading "This ends the background scheduler for the current workspace."
Write-AgenticOsCronInfo "Shutting down the daemon..."

node $ScriptPath stop @Arguments
$ExitCode = $LASTEXITCODE

if ($ExitCode -eq 0) {
    Write-AgenticOsCronSuccess "Managed cron daemon stopped."
}

exit $ExitCode
