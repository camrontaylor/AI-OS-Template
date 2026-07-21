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
    -Heading "Checking cron runtime status" `
    -Subheading "This shows whether the CLI daemon or the Command Centre server is leading."
Write-AgenticOsCronInfo "Reading the shared runtime lock and daemon state..."

node $ScriptPath status @Arguments
$ExitCode = $LASTEXITCODE

if ($ExitCode -eq 0) {
    Write-AgenticOsCronSuccess "Status check complete."
}

exit $ExitCode
