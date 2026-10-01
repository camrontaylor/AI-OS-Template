# Safe migration from legacy GSD packages/files to OpenGSD Redux.

$script:AiOsGsdReduxPackage = "@opengsd/get-shit-done-redux@latest"
$script:AiOsGsdLegacyPackages = @(
    "get-shit-done-cc",
    "get-shit-done-redux",
    "@gsd-build/sdk",
    "@gsd-redux/sdk"
)

function Write-AiOsGsdWarning {
    param([string]$Message)
    Write-Host "  [!] $Message" -ForegroundColor Yellow
}

function Write-AiOsGsdNote {
    param([string]$Message)
    Write-Host "  $Message"
}

function Get-AiOsGsdConfigDirs {
    param([string]$RepoRoot)

    $dirs = @()
    if ($env:CLAUDE_CONFIG_DIR) {
        $dirs += $env:CLAUDE_CONFIG_DIR
    }
    $dirs += (Join-Path $HOME ".claude")
    $dirs += (Join-Path $RepoRoot ".claude")

    $seen = @{}
    foreach ($dir in $dirs) {
        if ([string]::IsNullOrWhiteSpace($dir)) {
            continue
        }
        if (-not $seen.ContainsKey($dir)) {
            $seen[$dir] = $true
            $dir
        }
    }
}

function Test-AiOsGsdProtectedPath {
    param([string]$Path)

    $normalized = $Path -replace "\\", "/"
    return ($normalized -match "(^|/)\.planning($|/)")
}

function Test-AiOsPathWithin {
    param(
        [string]$Path,
        [string]$Root
    )

    if (-not (Test-Path -LiteralPath $Path) -or -not (Test-Path -LiteralPath $Root)) {
        return $false
    }

    $resolvedPath = (Resolve-Path -LiteralPath $Path).ProviderPath
    $resolvedRoot = (Resolve-Path -LiteralPath $Root).ProviderPath.TrimEnd("\", "/")
    $prefix = $resolvedRoot + [System.IO.Path]::DirectorySeparatorChar

    return $resolvedPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-AiOsGsdReduxVersion {
    param([string]$RepoRoot)

    # get-shit-done/VERSION is the marker that Redux is installed — the same
    # signal the update hook trusts (.claude/hooks/gsd-check-update.js).
    foreach ($configDir in Get-AiOsGsdConfigDirs -RepoRoot $RepoRoot) {
        $versionFile = Join-Path $configDir "get-shit-done\VERSION"
        if (Test-Path -LiteralPath $versionFile) {
            return ((Get-Content -Raw -LiteralPath $versionFile).Trim())
        }
    }

    return $null
}

function Find-AiOsLegacyGsd {
    param([string]$RepoRoot)

    $findings = New-Object System.Collections.Generic.List[object]

    if (Get-Command npm -ErrorAction SilentlyContinue) {
        $globalJson = ""
        $localJson = ""

        try {
            $globalJson = (& npm ls -g --depth=0 --json 2>$null | Out-String)
        }
        catch {
            $globalJson = ""
        }

        if (Test-Path (Join-Path $RepoRoot "package.json")) {
            try {
                Push-Location $RepoRoot
                $localJson = (& npm ls --depth=0 --json 2>$null | Out-String)
            }
            catch {
                $localJson = ""
            }
            finally {
                Pop-Location
            }
        }

        foreach ($package in $script:AiOsGsdLegacyPackages) {
            if ($globalJson.Contains("`"$package`"")) {
                $findings.Add([pscustomobject]@{ Type = "Npm"; Scope = "global"; Package = $package; Path = $null; ConfigRoot = $null }) | Out-Null
            }
            if ($localJson.Contains("`"$package`"")) {
                $findings.Add([pscustomobject]@{ Type = "Npm"; Scope = "local"; Package = $package; Path = $null; ConfigRoot = $null }) | Out-Null
            }
        }
    }

    foreach ($configDir in Get-AiOsGsdConfigDirs -RepoRoot $RepoRoot) {
        $commandsGsd = Join-Path $configDir "commands\gsd"
        $legacyRuntime = Join-Path $configDir "get-shit-done"

        # Redux's runtime lives in get-shit-done/ with a VERSION file. Its presence
        # means this config dir holds a healthy Redux install, so Redux-owned
        # artifacts here must not be flagged as legacy. This is the same marker the
        # update hook trusts (.claude/hooks/gsd-check-update.js).
        $reduxPresent = Test-Path -LiteralPath (Join-Path $legacyRuntime "VERSION")

        # Old command-bundle layout — never produced by Redux.
        if (Test-Path -LiteralPath $commandsGsd) {
            $findings.Add([pscustomobject]@{ Type = "File"; Scope = $null; Package = $null; Path = $commandsGsd; ConfigRoot = $configDir }) | Out-Null
        }
        # A bare get-shit-done/ without a VERSION file is the pre-Redux runtime.
        if ((Test-Path -LiteralPath $legacyRuntime) -and (-not $reduxPresent)) {
            $findings.Add([pscustomobject]@{ Type = "File"; Scope = $null; Package = $null; Path = $legacyRuntime; ConfigRoot = $configDir }) | Out-Null
        }

        # Loose gsd-*.md command/agent files: Redux installs agents/gsd-*.md, so
        # only treat these as legacy when Redux is not installed in this config dir.
        if (-not $reduxPresent) {
            $agentsDir = Join-Path $configDir "agents"
            if (Test-Path -LiteralPath $agentsDir) {
                Get-ChildItem -LiteralPath $agentsDir -Filter "gsd-*.md" -File -ErrorAction SilentlyContinue | ForEach-Object {
                    $findings.Add([pscustomobject]@{ Type = "File"; Scope = $null; Package = $null; Path = $_.FullName; ConfigRoot = $configDir }) | Out-Null
                }
            }

            $commandsDir = Join-Path $configDir "commands"
            if (Test-Path -LiteralPath $commandsDir) {
                Get-ChildItem -LiteralPath $commandsDir -Filter "gsd-*.md" -File -ErrorAction SilentlyContinue | ForEach-Object {
                    $findings.Add([pscustomobject]@{ Type = "File"; Scope = $null; Package = $null; Path = $_.FullName; ConfigRoot = $configDir }) | Out-Null
                }
            }
        }
    }

    $findings | Sort-Object Type, Scope, Package, Path -Unique
}

function Show-AiOsLegacyGsdWarning {
    param([object[]]$Findings)

    Write-Host ""
    Write-AiOsGsdWarning "Legacy GSD detected."
    Write-Host ""
    Write-Host "The old GSD npm package is no longer the recommended source."
    Write-Host "AI-OS can remove the old npm package and generated GSD command files,"
    Write-Host "then install GSD-redux from @opengsd."
    Write-Host ""
    Write-Host "Detected:"

    foreach ($finding in $Findings) {
        if ($finding.Type -eq "Npm") {
            Write-AiOsGsdNote "$($finding.Scope) npm package: $($finding.Package)"
        }
        elseif ($finding.Type -eq "File") {
            Write-AiOsGsdNote "generated file or folder: $($finding.Path)"
        }
    }

    Write-Host ""
    Write-Host "Your .planning/ folders are project data and will not be removed."
    Write-Host ""
}

function Test-AiOsGsdShouldMigrate {
    switch -Regex ($env:AI_OS_GSD_MIGRATE) {
        "^(1|true|TRUE|yes|YES|y|Y)$" { return $true }
        "^(0|false|FALSE|no|NO|n|N)$" { return $false }
        "^$" { }
        default {
            Write-AiOsGsdWarning "Ignoring invalid AI_OS_GSD_MIGRATE value: $env:AI_OS_GSD_MIGRATE"
        }
    }

    if ([Console]::IsInputRedirected) {
        Write-AiOsGsdWarning "Skipping legacy GSD cleanup because this shell is not interactive."
        Write-AiOsGsdWarning "Set AI_OS_GSD_MIGRATE=1 to approve cleanup non-interactively."
        return $false
    }

    $reply = Read-Host "Remove legacy GSD and install GSD-redux? [Y/n]"
    if ([string]::IsNullOrWhiteSpace($reply)) {
        $reply = "Y"
    }
    return $reply -match "^([Yy]|[Yy][Ee][Ss])$"
}

function Remove-AiOsLegacyGsd {
    param(
        [string]$RepoRoot,
        [object[]]$Findings
    )

    foreach ($finding in $Findings) {
        if ($finding.Type -eq "Npm") {
            if ($finding.Scope -eq "global") {
                & npm uninstall -g $finding.Package *> $null
                if ($LASTEXITCODE -ne 0) {
                    Write-AiOsGsdWarning "Could not remove global npm package: $($finding.Package)"
                }
            }
            elseif ((Test-Path (Join-Path $RepoRoot "package.json"))) {
                Push-Location $RepoRoot
                try {
                    & npm uninstall $finding.Package *> $null
                    if ($LASTEXITCODE -ne 0) {
                        Write-AiOsGsdWarning "Could not remove local npm package: $($finding.Package)"
                    }
                }
                finally {
                    Pop-Location
                }
            }
            continue
        }

        if ($finding.Type -ne "File" -or -not (Test-Path -LiteralPath $finding.Path)) {
            continue
        }

        if (Test-AiOsGsdProtectedPath -Path $finding.Path) {
            Write-AiOsGsdWarning "Skipped protected project data: $($finding.Path)"
            continue
        }

        if (-not (Test-AiOsPathWithin -Path $finding.Path -Root $finding.ConfigRoot)) {
            Write-AiOsGsdWarning "Skipped path outside expected config folder: $($finding.Path)"
            continue
        }

        Remove-Item -LiteralPath $finding.Path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-AiOsGsdMigration {
    param([string]$RepoRoot)

    $findings = @(Find-AiOsLegacyGsd -RepoRoot $RepoRoot)
    if ($findings.Count -eq 0) {
        return "no-legacy"
    }

    Show-AiOsLegacyGsdWarning -Findings $findings
    if (-not (Test-AiOsGsdShouldMigrate)) {
        return "declined"
    }

    Remove-AiOsLegacyGsd -RepoRoot $RepoRoot -Findings $findings
    return "cleaned"
}

function Install-AiOsGsdRedux {
    & npx -y $script:AiOsGsdReduxPackage --global --claude
    return ($LASTEXITCODE -eq 0)
}
