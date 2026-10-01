[CmdletBinding()]
param()

function Test-Python3Version {
    param(
        [string[]]$CommandParts
    )

    try {
        $extraParts = @()
        if ($CommandParts.Length -gt 1) {
            $extraParts = $CommandParts[1..($CommandParts.Length - 1)]
        }

        $output = & $CommandParts[0] @extraParts -c "import sys; assert sys.version_info[0] == 3; print('.'.join(str(part) for part in sys.version_info[:3]))" 2>$null
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        return ($output | Out-String).Trim()
    }
    catch {
        return $null
    }
}

function Get-PythonCommandPath {
    param(
        [string]$Name
    )

    try {
        return (Get-Command $Name -ErrorAction Stop).Source
    }
    catch {
        return $null
    }
}

function Resolve-PythonCommand {
    $diagnosticPath = Get-PythonCommandPath -Name "python3"
    $diagnosticBroken = $false

    if ($diagnosticPath) {
        $diagnosticVersion = Test-Python3Version -CommandParts @("python3")
        if (-not $diagnosticVersion) {
            $diagnosticBroken = $true
        }
    }

    $candidates = @(
        @{ Label = "py -3"; Parts = @("py", "-3") },
        @{ Label = "python"; Parts = @("python") },
        @{ Label = "python3"; Parts = @("python3") }
    )

    foreach ($candidate in $candidates) {
        $path = Get-PythonCommandPath -Name $candidate.Parts[0]
        if (-not $path) {
            continue
        }

        $version = Test-Python3Version -CommandParts $candidate.Parts
        if (-not $version) {
            continue
        }

        return [pscustomobject]@{
            Label = $candidate.Label
            CommandParts = $candidate.Parts
            Version = $version
            Path = $path
            Python3DiagnosticPath = $diagnosticPath
            Python3DiagnosticBroken = $diagnosticBroken
        }
    }

    return $null
}
