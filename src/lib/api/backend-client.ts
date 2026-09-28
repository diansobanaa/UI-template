import type { HardwarePortConfig } from "./contracts";
import { getActiveBootstrapIp } from "../bootstrap-address";

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

export const DEFAULT_API_TOKEN = "agrotech-secret-key";

export const defaultConfig: HardwarePortConfig = {
  pythonBaseUrl: PYTHON_API_BASE,
  esp32BaseUrl: ESP32_API_BASE || (typeof window !== "undefined" ? getActiveBootstrapIp() || undefined : undefined),
  requestTimeoutMs: Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 15000),
  token: import.meta.env.VITE_API_TOKEN || (typeof window !== "undefined" ? localStorage.getItem("agrotech_api_token") : null) || DEFAULT_API_TOKEN,
  directEsp32Enabled: import.meta.env.VITE_ENABLE_DIRECT_ESP32 !== "false",
};

export const isDirectEsp32Enabled = (): boolean =>
  Boolean(defaultConfig.directEsp32Enabled);

export function setActiveEsp32Endpoint(endpoint: string): void {
  const normalized = endpoint.trim().replace(/\/+$/, "");
  defaultConfig.esp32BaseUrl = normalized || undefined;
  defaultConfig.directEsp32Enabled = Boolean(normalized) && import.meta.env.VITE_ENABLE_DIRECT_ESP32 !== "false";
}

export function getActiveEsp32Endpoint(): string | undefined {
  return defaultConfig.esp32BaseUrl;
}


function resolveUrl(path: string, config: HardwarePortConfig = defaultConfig): string {
  if (/^https?:\/\//i.test(path)) return path;
  let esp32Url = config.esp32BaseUrl;
  if (!esp32Url && typeof window !== "undefined") {
    esp32Url = getActiveBootstrapIp() || undefined;
    if (esp32Url) {
      config.esp32BaseUrl = esp32Url;
    }
  }
  if (esp32Url && config.directEsp32Enabled) {
    return `${esp32Url.replace(/\/$/, "")}${path}`;
  }
  const base = (config.pythonBaseUrl || "").replace(/\/$/, "");
  if (base) {
    if (path.startsWith(base + "/") || path === base) {
      return path;
    }
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }
  return path;
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}, config = defaultConfig): Promise<T> {
  const timeoutMs = init.timeoutMs ?? config.requestTimeoutMs;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = config.token || (typeof window !== "undefined" ? localStorage.getItem("agrotech_api_token") : undefined) || import.meta.env.VITE_API_TOKEN || DEFAULT_API_TOKEN;
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  try {
    const response = await fetch(resolveUrl(path, config), {
      ...init,
      cache: "no-store",
      headers,
      signal: controller.signal,
    });
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

export function apiGet<T>(path: string, config?: HardwarePortConfig, options?: { timeoutMs?: number }): Promise<T> {
  return request<T>(path, { ...options }, config);
}

export function apiPost<T>(path: string, body: unknown, config?: HardwarePortConfig, options?: { timeoutMs?: number }): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body), ...options }, config);
}

export function apiPut<T>(path: string, body: unknown, config?: HardwarePortConfig, options?: { timeoutMs?: number }): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body), ...options }, config);
}

export function apiPatch<T>(path: string, body: unknown, config?: HardwarePortConfig, options?: { timeoutMs?: number }): Promise<T> {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body), ...options }, config);
}

export function apiDelete<T = void>(
  path: string,
  bodyOrConfig?: unknown,
  config?: HardwarePortConfig,
  headers?: Record<string, string>
): Promise<T> {
  if (bodyOrConfig && typeof bodyOrConfig === "object" && ("pythonBaseUrl" in bodyOrConfig || "requestTimeoutMs" in bodyOrConfig)) {
    return request<T>(path, { method: "DELETE" }, bodyOrConfig as HardwarePortConfig);
  }
  const init: RequestInit = { method: "DELETE" };
  if (bodyOrConfig !== undefined) {
    init.body = JSON.stringify(bodyOrConfig);
  }
  if (headers) {
    init.headers = headers;
  }
  return request<T>(path, init, config);
}
