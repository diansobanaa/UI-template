import type {
  CalibrationReferenceRow,
  CalibrationCategory,
} from "@/lib/types";

/**
 * Calibration catalogue.
 *
 * Scope: only devices that actually need field calibration — pH meters,
 * EC meters and dosing pumps. Flow meters, water-level, temp/humidity
 * and fans are factory-calibrated and intentionally absent.
 *
 * NOTE: this list mirrors the device JSON reported by the ESP32
 * (`/devices`). Dosing pumps are dynamic — when the controller adds a
 * pump (channel C, D, …) it simply arrives here as another `dosing-pump`
 * entry with its own `channel`. Nothing downstream is hardcoded to A/B.
 * `reading` on a dosing pump is the last calibrated flow rate (ml/min)
 * and doubles as the "before" value / nominal reference for deviation.
 */
export const calibrationReference: CalibrationReferenceRow[] = [
  { deviceType: "pH Sensor", method: "Single/Two Point", standard: "pH 4.00, 6.86, 7.00, 9.18", frequency: "Every 3 months" },
  { deviceType: "EC Sensor", method: "Two Point", standard: "1.41 mS/cm, 12.88 mS/cm", frequency: "Every 3 months" },
  { deviceType: "Dosing Pump", method: "Volume Test", standard: "Measure actual volume per 30s run", frequency: "Every 1 month" },
];

export const categoryFilterMap: Record<string, CalibrationCategory[]> = {
  "all": ["ph", "ec", "dosing-pump"],
  "sensors": ["ph", "ec"],
  "dosing-pumps": ["dosing-pump"],
};
