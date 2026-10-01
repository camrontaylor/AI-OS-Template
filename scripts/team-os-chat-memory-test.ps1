param(
  [string]$RunId = ("teamtest-" + (Get-Date -Format "yyyyMMdd-HHmmss")),
  [string]$MemoryDatabaseUrl = $env:MEMORY_DATABASE_URL,
  [string]$ApiUrl = "http://127.0.0.1:8787",
  [int]$ApiPort = 8787,
  [switch]$SkipDocker,
  [switch]$SkipMigrate,
  [switch]$SkipBootstrap,
  [switch]$SkipLogin,
  [switch]$StartApi,
  [switch]$StartCommandCentres,
  [switch]$HostedApiCapture,
  [ValidateSet("install", "copy", "junction")]
  [string]$DependencyMode = "install"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Quote-Pwsh {
  param([string]$Value)
  return "'" + ($Value -replace "'", "''") + "'"
}

function Quote-ProcessArgument {
  param([string]$Value)
  return '"' + ($Value -replace '"', '\"') + '"'
}

function Assert-SafeRunId {
  param([string]$Value)
  if ($Value -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]*$') {
    throw "RunId must contain only letters, numbers, dots, underscores, or hyphens."
  }
}

function Set-EnvMap {
  param([hashtable]$Env)
  $previous = @{}
  foreach ($key in $Env.Keys) {
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
    [Environment]::SetEnvironmentVariable($key, [string]$Env[$key], "Process")
  }
  return $previous
}

function Restore-EnvMap {
  param([hashtable]$Previous)
  foreach ($key in $Previous.Keys) {
    [Environment]::SetEnvironmentVariable($key, $Previous[$key], "Process")
  }
}

function Invoke-Npm {
  param(
    [string[]]$Arguments,
    [hashtable]$Env = @{}
  )
  $previous = Set-EnvMap $Env
  try {
    Push-Location $CommandCentreDir
    try {
      & npm @Arguments
      if ($LASTEXITCODE -ne 0) {
        throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
      }
    } finally {
      Pop-Location
    }
  } finally {
    Restore-EnvMap $previous
  }
}

function Invoke-NpmCapture {
  param(
    [string[]]$Arguments,
    [hashtable]$Env = @{}
  )
  $previous = Set-EnvMap $Env
  try {
    Push-Location $CommandCentreDir
    try {
      $output = & npm @Arguments 2>&1
      $code = $LASTEXITCODE
      $output | ForEach-Object { Write-Host $_ }
      if ($code -ne 0) {
        throw "npm $($Arguments -join ' ') failed with exit code $code"
      }
      return ($output | ForEach-Object { $_.ToString() }) -join "`n"
    } finally {
      Pop-Location
    }
  } finally {
    Restore-EnvMap $previous
  }
}

function Invoke-NpmInDirectory {
  param(
    [string]$WorkingDirectory,
    [string[]]$Arguments,
    [hashtable]$Env = @{}
  )
  $previous = Set-EnvMap $Env
  try {
    Push-Location $WorkingDirectory
    try {
      & npm @Arguments | ForEach-Object { Write-Host $_ }
      $code = $LASTEXITCODE
      if ($code -ne 0) {
        throw "npm $($Arguments -join ' ') failed with exit code $code in $WorkingDirectory"
      }
    } finally {
      Pop-Location
    }
  } finally {
    Restore-EnvMap $previous
  }
}

function Get-InviteToken {
  param([string]$Output)
  $match = [regex]::Match($Output, 'token\s*:\s*(\S+)')
  if (-not $match.Success) {
    throw "Could not find invite token in team:invite output."
  }
  return $match.Groups[1].Value
}

function Write-Utf8File {
  param(
    [string]$Path,
    [string]$Content
  )
  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  Set-Content -Path $Path -Value $Content -Encoding UTF8
}

function Ensure-Directory {
  param([string]$Path)
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Ensure-Junction {
  param(
    [string]$Path,
    [string]$Target
  )
  $resolvedTarget = (Resolve-Path $Target).Path
  if (Test-Path -LiteralPath $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    $isReparsePoint = (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
    $currentTarget = $null
    if ($item.PSObject.Properties.Name -contains "Target") {
      $currentTarget = $item.Target
      if ($currentTarget -is [array]) {
        $currentTarget = $currentTarget[0]
      }
    }
    if ($isReparsePoint -and $currentTarget) {
      $resolvedCurrent = (Resolve-Path $currentTarget).Path
      if ($resolvedCurrent -eq $resolvedTarget) {
        return
      }
    }
    throw "Path already exists and is not the expected junction: $Path"
  }
  New-Item -ItemType Junction -Path $Path -Target $resolvedTarget | Out-Null
}

function Assert-PathUnder {
  param(
    [string]$Path,
    [string]$Root
  )
  $fullPath = [IO.Path]::GetFullPath($Path)
  $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $rootPrefix = $fullRoot + [IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside the test instance root: $Path"
  }
}

function Remove-GeneratedPath {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  Assert-PathUnder -Path $Path -Root $RunRoot
  $item = Get-Item -LiteralPath $Path -Force
  $isReparsePoint = (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
  if ($isReparsePoint) {
    if ($item.PSIsContainer) {
      [IO.Directory]::Delete($Path, $false)
    } else {
      [IO.File]::Delete($Path)
    }
    return
  }
  Remove-Item -LiteralPath $Path -Recurse -Force
}

function Remove-JunctionPath {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }
  $item = Get-Item -LiteralPath $Path -Force
  $isReparsePoint = (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
  if (-not $isReparsePoint) {
    return $false
  }
  Assert-PathUnder -Path $Path -Root $RunRoot
  if ($item.PSIsContainer) {
    [IO.Directory]::Delete($Path, $false)
  } else {
    [IO.File]::Delete($Path)
  }
  return $true
}

function Copy-DirectoryFiltered {
  param(
    [string]$Source,
    [string]$Destination
  )
  $excluded = @(
    ".AI-OS",
    ".command-centre",
    ".env",
    ".env.local",
    ".git",
    ".memsearch",
    ".next",
    "backups",
    "coverage",
    "dist",
    "node_modules"
  )
  Ensure-Directory $Destination
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    if ($excluded -contains $_.Name) {
      return
    }
    $target = Join-Path $Destination $_.Name
    if ($_.PSIsContainer) {
      Copy-DirectoryFiltered -Source $_.FullName -Destination $target
    } else {
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
  }
}

function Ensure-CommandCentreCopy {
  param(
    [string]$InstanceDir,
    [string]$UserKey = ""
  )
  $target = Join-Path $InstanceDir "command-centre"
  if (Test-Path -LiteralPath $target) {
    $item = Get-Item -LiteralPath $target -Force
    if ((($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
      throw "Path already exists as a junction. Use a fresh RunId or remove this ignored test folder: $target"
    }
  }
  Remove-GeneratedPath (Join-Path $target ".next")
  Remove-GeneratedPath (Join-Path $target "dist")
  Copy-DirectoryFiltered -Source $CommandCentreDir -Destination $target
  $sourceNodeModules = Join-Path $CommandCentreDir "node_modules"
  $targetNodeModules = Join-Path $target "node_modules"
  if ($DependencyMode -eq "junction") {
    if (Test-Path -LiteralPath $sourceNodeModules) {
      Ensure-Junction $targetNodeModules $sourceNodeModules
    }
  } elseif ($DependencyMode -eq "copy") {
    Remove-JunctionPath $targetNodeModules | Out-Null
    if (Test-Path -LiteralPath $targetNodeModules) {
      Remove-GeneratedPath $targetNodeModules
    }
    if (-not (Test-Path -LiteralPath $sourceNodeModules)) {
      throw "Source node_modules was not found at $sourceNodeModules. Run npm ci in command-centre first or use -DependencyMode install."
    }
    Copy-Item -LiteralPath $sourceNodeModules -Destination $targetNodeModules -Recurse -Force
  } else {
    if (Remove-JunctionPath $targetNodeModules) {
      Write-Host "Removed shared node_modules junction for $UserKey."
    }
    Write-Host "Installing Command Centre dependencies for $UserKey..."
    Invoke-NpmInDirectory -WorkingDirectory $target -Arguments @("ci", "--no-audit", "--no-fund")
  }
  return $target
}

function Test-ApiHealth {
  param([string]$Url)
  try {
    Invoke-RestMethod -Method Get -Uri "$Url/v1/health" -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Wait-ApiHealth {
  param(
    [string]$Url,
    [int]$Seconds = 40
  )
  for ($i = 0; $i -lt $Seconds; $i += 1) {
    if (Test-ApiHealth $Url) {
      return $true
    }
    Start-Sleep -Seconds 1
  }
  return $false
}

function New-LaunchScript {
  param(
    [hashtable]$User,
    [string]$Name,
    [string]$Visibility = "",
    [string]$ClientId = "",
    [switch]$AllowSystem
  )
  $path = Join-Path $RunRoot "start-$Name.ps1"
  $lines = @(
    '$ErrorActionPreference = "Stop"',
    ("`$env:AI_OS_DIR = " + (Quote-Pwsh $User.InstanceDir)),
    ("`$env:AI_OS_TEAM_CONFIG_DIR = " + (Quote-Pwsh $User.ConfigDir)),
    '$env:MEMORY_EMBEDDER = "bge-m3"',
    ("`$env:MEMORY_API_URL = " + (Quote-Pwsh $ApiUrl)),
    'Remove-Item Env:\MEMORY_CAPTURE_VISIBILITY -ErrorAction SilentlyContinue',
    'Remove-Item Env:\MEMORY_CAPTURE_CLIENT_ID -ErrorAction SilentlyContinue',
    'Remove-Item Env:\MEMORY_CAPTURE_ALLOW_SYSTEM -ErrorAction SilentlyContinue',
    'Remove-Item Env:\MEMORY_CAPTURE_VIA_API -ErrorAction SilentlyContinue'
  )
  if ($HostedApiCapture) {
    $lines += @(
      'Remove-Item Env:\MEMORY_DATABASE_URL -ErrorAction SilentlyContinue',
      'Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue',
      'Remove-Item Env:\MEMORY_STORE_BACKEND -ErrorAction SilentlyContinue',
      '$env:MEMORY_CAPTURE_VIA_API = "1"',
      '$env:TEAM_OS_HOSTED_MODE = "1"'
    )
  } else {
    $lines += @(
      ("`$env:MEMORY_DATABASE_URL = " + (Quote-Pwsh $MemoryDatabaseUrl)),
      '$env:MEMORY_STORE_BACKEND = "postgres"'
    )
  }
  if ($Visibility) {
    $lines += ("`$env:MEMORY_CAPTURE_VISIBILITY = " + (Quote-Pwsh $Visibility))
  }
  if ($ClientId) {
    $lines += ("`$env:MEMORY_CAPTURE_CLIENT_ID = " + (Quote-Pwsh $ClientId))
  }
  if ($AllowSystem) {
    $lines += '$env:MEMORY_CAPTURE_ALLOW_SYSTEM = "1"'
  }
  $lines += @(
    ("Push-Location " + (Quote-Pwsh $User.CommandCentreDir)),
    'try {',
    ("  npm run dev -- -p " + $User.Port),
    '} finally {',
    '  Pop-Location',
    '}'
  )
  Write-Utf8File $path (($lines -join "`r`n") + "`r`n")
  return $path
}

function New-StartProcessScript {
  param(
    [string]$Path,
    [string[]]$ScriptPaths
  )
  $lines = @('$ErrorActionPreference = "Stop"')
  foreach ($scriptPath in $ScriptPaths) {
    $argumentList = "-NoProfile -ExecutionPolicy Bypass -File " + (Quote-ProcessArgument $scriptPath)
    $lines += ("Start-Process -FilePath powershell -ArgumentList " + (Quote-Pwsh $argumentList) + " -WindowStyle Hidden")
  }
  Write-Utf8File $Path (($lines -join "`r`n") + "`r`n")
}

Assert-SafeRunId $RunId

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$CommandCentreDir = Join-Path $RepoRoot "command-centre"
$InstancesBase = Join-Path $RepoRoot ".instances\team-os-test"
$RunRoot = Join-Path $InstancesBase $RunId
$ApiUrl = $ApiUrl.TrimEnd("/")

if ($HostedApiCapture -and -not $MemoryDatabaseUrl) {
  $SkipMigrate = $true
  $SkipBootstrap = $true
}

$TeamASlug = "team-a-$RunId"
$TeamBSlug = "team-b-$RunId"
$ClientA = "acme-a-$RunId"
$ClientB = "acme-b-$RunId"
$ApiDevToken = "team-os-test-dev-$RunId"

$Users = @(
  @{
    Key = "owner-team-a"
    Team = $TeamASlug
    Teams = @($TeamASlug)
    TeamLabel = "Team A"
    Email = "owner-a-$RunId@example.test"
    Name = "Owner Team A $RunId"
    Password = "owner-pass-$RunId"
    Port = 3101
  },
  @{
    Key = "admin-team-a"
    Team = $TeamASlug
    Teams = @($TeamASlug, $TeamBSlug)
    TeamLabel = "Team A"
    Email = "admin-a-$RunId@example.test"
    Name = "Admin Team A $RunId"
    Password = "admin-pass-$RunId"
    Port = 3102
  },
  @{
    Key = "member-team-a"
    Team = $TeamASlug
    Teams = @($TeamASlug)
    TeamLabel = "Team A"
    Email = "member-a-$RunId@example.test"
    Name = "Member Team A $RunId"
    Password = "member-pass-$RunId"
    Port = 3103
  },
  @{
    Key = "admin-team-b"
    Team = $TeamBSlug
    Teams = @($TeamBSlug)
    TeamLabel = "Team B"
    Email = "admin-b-$RunId@example.test"
    Name = "Admin Team B $RunId"
    Password = "admin-b-pass-$RunId"
    Port = 3104
  }
)

$BootstrapOwnerB = @{
  Email = "owner-b-bootstrap-$RunId@example.test"
  Name = "Owner Bootstrap Team B $RunId"
  Password = "owner-b-bootstrap-pass-$RunId"
}

Ensure-Directory $RunRoot

if (-not $MemoryDatabaseUrl) {
  if ($SkipDocker) {
    if ($HostedApiCapture) {
      Write-Warning "No MEMORY_DATABASE_URL provided. Using hosted API capture mode; direct DB migrate/bootstrap are skipped."
    } else {
      throw "MEMORY_DATABASE_URL is required when -SkipDocker is used. Pass -MemoryDatabaseUrl or set the environment variable."
    }
  }
  if (-not $HostedApiCapture) {
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
      throw "Docker was not found. Install/start Docker, or pass -MemoryDatabaseUrl for an existing Postgres with pgvector."
    }
    Write-Step "Starting local Postgres with pgvector by docker compose"
    Push-Location $CommandCentreDir
    try {
      & docker compose up -d
      if ($LASTEXITCODE -ne 0) {
        throw "docker compose up -d failed with exit code $LASTEXITCODE"
      }
    } finally {
      Pop-Location
    }
    $MemoryDatabaseUrl = "postgres://postgres:postgres@localhost:5432/ai_memory"
  }
}

$BaseEnv = @{
  MEMORY_EMBEDDER = "bge-m3"
  AI_OS_DIR = $RunRoot
}
if ($MemoryDatabaseUrl) {
  $BaseEnv.MEMORY_DATABASE_URL = $MemoryDatabaseUrl
  $BaseEnv.MEMORY_STORE_BACKEND = "postgres"
}

if (-not $SkipMigrate) {
  if (-not $MemoryDatabaseUrl) {
    throw "MEMORY_DATABASE_URL is required for migration. Pass -SkipMigrate or use -HostedApiCapture."
  }
  Write-Step "Migrating shared memory database"
  Invoke-Npm -Arguments @("run", "memory:migrate") -Env $BaseEnv
}

Write-Step "Creating local instance folders"
foreach ($user in $Users) {
  $instanceDir = Join-Path $RunRoot $user.Key
  $configDir = Join-Path $RunRoot (".team-config\" + $user.Key)
  $user.InstanceDir = $instanceDir
  $user.ConfigDir = $configDir

  Ensure-Directory $instanceDir
  Ensure-Directory $configDir
  Ensure-Directory (Join-Path $instanceDir "context\memory")
  Ensure-Directory (Join-Path $instanceDir "team_context")
  Ensure-Directory (Join-Path $instanceDir "brand_context")
  Ensure-Directory (Join-Path $instanceDir "clients\$ClientA\context")
  Ensure-Directory (Join-Path $instanceDir "clients\$ClientB\context")
  Ensure-Directory (Join-Path $instanceDir "projects")
  Ensure-Directory (Join-Path $instanceDir "cron")

  Ensure-Junction (Join-Path $instanceDir ".claude") (Join-Path $RepoRoot ".claude")
  $user.CommandCentreDir = Ensure-CommandCentreCopy -InstanceDir $instanceDir -UserKey $user.Key
  Ensure-Junction (Join-Path $instanceDir "scripts") (Join-Path $RepoRoot "scripts")
  Ensure-Junction (Join-Path $instanceDir "docs") (Join-Path $RepoRoot "docs")

  foreach ($fileName in @("AGENTS.md", "CLAUDE.md", "README.md", "PRD.md", ".env.example")) {
    $source = Join-Path $RepoRoot $fileName
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $instanceDir $fileName) -Force
    }
  }

  Write-Utf8File (Join-Path $instanceDir "context\USER.md") @"
# User

Test user for Team OS chat memory run $RunId.

- Email: $($user.Email)
- Role: $($user.Key)
- Team: $($user.TeamLabel)
"@

  Write-Utf8File (Join-Path $instanceDir "context\MEMORY.md") @"
# Memory

## Active Threads
- Running Team OS chat memory tests for $RunId as $($user.Key).

## Environment Notes
- Command Centre port: $($user.Port)
- Team API: $ApiUrl

## Pending Decisions
- None.
"@

  Write-Utf8File (Join-Path $instanceDir "context\learnings.md") "# Learnings`r`n"
}

if (-not $SkipBootstrap) {
  if (-not $MemoryDatabaseUrl) {
    throw "MEMORY_DATABASE_URL is required for bootstrap. Pass -SkipBootstrap or use -HostedApiCapture with a pre-bootstrapped Team API."
  }
  Write-Step "Creating teams, users, clients, and grants"
  Invoke-Npm -Arguments @("run", "team:create", "--", "--slug", $TeamASlug, "--name", "Team A $RunId", "--owner-email", $Users[0].Email, "--owner-name", $Users[0].Name, "--owner-password", $Users[0].Password) -Env $BaseEnv

  $adminInviteOutput = Invoke-NpmCapture -Arguments @("run", "team:invite", "--", "--team", $TeamASlug, "--email", $Users[1].Email, "--by", $Users[0].Email, "--role", "admin") -Env $BaseEnv
  $adminInviteToken = Get-InviteToken $adminInviteOutput
  Invoke-Npm -Arguments @("run", "team:join", "--", "--team", $TeamASlug, "--email", $Users[1].Email, "--token", $adminInviteToken, "--password", $Users[1].Password) -Env $BaseEnv

  $memberInviteOutput = Invoke-NpmCapture -Arguments @("run", "team:invite", "--", "--team", $TeamASlug, "--email", $Users[2].Email, "--by", $Users[0].Email, "--role", "member") -Env $BaseEnv
  $memberInviteToken = Get-InviteToken $memberInviteOutput
  Invoke-Npm -Arguments @("run", "team:join", "--", "--team", $TeamASlug, "--email", $Users[2].Email, "--token", $memberInviteToken, "--password", $Users[2].Password) -Env $BaseEnv

  Invoke-Npm -Arguments @("run", "team:create", "--", "--slug", $TeamBSlug, "--name", "Team B $RunId", "--owner-email", $BootstrapOwnerB.Email, "--owner-name", $BootstrapOwnerB.Name, "--owner-password", $BootstrapOwnerB.Password) -Env $BaseEnv
  $adminBInviteOutput = Invoke-NpmCapture -Arguments @("run", "team:invite", "--", "--team", $TeamBSlug, "--email", $Users[3].Email, "--by", $BootstrapOwnerB.Email, "--role", "admin") -Env $BaseEnv
  $adminBInviteToken = Get-InviteToken $adminBInviteOutput
  Invoke-Npm -Arguments @("run", "team:join", "--", "--team", $TeamBSlug, "--email", $Users[3].Email, "--token", $adminBInviteToken, "--password", $Users[3].Password) -Env $BaseEnv

  $multiTeamInviteOutput = Invoke-NpmCapture -Arguments @("run", "team:invite", "--", "--team", $TeamBSlug, "--email", $Users[1].Email, "--by", $BootstrapOwnerB.Email, "--role", "member") -Env $BaseEnv
  $multiTeamInviteToken = Get-InviteToken $multiTeamInviteOutput
  Invoke-Npm -Arguments @("run", "team:join", "--", "--team", $TeamBSlug, "--email", $Users[1].Email, "--token", $multiTeamInviteToken, "--password", $Users[1].Password) -Env $BaseEnv

  Invoke-Npm -Arguments @("run", "team:client", "--", "create", "--team", $TeamASlug, "--slug", $ClientA, "--name", "Acme A $RunId", "--by", $Users[1].Email) -Env $BaseEnv
  Invoke-Npm -Arguments @("run", "team:client", "--", "grant", "--team", $TeamASlug, "--client", $ClientA, "--user", $Users[2].Email, "--access", "write", "--by", $Users[1].Email) -Env $BaseEnv
  Invoke-Npm -Arguments @("run", "team:client", "--", "grant", "--team", $TeamASlug, "--client", $ClientA, "--user", $Users[1].Email, "--access", "write", "--by", $Users[1].Email) -Env $BaseEnv

  Invoke-Npm -Arguments @("run", "team:client", "--", "create", "--team", $TeamBSlug, "--slug", $ClientB, "--name", "Acme B $RunId", "--by", $BootstrapOwnerB.Email) -Env $BaseEnv
  Invoke-Npm -Arguments @("run", "team:client", "--", "grant", "--team", $TeamBSlug, "--client", $ClientB, "--user", $Users[3].Email, "--access", "write", "--by", $BootstrapOwnerB.Email) -Env $BaseEnv
  Invoke-Npm -Arguments @("run", "team:client", "--", "grant", "--team", $TeamBSlug, "--client", $ClientB, "--user", $Users[1].Email, "--access", "write", "--by", $BootstrapOwnerB.Email) -Env $BaseEnv
}

Write-Step "Writing helper scripts"

$apiScript = Join-Path $RunRoot "start-team-api.ps1"
if ($HostedApiCapture) {
  Write-Utf8File $apiScript (@(
    '$ErrorActionPreference = "Stop"',
    ("Write-Host " + (Quote-Pwsh "Using hosted Team OS API: $ApiUrl")),
    'Write-Host "No local API needs to be started for this run."'
  ) -join "`r`n")
} else {
  Write-Utf8File $apiScript (@(
    '$ErrorActionPreference = "Stop"',
    ("`$env:MEMORY_DATABASE_URL = " + (Quote-Pwsh $MemoryDatabaseUrl)),
    '$env:MEMORY_STORE_BACKEND = "postgres"',
    '$env:MEMORY_EMBEDDER = "bge-m3"',
    ("`$env:MEMORY_API_PORT = " + (Quote-Pwsh ([string]$ApiPort))),
    ("`$env:MEMORY_API_TOKEN = " + (Quote-Pwsh $ApiDevToken)),
    ("`$env:AI_OS_DIR = " + (Quote-Pwsh $RunRoot)),
    ("Push-Location " + (Quote-Pwsh $CommandCentreDir)),
    'try {',
    '  npm run memory:api',
    '} finally {',
    '  Pop-Location',
    '}'
  ) -join "`r`n")
}

$loginScript = Join-Path $RunRoot "login-all.ps1"
$loginLines = @('$ErrorActionPreference = "Stop"')
foreach ($user in $Users) {
  $loginLines += ("`$env:AI_OS_TEAM_CONFIG_DIR = " + (Quote-Pwsh $user.ConfigDir))
  $loginLines += ("Push-Location " + (Quote-Pwsh $CommandCentreDir))
  $loginLines += "try {"
  $loginLines += ("  npm run team -- login --api-url " + (Quote-Pwsh $ApiUrl) + " --email " + (Quote-Pwsh $user.Email) + " --password " + (Quote-Pwsh $user.Password) + " --team " + (Quote-Pwsh $user.Team))
  $loginLines += "} finally {"
  $loginLines += "  Pop-Location"
  $loginLines += "}"
}
Write-Utf8File $loginScript (($loginLines -join "`r`n") + "`r`n")

$revokeScript = Join-Path $RunRoot "revoke-member-a-client-a.ps1"
if ($HostedApiCapture) {
  Write-Utf8File $revokeScript (@(
    '$ErrorActionPreference = "Stop"',
    ("`$apiUrl = " + (Quote-Pwsh $ApiUrl)),
    ("`$configPath = " + (Quote-Pwsh (Join-Path $Users[1].ConfigDir "team-context.json"))),
    'if (-not (Test-Path $configPath)) { throw "Missing admin Team OS login. Run login-all.ps1 first." }',
    '$saved = Get-Content $configPath -Raw | ConvertFrom-Json',
    '$body = @{',
    '  action = "revoke-client"',
    ("  client = " + (Quote-Pwsh $ClientA)),
    ("  user = " + (Quote-Pwsh $Users[2].Email)),
    '} | ConvertTo-Json -Depth 6',
    'Invoke-RestMethod -Uri "$apiUrl/v1/team/admin" -Method Post -Headers @{ Authorization = "Bearer $($saved.token)" } -ContentType "application/json" -Body $body | Out-Null',
    ("Write-Host " + (Quote-Pwsh "Revoked $($Users[2].Email) from $ClientA via Team OS API."))
  ) -join "`r`n")
} else {
  Write-Utf8File $revokeScript (@(
    '$ErrorActionPreference = "Stop"',
    ("`$env:MEMORY_DATABASE_URL = " + (Quote-Pwsh $MemoryDatabaseUrl)),
    '$env:MEMORY_STORE_BACKEND = "postgres"',
    '$env:MEMORY_EMBEDDER = "bge-m3"',
    ("Push-Location " + (Quote-Pwsh $CommandCentreDir)),
    'try {',
    ("  npm run team:client -- revoke --team " + (Quote-Pwsh $TeamASlug) + " --client " + (Quote-Pwsh $ClientA) + " --user " + (Quote-Pwsh $Users[2].Email) + " --by " + (Quote-Pwsh $Users[1].Email)),
    '} finally {',
    '  Pop-Location',
    '}'
  ) -join "`r`n")
}

$revokeMultiTeamScript = Join-Path $RunRoot "revoke-multi-team-user-team-b.ps1"
Write-Utf8File $revokeMultiTeamScript (@(
  '$ErrorActionPreference = "Stop"',
  ("`$env:AI_OS_TEAM_CONFIG_DIR = " + (Quote-Pwsh $Users[3].ConfigDir)),
  ("Push-Location " + (Quote-Pwsh $CommandCentreDir)),
  'try {',
  ("  npm run team -- member remove --user " + (Quote-Pwsh $Users[1].Email) + " --yes"),
  '  if ($LASTEXITCODE -ne 0) { throw "Team B membership revocation failed." }',
  '} finally {',
  '  Pop-Location',
  '}'
) -join "`r`n")

$restoreIsolationScript = Join-Path $RunRoot "restore-isolation-fixture.ps1"
if ($HostedApiCapture) {
  Write-Utf8File $restoreIsolationScript (@(
    '$ErrorActionPreference = "Stop"',
    'throw "Hosted mode must rerun its deployment bootstrap to restore the multi-Team fixture."'
  ) -join "`r`n")
} else {
  Write-Utf8File $restoreIsolationScript (@(
    '$ErrorActionPreference = "Stop"',
    ("`$env:MEMORY_DATABASE_URL = " + (Quote-Pwsh $MemoryDatabaseUrl)),
    '$env:MEMORY_STORE_BACKEND = "postgres"',
    '$env:MEMORY_EMBEDDER = "bge-m3"',
    ("Push-Location " + (Quote-Pwsh $CommandCentreDir)),
    'try {',
    ("  npm run team:test-bootstrap -- --run-id " + (Quote-Pwsh $RunId)),
    '  if ($LASTEXITCODE -ne 0) { throw "The idempotent isolation bootstrap failed." }',
    '} finally {',
    '  Pop-Location',
    '}',
    ("& powershell -NoProfile -ExecutionPolicy Bypass -File " + (Quote-ProcessArgument $loginScript)),
    'if ($LASTEXITCODE -ne 0) { throw "Refreshing the Team OS logins failed." }'
  ) -join "`r`n")
}

$switchToMemberScript = Join-Path $RunRoot "switch-admin-a-instance-to-member-a.ps1"
Write-Utf8File $switchToMemberScript (@(
  '$ErrorActionPreference = "Stop"',
  ("`$env:AI_OS_DIR = " + (Quote-Pwsh $Users[1].InstanceDir)),
  ("`$env:AI_OS_TEAM_CONFIG_DIR = " + (Quote-Pwsh $Users[1].ConfigDir)),
  ("Push-Location " + (Quote-Pwsh $CommandCentreDir)),
  'try {',
  '  npm run team -- logout',
  ("  npm run team -- login --api-url " + (Quote-Pwsh $ApiUrl) + " --email " + (Quote-Pwsh $Users[2].Email) + " --password " + (Quote-Pwsh $Users[2].Password) + " --team " + (Quote-Pwsh $TeamASlug)),
  '  if ($LASTEXITCODE -ne 0) { throw "Sequential login as member A failed." }',
  '} finally {',
  '  Pop-Location',
  '}'
) -join "`r`n")

$switchBackScript = Join-Path $RunRoot "switch-admin-a-instance-back.ps1"
Write-Utf8File $switchBackScript (@(
  '$ErrorActionPreference = "Stop"',
  ("`$env:AI_OS_DIR = " + (Quote-Pwsh $Users[1].InstanceDir)),
  ("`$env:AI_OS_TEAM_CONFIG_DIR = " + (Quote-Pwsh $Users[1].ConfigDir)),
  ("Push-Location " + (Quote-Pwsh $CommandCentreDir)),
  'try {',
  '  npm run team -- logout',
  ("  npm run team -- login --api-url " + (Quote-Pwsh $ApiUrl) + " --email " + (Quote-Pwsh $Users[1].Email) + " --password " + (Quote-Pwsh $Users[1].Password) + " --team " + (Quote-Pwsh $TeamASlug)),
  '  if ($LASTEXITCODE -ne 0) { throw "Returning login as admin A failed." }',
  '} finally {',
  '  Pop-Location',
  '}'
) -join "`r`n")

$contextScript = Join-Path $RunRoot "prepare-context-fixtures.ps1"
Write-Utf8File $contextScript (@(
  '$ErrorActionPreference = "Stop"',
  ("`$runId = " + (Quote-Pwsh $RunId)),
  ("`$commandCentre = " + (Quote-Pwsh $CommandCentreDir)),
  ("`$adminA = " + (Quote-Pwsh $Users[1].InstanceDir)),
  ("`$adminAConfig = " + (Quote-Pwsh $Users[1].ConfigDir)),
  ("`$memberA = " + (Quote-Pwsh $Users[2].InstanceDir)),
  ("`$memberAConfig = " + (Quote-Pwsh $Users[2].ConfigDir)),
  ("`$clientA = " + (Quote-Pwsh $ClientA)),
  "Set-Content -Path (Join-Path `$adminA 'team_context\proof.md') -Value `"TEAM_CONTEXT_A_`$runId`" -Encoding UTF8",
  "Set-Content -Path (Join-Path `$adminA 'context\MEMORY.md') -Value `"# Memory`r`n`r`n## Active Threads`r`n- ADMIN_A_PRIVATE_CONTEXT_`$runId`r`n`r`n## Environment Notes`r`n- Context fixture for Team OS test.`r`n`r`n## Pending Decisions`r`n- None.`r`n`" -Encoding UTF8",
  "Set-Content -Path (Join-Path `$memberA 'context\MEMORY.md') -Value `"# Memory`r`n`r`n## Active Threads`r`n- MEMBER_A_PRIVATE_CONTEXT_`$runId`r`n`r`n## Environment Notes`r`n- Context fixture for Team OS test.`r`n`r`n## Pending Decisions`r`n- None.`r`n`" -Encoding UTF8",
  "New-Item -ItemType Directory -Force -Path (Join-Path `$adminA `"clients\`$clientA\context`") | Out-Null",
  "Set-Content -Path (Join-Path `$adminA `"clients\`$clientA\context\MEMORY.md`") -Value `"CLIENT_CONTEXT_ACME_A_`$runId`" -Encoding UTF8",
  "`$env:AI_OS_TEAM_CONFIG_DIR = `$adminAConfig",
  "Push-Location `$commandCentre",
  "try { npm run context:import -- --cwd `$adminA } finally { Pop-Location }",
  "`$env:AI_OS_TEAM_CONFIG_DIR = `$adminAConfig",
  "Push-Location `$commandCentre",
  "try { npm run context:sync -- --cwd `$adminA --no-mcp } finally { Pop-Location }",
  "`$env:AI_OS_TEAM_CONFIG_DIR = `$memberAConfig",
  "Push-Location `$commandCentre",
  "try { npm run context:sync -- --cwd `$memberA --no-mcp } finally { Pop-Location }"
) -join "`r`n")

$diagnosticsScript = Join-Path $RunRoot "diagnose-memory-token.ps1"
Write-Utf8File $diagnosticsScript (@(
  'param(',
  '  [Parameter(Mandatory=$true)][string]$UserKey,',
  '  [Parameter(Mandatory=$true)][string]$Query,',
  '  [string]$Include = "private,team,client,system",',
  ("  [string]`$Client = " + (Quote-Pwsh $ClientA) + ","),
  '  [int]$TopK = 5',
  ')',
  '$ErrorActionPreference = "Stop"',
  ("`$runRoot = " + (Quote-Pwsh $RunRoot)),
  ("`$apiUrl = " + (Quote-Pwsh $ApiUrl)),
  ("`$commandCentre = " + (Quote-Pwsh $CommandCentreDir)),
  '$configPath = Join-Path $runRoot ".team-config\$UserKey\team-context.json"',
  'if (-not (Test-Path $configPath)) { throw "Missing login config: $configPath" }',
  '$saved = Get-Content $configPath -Raw | ConvertFrom-Json',
  '$includeList = $Include.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }',
  'Push-Location $commandCentre',
  'try {',
  '  $embeddingJson = node -e "const { prepareMemoryApiSearchBody } = require(''./scripts/lib/memory-api-payload.cjs''); prepareMemoryApiSearchBody(process.argv[1]).then((body) => console.log(JSON.stringify(body))).catch((error) => { console.error(error && error.message ? error.message : error); process.exit(1); });" $Query',
  '} finally {',
  '  Pop-Location',
  '}',
  '$embedding = $embeddingJson | ConvertFrom-Json',
  '$body = @{',
  '  query = $Query',
  '  queryEmbedding = $embedding.queryEmbedding',
  '  embeddingModel = $embedding.embeddingModel',
  '  embeddingDim = $embedding.embeddingDim',
  '  topK = $TopK',
  '  scope = @{',
  '    teamId = "server-resolved"',
  '    clientId = $Client',
  '    userId = "server-resolved"',
  '    include = $includeList',
  '  }',
  '  storeQueryText = $false',
  '} | ConvertTo-Json -Depth 8',
  'Invoke-RestMethod -Uri "$apiUrl/v1/memory/search" -Method Post -Headers @{ Authorization = "Bearer $($saved.token)" } -ContentType "application/json" -Body $body'
) -join "`r`n")

$launchScripts = @()
$launchScripts += New-LaunchScript -User $Users[0] -Name "owner-team-a-private" -Visibility "private"
$launchScripts += New-LaunchScript -User $Users[1] -Name "admin-team-a-private" -Visibility "private"
$launchScripts += New-LaunchScript -User $Users[1] -Name "admin-team-a-team" -Visibility "team"
$launchScripts += New-LaunchScript -User $Users[1] -Name "admin-team-a-system" -Visibility "system" -AllowSystem
$launchScripts += New-LaunchScript -User $Users[2] -Name "member-team-a-private" -Visibility "private"
$launchScripts += New-LaunchScript -User $Users[2] -Name "member-team-a-team-denied" -Visibility "team"
$launchScripts += New-LaunchScript -User $Users[2] -Name "member-team-a-client-a" -Visibility "client" -ClientId $ClientA
$launchScripts += New-LaunchScript -User $Users[3] -Name "admin-team-b-private" -Visibility "private"

New-StartProcessScript -Path (Join-Path $RunRoot "start-command-centres-private-hidden.ps1") -ScriptPaths @(
  (Join-Path $RunRoot "start-owner-team-a-private.ps1"),
  (Join-Path $RunRoot "start-admin-team-a-private.ps1"),
  (Join-Path $RunRoot "start-member-team-a-private.ps1"),
  (Join-Path $RunRoot "start-admin-team-b-private.ps1")
)

$manifest = [ordered]@{
  runId = $RunId
  runRoot = $RunRoot
  repoRoot = $RepoRoot
  apiUrl = $ApiUrl
  apiPort = $ApiPort
  memoryDatabaseUrl = $MemoryDatabaseUrl
  hostedApiCapture = [bool]$HostedApiCapture
  dependencyMode = $DependencyMode
  memoryStoreBackend = "postgres"
  memoryEmbedder = "bge-m3"
  teams = @{
    teamA = $TeamASlug
    teamB = $TeamBSlug
  }
  clients = @{
    teamA = $ClientA
    teamB = $ClientB
  }
  multiTeamUser = [ordered]@{
    key = $Users[1].Key
    email = $Users[1].Email
    initialTeam = $Users[1].Team
    teams = $Users[1].Teams
    clients = @($ClientA, $ClientB)
  }
  users = $Users | ForEach-Object {
    [ordered]@{
      key = $_.Key
      team = $_.Team
      teams = $_.Teams
      email = $_.Email
      password = $_.Password
      port = $_.Port
      instanceDir = $_.InstanceDir
      commandCentreDir = $_.CommandCentreDir
      configDir = $_.ConfigDir
    }
  }
  bootstrapOwnerTeamB = $BootstrapOwnerB
  helperScripts = @{
    startApi = $apiScript
    loginAll = $loginScript
    prepareContextFixtures = $contextScript
    revokeMemberClientAccess = $revokeScript
    revokeMultiTeamMembership = $revokeMultiTeamScript
    restoreIsolationFixture = $restoreIsolationScript
    switchAdminInstanceToMember = $switchToMemberScript
    switchAdminInstanceBack = $switchBackScript
    diagnoseMemoryToken = $diagnosticsScript
  }
}
Write-Utf8File (Join-Path $RunRoot "manifest.json") (($manifest | ConvertTo-Json -Depth 8) + "`r`n")

$promptsPath = Join-Path $RunRoot "test-prompts.md"
Write-Utf8File $promptsPath @"
# Team OS Chat Memory Test Prompts

Run ID: $RunId

Use these Command Centre URLs:

- owner-team-a: http://127.0.0.1:3101
- admin-team-a: http://127.0.0.1:3102
- member-team-a: http://127.0.0.1:3103
- admin-team-b: http://127.0.0.1:3104

## 1. Private memory

Start member A with start-member-team-a-private.ps1.

Create in member A chat:

~~~text
Teste de memoria privada. Responda repetindo exatamente este token:
PRIVATE_MEMBER_A_${RunId}
Nao crie arquivos.
~~~

Recall in a new member A chat:

~~~text
Voce lembra do token PRIVATE_MEMBER_A_${RunId}? Procure na memoria antes de responder.
~~~

Expected: member A finds it. Admin A and admin B do not.

## 2. Team memory

Restart admin A with start-admin-team-a-team.ps1.

Create in admin A chat:

~~~text
Teste de memoria compartilhada de time. Responda exatamente:
TEAM_A_SHARED_${RunId}
Nao crie arquivos.
~~~

Recall as member A:

~~~text
Voce lembra do token TEAM_A_SHARED_${RunId}? Procure na memoria do Team OS antes de responder.
~~~

Expected: member A finds it. Admin B does not.

Negative write test: restart member A with start-member-team-a-team-denied.ps1, create:

~~~text
Teste negativo de memoria de time. Responda exatamente:
TEAM_WRITE_DENIED_MEMBER_A_${RunId}
Nao crie arquivos.
~~~

Expected: this token does not appear in later recall because member A is not admin/owner.

## 3. System memory inside one team

Restart admin A with start-admin-team-a-system.ps1.

Create in admin A chat:

~~~text
Teste de memoria system do Team A. Responda exatamente:
SYSTEM_TEAM_A_${RunId}
Nao crie arquivos.
~~~

Expected: member A finds it. Admin B does not.

## 4. Client memory

Restart member A with start-member-team-a-client-a.ps1. In Command Centre, select client $ClientA.

Create in member A chat:

~~~text
Teste de memoria do cliente Acme A. Responda exatamente:
CLIENT_ACME_A_BY_MEMBER_${RunId}
Nao crie arquivos.
~~~

Expected: member A with client $ClientA finds it. Admin A with the same client finds it. Admin B does not.

Then run revoke-member-a-client-a.ps1 and confirm:

~~~powershell
`$env:AI_OS_TEAM_CONFIG_DIR = "$($Users[2].ConfigDir)"
cd "$CommandCentreDir"
npm run team -- clients
~~~

Expected: $ClientA is gone for member A, and recall of CLIENT_ACME_A_BY_MEMBER_${RunId} fails.

## 5. Team context

Run prepare-context-fixtures.ps1.

Ask member A in a new chat:

~~~text
Qual token de team_context voce recebeu no contexto carregado?
~~~

Expected: member A mentions TEAM_CONTEXT_A_${RunId}. Admin B does not.

## 6. Private context

After prepare-context-fixtures.ps1, ask member A:

~~~text
Qual token privado voce ve no contexto carregado?
~~~

Expected: member A sees only MEMBER_A_PRIVATE_CONTEXT_${RunId}.

Ask admin A the same. Expected: admin A sees only ADMIN_A_PRIVATE_CONTEXT_${RunId}.

## 7. Client context

With client $ClientA selected, ask member A:

~~~text
Qual token de contexto do cliente voce recebeu?
~~~

Expected: member A sees CLIENT_CONTEXT_ACME_A_${RunId}.

After revoke, open a new member A chat. Expected: member A does not see the client context.

## Diagnostic memory search

Use only when the chat result is surprising:

~~~powershell
.\diagnose-memory-token.ps1 -UserKey member-team-a -Query "PRIVATE_MEMBER_A_${RunId}" -Include "private,team,client,system"
.\diagnose-memory-token.ps1 -UserKey admin-team-a -Query "TEAM_A_SHARED_${RunId}" -Include "team,system"
~~~

If the API finds the token but chat does not, investigate the Command Centre recall flow. If the API does not find it, inspect the creator instance file `context\memory\YYYY-MM-DD.aos.md` and the capture/indexing logs.
"@

$checklistPath = Join-Path $RunRoot "isolation-checklist.md"
Write-Utf8File $checklistPath @"
# Team OS Multi-Team and Sequential-User Isolation Checklist

Run ID: $RunId

Mode: $(if ($HostedApiCapture) { "hosted Team API" } else { "local Docker pgvector/pgvector:pg16" })

This checklist contains no authentication tokens. Record pass/fail notes beside each checkbox before reporting the run.

## Fixture

- Multi-Team user: admin-team-a (`$($Users[1].Email)`)
- Initial Team: `$TeamASlug`
- Second Team: `$TeamBSlug`
- Team A client: `$ClientA`
- Team B client: `$ClientB`
- Multi-Team Command Centre: http://127.0.0.1:$($Users[1].Port)
- Team B comparison user: http://127.0.0.1:$($Users[3].Port)

## M-01 — Multi-Team login

- [ ] Run `login-all.ps1`, then open http://127.0.0.1:$($Users[1].Port).
- [ ] Confirm admin-team-a has one local profile, Team A selected, and both Team A and Team B memberships visible.
- [ ] Switch to Team B and back to Team A. Confirm the profile/session identity and existing history do not change.

Expected: one user and one local profile can select either Team without losing or moving history.

## M-02 — Existing and new work

- [ ] In Team A with client `$ClientA`, create one Goal/chat and start an agent. Label it `ISO_A_$RunId`.
- [ ] Switch to Team B with client `$ClientB`, create another Goal/chat and start an agent. Label it `ISO_B_$RunId`.
- [ ] Keep both agents active. Confirm A remains Team A/client A and B remains Team B/client B.
- [ ] While Team B is selected, open/reply to A. Confirm A uses Team A but the selector stays on Team B.

Expected: chats, tasks, terminals, agents, processes, and overlays keep their captured Team/client.

## M-03 — Stale navigation

- [ ] Rapidly select Team A → Team B → Team A while client refreshes are pending.
- [ ] Wait for every response to finish.

Expected: Team A and its client list remain visible; no delayed Team B response restores an old choice.

## M-04 — Team B revocation only

- [ ] Run `revoke-multi-team-user-team-b.ps1`.
- [ ] Refresh admin-team-a. Confirm Team A continues and new Team B work is blocked.
- [ ] Open the saved Team B chat. Confirm it can only continue with its saved Claude session in conversation-only mode and makes no Team context/memory/sync calls.
- [ ] Run `restore-isolation-fixture.ps1` before continuing.

Expected: revoking Team B does not block Team A. The restore script re-applies the idempotent fixture locally.

## M-05 — Server unavailable

- [ ] Leave both Team work items open, then stop the test API. For a locally started API:

~~~powershell
`$apiPid = (Get-NetTCPConnection -LocalPort $ApiPort -State Listen).OwningProcess
Stop-Process -Id `$apiPid
~~~

- [ ] Confirm the UI reports Team OS unavailable but keeps the known user/profile.
- [ ] Confirm no new Team work starts and no workspace-local Team/private context is loaded.
- [ ] Confirm saved Team work is not converted to Solo.
- [ ] Restart with `start-team-api.ps1`, then run `login-all.ps1` if required.

Expected: the outage fails closed without stale local context.

## M-06 — Sequential user in the same installation

- [ ] In the admin-team-a browser tab, record the current `x-AI-OS-profile-key` and `x-AI-OS-profile-session` values from a safe GET request.
- [ ] Close active agents/terminals, then run `switch-admin-a-instance-to-member-a.ps1`.
- [ ] Reload http://127.0.0.1:$($Users[1].Port) without changing the instance directory.
- [ ] Confirm member A sees none of admin A's Team A/B history, files, drafts, temporary attachments, or overlays.
- [ ] Retry the recorded old request and confirm `409 stale_profile_session` before any data is returned.

Expected: the same installation rotates to a different profile/database/browser namespace.

## M-07 — Returning user recovery

- [ ] Run `switch-admin-a-instance-back.ps1` and reload the same URL.
- [ ] Confirm durable Team A/B history and sent attachments return.
- [ ] Confirm drafts, unsent attachments, old overlays, temporary files, and the old browser session do not return.

Expected: durable owned data recovers; volatile data and stale sessions do not.

## M-08 — Local route guards

- [ ] From PowerShell, replay only a safe GET with the old values recorded in M-06:

~~~powershell
`$headers = @{
  "x-AI-OS-profile-key" = "<old-profile-key>"
  "x-AI-OS-profile-session" = "<old-profile-session>"
}
Invoke-WebRequest -Uri "http://127.0.0.1:$($Users[1].Port)/api/tasks" -Headers `$headers -SkipHttpErrorCheck
~~~

- [ ] Confirm the old session returns 409, a closing profile returns 423, and the guarded route does not return task data.
- [ ] Confirm a Team-owned materialized file is not found from another profile and hosted local-only routes remain denied.

Expected: route protection runs before database or filesystem services.

## M-09 — Solo smoke test

- [ ] At the end of the run, logout admin-team-a and open the same installation in signed-out Solo mode.
- [ ] Create/read a Solo-only record, then confirm no Team history, Team-owned file, Team context, or Team client appears.
- [ ] Login admin-team-a again and confirm the Solo record is absent from the Team profile.

Expected: the original Solo database and behavior remain separate and unchanged.

## Evidence summary

- Executed steps:
- Passed:
- Failed:
- Reproducible but not executed (include reason):
- Defects and regression tests added:
"@

if ($StartApi) {
  Write-Step "Starting Team API"
  $apiArgumentList = "-NoProfile -ExecutionPolicy Bypass -File " + (Quote-ProcessArgument $apiScript)
  Start-Process -FilePath powershell -ArgumentList $apiArgumentList -WindowStyle Hidden
  if (-not (Wait-ApiHealth $ApiUrl 40)) {
    throw "Team API did not become healthy at $ApiUrl"
  }
}

if (-not $SkipLogin) {
  if (Test-ApiHealth $ApiUrl) {
    Write-Step "Logging in all test users"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $loginScript
    if ($LASTEXITCODE -ne 0) {
      throw "login-all.ps1 failed with exit code $LASTEXITCODE"
    }
  } else {
    Write-Warning "Team API is not running at $ApiUrl. Skipped logins. Run start-team-api.ps1, then login-all.ps1."
  }
}

if ($StartCommandCentres) {
  Write-Step "Starting default private Command Centres"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RunRoot "start-command-centres-private-hidden.ps1")
}

Write-Step "Ready"
Write-Host "Run root: $RunRoot"
Write-Host "Prompts : $promptsPath"
Write-Host "Isolation: $checklistPath"
Write-Host "Manifest: $(Join-Path $RunRoot 'manifest.json')"
Write-Host ""
Write-Host "Next steps:"
if ($HostedApiCapture) {
  Write-Host "1. Hosted API is already used: $ApiUrl"
} else {
  Write-Host "1. Start the API if needed: powershell -NoProfile -ExecutionPolicy Bypass -File `"$apiScript`""
}
Write-Host "2. Login all users if skipped: powershell -NoProfile -ExecutionPolicy Bypass -File `"$loginScript`""
Write-Host "3. Open the launch scripts in $RunRoot and run the user/memory mode needed for each test."
