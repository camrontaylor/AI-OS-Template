[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SetupScript = Join-Path $ScriptDir "setup-memory.ps1"
$TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("AI-OS-memory-setup-ps-" + [guid]::NewGuid().ToString("N"))
$RunningOnWindows = if (Get-Variable -Name IsWindows -ErrorAction SilentlyContinue) {
    [bool]$IsWindows
}
else {
    [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
}
$PowerShellExecutable = (Get-Process -Id $PID).Path
$NodeDirectory = Split-Path -Parent (Get-Command node -ErrorAction Stop).Source

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw "[FAIL] $Message"
    }
}

function Assert-Contains {
    param(
        [string]$Value,
        [string]$Expected,
        [string]$Message
    )

    Assert-True -Condition $Value.Contains($Expected) -Message "$Message`nExpected to find: $Expected`n--- value ---`n$Value"
}

function Assert-NotContains {
    param(
        [string]$Value,
        [string]$Unexpected,
        [string]$Message
    )

    Assert-True -Condition (-not $Value.Contains($Unexpected)) -Message "$Message`nDid not expect to find: $Unexpected`n--- value ---`n$Value"
}

function New-FakeNpm {
    param([string]$FakeBin)

    if ($RunningOnWindows) {
        $npmPath = Join-Path $FakeBin "npm.cmd"
        @'
@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "allArgs=%*"
>>"%ACTION_LOG%" echo npm MEMORY_STORE_BACKEND=%MEMORY_STORE_BACKEND% %*
set "isReindex="
for %%A in (%*) do (
  if /I "%%~A"=="memory:reindex" set "isReindex=1"
)
if defined isReindex if exist "%REPO_UNDER_TEST%\.fake-reindex-fail" exit /b 1
if defined isReindex if "%FAKE_MEMORY_REINDEX_FAIL%"=="1" exit /b 1

if not "%allArgs:memory:status=%"=="%allArgs%" (
  if defined FAKE_EXPECT_OWNER_BEFORE_STATUS (
    node -e "const fs=require('node:fs');process.exit(fs.existsSync(process.argv[1])&&fs.readFileSync(process.argv[1],'utf8').includes(process.argv[2])?0:91)" "%REPO_UNDER_TEST%\.command-centre\local-memory-user.json" "%FAKE_EXPECT_OWNER_BEFORE_STATUS%"
    if errorlevel 1 exit /b 91
  )
  if "%FAKE_MEMORY_COMPATIBLE%"=="0" if not exist "%REPO_UNDER_TEST%\.fake-memory-reindexed" (
    echo {"storeReady":true,"embedDim":384,"expectedEmbeddingModel":"bge-m3","expectedEmbeddingDim":1024,"embeddingCompatible":false,"embeddingModels":[{"model":"hash-v1-384","dim":384,"chunks":1}]}
    exit /b 0
  )
  echo {"storeReady":true,"embedDim":1024,"expectedEmbeddingModel":"bge-m3","expectedEmbeddingDim":1024,"embeddingCompatible":true,"embeddingModels":[{"model":"bge-m3","dim":1024,"chunks":1}]}
  exit /b 0
)

if not "%allArgs:memory:reindex=%"=="%allArgs%" (
  if "%FAKE_MEMORY_COMPATIBLE_AFTER_REINDEX%"=="1" (
    if not exist "%REPO_UNDER_TEST%\.command-centre\memory" mkdir "%REPO_UNDER_TEST%\.command-centre\memory"
    type nul > "%REPO_UNDER_TEST%\.fake-memory-reindexed"
  )
)

if "%allArgs:memory:capture=%"=="%allArgs%" exit /b 0

set "client="
:parse_capture
if "%~1"=="" goto capture_parsed
if /I "%~1"=="--client" set "client=%~2"
shift
goto parse_capture

:capture_parsed
if not defined FAKE_MEMORY_CAPTURE_FAIL_CLIENTS exit /b 0
for %%C in (%FAKE_MEMORY_CAPTURE_FAIL_CLIENTS%) do (
  if /I "!client!"=="%%C" exit /b 1
)
exit /b 0
'@ | Set-Content -LiteralPath $npmPath -Encoding ASCII
        return
    }

    $npmPath = Join-Path $FakeBin "npm"
    @'
#!/bin/sh
printf 'npm MEMORY_STORE_BACKEND=%s %s\n' "${MEMORY_STORE_BACKEND:-}" "$*" >> "$ACTION_LOG"
all_args="$*"

case "$all_args" in
  *memory:status*)
    if [ -n "${FAKE_EXPECT_OWNER_BEFORE_STATUS:-}" ]; then
      identity_file="$REPO_UNDER_TEST/.command-centre/local-memory-user.json"
      node -e 'const fs=require("node:fs");process.exit(fs.existsSync(process.argv[1])&&fs.readFileSync(process.argv[1],"utf8").includes(process.argv[2])?0:91)' \
        "$identity_file" "$FAKE_EXPECT_OWNER_BEFORE_STATUS" || exit 91
    fi
    if [ "${FAKE_MEMORY_COMPATIBLE:-1}" = "0" ] && [ ! -f "${REPO_UNDER_TEST:-}/.fake-memory-reindexed" ]; then
      printf '%s\n' '{"storeReady":true,"embedDim":384,"expectedEmbeddingModel":"bge-m3","expectedEmbeddingDim":1024,"embeddingCompatible":false,"embeddingModels":[{"model":"hash-v1-384","dim":384,"chunks":1}]}'
      exit 0
    fi
    printf '%s\n' '{"storeReady":true,"embedDim":1024,"expectedEmbeddingModel":"bge-m3","expectedEmbeddingDim":1024,"embeddingCompatible":true,"embeddingModels":[{"model":"bge-m3","dim":1024,"chunks":1}]}'
    exit 0
    ;;
esac

case "$all_args" in
  *memory:reindex*)
    [ -f "$REPO_UNDER_TEST/.fake-reindex-fail" ] && exit 1
    [ "${FAKE_MEMORY_REINDEX_FAIL:-0}" = "1" ] && exit 1
    if [ "${FAKE_MEMORY_COMPATIBLE_AFTER_REINDEX:-0}" = "1" ]; then
      node -e 'const fs = require("node:fs"); fs.mkdirSync(process.argv[1], { recursive: true }); fs.writeFileSync(process.argv[2], "");' \
        "$REPO_UNDER_TEST/.command-centre/memory" \
        "$REPO_UNDER_TEST/.fake-memory-reindexed"
    fi
    ;;
esac

case "$all_args" in
  *memory:capture*) ;;
  *) exit 0 ;;
esac

client=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "--client" ]; then
    client="$argument"
    break
  fi
  previous="$argument"
done

for failed_client in ${FAKE_MEMORY_CAPTURE_FAIL_CLIENTS:-}; do
  [ "$client" = "$failed_client" ] && exit 1
done
exit 0
'@ | Set-Content -LiteralPath $npmPath -Encoding UTF8NoBOM
    & chmod +x $npmPath
    if ($LASTEXITCODE -ne 0) {
        throw "Could not make the fake npm executable."
    }
}

function New-TestFixture {
    param(
        [string]$Name,
        [string[]]$Clients = @()
    )

    $repo = Join-Path $TestRoot $Name
    $scripts = Join-Path $repo "scripts"
    $commandCentre = Join-Path $repo "command-centre"
    $nodeModules = Join-Path $commandCentre "node_modules"
    $contextMemory = Join-Path $repo "context\memory"
    $fakeBin = Join-Path $repo "fake-bin"
    $testHome = Join-Path $repo "home"

    $commandCentreScripts = Join-Path $commandCentre "scripts"
    $memoryLib = Join-Path $commandCentre "src\lib\memory"
    New-Item -ItemType Directory -Force -Path $scripts, $commandCentreScripts, $memoryLib, $nodeModules, $contextMemory, $fakeBin, $testHome | Out-Null
    Copy-Item -LiteralPath $SetupScript -Destination (Join-Path $scripts "setup-memory.ps1")
    Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $ScriptDir) "command-centre\scripts\local-memory-identity.cjs") `
        -Destination (Join-Path $commandCentreScripts "local-memory-identity.cjs")
    Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $ScriptDir) "command-centre\src\lib\memory\local-identity.cjs") `
        -Destination (Join-Path $memoryLib "local-identity.cjs")

    '{"scripts":{}}' | Set-Content -LiteralPath (Join-Path $commandCentre "package.json") -Encoding UTF8
    '{"lockfileVersion":3,"packages":{"":{"dependencies":{}}}}' |
        Set-Content -LiteralPath (Join-Path $commandCentre "package-lock.json") -Encoding UTF8
    '{}' | Set-Content -LiteralPath (Join-Path $nodeModules ".package-lock.json") -Encoding UTF8
    (Get-Item -LiteralPath (Join-Path $commandCentre "package-lock.json")).LastWriteTime = (Get-Date).AddMinutes(-2)
    (Get-Item -Force -LiteralPath (Join-Path $nodeModules ".package-lock.json")).LastWriteTime = (Get-Date).AddMinutes(-1)
    "# Root memory`n" | Set-Content -LiteralPath (Join-Path $contextMemory "2026-07-23.md") -Encoding UTF8
    New-Item -ItemType Directory -Force -Path (Join-Path $repo "context") | Out-Null
    "# Learnings`n" | Set-Content -LiteralPath (Join-Path $repo "context\learnings.md") -Encoding UTF8

    foreach ($slug in $Clients) {
        $clientDir = Join-Path $repo "clients\$slug"
        New-Item -ItemType Directory -Force -Path (Join-Path $clientDir ".claude"), (Join-Path $clientDir "context\memory") | Out-Null
        "# $slug memory`n" |
            Set-Content -LiteralPath (Join-Path $clientDir "context\memory\2026-07-23.md") -Encoding UTF8
    }

    New-FakeNpm -FakeBin $fakeBin

    return [pscustomobject]@{
        Repo = $repo
        SetupScript = Join-Path $scripts "setup-memory.ps1"
        FakeBin = $fakeBin
        Home = $testHome
        Log = Join-Path $repo "actions.log"
    }
}

function Invoke-TestFixture {
    param(
        [pscustomobject]$Fixture,
        [ValidateSet("local", "postgres")]
        [string]$Backend = "local",
        [string]$CaptureFailures = "",
        [bool]$RootReindexFails = $false,
        [bool]$OldDimension = $false,
        [string]$ExpectedOwnerBeforeStatus = ""
    )

    if (Test-Path -LiteralPath $Fixture.Log) {
        Remove-Item -LiteralPath $Fixture.Log -Force
    }
    $failureMarker = Join-Path $Fixture.Repo ".fake-reindex-fail"
    if ($RootReindexFails) {
        New-Item -ItemType File -Force -Path $failureMarker | Out-Null
    }
    elseif (Test-Path -LiteralPath $failureMarker) {
        Remove-Item -LiteralPath $failureMarker -Force
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $PowerShellExecutable
    $startInfo.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$($Fixture.SetupScript)`" -Backend $Backend -Yes"
    $startInfo.WorkingDirectory = $Fixture.Repo
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    $fixturePath = $Fixture.FakeBin + [System.IO.Path]::PathSeparator + $NodeDirectory
    $startInfo.EnvironmentVariables["PATH"] = $fixturePath
    $startInfo.EnvironmentVariables["Path"] = $fixturePath
    $startInfo.EnvironmentVariables["HOME"] = $Fixture.Home
    $startInfo.EnvironmentVariables["USERPROFILE"] = $Fixture.Home
    $startInfo.EnvironmentVariables["ACTION_LOG"] = $Fixture.Log
    $startInfo.EnvironmentVariables["FAKE_MEMORY_CAPTURE_FAIL_CLIENTS"] = $CaptureFailures
    $startInfo.EnvironmentVariables["FAKE_MEMORY_REINDEX_FAIL"] = if ($RootReindexFails) { "1" } else { "0" }
    $startInfo.EnvironmentVariables["FAKE_MEMORY_COMPATIBLE"] = if ($OldDimension) { "0" } else { "1" }
    $startInfo.EnvironmentVariables["FAKE_MEMORY_COMPATIBLE_AFTER_REINDEX"] = if ($OldDimension) { "1" } else { "0" }
    $startInfo.EnvironmentVariables["FAKE_EXPECT_OWNER_BEFORE_STATUS"] = $ExpectedOwnerBeforeStatus
    $startInfo.EnvironmentVariables["REPO_UNDER_TEST"] = $Fixture.Repo
    $startInfo.EnvironmentVariables.Remove("DATABASE_URL")

    if ($Backend -eq "postgres") {
        $startInfo.EnvironmentVariables["MEMORY_DATABASE_URL"] = "postgres://user:pass@example.test:5432/memory"
    }
    else {
        $startInfo.EnvironmentVariables.Remove("MEMORY_DATABASE_URL")
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    Assert-True -Condition $process.Start() -Message "Could not start setup-memory.ps1."
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(30000)) {
        $process.Kill()
        throw "[FAIL] setup-memory.ps1 did not finish within 30 seconds."
    }
    $output = $stdout.Result + $stderr.Result
    $log = if (Test-Path -LiteralPath $Fixture.Log) {
        Get-Content -LiteralPath $Fixture.Log -Raw
    }
    else {
        ""
    }

    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Output = $output
        Log = $log
    }
}

function Assert-ClientCaptureArgs {
    param(
        [pscustomobject]$Fixture,
        [string]$Log,
        [string]$Slug
    )

    $clientDir = Join-Path $Fixture.Repo "clients\$Slug"
    $line = @($Log -split "\r?\n" | Where-Object { $_.Contains("memory:capture") -and $_.Contains("--client $Slug") })
    Assert-True -Condition ($line.Count -eq 1) -Message "Expected exactly one memory:capture call for client '$Slug'.`n--- log ---`n$Log"
    Assert-Contains -Value $line[0] -Expected "--visibility client --client $Slug" -Message "Client '$Slug' should use client visibility."

    $plainArgs = "--cwd $clientDir --workspace $clientDir --visibility client"
    $quotedArgs = "--cwd `"$clientDir`" --workspace `"$clientDir`" --visibility client"
    Assert-True -Condition ($line[0].Contains($plainArgs) -or $line[0].Contains($quotedArgs)) `
        -Message "Client '$Slug' should pass the same client directory to --cwd and --workspace.`n--- call ---`n$($line[0])"
}

function Test-ClientArgumentsAndSuccess {
    $fixture = New-TestFixture -Name "client-success" -Clients @("acme", "beta")
    $result = Invoke-TestFixture -Fixture $fixture

    Assert-True -Condition ($result.ExitCode -eq 0) -Message "Successful client setup should exit 0.`n$($result.Output)"
    Assert-ClientCaptureArgs -Fixture $fixture -Log $result.Log -Slug "acme"
    Assert-ClientCaptureArgs -Fixture $fixture -Log $result.Log -Slug "beta"
    Assert-Contains -Value $result.Output -Expected "Memory migration/setup complete" -Message "Successful setup should announce completion."
}

function Test-ClientFailuresAreAccumulated {
    $fixture = New-TestFixture -Name "client-failures" -Clients @("acme", "beta", "charlie")
    $result = Invoke-TestFixture -Fixture $fixture -CaptureFailures "acme beta"

    Assert-True -Condition ($result.ExitCode -eq 1) -Message "Any client failure should make setup exit 1.`n$($result.Output)"
    Assert-ClientCaptureArgs -Fixture $fixture -Log $result.Log -Slug "acme"
    Assert-ClientCaptureArgs -Fixture $fixture -Log $result.Log -Slug "beta"
    Assert-ClientCaptureArgs -Fixture $fixture -Log $result.Log -Slug "charlie"
    Assert-Contains -Value $result.Output -Expected "Client memory reindex failed for: acme, beta." `
        -Message "Setup should list every failed client."
    Assert-Contains -Value $result.Output -Expected "memory migration/setup step(s) need attention" `
        -Message "Setup should report an overall failure."
    Assert-NotContains -Value $result.Output -Unexpected "Memory migration/setup complete" `
        -Message "Failed setup must not announce completion."
}

function Test-HostedRootFailureIsPropagated {
    $fixture = New-TestFixture -Name "hosted-root-failure" -Clients @("acme")
    $result = Invoke-TestFixture -Fixture $fixture -Backend "postgres" -RootReindexFails $true

    Assert-True -Condition ($result.ExitCode -eq 1) -Message "Hosted root reindex failure should make setup exit 1.`n$($result.Output)`n--- log ---`n$($result.Log)"
    Assert-Contains -Value $result.Log -Expected "memory:reindex -- --visibility system --force" `
        -Message "Hosted setup should run the explicit system reindex."
    Assert-NotContains -Value $result.Log -Unexpected "memory:capture" `
        -Message "Client capture should not run after the hosted root reindex fails."
    Assert-NotContains -Value $result.Output -Unexpected "Memory migration/setup complete" `
        -Message "Hosted root failure must not announce completion."
}

function Test-LocalRebuildPreservesLegacyOwner {
    $fixture = New-TestFixture -Name "local-owner-success"
    $memoryDir = Join-Path $fixture.Repo ".command-centre\memory"
    $legacyIdentity = Join-Path $memoryDir "local-user.json"
    $expectedOwner = "local-powershell-owner-success"
    New-Item -ItemType Directory -Force -Path $memoryDir | Out-Null
    (@{ version = 1; userId = $expectedOwner } | ConvertTo-Json -Compress) |
        Set-Content -LiteralPath $legacyIdentity -Encoding UTF8

    $result = Invoke-TestFixture -Fixture $fixture -OldDimension $true `
        -ExpectedOwnerBeforeStatus $expectedOwner
    Assert-True -Condition ($result.ExitCode -eq 0) -Message "Old-dimension local rebuild should succeed.`n$($result.Output)"
    $canonical = Get-Content -LiteralPath (Join-Path $fixture.Repo ".command-centre\local-memory-user.json") -Raw |
        ConvertFrom-Json
    Assert-True -Condition ($canonical.userId -eq $expectedOwner) `
        -Message "PowerShell setup must preserve the legacy private owner."
    $legacyDirs = @(Get-ChildItem -LiteralPath (Join-Path $fixture.Repo ".command-centre") -Directory -Filter "memory-legacy-384-*")
    Assert-True -Condition ($legacyDirs.Count -eq 0) -Message "Successful rebuild should remove the old 384-dim store."
}

function Test-LocalRebuildFailureRestoresLegacyOwner {
    $fixture = New-TestFixture -Name "local-owner-failure"
    $memoryDir = Join-Path $fixture.Repo ".command-centre\memory"
    $legacyIdentity = Join-Path $memoryDir "local-user.json"
    $expectedOwner = "local-powershell-owner-failure"
    New-Item -ItemType Directory -Force -Path $memoryDir | Out-Null
    (@{ version = 1; userId = $expectedOwner } | ConvertTo-Json -Compress) |
        Set-Content -LiteralPath $legacyIdentity -Encoding UTF8

    $result = Invoke-TestFixture -Fixture $fixture -OldDimension $true -RootReindexFails $true
    Assert-True -Condition ($result.ExitCode -eq 1) -Message "Failed old-dimension rebuild should exit 1.`n$($result.Output)"
    $canonical = Get-Content -LiteralPath (Join-Path $fixture.Repo ".command-centre\local-memory-user.json") -Raw |
        ConvertFrom-Json
    $restored = Get-Content -LiteralPath $legacyIdentity -Raw | ConvertFrom-Json
    Assert-True -Condition ($canonical.userId -eq $expectedOwner -and $restored.userId -eq $expectedOwner) `
        -Message "PowerShell setup failure must restore the store without changing its owner."
    $legacyDirs = @(Get-ChildItem -LiteralPath (Join-Path $fixture.Repo ".command-centre") -Directory -Filter "memory-legacy-384-*")
    Assert-True -Condition ($legacyDirs.Count -eq 0) -Message "Failed rebuild should move the old store back from quarantine."
}

try {
    New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
    Test-ClientArgumentsAndSuccess
    Test-ClientFailuresAreAccumulated
    Test-HostedRootFailureIsPropagated
    Test-LocalRebuildPreservesLegacyOwner
    Test-LocalRebuildFailureRestoresLegacyOwner
    Write-Host "[PASS] PowerShell memory setup runtime tests"
}
finally {
    if (Test-Path -LiteralPath $TestRoot) {
        Remove-Item -LiteralPath $TestRoot -Recurse -Force
    }
}
