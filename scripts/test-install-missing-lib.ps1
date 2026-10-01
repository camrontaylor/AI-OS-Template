$ErrorActionPreference = "Stop"

# install.ps1 must fail with an actionable message, not a bare dot-source
# error, when one of the libs it loads is missing (AIOS-473).
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-install-missing-lib.ps1

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PowerShellHost = (Get-Process -Id $PID).Path
$TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("AI-OS-install-missing-lib-" + [guid]::NewGuid().ToString("N"))
$Libs = @("python.ps1", "gsd-migration.ps1")
$Failures = 0

try {
    foreach ($Missing in $Libs) {
        $Work = Join-Path $TestRoot $Missing
        $WorkLib = Join-Path $Work "scripts\lib"
        New-Item -ItemType Directory -Force -Path $WorkLib | Out-Null
        Copy-Item -LiteralPath (Join-Path $ScriptDir "install.ps1") -Destination (Join-Path $Work "scripts\install.ps1")
        foreach ($Lib in $Libs) {
            if ($Lib -ne $Missing) {
                Copy-Item -LiteralPath (Join-Path $ScriptDir "lib\$Lib") -Destination (Join-Path $WorkLib $Lib)
            }
        }

        $Before = $Failures
        $PreviousPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $Output = & $PowerShellHost -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Work "scripts\install.ps1") -Repair 2>&1 | Out-String
        $Status = $LASTEXITCODE
        $ErrorActionPreference = $PreviousPreference

        if ($Status -eq 0) {
            Write-Host "  [X] install.ps1 exited 0 with scripts\lib\$Missing missing" -ForegroundColor Red
            $Failures++
            continue
        }
        foreach ($Expected in @("scripts/lib/$Missing is missing", "git checkout", "-- scripts/lib/$Missing")) {
            if (-not $Output.Contains($Expected)) {
                Write-Host "  [X] missing ${Missing}: output lacks '$Expected'" -ForegroundColor Red
                Write-Host $Output
                $Failures++
            }
        }
        if ($Failures -eq $Before) {
            Write-Host "  [OK] missing scripts\lib\$Missing fails with recovery steps" -ForegroundColor Green
        }
    }
}
finally {
    Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($Failures -gt 0) {
    Write-Host ""
    Write-Host "$Failures failure(s)" -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "All install missing-lib checks passed." -ForegroundColor Green
