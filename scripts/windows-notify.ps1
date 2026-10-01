param(
    [ValidateSet("success", "info", "warning", "error")]
    [string]$Variant = "info",
    [string]$Status = "",
    [string]$Subject = "",
    [string]$Detail = "",
    [string]$Title = "",
    [string]$Subtitle = "",
    [string]$Message = "",
    [string]$Attribution = "",
    [string]$Duration = "",
    [string]$Layout = "",
    [string]$Channel = "",
    [string]$Event = "",
    [string]$ContextJson = "",
    [string]$ContextBase64 = "",
    [switch]$Preview
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-InWindowsPowerShell {
    if ($PSVersionTable.PSEdition -eq "Desktop" -and $PSVersionTable.PSVersion.Major -le 5) {
        return
    }

    $powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path -LiteralPath $powershellExe)) {
        throw "Windows PowerShell 5.1 was not found at $powershellExe"
    }

    $forwardArgs = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $PSCommandPath,
        "-Variant", $Variant
    )

    foreach ($pair in @(
        @("Status", $Status),
        @("Subject", $Subject),
        @("Detail", $Detail),
        @("Title", $Title),
        @("Subtitle", $Subtitle),
        @("Message", $Message),
        @("Attribution", $Attribution),
        @("Duration", $Duration),
        @("Layout", $Layout),
        @("Channel", $Channel),
        @("Event", $Event)
    )) {
        if (-not [string]::IsNullOrEmpty($pair[1])) {
            $forwardArgs += @("-$($pair[0])", $pair[1])
        }
    }

    if ($Preview) {
        $forwardArgs += "-Preview"
    }

    if (-not [string]::IsNullOrEmpty($ContextBase64)) {
        $forwardArgs += @("-ContextBase64", $ContextBase64)
    } elseif (-not [string]::IsNullOrEmpty($ContextJson)) {
        $encodedContext = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($ContextJson))
        $forwardArgs += @("-ContextBase64", $encodedContext)
    }

    $output = & $powershellExe @forwardArgs 2>&1
    $exitCode = $LASTEXITCODE
    if ($output) {
        $output | ForEach-Object { Write-Output $_ }
    }
    exit $exitCode
}

Invoke-InWindowsPowerShell

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$configPath = Join-Path $PSScriptRoot "windows-notify.config.json"
$configDir = Split-Path -Parent $configPath
$projectDir = Split-Path -Parent $PSScriptRoot
$powershellExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$protocolName = "AI-OS-notify"
$activationScriptPath = Join-Path $PSScriptRoot "windows-notify-activate.ps1"
$validChannels = @("interactive", "cron")
$validLayouts = @("compact", "hero")
$validVariants = @("success", "info", "warning", "error")
$copyEvents = @{
    interactive = @("waiting", "permission", "actionRequired", "complete")
    cron        = @("success", "timeout", "failure")
}

function Assert-AllowedValue {
    param(
        [AllowEmptyString()][string]$Value,
        [string[]]$Allowed,
        [string]$Name,
        [switch]$AllowEmpty
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        if ($AllowEmpty) {
            return
        }
        throw "$Name must be one of: $($Allowed -join ', ')"
    }

    if ($Value -notin $Allowed) {
        throw "$Name must be one of: $($Allowed -join ', ')"
    }
}

function Require-Value {
    param(
        $Value,
        [string]$Path,
        [switch]$AllowEmptyString
    )

    if ($null -eq $Value) {
        throw "Missing config value: $Path"
    }
    if (-not $AllowEmptyString -and $Value -is [string] -and [string]::IsNullOrWhiteSpace($Value)) {
        throw "Missing config value: $Path"
    }
    return $Value
}

function ConvertTo-Hashtable {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [System.Collections.IDictionary]) {
        $copy = @{}
        foreach ($key in $Value.Keys) {
            $copy[$key] = ConvertTo-Hashtable $Value[$key]
        }
        return $copy
    }

    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $copy = @{}
        foreach ($prop in $Value.PSObject.Properties) {
            $copy[$prop.Name] = ConvertTo-Hashtable $prop.Value
        }
        return $copy
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        $items = @()
        foreach ($item in $Value) {
            $items += ,(ConvertTo-Hashtable $item)
        }
        return $items
    }

    return $Value
}

function Resolve-ConfiguredPath {
    param([AllowEmptyString()][string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    $candidate = if ([System.IO.Path]::IsPathRooted($PathValue)) {
        $PathValue
    } else {
        Join-Path $configDir $PathValue
    }

    if (Test-Path -LiteralPath $candidate) {
        return (Resolve-Path -LiteralPath $candidate).Path
    }

    return $candidate
}

function Resolve-TemplateText {
    param(
        [AllowEmptyString()][string]$Template,
        [hashtable]$Context
    )

    $text = if ($null -eq $Template) { "" } else { $Template }
    return [regex]::Replace($text, '\{([A-Za-z0-9_]+)\}', {
        param($match)
        $key = $match.Groups[1].Value
        if ($Context.ContainsKey($key) -and $null -ne $Context[$key]) {
            return [string]$Context[$key]
        }
        return ""
    })
}

function Get-FirstNonEmpty {
    param([string[]]$Values)

    foreach ($value in $Values) {
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value
        }
    }
    return ""
}

function Get-ComparableText {
    param([AllowEmptyString()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ""
    }

    return ([regex]::Replace($Value.ToLowerInvariant(), '[^a-z0-9]+', ""))
}

function Get-ContextData {
    $jsonText = $ContextJson

    if ([string]::IsNullOrWhiteSpace($jsonText) -and -not [string]::IsNullOrWhiteSpace($ContextBase64)) {
        try {
            $jsonText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ContextBase64))
        } catch {
            throw "ContextBase64 is invalid: $($_.Exception.Message)"
        }
    }

    if ([string]::IsNullOrWhiteSpace($jsonText)) {
        return @{}
    }

    try {
        $parsed = ConvertFrom-Json -InputObject $jsonText
    } catch {
        throw "ContextJson is invalid JSON: $($_.Exception.Message)"
    }

    $data = ConvertTo-Hashtable $parsed
    if ($null -eq $data) {
        return @{}
    }
    return $data
}

function Trim-ToastText {
    param(
        [AllowEmptyString()][string]$Text,
        [int]$MaxLength = 80
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ""
    }

    $trimmed = $Text.Trim()
    if ($trimmed.Length -le $MaxLength) {
        return $trimmed
    }

    return ($trimmed.Substring(0, $MaxLength - 3).TrimEnd() + "...")
}

function ConvertTo-Base64Url {
    param([string]$Text)

    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Text))
    return $encoded.TrimEnd([char]'=').Replace("+", "-").Replace("/", "_")
}

function Get-ActivationUri {
    param([hashtable]$Payload)

    if (
        [string]::IsNullOrWhiteSpace($Payload.Context["sessionId"]) -and
        [string]::IsNullOrWhiteSpace($Payload.Context["taskId"]) -and
        [string]::IsNullOrWhiteSpace($Payload.Context["cwd"])
    ) {
        return ""
    }

    $activationPayload = [ordered]@{
        sessionId = $Payload.Context["sessionId"]
        taskId = $Payload.Context["taskId"]
        port = $Payload.Context["port"]
        cwd = $Payload.Context["cwd"]
    }

    $json = $activationPayload | ConvertTo-Json -Compress
    $encoded = ConvertTo-Base64Url -Text $json
    return "${protocolName}:?data=$encoded"
}

function Get-HashString {
    param([string]$Value)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        $hash = $sha.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-DefaultStatus {
    param([string]$VariantName)

    switch ($VariantName) {
        "success" { return "Task complete" }
        "warning" { return "Needs attention" }
        "error" { return "Needs attention" }
        default { return "Heads up" }
    }
}

function Load-NotificationConfig {
    if (-not (Test-Path -LiteralPath $configPath)) {
        throw "Notification config was not found at $configPath"
    }

    try {
        $configJson = [System.IO.File]::ReadAllText(
            $configPath,
            [System.Text.Encoding]::UTF8
        )
        $parsed = $configJson | ConvertFrom-Json
    } catch {
        throw "Notification config is invalid JSON: $($_.Exception.Message)"
    }

    $config = ConvertTo-Hashtable $parsed
    $app = Require-Value $config["app"] "app"
    $assets = Require-Value $config["assets"] "assets"
    $copy = Require-Value $config["copy"] "copy"

    foreach ($path in @("id", "displayName", "shortcutName", "assetVersion", "defaultDuration", "defaultLayout")) {
        Require-Value $app[$path] "app.$path" | Out-Null
    }
    Require-Value $app["attribution"] "app.attribution" -AllowEmptyString | Out-Null
    Assert-AllowedValue -Value $app["defaultDuration"] -Allowed @("short", "long") -Name "app.defaultDuration"
    Assert-AllowedValue -Value $app["defaultLayout"] -Allowed $validLayouts -Name "app.defaultLayout"

    Require-Value $assets["logoPath"] "assets.logoPath" | Out-Null
    Require-Value $assets["shortcutIconPath"] "assets.shortcutIconPath" | Out-Null
    if (-not ([string]$assets["shortcutIconPath"] -match '\.ico$')) {
        throw "assets.shortcutIconPath must point to a .ico file"
    }

    $heroPaths = Require-Value $assets["heroPaths"] "assets.heroPaths"
    $generatedLogo = Require-Value $assets["generatedLogo"] "assets.generatedLogo"
    $variants = Require-Value $assets["variants"] "assets.variants"

    foreach ($path in @("badgeText", "startColor", "endColor", "overlayColor", "overlayOpacity", "borderColor", "borderOpacity", "textColor")) {
        Require-Value $generatedLogo[$path] "assets.generatedLogo.$path" | Out-Null
    }

    foreach ($variantName in $validVariants) {
        if (-not $heroPaths.ContainsKey($variantName)) {
            throw "Missing config value: assets.heroPaths.$variantName"
        }
        $variantConfig = Require-Value $variants[$variantName] "assets.variants.$variantName"
        foreach ($path in @("startColor", "endColor", "accentColor", "sound", "emoji")) {
            Require-Value $variantConfig[$path] "assets.variants.$variantName.$path" | Out-Null
        }
    }

    foreach ($channelName in $copyEvents.Keys) {
        $channelConfig = Require-Value $copy[$channelName] "copy.$channelName"
        foreach ($eventName in $copyEvents[$channelName]) {
            $eventConfig = Require-Value $channelConfig[$eventName] "copy.$channelName.$eventName"
            Require-Value $eventConfig["status"] "copy.$channelName.$eventName.status" | Out-Null
            foreach ($path in @("subject", "detail")) {
                Require-Value $eventConfig[$path] "copy.$channelName.$eventName.$path" -AllowEmptyString | Out-Null
            }
            foreach ($path in @("variant", "duration", "layout")) {
                Require-Value $eventConfig[$path] "copy.$channelName.$eventName.$path" | Out-Null
            }
            Assert-AllowedValue -Value $eventConfig["variant"] -Allowed $validVariants -Name "copy.$channelName.$eventName.variant"
            Assert-AllowedValue -Value $eventConfig["duration"] -Allowed @("short", "long") -Name "copy.$channelName.$eventName.duration"
            Assert-AllowedValue -Value $eventConfig["layout"] -Allowed $validLayouts -Name "copy.$channelName.$eventName.layout"
        }
    }

    return $config
}

function Get-NotificationPayload {
    param([hashtable]$Config)

    Assert-AllowedValue -Value $Duration -Allowed @("short", "long") -Name "Duration" -AllowEmpty
    Assert-AllowedValue -Value $Layout -Allowed $validLayouts -Name "Layout" -AllowEmpty

    $payload = @{
        Mode = "manual"
        Channel = $null
        Event = $null
        Context = @{}
        Variant = $Variant
        Status = Get-FirstNonEmpty @($Status, $Title, (Get-DefaultStatus $Variant))
        Subject = Get-FirstNonEmpty @($Subject, $Subtitle)
        Detail = Get-FirstNonEmpty @($Detail, $Message)
        Folder = ""
        Job = ""
        UseStructuredBody = $false
        ActivationUri = ""
        Attribution = if ([string]::IsNullOrWhiteSpace($Attribution)) { $Config.app.attribution } else { $Attribution }
        Duration = if ([string]::IsNullOrWhiteSpace($Duration)) { $Config.app.defaultDuration } else { $Duration }
        Layout = if ([string]::IsNullOrWhiteSpace($Layout)) { $Config.app.defaultLayout } else { $Layout }
    }

    if (-not [string]::IsNullOrWhiteSpace($Channel) -or -not [string]::IsNullOrWhiteSpace($Event)) {
        $payload.Mode = "semantic"
        Assert-AllowedValue -Value $Channel -Allowed $validChannels -Name "Channel"
        Assert-AllowedValue -Value $Event -Allowed $copyEvents[$Channel] -Name "Event"

        $payload.Channel = $Channel
        $payload.Event = $Event
        $payload.Context = Get-ContextData

        $eventConfig = $Config.copy[$Channel][$Event]
        $payload.Variant = $eventConfig.variant
        $payload.Status = Resolve-TemplateText -Template $eventConfig.status -Context $payload.Context
        $payload.Subject = Resolve-TemplateText -Template $eventConfig.subject -Context $payload.Context
        $payload.Detail = Resolve-TemplateText -Template $eventConfig.detail -Context $payload.Context
        $folderTemplate = if ($eventConfig.ContainsKey("folder")) { $eventConfig["folder"] } else { "" }
        $jobTemplate = if ($eventConfig.ContainsKey("job")) { $eventConfig["job"] } else { "" }
        $payload.Folder = Resolve-TemplateText -Template $folderTemplate -Context $payload.Context
        $payload.Job = Resolve-TemplateText -Template $jobTemplate -Context $payload.Context
        $payload.Duration = $eventConfig.duration
        $payload.Layout = if ([string]::IsNullOrWhiteSpace($Layout)) { $eventConfig.layout } else { $Layout }
        $payload.UseStructuredBody = (
            $Channel -eq "interactive" -and (
                -not [string]::IsNullOrWhiteSpace($payload.Folder) -or
                -not [string]::IsNullOrWhiteSpace($payload.Job)
            )
        )
        $payload.ActivationUri = Get-ActivationUri -Payload $payload
    }

    if ([string]::IsNullOrWhiteSpace($payload.Status)) {
        $payload.Status = Get-DefaultStatus $payload.Variant
    }

    if ($null -eq $payload.Subject) {
        $payload.Subject = ""
    }

    if ($null -eq $payload.Detail) {
        $payload.Detail = ""
    }

    $comparableSubject = Get-ComparableText $payload.Subject
    $comparableDisplayName = Get-ComparableText $Config.app.displayName
    $comparableAttribution = Get-ComparableText $payload.Attribution

    if (
        $comparableSubject -and (
            $comparableSubject -eq $comparableDisplayName -or
            $comparableSubject -eq $comparableAttribution
        )
    ) {
        $payload.Subject = ""
    }

    return $payload
}

function ConvertTo-Color {
    param([string]$Hex)
    return [System.Drawing.ColorTranslator]::FromHtml($Hex)
}

function ConvertTo-XmlText {
    param([AllowEmptyString()][string]$Text)
    if ($null -eq $Text) {
        return ""
    }
    return [System.Security.SecurityElement]::Escape($Text)
}

function ConvertTo-XmlAttributeString {
    param([hashtable]$Attributes)

    if ($null -eq $Attributes -or $Attributes.Count -eq 0) {
        return ""
    }

    $parts = @()
    foreach ($key in $Attributes.Keys) {
        $value = [string]$Attributes[$key]
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $parts += "$key=`"$(ConvertTo-XmlText $value)`""
        }
    }

    if ($parts.Count -eq 0) {
        return ""
    }

    return " " + ($parts -join " ")
}

function Get-ToastRenderData {
    param(
        [hashtable]$Config,
        [hashtable]$Payload
    )

    $variantConfig = $Config.assets.variants[$Payload.Variant]
    $statusLine = $Payload.Status
    if ($Payload.Layout -eq "compact" -and -not [string]::IsNullOrWhiteSpace($variantConfig.emoji)) {
        $statusLine = "$statusLine $($variantConfig.emoji)".Trim()
    }

    $textEntries = @()
    $bodyLines = @()

    if ($Payload.Layout -eq "compact") {
        if (-not [string]::IsNullOrWhiteSpace($statusLine)) {
            $textEntries += @{ Text = $statusLine; Attributes = @{} }
            $bodyLines += $statusLine
        }

        if ($Payload.UseStructuredBody) {
            $folderLine = Trim-ToastText -Text $Payload.Folder -MaxLength 56
            $jobLine = Trim-ToastText -Text $Payload.Job -MaxLength 72
            $groupLines = @()

            if (-not [string]::IsNullOrWhiteSpace($folderLine)) {
                $groupLines += "          <text hint-style=`"base`" hint-maxLines=`"1`">$(ConvertTo-XmlText $folderLine)</text>"
                $bodyLines += $folderLine
            }

            if (-not [string]::IsNullOrWhiteSpace($jobLine)) {
                $groupLines += "          <text hint-style=`"baseSubtle`" hint-maxLines=`"1`">$(ConvertTo-XmlText $jobLine)</text>"
                $bodyLines += $jobLine
            }

            if ($groupLines.Count -gt 0) {
                $textEntries += @{
                    RawXml = @"
      <group>
        <subgroup>
$($groupLines -join "`n")
        </subgroup>
      </group>
"@
                }
            }
        } else {
            $subjectLine = Trim-ToastText -Text $Payload.Subject -MaxLength 64
            $detailLine = Trim-ToastText -Text $Payload.Detail -MaxLength 96

            if (-not [string]::IsNullOrWhiteSpace($subjectLine)) {
                $textEntries += @{ Text = $subjectLine; Attributes = @{} }
                $bodyLines += $subjectLine
            }
            if (-not [string]::IsNullOrWhiteSpace($detailLine)) {
                $textEntries += @{ Text = $detailLine; Attributes = @{} }
                $bodyLines += $detailLine
            }
        }
    } else {
        $heroBodyLine = Get-FirstNonEmpty @($Payload.Detail, $Payload.Subject)
        $heroBodyLine = Trim-ToastText -Text $heroBodyLine -MaxLength 96
        if (-not [string]::IsNullOrWhiteSpace($heroBodyLine)) {
            $textEntries += @{ Text = $heroBodyLine; Attributes = @{} }
            $bodyLines += $heroBodyLine
        }
    }

    return @{
        StatusLine = $statusLine
        TextEntries = $textEntries
        BodyLines = $bodyLines
    }
}

function Convert-ToastTextEntryToXml {
    param([hashtable]$Entry)

    if ($Entry.ContainsKey("RawXml")) {
        return $Entry.RawXml
    }

    $attrString = ConvertTo-XmlAttributeString -Attributes $Entry.Attributes
    return "      <text$attrString>$(ConvertTo-XmlText $Entry.Text)</text>"
}

function Build-ToastXml {
    param(
        [hashtable]$Config,
        [hashtable]$Payload,
        [hashtable]$Assets,
        [hashtable]$RenderData
    )

    $variantConfig = $Config.assets.variants[$Payload.Variant]
    $sound = ConvertTo-XmlText $variantConfig.sound
    $bindingLines = @()

    if ($Payload.Layout -eq "hero" -and -not [string]::IsNullOrWhiteSpace($Assets.HeroPath)) {
        $bindingLines += "      <image placement=`"hero`" src=`"$(ConvertTo-XmlText $Assets.HeroPath)`" />"
    }
    $bindingLines += "      <image placement=`"appLogoOverride`" hint-crop=`"circle`" src=`"$(ConvertTo-XmlText $Assets.LogoPath)`" />"
    foreach ($entry in $RenderData.TextEntries) {
        $bindingLines += Convert-ToastTextEntryToXml -Entry $entry
    }
    if (-not [string]::IsNullOrWhiteSpace($Payload.Attribution)) {
        $bindingLines += "      <text placement=`"attribution`">$(ConvertTo-XmlText $Payload.Attribution)</text>"
    }

    $toastAttributes = @("duration=`"$($Payload.Duration)`"")
    if (-not [string]::IsNullOrWhiteSpace($Payload.ActivationUri)) {
        $toastAttributes += "activationType=`"protocol`""
        $toastAttributes += "launch=`"$(ConvertTo-XmlText $Payload.ActivationUri)`""
    }

    return @"
<toast $($toastAttributes -join " ")>
  <visual>
    <binding template="ToastGeneric">
$($bindingLines -join "`n")
    </binding>
  </visual>
  <audio src="$sound" />
</toast>
"@
}

function New-RoundedRectPath {
    param(
        [System.Drawing.RectangleF]$Rect,
        [float]$Radius
    )

    $diameter = [Math]::Min($Radius * 2, [Math]::Min($Rect.Width, $Rect.Height))
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $arc = New-Object System.Drawing.RectangleF($Rect.X, $Rect.Y, $diameter, $diameter)

    $path.AddArc($arc, 180, 90)
    $arc.X = $Rect.Right - $diameter
    $path.AddArc($arc, 270, 90)
    $arc.Y = $Rect.Bottom - $diameter
    $path.AddArc($arc, 0, 90)
    $arc.X = $Rect.X
    $path.AddArc($arc, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-NotificationLogo {
    param(
        [string]$Path,
        [hashtable]$LogoConfig
    )

    if (Test-Path -LiteralPath $Path) {
        return
    }

    $bitmap = New-Object System.Drawing.Bitmap 96, 96
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $backgroundRect = New-Object System.Drawing.Rectangle 0, 0, 96, 96
    $backgroundBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $backgroundRect, (ConvertTo-Color $LogoConfig.startColor), (ConvertTo-Color $LogoConfig.endColor), 50
    $overlayBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb([int]$LogoConfig.overlayOpacity, (ConvertTo-Color $LogoConfig.overlayColor)))
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb([int]$LogoConfig.borderOpacity, (ConvertTo-Color $LogoConfig.borderColor)), 2.5)
    $font = New-Object System.Drawing.Font("Segoe UI Semibold", 28, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush((ConvertTo-Color $LogoConfig.textColor))
    $format = New-Object System.Drawing.StringFormat

    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center

    $graphics.FillEllipse($backgroundBrush, 4, 4, 88, 88)
    $graphics.FillEllipse($overlayBrush, 18, 14, 56, 34)
    $graphics.DrawEllipse($borderPen, 4, 4, 88, 88)
    $graphics.DrawString([string]$LogoConfig.badgeText, $font, $textBrush, (New-Object System.Drawing.RectangleF(0, 1, 96, 92)), $format)

    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

    $format.Dispose()
    $textBrush.Dispose()
    $font.Dispose()
    $borderPen.Dispose()
    $overlayBrush.Dispose()
    $backgroundBrush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

function New-NotificationHeroComposite {
    param(
        [string]$Path,
        [hashtable]$VariantConfig,
        [string]$HeroStatus,
        [string]$HeroSubject,
        [string]$BackgroundPath
    )

    if (Test-Path -LiteralPath $Path) {
        return
    }

    $width = 364
    $height = 160
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    if (-not [string]::IsNullOrWhiteSpace($BackgroundPath) -and (Test-Path -LiteralPath $BackgroundPath)) {
        $backgroundImage = [System.Drawing.Image]::FromFile($BackgroundPath)
        try {
            $graphics.DrawImage($backgroundImage, (New-Object System.Drawing.Rectangle(0, 0, $width, $height)))
        } finally {
            $backgroundImage.Dispose()
        }

        $overlayBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
            New-Object System.Drawing.Rectangle(0, 0, $width, $height)
        ), [System.Drawing.Color]::FromArgb(120, 7, 12, 20), [System.Drawing.Color]::FromArgb(30, 7, 12, 20), 0
        $graphics.FillRectangle($overlayBrush, 0, 0, $width, $height)
        $overlayBrush.Dispose()
    } else {
        $heroRect = New-Object System.Drawing.Rectangle 0, 0, $width, $height
        $backgroundBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $heroRect, (ConvertTo-Color $VariantConfig.startColor), (ConvertTo-Color $VariantConfig.endColor), 20
        $glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(34, 255, 255, 255))
        $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(28, 255, 255, 255), 2)

        $graphics.FillRectangle($backgroundBrush, $heroRect)
        $graphics.FillEllipse($glowBrush, $width - 180, -40, 220, 220)
        $graphics.FillEllipse($glowBrush, -70, 60, 170, 170)
        for ($offset = -120; $offset -lt 420; $offset += 24) {
            $graphics.DrawLine($linePen, $offset, $height, $offset + 100, 0)
        }

        $linePen.Dispose()
        $glowBrush.Dispose()
        $backgroundBrush.Dispose()
    }

    $headlineFont = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $headlineBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(250, 248, 250, 252))
    $subFont = New-Object System.Drawing.Font("Segoe UI Semibold", 13, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $subBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 248, 250, 252))
    $accentBrush = New-Object System.Drawing.SolidBrush((ConvertTo-Color $VariantConfig.accentColor))
    $headlineRect = New-Object System.Drawing.RectangleF 24, 40, 250, 58
    $subjectRect = New-Object System.Drawing.RectangleF 26, 102, 240, 24

    $graphics.DrawString($HeroStatus, $headlineFont, $headlineBrush, $headlineRect)
    if (-not [string]::IsNullOrWhiteSpace($HeroSubject)) {
        $graphics.DrawString($HeroSubject, $subFont, $subBrush, $subjectRect)
    }
    $graphics.FillEllipse($accentBrush, $width - 82, 24, 36, 36)
    $graphics.FillEllipse($accentBrush, $width - 48, 42, 12, 12)

    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

    $accentBrush.Dispose()
    $subBrush.Dispose()
    $subFont.Dispose()
    $headlineBrush.Dispose()
    $headlineFont.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

function Get-ShortcutIconInfo {
    param([hashtable]$Config)

    $iconPath = Resolve-ConfiguredPath $Config.assets.shortcutIconPath
    if (-not [string]::IsNullOrWhiteSpace($iconPath) -and (Test-Path -LiteralPath $iconPath)) {
        return @{
            Path = $iconPath
            Source = "custom"
        }
    }

    return @{
        Path = $powershellExe
        Source = "fallback"
    }
}

function Ensure-NotificationAssets {
    param(
        [hashtable]$Config,
        [hashtable]$Payload
    )

    $assetRoot = Join-Path $env:LOCALAPPDATA "AIOS\notifications\$($Config.app.assetVersion)"
    New-Item -ItemType Directory -Force -Path $assetRoot | Out-Null

    $logoPath = Resolve-ConfiguredPath $Config.assets.logoPath
    $logoSource = "custom"
    if ([string]::IsNullOrWhiteSpace($logoPath) -or -not (Test-Path -LiteralPath $logoPath)) {
        $logoPath = Join-Path $assetRoot "AI-OS-logo.png"
        $logoSource = "generated"
        New-NotificationLogo -Path $logoPath -LogoConfig $Config.assets.generatedLogo
    }

    $iconInfo = Get-ShortcutIconInfo -Config $Config

    $heroPath = $null
    $heroSource = $null
    if ($Payload.Layout -eq "hero") {
        $backgroundPath = Resolve-ConfiguredPath $Config.assets.heroPaths[$Payload.Variant]
        $variantConfig = $Config.assets.variants[$Payload.Variant]
        $heroRenderVersion = "hero-v3"

        $backgroundSourceKey = if (-not [string]::IsNullOrWhiteSpace($backgroundPath) -and (Test-Path -LiteralPath $backgroundPath)) {
            $backgroundItem = Get-Item -LiteralPath $backgroundPath
            "custom|$($backgroundItem.FullName)|$($backgroundItem.LastWriteTimeUtc.Ticks)"
        } else {
            "generated|$($variantConfig.startColor)|$($variantConfig.endColor)|$($variantConfig.accentColor)"
        }

        $heroHash = (Get-HashString "$heroRenderVersion|$($Payload.Variant)|$backgroundSourceKey|$($Payload.Status)|$($Payload.Subject)").Substring(0, 16)
        $heroPath = Join-Path $assetRoot "hero-$heroHash.png"
        $heroSource = if ($backgroundSourceKey.StartsWith("custom|")) { "custom-background" } else { "generated-background" }
        New-NotificationHeroComposite -Path $heroPath -VariantConfig $variantConfig -HeroStatus $Payload.Status -HeroSubject $Payload.Subject -BackgroundPath $backgroundPath
    }

    return @{
        AssetRoot = $assetRoot
        LogoPath = $logoPath
        LogoSource = $logoSource
        ShortcutIconPath = $iconInfo.Path
        ShortcutIconSource = $iconInfo.Source
        HeroPath = $heroPath
        HeroSource = $heroSource
    }
}

function Ensure-ShortcutInterop {
    if ("DesktopToastShortcut" -as [type]) {
        return
    }

    Add-Type -Language CSharp @"
using System;
using System.Runtime.InteropServices;
using System.Text;
[ComImport, Guid("00021401-0000-0000-C000-000000000046")] internal class CShellLink {}
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")] internal interface IShellLinkW {
void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cchMaxPath, IntPtr pfd, int fFlags); void GetIDList(out IntPtr ppidl); void SetIDList(IntPtr pidl);
void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMaxName); void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cchMaxPath); void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cchMaxPath); void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
void GetHotkey(out short pwHotkey); void SetHotkey(short wHotkey); void GetShowCmd(out int piShowCmd); void SetShowCmd(int iShowCmd);
void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cchIconPath, out int iIcon); void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, int dwReserved); void Resolve(IntPtr hwnd, int fFlags); void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile); }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")] internal interface IPersistFile {
void GetClassID(out Guid pClassID); void IsDirty(); void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode); void Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, bool fRemember);
void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName); void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName); }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")] internal interface IPropertyStore {
void GetCount(out uint cProps); void GetAt(uint iProp, out PROPERTYKEY pkey); void GetValue(ref PROPERTYKEY key, out PROPVARIANT pv); void SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv); void Commit(); }
[StructLayout(LayoutKind.Sequential, Pack = 4)] internal struct PROPERTYKEY { public Guid fmtid; public uint pid; public PROPERTYKEY(Guid format, uint propertyId) { fmtid = format; pid = propertyId; } }
[StructLayout(LayoutKind.Explicit)] internal struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointerValue; public PROPVARIANT(string value) { pointerValue = Marshal.StringToCoTaskMemUni(value); vt = 31; } }
public static class DesktopToastShortcut {
private static readonly PROPERTYKEY AppIdKey = new PROPERTYKEY(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5); [DllImport("Ole32.dll")] private static extern int PropVariantClear(ref PROPVARIANT pvar);
public static void EnsureShortcut(string shortcutPath, string targetPath, string arguments, string workingDirectory, string description, string appId, string iconPath) {
var link = (IShellLinkW)new CShellLink(); var key = AppIdKey; link.SetPath(targetPath); if (!string.IsNullOrEmpty(arguments)) link.SetArguments(arguments); if (!string.IsNullOrEmpty(workingDirectory)) link.SetWorkingDirectory(workingDirectory);
if (!string.IsNullOrEmpty(description)) link.SetDescription(description); if (!string.IsNullOrEmpty(iconPath)) link.SetIconLocation(iconPath, 0); var propertyStore = (IPropertyStore)link; var appIdVariant = new PROPVARIANT(appId);
try { propertyStore.SetValue(ref key, ref appIdVariant); propertyStore.Commit(); } finally { PropVariantClear(ref appIdVariant); } ((IPersistFile)link).Save(shortcutPath, true); } }
"@
}

function Ensure-ProtocolHandler {
    param(
        [string]$ProtocolName,
        [string]$ScriptPath
    )

    if (-not (Test-Path -LiteralPath $ScriptPath)) {
        throw "Protocol activation script was not found at $ScriptPath"
    }

    $baseKey = "HKCU:\Software\Classes\$ProtocolName"
    $commandKey = Join-Path $baseKey "shell\open\command"
    $commandValue = "`"$powershellExe`" -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" `"%1`""

    New-Item -Path $baseKey -Force | Out-Null
    Set-Item -Path $baseKey -Value "URL:$ProtocolName Protocol"
    New-ItemProperty -Path $baseKey -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
    New-Item -Path $commandKey -Force | Out-Null
    Set-Item -Path $commandKey -Value $commandValue
}

function Ensure-StartMenuShortcut {
    param(
        [string]$ShortcutPath,
        [hashtable]$Config,
        [string]$IconPath
    )

    Ensure-ShortcutInterop
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ShortcutPath) | Out-Null
    $legacyShortcutPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\AI-OS Notifications.lnk"
    if ($legacyShortcutPath -ne $ShortcutPath -and (Test-Path -LiteralPath $legacyShortcutPath)) {
        Remove-Item -LiteralPath $legacyShortcutPath -Force -ErrorAction SilentlyContinue
    }
    [DesktopToastShortcut]::EnsureShortcut(
        $ShortcutPath,
        $powershellExe,
        "-NoProfile",
        $projectDir,
        "$($Config.app.displayName) desktop notifications",
        $Config.app.id,
        $IconPath
    )
}

function Show-BalloonFallback {
    param(
        [string]$FallbackTitle,
        [string]$FallbackMessage
    )

    $notifyIcon = New-Object System.Windows.Forms.NotifyIcon
    try {
        $notifyIcon.Icon = [System.Drawing.SystemIcons]::Information
        $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $notifyIcon.BalloonTipTitle = $FallbackTitle
        $notifyIcon.BalloonTipText = $FallbackMessage
        $notifyIcon.Visible = $true
        $notifyIcon.ShowBalloonTip(5000)
        Start-Sleep -Milliseconds 1200
    } finally {
        $notifyIcon.Dispose()
    }
}

function Show-Toast {
    param(
        [hashtable]$Config,
        [hashtable]$Payload,
        [hashtable]$Assets,
        [hashtable]$RenderData
    )

    $xmlContent = Build-ToastXml -Config $Config -Payload $Payload -Assets $Assets -RenderData $RenderData

    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($xmlContent)

    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Config.app.id).Show($toast)
}

$config = Load-NotificationConfig
$payload = Get-NotificationPayload -Config $config
$renderData = Get-ToastRenderData -Config $config -Payload $payload
$shortcutPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$($config.app.shortcutName).lnk"
$result = [ordered]@{
    ok                    = $false
    delivery              = "none"
    preview               = [bool]$Preview
    mode                  = $payload.Mode
    channel               = $payload.Channel
    event                 = $payload.Event
    variant               = $payload.Variant
    layout                = $payload.Layout
    status                = $payload.Status
    status_line           = $renderData.StatusLine
    subject               = $payload.Subject
    detail                = $payload.Detail
    folder                = $payload.Folder
    job                   = $payload.Job
    body_lines            = $renderData.BodyLines
    title                 = $config.app.displayName
    subtitle              = $payload.Status
    message               = Get-FirstNonEmpty @($payload.Detail, $payload.Job, $payload.Subject)
    duration              = $payload.Duration
    attribution           = $payload.Attribution
    activation_uri        = $payload.ActivationUri
    app_id                = $config.app.id
    display_name          = $config.app.displayName
    config_path           = $configPath
    shortcut_path         = $shortcutPath
}

try {
    $assets = Ensure-NotificationAssets -Config $config -Payload $payload
    $result.asset_root = $assets.AssetRoot
    $result.logo_path = $assets.LogoPath
    $result.logo_source = $assets.LogoSource
    $result.shortcut_icon_path = $assets.ShortcutIconPath
    $result.shortcut_icon_source = $assets.ShortcutIconSource
    if (-not [string]::IsNullOrWhiteSpace($assets.HeroPath)) {
        $result.hero_path = $assets.HeroPath
        $result.hero_source = $assets.HeroSource
    }
    $result.xml = Build-ToastXml -Config $config -Payload $payload -Assets $assets -RenderData $renderData

    if ($Preview) {
        $result.ok = $true
        $result.delivery = "preview"
    } else {
        Ensure-ProtocolHandler -ProtocolName $protocolName -ScriptPath $activationScriptPath
        Ensure-StartMenuShortcut -ShortcutPath $shortcutPath -Config $config -IconPath $assets.ShortcutIconPath
        Show-Toast -Config $config -Payload $payload -Assets $assets -RenderData $renderData

        $result.ok = $true
        $result.delivery = "toast"
    }
}
catch {
    $result.toast_error = $_.Exception.Message
    try {
        $fallbackTitle = "$($payload.Status) - $($payload.Subject)".Trim(" -".ToCharArray())
        if ([string]::IsNullOrWhiteSpace($fallbackTitle)) {
            $fallbackTitle = $config.app.displayName
        }
        $fallbackMessage = Get-FirstNonEmpty @($payload.Detail, $payload.Subject, $payload.Status)
        Show-BalloonFallback -FallbackTitle $fallbackTitle -FallbackMessage $fallbackMessage
        $result.ok = $true
        $result.delivery = "balloon"
    }
    catch {
        $result.fallback_error = $_.Exception.Message
    }
}

$result | ConvertTo-Json -Compress

if (-not $result.ok) {
    exit 1
}
