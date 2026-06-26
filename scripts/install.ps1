[CmdletBinding()]
param(
    [switch]$Guided,
    [switch]$Repair
)

$ErrorActionPreference = "Stop"

if (-not $Guided -and -not $Repair) {
    $Guided = $true
}

if ($Guided -and $Repair) {
    throw "Choose either -Guided or -Repair, not both."
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$HelperScript = Join-Path $ScriptDir "launcher-bootstrap.py"
$SetupScript = Join-Path $ScriptDir "setup.ps1"
$MemorySetupScript = Join-Path $ScriptDir "setup-memory.ps1"
$InstallAliasScript = Join-Path $ScriptDir "install-centre-alias.ps1"
$PowerShellHost = (Get-Process -Id $PID).Path
$CronDryRun = $env:AGENTIC_OS_CRON_DRY_RUN
$VersionFile = Join-Path $RepoRoot "VERSION"
$AgenticOsVersion = if (Test-Path $VersionFile) {
    try {
        ((Get-Content $VersionFile -ErrorAction Stop | Select-Object -First 1) -as [string]).Trim()
    }
    catch {
        "unknown"
    }
}
else {
    "unknown"
}
if ([string]::IsNullOrWhiteSpace($AgenticOsVersion)) {
    $AgenticOsVersion = "unknown"
}

. (Join-Path $ScriptDir "lib\python.ps1")
. (Join-Path $ScriptDir "lib\gsd-migration.ps1")

function Info($Message) { Write-Host $Message -ForegroundColor Cyan }
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

function Invoke-LauncherBootstrapJson {
    param(
        [string[]]$Arguments
    )

    if (-not $script:PythonInfo) {
        throw "Python 3 is required for launcher bootstrap helpers."
    }

    $allArguments = @($HelperScript, "--repo-root", $RepoRoot) + $Arguments
    $output = Invoke-CommandParts -CommandParts $script:PythonInfo.CommandParts -Arguments $allArguments
    if ($LASTEXITCODE -ne 0) {
        throw "launcher-bootstrap.py failed."
    }

    return (($output | Out-String).Trim() | ConvertFrom-Json)
}

function Invoke-LauncherBootstrap {
    param(
        [string[]]$Arguments
    )

    if (-not $script:PythonInfo) {
        throw "Python 3 is required for launcher bootstrap helpers."
    }

    $allArguments = @($HelperScript, "--repo-root", $RepoRoot) + $Arguments
    Invoke-CommandParts -CommandParts $script:PythonInfo.CommandParts -Arguments $allArguments | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "launcher-bootstrap.py failed."
    }
}

function Read-YesNo {
    param(
        [string]$Prompt,
        [string]$Default = "Y"
    )

    $suffix = if ($Default -eq "N") { "[y/N]" } else { "[Y/n]" }
    $reply = Read-Host "$Prompt $suffix"
    if ([string]::IsNullOrWhiteSpace($reply)) {
        $reply = $Default
    }
    return $reply -match "^[Yy]$"
}

function Show-Banner {
    Clear-Host
    Write-Host ""
    Write-Host "    ==============================================" -ForegroundColor Cyan
    Write-Host "                  A I - O S" -ForegroundColor Cyan
    Write-Host "            Guided First-Time Install" -ForegroundColor Cyan
    Write-Host "    ==============================================" -ForegroundColor Cyan
    if ($AgenticOsVersion -eq "unknown") {
        Write-Host "    AI-OS version unknown" -ForegroundColor DarkGray
    }
    else {
        Write-Host "    AI-OS v$AgenticOsVersion" -ForegroundColor DarkGray
    }
    Write-Host ""
}

function Check-Prerequisites {
    $prereqFail = $false

    if ($Guided) {
        Info "Checking prerequisites..."
        Write-Host ""
    }

    if (Get-Command git -ErrorAction SilentlyContinue) {
        if ($Guided) {
            $gitVersion = (& git --version | Out-String).Trim()
            Success $gitVersion
        }
    }
    else {
        Fail "git not found - install from https://git-scm.com/downloads"
        $prereqFail = $true
    }

    if (Get-Command node -ErrorAction SilentlyContinue) {
        if ($Guided) {
            $nodeVersion = (& node --version | Out-String).Trim()
            Success "node $nodeVersion"
        }
    }
    else {
        Warn "Node.js not found - the command centre will not run until Node is installed."
    }

    $script:PythonInfo = Resolve-PythonCommand
    if ($script:PythonInfo) {
        if ($Guided) {
            Success "Python $($script:PythonInfo.Version) via $($script:PythonInfo.Label)"
        }
        if ($script:PythonInfo.Python3DiagnosticBroken) {
            Warn "Windows exposes a broken python3 at $($script:PythonInfo.Python3DiagnosticPath)."
            Warn "AI-OS will use '$($script:PythonInfo.Label)' instead."
        }
    }
    else {
        Fail "Python 3 not found - install from https://www.python.org/downloads/"
        $prereqFail = $true
    }

    if ($prereqFail) {
        exit 1
    }
}

function Ensure-LocalBootstrap {
    if ($Guided) {
        Info "Preparing local bootstrap files..."
    }

    Invoke-LauncherBootstrap -Arguments @("bootstrap-repair")
    $status = Invoke-LauncherBootstrapJson -Arguments @("bootstrap-status")
    if (-not $status.bootstrap_valid) {
        throw "Bootstrap repair finished, but the workspace is still incomplete."
    }

    if ($Guided) {
        Success "Local bootstrap is ready"
    }
}

function Run-DependencySetup {
    if (-not (Test-Path $SetupScript)) {
        Warn "setup.ps1 not found - skipping dependency setup"
        return
    }

    Info "Checking system dependencies..."
    & $PowerShellHost -NoProfile -ExecutionPolicy Bypass -File $SetupScript -Silent
}

function Setup-SearchableMemory {
    $script:MemoryDecision = "unknown"

    Write-Host ""
    Write-Host "Searchable Memory" -ForegroundColor Cyan
    Write-Host "  This is optional, but recommended. It lets AI-OS search older"
    Write-Host "  memory, daily logs, learnings, and client-scoped brand context."
    Write-Host "  Claude Code is the recommended default because AI-OS is Claude-first."
    Write-Host ""

    if ($CronDryRun -eq "1") {
        Warn "Dry run mode active - skipping searchable memory setup."
        $script:MemoryDecision = "skipped-dry-run"
        return
    }

    if (-not (Test-Path $MemorySetupScript)) {
        Warn "setup-memory.ps1 not found - skipping searchable memory setup."
        $script:MemoryDecision = "unavailable"
        return
    }

    & $PowerShellHost -NoProfile -ExecutionPolicy Bypass -File $MemorySetupScript -Check *> $null
    if ($LASTEXITCODE -eq 0) {
        Success "Searchable memory already configured"
        $script:MemoryDecision = "configured"
        return
    }

    Write-Host "  Choose where to enable searchable memory:"
    Write-Host "    1. Claude Code only (recommended)"
    Write-Host "    2. Codex only"
    Write-Host "    3. Claude Code + Codex"
    Write-Host "    4. Skip for now"
    Write-Host ""
    $reply = Read-Host "  Selection [1]"
    if ([string]::IsNullOrWhiteSpace($reply)) {
        $reply = "1"
    }

    $target = ""
    switch ($reply) {
        "1" { $target = "claude" }
        "2" { $target = "codex" }
        "3" { $target = "both" }
        "4" {
            Warn "Skipped searchable memory setup."
            Write-Host "  Semantic recall, older memory search,"
            Write-Host "  expanded search, and stronger citations will be unavailable until enabled."
            $script:MemoryDecision = "skipped"
            return
        }
        default {
            Warn "Unknown selection - skipped searchable memory setup."
            $script:MemoryDecision = "skipped-invalid"
            return
        }
    }

    & $PowerShellHost -NoProfile -ExecutionPolicy Bypass -File $MemorySetupScript -Target $target
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
        Success "Searchable memory setup finished"
        $script:MemoryDecision = $target
        return
    }

    if ($exitCode -eq 3) {
        Warn "Skipped searchable memory setup."
        $script:MemoryDecision = "skipped-confirmation"
        return
    }

    Warn "Searchable memory setup did not finish. You can retry later:"
    Write-Host "    powershell -File scripts\setup-memory.ps1"
    $script:MemoryDecision = "failed"
}

function Setup-GitHubRepo {
    $script:GitHubDecision = "unknown"

    $upstreamOwner = "camrontaylor"
    $upstreamRepo = "ai-os-template"
    $originUrl = ""
    $isUpstream = $false

    try {
        $originUrl = (& git -C $RepoRoot remote get-url origin 2>$null | Out-String).Trim()
    }
    catch {
        $originUrl = ""
    }

    if ($originUrl -and $originUrl.Contains("$upstreamOwner/$upstreamRepo")) {
        $isUpstream = $true
    }

    if ($originUrl -and -not $isUpstream) {
        Success "GitHub backup already configured: $originUrl"
        $script:GitHubDecision = "configured"
        return
    }

    Write-Host ""
    Write-Host "GitHub Backup" -ForegroundColor Cyan
    Write-Host "  AI-OS stores your brand and project data locally."
    Write-Host "  You can back it up to your own private GitHub repository."
    Write-Host ""

    if (-not (Read-YesNo -Prompt "Set up private GitHub backup now?")) {
        Warn "Skipped GitHub backup setup."
        $script:GitHubDecision = "skipped"
        return
    }

    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Warn "GitHub CLI (gh) not found."
        Write-Host "  Manual fallback:"
        Write-Host "    1. Create a new PRIVATE repo on GitHub"
        if ($isUpstream) {
            Write-Host "    2. Run: git remote rename origin upstream"
            Write-Host "    3. Run: git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
        }
        else {
            Write-Host "    2. Run: git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
        }
        Write-Host "    4. Run: git push -u origin main"
        $script:GitHubDecision = "manual-required"
        return
    }

    & gh auth status *> $null
    if ($LASTEXITCODE -ne 0) {
        Warn "GitHub CLI is not authenticated."
        Write-Host "  Run: gh auth login"
        Write-Host "  Then run this installer again if you want automatic setup."
        $script:GitHubDecision = "pending-auth"
        return
    }

    $ghUser = (& gh api user --jq ".login" 2>$null | Out-String).Trim()
    if (-not $ghUser) {
        Warn "Could not read your GitHub username."
        $script:GitHubDecision = "failed"
        return
    }

    $defaultRepo = "AI-OS"
    Write-Host "  Logged in as: $ghUser"
    $repoName = Read-Host "  Repo name? [$defaultRepo]"
    if ([string]::IsNullOrWhiteSpace($repoName)) {
        $repoName = $defaultRepo
    }

    # If origin still points at the canonical repo, move it to `upstream` BEFORE
    # creating the fork. Otherwise `gh repo create --remote=origin` collides with
    # the existing origin remote and silently fails - leaving the user with no
    # remote pointing at the canonical repo, which breaks update.sh.
    if ($isUpstream) {
        & git -C $RepoRoot remote get-url upstream *> $null
        if ($LASTEXITCODE -eq 0) {
            & git -C $RepoRoot remote remove origin 2>$null
        }
        else {
            & git -C $RepoRoot remote rename origin upstream 2>$null
        }
    }

    Info "Creating private repo $ghUser/$repoName..."
    & gh repo create $repoName --private --source=$RepoRoot --remote=origin 2>$null
    if ($LASTEXITCODE -eq 0) {
        & git -C $RepoRoot push -u origin main 2>$null
        if ($LASTEXITCODE -ne 0) {
            $currentBranch = (& git -C $RepoRoot branch --show-current 2>$null | Out-String).Trim()
            if (-not $currentBranch) {
                $currentBranch = "main"
            }
            & git -C $RepoRoot push -u origin $currentBranch 2>$null
        }

        Success "Private backup repo configured"
        $script:GitHubDecision = "configured"
        return
    }

    Warn "Automatic repo creation failed."
    if ($isUpstream) {
        Warn "Canonical repo is now at the 'upstream' remote - updates will still work."
    }
    $script:GitHubDecision = "failed"
}

function Install-Gsd {
    $script:GsdDecision = "unknown"

    Write-Host ""
    Write-Host "GSD Project Framework" -ForegroundColor Cyan
    Write-Host "  This installs the optional GSD commands for structured project work."
    Write-Host ""

    if ($CronDryRun -eq "1") {
        Warn "Dry run mode active - skipping GSD install."
        $script:GsdDecision = "skipped-dry-run"
        return
    }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Warn "Node.js is required for GSD. Install Node.js first."
        $script:GsdDecision = "unavailable"
        return
    }

    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        Warn "npx is required for GSD. Install npm first."
        $script:GsdDecision = "unavailable"
        return
    }

    $migrationResult = Invoke-AgenticOsGsdMigration -RepoRoot $RepoRoot
    if ($migrationResult -eq "declined") {
        Warn "Legacy GSD left in place. Skipped GSD-redux install."
        $script:GsdDecision = "migration-declined"
        return
    }

    if ($migrationResult -ne "cleaned") {
        $reduxVersion = Get-AgenticOsGsdReduxVersion -RepoRoot $RepoRoot
        if ($reduxVersion) {
            Success "GSD-redux already installed (v$reduxVersion)"
            $script:GsdDecision = "already-installed"
            return
        }
        if (-not (Read-YesNo -Prompt "Install GSD now?")) {
            Warn "Skipped GSD installation."
            $script:GsdDecision = "skipped"
            return
        }
    }

    if (Install-AgenticOsGsdRedux) {
        Success "GSD-redux installed globally"
        $script:GsdDecision = "installed"
    }
    else {
        Warn "GSD installation failed. You can retry later with: npx -y @opengsd/get-shit-done-redux@latest --global --claude"
        $script:GsdDecision = "failed"
    }
}

function Install-LauncherShortcut {
    $script:LauncherDecision = "unknown"

    Write-Host ""
    Write-Host "Global 'centre' Shortcut" -ForegroundColor Cyan
    Write-Host "  This is optional. It lets you type 'centre' from PowerShell."
    Write-Host ""

    if (-not (Read-YesNo -Prompt "Install the global 'centre' shortcut now?")) {
        Warn "Skipped launcher shortcut install."
        $script:LauncherDecision = "skipped"
        return
    }

    if ($CronDryRun -eq "1") {
        Warn "Dry run mode active - skipping launcher install."
        $script:LauncherDecision = "skipped-dry-run"
        return
    }

    & $PowerShellHost -NoProfile -ExecutionPolicy Bypass -File $InstallAliasScript
    if ($LASTEXITCODE -eq 0) {
        Success "Installed PowerShell shortcut"
        $script:LauncherDecision = "installed"
    }
    else {
        Warn "PowerShell shortcut install failed."
        $script:LauncherDecision = "failed"
    }
}

function Mark-GuidedComplete {
    Invoke-LauncherBootstrap -Arguments @(
        "state-mark-guided",
        "--github", $script:GitHubDecision,
        "--gsd", $script:GsdDecision,
        "--launcher", $script:LauncherDecision,
        "--memory", $script:MemoryDecision,
        "--bootstrap-valid", "true"
    )
}

function Mark-RepairComplete {
    Invoke-LauncherBootstrap -Arguments @(
        "state-mark-repair",
        "--bootstrap-valid", "true"
    )
}

function Run-RepairMode {
    Check-Prerequisites
    Ensure-LocalBootstrap
    Mark-RepairComplete
}

function Run-GuidedMode {
    Show-Banner
    Check-Prerequisites
    Write-Host ""
    Ensure-LocalBootstrap
    Write-Host ""
    Run-DependencySetup
    Setup-SearchableMemory
    Setup-GitHubRepo
    Install-Gsd
    Install-LauncherShortcut
    Mark-GuidedComplete

    Write-Host ""
    Write-Host "Installation Complete" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Next steps:"
    Write-Host "    1. Run 'centre' (or 'powershell -File scripts\centre.ps1') to open the Command Centre"
    Write-Host "    2. Run 'claude' when you want to start working in the terminal"
    Write-Host ""
}

if ($Repair) {
    Run-RepairMode
    exit 0
}

Run-GuidedMode
