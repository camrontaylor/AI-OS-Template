param(
    [ValidateSet("success", "info", "warning", "error")]
    [string]$Variant = "info",
    [string]$Status = "",
    [string]$Subject = "Windows notification test",
    [string]$Detail = "",
    [string]$Duration = "",
    [ValidateSet("", "compact", "hero")]
    [string]$Layout = "",
    [ValidateSet("", "interactive", "cron")]
    [string]$Channel = "",
    [ValidateSet("", "waiting", "permission", "actionRequired", "complete", "success", "timeout", "failure")]
    [string]$Event = "",
    [string]$ContextJson = "",
    [switch]$Preview,
    [switch]$Verify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Detail)) {
    $Detail = "This is a $Variant test for the shared Windows toast helper."
}

$projectDir = Split-Path -Parent $PSScriptRoot
$helperPath = Join-Path $projectDir "scripts\windows-notify.ps1"
$powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"

function Invoke-NotifyHelper {
    param([string[]]$ExtraArgs)

    $allArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $helperPath) + $ExtraArgs
    $output = & $powershellExe @allArgs 2>&1
    $exitCode = $LASTEXITCODE

    return @{
        ExitCode = $exitCode
        Output = $output
    }
}

function Get-PreviewScenario {
    param(
        [string]$ScenarioEvent,
        [string]$Context
    )

    $extraArgs = @(
        "-Channel", "interactive",
        "-Event", $ScenarioEvent,
        "-ContextBase64", [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Context)),
        "-Preview"
    )

    $result = Invoke-NotifyHelper -ExtraArgs $extraArgs
    if ($result.ExitCode -ne 0) {
        throw "Preview scenario '$ScenarioEvent' failed: $($result.Output -join [Environment]::NewLine)"
    }

    return (($result.Output -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Get-BodyLine {
    param(
        $Preview,
        [int]$Index
    )

    if ($null -eq $Preview -or $null -eq $Preview.body_lines) {
        return ""
    }

    if ($Index -lt 0 -or $Index -ge $Preview.body_lines.Count) {
        return ""
    }

    return [string]$Preview.body_lines[$Index]
}

if ($Verify) {
    $longJobName = "Build the Windows notification polish flow so the status, folder, click target, and finish time all fit cleanly in one toast card"
    $completePreview = Get-PreviewScenario -ScenarioEvent "complete" -Context (@{
            folderLabel = "client-root"
            jobLabel = $longJobName
            durationText = "4m12s"
            sessionId = "session-complete"
            taskId = "task-complete"
            port = "3000"
            cwd = "C:\AgenticOS"
        } | ConvertTo-Json -Compress)
    $waitingPreview = Get-PreviewScenario -ScenarioEvent "waiting" -Context (@{
            folderLabel = "client-root"
            jobLabel = $longJobName
            durationText = "58s"
            sessionId = "session-waiting"
            taskId = "task-waiting"
            port = "3000"
            cwd = "C:\AgenticOS"
        } | ConvertTo-Json -Compress)

    $completeFolderLine = Get-BodyLine -Preview $completePreview -Index 1
    $completeJobLine = Get-BodyLine -Preview $completePreview -Index 2
    $waitingFolderLine = Get-BodyLine -Preview $waitingPreview -Index 1
    $waitingJobLine = Get-BodyLine -Preview $waitingPreview -Index 2

    $checks = @(
        @{ Name = "Card title"; Pass = ($completePreview.title -eq "Agentic OS"); Actual = $completePreview.title }
        @{ Name = "Complete emoji suffix"; Pass = ($completePreview.status_line.StartsWith("Task complete") -and -not $completePreview.status_line.StartsWith("✅")); Actual = $completePreview.status_line }
        @{ Name = "Waiting emoji suffix"; Pass = ($waitingPreview.status_line.StartsWith("Needs input") -and -not $waitingPreview.status_line.StartsWith("💡")); Actual = $waitingPreview.status_line }
        @{ Name = "Attribution removed"; Pass = ([string]::IsNullOrWhiteSpace([string]$completePreview.attribution)); Actual = $completePreview.attribution }
        @{ Name = "Complete uses 3 visible lines"; Pass = ($completePreview.body_lines.Count -eq 3); Actual = $completePreview.body_lines.Count }
        @{ Name = "Waiting uses 3 visible lines"; Pass = ($waitingPreview.body_lines.Count -eq 3); Actual = $waitingPreview.body_lines.Count }
        @{ Name = "Complete line 2 folder"; Pass = ($completeFolderLine -eq "client-root"); Actual = $completeFolderLine }
        @{ Name = "Complete job line present"; Pass = ($completeJobLine.StartsWith("Build the Windows notification polish flow")); Actual = $completeJobLine }
        @{ Name = "Complete job line trimmed"; Pass = ($completeJobLine.Length -gt 0 -and $completeJobLine.Length -lt $longJobName.Length); Actual = $completeJobLine.Length }
        @{ Name = "Waiting line 2 folder"; Pass = ($waitingFolderLine -eq "client-root"); Actual = $waitingFolderLine }
        @{ Name = "Waiting job line present"; Pass = ($waitingJobLine.StartsWith("Build the Windows notification polish flow")); Actual = $waitingJobLine }
    )

    $summary = [ordered]@{
        ok = -not ($checks | Where-Object { -not $_.Pass })
        checks = $checks
        complete = $completePreview
        waiting = $waitingPreview
    }

    $summary | ConvertTo-Json -Depth 6
    if (-not $summary.ok) {
        exit 1
    }
    exit 0
}

$args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $helperPath)

if (-not [string]::IsNullOrWhiteSpace($Channel) -or -not [string]::IsNullOrWhiteSpace($Event)) {
    if ([string]::IsNullOrWhiteSpace($Channel) -or [string]::IsNullOrWhiteSpace($Event)) {
        throw "Channel and Event must be provided together."
    }

    if ([string]::IsNullOrWhiteSpace($ContextJson)) {
        $ContextJson = "{}"
    }

    $args += @(
        "-Channel", $Channel,
        "-Event", $Event,
        "-ContextBase64", [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($ContextJson))
    )
    if (-not [string]::IsNullOrWhiteSpace($Layout)) {
        $args += @("-Layout", $Layout)
    }
} else {
    $args += @("-Variant", $Variant)
    if (-not [string]::IsNullOrWhiteSpace($Status)) { $args += @("-Status", $Status) }
    if (-not [string]::IsNullOrWhiteSpace($Subject)) { $args += @("-Subject", $Subject) }
    if (-not [string]::IsNullOrWhiteSpace($Detail)) { $args += @("-Detail", $Detail) }
    if (-not [string]::IsNullOrWhiteSpace($Layout)) { $args += @("-Layout", $Layout) }

    if (-not [string]::IsNullOrWhiteSpace($Duration)) {
        $args += @("-Duration", $Duration)
    }
}

if ($Preview) {
    $args += "-Preview"
}

$output = & $powershellExe @args 2>&1
$exitCode = $LASTEXITCODE

if ($output) {
    $output | ForEach-Object { Write-Output $_ }
}

exit $exitCode
