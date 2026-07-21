# =============================================================================
# Agentic OS - Install 'centre' PowerShell profiles
# =============================================================================
# Installs or repairs the `centre` function in both supported Windows profile
# files:
#   - Windows PowerShell 5.1
#   - PowerShell 7
#
# The script is host-independent. It can be launched from either
# `powershell.exe` or `pwsh`, and it always updates both profile files.
# `-DocumentsRoot` is a test-only override for writing to temp profile roots.
# =============================================================================

[CmdletBinding()]
param(
    [string]$DocumentsRoot,
    [switch]$Status,
    [switch]$ExistingOnly
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CentreScript = Join-Path $ScriptDir "centre.ps1"
$BlockStart = "# >>> Agentic OS - command centre launcher >>>"
$BlockEnd = "# <<< Agentic OS - command centre launcher <<<"
$LegacyMarker = "# Agentic OS - command centre launcher"
$LegacyMarkerAlt = "# Agentic OS $([char]0x2014) command centre launcher"

function Fail($Message) {
    Write-Host "  [X] $Message" -ForegroundColor Red
}

function Success($Message) {
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Warn($Message) {
    Write-Host "  [!] $Message" -ForegroundColor Yellow
}

function Get-DocumentsRootPath {
    param(
        [string]$OverridePath
    )

    if ($OverridePath) {
        return [System.IO.Path]::GetFullPath($OverridePath)
    }

    $resolvedPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)
    if ([string]::IsNullOrWhiteSpace($resolvedPath)) {
        throw "Could not resolve the current user's Documents folder."
    }

    return $resolvedPath
}

function Get-TargetProfiles {
    param(
        [string]$ResolvedDocumentsRoot
    )

    return @(
        [pscustomobject]@{
            Name = "Windows PowerShell"
            Path = Join-Path $ResolvedDocumentsRoot "WindowsPowerShell\Microsoft.PowerShell_profile.ps1"
        },
        [pscustomobject]@{
            Name = "PowerShell 7"
            Path = Join-Path $ResolvedDocumentsRoot "PowerShell\Microsoft.PowerShell_profile.ps1"
        }
    )
}

function New-CentreBlock {
    param(
        [string]$CentreScriptPath
    )

    return (
        @(
            $BlockStart,
            "function centre {",
            "    & `"$CentreScriptPath`" @Args",
            "}",
            $BlockEnd
        ) -join "`r`n"
    )
}

function Test-HasCentreBlock {
    param(
        [string]$Content
    )

    if ([string]::IsNullOrEmpty($Content)) {
        return $false
    }

    return (
        $Content.Contains($BlockStart) -or
        $Content.Contains($LegacyMarker) -or
        $Content.Contains($LegacyMarkerAlt)
    )
}

function Get-CentreScriptPathFromContent {
    param(
        [string]$Content
    )

    if ([string]::IsNullOrEmpty($Content)) {
        return ""
    }

    $pattern = '(?ms)function centre \{\r?\n\s*&\s*"([^"]+)"\s+@Args\r?\n\}'
    $match = [regex]::Match($Content, $pattern)
    if ($match.Success) {
        return $match.Groups[1].Value
    }

    return ""
}

function Remove-CentreBlocks {
    param(
        [string]$Content
    )

    if ([string]::IsNullOrEmpty($Content)) {
        return ""
    }

    $updated = $Content

    $managedPattern = '(?ms)^[ \t]*' + [regex]::Escape($BlockStart) + '\r?\n.*?^[ \t]*' + [regex]::Escape($BlockEnd) + '\r?\n?'
    $updated = [regex]::Replace($updated, $managedPattern, '')

    foreach ($marker in @($LegacyMarker, $LegacyMarkerAlt)) {
        $legacyPattern = '(?ms)^[ \t]*' + [regex]::Escape($marker) + '\r?\nfunction centre \{\r?\n\s*&\s*"[^"]+"\s+@Args\r?\n\}\r?\n?'
        $updated = [regex]::Replace($updated, $legacyPattern, '')

        $markerOnlyPattern = '(?m)^[ \t]*' + [regex]::Escape($marker) + '[ \t]*\r?\n?'
        $updated = [regex]::Replace($updated, $markerOnlyPattern, '')
    }

    return $updated.TrimEnd([char[]]"`r`n")
}

function Get-DesiredProfileContent {
    param(
        [string]$ExistingContent,
        [string]$CentreBlock
    )

    $cleanContent = Remove-CentreBlocks -Content $ExistingContent
    if ([string]::IsNullOrWhiteSpace($cleanContent)) {
        return $CentreBlock + "`r`n"
    }

    return $cleanContent.TrimEnd([char[]]"`r`n") + "`r`n`r`n" + $CentreBlock + "`r`n"
}

function Ensure-ProfileFile {
    param(
        [string]$ProfilePath
    )

    $profileDir = Split-Path -Parent $ProfilePath
    if (-not (Test-Path -LiteralPath $profileDir)) {
        New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
    }

    if (-not (Test-Path -LiteralPath $ProfilePath)) {
        New-Item -ItemType File -Path $ProfilePath -Force | Out-Null
    }
}

function Get-StatusPayload {
    param(
        [object[]]$Targets,
        [string]$ExpectedScriptPath
    )

    $profiles = @()

    foreach ($target in $Targets) {
        $content = ""
        if (Test-Path -LiteralPath $target.Path) {
            $content = Get-Content -LiteralPath $target.Path -Raw -ErrorAction SilentlyContinue
        }

        if (-not (Test-HasCentreBlock -Content $content)) {
            continue
        }

        $currentScriptPath = Get-CentreScriptPathFromContent -Content $content
        $profiles += [pscustomobject]@{
            name = $target.Name
            profile_path = $target.Path
            current_script_path = $currentScriptPath
            matches_current_repo = ($currentScriptPath -eq $ExpectedScriptPath)
            is_legacy_projects_layout = ($currentScriptPath -match '[\\/]+projects[\\/]')
        }
    }

    $firstMismatch = $profiles | Where-Object { -not $_.matches_current_repo } | Select-Object -First 1

    return [pscustomobject]@{
        expected_script_path = $ExpectedScriptPath
        shortcuts_detected = ($profiles.Count -gt 0)
        mismatch_detected = ($null -ne $firstMismatch)
        current_shortcut_path = if ($null -ne $firstMismatch) { $firstMismatch.current_script_path } else { "" }
        expected_shortcut_path = $ExpectedScriptPath
        is_legacy_projects_layout = if ($null -ne $firstMismatch) { $firstMismatch.is_legacy_projects_layout } else { $false }
        profiles = $profiles
    }
}

if (-not (Test-Path -LiteralPath $CentreScript)) {
    Fail "centre.ps1 not found at $CentreScript"
    exit 1
}

$modeCount = @($Status, $ExistingOnly) | Where-Object { $_ } | Measure-Object | Select-Object -ExpandProperty Count
if ($modeCount -gt 1) {
    throw "Choose either -Status or -ExistingOnly, not both."
}

$resolvedDocumentsRoot = Get-DocumentsRootPath -OverridePath $DocumentsRoot
$centreBlock = New-CentreBlock -CentreScriptPath $CentreScript
$targets = Get-TargetProfiles -ResolvedDocumentsRoot $resolvedDocumentsRoot
$updatedCount = 0

if ($Status) {
    Get-StatusPayload -Targets $targets -ExpectedScriptPath $CentreScript | ConvertTo-Json -Depth 4
    exit 0
}

foreach ($target in $targets) {
    $originalContent = ""
    if (Test-Path -LiteralPath $target.Path) {
        $originalContent = Get-Content -LiteralPath $target.Path -Raw -ErrorAction SilentlyContinue
    }

    $hadCentreBlock = Test-HasCentreBlock -Content $originalContent

    if ($ExistingOnly -and -not $hadCentreBlock) {
        continue
    }

    $desiredContent = Get-DesiredProfileContent -ExistingContent $originalContent -CentreBlock $centreBlock

    if ($desiredContent -eq $originalContent) {
        Success "'centre' already current in $($target.Name) profile ($($target.Path))"
        continue
    }

    Ensure-ProfileFile -ProfilePath $target.Path
    Set-Content -LiteralPath $target.Path -Value $desiredContent -NoNewline

    if ($hadCentreBlock) {
        Success "Updated 'centre' in $($target.Name) profile ($($target.Path))"
    }
    else {
        Success "Added 'centre' to $($target.Name) profile ($($target.Path))"
    }

    $updatedCount++
}

if ($updatedCount -gt 0) {
    Warn "Open a new Windows PowerShell or PowerShell 7 window to activate 'centre'. If you are already in the shell you want to use, run: . `$PROFILE"
}
