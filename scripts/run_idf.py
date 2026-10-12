import os
import re
import subprocess
import sys
from pathlib import Path

def parse_local_env(file_path):
    config = {}
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                m = re.match(r'^\$LOCAL_([A-Z_]+)\s*=\s*[\'"]([^\'"]+)[\'"]', line.strip())
                if m:
                    config[m.group(1)] = m.group(2)
    return config


def newest_child(root, relative_path):
    candidates = sorted(
        (path for path in (Path(root) / relative_path).glob("*") if path.is_dir()),
        reverse=True,
    )
    return str(candidates[0]) if candidates else ""


def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    local_env_file = os.path.join(repo_root, "scripts", "esp32_env.local.ps1")
    local_cfg = parse_local_env(local_env_file)

    idf_path = local_cfg.get("IDF_PATH") or os.environ.get("IDF_PATH")
    tools_path = local_cfg.get("IDF_TOOLS_PATH") or os.environ.get("IDF_TOOLS_PATH")
    if not idf_path or not tools_path:
        raise RuntimeError(
            "ESP-IDF paths are not configured. Copy scripts/esp32_env.example.ps1 "
            "to scripts/esp32_env.local.ps1 or set IDF_PATH and IDF_TOOLS_PATH."
        )
    python_env = local_cfg.get("PYTHON_ENV") or os.environ.get("IDF_PYTHON_ENV_PATH")
    if not python_env:
        python_env = newest_child(tools_path, r"python_env")
    python_exe = os.path.join(python_env, "Scripts", "python.exe")
    if not os.path.exists(python_exe):
        alt_env = newest_child(tools_path, r"python_env")
        alt_py = os.path.join(alt_env, "Scripts", "python.exe")
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
    rom_elf_dir = newest_child(tools_path, r"tools\esp-rom-elfs")
    if rom_elf_dir:
        env["ESP_ROM_ELF_DIR"] = rom_elf_dir
    openocd_dir = newest_child(tools_path, r"tools\openocd-esp32")
    if openocd_dir:
        env["OPENOCD_SCRIPTS"] = os.path.join(
            openocd_dir, "openocd-esp32", "share", "openocd", "scripts"
        )
    env["PYTHONNOUSERSITE"] = "True"
    env.pop("PYTHONPATH", None)
    env.pop("PYTHONHOME", None)

    tools_bin = [
        os.path.join(newest_child(tools_path, r"tools\xtensa-esp-elf-gdb"), "xtensa-esp-elf-gdb", "bin"),
        os.path.join(newest_child(tools_path, r"tools\riscv32-esp-elf-gdb"), "riscv32-esp-elf-gdb", "bin"),
        os.path.join(newest_child(tools_path, r"tools\xtensa-esp-elf"), "xtensa-esp-elf", "bin"),
        os.path.join(newest_child(tools_path, r"tools\esp-clang"), "esp-clang", "bin"),
        os.path.join(newest_child(tools_path, r"tools\riscv32-esp-elf"), "riscv32-esp-elf", "bin"),
        os.path.join(newest_child(tools_path, r"tools\esp32ulp-elf"), "esp32ulp-elf", "bin"),
        os.path.join(newest_child(tools_path, r"tools\cmake"), "bin"),
        os.path.join(openocd_dir, "openocd-esp32", "bin"),
        newest_child(tools_path, r"tools\ninja"),
        newest_child(tools_path, r"tools\idf-exe"),
        newest_child(tools_path, r"tools\ccache"),
        newest_child(tools_path, r"tools\dfu-util"),
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
