import os
import re
import subprocess
import sys

def parse_local_env(file_path):
    config = {}
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                m = re.match(r'^\$LOCAL_([A-Z_]+)\s*=\s*[\'"]([^\'"]+)[\'"]', line.strip())
                if m:
                    config[m.group(1)] = m.group(2)
    return config

def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    local_env_file = os.path.join(repo_root, "scripts", "esp32_env.local.ps1")
    local_cfg = parse_local_env(local_env_file)

    idf_path = local_cfg.get("IDF_PATH") or os.environ.get("IDF_PATH") or r"D:\Espressif"
    tools_path = local_cfg.get("IDF_TOOLS_PATH") or os.environ.get("IDF_TOOLS_PATH") or r"D:\Espressif-tool\Espressif"
    python_env = local_cfg.get("PYTHON_ENV") or os.environ.get("IDF_PYTHON_ENV_PATH") or os.path.join(tools_path, r"python_env\idf5.5_py3.12_env")
    python_exe = os.path.join(python_env, "Scripts", "python.exe")
    if not os.path.exists(python_exe):
        alt_py = os.path.join(tools_path, r"python_env\idf5.5_py3.11_env\Scripts\python.exe")
        if os.path.exists(alt_py):
            python_exe = alt_py
        else:
            python_exe = sys.executable
    idf_py = os.path.join(idf_path, "tools", "idf.py")

    env = os.environ.copy()
    env["IDF_PATH"] = idf_path
    env["IDF_TOOLS_PATH"] = tools_path
    env["IDF_PYTHON_ENV_PATH"] = python_env
    env["ESP_IDF_VERSION"] = "5.5"
    env["IDF_CCACHE_ENABLE"] = "1"
    env["OPENOCD_SCRIPTS"] = os.path.join(tools_path, r"tools\openocd-esp32\v0.12.0-esp32-20260424\openocd-esp32\share\openocd\scripts")
    env["ESP_ROM_ELF_DIR"] = os.path.join(tools_path, r"tools\esp-rom-elfs\20241011\\")
    env["PYTHONNOUSERSITE"] = "True"
    env.pop("PYTHONPATH", None)
    env.pop("PYTHONHOME", None)

    tools_bin = [
        os.path.join(tools_path, r"tools\xtensa-esp-elf-gdb\17.1_20260402\xtensa-esp-elf-gdb\bin"),
        os.path.join(tools_path, r"tools\riscv32-esp-elf-gdb\17.1_20260402\riscv32-esp-elf-gdb\bin"),
        os.path.join(tools_path, r"tools\xtensa-esp-elf\esp-14.2.0_20260121\xtensa-esp-elf\bin"),
        os.path.join(tools_path, r"tools\esp-clang\esp-19.1.2_20250312\esp-clang\bin"),
        os.path.join(tools_path, r"tools\riscv32-esp-elf\esp-14.2.0_20260121\riscv32-esp-elf\bin"),
        os.path.join(tools_path, r"tools\esp32ulp-elf\2.38_20240113\esp32ulp-elf\bin"),
        os.path.join(tools_path, r"tools\cmake\3.30.2\bin"),
        os.path.join(tools_path, r"tools\openocd-esp32\v0.12.0-esp32-20260424\openocd-esp32\bin"),
        os.path.join(tools_path, r"tools\ninja\1.12.1"),
        os.path.join(tools_path, r"tools\idf-exe\1.0.3"),
        os.path.join(tools_path, r"tools\ccache\4.12.1\ccache-4.12.1-windows-x86_64"),
        os.path.join(tools_path, r"tools\dfu-util\0.11\dfu-util-0.11-win64"),
        os.path.join(python_env, "Scripts"),
        os.path.join(idf_path, "tools"),
        os.path.join(tools_path, r"tools\idf-git\2.44.0\cmd"),
    ]
    env["PATH"] = ";".join(tools_bin) + ";" + env.get("PATH", "")

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    esp32_dir = os.path.join(repo_root, "esp32")
    args = sys.argv[1:] if len(sys.argv) > 1 else ["build"]
    cmd = [python_exe, idf_py] + args
    print(f"Running in {esp32_dir}: {' '.join(cmd)}")
    sys.stdout.flush()

    res = subprocess.run(cmd, cwd=esp32_dir, env=env)
    sys.exit(res.returncode)

if __name__ == "__main__":
    main()
