import type { Capability } from "@/lib/api/contracts";

type CapabilityMap = Record<string, boolean>;

export interface GreenhouseTopologyState {
  ghId: string;
  configured: boolean;
  hydraulicallyReachable: boolean;
  automaticallyRoutable: boolean;
  manuallyRoutable: boolean;
  currentSharedManualTarget?: string | null;
  sharedPath?: boolean;
  routingControlRequired?: boolean;
  deliveryReachable?: boolean;
  capabilities: CapabilityMap;
}

export function TopologyCapabilityPanel({
  states,
  loading = false,
  unavailableReason,
}: {
  states: GreenhouseTopologyState[] | null;
  loading?: boolean;
  unavailableReason?: string;
}) {
  if (loading) {
    return (
      <section className="rounded-xl border border-slate-800 bg-[#0e1a2a]/95 p-4">
        <div className="text-[12px] font-semibold text-slate-200">Topology &amp; Capability</div>
        <div className="mt-2 text-[11px] text-slate-500">Loading active topology…</div>
      </section>
    );
  }

  if (!states) {
    return (
      <section className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4">
        <div className="text-[12px] font-semibold text-amber-200">Topology unavailable</div>
        <div className="mt-1 text-[11px] leading-5 text-slate-400">
          {unavailableReason ?? "No authoritative ESP32 topology/capability snapshot is currently available. No operational state is inferred locally."}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-[#0e1a2a]/95 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-slate-200">Topology &amp; Capability</div>
          <div className="mt-1 text-[11px] text-slate-500">Derived from the active configuration, not GH number.</div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-slate-600">runtime</div>
      </div>

      <div className="mt-3 grid gap-2 xl:grid-cols-2">
        {states.map((state) => (
          <div key={state.ghId} className="rounded-lg border border-slate-800/90 bg-slate-950/25 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[12px] font-semibold text-slate-100">{state.ghId}</div>
              <span className={`rounded-md border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] ${state.capabilities.CAN_RUN_AUTONOMOUSLY ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" : "border-amber-400/20 bg-amber-500/10 text-amber-300"}`}>
                {state.capabilities.CAN_RUN_AUTONOMOUSLY ? "AUTONOMOUS" : "LIMITED"}
              </span>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
              <StateChip label="Configured" value={state.configured} />
              <StateChip label="Hydraulic" value={state.hydraulicallyReachable} />
              <StateChip label="Auto route" value={state.automaticallyRoutable} />
              <StateChip label="Manual route" value={state.manuallyRoutable} />
              <StateChip label="Delivery path" value={Boolean(state.deliveryReachable)} />
            </div>

            {(state.sharedPath || state.routingControlRequired) && (
              <div className="mt-2 rounded-md border border-amber-400/15 bg-amber-500/5 px-2.5 py-2 text-[10px] leading-4 text-amber-200/90">
                {state.routingControlRequired && !state.currentSharedManualTarget
                  ? "Multiple GHs share this source without independent routing control. Automatic routing is unavailable until routing hardware or an active manual route is defined."
                  : `Manual/shared route ${state.currentSharedManualTarget ? `owned by ${state.currentSharedManualTarget}` : "has no active owner"}.`}
                {state.currentSharedManualTarget !== state.ghId && " Automatic execution for this GH is withheld."}
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(state.capabilities)
                .filter(([key]) => state.capabilities[key])
                .map(([key]) => (
                  <span key={key} className="rounded border border-slate-700/70 bg-slate-900/60 px-1.5 py-1 text-[9px] text-slate-400">
                    {key.replace(/^CAN_/, "")}
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StateChip({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/30 px-2 py-1.5">
      <span className="text-slate-500">{label}</span>
      <span className={value ? "font-semibold text-emerald-300" : "font-semibold text-slate-600"}>{value ? "YES" : "NO"}</span>
    </div>
  );
}
