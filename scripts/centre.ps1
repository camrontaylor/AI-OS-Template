[CmdletBinding()]
param(
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$CentreDir = Join-Path $RepoRoot "command-centre"
$Port = if ($env:PORT) { $env:PORT } else { "3000" }
$Url = "http://localhost:$Port"
$HelperScript = Join-Path $ScriptDir "launcher-bootstrap.py"
$InstallScript = Join-Path $ScriptDir "install.ps1"
$SetupScript = Join-Path $ScriptDir "setup.ps1"
$PowerShellHost = (Get-Process -Id $PID).Path

. (Join-Path $ScriptDir "lib\python.ps1")

function Info($Message) { Write-Host "  [!] $Message" -ForegroundColor Cyan }
function Success($Message) { Write-Host "  [OK] $Message" -ForegroundColor Green }
function Warn($Message) { Write-Host "  [!] $Message" -ForegroundColor Yellow }
function Fail($Message) { Write-Host "  [X] $Message" -ForegroundColor Red }

function Invoke-CommandParts {
    param(
        [string[]]$CommandParts,
        [string[]]$Arguments
    )

    $extra = @()
    if ($CommandParts.Length -gt 1) {
        $extra = $CommandParts[1..($CommandParts.Length - 1)]
    }

    & $CommandParts[0] @extra @Arguments
}

function Get-LauncherStateStatus {
    if (-not $script:PythonInfo) {
        throw "Python 3 is required for launcher bootstrap helpers."
    }

    $allArguments = @($HelperScript, "--repo-root", $RepoRoot, "state-status")
    $output = Invoke-CommandParts -CommandParts $script:PythonInfo.CommandParts -Arguments $allArguments
    if ($LASTEXITCODE -ne 0) {
        throw "launcher-bootstrap.py state-status failed."
    }

    return (($output | Out-String).Trim() | ConvertFrom-Json)
}

function Get-BootstrapStatus {
    if (-not $script:PythonInfo) {
        throw "Python 3 is required for launcher bootstrap helpers."
    }

    $allArguments = @($HelperScript, "--repo-root", $RepoRoot, "bootstrap-status")
    $output = Invoke-CommandParts -CommandParts $script:PythonInfo.CommandParts -Arguments $allArguments
    if ($LASTEXITCODE -ne 0) {
        throw "launcher-bootstrap.py bootstrap-status failed."
    }

    return (($output | Out-String).Trim() | ConvertFrom-Json)
}

function Migrate-LegacyState {
    if (-not $script:PythonInfo) {
        throw "Python 3 is required for launcher bootstrap helpers."
    }

    $allArguments = @($HelperScript, "--repo-root", $RepoRoot, "state-migrate-legacy")
    Invoke-CommandParts -CommandParts $script:PythonInfo.CommandParts -Arguments $allArguments | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "launcher-bootstrap.py state-migrate-legacy failed."
    }
}

if (-not (Test-Path $CentreDir)) {
    Fail "Command centre not found at: $CentreDir"
    exit 1
}

try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Info "Command centre already running at $Url - opening browser."
        Start-Process $Url
        exit 0
    }
}
catch {
    # Not running yet. Continue.
}

$script:PythonInfo = Resolve-PythonCommand
if (-not $script:PythonInfo) {
    Info "Python 3 is missing. Running the guided installer so it can explain what is required."
    & $PowerShellHost -NoProfile -ExecutionPolicy Bypass -File $InstallScript -Guided
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    $script:PythonInfo = Resolve-PythonCommand
    if (-not $script:PythonInfo) {
        exit 1
    }
}

$stateStatus = Get-LauncherStateStatus
if ($stateStatus.legacy_install_detected) {
    Info "Existing installation detected - recording launcher state so you are not asked setup questions again."
    Migrate-LegacyState
    $stateStatus = Get-LauncherStateStatus
}

if (-not $stateStatus.guided_install_completed) {
    Info "First launch detected - starting the guided install."
    & $PowerShellHost -NoProfile -ExecutionPolicy Bypass -File $InstallScript -Guided
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
else {
    $bootstrapStatus = Get-BootstrapStatus
    if (-not $bootstrapStatus.bootstrap_valid) {
        Info "Some local bootstrap files are missing - repairing them silently."
        & $PowerShellHost -NoProfile -ExecutionPolicy Bypass -File $InstallScript -Repair
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }
}

if (Test-Path $SetupScript) {
    & $PowerShellHost -NoProfile -ExecutionPolicy Bypass -File $SetupScript -Check -Silent
    if ($LASTEXITCODE -ne 0) {
        Info "Some dependencies are missing - repairing them now."
        & $PowerShellHost -NoProfile -ExecutionPolicy Bypass -File $SetupScript -Silent
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js is required. Install from https://nodejs.org/"
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail "npm is required (ships with Node.js)."
    exit 1
}

Set-Location $CentreDir

if ($Clean -and (Test-Path ".next")) {
    Info "Cleaning .next\ cache..."
    Remove-Item -Recurse -Force ".next"
    Success "Cache cleared"
}

if (-not (Test-Path "node_modules")) {
    Info "First run for the Command Centre - installing npm dependencies..."
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Success "Dependencies installed"
    Write-Host ""
}

Write-Host ""
Write-Host "    ==============================================" -ForegroundColor Cyan
Write-Host "             A G E N T I C   O S" -ForegroundColor Cyan
Write-Host "               Command Centre" -ForegroundColor Cyan
Write-Host "    ==============================================" -ForegroundColor Cyan
Write-Host ""
Info "Starting on $Url"
Write-Host ""

Start-Job -ScriptBlock {
    param($LaunchUrl)
    Start-Sleep -Seconds 3
    Start-Process $LaunchUrl
} -ArgumentList $Url | Out-Null

npm run dev
