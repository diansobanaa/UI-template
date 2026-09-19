#!/usr/bin/env python3
"""M17 hardware pin-map forensic gate.

The authoritative physical mapping is docs/HARDWARE_WIRING_MAP.md.
This gate parses its master W-01..W-29 table and checks production source
against that SSOT. It never derives a pin from source code.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SSOT = ROOT / "docs/HARDWARE_WIRING_MAP.md"
PIN_CONFIG = ROOT / "esp32/main/config/pin_config.h"
MAIN = ROOT / "esp32/main/main.c"
REGISTRY = ROOT / "esp32/main/hal/hardware_registry.c"
REGISTRY_H = ROOT / "esp32/main/hal/hardware_registry.h"
API = ROOT / "esp32/main/http/api_config_handlers.c"
SENSOR = ROOT / "esp32/main/hal/sensor_hal.c"
PANEL_H = ROOT / "esp32/main/services/panel_button_mgr.h"

EXPECTED_MACROS = {
    "W-01": "PIN_BTN_MODE",
    "W-02": "PIN_OUT_WELL_PUMP",
    "W-03": "PIN_OUT_DIST_PUMP",
    "W-04": "PIN_OUT_RAW_SUBMERSIBLE",
    "W-05": "PIN_OUT_DOSING_A",
    "W-06": "PIN_OUT_DOSING_B",
    "W-07": "PIN_OUT_COOLING_FAN",
    "W-08": "PIN_I2C_SDA",
    "W-09": "PIN_I2C_SCL",
    "W-10": "PIN_OUT_BLOWER_FAN",
    "W-11": "PIN_SPI_SCK",
    "W-12": "PIN_SPI_MOSI",
    "W-13": "PIN_SPI_MISO",
    "W-14": "PIN_TFT_CS",
    "W-15": "PIN_IN_FLOW_RAW_ZJB1",
    "W-16": "PIN_IN_FLOW_FERT_FS400A",
    "W-17": "PIN_IN_TEMP_DS18B20",
    "W-18": "PIN_OUT_ERROR_LAMP",
    "W-19": "PIN_TFT_DC",
    "W-20": "PIN_IN_FLOAT_LOWER",
    "W-21": "PIN_BTN_MANUAL_A",
    "W-22": "PIN_OUT_MIXING_PUMP",
    "W-23": "PIN_BTN_RESERVED",
    "W-24": "PIN_TFT_RST",
    "W-25": "PIN_IN_TAMPER_LOOP",
    "W-26": "PIN_SD_CS",
}

ACTUATOR_W = {"W-02", "W-03", "W-04", "W-05", "W-06", "W-07", "W-10", "W-18", "W-22"}


def fail(msg: str) -> None:
    raise AssertionError(msg)


def read(path: Path) -> str:
    if not path.exists():
        fail(f"missing file: {path}")
    return path.read_text(encoding="utf-8")


def parse_master_table(text: str) -> dict[str, dict[str, str]]:
    rows: dict[str, dict[str, str]] = {}
    in_table = False
    headers: list[str] = []
    for line in text.splitlines():
        if line.startswith("## 2. Master Wiring Contract Table"):
            in_table = True
            continue
        if in_table and line.startswith("## 3."):
            break
        if not in_table or not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if not cells:
            continue
        if cells[0] == "ID":
            headers = cells
            continue
        if cells[0].startswith(":") or all(set(c) <= set(":- ") for c in cells):
            continue
        if cells and re.fullmatch(r"\*\*W-\d+\*\*", cells[0]):
            rid = re.search(r"W-\d+", cells[0]).group(0)
            rows[rid] = dict(zip(headers, cells))
    return rows


def resolve_macro_values(text: str) -> dict[str, int]:
    vals: dict[str, int] = {}
    pat = re.compile(r"^#define\s+(PIN_[A-Z0-9_]+)\s+(.+)$", re.M)
    for name, raw in pat.findall(text):
        raw = raw.split("/*", 1)[0].strip()
        if re.fullmatch(r"\d+", raw):
            vals[name] = int(raw)
        elif raw in vals:
            vals[name] = vals[raw]
    changed = True
    while changed:
        changed = False
        for name, raw in pat.findall(text):
            raw = raw.split("/*", 1)[0].strip()
            if name in vals or raw not in vals:
                continue
            vals[name] = vals[raw]
            changed = True
    return vals


def main() -> None:
    ssot = read(SSOT)
    pin = read(PIN_CONFIG)
    main_c = read(MAIN)
    reg = read(REGISTRY)
    reg_h = read(REGISTRY_H)
    api = read(API)
    sensor = read(SENSOR)
    panel_h = read(PANEL_H)

    # 1. SSOT integrity / required rows.
    if "Single Authoritative Hardware Wiring Contract" not in ssot:
        fail("canonical SSOT marker missing")
    rows = parse_master_table(ssot)
    missing = [f"W-{i:02d}" for i in range(1, 30) if f"W-{i:02d}" not in rows]
    if missing:
        fail(f"missing SSOT rows: {missing}")

    # 2. Source values must match SSOT pin numbers.
    values = resolve_macro_values(pin)
    for wid, macro in EXPECTED_MACROS.items():
        expected = int(re.search(r"\d+", rows[wid]["ESP32 Pin"]).group(0))
        actual = values.get(macro)
        if actual != expected:
            fail(f"{wid} {macro}: SSOT={expected}, source={actual}")

    # 3. All nine mapped actuator outputs must be in safe boot.
    boot = re.search(r"static void safe_boot_actuators\(void\)(.*?)\n}\n", main_c, re.S)
    if not boot:
        fail("safe_boot_actuators not found")
    boot_block = boot.group(1)
    missing_act = [EXPECTED_MACROS[w] for w in sorted(ACTUATOR_W) if EXPECTED_MACROS[w] not in boot_block]
    if missing_act:
        fail(f"safe boot missing mapped actuators: {missing_act}")
    if "9 mapped actuator channels" not in main_c:
        fail("safe boot count/log not updated to 9")

    # 4. Canonical pin policy must exist and be wired into registry + API validation.
    for needle, content, label in [
        ("hardware_registry_validate_component_json", reg_h, str(REGISTRY_H)),
        ("hardware_registry_validate_component_json(item", reg, str(REGISTRY)),
        ("hardware_registry_validate_component_json(c", api, str(API)),
        ("IS_UNAVAILABLE_GPIO", pin, str(PIN_CONFIG)),
    ]:
        if needle not in content:
            fail(f"missing canonical pin-policy enforcement: {needle} in {label}")

    if not re.search(r"GPIO22-25.*not bonded|GPIO22-25", pin):
        fail("pin_config missing explicit GPIO22-25 unavailable policy")

    # 5. Generic ADC may not infer GPIO1..10 for physical sensors because the SSOT has no analog sensor pins.
    adc = re.search(r"static int gpio_to_adc1_channel\(int gpio\)(.*?)\n}\n", sensor, re.S)
    if not adc or "return -1" not in adc.group(1):
        fail("generic ADC inference remains enabled")
    if re.search(r"gpio >= 1 && gpio <= 10", adc.group(1)):
        fail("generic ADC still maps GPIO1..10")

    # 6. Retired Button 3 must not be documented as an active input.
    if "Button 3 (GPIO 40): RETIRED" not in panel_h:
        fail("panel button header still treats GPIO40 as Button 3")

    # 7. W5500 is not defined by the SSOT; production code must not define an active W5500 CS.
    if re.search(r"#define\s+PIN_W5500_CS", pin):
        fail("active/commented W5500 CS definition remains in pin_config.h")

    # 8. The SSOT's internal W-15 identity contradiction must remain visible for human review.
    master_zjb1 = "Flow Sensor ZJ-B1" in rows["W-15"]["Component"]
    audit_yfb1 = "Flow YF-B1" in ssot
    if not (master_zjb1 and audit_yfb1):
        fail("expected SSOT internal W-15 identity discrepancy was not detectable")

    print("M17 HARDWARE PIN AUDIT: PASS")
    print("SSOT: docs/HARDWARE_WIRING_MAP.md")
    print("W-01..W-29 parsed: PASS")
    print("W-01..W-26 source GPIO checks: PASS")
    print("9-actuator safe boot coverage: PASS")
    print("Canonical registry/API pin policy: PASS")
    print("Generic ADC guessing disabled: PASS")
    print("GPIO40 Button 3 retired semantics: PASS")
    print("W5500 has no active CS mapping: PASS")
    print("IMPORTANT: SSOT itself contains W-15 identity contradiction (ZJ-B1 vs YF-B1); physical identity remains BLOCKED.")


if __name__ == "__main__":
    main()
