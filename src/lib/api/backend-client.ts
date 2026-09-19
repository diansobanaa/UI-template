import type { HardwarePortConfig } from "./contracts";

export const PYTHON_API_BASE = import.meta.env.VITE_PYTHON_API_BASE ?? "/api";
export const ESP32_API_BASE = import.meta.env.VITE_ESP32_API_BASE ?? "";

/** Python backend is the default operational authority; set VITE_ENABLE_PYTHON_BACKEND=false
 * only in a non-operational test environment. */
export const isPythonBackendEnabled = (): boolean =>
  import.meta.env.VITE_ENABLE_PYTHON_BACKEND !== "false";

export class BackendNotConnectedError extends Error {
  constructor(message = "Backend is not connected.") {
    super(message);
    this.name = "BackendNotConnectedError";
  }
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number, 
    public readonly path: string, 
    message: string,
    public readonly code?: string,
    public readonly retryable?: boolean,
    public readonly reconcileRequired?: boolean,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export const defaultConfig: HardwarePortConfig = {
  pythonBaseUrl: PYTHON_API_BASE,
  esp32BaseUrl: ESP32_API_BASE || undefined,
  requestTimeoutMs: Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 8000),
  token: import.meta.env.VITE_API_TOKEN || undefined,
  directEsp32Enabled: Boolean(ESP32_API_BASE) && import.meta.env.VITE_ENABLE_DIRECT_ESP32 !== "false",
};

export const isDirectEsp32Enabled = (): boolean =>
  Boolean(defaultConfig.directEsp32Enabled);


function resolveUrl(path: string, config: HardwarePortConfig = defaultConfig): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (config.esp32BaseUrl && config.directEsp32Enabled) {
    return `${config.esp32BaseUrl.replace(/\/$/, "")}${path}`;
  }
  const base = config.pythonBaseUrl;
  if (base) {
    return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  }
  return path;
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
      let message = `${init.method ?? "GET"} ${path} failed`;
      let code = undefined;
      let retryable = undefined;
      let reconcileRequired = undefined;
      let requestId = undefined;

      try {
        const errData = await response.clone().json();
        if (errData && errData.error) {
          message = errData.error.message || message;
          code = errData.error.code;
          retryable = errData.error.retryable;
          reconcileRequired = errData.error.reconcileRequired;
          requestId = errData.requestId;
        } else {
          const raw = await response.text().catch(() => message);
          if (raw.includes("ECONNREFUSED") || response.status === 502 || response.status === 500) {
            message = "Backend server is not running or unreachable (http://127.0.0.1:8090).";
          } else {
            message = raw || message;
          }
        }
      } catch (e) {
        const raw = await response.text().catch(() => message);
        if (raw.includes("ECONNREFUSED") || response.status === 502 || response.status === 500) {
          message = "Backend server is not running or unreachable (http://127.0.0.1:8090).";
        } else {
          message = raw || message;
        }
      }

      throw new ApiRequestError(response.status, path, message, code, retryable, reconcileRequired, requestId);
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

export function apiDelete<T = void>(path: string, config?: HardwarePortConfig): Promise<T> {
  return request<T>(path, { method: "DELETE" }, config);
}
