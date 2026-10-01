[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("List", "Stop")]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$Root,

    [int]$ProcessId
)

$ErrorActionPreference = "Stop"

$resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd("\", "/")
$commandCentre = [IO.Path]::GetFullPath((Join-Path $resolvedRoot "command-centre")).TrimEnd("\", "/")
$commandCentrePrefix = $commandCentre + [IO.Path]::DirectorySeparatorChar
$nodeModules = [IO.Path]::GetFullPath((Join-Path $commandCentre "node_modules")).TrimEnd("\", "/")
$nodeModulesPrefix = $nodeModules + [IO.Path]::DirectorySeparatorChar

function Test-PathPrefix {
    param(
        [string]$Value,
        [string]$Prefix
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    try {
        $resolved = [IO.Path]::GetFullPath($Value)
        return $resolved.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
}

function Get-OwnedNodeProcess {
    param([Nullable[int]]$OnlyProcessId)

    $query = "Name = 'node.exe'"
    if ($null -ne $OnlyProcessId) {
        $query += " AND ProcessId = $OnlyProcessId"
    }

    foreach ($processInfo in @(Get-CimInstance Win32_Process -Filter $query -ErrorAction SilentlyContinue)) {
        $commandLine = [string]$processInfo.CommandLine
        $normalizedCommandLine = $commandLine.Replace("/", "\")
        $owned = $normalizedCommandLine.IndexOf(
            $commandCentrePrefix,
            [StringComparison]::OrdinalIgnoreCase
        ) -ge 0

        if (-not $owned) {
            try {
                $owned = @(
                    (Get-Process -Id $processInfo.ProcessId -ErrorAction Stop).Modules |
                        Where-Object { Test-PathPrefix -Value $_.FileName -Prefix $nodeModulesPrefix }
                ).Count -gt 0
            }
            catch {
                $owned = $false
            }
        }

        if (-not $owned) {
            continue
        }

        $role = "scoped-node"
        if ($commandLine -match '(?i)[\\/]memory-watch\.cjs(?:["'']|\s|$)') {
            $role = "memory-watcher"
        }
        elseif ($commandLine -match '(?i)[\\/]cron-daemon\.cjs(?:["'']|\s|$)') {
            $role = "cron"
        }
        elseif (
            $commandLine -match '(?i)[\\/]next-run\.cjs(?:["'']|\s|$)' -or
            $commandLine -match '(?i)[\\/]node_modules[\\/]next[\\/]dist[\\/]bin[\\/]next(?:["'']|\s|$)'
        ) {
            $role = "command-centre"
        }

        [PSCustomObject]@{
            ProcessId = [int]$processInfo.ProcessId
            Role = $role
        }
    }
}

if ($Action -eq "List") {
    foreach ($ownedProcess in @(Get-OwnedNodeProcess)) {
        [Console]::WriteLine("$($ownedProcess.ProcessId)`t$($ownedProcess.Role)")
    }
    exit 0
}

$target = @(Get-OwnedNodeProcess -OnlyProcessId $ProcessId)
if ($target.Count -eq 0) {
    $stillExists = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($stillExists) {
        Write-Error "Refusing to stop PID $ProcessId because it is not owned by $commandCentre."
        exit 2
    }
    exit 0
}

Stop-Process -Id $ProcessId -Force -ErrorAction Stop
exit 0
