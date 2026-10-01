[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$PythonLib = Join-Path $ScriptDir "lib\python.ps1"
$Helper = Join-Path $ScriptDir "lib\command-centre-db-restore.py"

. $PythonLib
$Python = Resolve-PythonCommand
if (-not $Python) {
    Write-Error "Python 3 is required for this test."
    exit 1
}

$Executable = $Python.CommandParts[0]
$ExtraArgs = @()
if ($Python.CommandParts.Length -gt 1) {
    $ExtraArgs = $Python.CommandParts[1..($Python.CommandParts.Length - 1)]
}

function Invoke-Python {
    param([string[]]$Arguments)
    & $Executable @ExtraArgs @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed: $($Arguments -join ' ')"
    }
}

function Assert-Exists {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Expected path to exist: $Path"
    }
}

function Assert-NotExists {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path) {
        throw "Expected path not to exist: $Path"
    }
}

function Assert-RowCount {
    param(
        [string]$DbPath,
        [string]$Sql,
        [string]$Expected
    )

    $script = @'
import sqlite3
import sys
connection = sqlite3.connect(sys.argv[1])
print(connection.execute(sys.argv[2]).fetchone()[0])
connection.close()
'@
    $assertScript = Join-Path ([System.IO.Path]::GetTempPath()) ("AI-OS-sql-assert-" + [guid]::NewGuid().ToString("N") + ".py")
    Set-Content -LiteralPath $assertScript -Value $script -Encoding UTF8
    $actual = & $Executable @ExtraArgs $assertScript $DbPath $Sql
    Remove-Item -LiteralPath $assertScript -Force -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0) {
        throw "SQLite assertion failed."
    }
    if (($actual | Out-String).Trim() -ne $Expected) {
        throw "Expected '$Sql' to return $Expected, got $actual"
    }
}

$TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("AI-OS-db-restore-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null

try {
    $OldInstall = Join-Path $TestRoot "old"
    $NewInstall = Join-Path $TestRoot "new"
    $OldData = Join-Path $OldInstall ".command-centre"
    New-Item -ItemType Directory -Force -Path $OldData, $NewInstall | Out-Null

    $OldDb = Join-Path $OldData "data.db"
    $createScript = @'
import sqlite3
import sys
connection = sqlite3.connect(sys.argv[1])
connection.executescript('''
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'backlog',
  level TEXT NOT NULL DEFAULT 'task',
  parentId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE task_logs (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT ''
);
''')
connection.execute("INSERT INTO tasks (id, title, status, level, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)", ("goal-1", "Restored goal", "backlog", "project", "2026-06-05", "2026-06-05"))
connection.execute("INSERT INTO task_logs (id, taskId, type, timestamp, content) VALUES (?, ?, ?, ?, ?)", ("log-1", "goal-1", "text", "2026-06-05", "restored activity"))
connection.commit()
connection.close()
'@
    $CreateScriptPath = Join-Path $TestRoot "create-old-db.py"
    Set-Content -LiteralPath $CreateScriptPath -Value $createScript -Encoding UTF8
    Invoke-Python -Arguments @($CreateScriptPath, $OldDb)

    Set-Content -LiteralPath (Join-Path $OldData "port") -Value "3000"

    Invoke-Python -Arguments @($Helper, "--old-install", $OldInstall, "--new-install", $NewInstall)

    $NewData = Join-Path $NewInstall ".command-centre"
    Assert-Exists -Path (Join-Path $NewData "data.db")
    Assert-NotExists -Path (Join-Path $NewData "port")
    Assert-RowCount -DbPath (Join-Path $NewData "data.db") -Sql "SELECT COUNT(*) FROM tasks" -Expected "1"
    Assert-RowCount -DbPath (Join-Path $NewData "data.db") -Sql "SELECT COUNT(*) FROM task_logs" -Expected "1"

    Write-Host "Command Centre DB restore PowerShell test passed."
}
finally {
    Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
}
