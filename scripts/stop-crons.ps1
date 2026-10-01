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
    -Heading "Stopping managed cron daemon" `
    -Subheading "This ends the background scheduler for the current workspace."
Write-AiOsCronInfo "Shutting down the daemon..."

node $ScriptPath stop @Arguments
$ExitCode = $LASTEXITCODE

if ($ExitCode -eq 0) {
    Write-AiOsCronSuccess "Managed cron daemon stopped."
}

exit $ExitCode
