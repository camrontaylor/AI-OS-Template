$CronUiPath = Join-Path $PSScriptRoot "lib\cron-ui.ps1"
. $CronUiPath

Write-AiOsCronBanner `
    -Heading "run-crons is deprecated" `
    -Subheading "Automatic scheduling no longer uses the OS scheduler."
Write-AiOsCronWarn "Use 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-crons.ps1' to start the managed daemon."
Write-AiOsCronNote "You can also keep the Command Centre server running for in-process scheduling."

exit 0
