[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SetupMemory = Join-Path $ScriptDir "setup-memory.ps1"

Write-Host "setup-memsearch.ps1 is kept for compatibility."
Write-Host "MemSearch setup is retired. Running the memory migration/setup flow instead."
Write-Host ""

& $SetupMemory @RemainingArgs
exit $LASTEXITCODE
