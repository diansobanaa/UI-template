import type { Complex, Greenhouse } from "./types";

export type RealtimeState = "live" | "problem" | "offline" | "stale";

export function greenhouseRealtimeState(greenhouse: Greenhouse): RealtimeState {
  if (!greenhouse.online) return "offline";
  if (greenhouse.health !== "NORMAL" || greenhouse.equipment.some((item) => item.status === "FAULT" || item.status === "WARNING")) return "problem";
  return "live";
}

export function complexRealtimeState(complex: Complex, greenhouses: Greenhouse[]): RealtimeState {
  if (!complex.esp32.online) return "offline";
  if (complex.systemStatus !== "NORMAL" || greenhouses.some((greenhouse) => greenhouseRealtimeState(greenhouse) === "problem" || greenhouseRealtimeState(greenhouse) === "offline")) return "problem";
  return "live";
}

export function realtimeLabel(state: RealtimeState): string {
  if (state === "live") return "Realtime data connected and updating";
  if (state === "problem") return "Realtime data connected, but this area has an active problem";
  if (state === "offline") return "Realtime source is disconnected; showing last known data";
  return "Data may be stale; refresh or synchronize the hardware";
}
