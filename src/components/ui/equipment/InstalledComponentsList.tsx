import { useEffect, useState } from "react";
import { InstalledComponent, SupportedComponentDefinition } from "@/lib/types/equipment";
import { Plus, Settings2, AlertTriangle, ArrowRightLeft, X } from "lucide-react";
import { ComponentEditorModal } from "./ComponentEditorModal";
import { PythonClient } from "@/lib/api/python-client";

export function InstalledComponentsList({ 
  components, 
  catalog,
  onRefresh 
}: { 
  components: InstalledComponent[], 
  catalog: SupportedComponentDefinition[],
  onRefresh: () => void 
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<InstalledComponent | undefined>();
  const [transferComponent, setTransferComponent] = useState<InstalledComponent | undefined>();
  const [transferTargetGh, setTransferTargetGh] = useState("");
  const [transferConfirmed, setTransferConfirmed] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const getLifecycleColor = (state: string) => {
    switch (state) {
      case "REGISTERED": return "bg-slate-500 text-slate-100";
      case "NOT_COMMISSIONED": return "bg-yellow-500/20 text-yellow-400";
      case "COMMISSIONED": return "bg-blue-500/20 text-blue-400";
      case "ENABLED": return "bg-green-500/20 text-green-400";
      case "DISABLED": return "bg-slate-700 text-slate-300";
      case "FAULTED": return "bg-red-500/20 text-red-400";
      case "REMOVED": return "bg-red-900/50 text-red-200";
      default: return "bg-slate-500 text-slate-100";
    }
  };

  const executeTransfer = async () => {
    if (!transferComponent?.resourceId || !transferComponent.assignment?.complexId || !transferTargetGh || !transferConfirmed) return;
    setTransferBusy(true);
    setTransferError(null);
    try {
      const complexId = transferComponent.assignment.complexId;
      const client = new PythonClient();
      const configuration = await client.getConfiguration(complexId);
      const currentGh = transferComponent.assignment.ghId ?? null;
      if (currentGh === transferTargetGh) throw new Error("Target GH is already the current assignment.");
      const result = await client.transferResource(complexId, transferComponent.resourceId, {
        targetGhId: transferTargetGh,
        physicalMoveConfirmed: true,
        operator: "operator-ui",
        configuration,
      });
      await client.saveConfiguration(complexId, result.configuration);
      setTransferComponent(undefined);
      setTransferTargetGh("");
      setTransferConfirmed(false);
      onRefresh();
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "Resource transfer failed.");
    } finally {
      setTransferBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-medium text-slate-200">Installed Hardware Instances</h2>
        <button 
          onClick={() => {
            setEditingComponent(undefined);
            setEditorOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Register New Component
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-700/50 bg-slate-800/40">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-800/80 text-xs font-medium text-slate-400 uppercase tracking-wider">
            <tr>
              <th className="px-6 py-4">Identity</th>
              <th className="px-6 py-4">Assignment</th>
              <th className="px-6 py-4">Wiring</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {components.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                  No components registered yet.
                </td>
              </tr>
            ) : components.map((comp) => {
              const def = catalog.find(c => c.supportedTypeId === comp.supportedTypeId);
              return (
                <tr key={comp.componentId} className="hover:bg-slate-800/60 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-200">{comp.name}</span>
                      <span className="text-xs text-slate-500 font-mono mt-0.5">{comp.componentId}</span>
                      <span className="text-xs text-blue-400 mt-1">{def?.displayName || comp.supportedTypeId}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1 text-xs">
                      <span className="text-slate-300 bg-slate-700/50 px-2 py-0.5 rounded w-max">
                        {comp.assignment?.complexId}
                      </span>
                      {comp.assignment?.ghId && (
                        <span className="text-emerald-400 bg-emerald-900/20 px-2 py-0.5 rounded w-max">
                          {comp.assignment.ghId}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-xs text-slate-300 font-mono bg-slate-900/50 p-2 rounded">
                      {comp.wiring?.interface}: {comp.wiring?.gpio !== undefined ? `GPIO ${comp.wiring.gpio}` : "N/A"}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-2">
                      <span className={`px-2 py-1 rounded text-xs font-semibold w-max ${getLifecycleColor(comp.lifecycleState)}`}>
                        {comp.lifecycleState}
                      </span>
                      {comp.deploymentStatus === "PENDING" && (
                        <span className="text-xs text-yellow-400 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Config Pending
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {comp.resourceId && comp.assignment?.ghId && (
                      <button
                        onClick={() => {
                          setTransferComponent(comp);
                          setTransferTargetGh("");
                          setTransferConfirmed(false);
                          setTransferError(null);
                        }}
                        className="p-2 text-slate-400 hover:text-amber-400 transition-colors"
                        title="Transfer resource"
                      >
                        <ArrowRightLeft className="w-5 h-5" />
                      </button>
                    )}
                    <button 
                      onClick={() => {
                        setEditingComponent(comp);
                        setEditorOpen(true);
                      }}
                      className="p-2 text-slate-400 hover:text-blue-400 transition-colors" 
                      title="Manage"
                    >
                      <Settings2 className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      
      {transferComponent && (
        <ResourceTransferModal
          component={transferComponent}
          onClose={() => {
            if (!transferBusy) {
              setTransferComponent(undefined);
              setTransferTargetGh("");
              setTransferConfirmed(false);
              setTransferError(null);
            }
          }}
          targetGh={transferTargetGh}
          setTargetGh={setTransferTargetGh}
          confirmed={transferConfirmed}
          setConfirmed={setTransferConfirmed}
          busy={transferBusy}
          error={transferError}
          onTransfer={executeTransfer}
        />
      )}

      {editorOpen && (
        <ComponentEditorModal
          catalog={catalog}
          initialData={editingComponent}
          onClose={() => setEditorOpen(false)}
          onSave={() => {
            setEditorOpen(false);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}


function ResourceTransferModal({
  component, onClose, targetGh, setTargetGh, confirmed, setConfirmed, busy, error, onTransfer
}: {
  component: InstalledComponent;
  onClose: () => void;
  targetGh: string;
  setTargetGh: (value: string) => void;
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
  busy: boolean;
  error: string | null;
  onTransfer: () => void;
}) {
  const [ghs, setGhs] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    const load = async () => {
      if (!component.assignment?.complexId) {
        setGhs([]);
        return;
      }
      try {
        const config = await new PythonClient().getConfiguration(component.assignment.complexId);
        const next = (config.greenhouses ?? []).map((gh: { ghId?: string; id?: string; name?: string; code?: string; greenhouseTag?: string }) => ({
          id: String(gh.ghId ?? gh.id ?? ""),
          label: String(gh.name ?? gh.code ?? gh.greenhouseTag ?? gh.ghId ?? gh.id ?? "GH")
        })).filter((gh) => gh.id);
        setGhs(next);
      } catch {
        setGhs([]);
      }
    };
    void load();
  }, [component.assignment?.complexId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h3 className="font-semibold text-slate-100">Transfer Resource</h3>
            <p className="mt-1 text-xs text-slate-500 font-mono">{component.resourceId}</p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-slate-500 hover:text-slate-200 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="rounded-xl bg-slate-800/70 p-4 text-sm">
            <div className="text-xs uppercase tracking-wider text-slate-500">Current assignment</div>
            <div className="mt-1 font-medium text-slate-200">{component.assignment?.ghId ?? "Unassigned"}</div>
          </div>
          <label className="block text-sm">
            <span className="mb-2 block text-slate-300">Target greenhouse</span>
            <select value={targetGh} onChange={(e) => setTargetGh(e.target.value)} disabled={busy} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100">
              <option value="">Select target GH</option>
              {ghs.filter((gh) => gh.id !== component.assignment?.ghId).map((gh) => <option key={gh.id} value={gh.id}>{gh.label} ({gh.id})</option>)}
            </select>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />
            <span className="text-slate-300">I confirm the physical hardware/resource has been disconnected from the current GH and physically moved to the target GH before deployment.</span>
          </label>
          {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
          <div className="flex justify-end gap-3">
            <button onClick={onClose} disabled={busy} className="rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
            <button onClick={onTransfer} disabled={busy || !targetGh || !confirmed} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Deploying…" : "Transfer & Deploy"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
