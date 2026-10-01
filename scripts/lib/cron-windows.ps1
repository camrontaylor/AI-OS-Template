Set-StrictMode -Version 3.0

$Script:AiOsCronShortcutDays = @("daily", "weekdays", "weekends")
$Script:AiOsCronWeekdayDays = @("mon", "tue", "wed", "thu", "fri", "sat", "sun")

function Test-AiOsBooleanEnv {
    param([string]$Name)

    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $false
    }

    return $value.Trim().ToLowerInvariant() -notin @("0", "false", "no", "off")
}

function Get-AiOsProjectDir {
    param([string]$ScriptRoot)

    return Split-Path -Parent $ScriptRoot
}

function Get-AiOsProjectSlug {
    param([string]$ProjectDir)

    $leaf = Split-Path -Leaf $ProjectDir
    $slug = $leaf.ToLowerInvariant() -replace "[^a-z0-9-]", "-"
    $slug = $slug -replace "-{2,}", "-"
    $slug = $slug.Trim("-")

    if ([string]::IsNullOrWhiteSpace($slug)) {
        throw "Unable to derive a project slug from '$ProjectDir'."
    }

    return $slug
}

function Get-AiOsScheduledTaskName {
    param([string]$ProjectDir)

    return "AIOS-$(Get-AiOsProjectSlug -ProjectDir $ProjectDir)"
}

function Get-AiOsNow {
    $override = [Environment]::GetEnvironmentVariable("AI_OS_CRON_NOW")
    if (-not [string]::IsNullOrWhiteSpace($override)) {
        return [DateTimeOffset]::Parse(
            $override,
            [System.Globalization.CultureInfo]::InvariantCulture
        )
    }

    return [DateTimeOffset](Get-Date)
}

function Resolve-AiOsCommandFromEnv {
    param([string]$EnvVarName)

    $override = [Environment]::GetEnvironmentVariable($EnvVarName)
    if ([string]::IsNullOrWhiteSpace($override)) {
        return $null
    }

    if (Test-Path $override) {
        return (Resolve-Path $override).ProviderPath
    }

    $command = Get-Command $override -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "Environment override '$EnvVarName' points to an unavailable command: $override"
}

function Resolve-AiOsClaudeCommand {
    $override = Resolve-AiOsCommandFromEnv -EnvVarName "AI_OS_CLAUDE_BIN"
    if ($override) {
        return $override
    }

    $command = Get-Command claude -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $command = Get-Command claude.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "Error: 'claude' CLI not found. Install Claude Code first."
}

function Get-AiOsProcessInvocation {
    param(
        [string]$CommandPath,
        [string[]]$Arguments = @()
    )

    $extension = [System.IO.Path]::GetExtension($CommandPath).ToLowerInvariant()
    switch ($extension) {
        ".cmd" { return @{ FilePath = "cmd.exe"; Arguments = @("/d", "/c", $CommandPath) + $Arguments } }
        ".bat" { return @{ FilePath = "cmd.exe"; Arguments = @("/d", "/c", $CommandPath) + $Arguments } }
        ".ps1" { return @{ FilePath = "powershell.exe"; Arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $CommandPath) + $Arguments } }
        default { return @{ FilePath = $CommandPath; Arguments = $Arguments } }
    }
}

function ConvertTo-AiOsQuotedArgument {
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

function Join-AiOsProcessArguments {
    param([string[]]$Arguments = @())

    return ($Arguments | ForEach-Object { ConvertTo-AiOsQuotedArgument -Value $_ }) -join " "
}

function Invoke-AiOsProcess {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @(),
        [int]$TimeoutMs,
        [string]$StdOutPath,
        [string]$StdErrPath
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = Join-AiOsProcessArguments -Arguments $Arguments
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    $process.EnableRaisingEvents = $false

    $null = $process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    $timedOut = $false
    if (-not $process.WaitForExit($TimeoutMs)) {
        try { $process.Kill() } catch {}
        $timedOut = $true
    }

    $process.WaitForExit()

    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()

    [System.IO.File]::WriteAllText($StdOutPath, $stdout, [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($StdErrPath, $stderr, [System.Text.Encoding]::UTF8)

    return @{
        TimedOut = $timedOut
        ExitCode = if ($timedOut) { 124 } else { [int]$process.ExitCode }
    }
}

function Resolve-AiOsPythonCommand {
    $override = Resolve-AiOsCommandFromEnv -EnvVarName "AI_OS_PYTHON_BIN"
    if ($override) {
        return @{
            FilePath = $override
            Arguments = @()
            Label = "override"
        }
    }

    $candidates = @(
        @{ FilePath = "py"; Arguments = @("-3"); Label = "py -3" },
        @{ FilePath = "python"; Arguments = @(); Label = "python" },
        @{ FilePath = "python3"; Arguments = @(); Label = "python3" }
    )

    foreach ($candidate in $candidates) {
        $probeOutput = & $candidate.FilePath @($candidate.Arguments + @("-c", "import sys; print(sys.version_info[0])")) 2>$null
        if ($LASTEXITCODE -eq 0 -and ($probeOutput | Out-String).Trim() -eq "3") {
            return $candidate
        }
    }

    return $null
}

function Split-AiOsFrontMatter {
    param([string]$Content)

    if ($Content -match "(?s)\A---\s*\r?\n(.*?)\r?\n---\s*\r?\n?(.*)\z") {
        return @{
            FrontMatter = $Matches[1]
            Body = $Matches[2].Trim()
        }
    }

    return @{
        FrontMatter = ""
        Body = $Content.Trim()
    }
}

function ConvertFrom-AiOsFrontMatter {
    param([string]$FrontMatter)

    $map = [ordered]@{}
    if ([string]::IsNullOrWhiteSpace($FrontMatter)) {
        return $map
    }

    foreach ($rawLine in ($FrontMatter -split "\r?\n")) {
        $line = $rawLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
            continue
        }

        $separatorIndex = $line.IndexOf(":")
        if ($separatorIndex -lt 1) {
            continue
        }

        $key = $line.Substring(0, $separatorIndex).Trim()
        $value = $line.Substring($separatorIndex + 1).Trim()

        if ($value.Length -ge 2) {
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }

        $map[$key] = $value
    }

    return $map
}

function Get-AiOsFrontMatterValue {
    param(
        [System.Collections.IDictionary]$FrontMatter,
        [string]$Key,
        [string]$Default = ""
    )

    if ($FrontMatter -and $FrontMatter.Contains($Key)) {
        return [string]$FrontMatter[$Key]
    }

    return $Default
}

function Get-AiOsDayTokens {
    param([string]$Days)

    if ([string]::IsNullOrWhiteSpace($Days)) {
        return @()
    }

    return @(
        $Days.Split(",") |
            ForEach-Object { $_.Trim().ToLowerInvariant() } |
            Where-Object { $_ }
    )
}

function Test-AiOsSupportedDays {
    param([string]$Days)

    $tokens = @(Get-AiOsDayTokens -Days $Days)
    if ($tokens.Count -eq 0) {
        return $false
    }

    if ($tokens.Count -eq 1) {
        return ($tokens[0] -in $Script:AiOsCronShortcutDays) -or ($tokens[0] -in $Script:AiOsCronWeekdayDays)
    }

    foreach ($token in $tokens) {
        if ($token -notin $Script:AiOsCronWeekdayDays) {
            return $false
        }
    }

    return $true
}

function Test-AiOsSupportedTime {
    param([string]$Time)

    if ([string]::IsNullOrWhiteSpace($Time)) {
        return $false
    }

    if ($Time -match "^every_(\d+)([mh])$") {
        return [int]$Matches[1] -gt 0
    }

    $parts = @(
        $Time.Split(",") |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )

    if ($parts.Count -eq 0) {
        return $false
    }

    foreach ($part in $parts) {
        if ($part -notmatch "^(?:[01]\d|2[0-3]):[0-5]\d$") {
            return $false
        }
    }

    return $true
}

function Test-AiOsDayTokenMatch {
    param(
        [string[]]$Tokens,
        [string]$DayToken
    )

    $Tokens = @($Tokens)

    if ($Tokens.Count -eq 0) {
        return $false
    }

    if ($Tokens.Count -eq 1) {
        switch ($Tokens[0]) {
            "daily" { return $true }
            "weekdays" { return $DayToken -notin @("sat", "sun") }
            "weekends" { return $DayToken -in @("sat", "sun") }
            default { return $Tokens[0] -eq $DayToken }
        }
    }

    return $Tokens -contains $DayToken
}

function Test-AiOsDayMatch {
    param(
        [string]$Days,
        [DateTimeOffset]$Now
    )

    $tokens = @(Get-AiOsDayTokens -Days $Days)
    $dayToken = $Now.ToString("ddd", [System.Globalization.CultureInfo]::InvariantCulture).ToLowerInvariant()
    return Test-AiOsDayTokenMatch -Tokens $tokens -DayToken $dayToken
}

function Test-AiOsTimeMatch {
    param(
        [string]$Schedule,
        [DateTimeOffset]$Now
    )

    if ($Schedule -match "^every_(\d+)m$") {
        $interval = [int]$Matches[1]
        return ($Now.Minute % $interval) -eq 0
    }

    if ($Schedule -match "^every_(\d+)h$") {
        $interval = [int]$Matches[1]
        return $Now.Minute -eq 0 -and (($Now.Hour % $interval) -eq 0)
    }

    $currentTime = $Now.ToString("HH:mm")
    $times = @(
        $Schedule.Split(",") |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )

    return $times -contains $currentTime
}

function Test-AiOsTimeInRange {
    param(
        [string]$Schedule,
        [string]$Days,
        [DateTimeOffset]$Start,
        [DateTimeOffset]$End
    )

    if ($Schedule -match "^every_") {
        return $false
    }

    if (-not (Test-AiOsSupportedDays -Days $Days) -or -not (Test-AiOsSupportedTime -Time $Schedule)) {
        return $false
    }

    $dayTokens = @(Get-AiOsDayTokens -Days $Days)
    $times = @(
        $Schedule.Split(",") |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )

    $cursor = $Start.Date
    while ($cursor -le $End.Date) {
        $candidateDay = [DateTimeOffset]::new(
            $cursor.Year,
            $cursor.Month,
            $cursor.Day,
            0,
            0,
            0,
            $End.Offset
        )
        $dayToken = $candidateDay.ToString("ddd", [System.Globalization.CultureInfo]::InvariantCulture).ToLowerInvariant()

        if (Test-AiOsDayTokenMatch -Tokens $dayTokens -DayToken $dayToken) {
            foreach ($time in $times) {
                $hours = [int]$time.Substring(0, 2)
                $minutes = [int]$time.Substring(3, 2)
                $scheduledAt = [DateTimeOffset]::new(
                    $cursor.Year,
                    $cursor.Month,
                    $cursor.Day,
                    $hours,
                    $minutes,
                    0,
                    $End.Offset
                )

                if ($scheduledAt -gt $Start -and $scheduledAt -lt $End) {
                    return $true
                }
            }
        }

        $cursor = $cursor.AddDays(1)
    }

    return $false
}

function ConvertTo-AiOsTimeoutMs {
    param([string]$Value)

    if ($Value -match "^(\d+)s$") { return [int]$Matches[1] * 1000 }
    if ($Value -match "^(\d+)m$") { return [int]$Matches[1] * 60 * 1000 }
    if ($Value -match "^(\d+)h$") { return [int]$Matches[1] * 3600 * 1000 }
    if ($Value -match "^\d+$") { return [int]$Value * 1000 }
    return 1800000
}

function ConvertTo-AiOsTimeoutSeconds {
    param([string]$Value)

    return [math]::Floor((ConvertTo-AiOsTimeoutMs -Value $Value) / 1000)
}

function Format-AiOsDuration {
    param([int]$Seconds)

    if ($Seconds -lt 60) {
        return "${Seconds}s"
    }

    $minutes = [math]::Floor($Seconds / 60)
    $remainder = $Seconds % 60
    if ($remainder -eq 0) {
        return "${minutes}m"
    }

    return "${minutes}m ${remainder}s"
}

function Read-AiOsStatusFile {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return $null
    }

    try {
        return Get-Content $Path -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Write-AiOsStatusFile {
    param(
        [string]$Path,
        [hashtable]$Data
    )

    $Data | ConvertTo-Json -Compress | Set-Content $Path -Encoding UTF8
}

function Get-AiOsJobDefinition {
    param([string]$FilePath)

    $content = Get-Content $FilePath -Raw
    $parts = Split-AiOsFrontMatter -Content $content
    $frontMatter = ConvertFrom-AiOsFrontMatter -FrontMatter $parts.FrontMatter
    $slug = [System.IO.Path]::GetFileNameWithoutExtension($FilePath)

    $activeRaw = Get-AiOsFrontMatterValue -FrontMatter $frontMatter -Key "active" -Default "true"
    $active = $activeRaw.Trim().ToLowerInvariant() -ne "false"

    $retry = 0
    if (-not [int]::TryParse((Get-AiOsFrontMatterValue -FrontMatter $frontMatter -Key "retry" -Default "0"), [ref]$retry)) {
        $retry = 0
    }

    return @{
        Active = $active
        ActiveRaw = $activeRaw
        Time = Get-AiOsFrontMatterValue -FrontMatter $frontMatter -Key "time"
        Days = Get-AiOsFrontMatterValue -FrontMatter $frontMatter -Key "days"
        Model = Get-AiOsFrontMatterValue -FrontMatter $frontMatter -Key "model" -Default "sonnet"
        Name = Get-AiOsFrontMatterValue -FrontMatter $frontMatter -Key "name" -Default $slug
        Notify = Get-AiOsFrontMatterValue -FrontMatter $frontMatter -Key "notify" -Default "on_finish"
        Description = Get-AiOsFrontMatterValue -FrontMatter $frontMatter -Key "description"
        Timeout = Get-AiOsFrontMatterValue -FrontMatter $frontMatter -Key "timeout" -Default "30m"
        Retry = $retry
        Prompt = $parts.Body
        Slug = $slug
        SourcePath = $FilePath
    }
}
