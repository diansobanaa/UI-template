"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { hydrateOperationalState, isOperationalLoaded, getOperationalLoadError, getOperationalSnapshot } from "@/lib/operational-state";
import { OperationalSetupState } from "@/components/OperationalSetupState";

export function OperationalHydrator({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [ready, setReady] = useState(isOperationalLoaded());
  const [error, setError] = useState<Error | null>(getOperationalLoadError());

  useEffect(() => {
    hydrateOperationalState().then(() => setReady(true)).catch((err) => setError(err instanceof Error ? err : new Error("Operational backend unavailable.")));
  }, []);

  if (ready) {
    const snapshot = getOperationalSnapshot();
    const isSetupRoute = location.pathname === "/complex" || location.pathname === "/onboarding/complex";
    if (!isSetupRoute && snapshot.complexes.length === 0) {
      return (
        <OperationalSetupState
          title="No Complex configured"
          message="The operational database is empty. Create the first Complex before opening operational dashboards, schedules, calibration, or fertigation."
        />
      );
    }
    if (!isSetupRoute && snapshot.greenhouses.length === 0) {
      return (
        <OperationalSetupState
          title="No Greenhouse configured"
          message="A Complex exists, but there is no Greenhouse yet. Create at least one Greenhouse from Complex Setup before opening greenhouse operations."
        />
      );
    }
    return children;
  }
  if (error) {
    return (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950 p-6 text-white">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <h1 className="text-lg font-bold">Operational backend unavailable</h1>
          <p className="mt-2 text-sm text-slate-300">The UI no longer falls back to seeded browser data. Start the Python backend and reload.</p>
          <button className="mt-4 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950 text-sm text-slate-300">
      Connecting to operational backend…
    </div>
  );
}
