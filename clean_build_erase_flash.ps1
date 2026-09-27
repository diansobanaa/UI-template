$ErrorActionPreference = 'Stop'

$repo = 'C:\Users\rumah\Downloads\UI-template-chatgpt-network-onboarding-final'
$python = 'D:\Espressif-tool\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe'
$port = 'COM3'

Set-Location $repo

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
if (-not (Test-Path $python)) {
    throw "ESP-IDF Python environment not found: $python"
}
& $python -m esptool --chip esp32s3 -p $port -b 460800 --before default_reset --after hard_reset erase_flash
if ($LASTEXITCODE -ne 0) {
    throw "erase_flash failed."
}

Write-Host '=== 4/4 FLASH FRESH BUILD ===' -ForegroundColor Green
powershell -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\flash_esp32.ps1')
if ($LASTEXITCODE -ne 0) {
    throw "Flash failed."
}

Write-Host ''
Write-Host 'DONE: clean build + full erase + flash completed.' -ForegroundColor Green
Write-Host 'WARNING: NVS/configuration/Wi-Fi/binding data were erased.' -ForegroundColor Yellow
