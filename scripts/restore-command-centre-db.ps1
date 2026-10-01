[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$OldInstallPath
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$PythonLib = Join-Path $ScriptDir "lib\python.ps1"
$Helper = Join-Path $ScriptDir "lib\command-centre-db-restore.py"
$StopCrons = Join-Path $ScriptDir "stop-crons.ps1"

. $PythonLib

if (Test-Path -LiteralPath $StopCrons) {
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $StopCrons *> $null
    }
    catch {
        # Best effort only. The restore helper still backs up the target DB first.
    }
}

Write-Host "  [!] Close any running Command Centre window before continuing." -ForegroundColor Yellow

$Python = Resolve-PythonCommand
if (-not $Python) {
    Write-Error "Python 3 is required to restore Command Centre history."
    exit 1
}

$Executable = $Python.CommandParts[0]
$ExtraArgs = @()
if ($Python.CommandParts.Length -gt 1) {
    $ExtraArgs = $Python.CommandParts[1..($Python.CommandParts.Length - 1)]
}

& $Executable @ExtraArgs $Helper --old-install $OldInstallPath --new-install $RepoRoot
exit $LASTEXITCODE
