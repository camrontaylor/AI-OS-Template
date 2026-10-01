[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Silent
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir "lib\python.ps1")

function Write-Info($Message) {
    if (-not $Silent) {
        Write-Host $Message
    }
}

function Write-Ok($Message) {
    if (-not $Silent) {
        Write-Host "  [OK] $Message" -ForegroundColor Green
    }
}

function Write-WarnLine($Message) {
    if (-not $Silent) {
        Write-Host "  [!] $Message" -ForegroundColor Yellow
    }
}

function Write-FailLine($Message) {
    if (-not $Silent) {
        Write-Host "  [X] $Message" -ForegroundColor Red
    }
}

function Add-Missing {
    param(
        [string]$Name
    )

    $script:MissingItems.Add($Name) | Out-Null
}

function Invoke-InstallCommand {
    param(
        [string]$Label,
        [scriptblock]$Action
    )

    if ($Check) {
        Add-Missing -Name $Label
        return $false
    }

    try {
        & $Action
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed"
        }
        Write-Ok "$Label installed"
        return $true
    }
    catch {
        Write-FailLine "$Label install failed"
        Add-Missing -Name $Label
        return $false
    }
}

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

$MissingItems = New-Object System.Collections.Generic.List[string]
$Errors = 0
$PythonInfo = $null
$WinPackageManager = $null

if (-not $Silent) {
    Write-Host ""
    Write-Host "========================================="
    Write-Host "  AI-OS - Dependency Setup"
    Write-Host "========================================="
    Write-Host ""
    Write-Host "  Platform: windows"
    Write-Host ""
}

Write-Info "Checking package manager..."
if (Get-Command winget -ErrorAction SilentlyContinue) {
    $WinPackageManager = "winget"
    Write-Ok "winget found"
}
elseif (Get-Command choco -ErrorAction SilentlyContinue) {
    $WinPackageManager = "choco"
    Write-Ok "choco found"
}
else {
    Write-WarnLine "No package manager found (winget or choco). Some installs may need manual help."
}

Write-Info "Checking Python 3..."
$PythonInfo = Resolve-PythonCommand
if ($PythonInfo) {
    Write-Ok "$($PythonInfo.Version) via $($PythonInfo.Label)"
    if ($PythonInfo.Python3DiagnosticBroken) {
        Write-WarnLine "Windows exposes a broken python3 at $($PythonInfo.Python3DiagnosticPath)."
        Write-WarnLine "AI-OS will use '$($PythonInfo.Label)' instead."
    }
}
else {
    Write-FailLine "Python 3 not found"
    Add-Missing -Name "python3"
    $Errors++
}

Write-Info "Checking uv..."
if (Get-Command uv -ErrorAction SilentlyContinue) {
    $uvVersion = (& uv --version | Out-String).Trim()
    Write-Ok $uvVersion
}
else {
    Write-WarnLine "uv missing"
    $uvInstalled = $false
    if ($WinPackageManager -eq "winget") {
        $uvInstalled = Invoke-InstallCommand -Label "uv" -Action { winget install --id astral-sh.uv -e --silent }
    }
    elseif ($WinPackageManager -eq "choco") {
        $uvInstalled = Invoke-InstallCommand -Label "uv" -Action { choco install uv -y }
    }
    else {
        Add-Missing -Name "uv"
    }

    if (-not $uvInstalled) {
        $Errors++
    }
}

Write-Info "Checking yt-dlp..."
if (Get-Command yt-dlp -ErrorAction SilentlyContinue) {
    Write-Ok "yt-dlp found"
}
else {
    Write-WarnLine "yt-dlp missing"
    $ytDlpInstalled = $false
    if ($WinPackageManager -eq "winget") {
        $ytDlpInstalled = Invoke-InstallCommand -Label "yt-dlp" -Action { winget install --id yt-dlp.yt-dlp -e --silent }
    }
    elseif ($PythonInfo) {
        $ytDlpInstalled = Invoke-InstallCommand -Label "yt-dlp" -Action { Invoke-CommandParts -CommandParts $PythonInfo.CommandParts -Arguments @("-m", "pip", "install", "yt-dlp") }
    }
    else {
        Add-Missing -Name "yt-dlp"
    }

    if (-not $ytDlpInstalled) {
        $Errors++
    }
}

Write-Info "Checking ffmpeg..."
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    Write-Ok "ffmpeg found"
}
else {
    Write-WarnLine "ffmpeg missing"
    $ffmpegInstalled = $false
    if ($WinPackageManager -eq "winget") {
        $ffmpegInstalled = Invoke-InstallCommand -Label "ffmpeg" -Action { winget install --id Gyan.FFmpeg -e --silent }
    }
    elseif ($WinPackageManager -eq "choco") {
        $ffmpegInstalled = Invoke-InstallCommand -Label "ffmpeg" -Action { choco install ffmpeg -y }
    }
    else {
        Add-Missing -Name "ffmpeg"
    }

    if (-not $ffmpegInstalled) {
        $Errors++
    }
}

if ($Check) {
    if ($Errors -eq 0) {
        exit 0
    }
    exit 1
}

if (-not $Silent) {
    Write-Host ""
    Write-Host "========================================="
    if ($Errors -eq 0) {
        Write-Host "  All dependency checks passed." -ForegroundColor Green
    }
    else {
        Write-Host "  $Errors dependency issue(s) still need attention." -ForegroundColor Yellow
        Write-Host ("  Missing items: " + ($MissingItems -join ", ")) -ForegroundColor Yellow
    }
    Write-Host "========================================="
    Write-Host ""
}

exit 0
