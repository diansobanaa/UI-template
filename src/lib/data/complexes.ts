import type { Complex } from "@/lib/types";

/**
 * Mock dataset — 3 complexes (internally consistent across the app).
 * Deterministic: values mirror the approved reference screenshots.
 */
export const complexes: Complex[] = [
  {
    id: "complex-01",
    code: "Complex 01",
    name: "Greenhouse Complex",
    location: "Lembang, Indonesia",
    status: "Active",
    esp32: {
      online: true,
      lastSync: "2 Sep 2026 13:14:32",
      configVersion: 27,
      esp32ConfigVersion: 27,
      synchronized: true,
    },
    systemStatus: "WARNING", // 1 warning (GH-03 flow) + 1 fault (GH-04 offline)
    greenhouseIds: ["gh-01", "gh-02", "gh-03", "gh-04", "gh-05"],
    water: {
      wellPumpOn: false,
      rawTankPct: 76,
      flowTodayL: 1240,
      flowDeltaPct: 12,
    },
  },
  {
    id: "complex-02",
    code: "Complex 02",
    name: "Greenhouse Complex",
    location: "Ciapus, Indonesia",
    status: "Active",
    esp32: {
      online: true,
      lastSync: "2 Sep 2026 13:12:05",
      configVersion: 14,
      esp32ConfigVersion: 14,
      synchronized: true,
    },
    systemStatus: "NORMAL",
    greenhouseIds: ["gh-06", "gh-07", "gh-08"],
    water: {
      wellPumpOn: true,
      rawTankPct: 64,
      flowTodayL: 860,
      flowDeltaPct: 4,
    },
  },
  {
    id: "complex-03",
    code: "Complex 03",
    name: "Greenhouse Complex",
    location: "Malino, Indonesia",
    status: "Active",
    esp32: {
      online: false,
      lastSync: "1 Sep 2026 17:48:11",
      configVersion: 8,
      esp32ConfigVersion: 8,
      synchronized: false,
    },
    systemStatus: "CRITICAL",
    greenhouseIds: ["gh-09", "gh-10"],
    water: {
      wellPumpOn: false,
      rawTankPct: 41,
      flowTodayL: 210,
      flowDeltaPct: -6,
    },
  },
];
