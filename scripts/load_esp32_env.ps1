# ==============================================================================
# Shared Loader for ESP32 Local Environment & Portable Discovery
# ==============================================================================

function Safe-JoinPath {
    param([string]$Parent, [string]$Child)
    if (-not $Parent -or -not $Child) { return $null }
    try {
        if ($Parent -match '^([A-Za-z]):') {
            $drive = $Matches[1]
            if (-not (Get-PSDrive -Name $drive -ErrorAction SilentlyContinue)) {
                return $null
            }
        }
        return (Join-Path $Parent $Child)
    } catch {
        return $null
    }
}

function Safe-TestPath {
    param([string]$Path)
    if (-not $Path) { return $false }
    try {
        if ($Path -match '^([A-Za-z]):') {
            $drive = $Matches[1]
            if (-not (Get-PSDrive -Name $drive -ErrorAction SilentlyContinue)) {
                return $false
            }
        }
        return (Test-Path $Path -ErrorAction SilentlyContinue)
    } catch {
        return $false
    }
}

function Get-Esp32Profile {
    param(
        [string]$ExplicitPort = "",
        [int]$ExplicitBaud = 0,
        [string]$ExplicitIdfPath = "",
        [string]$ExplicitToolsPath = "",
        [string]$ExplicitPythonEnv = ""
    )

    $scriptDir = $PSScriptRoot
    $repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
    $esp32Dir = Join-Path $repoRoot "esp32"

    # 1. Load Local Machine Overrides (if esp32_env.local.ps1 exists)
    $localFile1 = Join-Path $scriptDir "esp32_env.local.ps1"
    $localFile2 = Join-Path $repoRoot "esp32_env.local.ps1"
    $loadedLocal = $false

    if (Safe-TestPath $localFile1) {
        . $localFile1
        $loadedLocal = $true
        Write-Host "[ESP32-ENV] Loaded local config from: $localFile1" -ForegroundColor DarkGray
    } elseif (Safe-TestPath $localFile2) {
        . $localFile2
        $loadedLocal = $true
        Write-Host "[ESP32-ENV] Loaded local config from: $localFile2" -ForegroundColor DarkGray
    }

    # 2. Resolve IDF_PATH
    $idfPath = $ExplicitIdfPath
    if (-not $idfPath -and (Get-Variable -Name "LOCAL_IDF_PATH" -ErrorAction SilentlyContinue)) {
        $idfPath = $LOCAL_IDF_PATH
    }
    if (-not $idfPath) { $idfPath = $env:IDF_PATH }
    if (-not $idfPath) {
        if (Safe-TestPath "C:\Espressif\frameworks\esp-idf-v5.5") {
            $idfPath = "C:\Espressif\frameworks\esp-idf-v5.5"
        } elseif (Safe-TestPath "C:\Espressif") {
            $idfPath = "C:\Espressif"
        } elseif (Safe-TestPath "D:\Espressif") {
            $idfPath = "D:\Espressif"
        } else {
            $idfPath = "C:\Espressif"
        }
    }

    # 3. Resolve IDF_TOOLS_PATH
    $toolsPath = $ExplicitToolsPath
    if (-not $toolsPath -and (Get-Variable -Name "LOCAL_IDF_TOOLS_PATH" -ErrorAction SilentlyContinue)) {
        $toolsPath = $LOCAL_IDF_TOOLS_PATH
    }
    if (-not $toolsPath) { $toolsPath = $env:IDF_TOOLS_PATH }
    if (-not $toolsPath) {
        if (Safe-TestPath "$env:USERPROFILE\.espressif") {
            $toolsPath = "$env:USERPROFILE\.espressif"
        } elseif (Safe-TestPath "C:\Espressif\tools") {
            $toolsPath = "C:\Espressif\tools"
        } elseif (Safe-TestPath "D:\Espressif-tool\Espressif") {
            $toolsPath = "D:\Espressif-tool\Espressif"
        } else {
            $toolsPath = "C:\Espressif\tools"
        }
    }

    # 4. Resolve IDF_PYTHON_ENV_PATH & Executable
    $pythonEnv = $ExplicitPythonEnv
    if (-not $pythonEnv -and (Get-Variable -Name "LOCAL_PYTHON_ENV" -ErrorAction SilentlyContinue)) {
        $pythonEnv = $LOCAL_PYTHON_ENV
    }
    if (-not $pythonEnv) { $pythonEnv = $env:IDF_PYTHON_ENV_PATH }
    if (-not $pythonEnv) {
        $pyCandidates = @(
            (Safe-JoinPath $toolsPath "python_env\idf5.5_py3.12_env"),
            (Safe-JoinPath $toolsPath "python_env\idf5.5_py3.11_env"),
            "$env:LOCALAPPDATA\Programs\Python\Python311",
            "$env:LOCALAPPDATA\Programs\Python\Python312",
            "$env:USERPROFILE\.espressif\python_env\idf5.5_py3.12_env",
            "D:\Espressif-tool\Espressif\python_env\idf5.5_py3.12_env"
        )
        foreach ($cand in $pyCandidates) {
            if ($cand -and (Safe-TestPath $cand)) {
                $pythonEnv = $cand
                break
            }
        }
    }

    # Resolve Python Executable
    $pythonExe = $null
    if ($pythonEnv) {
        $c1 = Safe-JoinPath $pythonEnv "Scripts\python.exe"
        $c2 = Safe-JoinPath $pythonEnv "python.exe"
        if ($c1 -and (Safe-TestPath $c1)) { $pythonExe = $c1 }
        elseif ($c2 -and (Safe-TestPath $c2)) { $pythonExe = $c2 }
    }
    if (-not $pythonExe) {
        $knownPys = @(
            "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
            "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
            "C:\Program Files\Python311\python.exe",
            "C:\Program Files\Python312\python.exe"
        )
        foreach ($kp in $knownPys) {
            if (Safe-TestPath $kp) { $pythonExe = $kp; break }
        }
    }
    if (-not $pythonExe) {
        $pyCmd = Get-Command python.exe -ErrorAction SilentlyContinue
        if ($pyCmd) { $pythonExe = $pyCmd.Source }
        else { $pythonExe = "python" }
    }

    # 5. Resolve Port COM
    $port = $ExplicitPort
    if (-not $port -and (Get-Variable -Name "LOCAL_PORT" -ErrorAction SilentlyContinue)) {
        $port = $LOCAL_PORT
    }
    if (-not $port) { $port = $env:ESP_PORT }
    if (-not $port) {
        try {
            $detected = [System.IO.Ports.SerialPort]::GetPortNames()
            if ($detected -and $detected.Count -eq 1) {
                $port = $detected[0]
                Write-Host "[ESP32-ENV] Auto-detected single connected COM port: $port" -ForegroundColor Green
            }
        } catch {}
    }
    if (-not $port) {
        $port = "COM3"
    }

    # 6. Resolve Baud Rate
    $baud = $ExplicitBaud
    if ($baud -le 0 -and (Get-Variable -Name "LOCAL_BAUD" -ErrorAction SilentlyContinue)) {
        $baud = [int]$LOCAL_BAUD
    }
    if ($baud -le 0) {
        $baud = 460800
    }

    # 7. Configure Environment Variables for Child Processes
    $env:IDF_PATH = $idfPath
    $env:IDF_TOOLS_PATH = $toolsPath
    $env:IDF_PYTHON_ENV_PATH = $pythonEnv
    $env:IDF_CCACHE_ENABLE = "1"
    $env:PYTHONNOUSERSITE = "True"
    $env:PYTHONPATH = $null
    $env:PYTHONHOME = $null

    # If official Espressif profile script exists, activate it
    $profileScript = Get-ChildItem -Path $toolsPath -Filter "Microsoft.*.PowerShell_profile.ps1" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($profileScript -and (Test-Path $profileScript.FullName)) {
        . $profileScript.FullName
    }

    # Build PATH with tools (support both $toolsPath\<tool> and $toolsPath\tools\<tool>)
    $toolsBin = @(
        (Safe-JoinPath $toolsPath "xtensa-esp-elf-gdb\*\xtensa-esp-elf-gdb\bin"),
        (Safe-JoinPath $toolsPath "xtensa-esp-elf\*\xtensa-esp-elf\bin"),
        (Safe-JoinPath $toolsPath "cmake\*\bin"),
        (Safe-JoinPath $toolsPath "ninja\*"),
        (Safe-JoinPath $toolsPath "idf-exe\*"),
        (Safe-JoinPath $toolsPath "ccache\*"),
        (Safe-JoinPath $toolsPath "tools\xtensa-esp-elf-gdb\17.1_20260402\xtensa-esp-elf-gdb\bin"),
        (Safe-JoinPath $toolsPath "tools\riscv32-esp-elf-gdb\17.1_20260402\riscv32-esp-elf-gdb\bin"),
        (Safe-JoinPath $toolsPath "tools\xtensa-esp-elf\esp-14.2.0_20260121\xtensa-esp-elf\bin"),
        (Safe-JoinPath $toolsPath "tools\esp-clang\esp-19.1.2_20250312\esp-clang\bin"),
        (Safe-JoinPath $toolsPath "tools\riscv32-esp-elf\esp-14.2.0_20260121\riscv32-esp-elf\bin"),
        (Safe-JoinPath $toolsPath "tools\esp32ulp-elf\2.38_20240113\esp32ulp-elf\bin"),
        (Safe-JoinPath $toolsPath "tools\cmake\3.30.2\bin"),
        (Safe-JoinPath $toolsPath "tools\openocd-esp32\v0.12.0-esp32-20260424\openocd-esp32\bin"),
        (Safe-JoinPath $toolsPath "tools\ninja\1.12.1"),
        (Safe-JoinPath $toolsPath "tools\idf-exe\1.0.3"),
        (Safe-JoinPath $toolsPath "tools\ccache\4.12.1\ccache-4.12.1-windows-x86_64"),
        (Safe-JoinPath $toolsPath "tools\dfu-util\0.11\dfu-util-0.11-win64"),
        (Safe-JoinPath $pythonEnv "Scripts"),
        (Safe-JoinPath $idfPath "tools"),
        (Safe-JoinPath $toolsPath "tools\idf-git\2.44.0\cmd")
    ) | Where-Object { $_ -and (Safe-TestPath $_) }

    if ($toolsBin.Count -gt 0) {
        $env:PATH = ($toolsBin -join ";") + ";" + $env:PATH
    }

    $idfPy = Safe-JoinPath $idfPath "tools\idf.py"

    return [PSCustomObject]@{
        RepoRoot   = $repoRoot
        Esp32Dir   = $esp32Dir
        IdfPath    = $idfPath
        ToolsPath  = $toolsPath
        PythonEnv  = $pythonEnv
        PythonExe  = $pythonExe
        IdfPy      = $idfPy
        Port       = $port
        Baud       = $baud
        HasLocalEnv= $loadedLocal
    }
}
