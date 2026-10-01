[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$CronUiPath = Join-Path $PSScriptRoot "lib\cron-ui.ps1"
. $CronUiPath

Write-AiOsCronBanner `
    -Heading "uninstall-crons is deprecated" `
    -Subheading "Stopping the managed cron daemon instead."
Write-AiOsCronInfo "Redirecting to stop-crons..."
& (Join-Path $PSScriptRoot "stop-crons.ps1") @Arguments
exit $LASTEXITCODE
