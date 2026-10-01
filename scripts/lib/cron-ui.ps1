function Write-AiOsCronBanner {
    param(
        [string]$Heading,
        [string]$Subheading = ""
    )

    Write-Host ""
    Write-Host "+----------------------------------------------+" -ForegroundColor Cyan
    Write-Host "|                                              |" -ForegroundColor Cyan
    Write-Host "|              AI-OS CRON                 |" -ForegroundColor Cyan
    Write-Host "|                                              |" -ForegroundColor Cyan
    Write-Host "|              MANAGED RUNTIME                 |" -ForegroundColor Cyan
    Write-Host "|                                              |" -ForegroundColor Cyan
    Write-Host "+----------------------------------------------+" -ForegroundColor Cyan
    Write-Host ""
    Write-Host $Heading -ForegroundColor Cyan
    if (-not [string]::IsNullOrWhiteSpace($Subheading)) {
        Write-Host $Subheading -ForegroundColor DarkGray
    }
    Write-Host ""
}

function Write-AiOsCronInfo {
    param([string]$Text)
    Write-Host $Text -ForegroundColor Cyan
}

function Write-AiOsCronSuccess {
    param([string]$Text)
    Write-Host "  OK  $Text" -ForegroundColor Green
}

function Write-AiOsCronWarn {
    param([string]$Text)
    Write-Host "  WARN $Text" -ForegroundColor Yellow
}

function Write-AiOsCronFail {
    param([string]$Text)
    Write-Host "  ERR  $Text" -ForegroundColor Red
}

function Write-AiOsCronNote {
    param([string]$Text)
    Write-Host $Text -ForegroundColor DarkGray
}
