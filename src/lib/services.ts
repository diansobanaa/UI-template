/**
 * Frontend service layer — the ONLY boundary UI components use to reach data.
 *
 * Today every function reads from the in-memory mock store. When the Python
 * backend is ready, re-implement these objects on top of
 * `src/lib/api/backend-client.ts` (same method names, async over REST).
 * UI components will not change.
 */
import {
  addCalibrationRecord,
  addComplex,
  addGreenhouse,
  addObservation,
  createFanSchedule,
  createFertigationSchedule,
  createWellPumpSchedule,
  db,
  deleteFanSchedule,
  deleteFertigationSchedule,
  deleteWellPumpSchedule,
  updateFanSchedule,
  updateFertigationSchedule,
  updateWellPumpSchedule,
} from "./store";
import { alerts, recentEvents } from "./data/events";
import {
  calibrationCategories,
  calibrationReference,
  categoryFilterMap,
} from "./data/calibration";
import { dosingLastCalibration, dosingPumps, fertigationSystemStatus } from "./data/greenhouses";
import { MOCK_NOW } from "./format";
import type {
  AlertItem,
  CalibrationDevice,
  CalibrationRecord,
  Complex,
  EventItem,
  FertigationSchedule,
  FanSchedule,
  Greenhouse,
  ObservationDraft,
  WellPumpSchedule,
} from "./types";

/* --------------------------- system ------------------------------ */

export const complexService = {
  list(): Complex[] {
    return db.complexes;
  },
  get(id: string): Complex | undefined {
    return db.complexes.find((c) => c.id === id);
  },
  create(location: string): Complex {
    return addComplex(location);
  },
};

export const greenhouseService = {
  byComplex(complexId: string): Greenhouse[] {
    const complex = complexService.get(complexId);
    if (!complex) return [];
    return complex.greenhouseIds
      .map((id) => db.greenhouses.find((g) => g.id === id))
      .filter((g): g is Greenhouse => Boolean(g));
  },
  get(id: string): Greenhouse | undefined {
    return db.greenhouses.find((g) => g.id === id);
  },
  create(complexId: string, crop: string): Greenhouse {
    return addGreenhouse(complexId, crop);
  },
};

export const eventService = {
  recent(complexId: string): EventItem[] {
    return complexId === "complex-01" ? recentEvents : [];
  },
  alerts(): AlertItem[] {
    return alerts;
  },
};

/* -------------------------- schedules ---------------------------- */

export const scheduleService = {
  fertigationForGh(ghId: string): FertigationSchedule[] {
    return greenhouseService.get(ghId)?.fertigationSchedules ?? [];
  },
  wellPumpForComplex(complexId: string): WellPumpSchedule[] {
    return db.wellPumpSchedules.filter((s) => s.complexId === complexId);
  },
  fanForGh(ghId: string): FanSchedule[] {
    return greenhouseService.get(ghId)?.fanSchedules ?? [];
  },
  createFertigation(input: Omit<FertigationSchedule, "id">) {
    return createFertigationSchedule(input);
  },
  updateFertigation: updateFertigationSchedule,
  deleteFertigation: deleteFertigationSchedule,
  createWellPump(input: Omit<WellPumpSchedule, "id">) {
    return createWellPumpSchedule(input);
  },
  updateWellPump: updateWellPumpSchedule,
  deleteWellPump: deleteWellPumpSchedule,
  createFan(input: Omit<FanSchedule, "id">) {
    return createFanSchedule(input);
  },
  updateFan: updateFanSchedule,
  deleteFan: deleteFanSchedule,
};

/* -------------------------- calibration -------------------------- */

export const calibrationService = {
  categories() {
    return calibrationCategories;
  },
  devices(): CalibrationDevice[] {
    return db.calibrationDevices;
  },
  history(): CalibrationRecord[] {
    return db.calibrationHistory;
  },
  reference() {
    return calibrationReference;
  },
  devicesForCategory(category: string): CalibrationDevice[] {
    const allowed = categoryFilterMap[category] ?? categoryFilterMap["all"];
    return db.calibrationDevices.filter((d) => allowed.includes(d.category));
  },
  startCalibration(device: CalibrationDevice, before: string, after: string, user = "Admin") {
    addCalibrationRecord({
      dateTime: `${MOCK_NOW.dateTime.slice(0, 11)}${MOCK_NOW.time.slice(0, 5)}`,
      device: device.name.replace(/\s*\(.*\)$/, ""),
      type: device.category === "ph" ? "pH (1 point)" : "Field calibration",
      before,
      after,
      result: "Success",
      user,
    });
  },
};

/* -------------------------- fertigation -------------------------- */

export const fertigationService = {
  mixingQueue() {
    return db.mixingQueue;
  },
  dosingPumps() {
    return dosingPumps;
  },
  dosingLastCalibration() {
    return dosingLastCalibration;
  },
  history() {
    return db.complexFertigationHistory;
  },
  systemStatus() {
    return fertigationSystemStatus;
  },
  startManual(_ghId: string, _recipeId: string, _targetWaterL: number) {
    // Mock action — later: POST /complexes/:id/fertigation/manual
  },
  syncEsp32() {
    // Mock action — later: POST /complexes/:id/esp32/sync
  },
  emergencyStop() {
    // Mock action — later: POST /complexes/:id/esp32/emergency-stop
  },
  addObservation(ghId: string, draft: ObservationDraft) {
    addObservation(ghId, draft);
  },
};
