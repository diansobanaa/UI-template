"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  hydrateOperationalState,
  isOperationalLoaded,
  getOperationalLoadError,
  getOperationalSnapshot,
  getOperationalAuthorityState,
  subscribeOperationalState,
} from "@/lib/operational-state";
import { OperationalSetupState } from "@/components/OperationalSetupState";

export function OperationalHydrator({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [loaded, setLoaded] = useState(isOperationalLoaded());
  const [error, setError] = useState<Error | null>(getOperationalLoadError());

  useEffect(() => {
    // 1. Subscribe to operational state updates
    const unsubscribe = subscribeOperationalState(() => {
      setLoaded(isOperationalLoaded());
      setError(getOperationalLoadError());
    });

    // 2. Immediately trigger AJAX hydration on initial load
    hydrateOperationalState()
      .then(() => {
        setLoaded(isOperationalLoaded());
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error("Operational backend unavailable."));
      });

    return unsubscribe;
  }, []);

  // Auto-retry every 10 seconds when in error state (backend may come back online)
  useEffect(() => {
    if (!error) return;
    const interval = setInterval(() => {
      hydrateOperationalState()
        .then(() => {
          setError(null);
          setLoaded(isOperationalLoaded());
        })
        .catch(() => {
          // Still offline — keep showing error, retry again in 10s
        });
    }, 10000);
    return () => clearInterval(interval);
  }, [error]);

  if (error) {
    return (
      <OperationalSetupState
        title="Controller Unavailable"
        message="Could not discover topology from the controller. Enter an active ESP32 IP to connect directly, or start a new Complex setup."
        actionLabel="Start Complex Setup"
        actionHref="/onboarding/complex"
      />
    );
  }

  if (!loaded) {
    return (
      <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-slate-950 text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent shadow-lg shadow-emerald-500/20" />
          <div className="text-center">
            <p className="text-sm font-semibold text-white tracking-wide">Memuat Ekosistem Greenhouse…</p>
            <p className="mt-1 text-xs text-slate-400">Menghubungkan ke controller dan memverifikasi topologi sistem</p>
          </div>
        </div>
      </div>
    );
  }

  const authState = getOperationalAuthorityState();
  const snapshot = getOperationalSnapshot();
  const isSetupRoute = location.pathname === "/complex" || location.pathname === "/onboarding/complex";

  // If controller is offline but we have known session topology, keep viewing runtime memory with OFFLINE badges
  if (authState === "CONTROLLER_UNAVAILABLE" && snapshot.complexes.length > 0) {
    return children;
  }

  if (!isSetupRoute && snapshot.complexes.length === 0) {
    if (authState === "CONTROLLER_UNAVAILABLE") {
      return (
        <OperationalSetupState
          title="Controller Unavailable"
          message="Could not establish communication with known ESP32 controller(s). Check power, network cabling, and verify the controller IP address."
          actionLabel="Start Complex Setup"
          actionHref="/onboarding/complex"
        />
      );
    }

    if (authState === "BOOTSTRAP_FAILED") {
      return (
        <OperationalSetupState
          title="Connect to Controller"
          message="No authoritative ESP32 controller is connected. Enter the controller's IP address to discover the System Topology Pool, or create the first Complex."
          actionLabel="Start Complex Setup"
          actionHref="/onboarding/complex"
        />
      );
    }

    return (
      <OperationalSetupState
        title="No Complex configured"
        message="The operational database is empty. Connect to an authoritative ESP32 controller or create the first Complex before opening operational dashboards."
        actionLabel="Start Complex Setup"
        actionHref="/onboarding/complex"
      />
    );
  }

  return children;
}
