[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$PathFilter,
    [string]$Root,
    [switch]$CleanPidFiles,
    [switch]$ListOnly
)

$ErrorActionPreference = "Stop"

function Info($Message) { Write-Host $Message -ForegroundColor Cyan }
function Success($Message) { Write-Host "  [OK] $Message" -ForegroundColor Green }
function Warn($Message) { Write-Host "  [!] $Message" -ForegroundColor Yellow }
function Fail($Message) { Write-Host "  [X] $Message" -ForegroundColor Red }

function Shorten-CommandLine {
    param([string]$CommandLine)

    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return "" }
    if ($CommandLine.Length -le 220) { return $CommandLine }
    return $CommandLine.Substring(0, 217) + "..."
}

function Find-MemSearchWatchProcesses {
    $processMatches = Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match '(?i)\bmemsearch\b' -and
        $_.CommandLine -match '(?i)\bwatch\b'
    }

    if (-not [string]::IsNullOrWhiteSpace($PathFilter)) {
        $escaped = [regex]::Escape($PathFilter)
        $processMatches = $processMatches | Where-Object { $_.CommandLine -match $escaped }
    }

    return @($processMatches)
}

function Remove-StalePidFiles {
    if (-not $CleanPidFiles) { return }

    if ([string]::IsNullOrWhiteSpace($Root)) {
        Warn "Skipping pidfile cleanup because -Root was not provided."
        return
    }

    $rootPath = Resolve-Path -LiteralPath $Root -ErrorAction Stop
    $pidFiles = Get-ChildItem -LiteralPath $rootPath -Recurse -Filter ".watch.pid" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '[\\/]\.memsearch[\\/]' }

    foreach ($pidFile in $pidFiles) {
        if ($PSCmdlet.ShouldProcess($pidFile.FullName, "Remove stale MemSearch watch pidfile")) {
            try {
                Remove-Item -LiteralPath $pidFile.FullName -Force -ErrorAction Stop
                Success "Removed stale pidfile: $($pidFile.FullName)"
            }
            catch {
                Fail "Could not remove pidfile $($pidFile.FullName): $($_.Exception.Message)"
            }
        }
    }
}

Info "Scanning for MemSearch watch processes..."
$processes = Find-MemSearchWatchProcesses

if ($processes.Count -eq 0) {
    Success "No memsearch watch processes found."
}
else {
    foreach ($process in $processes) {
        $summary = "PID {0} ({1}) {2}" -f $process.ProcessId, $process.Name, (Shorten-CommandLine $process.CommandLine)

        if ($ListOnly) {
            Info $summary
            continue
        }

        if ($PSCmdlet.ShouldProcess($summary, "Stop MemSearch watch process")) {
            try {
                Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
                Warn "Killed PID $($process.ProcessId) ($($process.Name))"
            }
            catch {
                Fail "Could not kill PID $($process.ProcessId) ($($process.Name)): $($_.Exception.Message)"
            }
        }
    }
}

Remove-StalePidFiles
