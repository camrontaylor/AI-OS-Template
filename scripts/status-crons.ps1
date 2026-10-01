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
    -Heading "Checking cron runtime status" `
    -Subheading "This shows whether the CLI daemon or the Command Centre server is leading."
Write-AiOsCronInfo "Reading the shared runtime lock and daemon state..."

$StatusOutput = @(node $ScriptPath status @Arguments)
$ExitCode = $LASTEXITCODE
$StatusOutput | ForEach-Object { Write-Output $_ }

if ($ExitCode -eq 0) {
    if ($StatusOutput | Where-Object { $_ -like "warning: *" }) {
        Write-AiOsCronWarn "No live cron runtime: scheduled jobs are not running."
    } else {
        Write-AiOsCronSuccess "Status check complete."
    }
}

exit $ExitCode
