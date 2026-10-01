[CmdletBinding()]
param(
    [switch]$Check,
    [ValidateSet("auto", "local", "pglite", "postgres", "hosted")]
    [string]$Backend = "auto",
    [string]$Target,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$CommandCentreDir = Join-Path $RepoRoot "command-centre"
$EnvFile = Join-Path $RepoRoot ".env"
$LocalMemoryDir = Join-Path $RepoRoot ".command-centre\memory"
$ModelCacheDir = Join-Path $RepoRoot ".command-centre\models"
$ExpectedMemoryModel = "bge-m3"
$ExpectedMemoryDim = 1024
$LegacyLocalMemoryDir = ""
$LocalMemoryRebuilt = $false

function Info($Message) { Write-Host $Message -ForegroundColor Cyan }
function Success($Message) { Write-Host "  [OK] $Message" -ForegroundColor Green }
function Warn($Message) { Write-Host "  [!] $Message" -ForegroundColor Yellow }
function Fail($Message) { Write-Host "  [X] $Message" -ForegroundColor Red }

if ($Backend -eq "pglite") { $Backend = "local" }
if ($Backend -eq "hosted") { $Backend = "postgres" }

function Get-EnvValue {
    param([string]$Name)

    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value
    }

    if (Test-Path -LiteralPath $EnvFile) {
        $pattern = "^\s*(?:export\s+)?{0}=(.*)$" -f [regex]::Escape($Name)
        foreach ($line in Get-Content -LiteralPath $EnvFile) {
            if ($line -match "^\s*#") { continue }
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
    $pattern = "^\s*(?:export\s+)?{0}=" -f [regex]::Escape($Name)
    $next = New-Object System.Collections.Generic.List[string]

    foreach ($line in $lines) {
        if ($line -match $pattern) {
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

function Get-HostedEnvName {
    if (-not [string]::IsNullOrWhiteSpace((Get-EnvValue -Name "MEMORY_DATABASE_URL"))) {
        return "MEMORY_DATABASE_URL"
    }
    if (-not [string]::IsNullOrWhiteSpace((Get-EnvValue -Name "DATABASE_URL"))) {
        return "DATABASE_URL"
    }
    return ""
}

function Test-HostedConfigured {
    return -not [string]::IsNullOrWhiteSpace((Get-HostedEnvName))
}

function Export-HostedUrl {
    $name = Get-HostedEnvName
    if ([string]::IsNullOrWhiteSpace($name)) { return $false }
    $value = Get-EnvValue -Name $name
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
    return $true
}

function Test-LocalMemoryExists {
    return Test-Path -LiteralPath $LocalMemoryDir
}

function Show-MemoryDownloadNotice {
    Write-Host "  AI-OS will set up semantic memory using the BGE-M3 embedding model."
    Write-Host "  If the model is not cached yet, it will be downloaded now and this may take several minutes."
    Write-Host "  Model cache: $(Get-RelativePath -PathValue $ModelCacheDir)"
}

function Clear-BgeM3ModelCache {
    $modelDir = Join-Path $ModelCacheDir "Xenova\bge-m3"
    try {
        Assert-WithinRepoCommandCentre -PathValue $modelDir | Out-Null
        if (Test-Path -LiteralPath $modelDir) {
            Warn "Clearing the cached BGE-M3 model files before retrying."
            Remove-Item -LiteralPath $modelDir -Recurse -Force
            Success "Cleared BGE-M3 model cache"
        }
        else {
            Warn "BGE-M3 model cache was not present; retrying download."
        }
        return $true
    }
    catch {
        Warn "Could not clear BGE-M3 model cache: $($_.Exception.Message)"
        return $false
    }
}

function Test-MemoryStoreCompatible {
    if (-not (Test-Path -LiteralPath (Join-Path $CommandCentreDir "package.json"))) { return $false }
    if (-not (Test-CommandAvailable -Name "npm")) { return $false }
    if (-not (Test-HostedConfigured) -and -not (Test-LocalMemoryExists)) { return $false }

    $oldBackend = [Environment]::GetEnvironmentVariable("MEMORY_STORE_BACKEND", "Process")
    $oldEmbedder = [Environment]::GetEnvironmentVariable("MEMORY_EMBEDDER", "Process")
    $oldCache = [Environment]::GetEnvironmentVariable("MEMORY_MODEL_CACHE_DIR", "Process")
    try {
        if ($script:Backend -ne "auto") {
            $nodeBackend = if ($script:Backend -eq "local") { "pglite" } else { $script:Backend }
            [Environment]::SetEnvironmentVariable("MEMORY_STORE_BACKEND", $nodeBackend, "Process")
        }
        [Environment]::SetEnvironmentVariable("MEMORY_EMBEDDER", $ExpectedMemoryModel, "Process")
        [Environment]::SetEnvironmentVariable("MEMORY_MODEL_CACHE_DIR", $ModelCacheDir, "Process")
        $json = & npm --silent --prefix $CommandCentreDir run memory:status -- --json 2>$null | Out-String
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($json)) { return $false }
        $status = $json | ConvertFrom-Json
        return ($status.storeReady -eq $true) -and
            ($status.embeddingCompatible -eq $true) -and
            ($status.expectedEmbeddingModel -eq $ExpectedMemoryModel) -and
            ([int]$status.expectedEmbeddingDim -eq $ExpectedMemoryDim) -and
            ([int]$status.embedDim -eq $ExpectedMemoryDim)
    }
    catch {
        return $false
    }
    finally {
        [Environment]::SetEnvironmentVariable("MEMORY_STORE_BACKEND", $oldBackend, "Process")
        [Environment]::SetEnvironmentVariable("MEMORY_EMBEDDER", $oldEmbedder, "Process")
        [Environment]::SetEnvironmentVariable("MEMORY_MODEL_CACHE_DIR", $oldCache, "Process")
    }
}

function Assert-WithinRepoCommandCentre {
    param([string]$PathValue)
    $resolved = [System.IO.Path]::GetFullPath($PathValue)
    $root = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ".command-centre"))
    if (-not $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify path outside .command-centre: $resolved"
    }
    return $resolved
}

function Get-MemSearchDirs {
    $dirs = New-Object System.Collections.Generic.List[string]
    $rootMemSearch = Join-Path $RepoRoot ".memsearch"
    if (Test-Path -LiteralPath $rootMemSearch) {
        $dirs.Add($rootMemSearch) | Out-Null
    }

    $clientsDir = Join-Path $RepoRoot "clients"
    if (Test-Path -LiteralPath $clientsDir) {
        Get-ChildItem -LiteralPath $clientsDir -Directory -Filter ".memsearch" -Recurse -ErrorAction SilentlyContinue |
            ForEach-Object { $dirs.Add($_.FullName) | Out-Null }
    }

    return @($dirs | Sort-Object)
}

function Test-MemSearchDirsPresent {
    return @((Get-MemSearchDirs)).Count -gt 0
}

function Test-CommandAvailable {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-ClaudeMemSearchInstalled {
    if (-not (Test-CommandAvailable -Name "claude")) { return $false }
    try {
        $output = & claude plugin list 2>$null | Out-String
        return $output -match "(?im)(^|[\s>])memsearch(@|\s|$)"
    }
    catch {
        return $false
    }
}

function Get-ClaudeMemSearchScopes {
    if (-not (Test-CommandAvailable -Name "claude")) { return @() }

    try {
        $lines = @(& claude plugin list 2>$null)
    }
    catch {
        return @()
    }

    $scopes = New-Object System.Collections.Generic.List[string]
    $inMemSearch = $false

    foreach ($line in $lines) {
        if ($line -match "^\s*>?\s*memsearch(@|\s|$)") {
            $inMemSearch = $true
            continue
        }

        if ($inMemSearch -and $line -match "^\s*Scope:\s*(user|project|local)\b") {
            $scopes.Add($matches[1].ToLowerInvariant()) | Out-Null
            $inMemSearch = $false
            continue
        }

        if ($line -match "^\s*>\s*") {
            $inMemSearch = $false
        }
    }

    return @($scopes | Select-Object -Unique)
}

function Test-CodexMemSearchInstalled {
    if (-not (Test-CommandAvailable -Name "codex")) { return $false }
    try {
        $output = & codex plugin list 2>$null | Out-String
        return $output -match "(?im)(^|[\s>])memsearch(@|\s|$)"
    }
    catch {
        return $false
    }
}

function Test-CodexMemSearchHooksPresent {
    $hooksPath = Join-Path $HOME ".codex\hooks.json"
    if (-not (Test-Path -LiteralPath $hooksPath)) { return $false }
    try {
        return (Get-Content -LiteralPath $hooksPath -Raw) -match "memsearch"
    }
    catch {
        return $false
    }
}

function Test-UvMemSearchInstalled {
    if (-not (Test-CommandAvailable -Name "uv")) { return $false }
    try {
        $output = & uv tool list 2>$null | Out-String
        return $output -match "(?im)(^|[\s-])memsearch(\s|$)"
    }
    catch {
        return $false
    }
}

function Test-MemSearchCliPresent {
    return Test-UvMemSearchInstalled
}

function Test-LegacyMemSearchPresent {
    return (Test-MemSearchDirsPresent) -or
        (Test-MemSearchCliPresent) -or
        (Test-ClaudeMemSearchInstalled) -or
        (Test-CodexMemSearchInstalled) -or
        (Test-CodexMemSearchHooksPresent)
}

function Test-MemoryReady {
    if (-not (Test-HostedConfigured) -and -not (Test-LocalMemoryExists)) { return $false }
    return (-not (Test-LegacyMemSearchPresent)) -and (Test-MemoryStoreCompatible)
}

function Show-Status {
    Info "Memory migration/setup status"
    Write-Host ""

    if (Test-HostedConfigured) {
        Success "Hosted Postgres URL found"
    }
    elseif (Test-LocalMemoryExists) {
        Success "Local PGLite store found"
    }
    else {
        Warn "No memory store is configured yet"
    }

    if (Test-MemoryStoreCompatible) {
        Success "Memory embeddings use $ExpectedMemoryModel ($ExpectedMemoryDim dimensions)"
    }
    else {
        Warn "Memory embeddings need setup or upgrade to $ExpectedMemoryModel ($ExpectedMemoryDim dimensions)"
    }

    if (Test-MemSearchDirsPresent) {
        Warn "Legacy .memsearch folders detected and need migration"
    }
    else {
        Success "No legacy .memsearch folders found"
    }

    if (Test-ClaudeMemSearchInstalled) { Warn "Claude Code MemSearch plugin is still installed" }
    if (Test-CodexMemSearchInstalled) { Warn "Codex MemSearch plugin is still installed" }
    if (Test-CodexMemSearchHooksPresent) { Warn "Codex MemSearch hooks are still present" }
    if ((Test-UvMemSearchInstalled) -or (Test-CommandAvailable -Name "memsearch")) {
        Warn "MemSearch CLI/tool is still installed"
    }

    Write-Host ""
    if (Test-MemoryReady) {
        Success "Memory migration/setup is complete"
    }
    else {
        Warn "Memory migration/setup still needs to run"
    }
}

if ($Check) {
    Show-Status
    if (Test-MemoryReady) { exit 0 }
    exit 1
}

function Select-Backend {
    if ($Target -eq "none") {
        Warn "Skipped memory migration/setup."
        exit 3
    }
    if (-not [string]::IsNullOrWhiteSpace($Target)) {
        Warn "-Target is deprecated. AI-OS now configures memory through PGLite or Postgres."
    }

    if ($script:Backend -ne "auto") { return }

    if (Test-HostedConfigured) {
        $script:Backend = "postgres"
        return
    }

    if (Test-LocalMemoryExists) {
        $script:Backend = "local"
        return
    }

    if ($Yes -or [Console]::IsInputRedirected) {
        $script:Backend = "local"
        return
    }

    Write-Host ""
    Write-Host "  Choose a memory store:"
    Write-Host "    1. Local PGLite (recommended)"
    Write-Host "    2. Hosted Postgres"
    Write-Host "    3. Skip for now"
    Write-Host ""

    $reply = Read-Host "  Selection [1]"
    if ([string]::IsNullOrWhiteSpace($reply)) { $reply = "1" }

    switch ($reply) {
        "1" { $script:Backend = "local" }
        "2" { $script:Backend = "postgres" }
        "3" {
            Warn "Skipped memory migration/setup."
            exit 3
        }
        default {
            Warn "Unknown selection: $reply. Using local PGLite."
            $script:Backend = "local"
        }
    }
}

function Ensure-PostgresUrl {
    if (Export-HostedUrl) { return $true }

    if ($Yes -or [Console]::IsInputRedirected) {
        Fail "Hosted Postgres was selected, but MEMORY_DATABASE_URL or DATABASE_URL is not set."
        Write-Host "  Add it to .env or rerun with -Backend local."
        return $false
    }

    Write-Host ""
    $url = Read-Host "  Paste your hosted Postgres URL"
    if ([string]::IsNullOrWhiteSpace($url)) {
        Fail "A Postgres URL is required for hosted memory."
        return $false
    }

    Set-EnvFileValue -Name "MEMORY_DATABASE_URL" -Value $url
    [Environment]::SetEnvironmentVariable("MEMORY_DATABASE_URL", $url, "Process")
    Success "Saved MEMORY_DATABASE_URL to .env"
    return $true
}

function Test-CommandCentreDepsNeedInstall {
    $nodeModules = Join-Path $CommandCentreDir "node_modules"
    $lockFile = Join-Path $CommandCentreDir "package-lock.json"
    $npmMarker = Join-Path $nodeModules ".package-lock.json"

    if (-not (Test-Path -LiteralPath $nodeModules)) { return $true }
    if (-not (Test-Path -LiteralPath $npmMarker)) { return $true }
    if ((Test-Path -LiteralPath $lockFile) -and
        ((Get-Item -LiteralPath $lockFile).LastWriteTime -gt (Get-Item -Force -LiteralPath $npmMarker).LastWriteTime)) {
        return $true
    }

    & npm --prefix $CommandCentreDir ls --depth=0 *> $null
    return $LASTEXITCODE -ne 0
}

function Test-CommandCentreDepsReady {
    & npm --prefix $CommandCentreDir ls --depth=0 *> $null
    return $LASTEXITCODE -eq 0
}

function Show-DependencyRepairFailure {
    Fail "Command Centre dependencies could not be installed."
    Write-Host "  Memory migration did not run, and old .memsearch data was not archived."
    Write-Host "  Try this, then run memory setup again:"
    Write-Host "    cd command-centre; npm ci"
}

function Ensure-CommandCentreReady {
    if (-not (Test-Path -LiteralPath (Join-Path $CommandCentreDir "package.json"))) {
        Fail "command-centre/package.json was not found."
        return $false
    }

    if (-not (Test-CommandAvailable -Name "npm")) {
        Fail "npm is required for the new memory setup."
        Write-Host "  Run the dependency setup first, then retry:"
        Write-Host "    powershell -File scripts\setup.ps1"
        return $false
    }

    if (Test-CommandCentreDepsNeedInstall) {
        Info "Installing or repairing Command Centre dependencies..."
        & npm --prefix $CommandCentreDir ci
        if ($LASTEXITCODE -ne 0) {
            Show-DependencyRepairFailure
            return $false
        }
        Success "Command Centre dependencies installed"
    }

    if (-not (Test-CommandCentreDepsReady)) {
        Show-DependencyRepairFailure
        return $false
    }

    Success "Command Centre dependencies ready"
    return $true
}

function Get-RelativePath {
    # [System.IO.Path]::GetRelativePath only exists on .NET Core/.NET (pwsh), not on the
    # .NET Framework that Windows PowerShell 5.1 runs on. Uri.MakeRelativeUri works on both.
    param([string]$PathValue)
    $base = [System.IO.Path]::GetFullPath($RepoRoot)
    if (-not $base.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $base += [System.IO.Path]::DirectorySeparatorChar
    }
    $target = [System.IO.Path]::GetFullPath($PathValue)
    $baseUri = New-Object System.Uri($base)
    $targetUri = New-Object System.Uri($target)
    $relative = [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString())
    return $relative.Replace("\", "/")
}

function Get-ReindexArgs {
    $reindexArgs = New-Object System.Collections.Generic.List[string]
    $roots = @(
        "context/memory",
        ".memsearch/memory",
        "context/learnings.md"
    )

    foreach ($root in $roots) {
        if (Test-Path -LiteralPath (Join-Path $RepoRoot $root)) {
            $reindexArgs.Add("--root") | Out-Null
            $reindexArgs.Add($root) | Out-Null
        }
    }

    $clientsDir = Join-Path $RepoRoot "clients"
    if (Test-Path -LiteralPath $clientsDir) {
        Get-ChildItem -LiteralPath $clientsDir -Directory -Filter "memory" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "[\\/]\.memsearch[\\/]memory$" } |
            Sort-Object FullName |
            ForEach-Object {
                $reindexArgs.Add("--root") | Out-Null
                $reindexArgs.Add((Get-RelativePath -PathValue $_.FullName)) | Out-Null
            }
    }

    return @($reindexArgs)
}

function Invoke-NpmScript {
    param(
        [string]$ScriptName,
        [string[]]$ScriptArgs = @()
    )

    $oldEmbedder = [Environment]::GetEnvironmentVariable("MEMORY_EMBEDDER", "Process")
    $oldCache = [Environment]::GetEnvironmentVariable("MEMORY_MODEL_CACHE_DIR", "Process")
    try {
        [Environment]::SetEnvironmentVariable("MEMORY_EMBEDDER", $ExpectedMemoryModel, "Process")
        [Environment]::SetEnvironmentVariable("MEMORY_MODEL_CACHE_DIR", $ModelCacheDir, "Process")

        if ($ScriptArgs.Count -gt 0) {
            & npm --prefix $CommandCentreDir run $ScriptName -- @ScriptArgs
        }
        else {
            & npm --prefix $CommandCentreDir run $ScriptName
        }
        return $LASTEXITCODE -eq 0
    }
    finally {
        [Environment]::SetEnvironmentVariable("MEMORY_EMBEDDER", $oldEmbedder, "Process")
        [Environment]::SetEnvironmentVariable("MEMORY_MODEL_CACHE_DIR", $oldCache, "Process")
    }
}

# Robust BGE-M3 model prefetch. transformers.js's downloader mis-reads
# Content-Length across HuggingFace's Xet 302 redirect (the redirect body reports a
# tiny length; the real size only appears on the final CDN 200) and can leave a
# truncated model_quantized.onnx -> "Protobuf parsing failed". curl.exe follows the
# redirect, reads the real size from the CDN, resumes (-C -), and we verify the byte
# count. Best-effort: any problem falls back to the loader's own download.
function Invoke-BgeM3Prefetch {
    try {
        if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { return }

        $base = $env:MEMORY_MODEL_BASE_URL
        if ([string]::IsNullOrWhiteSpace($base)) {
            $base = "https://huggingface.co/Xenova/bge-m3/resolve/main"
        }

        $dest = Join-Path $ModelCacheDir "Xenova\bge-m3"
        New-Item -ItemType Directory -Force -Path (Join-Path $dest "onnx") | Out-Null

        foreach ($f in @("config.json", "tokenizer.json", "tokenizer_config.json")) {
            $fp = Join-Path $dest $f
            if ((Test-Path -LiteralPath $fp) -and ((Get-Item -LiteralPath $fp).Length -gt 0)) { continue }
            & curl.exe -fL --retry 5 --retry-delay 3 -o $fp "$base/$f" 2>$null
        }

        $target = Join-Path $dest "onnx\model_quantized.onnx"
        $url = "$base/onnx/model_quantized.onnx"

        $remote = $null
        $headers = & curl.exe -fsIL --max-time 60 $url 2>$null
        foreach ($line in $headers) {
            if ($line -match '^\s*[Cc]ontent-[Ll]ength:\s*(\d+)\s*$') { $remote = [int64]$Matches[1] }
        }
        if (-not $remote) { return }   # can't verify size -> let the loader handle it

        for ($attempt = 1; $attempt -le 3; $attempt++) {
            $size = if (Test-Path -LiteralPath $target) { (Get-Item -LiteralPath $target).Length } else { 0 }
            if ($size -eq $remote) { return }
            Info ("  Fetching BGE-M3 model (~{0} MB), attempt {1} - resumable..." -f [math]::Round($remote / 1MB), $attempt)
            & curl.exe -fL --retry 5 --retry-delay 3 -C - -o $target $url 2>$null
        }

        # Still wrong after retries: drop the truncated file so the loader's
        # cache-repair path starts clean instead of parsing a corrupt ONNX.
        $size = if (Test-Path -LiteralPath $target) { (Get-Item -LiteralPath $target).Length } else { 0 }
        if ($size -ne $remote) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
    }
    catch {
        # best-effort: fall back to the loader's own download
    }
}

function Invoke-ModelWarmup {
    Show-MemoryDownloadNotice
    Invoke-BgeM3Prefetch
    if (Invoke-NpmScript -ScriptName "memory:warmup") {
        return $true
    }

    Warn "BGE-M3 model warmup failed. Repairing the model cache and trying once more."
    if (-not (Clear-BgeM3ModelCache)) { return $false }
    Invoke-BgeM3Prefetch
    return Invoke-NpmScript -ScriptName "memory:warmup"
}

function Initialize-LocalMemoryIdentity {
    $helper = Join-Path $CommandCentreDir "scripts\local-memory-identity.cjs"
    if (-not (Test-Path -LiteralPath $helper)) {
        Fail "Local memory identity helper was not found."
        return $false
    }
    & node $helper --ensure --root $RepoRoot *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail "Could not preserve the local memory owner before rebuilding the store."
        return $false
    }
    return $true
}

function Prepare-LocalStoreForRebuild {
    $script:LocalMemoryRebuilt = $false
    $script:LegacyLocalMemoryDir = ""

    if ($Backend -ne "local") { return $true }
    if (-not (Test-Path -LiteralPath $LocalMemoryDir)) { return $true }

    # The compatibility probe can open PGLite and quarantine a corrupt index.
    # Promote/validate the legacy owner before that first open.
    if (-not (Initialize-LocalMemoryIdentity)) { return $false }

    if (Test-MemoryStoreCompatible) { return $true }

    Warn "Your memory index was built with an older embedding model. AI-OS will rebuild and reindex it."
    $parent = Split-Path -Parent $LocalMemoryDir
    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
    $legacy = Join-Path $parent "memory-legacy-384-$timestamp"
    Assert-WithinRepoCommandCentre -PathValue $LocalMemoryDir | Out-Null
    Assert-WithinRepoCommandCentre -PathValue $legacy | Out-Null
    Move-Item -LiteralPath $LocalMemoryDir -Destination $legacy
    $script:LegacyLocalMemoryDir = $legacy
    $script:LocalMemoryRebuilt = $true
    Success "Moved old local memory store to $(Get-RelativePath -PathValue $legacy)"
    return $true
}

function Restore-LegacyLocalStore {
    if (-not $script:LocalMemoryRebuilt -or [string]::IsNullOrWhiteSpace($script:LegacyLocalMemoryDir)) {
        return
    }
    Assert-WithinRepoCommandCentre -PathValue $LocalMemoryDir | Out-Null
    Assert-WithinRepoCommandCentre -PathValue $script:LegacyLocalMemoryDir | Out-Null
    if (Test-Path -LiteralPath $LocalMemoryDir) {
        Remove-Item -LiteralPath $LocalMemoryDir -Recurse -Force
    }
    Move-Item -LiteralPath $script:LegacyLocalMemoryDir -Destination $LocalMemoryDir
    Warn "Restored the previous local memory store because migration did not finish."
}

function Finalize-LegacyLocalStore {
    if (-not $script:LocalMemoryRebuilt -or [string]::IsNullOrWhiteSpace($script:LegacyLocalMemoryDir)) {
        return $true
    }
    if (-not (Test-MemoryStoreCompatible)) {
        Warn "New memory store did not validate after reindex."
        return $false
    }
    Assert-WithinRepoCommandCentre -PathValue $script:LegacyLocalMemoryDir | Out-Null
    Remove-Item -LiteralPath $script:LegacyLocalMemoryDir -Recurse -Force
    Success "Migration finished. The old 384-dim memory store was removed."
    $script:LegacyLocalMemoryDir = ""
    $script:LocalMemoryRebuilt = $false
    return $true
}

function Invoke-ClientWorkspaceReindex {
    $clientsDir = Join-Path $RepoRoot "clients"
    if (-not (Test-Path -LiteralPath $clientsDir)) { return $true }

    $failed = New-Object System.Collections.Generic.List[string]
    $clients = @(Get-ChildItem -LiteralPath $clientsDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name)
    foreach ($client in $clients) {
        $clientDir = $client.FullName
        $slug = $client.Name
        if (-not (Test-Path -LiteralPath (Join-Path $clientDir ".claude"))) { continue }
        $hasMemory = Test-Path -LiteralPath (Join-Path $clientDir "context\memory")
        $hasLearnings = Test-Path -LiteralPath (Join-Path $clientDir "context\learnings.md")
        if (-not ($hasMemory -or $hasLearnings)) { continue }

        Info "Re-indexing client '$slug' memory..."
        $ok = Invoke-NpmScript -ScriptName "memory:capture" -ScriptArgs @(
            "--reason", "refresh",
            "--force",
            "--cwd", $clientDir,
            "--workspace", $clientDir,
            "--visibility", "client",
            "--client", $slug
        )
        if (-not $ok) {
            Warn "Client '$slug' memory reindex failed."
            $failed.Add($slug) | Out-Null
        }
    }

    if ($failed.Count -gt 0) {
        Warn "Client memory reindex failed for: $($failed -join ', '). Re-run memory:capture for those clients after setup."
        return $false
    }
    return $true
}

function Invoke-MemoryReindex {
    $args = Get-ReindexArgs

    if (-not (Invoke-ModelWarmup)) { return $false }

    if ($Backend -eq "postgres") {
        if (-not (Ensure-PostgresUrl)) { return $false }
        [Environment]::SetEnvironmentVariable("MEMORY_STORE_BACKEND", "postgres", "Process")
        Info "Applying hosted Postgres memory schema..."
        if (-not (Invoke-NpmScript -ScriptName "memory:migrate")) {
            Warn "Hosted memory schema uses an older embedding dimension. Preserving hosted memory while rebuilding BGE-M3 vectors."
            if (-not (Invoke-NpmScript -ScriptName "memory:upgrade-embeddings" -ScriptArgs @("--yes"))) { return $false }
            if (-not (Invoke-NpmScript -ScriptName "memory:migrate" -ScriptArgs @("--check"))) { return $false }
        }
        Info "Re-indexing memory into hosted Postgres..."
        if (-not (Invoke-NpmScript -ScriptName "memory:reindex" -ScriptArgs (@("--visibility", "system", "--force") + $args))) { return $false }
        if (-not (Invoke-ClientWorkspaceReindex)) { return $false }
        return $true
    }

    [Environment]::SetEnvironmentVariable("MEMORY_STORE_BACKEND", "pglite", "Process")
    if (-not (Prepare-LocalStoreForRebuild)) { return $false }
    Info "Re-indexing memory into local PGLite..."
    if (-not (Invoke-NpmScript -ScriptName "memory:reindex" -ScriptArgs (@("--allow-local", "--force") + $args))) {
        Restore-LegacyLocalStore
        return $false
    }
    if (-not (Finalize-LegacyLocalStore)) {
        Restore-LegacyLocalStore
        return $false
    }
    if (-not (Invoke-ClientWorkspaceReindex)) { return $false }
    return $true
}

function Stop-MemSearchWatchers {
    $stopScript = Join-Path $ScriptDir "stop-memsearch-watchers.ps1"
    if (-not (Test-Path -LiteralPath $stopScript)) { return }

    try {
        # The nested script enumerates processes via WMI, which can stall for minutes
        # under low-memory/slow-disk conditions instead of the few seconds it normally
        # takes. Bound the wait so a stuck WMI call never blocks the rest of setup.
        $proc = Start-Process -FilePath "powershell" `
            -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $stopScript) `
            -PassThru -WindowStyle Hidden

        if ($proc.WaitForExit(15000)) {
            Success "Stopped legacy MemSearch watcher processes when present"
        }
        else {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            Warn "Timed out checking for legacy MemSearch watcher processes; skipped. Safe to ignore if no watcher process was actually running."
        }
    }
    catch {
        Warn "Could not stop MemSearch watcher processes automatically"
    }
}

function Archive-MemSearchDirs {
    $dirs = @(Get-MemSearchDirs)
    if ($dirs.Count -eq 0) { return $true }

    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
    $backupRoot = Join-Path $RepoRoot "backups\memsearch-migration\$timestamp"

    foreach ($dir in $dirs) {
        if ($dir -eq (Join-Path $RepoRoot ".memsearch")) {
            $rel = "root\.memsearch"
        }
        else {
            $rel = Get-RelativePath -PathValue $dir
        }

        $dest = Join-Path $backupRoot $rel
        $suffix = 1
        while (Test-Path -LiteralPath $dest) {
            $dest = Join-Path $backupRoot "$rel.$suffix"
            $suffix++
        }

        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
        Move-Item -LiteralPath $dir -Destination $dest
        Success "Archived $(Get-RelativePath -PathValue $dir) to $(Get-RelativePath -PathValue $dest)"
    }

    return $true
}

function Remove-CodexMemSearchHooks {
    $hooksPath = Join-Path $HOME ".codex\hooks.json"
    if (-not (Test-Path -LiteralPath $hooksPath)) { return $true }
    $raw = Get-Content -LiteralPath $hooksPath -Raw
    if ($raw -notmatch "memsearch") { return $true }

    function Scrub($Value) {
        if ($null -eq $Value) { return $null }
        if ($Value -is [System.Array]) {
            $items = New-Object System.Collections.Generic.List[object]
            foreach ($item in $Value) {
                $cleaned = Scrub $item
                if ($null -eq $cleaned) { continue }
                if (($cleaned.PSObject.Properties.Name -contains "hooks") -and
                    ($cleaned.hooks -is [System.Array]) -and
                    ($cleaned.hooks.Count -eq 0)) {
                    continue
                }
                $items.Add($cleaned) | Out-Null
            }
            return @($items)
        }
        if ($Value -is [pscustomobject]) {
            if (($Value.PSObject.Properties.Name -contains "command") -and
                ($Value.command -is [string]) -and
                ($Value.command.ToLowerInvariant().Contains("memsearch"))) {
                return $null
            }

            $next = [ordered]@{}
            foreach ($prop in $Value.PSObject.Properties) {
                $cleaned = Scrub $prop.Value
                if ($null -ne $cleaned) {
                    $next[$prop.Name] = $cleaned
                }
            }
            return [pscustomobject]$next
        }
        return $Value
    }

    try {
        $json = $raw | ConvertFrom-Json
        $clean = Scrub $json
        $clean | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $hooksPath -Encoding UTF8
        Success "Removed MemSearch hook entries from $hooksPath"
        return $true
    }
    catch {
        Warn "Could not remove MemSearch hook entries from $hooksPath"
        return $false
    }
}

function Remove-ClaudeMemSearchPlugin {
    if (-not (Test-ClaudeMemSearchInstalled)) { return $true }

    $allowedScopes = @("user", "project", "local")
    $scopes = @(Get-ClaudeMemSearchScopes | Where-Object { $allowedScopes -contains $_ })
    $usingFallback = $false

    if ($scopes.Count -eq 0) {
        $scopes = $allowedScopes
        $usingFallback = $true
    }

    $removed = $false
    foreach ($scope in $scopes) {
        & claude plugin uninstall memsearch --scope $scope -y *> $null
        if ($LASTEXITCODE -eq 0) {
            Success "Removed Claude Code MemSearch plugin ($scope scope)"
            $removed = $true
            if ($usingFallback) { break }
        }
    }

    if ($removed) { return $true }

    Warn "Could not remove Claude Code MemSearch plugin automatically"
    return $false
}

function Uninstall-LegacyMemSearch {
    $errors = 0

    Stop-MemSearchWatchers

    if (-not (Remove-ClaudeMemSearchPlugin)) { $errors++ }

    if (Test-CodexMemSearchInstalled) {
        & codex plugin remove memsearch@memsearch-plugins
        if ($LASTEXITCODE -eq 0) {
            Success "Removed Codex MemSearch plugin"
        }
        else {
            Warn "Could not remove Codex MemSearch plugin automatically"
            $errors++
        }
    }

    if (-not (Remove-CodexMemSearchHooks)) { $errors++ }

    if (Test-UvMemSearchInstalled) {
        & uv tool uninstall memsearch
        if ($LASTEXITCODE -eq 0) {
            Success "Uninstalled MemSearch uv tool"
        }
        else {
            Warn "Could not uninstall the MemSearch uv tool automatically"
            $errors++
        }
    }
    elseif (Test-CommandAvailable -Name "memsearch") {
        Warn "memsearch is on PATH, but it was not listed by uv tool list. Remove it manually if it is still needed nowhere else."
    }

    return $errors -eq 0
}

Write-Host ""
Write-Host "Memory migration/setup" -ForegroundColor Cyan
Write-Host "  AI-OS now uses local PGLite by default, or hosted Postgres"
Write-Host "  when MEMORY_DATABASE_URL or DATABASE_URL is already configured."

Select-Backend

Write-Host ""
if ($Backend -eq "postgres") {
    Write-Host "  Using hosted Postgres because a database URL is configured or was selected."
}
else {
    Write-Host "  Using local PGLite."
}
Write-Host ""
Write-Host "  What will happen:"
Write-Host "  - Set up semantic memory with the BGE-M3 embedding model."
Write-Host "  - Download the model if it is not cached yet; this may take several minutes."
Write-Host "  - Run Command Centre memory scripts to apply the schema and re-index memory."
Write-Host "  - Include old root and client .memsearch/memory folders during migration import."
Write-Host "  - Archive old .memsearch folders under backups/memsearch-migration/."
Write-Host "  - Remove legacy MemSearch plugins, hooks, tools, and watcher processes when found."
Write-Host ""

if (-not $Yes -and -not [Console]::IsInputRedirected) {
    $reply = Read-Host "  Continue? [Y/n]"
    if ([string]::IsNullOrWhiteSpace($reply)) { $reply = "Y" }
    if ($reply -notmatch "^[Yy]$") {
        Warn "Skipped memory migration/setup."
        exit 3
    }
}

# Offer to import prior Claude Code sessions into memory. Opt-in and never
# silent: detection is read-only, and the import only runs if the user says yes
# in an interactive terminal. In non-interactive runs we just print a hint.
function Invoke-SessionImportOffer {
    if (-not (Test-Path (Join-Path $CommandCentreDir "package.json"))) { return }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { return }

    if ([Console]::IsInputRedirected) {
        Info "Tip: import prior Claude Code sessions anytime with: npm --prefix command-centre run memory:import-sessions"
        return
    }

    # Read-only detection. Any non-zero "N available" means there is something to offer.
    $detection = & npm --silent --prefix $CommandCentreDir run memory:import-sessions -- --dry-run 2>$null | Out-String
    if ($detection -notmatch '[1-9][0-9]* available') { return }

    Write-Host ""
    Info "Found prior Claude Code sessions that can be imported into memory."
    Warn "Importing older conversations can take a while and may use Claude subscription usage."
    Info "You can import a few now and more later; nothing is lost, and re-running never duplicates."
    $reply = Read-Host "  Import prior sessions now? [y/N]"
    if ($reply -match '^(y|yes)$') {
        if (-not (Invoke-NpmScript -ScriptName "memory:import-sessions" -ScriptArgs @("--interactive"))) {
            Warn "Session import did not finish; run 'npm --prefix command-centre run memory:import-sessions' anytime."
        }
    }
    else {
        Info "Skipped. Run npm --prefix command-centre run memory:import-sessions whenever you like."
    }
}

$errors = 0

if (-not (Ensure-CommandCentreReady)) { $errors++ }
if ($errors -eq 0 -and -not (Invoke-MemoryReindex)) { $errors++ }
if ($errors -eq 0 -and -not (Archive-MemSearchDirs)) { $errors++ }
if ($errors -eq 0 -and -not (Uninstall-LegacyMemSearch)) { $errors++ }

if ($errors -eq 0) { Invoke-SessionImportOffer }

Write-Host ""
if ($errors -eq 0) {
    Success "Memory migration/setup complete"
    exit 0
}

Fail "$errors memory migration/setup step(s) need attention"
Write-Host "  Re-run this script after fixing the issue. If old .memsearch folders remain, they are archived only after indexing succeeds."
exit 1
