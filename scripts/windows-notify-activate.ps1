param(
    [string]$Uri = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertFrom-Base64Url {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ""
    }

    $padded = $Value.Replace("-", "+").Replace("_", "/")
    switch ($padded.Length % 4) {
        2 { $padded += "==" }
        3 { $padded += "=" }
    }

    return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($padded))
}

function Get-ActivationPayload {
    param([string]$RawUri)

    if ([string]::IsNullOrWhiteSpace($RawUri)) {
        throw "Activation URI is missing."
    }

    $parsedUri = [System.Uri]$RawUri
    $queryParts = @{}
    foreach ($pair in $parsedUri.Query.TrimStart("?").Split("&", [System.StringSplitOptions]::RemoveEmptyEntries)) {
        $key, $value = $pair.Split("=", 2)
        $queryParts[$key] = $value
    }

    $json = ConvertFrom-Base64Url -Value $queryParts["data"]
    return $json | ConvertFrom-Json
}

function Test-CommandCentre {
    param([int]$Port)

    if ($Port -le 0) {
        return $false
    }

    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Quote-Single {
    param([string]$Value)
    if ($null -eq $Value) {
        $Value = ""
    }
    return "'" + ($Value -replace "'", "''") + "'"
}

function Open-TerminalResume {
    param(
        [string]$WorkingDirectory,
        [string]$SessionId
    )

    $powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
    $resumeCommand = if ([string]::IsNullOrWhiteSpace($SessionId)) {
        "claude --resume <session-id>"
    } else {
        "claude --resume $SessionId"
    }

    $commandScript = @(
        "Set-Location -LiteralPath $(Quote-Single $WorkingDirectory)",
        "Write-Host ''",
        "Write-Host 'Resume this chat with:' -ForegroundColor Cyan",
        "Write-Host $(Quote-Single $resumeCommand) -ForegroundColor Yellow",
        "Write-Host ''"
    ) -join "; "

    Start-Process -FilePath $powershellExe -WorkingDirectory $WorkingDirectory -ArgumentList @(
        "-NoExit",
        "-Command",
        $commandScript
    ) | Out-Null
}

$payload = Get-ActivationPayload -RawUri $Uri
$port = 0
[int]::TryParse([string]$payload.port, [ref]$port) | Out-Null
$workingDirectory = [string]$payload.cwd
if ([string]::IsNullOrWhiteSpace($workingDirectory) -or -not (Test-Path -LiteralPath $workingDirectory)) {
    $workingDirectory = [Environment]::GetFolderPath("UserProfile")
}

if (Test-CommandCentre -Port $port) {
    $taskId = [string]$payload.taskId
    $targetUrl = if ([string]::IsNullOrWhiteSpace($taskId)) {
        "http://127.0.0.1:$port/?tab=feed"
    } else {
        "http://127.0.0.1:$port/?tab=feed&task=$([Uri]::EscapeDataString($taskId))"
    }
    Start-Process $targetUrl | Out-Null
    exit 0
}

Open-TerminalResume -WorkingDirectory $workingDirectory -SessionId ([string]$payload.sessionId)
