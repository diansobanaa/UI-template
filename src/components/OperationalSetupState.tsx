import { useState } from "react";
import { Building2, Sprout, Wifi, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  connectBootstrapIp,
  getOperationalTopologyMetadata,
  getOperationalSnapshot,
} from "@/lib/operational-state";
import { getStoredBootstrapIps, getActiveBootstrapIp, extractHostFromEndpoint } from "@/lib/bootstrap-address";

export function OperationalSetupState({
  title,
  message,
  actionLabel = "Start Complex Setup",
  actionHref = "/onboarding/complex",
}: {
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  const navigate = useNavigate();
  const [inputIp, setInputIp] = useState(() => {
    const active = getActiveBootstrapIp();
    return active ? extractHostFromEndpoint(active) : "";
  });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);
  const storedHints = getStoredBootstrapIps();

  const isNoComplex =
    title.toLowerCase().includes("no complex") ||
    title.toLowerCase().includes("topology") ||
    title.toLowerCase().includes("unavailable") ||
    title.toLowerCase().includes("connect") ||
    title.toLowerCase().includes("controller");

  async function handleConnect() {
    if (!inputIp.trim()) return;
    setConnecting(true);
    setConnectError(null);
    setConnectSuccess(null);

    try {
      const ok = await connectBootstrapIp(inputIp.trim());
      if (ok) {
        const meta = getOperationalTopologyMetadata();
        const snapshot = getOperationalSnapshot();
        const activeComplexes = (snapshot.complexes || []).filter((c) => c.status === "Active");
        setConnectSuccess(`Connected to ESP32 (${meta?.reachableControllers[0] || inputIp.trim()}). System topology hydrated.`);

        // First-boot routing requirement:
        // IF the authoritative/reachable topology contains at least one ACTIVE Complex:
        //     navigate to MAIN/DASHBOARD page.
        // ELSE:
        //     navigate/show "Add Complex".
        if (activeComplexes.length > 0) {
          navigate(`/dashboard?complex=${encodeURIComponent(activeComplexes[0].id)}`, { replace: true });
        } else {
          navigate("/onboarding/complex", { replace: true });
        }
      } else {
        setConnectError(`Could not reach ESP32 at ${inputIp.trim()}. Ensure controller is powered on, connected to the network, and responds on port 80.`);
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Connection failed.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#06131b] px-6 py-10 text-slate-100">
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
        <div className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
            {title.toLowerCase().includes("greenhouse") ? <Sprout className="h-7 w-7" /> : <Building2 className="h-7 w-7" />}
          </div>
          <h1 className="mt-5 text-xl font-bold text-white">{title}</h1>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">{message}</p>

          {isNoComplex && (
            <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-5 text-left">
              <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-emerald-400">
                <Wifi className="h-4 w-4" />
                <span>Connect to ESP32</span>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Enter one ESP32 IP address. The browser will probe health and discover the complete System Topology Pool directly from the controller.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={inputIp}
                  onChange={(e) => {
                    setInputIp(e.target.value);
                    setConnectError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !connecting && inputIp.trim()) {
                      handleConnect();
                    }
                  }}
                  placeholder="ESP32 IP Address"
                  className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  disabled={connecting}
                />
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={connecting || !inputIp.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                  <span>Connect</span>
                </button>
              </div>

              {storedHints.length > 0 && (
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                  <span>Stored hints:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {storedHints.map((hint) => {
                      const host = extractHostFromEndpoint(hint);
                      return (
                        <button
                          key={hint}
                          type="button"
                          onClick={() => {
                            setInputIp(host);
                            setConnectError(null);
                          }}
                          className="rounded bg-white/5 px-2 py-0.5 font-mono text-[11px] text-emerald-300 hover:bg-white/10 cursor-pointer"
                        >
                          {host}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {connectError && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5 text-xs text-red-300">
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                  <span>{connectError}</span>
                </div>
              )}

              {connectSuccess && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-xs text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{connectSuccess}</span>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to={actionHref || "/onboarding/complex"}
              className="inline-flex items-center justify-center rounded-xl bg-slate-800 border border-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              {actionLabel}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
