# ==============================================================================
# ESP32 Machine-Specific Environment Profile (Template)
# ==============================================================================
# INSTRUCTIONS:
# 1. Copy this file to: scripts\esp32_env.local.ps1
#    (esp32_env.local.ps1 is in .gitignore, so each PC keeps its own private settings).
# 2. Adjust paths, COM port, and baud rate for your current PC.
# 3. If any variable is commented out or left empty, the scripts will automatically
#    fallback to active $env: variables or perform auto-detection.
# ==============================================================================

# --- Port Serial ESP32 ---
# Ganti dengan port COM board ESP32 di PC ini (contoh: 'COM3', 'COM4', 'COM5', dll).
# Jika dikosongkan ($null atau ''), skrip akan mencoba auto-detect port serial aktif.
$LOCAL_PORT = 'COM3'

# --- Baud Rate Flashing ---
# Default 460800 (cepat dan stabil untuk ESP32-S3). Jika kabel bermasalah, gunakan 115200.
$LOCAL_BAUD = 460800

# --- ESP-IDF Root Directory ---
# Lokasi instalasi ESP-IDF core di PC ini.
# Contoh PC A: 'D:\Espressif'
# Contoh PC B: 'C:\Espressif\frameworks\esp-idf-v5.5'
$LOCAL_IDF_PATH = 'D:\Espressif'

# --- ESP-IDF Tools Directory ---
# Lokasi toolchain (compiler xtensa, cmake, ninja, python_env).
# Contoh PC A: 'D:\Espressif-tool\Espressif'
# Contoh PC B: 'C:\Users\username\.espressif'
$LOCAL_IDF_TOOLS_PATH = 'D:\Espressif-tool\Espressif'

# --- ESP-IDF Python Environment Directory ---
# Lokasi folder environment Python untuk ESP-IDF (berisi subfolder 'Scripts').
# Contoh PC A: 'D:\Espressif-tool\Espressif\python_env\idf5.5_py3.12_env'
# Contoh PC B: 'C:\Users\username\.espressif\python_env\idf5.5_py3.11_env'
$LOCAL_PYTHON_ENV = 'D:\Espressif-tool\Espressif\python_env\idf5.5_py3.12_env'
