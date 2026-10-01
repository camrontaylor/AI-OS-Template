$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir "lib\gsd-migration.ps1")

$TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("AI-OS-gsd-ps-" + [guid]::NewGuid().ToString("N"))
$FakeBin = Join-Path $TestRoot "bin"
$FakeLog = Join-Path $TestRoot "tool.log"
$OriginalPath = $env:PATH
$OriginalHome = $HOME

New-Item -ItemType Directory -Force -Path $FakeBin | Out-Null
Set-Content -LiteralPath $FakeLog -Value ""

Set-Content -LiteralPath (Join-Path $FakeBin "npm.cmd") -Encoding ASCII -Value @'
@echo off
echo npm %*>>"%FAKE_NPM_LOG%"
if "%1"=="ls" (
  if "%2"=="-g" (
    if "%FAKE_NPM_GLOBAL_LEGACY%"=="1" (
      echo {"dependencies":{"get-shit-done-cc":{"version":"1.0.0"},"@gsd-build/sdk":{"version":"1.0.0"}}}
    ) else (
      echo {"dependencies":{}}
    )
  ) else (
    if "%FAKE_NPM_LOCAL_LEGACY%"=="1" (
      echo {"dependencies":{"get-shit-done-redux":{"version":"1.0.0"},"@gsd-redux/sdk":{"version":"1.0.0"}}}
    ) else (
      echo {"dependencies":{}}
    )
  )
  exit /b 0
)
if "%1"=="uninstall" exit /b 0
exit /b 0
'@

Set-Content -LiteralPath (Join-Path $FakeBin "npx.cmd") -Encoding ASCII -Value @'
@echo off
echo npx %*>>"%FAKE_NPM_LOG%"
exit /b 0
'@

Set-Content -LiteralPath (Join-Path $FakeBin "node.cmd") -Encoding ASCII -Value @'
@echo off
exit /b 0
'@

$env:PATH = "$FakeBin;$env:PATH"
$env:FAKE_NPM_LOG = $FakeLog

function Fail-Test {
    param([string]$Message)
    throw "FAIL: $Message"
}

function Assert-Exists {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        Fail-Test "Expected path to exist: $Path"
    }
}

function Assert-NotExists {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path) {
        Fail-Test "Expected path to be removed: $Path"
    }
}

function Assert-LogContains {
    param([string]$Text)
    if (-not ((Get-Content -Raw -LiteralPath $FakeLog).Contains($Text))) {
        Fail-Test "Expected log to contain: $Text"
    }
}

function Assert-LogNotContains {
    param([string]$Text)
    if ((Get-Content -Raw -LiteralPath $FakeLog).Contains($Text)) {
        Fail-Test "Expected log not to contain: $Text"
    }
}

function Reset-Case {
    Set-Content -LiteralPath $FakeLog -Value ""
    Remove-Item Env:\FAKE_NPM_GLOBAL_LEGACY -ErrorAction SilentlyContinue
    Remove-Item Env:\FAKE_NPM_LOCAL_LEGACY -ErrorAction SilentlyContinue
    Remove-Item Env:\AI_OS_GSD_MIGRATE -ErrorAction SilentlyContinue
    Remove-Item Env:\CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue
}

function New-TestWorkspace {
    param([string]$Name)

    $base = Join-Path $TestRoot $Name
    New-Item -ItemType Directory -Force -Path (Join-Path $base "home"), (Join-Path $base "global-claude"), (Join-Path $base "repo") | Out-Null
    return $base
}

try {
    Reset-Case
    $base = New-TestWorkspace "fresh-no-legacy"
    $repo = Join-Path $base "repo"
    Set-Variable -Name HOME -Value (Join-Path $base "home") -Scope Global -Force
    $env:CLAUDE_CONFIG_DIR = Join-Path $base "global-claude"
    $findings = @(Find-AiOsLegacyGsd -RepoRoot $repo)
    if ($findings.Count -ne 0) {
        Fail-Test "Expected no legacy findings"
    }
    if (-not (Install-AiOsGsdRedux)) {
        Fail-Test "Expected fake npx install to succeed"
    }
    Assert-LogContains "npx -y @opengsd/get-shit-done-redux@latest --global --claude"

    Reset-Case
    $base = New-TestWorkspace "approve-cleanup"
    $repo = Join-Path $base "repo"
    $global = Join-Path $base "global-claude"
    Set-Variable -Name HOME -Value (Join-Path $base "home") -Scope Global -Force
    $env:CLAUDE_CONFIG_DIR = $global
    $env:FAKE_NPM_GLOBAL_LEGACY = "1"
    $env:FAKE_NPM_LOCAL_LEGACY = "1"
    $env:AI_OS_GSD_MIGRATE = "1"

    New-Item -ItemType Directory -Force -Path `
        (Join-Path $global "commands\gsd"), `
        (Join-Path $global "get-shit-done"), `
        (Join-Path $global "agents"), `
        (Join-Path $repo ".claude\commands"), `
        (Join-Path $repo ".planning"), `
        (Join-Path $repo "projects\briefs\demo\.planning") | Out-Null
    Set-Content -LiteralPath (Join-Path $repo "package.json") -Value "{}"
    Set-Content -LiteralPath (Join-Path $global "agents\gsd-review.md") -Value ""
    Set-Content -LiteralPath (Join-Path $repo ".claude\commands\gsd-help.md") -Value ""
    Set-Content -LiteralPath (Join-Path $repo ".planning\STATE.md") -Value ""
    Set-Content -LiteralPath (Join-Path $repo "projects\briefs\demo\.planning\STATE.md") -Value ""

    $result = Invoke-AiOsGsdMigration -RepoRoot $repo
    if ($result -ne "cleaned") {
        Fail-Test "Expected migration result to be cleaned"
    }
    Assert-NotExists (Join-Path $global "commands\gsd")
    Assert-NotExists (Join-Path $global "get-shit-done")
    Assert-NotExists (Join-Path $global "agents\gsd-review.md")
    Assert-NotExists (Join-Path $repo ".claude\commands\gsd-help.md")
    Assert-Exists (Join-Path $repo ".planning\STATE.md")
    Assert-Exists (Join-Path $repo "projects\briefs\demo\.planning\STATE.md")
    Assert-LogContains "npm uninstall -g get-shit-done-cc"
    Assert-LogContains "npm uninstall -g @gsd-build/sdk"
    Assert-LogContains "npm uninstall get-shit-done-redux"
    Assert-LogContains "npm uninstall @gsd-redux/sdk"

    Reset-Case
    $base = New-TestWorkspace "decline-cleanup"
    $repo = Join-Path $base "repo"
    $global = Join-Path $base "global-claude"
    Set-Variable -Name HOME -Value (Join-Path $base "home") -Scope Global -Force
    $env:CLAUDE_CONFIG_DIR = $global
    $env:AI_OS_GSD_MIGRATE = "0"
    New-Item -ItemType Directory -Force -Path (Join-Path $global "commands\gsd"), (Join-Path $repo ".planning") | Out-Null
    Set-Content -LiteralPath (Join-Path $repo ".planning\STATE.md") -Value ""

    $result = Invoke-AiOsGsdMigration -RepoRoot $repo
    if ($result -ne "declined") {
        Fail-Test "Expected migration result to be declined"
    }
    Assert-Exists (Join-Path $global "commands\gsd")
    Assert-Exists (Join-Path $repo ".planning\STATE.md")
    Assert-LogNotContains "npx -y @opengsd/get-shit-done-redux@latest --global --claude"

    # Redux install must not be flagged as legacy (mirrors the bash regression test).
    Reset-Case
    $base = New-TestWorkspace "redux-not-legacy"
    $repo = Join-Path $base "repo"
    $global = Join-Path $base "global-claude"
    Set-Variable -Name HOME -Value (Join-Path $base "home") -Scope Global -Force
    $env:CLAUDE_CONFIG_DIR = $global
    New-Item -ItemType Directory -Force -Path (Join-Path $global "get-shit-done"), (Join-Path $global "agents") | Out-Null
    Set-Content -LiteralPath (Join-Path $global "get-shit-done\VERSION") -Value "1.1.0"
    Set-Content -LiteralPath (Join-Path $global "agents\gsd-review.md") -Value ""

    $findings = @(Find-AiOsLegacyGsd -RepoRoot $repo)
    if ($findings.Count -ne 0) {
        Fail-Test "Expected no legacy findings for a Redux install, got: $($findings.Path -join ', ')"
    }

    # Get-AiOsGsdReduxVersion reports the installed version, $null when absent.
    if ((Get-AiOsGsdReduxVersion -RepoRoot $repo) -ne "1.1.0") {
        Fail-Test "Expected redux version 1.1.0"
    }

    Reset-Case
    $base = New-TestWorkspace "no-redux-version"
    $repo = Join-Path $base "repo"
    Set-Variable -Name HOME -Value (Join-Path $base "home") -Scope Global -Force
    $env:CLAUDE_CONFIG_DIR = Join-Path $base "global-claude"
    if ($null -ne (Get-AiOsGsdReduxVersion -RepoRoot $repo)) {
        Fail-Test "Expected no redux version when no runtime is present"
    }

    Write-Host "PowerShell GSD migration helper tests passed."
}
finally {
    Set-Variable -Name HOME -Value $OriginalHome -Scope Global -Force
    $env:PATH = $OriginalPath
    Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
}
