import type {
  CurrentFertigation,
  FertigationRunRow,
  FertigationSchedule,
  FanSchedule,
  Greenhouse,
  QueueEntry,
  Recipe,
  GreenhouseCamera,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Recipes                                                             */
/* ------------------------------------------------------------------ */

const recipes: Record<string, Recipe> = {
  "recipe-tomato-growth-a": { id: "recipe-tomato-growth-a", name: "Tomato Growth A", waterL: 80, dosingAml: 120, dosingBml: 120, targetEc: "-" },
  "recipe-tomato-fruit-b": { id: "recipe-tomato-fruit-b", name: "Tomato Fruit B", waterL: 60, dosingAml: 100, dosingBml: 100, targetEc: "-" },
  "recipe-cucumber-standard": { id: "recipe-cucumber-standard", name: "Cucumber Standard", waterL: 60, dosingAml: 90, dosingBml: 90, targetEc: "-" },
  "recipe-lettuce-a": { id: "recipe-lettuce-a", name: "Lettuce A", waterL: 60, dosingAml: 80, dosingBml: 80, targetEc: "-" },
  "recipe-spinach-a": { id: "recipe-spinach-a", name: "Spinach A", waterL: 60, dosingAml: 70, dosingBml: 70, targetEc: "-" },
  "recipe-strawberry-a": { id: "recipe-strawberry-a", name: "Strawberry A", waterL: 60, dosingAml: 85, dosingBml: 85, targetEc: "-" },
  "recipe-tomato-growth-b": { id: "recipe-tomato-growth-b", name: "Tomato Growth B", waterL: 70, dosingAml: 110, dosingBml: 110, targetEc: "-" },
  "recipe-chili-a": { id: "recipe-chili-a", name: "Chili A", waterL: 50, dosingAml: 75, dosingBml: 75, targetEc: "-" },
  "recipe-pepper-a": { id: "recipe-pepper-a", name: "Bell Pepper A", waterL: 60, dosingAml: 80, dosingBml: 80, targetEc: "-" },
  "recipe-broccoli-a": { id: "recipe-broccoli-a", name: "Broccoli A", waterL: 55, dosingAml: 70, dosingBml: 70, targetEc: "-" },
};

export const allRecipes = Object.values(recipes);

/* ------------------------------------------------------------------ */
/* Fertigation steps helper                                            */
/* ------------------------------------------------------------------ */

function steps(activeIdx: number): CurrentFertigation["steps"] {
  return ["Water Filling", "Dosing", "Mixing", "Ready", "Distribution"].map((name, i) => ({
    name,
    status: i < activeIdx ? "done" : i === activeIdx ? "active" : "pending",
  }));
}

/* ------------------------------------------------------------------ */
/* Greenhouse 01 — Tomato (featured, matches reference screenshots)     */
/* ------------------------------------------------------------------ */

const gh01: Greenhouse = {
  id: "gh-01",
  code: "GH 01",
  crop: "Tomato",
  complexId: "complex-01",
  online: true,
  health: "NORMAL",
  greenhouseTag: "GH-01",
  fertigationState: "MIXING",
  telemetry: {
    temperatureC: 28.4,
    humidityPct: 72,
    lightLux: 42300,
    tempDeltaC: -0.8,
    humidityDeltaPct: 4,
    tankPct: 82,
    tankL: 82,
    tankCapacityL: 100,
    waterTodayL: 240,
    waterYesterdayL: 214,
    waterDeltaPct: 12,
    hstDays: 228,
    hspDays: 197,
  },
  cropCycle: {
    status: "ACTIVE",
    tanggalTanam: "2026-01-24",
    tanggalPolinasi: "2026-02-24",
  },
  plants: {
    total: 120,
    tracked: 36,
    alive: 116,
    dead: 4,
    avgHeightCm: 85,
    avgFruitWeightG: 103,
    totalFruits: 82,
    latestObservation: "2 Sep 2026",
  },
  equipment: [
    { name: "Mixing Tank", status: "OK" },
    { name: "Distribution Pump", status: "OK" },
    { name: "Valve 01", status: "OK" },
    { name: "Temperature Sensor", status: "OK" },
    { name: "Humidity Sensor", status: "OK" },
    { name: "Light Sensor", status: "OK" },
    { name: "Flow Meter", status: "OK" },
    { name: "Water Level Sensor", status: "OK" },
  ],
  recipes: [recipes["recipe-tomato-growth-a"], recipes["recipe-tomato-fruit-b"]],
  fertigationSchedules: [
    { id: "fs-gh01-0600", ghId: "gh-01", name: "Morning Fertigation", recipeId: "recipe-tomato-growth-a", enabled: true, trigger: "specific-time", time: "06:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 80, dosingAml: 120, dosingBml: 120, fallbackEnabled: true, fallbackScheduleId: "fs-gh01-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "completed", lastRun: "2 Sep 06:00", nextRun: "3 Sep 06:00" },
    { id: "fs-gh01-1000", ghId: "gh-01", name: "Midday Fertigation", recipeId: "recipe-tomato-growth-a", enabled: true, trigger: "specific-time", time: "10:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 80, dosingAml: 120, dosingBml: 120, fallbackEnabled: true, fallbackScheduleId: "fs-gh01-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "completed", lastRun: "2 Sep 10:00", nextRun: "3 Sep 10:00" },
    { id: "fs-gh01-1400", ghId: "gh-01", name: "Afternoon Fertigation", recipeId: "recipe-tomato-growth-a", enabled: true, trigger: "specific-time", time: "14:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 80, dosingAml: 120, dosingBml: 120, fallbackEnabled: true, fallbackScheduleId: "fs-gh01-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "running", lastRun: null, nextRun: "Today 14:00" },
    { id: "fs-gh01-1800", ghId: "gh-01", name: "Evening Fertigation", recipeId: "recipe-tomato-growth-a", enabled: true, trigger: "specific-time", time: "18:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 80, dosingAml: 120, dosingBml: 120, fallbackEnabled: true, fallbackScheduleId: "fs-gh01-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "scheduled", lastRun: null, nextRun: "Today 18:00" },
  ],
  fanSchedules: [
    { id: "fan-gh01-0700", ghId: "gh-01", mode: "time", time: "07:00", durationMin: 60, repeat: "Every Day", enabled: true, status: "completed", lastRun: "2 Sep 07:00", nextRun: "3 Sep 07:00" },
    { id: "fan-gh01-1200", ghId: "gh-01", mode: "time", time: "12:00", durationMin: 30, repeat: "Every Day", enabled: true, status: "completed", lastRun: "2 Sep 12:00", nextRun: "3 Sep 12:00" },
    { id: "fan-gh01-1600", ghId: "gh-01", mode: "time", time: "16:00", durationMin: 60, repeat: "Every Day", enabled: true, status: "scheduled", lastRun: null, nextRun: "Today 16:00" },
  ],
  currentRun: {
    ghId: "gh-01",
    recipeName: "Tomato Growth A",
    targetWaterL: 80,
    dosingAml: 120,
    dosingBml: 120,
    startedAt: "13:05:21",
    elapsedLabel: "9 min 11 sec",
    estimatedFinish: "13:28:00",
    progressPct: 68,
    waterDoneL: 54,
    dosingADoneMl: 82,
    dosingBDoneMl: 80,
    steps: steps(2),
    tank: { currentL: 82, capacityL: 100, waterL: 68, nutrientAml: 60, nutrientBml: 60, temperatureC: 27.8 },
  },
  queue: [],
  history: [
    { id: "fr-gh01-1", ghId: "gh-01", date: "2 Sep", time: "10:00", recipeName: "Tomato Growth A", waterL: 80, dosingAml: 120, dosingBml: 120, result: "completed" },
    { id: "fr-gh01-2", ghId: "gh-01", date: "2 Sep", time: "06:00", recipeName: "Tomato Growth A", waterL: 80, dosingAml: 120, dosingBml: 120, result: "completed" },
    { id: "fr-gh01-3", ghId: "gh-01", date: "1 Sep", time: "18:00", recipeName: "Tomato Growth A", waterL: 80, dosingAml: 120, dosingBml: 120, result: "completed" },
    { id: "fr-gh01-4", ghId: "gh-01", date: "1 Sep", time: "14:00", recipeName: "Tomato Growth A", waterL: 80, dosingAml: 118, dosingBml: 120, result: "partial" },
    { id: "fr-gh01-5", ghId: "gh-01", date: "1 Sep", time: "10:00", recipeName: "Tomato Growth A", waterL: 80, dosingAml: 120, dosingBml: 120, result: "completed" },
  ],
  fruitDevSeries: [
    { label: "Aug 01", count: 12, weight: 8 },
    { label: "Aug 04", count: 18, weight: 15 },
    { label: "Aug 07", count: 24, weight: 23 },
    { label: "Aug 10", count: 31, weight: 32 },
    { label: "Aug 13", count: 38, weight: 42 },
    { label: "Aug 16", count: 46, weight: 51 },
    { label: "Aug 19", count: 55, weight: 61 },
    { label: "Aug 22", count: 62, weight: 70 },
    { label: "Aug 25", count: 70, weight: 80 },
    { label: "Aug 29", count: 78, weight: 93 },
    { label: "Sep 01", count: 82, weight: 103 },
  ],
};

/* ------------------------------------------------------------------ */
/* Greenhouse 02 — Cucumber                                            */
/* ------------------------------------------------------------------ */

const gh02: Greenhouse = {
  id: "gh-02",
  code: "GH 02",
  crop: "Cucumber",
  complexId: "complex-01",
  online: true,
  health: "NORMAL",
  greenhouseTag: "GH-02",
  fertigationState: "DISTRIBUTING",
  telemetry: {
    temperatureC: 27.8,
    humidityPct: 68,
    lightLux: 38100,
    tempDeltaC: 0.4,
    humidityDeltaPct: 2,
    tankPct: 65,
    tankL: 65,
    tankCapacityL: 100,
    waterTodayL: 180,
    waterYesterdayL: 166,
    waterDeltaPct: 8,
    hstDays: 41,
    hspDays: null,
  },
  cropCycle: {
    status: "ACTIVE",
    tanggalTanam: "2026-07-30",
    tanggalPolinasi: null,
  },
  plants: { total: 96, tracked: 30, alive: 92, dead: 4, avgHeightCm: 62, avgFruitWeightG: 88, totalFruits: 61, latestObservation: "2 Sep 2026" },
  equipment: [
    { name: "Mixing Tank", status: "OK" },
    { name: "Distribution Pump", status: "OK" },
    { name: "Valve 01", status: "OK" },
    { name: "Temperature Sensor", status: "OK" },
    { name: "Humidity Sensor", status: "OK" },
    { name: "Light Sensor", status: "OK" },
    { name: "Flow Meter", status: "OK" },
    { name: "Water Level Sensor", status: "OK" },
  ],
  recipes: [recipes["recipe-cucumber-standard"]],
  fertigationSchedules: [
    { id: "fs-gh02-0600", ghId: "gh-02", name: "Morning Fertigation", recipeId: "recipe-cucumber-standard", enabled: true, trigger: "specific-time", time: "06:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 60, dosingAml: 90, dosingBml: 90, fallbackEnabled: true, fallbackScheduleId: "fs-gh02-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "completed", lastRun: "2 Sep 06:00", nextRun: "3 Sep 06:00" },
    { id: "fs-gh02-1200", ghId: "gh-02", name: "Midday Fertigation", recipeId: "recipe-cucumber-standard", enabled: true, trigger: "specific-time", time: "12:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 60, dosingAml: 90, dosingBml: 90, fallbackEnabled: true, fallbackScheduleId: "fs-gh02-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "running", lastRun: null, nextRun: "Today 13:47" },
    { id: "fs-gh02-1800", ghId: "gh-02", name: "Evening Fertigation", recipeId: "recipe-cucumber-standard", enabled: true, trigger: "specific-time", time: "18:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 60, dosingAml: 90, dosingBml: 90, fallbackEnabled: true, fallbackScheduleId: "fs-gh02-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "scheduled", lastRun: null, nextRun: "Today 18:00" },
  ],
  fanSchedules: [
    { id: "fan-gh02-0900", ghId: "gh-02", mode: "time", time: "09:00", durationMin: 60, repeat: "Every Day", enabled: true, status: "completed", lastRun: "2 Sep 09:00", nextRun: "3 Sep 09:00" },
    { id: "fan-gh02-1500", ghId: "gh-02", mode: "time", time: "15:00", durationMin: 30, repeat: "Every Day", enabled: true, status: "scheduled", lastRun: null, nextRun: "Today 15:00" },
  ],
  currentRun: {
    ghId: "gh-02",
    recipeName: "Cucumber Standard",
    targetWaterL: 60,
    dosingAml: 90,
    dosingBml: 90,
    startedAt: "12:45:02",
    elapsedLabel: "29 min 30 sec",
    estimatedFinish: "13:47:00",
    progressPct: 56,
    waterDoneL: 34,
    dosingADoneMl: 50,
    dosingBDoneMl: 52,
    steps: steps(4),
    tank: { currentL: 62, capacityL: 100, waterL: 40, nutrientAml: 28, nutrientBml: 27, temperatureC: 27.1 },
  },
  queue: [],
  history: [
    { id: "fr-gh02-1", ghId: "gh-02", date: "2 Sep", time: "06:00", recipeName: "Cucumber Standard", waterL: 60, dosingAml: 90, dosingBml: 90, durationMin: 38, result: "completed" },
    { id: "fr-gh02-2", ghId: "gh-02", date: "1 Sep", time: "18:00", recipeName: "Cucumber Standard", waterL: 60, dosingAml: 90, dosingBml: 90, durationMin: 40, result: "completed" },
    { id: "fr-gh02-3", ghId: "gh-02", date: "1 Sep", time: "12:00", recipeName: "Cucumber Standard", waterL: 60, dosingAml: 86, dosingBml: 90, durationMin: 41, result: "partial" },
  ],
  fruitDevSeries: [
    { label: "Aug 01", count: 8, weight: 6 },
    { label: "Aug 07", count: 14, weight: 14 },
    { label: "Aug 13", count: 22, weight: 26 },
    { label: "Aug 19", count: 31, weight: 41 },
    { label: "Aug 25", count: 42, weight: 58 },
    { label: "Sep 01", count: 61, weight: 88 },
  ],
};

/* ------------------------------------------------------------------ */
/* Greenhouse 03 — Lettuce (warning: flow abnormal)                    */
/* ------------------------------------------------------------------ */

const gh03: Greenhouse = {
  id: "gh-03",
  code: "GH 03",
  crop: "Lettuce",
  complexId: "complex-01",
  online: true,
  health: "WARNING",
  greenhouseTag: "GH-03",
  fertigationState: "WAITING",
  telemetry: {
    temperatureC: 29.1,
    humidityPct: 75,
    lightLux: 40200,
    tempDeltaC: 1.2,
    humidityDeltaPct: -3,
    tankPct: 91,
    tankL: 91,
    tankCapacityL: 100,
    waterTodayL: 200,
    waterYesterdayL: 190,
    waterDeltaPct: 5,
    hstDays: 0,
    hspDays: null,
  },
  cropCycle: {
    status: "HARVESTED",
    tanggalTanam: null,
    tanggalPolinasi: null,
    lastHarvestSummary: {
      harvestDate: "2026-09-02",
      tanggalTanam: "2026-07-12",
      tanggalPolinasi: "2026-08-01",
      hstAtHarvest: 52,
      hspAtHarvest: 32,
      recordedAt: "2 Sep 2026 08:30",
    },
  },
  plants: { total: 140, tracked: 40, alive: 135, dead: 5, avgHeightCm: 24, avgFruitWeightG: 0, totalFruits: 0, latestObservation: "2 Sep 2026" },
  equipment: [
    { name: "Mixing Tank", status: "OK" },
    { name: "Distribution Pump", status: "OK" },
    { name: "Valve 01", status: "OK" },
    { name: "Temperature Sensor", status: "OK" },
    { name: "Humidity Sensor", status: "OK" },
    { name: "Light Sensor", status: "OK" },
    { name: "Flow Meter", status: "WARNING" },
    { name: "Water Level Sensor", status: "OK" },
  ],
  recipes: [recipes["recipe-lettuce-a"]],
  fertigationSchedules: [
    { id: "fs-gh03-0600", ghId: "gh-03", name: "Morning Fertigation", recipeId: "recipe-lettuce-a", enabled: true, trigger: "specific-time", time: "06:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 60, dosingAml: 80, dosingBml: 80, fallbackEnabled: true, fallbackScheduleId: "fs-gh03-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "completed", lastRun: "2 Sep 06:00", nextRun: "3 Sep 06:00" },
    { id: "fs-gh03-1400", ghId: "gh-03", name: "Afternoon Fertigation", recipeId: "recipe-lettuce-a", enabled: true, trigger: "specific-time", time: "14:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 60, dosingAml: 80, dosingBml: 80, fallbackEnabled: true, fallbackScheduleId: "fs-gh03-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "scheduled", lastRun: null, nextRun: "Today 14:00" },
  ],
  fanSchedules: [
    { id: "fan-gh03-1000", ghId: "gh-03", mode: "time", time: "10:00", durationMin: 45, repeat: "Every Day", enabled: true, status: "completed", lastRun: "2 Sep 10:00", nextRun: "3 Sep 10:00" },
  ],
  currentRun: null,
  queue: [{ ghId: "gh-03", recipeName: "Tomato Growth A", targetWaterL: 80, scheduledTime: "14:00" }],
  history: [
    { id: "fr-gh03-1", ghId: "gh-03", date: "2 Sep", time: "08:00", recipeName: "Cucumber A", waterL: 60, dosingAml: 90, dosingBml: 90, durationMin: 40, result: "completed" },
    { id: "fr-gh03-2", ghId: "gh-03", date: "1 Sep", time: "18:00", recipeName: "Lettuce A", waterL: 60, dosingAml: 80, dosingBml: 80, durationMin: 36, result: "completed" },
    { id: "fr-gh03-3", ghId: "gh-03", date: "1 Sep", time: "12:00", recipeName: "Lettuce A", waterL: 50, dosingAml: 80, dosingBml: 80, durationMin: 34, result: "completed" },
  ],
  fruitDevSeries: [],
};

/* ------------------------------------------------------------------ */
/* Greenhouse 04 — Spinach (offline)                                   */
/* ------------------------------------------------------------------ */

const gh04: Greenhouse = {
  id: "gh-04",
  code: "GH 04",
  crop: "Spinach",
  complexId: "complex-01",
  online: false,
  health: "NORMAL",
  greenhouseTag: "GH-04",
  fertigationState: "IDLE",
  telemetry: {
    temperatureC: null,
    humidityPct: null,
    lightLux: null,
    tempDeltaC: null,
    humidityDeltaPct: null,
    tankPct: 43,
    tankL: 43,
    tankCapacityL: 100,
    waterTodayL: null,
    waterYesterdayL: null,
    waterDeltaPct: null,
    hstDays: 0,
    hspDays: null,
  },
  cropCycle: {
    status: "NO_CYCLE",
    tanggalTanam: null,
    tanggalPolinasi: null,
  },
  plants: { total: 88, tracked: 12, alive: 84, dead: 4, avgHeightCm: 34, avgFruitWeightG: 12, totalFruits: 9, latestObservation: "31 Aug 2026" },
  equipment: [
    { name: "Mixing Tank", status: "OFFLINE" },
    { name: "Distribution Pump", status: "OFFLINE" },
    { name: "Valve 01", status: "OFFLINE" },
    { name: "Temperature Sensor", status: "OFFLINE" },
    { name: "Humidity Sensor", status: "OFFLINE" },
    { name: "Light Sensor", status: "OFFLINE" },
    { name: "Flow Meter", status: "OFFLINE" },
    { name: "Water Level Sensor", status: "OFFLINE" },
  ],
  recipes: [recipes["recipe-spinach-a"]],
  fertigationSchedules: [
    { id: "fs-gh04-0600", ghId: "gh-04", name: "Morning Fertigation", recipeId: "recipe-spinach-a", enabled: true, trigger: "specific-time", time: "06:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 60, dosingAml: 70, dosingBml: 70, fallbackEnabled: true, fallbackScheduleId: "fs-gh04-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "completed", lastRun: "2 Sep 06:00", nextRun: "3 Sep 06:00" },
    { id: "fs-gh04-1600", ghId: "gh-04", name: "Afternoon Fertigation", recipeId: "recipe-spinach-a", enabled: true, trigger: "specific-time", time: "16:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 60, dosingAml: 70, dosingBml: 70, fallbackEnabled: true, fallbackScheduleId: "fs-gh04-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "scheduled", lastRun: null, nextRun: "Today 16:00" },
  ],
  fanSchedules: [
    { id: "fan-gh04-0800", ghId: "gh-04", mode: "time", time: "08:00", durationMin: 45, repeat: "Every Day", enabled: true, status: "completed", lastRun: "2 Sep 08:00", nextRun: "3 Sep 08:00" },
  ],
  currentRun: null,
  queue: [{ ghId: "gh-04", recipeName: "Tomato Fruit B", targetWaterL: 60, scheduledTime: "16:00" }],
  history: [
    { id: "fr-gh04-1", ghId: "gh-04", date: "2 Sep", time: "06:00", recipeName: "Spinach A", waterL: 60, dosingAml: 70, dosingBml: 70, durationMin: 35, result: "completed" },
    { id: "fr-gh04-2", ghId: "gh-04", date: "1 Sep", time: "16:00", recipeName: "Spinach A", waterL: 60, dosingAml: 70, dosingBml: 70, durationMin: 37, result: "completed" },
  ],
  fruitDevSeries: [],
};

/* ------------------------------------------------------------------ */
/* Greenhouse 05 — Strawberry                                          */
/* ------------------------------------------------------------------ */

const gh05: Greenhouse = {
  id: "gh-05",
  code: "GH 05",
  crop: "Strawberry",
  complexId: "complex-01",
  online: true,
  health: "NORMAL",
  greenhouseTag: "GH-05",
  fertigationState: "IDLE",
  telemetry: {
    temperatureC: 26.9,
    humidityPct: 70,
    lightLux: 36800,
    tempDeltaC: -0.3,
    humidityDeltaPct: 1,
    tankPct: 77,
    tankL: 77,
    tankCapacityL: 100,
    waterTodayL: 150,
    waterYesterdayL: 140,
    waterDeltaPct: 7,
    hstDays: 63,
    hspDays: 12,
  },
  cropCycle: {
    status: "ACTIVE",
    tanggalTanam: "2026-07-08",
    tanggalPolinasi: "2026-08-28",
  },
  plants: { total: 104, tracked: 28, alive: 100, dead: 4, avgHeightCm: 48, avgFruitWeightG: 76, totalFruits: 58, latestObservation: "2 Sep 2026" },
  equipment: [
    { name: "Mixing Tank", status: "OK" },
    { name: "Distribution Pump", status: "OK" },
    { name: "Valve 01", status: "OK" },
    { name: "Temperature Sensor", status: "OK" },
    { name: "Humidity Sensor", status: "OK" },
    { name: "Light Sensor", status: "OK" },
    { name: "Flow Meter", status: "OK" },
    { name: "Water Level Sensor", status: "OK" },
  ],
  recipes: [recipes["recipe-strawberry-a"]],
  fertigationSchedules: [
    { id: "fs-gh05-0600", ghId: "gh-05", name: "Morning Fertigation", recipeId: "recipe-strawberry-a", enabled: true, trigger: "specific-time", time: "06:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 60, dosingAml: 85, dosingBml: 85, fallbackEnabled: true, fallbackScheduleId: "fs-gh05-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "completed", lastRun: "2 Sep 06:00", nextRun: "3 Sep 06:00" },
    { id: "fs-gh05-1200", ghId: "gh-05", name: "Midday Fertigation", recipeId: "recipe-strawberry-a", enabled: true, trigger: "specific-time", time: "12:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 60, dosingAml: 85, dosingBml: 85, fallbackEnabled: true, fallbackScheduleId: "fs-gh05-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "completed", lastRun: "2 Sep 12:00", nextRun: "3 Sep 12:00" },
    { id: "fs-gh05-1800", ghId: "gh-05", name: "Evening Fertigation", recipeId: "recipe-strawberry-a", enabled: true, trigger: "specific-time", time: "18:00", repeat: "Every Day", targetMode: "volume", targetWaterL: 60, dosingAml: 85, dosingBml: 85, fallbackEnabled: true, fallbackScheduleId: "fs-gh05-0600", missedPolicy: "execute", recoveryWindowH: 2, onlyToday: true, status: "scheduled", lastRun: null, nextRun: "Today 18:00" },
  ],
  fanSchedules: [
    { id: "fan-gh05-0700", ghId: "gh-05", mode: "time", time: "07:00", durationMin: 60, repeat: "Every Day", enabled: true, status: "completed", lastRun: "2 Sep 07:00", nextRun: "3 Sep 07:00" },
    { id: "fan-gh05-1600", ghId: "gh-05", mode: "time", time: "16:00", durationMin: 30, repeat: "Every Day", enabled: true, status: "scheduled", lastRun: null, nextRun: "Today 16:00" },
  ],
  currentRun: null,
  queue: [{ ghId: "gh-05", recipeName: "Cucumber A", targetWaterL: 60, scheduledTime: "20:00" }],
  history: [
    { id: "fr-gh05-1", ghId: "gh-05", date: "2 Sep", time: "12:00", recipeName: "Strawberry A", waterL: 60, dosingAml: 85, dosingBml: 85, durationMin: 38, result: "completed" },
    { id: "fr-gh05-2", ghId: "gh-05", date: "2 Sep", time: "06:00", recipeName: "Strawberry A", waterL: 60, dosingAml: 85, dosingBml: 85, durationMin: 36, result: "completed" },
    { id: "fr-gh05-3", ghId: "gh-05", date: "1 Sep", time: "18:00", recipeName: "Strawberry A", waterL: 60, dosingAml: 82, dosingBml: 85, durationMin: 40, result: "partial" },
  ],
  fruitDevSeries: [
    { label: "Aug 01", count: 5, weight: 3 },
    { label: "Aug 10", count: 12, weight: 12 },
    { label: "Aug 19", count: 26, weight: 31 },
    { label: "Aug 29", count: 44, weight: 57 },
    { label: "Sep 01", count: 58, weight: 76 },
  ],
};

/* ------------------------------------------------------------------ */
/* Complex 02 / 03 greenhouses (lighter dataset)                       */
/* ------------------------------------------------------------------ */

interface SimpleGhSpec {
  id: string;
  code: string;
  crop: string;
  complexId: string;
  temperatureC: number;
  humidityPct: number;
  lightLux: number;
  tankPct: number;
  hstDays: number;
  plants: Greenhouse["plants"];
  recipeId: string;
  times: string[];
}

function makeSimpleGh(spec: SimpleGhSpec): Greenhouse {
  const recipe = recipes[spec.recipeId];
  const fertigationSchedules: FertigationSchedule[] = spec.times.map((time, i) => ({
    id: `fs-${spec.id}-${i}`,
    ghId: spec.id,
    name: i === 0 ? "Morning Fertigation" : i === 1 ? "Midday Fertigation" : "Evening Fertigation",
    recipeId: spec.recipeId,
    enabled: true,
    trigger: "specific-time" as const,
    time,
    repeat: "Every Day" as const,
    targetMode: "volume" as const,
    targetWaterL: recipe.waterL,
    dosingAml: recipe.dosingAml,
    dosingBml: recipe.dosingBml,
    fallbackEnabled: true,
    fallbackScheduleId: `fs-${spec.id}-0`,
    missedPolicy: "execute" as const,
    recoveryWindowH: 2,
    onlyToday: true,
    status: i === 0 ? ("completed" as const) : ("scheduled" as const),
    lastRun: i === 0 ? `2 Sep ${time}` : null,
    nextRun: i === 0 ? `3 Sep ${time}` : `Today ${time}`,
  }));
  const fanSchedules: FanSchedule[] = [
    { id: `fan-${spec.id}-0`, ghId: spec.id, mode: "time", time: "08:00", durationMin: 45, repeat: "Every Day", enabled: true, status: "completed", lastRun: "2 Sep 08:00", nextRun: "3 Sep 08:00" },
  ];
  const history: FertigationRunRow[] = spec.times.slice(0, 2).map((time, i) => ({
    id: `fr-${spec.id}-${i}`,
    ghId: spec.id,
    date: "2 Sep",
    time,
    recipeName: recipe.name,
    waterL: recipe.waterL,
    dosingAml: recipe.dosingAml,
    dosingBml: recipe.dosingBml,
    durationMin: 36 + i * 2,
    result: "completed" as const,
  }));
  return {
    id: spec.id,
    code: spec.code,
    crop: spec.crop,
    complexId: spec.complexId,
    online: true,
    health: "NORMAL",
    greenhouseTag: spec.code.replace(" ", "-"),
    fertigationState: "IDLE",
    telemetry: {
      temperatureC: spec.temperatureC,
      humidityPct: spec.humidityPct,
      lightLux: spec.lightLux,
      tempDeltaC: 0.2,
      humidityDeltaPct: 1,
      tankPct: spec.tankPct,
      tankL: spec.tankPct,
      tankCapacityL: 100,
      waterTodayL: 120,
      waterYesterdayL: 115,
      waterDeltaPct: 4,
      hstDays: spec.hstDays,
      hspDays: null,
    },
    plants: spec.plants,
    equipment: [
      { name: "Mixing Tank", status: "OK" },
      { name: "Distribution Pump", status: "OK" },
      { name: "Valve 01", status: "OK" },
      { name: "Temperature Sensor", status: "OK" },
      { name: "Humidity Sensor", status: "OK" },
      { name: "Light Sensor", status: "OK" },
      { name: "Flow Meter", status: "OK" },
      { name: "Water Level Sensor", status: "OK" },
    ],
    recipes: [recipe],
    fertigationSchedules,
    fanSchedules,
    currentRun: null,
    queue: [],
    history,
    fruitDevSeries: [],
  };
}

const gh06 = makeSimpleGh({
  id: "gh-06", code: "GH 06", crop: "Tomato", complexId: "complex-02",
  temperatureC: 27.2, humidityPct: 69, lightLux: 39500, tankPct: 70, hstDays: 30,
  plants: { total: 110, tracked: 24, alive: 107, dead: 3, avgHeightCm: 71, avgFruitWeightG: 95, totalFruits: 64, latestObservation: "2 Sep 2026" },
  recipeId: "recipe-tomato-growth-b", times: ["07:00", "15:00"],
});

const gh07 = makeSimpleGh({
  id: "gh-07", code: "GH 07", crop: "Chili", complexId: "complex-02",
  temperatureC: 28.8, humidityPct: 66, lightLux: 41000, tankPct: 58, hstDays: 48,
  plants: { total: 90, tracked: 20, alive: 86, dead: 4, avgHeightCm: 55, avgFruitWeightG: 42, totalFruits: 120, latestObservation: "1 Sep 2026" },
  recipeId: "recipe-chili-a", times: ["06:30", "16:30"],
});

const gh08 = makeSimpleGh({
  id: "gh-08", code: "GH 08", crop: "Lettuce", complexId: "complex-02",
  temperatureC: 27.5, humidityPct: 71, lightLux: 37200, tankPct: 84, hstDays: 15,
  plants: { total: 132, tracked: 30, alive: 130, dead: 2, avgHeightCm: 21, avgFruitWeightG: 0, totalFruits: 0, latestObservation: "2 Sep 2026" },
  recipeId: "recipe-lettuce-a", times: ["07:30"],
});

const gh09 = makeSimpleGh({
  id: "gh-09", code: "GH 09", crop: "Bell Pepper", complexId: "complex-03",
  temperatureC: 26.5, humidityPct: 68, lightLux: 38800, tankPct: 74, hstDays: 37,
  plants: { total: 76, tracked: 16, alive: 74, dead: 2, avgHeightCm: 58, avgFruitWeightG: 88, totalFruits: 40, latestObservation: "30 Aug 2026" },
  recipeId: "recipe-pepper-a", times: ["07:00"],
});

const gh10 = makeSimpleGh({
  id: "gh-10", code: "GH 10", crop: "Broccoli", complexId: "complex-03",
  temperatureC: 29.5, humidityPct: 73, lightLux: 40000, tankPct: 51, hstDays: 25,
  plants: { total: 64, tracked: 10, alive: 61, dead: 3, avgHeightCm: 38, avgFruitWeightG: 0, totalFruits: 0, latestObservation: "28 Aug 2026" },
  recipeId: "recipe-broccoli-a", times: ["06:00", "17:00"],
});

const cameraInventory: Record<string, GreenhouseCamera[]> = {
  "gh-01": [1, 2, 3].map((number) => ({ componentId: `CAM-GH01-0${number}`, name: `Camera ${number}`, status: "AVAILABLE", capturedAt: "now" })),
  "gh-02": [{ componentId: "CAM-GH02-01", name: "Camera 1", status: "AVAILABLE", capturedAt: "now" }],
  "gh-03": [{ componentId: "CAM-GH03-01", name: "Camera 1", status: "OFFLINE", capturedAt: "2 hr ago" }],
  "gh-05": [1, 2].map((number) => ({ componentId: `CAM-GH05-0${number}`, name: `Camera ${number}`, status: "AVAILABLE", capturedAt: "now" })),
};

export const greenhouses: Greenhouse[] = [gh01, gh02, gh03, gh04, gh05, gh06, gh07, gh08, gh09, gh10].map((greenhouse) => ({
  ...greenhouse,
  cameras: cameraInventory[greenhouse.id] ?? [],
}));

/* ------------------------------------------------------------------ */
/* Mixing queue (complex level, shown on Fertigation page)             */
/* ------------------------------------------------------------------ */

export const mixingQueue: QueueEntry[] = [
  { ghId: "gh-03", recipeName: "Tomato Growth A", targetWaterL: 80, scheduledTime: "14:00" },
  { ghId: "gh-04", recipeName: "Tomato Fruit B", targetWaterL: 60, scheduledTime: "16:00" },
  { ghId: "gh-02", recipeName: "Tomato Growth B", targetWaterL: 80, scheduledTime: "18:00" },
  { ghId: "gh-05", recipeName: "Cucumber A", targetWaterL: 60, scheduledTime: "20:00" },
];

export const dosingPumps = [
  { id: "dp-a", name: "Pump A", state: "Ready" as const, rate: "0 ml/min" },
  { id: "dp-b", name: "Pump B", state: "Ready" as const, rate: "0 ml/min" },
  { id: "dp-c", name: "Pump C", state: "Not Used" as const, rate: "-" },
  { id: "dp-d", name: "Pump D", state: "Not Used" as const, rate: "-" },
];

export const dosingLastCalibration = "1 Sep 2026 10:20";

/** Fertigation history across the complex (Fertigation page). */
export const complexFertigationHistory: FertigationRunRow[] = [
  { id: "cfh-1", ghId: "gh-02", date: "2 Sep", time: "12:00", recipeName: "Tomato Growth A", waterL: 80, dosingAml: 120, dosingBml: 120, durationMin: 45, result: "completed" },
  { id: "cfh-2", ghId: "gh-01", date: "2 Sep", time: "10:00", recipeName: "Tomato Fruit B", waterL: 60, dosingAml: 100, dosingBml: 100, durationMin: 38, result: "completed" },
  { id: "cfh-3", ghId: "gh-03", date: "2 Sep", time: "08:00", recipeName: "Cucumber A", waterL: 60, dosingAml: 90, dosingBml: 90, durationMin: 40, result: "completed" },
  { id: "cfh-4", ghId: "gh-02", date: "1 Sep", time: "18:00", recipeName: "Lettuce A", waterL: 50, dosingAml: 80, dosingBml: 80, durationMin: 35, result: "completed" },
  { id: "cfh-5", ghId: "gh-01", date: "1 Sep", time: "16:00", recipeName: "Tomato Growth A", waterL: 80, dosingAml: 120, dosingBml: 120, durationMin: 42, result: "completed" },
];

export const fertigationSystemStatus = {
  mixingTankLevel: 45,
  waterInlet: "Open",
  distributionLine: "Normal",
  systemMode: "Auto",
  lastUpdate: "2 Sep 2026 13:14:32",
};
