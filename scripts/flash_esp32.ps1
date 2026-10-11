param(
    [string]$Port = "",
    [int]$Baud = 0,
    [string]$IdfPath = "",
    [string]$ToolsPath = "",
    [string]$PythonEnv = ""
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot "load_esp32_env.ps1")
$cfg = Get-Esp32Profile -ExplicitPort $Port -ExplicitBaud $Baud -ExplicitIdfPath $IdfPath -ExplicitToolsPath $ToolsPath -ExplicitPythonEnv $PythonEnv

Set-Location -Path $cfg.Esp32Dir

Write-Host "Flashing ESP32 on port $($cfg.Port) ($($cfg.Baud) baud) from $($cfg.Esp32Dir)..." -ForegroundColor Green
Write-Host "IDF_PATH   : $($cfg.IdfPath)" -ForegroundColor DarkGray
Write-Host "PYTHON_EXE : $($cfg.PythonExe)" -ForegroundColor DarkGray

& $cfg.PythonExe $cfg.IdfPy -p $cfg.Port -b $cfg.Baud flash
