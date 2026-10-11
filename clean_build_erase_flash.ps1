param(
    [string]$Port = "",
    [int]$Baud = 0,
    [string]$Python = "",
    [string]$ToolsPath = ""
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot "scripts\load_esp32_env.ps1")
$cfg = Get-Esp32Profile -ExplicitPort $Port -ExplicitBaud $Baud -ExplicitToolsPath $ToolsPath

$repo = $cfg.RepoRoot
Set-Location $repo

Write-Host "=== TARGET REPO: $repo ===" -ForegroundColor Cyan
Write-Host "=== TARGET PORT: $($cfg.Port) ($($cfg.Baud) baud) ===" -ForegroundColor Cyan
Write-Host "=== PYTHON EXE : $($cfg.PythonExe) ===" -ForegroundColor Cyan

Write-Host '=== 1/4 REMOVE OLD BUILD ===' -ForegroundColor Cyan
$build = Join-Path $repo 'esp32\build'
if (Test-Path $build) {
    Remove-Item $build -Recurse -Force
}

Write-Host '=== 2/4 CLEAN BUILD ===' -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\build_esp32.ps1')
if ($LASTEXITCODE -ne 0) {
    throw "Build failed. Flash/erase aborted."
}

Write-Host '=== 3/4 FULL FLASH ERASE ===' -ForegroundColor Yellow
& $cfg.PythonExe -m esptool --chip esp32s3 -p $cfg.Port -b $cfg.Baud --before default_reset --after hard_reset erase_flash
if ($LASTEXITCODE -ne 0) {
    throw "erase_flash failed."
}

Write-Host '=== 4/4 FLASH FRESH BUILD ===' -ForegroundColor Green
powershell -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\flash_esp32.ps1') -Port $cfg.Port -Baud $cfg.Baud
if ($LASTEXITCODE -ne 0) {
    throw "Flash failed."
}

Write-Host ''
Write-Host 'DONE: clean build + full erase + flash completed.' -ForegroundColor Green
Write-Host 'WARNING: NVS/configuration/Wi-Fi/binding data were erased.' -ForegroundColor Yellow
