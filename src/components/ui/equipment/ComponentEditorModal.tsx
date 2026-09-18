import { useState, useEffect } from "react";
import { X, Save, AlertTriangle, Power, Trash2 } from "lucide-react";
import { InstalledComponent, SupportedComponentDefinition, LifecycleState } from "@/lib/types/equipment";
import { hardwareService, complexService, greenhouseService } from "@/lib/services";

interface Props {
  catalog: SupportedComponentDefinition[];
  initialData?: InstalledComponent;
  onClose: () => void;
  onSave: () => void;
}

export function ComponentEditorModal({ catalog, initialData, onClose, onSave }: Props) {
  const [formData, setFormData] = useState<Partial<InstalledComponent>>(
    initialData || {
      name: "",
      supportedTypeId: catalog[0]?.supportedTypeId || "",
      lifecycleState: "REGISTERED",
      deploymentStatus: "PENDING",
      assignment: { complexId: "" },
      wiring: { interface: "GPIO" },
      parameters: {}
    }
  );
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complexes = complexService.list();
  const ghs = formData.assignment?.complexId ? greenhouseService.byComplex(formData.assignment.complexId) : [];
  
  const selectedDef = catalog.find(c => c.supportedTypeId === formData.supportedTypeId);

  // Initialize defaults when complex is selected
  useEffect(() => {
    if (!initialData && complexes.length > 0 && !formData.assignment?.complexId) {
      setFormData(prev => ({
        ...prev,
        assignment: { ...prev.assignment, complexId: complexes[0].id }
      }));
    }
  }, [complexes, formData.assignment?.complexId, initialData]);

  // Sync wiring interface with definition
  useEffect(() => {
    if (selectedDef && (!initialData || formData.supportedTypeId !== initialData.supportedTypeId)) {
      setFormData(prev => ({
        ...prev,
        wiring: { ...prev.wiring, interface: selectedDef.interfaceType }
      }));
    }
  }, [selectedDef, formData.supportedTypeId, initialData]);

  const handleSave = async () => {
    try {
      setIsSubmitting(true);
      setError(null);
      
      if (!formData.name?.trim()) throw new Error("Name is required");
      if (!formData.supportedTypeId) throw new Error("Component Type is required");
      if (!formData.assignment?.complexId) throw new Error("Complex assignment is required");

      if (initialData?.componentId) {
        await hardwareService.updateComponent(initialData.componentId, {
          name: formData.name,
          assignment: formData.assignment,
          wiring: formData.wiring,
          parameters: formData.parameters,
          role: formData.role,
          lifecycleState: formData.lifecycleState,
          deploymentStatus: "PENDING"
        });
      } else {
        await hardwareService.registerComponent(formData as Omit<InstalledComponent, "componentId">);
      }
      
      onSave();
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDecommission = async () => {
    if (!initialData?.componentId) return;
    if (!confirm("Are you sure you want to decommission this component? It will be marked as REMOVED and operational references may break.")) return;
    
    try {
      setIsSubmitting(true);
      await hardwareService.decommissionComponent(initialData.componentId);
      onSave();
    } catch (err: any) {
      setError(err.message);
      setIsSubmitting(false);
    }
  };

  const handleEnableDisable = () => {
    const newState = formData.lifecycleState === "ENABLED" ? "DISABLED" : "ENABLED";
    setFormData(prev => ({ ...prev, lifecycleState: newState }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">
              {initialData ? "Edit Component Configuration" : "Register New Component"}
            </h2>
            {initialData && (
              <p className="text-xs font-mono text-slate-400 mt-1">ID: {initialData.componentId}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-8 flex-grow custom-scrollbar">
          {error && (
            <div className="p-4 bg-red-900/40 border border-red-500/50 rounded-lg text-red-300 text-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {/* Section: Identity */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-2">Identity & Type</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Display Name</label>
                <input
                  type="text"
                  value={formData.name || ""}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  placeholder="e.g. Nutrient A Pump"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Supported Model Type</label>
                <select
                  value={formData.supportedTypeId || ""}
                  onChange={(e) => setFormData(prev => ({ ...prev, supportedTypeId: e.target.value, parameters: {} }))}
                  disabled={!!initialData} // Cannot change type after registration
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  {catalog.map(c => (
                    <option key={c.supportedTypeId} value={c.supportedTypeId}>
                      {c.displayName} ({c.category})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Section: Assignment & Role */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-2">Assignment & Role</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Complex</label>
                <select
                  value={formData.assignment?.complexId || ""}
                  onChange={(e) => setFormData(prev => ({ ...prev, assignment: { ...prev.assignment!, complexId: e.target.value, ghId: null } }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {complexes.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Greenhouse (Optional)</label>
                <select
                  value={formData.assignment?.ghId || ""}
                  onChange={(e) => setFormData(prev => ({ ...prev, assignment: { ...prev.assignment!, ghId: e.target.value || null } }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Complex Level (Shared) --</option>
                  {ghs.map(g => <option key={g.id} value={g.id}>{g.code}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Logical Role</label>
                <input
                  type="text"
                  value={formData.role || ""}
                  onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  placeholder="e.g. DOSING_PUMP_A"
                />
              </div>
            </div>
          </section>

          {/* Section: Wiring & Interface */}
          {selectedDef && (
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-2">Wiring ({selectedDef.interfaceType})</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedDef.interfaceType === "GPIO" && (
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">GPIO Pin</label>
                    <input
                      type="number"
                      value={formData.wiring?.gpio || ""}
                      onChange={(e) => setFormData(prev => ({ ...prev, wiring: { ...prev.wiring!, gpio: parseInt(e.target.value) } }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}
                {["I2C", "UART", "SPI"].includes(selectedDef.interfaceType) && (
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Address / Port</label>
                    <input
                      type="text"
                      value={formData.wiring?.address || formData.wiring?.port || ""}
                      onChange={(e) => setFormData(prev => ({ ...prev, wiring: { ...prev.wiring!, address: e.target.value } }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Section: Parameters */}
          {selectedDef && selectedDef.parameterDefinitions.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-2">Type-Specific Parameters</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedDef.parameterDefinitions.map(param => (
                  <div key={param.id} className="space-y-1">
                    <label className="text-xs text-slate-400">
                      {param.name} {param.required && <span className="text-red-400">*</span>}
                    </label>
                    <input
                      type={param.type === "number" ? "number" : "text"}
                      value={String(formData.parameters?.[param.id] ?? param.defaultValue ?? "")}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        parameters: { ...prev.parameters, [param.id]: param.type === "number" ? parseFloat(e.target.value) : e.target.value } 
                      }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    {param.description && <p className="text-[10px] text-slate-500">{param.description}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Section: Lifecycle Operations (Only for existing) */}
          {initialData && (
            <section className="space-y-4 pt-4">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-2">Lifecycle Operations</h3>
              <div className="flex flex-wrap gap-3">
                <button 
                  onClick={handleEnableDisable}
                  type="button"
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    formData.lifecycleState === "ENABLED" || formData.lifecycleState === "COMMISSIONED"
                      ? "bg-slate-700 hover:bg-slate-600 text-white" 
                      : "bg-green-600 hover:bg-green-500 text-white"
                  }`}
                >
                  <Power className="w-4 h-4" />
                  {formData.lifecycleState === "ENABLED" || formData.lifecycleState === "COMMISSIONED" ? "Disable Component" : "Enable Component"}
                </button>
                
                <button 
                  type="button"
                  onClick={handleDecommission}
                  className="flex items-center gap-2 px-4 py-2 bg-red-900/50 hover:bg-red-800 text-red-200 rounded-lg text-sm font-medium transition-colors ml-auto"
                >
                  <Trash2 className="w-4 h-4" />
                  Decommission
                </button>
              </div>
            </section>
          )}

        </div>

        <div className="p-6 border-t border-slate-800 flex justify-end gap-3 bg-slate-900/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {isSubmitting ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </div>
    </div>
  );
}
