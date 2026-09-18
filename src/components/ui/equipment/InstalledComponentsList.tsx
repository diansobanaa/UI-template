import { useState } from "react";
import { InstalledComponent, SupportedComponentDefinition } from "@/lib/types/equipment";
import { Plus, Settings2, Power, AlertTriangle, ShieldCheck } from "lucide-react";
import { ComponentEditorModal } from "./ComponentEditorModal";

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
