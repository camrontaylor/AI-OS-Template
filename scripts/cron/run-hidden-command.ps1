param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,

    [Parameter(Mandatory = $true)]
    [string]$StdoutPath,

    [Parameter(Mandatory = $true)]
    [string]$StderrPath,

    [Parameter(Mandatory = $true)]
    [string]$ArgumentsBase64,

    [Parameter()]
    [string]$EnvironmentBase64 = "",

    [Parameter()]
    [int]$TimeoutSeconds = 0
)

$ErrorActionPreference = "Stop"

function ConvertTo-QuotedArgument {
    param([string]$Value)

    if ($null -eq $Value) {
        return '""'
    }

    if ($Value -notmatch '[\s"]') {
        return $Value
    }

    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashCount = 0

    foreach ($char in $Value.ToCharArray()) {
        if ($char -eq '\') {
            $backslashCount++
            continue
        }

        if ($char -eq '"') {
            [void]$builder.Append([char]'\', ($backslashCount * 2) + 1)
            [void]$builder.Append('"')
            $backslashCount = 0
            continue
        }

        if ($backslashCount -gt 0) {
            [void]$builder.Append([char]'\', $backslashCount)
            $backslashCount = 0
        }

        [void]$builder.Append($char)
    }

    if ($backslashCount -gt 0) {
        [void]$builder.Append([char]'\', $backslashCount * 2)
    }

    [void]$builder.Append('"')
    return $builder.ToString()
}

function Join-QuotedArguments {
    param([string[]]$Arguments = @())

    return ($Arguments | ForEach-Object { ConvertTo-QuotedArgument -Value $_ }) -join " "
}

try {
    $stdoutDir = Split-Path -Parent $StdoutPath
    $stderrDir = Split-Path -Parent $StderrPath
    if ($stdoutDir) {
        New-Item -ItemType Directory -Force -Path $stdoutDir | Out-Null
    }
    if ($stderrDir) {
        New-Item -ItemType Directory -Force -Path $stderrDir | Out-Null
    }

    $argumentJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($ArgumentsBase64))
    $decodedArguments = ConvertFrom-Json -InputObject $argumentJson
    $argumentList = @()
    if ($null -ne $decodedArguments) {
        if ($decodedArguments -is [System.Array]) {
            $argumentList = @($decodedArguments)
        } else {
            $argumentList = @([string]$decodedArguments)
        }
    }

    $resolvedFilePath = $FilePath
    if (-not (Test-Path $resolvedFilePath)) {
        $command = Get-Command $FilePath -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command -and $command.Source) {
            $resolvedFilePath = $command.Source
        }
    }

    $startFilePath = $resolvedFilePath
    $startArgumentList = $argumentList
    $extension = [System.IO.Path]::GetExtension($resolvedFilePath).ToLowerInvariant()

    switch ($extension) {
        ".cmd" {
            $startFilePath = if ($env:ComSpec) { $env:ComSpec } else { "cmd.exe" }
            $startArgumentList = @("/d", "/c", $resolvedFilePath) + $argumentList
        }
        ".bat" {
            $startFilePath = if ($env:ComSpec) { $env:ComSpec } else { "cmd.exe" }
            $startArgumentList = @("/d", "/c", $resolvedFilePath) + $argumentList
        }
        ".ps1" {
            $startFilePath = "powershell.exe"
            $startArgumentList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $resolvedFilePath) + $argumentList
        }
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $startFilePath
    $startInfo.Arguments = Join-QuotedArguments -Arguments $startArgumentList
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true

    if (-not [string]::IsNullOrWhiteSpace($EnvironmentBase64)) {
        $environmentJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($EnvironmentBase64))
        $decodedEnvironment = ConvertFrom-Json -InputObject $environmentJson

        if ($null -ne $decodedEnvironment) {
            foreach ($property in $decodedEnvironment.PSObject.Properties) {
                if ($null -eq $property.Value) {
                    continue
                }

                $startInfo.EnvironmentVariables[$property.Name] = [string]$property.Value
            }
        }
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    $process.EnableRaisingEvents = $false

    $null = $process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    if ($TimeoutSeconds -gt 0) {
        $completedInTime = $process.WaitForExit($TimeoutSeconds * 1000)
        if (-not $completedInTime) {
            try {
                & taskkill /PID $process.Id /T /F | Out-Null
            } catch {
                try {
                    $process.Kill()
                } catch {
                    # Ignore shutdown races.
                }
            }
            exit 124
        }
    } else {
        $process.WaitForExit()
    }

    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($StdoutPath, $stdout, $utf8NoBom)
    [System.IO.File]::WriteAllText($StderrPath, $stderr, $utf8NoBom)

    exit ([int]$process.ExitCode)
} catch {
    $errorText = $_ | Out-String
    Set-Content -LiteralPath $StderrPath -Encoding UTF8 -Value $errorText
    exit 1
}
