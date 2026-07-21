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
    -Heading "Starting managed cron daemon" `
    -Subheading "This starts the daemon and returns control immediately."
Write-AgenticOsCronInfo "Launching the shared cron runtime..."

node $ScriptPath start @Arguments
$ExitCode = $LASTEXITCODE

if ($ExitCode -eq 0) {
    Write-AgenticOsCronSuccess "Managed cron daemon is running."
    Write-AgenticOsCronNote "Use 'scripts\status-crons.ps1' to check state or 'scripts\logs-crons.ps1' to follow logs."
}

exit $ExitCode
