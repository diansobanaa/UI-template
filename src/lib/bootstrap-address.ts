/**
 * Bootstrap Address & Locator Cache
 *
 * Canonical specification: docs/SYSTEM_TOPOLOGY_POOL.md Section 2.1 & 13
 *
 * The browser is allowed to persist ONLY ESP32 IP address locators so that a fresh
 * UI instance can find at least one controller. This is an address book / discovery aid,
 * NOT an operational authority database.
 *
 * FORBIDDEN:
 * - Persisting Complex/GH topology
 * - Persisting topology pool
 * - Persisting operational authority state
 * - Persisting schedules or configuration
 *
 * ALLOWED:
 * - Stored ESP32 IP address / network locator hints
 */

const STORAGE_KEY = "agrotech_bootstrap_ips";
const COOKIE_NAME = "agrotech_bootstrap_ip";

/**
 * Normalize an IP or endpoint string into a clean HTTP URL base (e.g. protocol + host).
 */
export function normalizeBootstrapEndpoint(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const withProtocol = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

/**
 * Extract clean host/IP from an endpoint string without protocol or port.
 */
export function extractHostFromEndpoint(endpoint: string): string {
  const normalized = normalizeBootstrapEndpoint(endpoint);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    return url.hostname;
  } catch {
    return endpoint.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];
  }
}

/**
 * Retrieve list of previously successful ESP32 IP locator hints from browser storage.
 */
export function getStoredBootstrapIps(): string[] {
  if (typeof window === "undefined") return [];

  const results: string[] = [];

  // 1. Try reading from localStorage
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item.trim()) {
            const normalized = normalizeBootstrapEndpoint(item);
            if (normalized && !results.includes(normalized)) {
              results.push(normalized);
            }
          }
        }
      }
    }
  } catch {
    // Ignore localStorage parse errors
  }

  // 2. Fallback to cookie if localStorage is empty
  if (results.length === 0 && typeof document !== "undefined" && document.cookie) {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
    if (match && match[1]) {
      const val = decodeURIComponent(match[1]).trim();
      if (val) {
        const normalized = normalizeBootstrapEndpoint(val);
        if (normalized) results.push(normalized);
      }
    }
  }

  return results;
}

/**
 * Get the most recently active or primary stored bootstrap endpoint.
 */
export function getActiveBootstrapIp(): string | null {
  const list = getStoredBootstrapIps();
  return list.length > 0 ? list[0] : null;
}

/**
 * Save an ESP32 IP or endpoint as a remembered discovery hint.
 * Places the newest address at the front and limits to 5 hints.
 */
export function saveBootstrapIp(ipOrEndpoint: string): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeBootstrapEndpoint(ipOrEndpoint);
  if (!normalized) return;

  try {
    const current = getStoredBootstrapIps().filter((ep) => ep !== normalized);
    current.unshift(normalized);
    const capped = current.slice(0, 5);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));

    // Also write simple cookie for redundancy
    if (typeof document !== "undefined") {
      const host = extractHostFromEndpoint(normalized);
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(host)}; expires=${expires}; path=/; SameSite=Lax`;
    }
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Remove a specific stale IP from the locator hints cache.
 */
export function removeBootstrapIp(ipOrEndpoint: string): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeBootstrapEndpoint(ipOrEndpoint);

  try {
    const current = getStoredBootstrapIps().filter((ep) => ep !== normalized);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore
  }
}

/**
 * Clear all stored IP locator hints (e.g. on full storage reset).
 */
export function clearStoredBootstrapIps(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    if (typeof document !== "undefined") {
      document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    }
  } catch {
    // Ignore
  }
}

/**
 * One-time legacy cleanup migration:
 * Eliminates any obsolete localStorage/sessionStorage/cookie keys that previously
 * held complex, greenhouse, schedule, or topology records.
 * Only IP locator hints ('agrotech_bootstrap_ips') and API tokens are permitted.
 */
export function purgeLegacyBrowserTopology(): void {
  if (typeof window === "undefined") return;
  try {
    const legacyKeys = [
      "complexes",
      "greenhouses",
      "topology",
      "schedules",
      "schedule",
      "config",
      "calibrations",
      "sensors",
      "agrotech_topology",
      "agrotech_complexes",
      "agrotech_greenhouses",
      "agrotech_schedules",
      "agrotech:local:complexes",
      "agrotech:local:greenhouses",
      "agrotech:local:topology",
      "agrotech:local:schedules",
      "selectedComplex",
      "selectedGH",
      "selectedComplexId",
      "selectedGreenhouseId",
    ];
    if (window.localStorage) {
      for (const k of legacyKeys) {
        window.localStorage.removeItem(k);
      }
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (k && (k.startsWith("agrotech:local:") || k.startsWith("schedules:") || k.startsWith("schedule:") || k.startsWith("config:"))) {
          window.localStorage.removeItem(k);
        }
      }
    }
    if (window.sessionStorage) {
      for (const k of legacyKeys) {
        window.sessionStorage.removeItem(k);
      }
      for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
        const k = window.sessionStorage.key(i);
        if (k && (k.startsWith("agrotech:local:") || k.startsWith("schedules:") || k.startsWith("schedule:") || k.startsWith("config:"))) {
          window.sessionStorage.removeItem(k);
        }
      }
    }
    if (typeof document !== "undefined" && document.cookie) {
      const cookies = document.cookie.split(";");
      for (const c of cookies) {
        const name = c.split("=")[0].trim();
        if (name !== COOKIE_NAME && (name.includes("complex") || name.includes("greenhouse") || name.includes("topology") || name.includes("schedule") || name.includes("config"))) {
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Execute on import
purgeLegacyBrowserTopology();
