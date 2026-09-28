$env:IDF_PATH = "D:\Espressif"
$env:IDF_TOOLS_PATH = "D:\Espressif-tool\Espressif"
$env:IDF_PYTHON_ENV_PATH = "D:\Espressif-tool\Espressif\python_env\idf5.5_py3.12_env"
$env:ESP_IDF_VERSION = "5.5"
$env:IDF_CCACHE_ENABLE = "1"
$env:OPENOCD_SCRIPTS = "D:\Espressif-tool\Espressif\tools\openocd-esp32\v0.12.0-esp32-20260424\openocd-esp32\share\openocd\scripts"
$env:ESP_ROM_ELF_DIR = "D:\Espressif-tool\Espressif\tools\esp-rom-elfs\20241011\"
$env:PYTHONNOUSERSITE = "True"
$env:PYTHONPATH = $null
$env:PYTHONHOME = $null

$toolsBin = @(
    "D:\Espressif-tool\Espressif\tools\xtensa-esp-elf-gdb\17.1_20260402\xtensa-esp-elf-gdb\bin",
    "D:\Espressif-tool\Espressif\tools\riscv32-esp-elf-gdb\17.1_20260402\riscv32-esp-elf-gdb\bin",
    "D:\Espressif-tool\Espressif\tools\xtensa-esp-elf\esp-14.2.0_20260121\xtensa-esp-elf\bin",
    "D:\Espressif-tool\Espressif\tools\esp-clang\esp-19.1.2_20250312\esp-clang\bin",
    "D:\Espressif-tool\Espressif\tools\riscv32-esp-elf\esp-14.2.0_20260121\riscv32-esp-elf\bin",
    "D:\Espressif-tool\Espressif\tools\esp32ulp-elf\2.38_20240113\esp32ulp-elf\bin",
    "D:\Espressif-tool\Espressif\tools\cmake\3.30.2\bin",
    "D:\Espressif-tool\Espressif\tools\openocd-esp32\v0.12.0-esp32-20260424\openocd-esp32\bin",
    "D:\Espressif-tool\Espressif\tools\ninja\1.12.1\",
    "D:\Espressif-tool\Espressif\tools\idf-exe\1.0.3\",
    "D:\Espressif-tool\Espressif\tools\ccache\4.12.1\ccache-4.12.1-windows-x86_64",
    "D:\Espressif-tool\Espressif\tools\dfu-util\0.11\dfu-util-0.11-win64",
    "D:\Espressif-tool\Espressif\python_env\idf5.5_py3.12_env\Scripts",
    "D:\Espressif\tools",
    "D:\Espressif-tool\Espressif\tools\idf-git\2.44.0\cmd"
) -join ";"

$env:PATH = "$toolsBin;$env:PATH"

$pythonExe = "D:\Espressif-tool\Espressif\python_env\idf5.5_py3.12_env\Scripts\python.exe"

Set-Location -Path "$PSScriptRoot\..\esp32"
& $pythonExe "D:\Espressif\tools\idf.py" -p COM3 flash
