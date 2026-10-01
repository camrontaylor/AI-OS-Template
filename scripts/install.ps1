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
$CronDryRun = $env:AI_OS_CRON_DRY_RUN
$VersionFile = Join-Path $RepoRoot "VERSION"
$AiOsVersion = if (Test-Path $VersionFile) {
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
if ([string]::IsNullOrWhiteSpace($AiOsVersion)) {
    $AiOsVersion = "unknown"
}

# A missing lib would otherwise end the run with a bare dot-source error (AIOS-473).
foreach ($RequiredLib in @("python.ps1", "gsd-migration.ps1")) {
    if (-not (Test-Path -LiteralPath (Join-Path $ScriptDir "lib\$RequiredLib"))) {
        Write-Host "AI-OS cannot continue: scripts/lib/$RequiredLib is missing." -ForegroundColor Red
        Write-Host "Restore it from the AI-OS repo, then run this again:"
        Write-Host "  git fetch upstream main"
        Write-Host "  git checkout upstream/main -- scripts/lib/$RequiredLib"
        Write-Host "  git commit -m `"Restore scripts/lib/$RequiredLib`""
        Write-Host "Use 'origin' instead of 'upstream' if that is the remote pointing at the AI-OS repo."
        exit 1
    }
}

. (Join-Path $ScriptDir "lib\python.ps1")
. (Join-Path $ScriptDir "lib\gsd-migration.ps1")

function Info($Message) { Write-Host $Message -ForegroundColor Cyan }
function Success($Message) { Write-Host "  [OK] $Message" -ForegroundColor Green }
function Warn($Message) { Write-Host "  [!] $Message" -ForegroundColor Yellow }
function Fail($Message) { Write-Host "  [X] $Message" -ForegroundColor Red }

function Test-ClaudeCodeAvailable {
    if ($env:AI_OS_CLAUDE_BIN) {
        if (Get-Command $env:AI_OS_CLAUDE_BIN -ErrorAction SilentlyContinue) {
            return $true
        }
        if (Test-Path $env:AI_OS_CLAUDE_BIN) {
            return $true
        }
        return $false
    }

    foreach ($name in @("claude", "claude.exe", "claude.cmd")) {
        if (Get-Command $name -ErrorAction SilentlyContinue) {
            return $true
        }
    }

    return $false
}

function Normalize-PathForComparison {
    param(
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }

    $expanded = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
    try {
        $fullPath = [System.IO.Path]::GetFullPath($expanded)
    }
    catch {
        $fullPath = $expanded
    }

    return $fullPath.TrimEnd([char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)).ToLowerInvariant()
}

function Test-PathListContains {
    param(
        [string[]]$Entries,
        [string]$Path
    )

    $target = Normalize-PathForComparison $Path
    if (-not $target) {
        return $false
    }

    foreach ($entry in $Entries) {
        if ((Normalize-PathForComparison $entry) -eq $target) {
            return $true
        }
    }

    return $false
}

function Get-PathEntries {
    param(
        [AllowNull()]
        [string]$PathValue
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return @()
    }

    return @($PathValue -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-ClaudeCodePathRepairCandidates {
    $candidates = @()

    if ($env:USERPROFILE) {
        $localBin = Join-Path $env:USERPROFILE ".local\bin"
        if (Test-Path -LiteralPath $localBin -PathType Container) {
            foreach ($shim in @("claude", "claude.exe", "claude.cmd")) {
                if (Test-Path -LiteralPath (Join-Path $localBin $shim) -PathType Leaf) {
                    $candidates += $localBin
                    break
                }
            }
        }
    }

    $gitBin = "C:\Program Files\Git\bin"
    if (Test-Path -LiteralPath $gitBin -PathType Container) {
        $candidates += $gitBin
    }

    return @($candidates | Select-Object -Unique)
}

function Add-UserPathEntries {
    param(
        [string[]]$Paths
    )

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $userEntries = @(Get-PathEntries $userPath)
    $processEntries = @(Get-PathEntries $env:Path)
    $added = @()

    foreach ($path in $Paths) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            continue
        }

        $resolved = (Resolve-Path -LiteralPath $path).ProviderPath

        if (-not (Test-PathListContains -Entries $userEntries -Path $resolved)) {
            $userEntries += $resolved
            $added += $resolved
        }

        if (-not (Test-PathListContains -Entries $processEntries -Path $resolved)) {
            $env:Path = if ([string]::IsNullOrWhiteSpace($env:Path)) {
                $resolved
            }
            else {
                "$env:Path;$resolved"
            }
            $processEntries += $resolved
        }
    }

    if ($added.Count -gt 0) {
        [Environment]::SetEnvironmentVariable("Path", ($userEntries -join ";"), "User")
    }

    return @($added)
}

function Repair-ClaudeCodePath {
    $candidates = @(Get-ClaudeCodePathRepairCandidates)
    if ($candidates.Count -eq 0) {
        return @()
    }

    try {
        $added = @(Add-UserPathEntries -Paths $candidates)
    }
    catch {
        Warn "Could not update your User PATH automatically: $($_.Exception.Message)"
        return @()
    }

    foreach ($path in $added) {
        Success "Added $path to your User PATH"
    }

    return @($added)
}

function Show-ClaudeCodeWarningIfMissing {
    if (Test-ClaudeCodeAvailable) {
        Success "Claude Code CLI detected"
        return
    }

    $addedPaths = @(Repair-ClaudeCodePath)
    if (Test-ClaudeCodeAvailable) {
        Success "Claude Code CLI detected after PATH repair"
        if ($addedPaths.Count -gt 0) {
            Warn "Open a new terminal after install so Windows reloads PATH."
        }
        return
    }

    if ((Get-Command codex -ErrorAction SilentlyContinue) -or (Get-Command codex.cmd -ErrorAction SilentlyContinue)) {
        Success "Codex CLI detected; direct AI-OS sessions are ready"
        Warn "Command Centre chat and cron jobs also need Claude Code."
        return
    }
    Warn "Install Codex or Claude Code for direct AI-OS sessions; Command Centre chat and cron jobs need Claude Code."
    if ($addedPaths.Count -gt 0) {
        Write-Host "      AI-OS updated your User PATH. Open a new terminal before running tasks."
    }
    else {
        Write-Host "      Install Claude Code, then open a new terminal before running tasks."
    }
    Write-Host "      Docs: https://code.claude.com/docs/en/setup"

    if ($env:AI_OS_CLAUDE_BIN) {
        Write-Host "      AI_OS_CLAUDE_BIN is set, but that command or path was not found."
    }

    Write-Host "      Windows PowerShell: irm https://claude.ai/install.ps1 | iex"
    Write-Host "      Windows CMD: curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd"
    Write-Host "      Windows WinGet: winget install Anthropic.ClaudeCode"
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

function Sanitize-GitUrl {
    param(
        [string]$Url
    )

    if (-not $Url) {
        return ""
    }
    return ($Url -replace "(https?://)[^/@]+@", '$1<token>@')
}

function Install-GitHubCli {
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        return $true
    }

    Warn "GitHub CLI (gh) is not installed."
    Write-Host "  Git is still the required tool. GitHub CLI only helps this installer"
    Write-Host "  create your private backup repository automatically."
    Write-Host ""

    if (-not (Read-YesNo -Prompt "Install GitHub CLI now?" -Default "Y")) {
        return $false
    }

    $installed = $false
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            winget install --id GitHub.cli -e --silent
            if ($LASTEXITCODE -eq 0) {
                $installed = $true
            }
        }
        catch {
            $installed = $false
        }
    }
    elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        try {
            choco install gh -y
            if ($LASTEXITCODE -eq 0) {
                $installed = $true
            }
        }
        catch {
            $installed = $false
        }
    }
    else {
        Warn "No Windows package manager found."
        Write-Host "  Install GitHub CLI from: https://cli.github.com/"
        return $false
    }

    if ($installed -and (Get-Command gh -ErrorAction SilentlyContinue)) {
        Success "GitHub CLI installed"
        return $true
    }

    Warn "GitHub CLI was installed, but this terminal cannot find it yet."
    Write-Host "  Close and reopen PowerShell, then run the installer again."
    return $false
}

function Ensure-GitHubCliAuth {
    & gh auth status *> $null
    if ($LASTEXITCODE -eq 0) {
        return $true
    }

    Warn "GitHub CLI is not logged in yet."
    Write-Host "  A browser window may open, or GitHub may show a short code to copy."
    Write-Host "  Follow GitHub's instructions, then come back to this terminal."
    Write-Host ""

    if (-not (Read-YesNo -Prompt "Start GitHub login now?" -Default "Y")) {
        return $false
    }

    & gh auth login -h github.com -w
    if ($LASTEXITCODE -ne 0) {
        return $false
    }

    & gh auth status *> $null
    return $LASTEXITCODE -eq 0
}

function Show-GitHubBackupManualFallback {
    param(
        [bool]$IsUpstream
    )

    Write-Host "  Manual fallback:"
    Write-Host "    1. Open https://github.com/new"
    Write-Host "    2. Create a new PRIVATE repository"
    if ($IsUpstream) {
        Write-Host "    3. Run: git remote rename origin upstream"
        Write-Host "    4. Run: git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
        Write-Host "    5. Run: git push -u origin main"
    }
    else {
        Write-Host "    3. Run: git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
        Write-Host "    4. Run: git push -u origin main"
    }
}

function Show-Banner {
    Clear-Host
    Write-Host ""
    Write-Host "    ==============================================" -ForegroundColor Cyan
    Write-Host "                    AI-OS       " -ForegroundColor Cyan
    Write-Host "            Guided First-Time Install" -ForegroundColor Cyan
    Write-Host "    ==============================================" -ForegroundColor Cyan
    if ($AiOsVersion -eq "unknown") {
        Write-Host "    AI-OS version unknown" -ForegroundColor DarkGray
    }
    else {
        Write-Host "    AI-OS v$AiOsVersion" -ForegroundColor DarkGray
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

    if ($Guided) {
        Show-ClaudeCodeWarningIfMissing
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

    if ($CronDryRun -eq "1") {
        Warn "Dry run mode active - skipping memory migration/setup."
        $script:MemoryDecision = "skipped-dry-run"
        return
    }

    if (-not (Test-Path $MemorySetupScript)) {
        Warn "setup-memory.ps1 not found - skipping memory migration/setup."
        $script:MemoryDecision = "unavailable"
        return
    }

    & $PowerShellHost -NoProfile -ExecutionPolicy Bypass -File $MemorySetupScript -Check *> $null
    if ($LASTEXITCODE -eq 0) {
        Success "Memory migration/setup already complete"
        $script:MemoryDecision = "configured"
        return
    }

    Write-Host ""
    Write-Host "  AI-OS will set up semantic memory using the BGE-M3 embedding model."
    Write-Host "  If it is not cached yet, it will be downloaded now and this may take several minutes."

    & $PowerShellHost -NoProfile -ExecutionPolicy Bypass -File $MemorySetupScript
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
        Success "Memory migration/setup finished"
        $script:MemoryDecision = "configured"
        return
    }

    if ($exitCode -eq 3) {
        Warn "Skipped memory migration/setup."
        $script:MemoryDecision = "skipped-confirmation"
        return
    }

    Warn "Memory migration/setup did not finish. You can retry later:"
    Write-Host "    powershell -File scripts\setup-memory.ps1"
    $script:MemoryDecision = "failed"
}

function Setup-GitHubRepo {
    $script:GitHubDecision = "unknown"

    $upstreamOwner = "camrontaylor"
    $upstreamRepo = "AI-OS-Template"
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
        Success ("GitHub backup already configured: " + (Sanitize-GitUrl -Url $originUrl))
        $script:GitHubDecision = "configured"
        return
    }

    Write-Host ""
    Write-Host "GitHub Backup" -ForegroundColor Cyan
    Write-Host "  AI-OS stores your brand, project, and summarized memory data locally."
    Write-Host "  This step can create a private GitHub repository in your account"
    Write-Host "  and push a first backup there."
    Write-Host "  It includes context/memory/*.aos.md so memory can be rebuilt later."
    Write-Host "  Raw transcripts and built memory databases stay local."
    Write-Host ""
    Write-Host "  You need:"
    Write-Host "    - git, which is already required for AI-OS"
    Write-Host "    - GitHub CLI (gh), which helps create the private repo"
    Write-Host "    - a GitHub browser login when gh asks for it"
    Write-Host ""

    if (-not (Read-YesNo -Prompt "Set up private GitHub backup now?")) {
        Warn "Skipped GitHub backup setup."
        $script:GitHubDecision = "skipped"
        return
    }

    if (-not (Install-GitHubCli)) {
        Show-GitHubBackupManualFallback -IsUpstream $isUpstream
        $script:GitHubDecision = "manual-required"
        return
    }

    if (-not (Ensure-GitHubCliAuth)) {
        Warn "GitHub login did not finish."
        Write-Host "  You can run this installer again later, or use the manual fallback:"
        Show-GitHubBackupManualFallback -IsUpstream $isUpstream
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
    Write-Host "  The backup repo will be private by default."
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
        Info "Pushing your first backup..."
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
    Show-GitHubBackupManualFallback -IsUpstream $false
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

    $migrationResult = Invoke-AiOsGsdMigration -RepoRoot $RepoRoot
    if ($migrationResult -eq "declined") {
        Warn "Legacy GSD left in place. Skipped GSD-redux install."
        $script:GsdDecision = "migration-declined"
        return
    }

    if ($migrationResult -ne "cleaned") {
        $reduxVersion = Get-AiOsGsdReduxVersion -RepoRoot $RepoRoot
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

    if (Install-AiOsGsdRedux) {
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

    Write-Host ''
    Write-Host 'Installation Complete' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  Next steps:'
    Write-Host '    1. Run centre or powershell -File scripts/centre.ps1 to open the Command Centre'
    Write-Host '    2. Run claude when you want to start working in the terminal'
    Write-Host ''
}

if ($Repair) {
    Run-RepairMode
    exit 0
}

Run-GuidedMode
