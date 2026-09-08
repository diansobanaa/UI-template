import type {
  CalibrationDevice,
  CalibrationRecord,
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
export const calibrationDevices: CalibrationDevice[] = [
  {
    id: "dev-ph-01",
    category: "ph",
    name: "pH Sensor 01 (GH 01)",
    ghId: "gh-01",
    location: "GH 01 – Mixing Tank",
    reading: "6.87",
    unit: "pH",
    online: true,
    lastCalibration: "15 Aug 2026 10:30",
    due: "15 Nov 2026 (in 72 days)",
    method: "single",
    standardOptions: ["4.00", "6.86", "7.00", "9.18"],
    standardUnit: "pH",
    measuredUnit: "pH",
  },
  {
    id: "dev-ph-02",
    category: "ph",
    name: "pH Sensor 02 (GH 02)",
    ghId: "gh-02",
    location: "GH 02 – Mixing Tank",
    reading: "6.42",
    unit: "pH",
    online: true,
    lastCalibration: "10 Aug 2026 09:15",
    due: "10 Nov 2026 (in 67 days)",
    method: "two",
    standardOptions: ["4.00", "6.86", "7.00", "9.18"],
    standardUnit: "pH",
    measuredUnit: "pH",
  },
  {
    id: "dev-ec-01",
    category: "ec",
    name: "EC Sensor 01 (GH 01)",
    ghId: "gh-01",
    location: "GH 01 – Mixing Tank",
    reading: "1.86",
    unit: "mS/cm",
    online: true,
    lastCalibration: "10 Aug 2026 14:20",
    due: "10 Nov 2026 (in 67 days)",
    method: "two",
    standardOptions: ["1.41", "12.88"],
    standardUnit: "mS/cm",
    measuredUnit: "mS/cm",
  },
  {
    id: "dev-dp-a",
    category: "dosing-pump",
    name: "Dosing Pump A (Complex 01)",
    channel: "A",
    ghId: null,
    location: "Complex 01 – Central Dosing",
    reading: "240",
    unit: "ml/min",
    online: true,
    lastCalibration: "1 Sep 2026 10:20",
    due: "1 Oct 2026 (in 28 days)",
    method: "single",
    standardOptions: ["10", "30"],
    standardUnit: "s run",
    measuredUnit: "ml",
  },
  {
    id: "dev-dp-b",
    category: "dosing-pump",
    name: "Dosing Pump B (Complex 01)",
    channel: "B",
    ghId: null,
    location: "Complex 01 – Central Dosing",
    reading: "248",
    unit: "ml/min",
    online: true,
    lastCalibration: "1 Sep 2026 10:35",
    due: "1 Oct 2026 (in 28 days)",
    method: "single",
    standardOptions: ["10", "30"],
    standardUnit: "s run",
    measuredUnit: "ml",
  },
];

export const calibrationHistory: CalibrationRecord[] = [
  { id: "ch-1", dateTime: "15 Aug 2026 10:30", device: "pH Sensor 01", type: "pH (1 point)", before: "6.92", after: "6.87", result: "Success", user: "Admin" },
  { id: "ch-2", dateTime: "10 Aug 2026 14:20", device: "EC Sensor 01", type: "EC (2 point)", before: "2.15", after: "2.12", result: "Success", user: "Admin" },
  { id: "ch-3", dateTime: "1 Sep 2026 10:35", device: "Dosing Pump B", type: "Volume Test (30s)", before: "252 ml/min", after: "248 ml/min", result: "Success", user: "Admin" },
  { id: "ch-4", dateTime: "1 Sep 2026 10:20", device: "Dosing Pump A", type: "Volume Test (30s)", before: "236 ml/min", after: "240 ml/min", result: "Success", user: "Admin" },
  { id: "ch-5", dateTime: "5 Aug 2026 09:15", device: "Dosing Pump A", type: "Volume Test (30s)", before: "244 ml/min", after: "236 ml/min", result: "Success", user: "Technician" },
  { id: "ch-6", dateTime: "12 Jul 2026 09:05", device: "pH Sensor 02", type: "pH (2 point)", before: "7.14", after: "7.00", result: "Failed", user: "Technician" },
];

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
