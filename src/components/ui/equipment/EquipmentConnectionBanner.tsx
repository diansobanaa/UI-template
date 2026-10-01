import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Wifi, RefreshCw, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  getActiveEsp32Endpoint,
  setActiveEsp32Endpoint,
  isDirectEsp32Enabled,
} from "@/lib/api/backend-client";
import { esp32Client, HEALTH_TIMEOUT_MS } from "@/lib/api/esp32-client";
import { saveBootstrapIp, getActiveBootstrapIp, extractHostFromEndpoint } from "@/lib/bootstrap-address";
import { hydrateOperationalState } from "@/lib/operational-state";

/**
 * EquipmentConnectionBanner
 *
 * FIX(FIX-EQUIPMENT-DHT22): Surface the live ESP32 endpoint and any
 * file:// protocol limitation directly on the Hardware Management page so
 * that an operator who opens `dist/index.html` via `file://` understands
 * why "Apply" fails (browser blocks cross-origin fetch from file://
 * origins even when the ESP32 sends `Access-Control-Allow-Origin: *`).
 *
 * Also provides an inline IP override so the operator can repoint the UI
 * at a different ESP32 without rebuilding or navigating away.
 */
export function EquipmentConnectionBanner({ onRehydrate }: { onRehydrate?: () => void }) {
  const [isFileProtocol, setIsFileProtocol] = useState(false);
  const [activeEndpoint, setActiveEndpoint] = useState<string | undefined>(undefined);
  const [inputIp, setInputIp] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const refreshEndpoint = useCallback(() => {
    const ep = getActiveEsp32Endpoint();
    setActiveEndpoint(ep);
    if (ep) {
      setInputIp(extractHostFromEndpoint(ep));
    } else {
      const hint = getActiveBootstrapIp();
      setInputIp(hint ? extractHostFromEndpoint(hint) : "");
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location) {
      setIsFileProtocol(window.location.protocol === "file:");
    }
    refreshEndpoint();
  }, [refreshEndpoint]);

  async function handleApplyEndpoint() {
    const trimmed = inputIp.trim();
    if (!trimmed) return;
    setTesting(true);
    setTestResult(null);
    try {
      const normalized = trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed.replace(/\/+$/, "")
        : `http://${trimmed}`.replace(/\/+$/, "");
      setActiveEsp32Endpoint(normalized);
      saveBootstrapIp(normalized);
      // Probe the new endpoint directly via the ESP32 health check.
      await esp32Client.getHealth({ timeoutMs: HEALTH_TIMEOUT_MS });
      setTestResult({ ok: true, message: `Tersambung ke ESP32 di ${normalized}` });
      // Re-hydrate operational state so the rest of the UI picks up the new endpoint.
      try {
        await hydrateOperationalState(normalized);
        if (onRehydrate) onRehydrate();
      } catch (err) {
        // Health check succeeded but full hydration failed — non-fatal, the
        // operator can still attempt the save. Log for diagnostics.
        console.warn("[EquipmentConnectionBanner] hydration after endpoint switch failed:", err);
      }
      refreshEndpoint();
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: `Gagal terhubung: ${err?.message || "Kesalahan jaringan/CORS"}`,
      });
    } finally {
      setTesting(false);
    }
  }

  const bannerTone = isFileProtocol ? "border-amber-500/30 bg-amber-950/30" : "border-slate-700/60 bg-slate-900/40";
  const endpointLabel = activeEndpoint || "(tidak aktif)";
  const directEnabled = isDirectEsp32Enabled();

  return (
    <div className={`rounded-xl border p-4 ${bannerTone}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Wifi className="h-4 w-4 text-emerald-400" />
            <span>Koneksi ESP32 (Authority Endpoint)</span>
            {directEnabled ? (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                Direct ESP32 Mode
              </span>
            ) : (
              <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-300">
                Direct ESP32 OFF
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Endpoint aktif: <span className="font-mono text-slate-200">{endpointLabel}</span>
          </div>

          {isFileProtocol && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div className="space-y-1">
                <div className="font-semibold">Mode file:// terdeteksi — fetch ke ESP32 kemungkinan diblokir browser.</div>
                <div>
                  Browser memblokir <code className="rounded bg-amber-500/10 px-1 py-0.5">fetch()</code> cross-origin
                  dari origin <code className="rounded bg-amber-500/10 px-1 py-0.5">file://</code> ke
                  <code className="rounded bg-amber-500/10 px-1 py-0.5">http://&lt;ESP32_IP&gt;</code> meskipun ESP32
                  mengirim <code className="rounded bg-amber-500/10 px-1 py-0.5">Access-Control-Allow-Origin: *</code>.
                  Akibatnya tombol <strong>Apply</strong> bisa gagal dengan error jaringan.
                </div>
                <div>
                  <strong>Workaround:</strong> layani UI lewat HTTP (mis.
                  <code className="rounded bg-amber-500/10 px-1 py-0.5">python3 -m http.server 8080</code> di folder
                  <code className="rounded bg-amber-500/10 px-1 py-0.5">dist/</code>), atau masukkan IP ESP32
                  secara manual di bawah ini lalu klik <strong>Test &amp; Apply</strong>.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 md:w-[360px]">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputIp}
              onChange={(e) => {
                setInputIp(e.target.value);
                setTestResult(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !testing && inputIp.trim()) {
                  handleApplyEndpoint();
                }
              }}
              placeholder="IP ESP32 (cth: 192.168.0.139)"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              disabled={testing}
            />
            <button
              type="button"
              onClick={handleApplyEndpoint}
              disabled={testing || !inputIp.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span>Test &amp; Apply</span>
            </button>
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${
                testResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-red-500/30 bg-red-500/10 text-red-200"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
