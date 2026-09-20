from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PROD_DIRS = [ROOT / "backend", ROOT / "src", ROOT / "contracts"]
FORBIDDEN = [
    re.compile(r"(^|[^A-Za-z0-9_])simulate_run([^A-Za-z0-9_]|$)"),
    re.compile(r"fertigation/simulate"),
    re.compile(r"simulateFertigation"),
]

for base in PROD_DIRS:
    for path in base.rglob("*"):
        if not path.is_file() or path.suffix not in {".py", ".ts", ".tsx", ".json", ".yaml", ".yml"}:
            continue
        text = path.read_text(errors="ignore")
        for pattern in FORBIDDEN:
            if pattern.search(text):
                raise SystemExit(f"FAIL: production simulation surface remains in {path}: {pattern.pattern}")

helper = ROOT / "tests/support/fertigation_simulation.py"
assert helper.exists(), "FAIL: test-only simulation helper missing"
assert "TEST-ONLY" in helper.read_text(), "FAIL: simulation helper is not clearly test-only"

print("PASS: No production simulation endpoint/helper/client remains; simulation helper is isolated under tests/support.")
