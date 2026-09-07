/**
 * Backend REST client — placeholder for the Python backend integration phase.
 *
 * The frontend service layer (src/lib/services.ts) currently reads from the
 * in-memory mock store. When the backend is available, re-implement the
 * services on top of the helpers below; the UI stays untouched.
 *
 * Expected API surface (aligned with API_SPEC.md):
 *
 *   GET    /api/complexes
 *   POST   /api/complexes                          { location }
 *   GET    /api/complexes/:id
 *   GET    /api/complexes/:id/greenhouses
 *   POST   /api/complexes/:id/greenhouses          { crop }
 *   GET    /api/greenhouses/:id
 *   GET    /api/greenhouses/:id/schedules          (fertigation)
 *   POST   /api/greenhouses/:id/schedules
 *   PATCH  /api/schedules/:id
 *   DELETE /api/schedules/:id
 *   GET    /api/complexes/:id/well-pump-schedules
 *   POST   /api/complexes/:id/well-pump-schedules
 *   GET    /api/greenhouses/:id/fan-schedules
 *   POST   /api/greenhouses/:id/fan-schedules
 *   GET    /api/complexes/:id/fertigation/queue
 *   GET    /api/complexes/:id/fertigation/history
 *   POST   /api/complexes/:id/fertigation/manual   { ghId, recipeId, targetWaterL }
 *   POST   /api/complexes/:id/esp32/sync
 *   POST   /api/complexes/:id/esp32/emergency-stop
 *   GET    /api/complexes/:id/calibration/devices
 *   POST   /api/calibration                        { deviceId, ... }
 *   GET    /api/calibration/history
 *   GET    /api/greenhouses/:id/telemetry?range=24H|7D|30D
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

export class BackendNotConnectedError extends Error {
  constructor() {
    super("Backend not connected — UI prototype is running on mock data.");
    this.name = "BackendNotConnectedError";
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
}
