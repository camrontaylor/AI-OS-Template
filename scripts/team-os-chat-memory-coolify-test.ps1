param(
  [string]$RunId = $env:TEAM_OS_TEST_RUN_ID,
  [string]$ApiUrl = $env:TEAM_OS_CHAT_TEST_API_URL,
  [ValidateSet("install", "copy", "junction")]
  [string]$DependencyMode = "install",
  [switch]$SkipLogin,
  [switch]$StartCommandCentres
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Require-Value {
  param(
    [string]$Name,
    [string]$Value,
    [string]$EnvName
  )
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Name is required. Pass -$Name or set $EnvName."
  }
}

if ([string]::IsNullOrWhiteSpace($RunId)) {
  $RunId = "teamtest-" + (Get-Date -Format "yyyyMMdd-HHmmss")
}

Require-Value -Name "ApiUrl" -Value $ApiUrl -EnvName "TEAM_OS_CHAT_TEST_API_URL"

$repoScript = Join-Path $PSScriptRoot "team-os-chat-memory-test.ps1"
$scriptArgs = @{
  RunId = $RunId
  ApiUrl = $ApiUrl
  SkipDocker = $true
  HostedApiCapture = $true
  SkipMigrate = $true
  SkipBootstrap = $true
  DependencyMode = $DependencyMode
}

if ($SkipLogin) { $scriptArgs.SkipLogin = $true }
if ($StartCommandCentres) { $scriptArgs.StartCommandCentres = $true }

Write-Host "Starting Team OS chat memory Coolify setup..."
Write-Host "Postgres: private inside the Coolify test stack"
Write-Host "API URL: $ApiUrl"
Write-Host "Run ID: $RunId"
Write-Host "Dependency mode: $DependencyMode"

& $repoScript @scriptArgs
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
