import type { AlertItem, EventItem } from "@/lib/types";

/** Recent events — Complex 01 dashboard. */
export const recentEvents: EventItem[] = [
  { id: "ev-1", time: "13:12", text: "Fertigation GH-02 completed", level: "success" },
  { id: "ev-2", time: "13:08", text: "Mixing GH-01 started", level: "success" },
  { id: "ev-3", time: "12:55", text: "Raw water tank refill completed", level: "success" },
  { id: "ev-4", time: "12:40", text: "Flow rate GH-03 abnormal", level: "warning" },
  { id: "ev-5", time: "12:35", text: "Schedule GH-04 executed", level: "success" },
];

/** Notification bell items. */
export const alerts: AlertItem[] = [
  { id: "al-1", title: "Flow rate GH-03 abnormal", detail: "Flow meter reading outside expected range during distribution.", level: "warning", time: "12:40" },
  { id: "al-2", title: "GH 04 offline", detail: "No telemetry received since 11:02. Check ESP32 node power/connection.", level: "error", time: "11:05" },
];
