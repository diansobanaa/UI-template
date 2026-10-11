param(
    [string]$IdfPath = "",
    [string]$ToolsPath = "",
    [string]$PythonEnv = ""
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot "load_esp32_env.ps1")
$cfg = Get-Esp32Profile -ExplicitIdfPath $IdfPath -ExplicitToolsPath $ToolsPath -ExplicitPythonEnv $PythonEnv

Set-Location -Path $cfg.Esp32Dir

Write-Host "Building ESP32 firmware in $($cfg.Esp32Dir)..." -ForegroundColor Cyan
Write-Host "IDF_PATH   : $($cfg.IdfPath)" -ForegroundColor DarkGray
Write-Host "PYTHON_EXE : $($cfg.PythonExe)" -ForegroundColor DarkGray

& $cfg.PythonExe $cfg.IdfPy build
