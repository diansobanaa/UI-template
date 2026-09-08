import type { HardwarePortConfig } from "./contracts";

export const PYTHON_API_BASE = import.meta.env.VITE_PYTHON_API_BASE ?? "/api";
export const ESP32_API_BASE = import.meta.env.VITE_ESP32_API_BASE ?? "";

export class BackendNotConnectedError extends Error {
  constructor(message = "Backend is not connected.") {
    super(message);
    this.name = "BackendNotConnectedError";
  }
}

export class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly path: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

const defaultConfig: HardwarePortConfig = {
  pythonBaseUrl: PYTHON_API_BASE,
  esp32BaseUrl: ESP32_API_BASE || undefined,
  requestTimeoutMs: Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 8000),
  token: import.meta.env.VITE_API_TOKEN || undefined,
  directEsp32Enabled: import.meta.env.VITE_ENABLE_DIRECT_ESP32 === "true",
};

function resolveUrl(path: string, config: HardwarePortConfig = defaultConfig): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${config.pythonBaseUrl.replace(/\/$/, "")}${path}`;
}

async function request<T>(path: string, init: RequestInit = {}, config = defaultConfig): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (config.token) headers.set("Authorization", `Bearer ${config.token}`);

  try {
    const response = await fetch(resolveUrl(path, config), { ...init, headers, signal: controller.signal });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new ApiRequestError(response.status, path, message || `${init.method ?? "GET"} ${path} failed`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BackendNotConnectedError(`Request timed out: ${path}`);
    }
    throw new BackendNotConnectedError(`Request failed: ${path}`);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function apiGet<T>(path: string, config?: HardwarePortConfig): Promise<T> {
  return request<T>(path, {}, config);
}

export function apiPost<T>(path: string, body: unknown, config?: HardwarePortConfig): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) }, config);
}

export function apiPut<T>(path: string, body: unknown, config?: HardwarePortConfig): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) }, config);
}

export function apiPatch<T>(path: string, body: unknown, config?: HardwarePortConfig): Promise<T> {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) }, config);
}

export function apiDelete(path: string, config?: HardwarePortConfig): Promise<void> {
  return request<void>(path, { method: "DELETE" }, config);
}
