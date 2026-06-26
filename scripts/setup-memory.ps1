[CmdletBinding()]
param(
    [switch]$Check,
    [ValidateSet("claude", "codex", "both", "none")]
    [string]$Target,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$EnvFile = Join-Path $RepoRoot ".env"

function Info($Message) { Write-Host $Message -ForegroundColor Cyan }
function Success($Message) { Write-Host "  [OK] $Message" -ForegroundColor Green }
function Warn($Message) { Write-Host "  [!] $Message" -ForegroundColor Yellow }
function Fail($Message) { Write-Host "  [X] $Message" -ForegroundColor Red }

function Test-WindowsPlatform {
    if ($env:OS -eq "Windows_NT") { return $true }
    try {
        return [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
            [System.Runtime.InteropServices.OSPlatform]::Windows
        )
    }
    catch {
        return $false
    }
}

function Get-EnvValue {
    param([string]$Name)

    $value = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value
    }

    if (Test-Path -LiteralPath $EnvFile) {
        $pattern = "^{0}=(.*)$" -f [regex]::Escape($Name)
        foreach ($line in Get-Content -LiteralPath $EnvFile) {
            if ($line -match $pattern) {
                return $Matches[1].Trim().Trim('"').Trim("'")
            }
        }
    }

    return ""
}

function Set-EnvFileValue {
    param(
        [string]$Name,
        [string]$Value
    )

    if (-not (Test-Path -LiteralPath $EnvFile)) {
        Set-Content -LiteralPath $EnvFile -Value "# Add your API keys here." -Encoding UTF8
    }

    $lines = @(Get-Content -LiteralPath $EnvFile)
    $updated = $false
    $prefix = "$Name="
    $next = New-Object System.Collections.Generic.List[string]

    foreach ($line in $lines) {
        if ($line.StartsWith($prefix)) {
            if (-not $updated) {
                $next.Add("$Name=$Value") | Out-Null
                $updated = $true
            }
        }
        else {
            $next.Add($line) | Out-Null
        }
    }

    if (-not $updated) {
        $next.Add("$Name=$Value") | Out-Null
    }

    Set-Content -LiteralPath $EnvFile -Value $next -Encoding UTF8
}

function Test-CommandAvailable {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-MemSearchInstalled {
    return Test-CommandAvailable -Name "memsearch"
}

function Test-ClaudeAvailable {
    return Test-CommandAvailable -Name "claude"
}

function Test-CodexAvailable {
    return Test-CommandAvailable -Name "codex"
}

function Test-ClaudeMemSearchInstalled {
    if (-not (Test-ClaudeAvailable)) { return $false }
    try {
        $output = & claude plugin list 2>$null | Out-String
        return $output -match "(?im)(^|[\s>])memsearch(@|\s|$)"
    }
    catch {
        return $false
    }
}

function Test-ClaudeMemSearchDisabled {
    $settingsPath = Join-Path $HOME ".claude\settings.json"
    if (Test-Path -LiteralPath $settingsPath) {
        try {
            $settings = Get-Content -LiteralPath $settingsPath -Raw
            if ($settings -match '"memsearch@memsearch-plugins"\s*:\s*false') {
                return $true
            }
        }
        catch {}
    }

    if (Test-ClaudeAvailable) {
        try {
            $output = & claude plugin list 2>$null | Out-String
            if ($output -match '(?is)memsearch@memsearch-plugins.*?Status:\s*.*disabled') {
                return $true
            }
        }
        catch {}
    }

    return $false
}

function Test-ClaudeMemSearchEnabled {
    return (Test-ClaudeMemSearchInstalled) -and (-not (Test-ClaudeMemSearchDisabled))
}

function Test-CodexMemSearchInstalled {
    if (Test-CodexAvailable) {
        try {
            $output = & codex plugin list 2>$null | Out-String
            if ($output -match "(?im)(^|[\s>])memsearch(@|\s|$)") {
                return $true
            }
        }
        catch {}
    }

    $hooksPath = Join-Path $HOME ".codex\hooks.json"
    if (Test-Path -LiteralPath $hooksPath) {
        try {
            $hooks = Get-Content -LiteralPath $hooksPath -Raw
            if ($hooks -match "memsearch") { return $true }
        }
        catch {}
    }

    $skillPath = Join-Path $HOME ".agents\skills\memory-recall"
    return (Test-Path -LiteralPath $skillPath)
}

function Test-ZillizConfigured {
    if (-not (Test-WindowsPlatform)) { return $true }

    $uri = Get-EnvValue -Name "ZILLIZ_URI"
    $token = Get-EnvValue -Name "ZILLIZ_TOKEN"
    return (-not [string]::IsNullOrWhiteSpace($uri)) -and (-not [string]::IsNullOrWhiteSpace($token))
}

function Test-WindowsWatchDisabled {
    if (-not (Test-WindowsPlatform)) { return $true }

    $userValue = [Environment]::GetEnvironmentVariable("MEMSEARCH_NO_WATCH", "User")
    return $userValue -eq "1"
}

function Test-NightlyMemSearchCronActive {
    $jobPath = Join-Path $RepoRoot "cron\jobs\nightly-memsearch-index.md"
    if (-not (Test-Path -LiteralPath $jobPath)) { return $false }

    try {
        $content = Get-Content -LiteralPath $jobPath -Raw
        return $content -match '(?im)^active:\s*[''"]?true[''"]?\s*$'
    }
    catch {
        return $false
    }
}

function Test-MemoryReady {
    if (-not (Test-MemSearchInstalled)) { return $false }
    if (-not (Test-ZillizConfigured)) { return $false }
    if (-not (Test-WindowsWatchDisabled)) { return $false }
    return (Test-ClaudeMemSearchEnabled) -or (Test-CodexMemSearchInstalled)
}

function Show-Status {
    Info "Searchable Memory status"
    Write-Host ""

    if (Test-CommandAvailable -Name "uv") {
        $uvVersion = (& uv --version 2>$null | Out-String).Trim()
        Success "uv found: $uvVersion"
    }
    else {
        Warn "uv missing - needed to install memsearch safely"
    }

    if (Test-MemSearchInstalled) {
        $memVersion = (& memsearch --version 2>$null | Out-String).Trim()
        Success "memsearch found: $memVersion"
    }
    else {
        Warn "memsearch CLI missing"
    }

    if (Test-ClaudeAvailable) {
        if (Test-ClaudeMemSearchInstalled) {
            if (Test-ClaudeMemSearchEnabled) {
                Success "Claude Code MemSearch plugin installed and enabled"
            }
            else {
                Warn "Claude Code MemSearch plugin installed but disabled"
                Write-Host "  Enable if you want Claude Code plugin capture: claude plugin enable memsearch@memsearch-plugins"
            }
        }
        else {
            Warn "Claude Code found, but MemSearch plugin is not installed"
        }
    }
    else {
        Warn "Claude Code CLI not found"
    }

    if (Test-CodexAvailable) {
        if (Test-CodexMemSearchInstalled) {
            Success "Codex MemSearch setup detected"
        }
        else {
            Warn "Codex found, but MemSearch setup was not detected"
        }
    }
    else {
        Warn "Codex CLI not found"
    }

    if (Test-WindowsPlatform) {
        if (Test-ZillizConfigured) {
            Success "Zilliz Cloud values found for Windows backend"
        }
        else {
            Warn "Zilliz Cloud values missing - Windows needs ZILLIZ_URI and ZILLIZ_TOKEN"
        }

        if (Test-WindowsWatchDisabled) {
            Success "MemSearch real-time watch disabled on Windows (MEMSEARCH_NO_WATCH=1)"
        }
        else {
            Warn "MemSearch real-time watch is not disabled on Windows"
        }

        if (Test-NightlyMemSearchCronActive) {
            Success "Nightly MemSearch index job is active"
        }
        else {
            Warn "Nightly MemSearch index job is missing or inactive"
        }

        Info "Automatic indexing runs when Command Centre or the managed cron daemon is running."
    }
    else {
        Success "Milvus Lite local backend available for this platform"
    }

    Write-Host ""
    if (Test-MemoryReady) {
        Success "Searchable memory appears configured"
    }
    else {
        Warn "Searchable memory is not fully configured yet"
    }
}

if ($Check) {
    Show-Status
    if (Test-MemoryReady) { exit 0 }
    exit 1
}

function Show-SkipExplanation {
    Warn "Skipped searchable memory setup."
    Write-Host "  Until it is enabled, older memory search,"
    Write-Host "  expanded recall, and stronger citations will not be available."
}

function Select-Target {
    if ($script:Target) { return }

    Write-Host ""
    Write-Host "Searchable Memory" -ForegroundColor Cyan
    Write-Host "  MemSearch lets Claude Code or Codex search older sessions,"
    Write-Host "  pinned memory, and learnings. AI-OS keeps markdown as the"
    Write-Host "  source of truth; MemSearch is only a rebuildable search index."
    Write-Host ""
    Write-Host "  Choose where to enable it:"
    Write-Host "    1. Claude Code only (recommended)"
    Write-Host "    2. Codex only"
    Write-Host "    3. Claude Code + Codex"
    Write-Host "    4. Skip for now"
    Write-Host ""

    $reply = Read-Host "  Selection [1]"
    if ([string]::IsNullOrWhiteSpace($reply)) { $reply = "1" }

    switch ($reply) {
        "1" { $script:Target = "claude" }
        "2" { $script:Target = "codex" }
        "3" { $script:Target = "both" }
        "4" { $script:Target = "none" }
        default {
            Warn "Unknown selection: $reply"
            $script:Target = "none"
        }
    }
}

function Confirm-Setup {
    if ($Target -eq "none") { return $true }

    Write-Host ""
    Write-Host "What will happen" -ForegroundColor Cyan
    Write-Host "  - Install memsearch with: uv tool install `"memsearch[onnx]`" if missing."
    Write-Host "  - Configure ONNX local embeddings."
    if (Test-WindowsPlatform) {
        Write-Host "  - Use Zilliz Cloud as the Windows vector backend."
        Write-Host "  - Disable real-time MemSearch watch to prevent stuck background processes."
        Write-Host "  - Refresh memory search through the initial index and managed cron runtime."
        Write-Host "  - For a free Zilliz cluster, choose AWS eu-central-1 (Frankfurt)"
        Write-Host "    or GCP us-west-1 (Oregon)."
    }
    else {
        Write-Host "  - Use local Milvus Lite as the vector backend."
    }
    Write-Host "  - Index only AI-OS memory files, not the full repo."
    switch ($Target) {
        "claude" { Write-Host "  - Configure the Claude Code MemSearch plugin." }
        "codex" { Write-Host "  - Configure MemSearch for Codex with the official installer." }
        "both" { Write-Host "  - Configure both Claude Code and Codex." }
    }
    Write-Host ""

    if ($Yes) { return $true }

    $reply = Read-Host "  Continue? [Y/n]"
    if ([string]::IsNullOrWhiteSpace($reply)) { $reply = "Y" }
    return $reply -match "^[Yy]$"
}

function Disable-WindowsWatch {
    if (-not (Test-WindowsPlatform)) { return $true }

    try {
        [Environment]::SetEnvironmentVariable("MEMSEARCH_NO_WATCH", "1", "User")
        $env:MEMSEARCH_NO_WATCH = "1"
    }
    catch {
        Fail "Could not set MEMSEARCH_NO_WATCH in the Windows user environment."
        Write-Host "  Error: $($_.Exception.Message)"
        return $false
    }

    Success "Disabled real-time MemSearch watch on Windows (MEMSEARCH_NO_WATCH=1)"
    Warn "Restart Claude Code, Codex, and any open terminals for this to take effect."
    Info "Automatic memory refresh uses Command Centre or the managed cron daemon."
    Info "Daemon command: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-crons.ps1"
    return $true
}

function Ensure-MemSearchCli {
    $localBin = Join-Path $HOME ".local\bin"
    if ($env:PATH -notlike "*$localBin*") {
        $env:PATH = "$localBin;$env:PATH"
    }

    if (Test-MemSearchInstalled) {
        Success "memsearch CLI already installed"
        return $true
    }

    if (-not (Test-CommandAvailable -Name "uv")) {
        Fail "uv is required to install memsearch."
        Write-Host "  Run AI-OS dependency setup first:"
        Write-Host "    powershell -File scripts\setup.ps1"
        return $false
    }

    Info "Installing memsearch[onnx] with uv..."
    # memsearch requires Python >=3.10. Pin a managed interpreter so uv provisions
    # a compatible one instead of failing on an older system python.
    & uv tool install --python 3.12 "memsearch[onnx]"
    if ($LASTEXITCODE -ne 0) {
        Fail "memsearch install failed."
        Write-Host "  You can retry manually:"
        Write-Host "    uv tool install --python 3.12 `"memsearch[onnx]`""
        return $false
    }

    if (Test-MemSearchInstalled) {
        Success "memsearch CLI installed"
        return $true
    }

    Warn "memsearch was installed, but it is not visible on PATH yet."
    Write-Host "  Open a new terminal and re-run this script."
    return $false
}

function Ensure-BackendConfig {
    if (Test-WindowsPlatform) {
        $zillizUri = Get-EnvValue -Name "ZILLIZ_URI"
        $zillizToken = Get-EnvValue -Name "ZILLIZ_TOKEN"

        if ([string]::IsNullOrWhiteSpace($zillizUri) -or [string]::IsNullOrWhiteSpace($zillizToken)) {
            Write-Host ""
            Warn "Windows needs a free Zilliz Cloud cluster for MemSearch."
            Write-Host "  Milvus Lite does not currently support native Windows."
            Write-Host "  When creating the free cluster, choose one of the free regions:"
            Write-Host "    - AWS eu-central-1 (Frankfurt)"
            Write-Host "    - GCP us-west-1 (Oregon)"
            Write-Host "  Other regions may require a paid Zilliz plan."
            Write-Host "  Opening Zilliz Cloud in your browser..."
            Start-Process "https://cloud.zilliz.com"
            Write-Host ""

            $zillizUri = Read-Host "  Paste your Zilliz cluster URI"
            $secureToken = Read-Host "  Paste your Zilliz API token" -AsSecureString
            $tokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
            try {
                $zillizToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPtr)
            }
            finally {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPtr)
            }

            if ([string]::IsNullOrWhiteSpace($zillizUri) -or [string]::IsNullOrWhiteSpace($zillizToken)) {
                Fail "Zilliz URI and token are required on Windows."
                Write-Host "  Add them to .env, or use WSL/Linux with the local backend."
                return $false
            }

            Set-EnvFileValue -Name "ZILLIZ_URI" -Value $zillizUri
            Set-EnvFileValue -Name "ZILLIZ_TOKEN" -Value $zillizToken
            Success "Saved Zilliz values to .env"
        }

        & memsearch config set milvus.uri $zillizUri | Out-Null
        if ($LASTEXITCODE -ne 0) { return $false }
        & memsearch config set milvus.token $zillizToken | Out-Null
        if ($LASTEXITCODE -ne 0) { return $false }
        Success "Zilliz Cloud backend configured"
    }
    else {
        Success "Using local Milvus Lite backend"
    }

    & memsearch config set embedding.provider onnx | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
    Success "ONNX embeddings configured"
    return $true
}

function Invoke-InitialIndex {
    $paths = New-Object System.Collections.Generic.List[string]

    $candidates = @(
        @{ Path = "context\MEMORY.md"; Arg = "context/MEMORY.md" },
        @{ Path = "context\memory"; Arg = "context/memory/" },
        @{ Path = "context\learnings.md"; Arg = "context/learnings.md" }
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath (Join-Path $RepoRoot $candidate.Path)) {
            $paths.Add($candidate.Arg) | Out-Null
        }
    }

    $clientsRoot = Join-Path $RepoRoot "clients"
    if (Test-Path -LiteralPath $clientsRoot -PathType Container) {
        foreach ($clientDir in Get-ChildItem -LiteralPath $clientsRoot -Directory) {
            $contextDir = Join-Path $clientDir.FullName "context"
            if (-not (Test-Path -LiteralPath $contextDir -PathType Container)) {
                continue
            }

            $relativePrefix = "clients/{0}/context" -f $clientDir.Name
            $clientMemory = Join-Path $contextDir "MEMORY.md"
            $clientDaily = Join-Path $contextDir "memory"
            $clientLearnings = Join-Path $contextDir "learnings.md"

            if (Test-Path -LiteralPath $clientMemory) {
                $paths.Add("$relativePrefix/MEMORY.md") | Out-Null
            }
            if (Test-Path -LiteralPath $clientDaily -PathType Container) {
                $paths.Add("$relativePrefix/memory/") | Out-Null
            }
            if (Test-Path -LiteralPath $clientLearnings) {
                $paths.Add("$relativePrefix/learnings.md") | Out-Null
            }
        }
    }

    if ($paths.Count -eq 0) {
        Warn "No memory files found to index yet."
        return $true
    }

    $reindexScript = Join-Path $RepoRoot "scripts/memsearch-reindex.sh"
    $bashCommand = Get-Command bash -ErrorAction SilentlyContinue
    $finishCommand = if ((Test-Path $reindexScript -PathType Leaf) -and $bashCommand) {
        "bash scripts/memsearch-reindex.sh"
    }
    else {
        "memsearch index $($paths -join ' ')"
    }

    Info "Running initial MemSearch index..."
    Write-Host ""
    Write-Host "  First run downloads a local ONNX embedding model (~17 MB) from Hugging Face."
    Write-Host "  It is cached after this, so it only happens once."
    Write-Host ""
    Write-Host "  The progress bar can sit at 0% for a bit while the connection is established."
    Write-Host "  That is normal, not frozen."
    Write-Host ""
    Write-Host "  This step is optional and rebuildable. It is safe to interrupt with Ctrl+C"
    Write-Host "  and finish later with the command shown below; downloads resume from cache."
    Write-Host ""

    # Make the first-run Hugging Face download robust. Respect any values the user
    # already set. hf_transfer (the Rust fast path) is a known source of 0%-stalls
    # on Windows, so default it off and fall back to the reliable Python downloader;
    # raise the default 10s timeout for slow handshakes.
    if (-not $env:HF_HUB_DOWNLOAD_TIMEOUT) { $env:HF_HUB_DOWNLOAD_TIMEOUT = "60" }
    if (-not $env:HF_HUB_ENABLE_HF_TRANSFER) { $env:HF_HUB_ENABLE_HF_TRANSFER = "0" }
    if (-not $env:HF_HUB_DISABLE_TELEMETRY) { $env:HF_HUB_DISABLE_TELEMETRY = "1" }
    if (-not $env:HF_TOKEN) {
        $hfToken = Get-EnvValue -Name "HF_TOKEN"
        if (-not [string]::IsNullOrWhiteSpace($hfToken)) { $env:HF_TOKEN = $hfToken }
    }

    Push-Location $RepoRoot
    try {
        $pathArgs = $paths.ToArray()
        if ((Test-Path $reindexScript -PathType Leaf) -and $bashCommand) {
            & bash scripts/memsearch-reindex.sh
        }
        else {
            & memsearch index @pathArgs
        }
        if ($LASTEXITCODE -eq 0) {
            return $true
        }

        Warn "Initial index did not finish (it was interrupted or the model download failed)."
        Write-Host "  Your setup is otherwise complete. The index is rebuildable and your"
        Write-Host "  markdown memory remains the source of truth. Finish it anytime with:"
        Write-Host "    $finishCommand"
        # Treat an unfinished index as a recoverable warning, not a hard setup failure.
        return $true
    }
    finally {
        Pop-Location
    }
}

function Install-ClaudePlugin {
    if (-not (Test-ClaudeAvailable)) {
        Warn "Claude Code CLI not found. Install Claude Code, then run this script again."
        return $false
    }

    if (Test-ClaudeMemSearchInstalled) {
        if (Test-ClaudeMemSearchEnabled) {
            Success "Claude Code MemSearch plugin already installed and enabled"
        }
        else {
            Warn "Claude Code MemSearch plugin is installed but disabled."
            Write-Host "  Enable it with: claude plugin enable memsearch@memsearch-plugins"
        }
        return $true
    }

    Info "Configuring Claude Code MemSearch plugin..."
    & claude plugin marketplace add zilliztech/memsearch --scope user
    if ($LASTEXITCODE -ne 0) {
        Warn "Could not add the MemSearch Claude Code marketplace automatically."
        Write-Host "  Manual commands:"
        Write-Host "    claude plugin marketplace add zilliztech/memsearch --scope user"
        Write-Host "    claude plugin install memsearch --scope user"
        return $false
    }

    & claude plugin install memsearch --scope user
    if ($LASTEXITCODE -ne 0) {
        Warn "Could not install the Claude Code MemSearch plugin automatically."
        Write-Host "  Manual command:"
        Write-Host "    claude plugin install memsearch --scope user"
        return $false
    }

    Success "Claude Code MemSearch plugin installed"
    Warn "Restart Claude Code to activate the plugin."
    return $true
}

function Install-CodexPlugin {
    if (-not (Test-CodexAvailable)) {
        Warn "Codex CLI not found. Install Codex, then run this script again."
        return $false
    }

    if (Test-CodexMemSearchInstalled) {
        Success "Codex MemSearch setup already detected"
        return $true
    }

    if (-not (Test-CommandAvailable -Name "git")) {
        Fail "git is required to fetch the official MemSearch Codex installer."
        return $false
    }

    $cacheRoot = if ($env:AGENTIC_OS_MEMSEARCH_CACHE) {
        $env:AGENTIC_OS_MEMSEARCH_CACHE
    }
    elseif ($env:LOCALAPPDATA) {
        Join-Path $env:LOCALAPPDATA "AgenticOS\memsearch"
    }
    else {
        Join-Path $HOME ".cache\agentic-os\memsearch"
    }
    $installer = Join-Path $cacheRoot "plugins\codex\scripts\install.sh"

    Info "Fetching official MemSearch Codex installer..."
    if (Test-Path -LiteralPath (Join-Path $cacheRoot ".git")) {
        & git -C $cacheRoot pull --ff-only
    }
    elseif (Test-Path -LiteralPath $cacheRoot) {
        Fail "MemSearch cache path exists but is not a git repo: $cacheRoot"
        return $false
    }
    else {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cacheRoot) | Out-Null
        & git clone https://github.com/zilliztech/memsearch.git $cacheRoot
    }

    if ($LASTEXITCODE -ne 0) {
        return $false
    }

    if (-not (Test-Path -LiteralPath $installer)) {
        Fail "Codex installer not found at $installer"
        Write-Host "  Native setup may be blocked. Use WSL/Linux or follow:"
        Write-Host "  https://zilliztech.github.io/memsearch/platforms/codex/installation/"
        return $false
    }

    if (Test-CommandAvailable -Name "bash") {
        & bash $installer
    }
    else {
        & $installer
    }

    if ($LASTEXITCODE -ne 0) { return $false }
    Success "Codex MemSearch setup finished"
    return $true
}

Select-Target

if ($Target -eq "none") {
    Show-SkipExplanation
    exit 0
}

if (-not (Confirm-Setup)) {
    Show-SkipExplanation
    exit 3
}

$errors = 0

if (-not (Disable-WindowsWatch)) { $errors++ }

if (-not (Ensure-MemSearchCli)) { $errors++ }

if (Test-MemSearchInstalled) {
    if (-not (Ensure-BackendConfig)) { $errors++ }
    if (-not (Invoke-InitialIndex)) { $errors++ }
}

switch ($Target) {
    "claude" {
        if (-not (Install-ClaudePlugin)) { $errors++ }
    }
    "codex" {
        if (-not (Install-CodexPlugin)) { $errors++ }
    }
    "both" {
        if (-not (Install-ClaudePlugin)) { $errors++ }
        if (-not (Install-CodexPlugin)) { $errors++ }
    }
}

Write-Host ""
if ($errors -eq 0) {
    Success "Searchable memory setup complete"
    Write-Host "  Ask naturally about older decisions once your agent has restarted."
    exit 0
}

Fail "$errors searchable memory setup step(s) need attention"
Write-Host "  Re-run this script after fixing the issue. MemSearch indexes are rebuildable,"
Write-Host "  and AI-OS markdown memory remains the source of truth."
exit 1
