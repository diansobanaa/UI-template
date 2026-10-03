import type {
  CalibrationReferenceRow,
  CalibrationCategory,
} from "@/lib/types";

/**
 * Calibration catalogue.
 *
 * Scope: devices that need field calibration — pH meters,
 * EC meters, dosing pumps, and the raw water pump (pump_well).
 * Lower Float Switch is a binary dry-run interlock and does NOT need calibration.
 * Raw water pump is calibrated by calculating flow from the small raw flow sensor (ZJ-B1).
 */
export const calibrationReference: CalibrationReferenceRow[] = [
  { deviceType: "pH Sensor", method: "Single/Two Point", standard: "pH 4.00, 6.86, 7.00, 9.18", frequency: "Every 3 months" },
  { deviceType: "EC Sensor", method: "Two Point", standard: "1.41 mS/cm, 12.88 mS/cm", frequency: "Every 3 months" },
  { deviceType: "Dosing Pump", method: "Volume Test", standard: "Measure actual volume per 30s run", frequency: "Every 1 month" },
  { deviceType: "Raw Water Pump", method: "Flow Sensor Test", standard: "Dihitung otomatis dari sensor flow water kecil ZJ-B1", frequency: "Every 3 months" },
];

export const categoryFilterMap: Record<string, CalibrationCategory[]> = {
  "all": ["ph", "ec", "dosing-pump", "raw-water-pump"],
  "sensors": ["ph", "ec"],
  "dosing-pumps": ["dosing-pump"],
  "water-pumps": ["raw-water-pump"],
};
