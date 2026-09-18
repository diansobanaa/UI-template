"use client";

import { useEffect, useState } from "react";
import { Wrench, ArrowRightLeft, ShieldAlert } from "lucide-react";
import { esp32Client } from "@/lib/api/esp32-client";
import { ConfigurationPayload, InstalledComponent, Assignment } from "@/lib/api/contracts";
import { Button, StatusBadge } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";

interface AssignmentManagerProps {
  context: "COMPLEX" | "GH";
  ghId?: string; // required if context === "GH"
}

export function AssignmentManager({ context, ghId }: AssignmentManagerProps) {
  const [config, setConfig] = useState<ConfigurationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [transferState, setTransferState] = useState<{
    component: InstalledComponent;
    oldAssignment?: Assignment;
    newScope: "COMPLEX" | "GH";
    newGhId?: string;
  } | null>(null);
  
  const toast = useToast();

  const loadConfig = async () => {
    setLoading(true);
    try {
      const cfg = await esp32Client.getConfiguration();
      // the API returns { config: ConfigurationPayload, version: number } 
      // or directly ConfigurationPayload based on our previous M5 edits.
      const payload = (cfg as any).config || cfg;
      setConfig(payload);
    } catch (e: any) {
      toast("Failed to load configuration", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const getAssignment = (componentId: string) => {
    if (!config?.assignments) return undefined;
    return config.assignments.find((a) => a.resourceId === componentId);
  };

  const handleAssignClick = (component: InstalledComponent) => {
    const old = getAssignment(component.componentId);
    if (
      old &&
      old.scope === context &&
      (context === "COMPLEX" || old.ghId === ghId)
    ) {
      // Already assigned to this context
      return;
    }
    setTransferState({
      component,
      oldAssignment: old,
      newScope: context,
      newGhId: ghId,
    });
  };

  const confirmTransfer = async () => {
    if (!transferState || !config) return;
    
    try {
      const { component, newScope, newGhId } = transferState;
      const draft = { ...config };
      draft.assignments = draft.assignments ? [...draft.assignments] : [];
      
      // Remove old assignment for this resource (M6.1: Enforce exclusive owner)
      draft.assignments = draft.assignments.filter((a) => a.resourceId !== component.componentId);
      
      // Add new assignment
      const newAssignment: Assignment = {
        assignmentId: `assign-${Date.now()}`,
        resourceId: component.componentId,
        scope: newScope,
        ghId: newGhId || null,
      };
      draft.assignments.push(newAssignment);
      
      // Stage the config
      await esp32Client.saveConfiguration(draft);
      toast(`Component ${component.name} transferred successfully. Configuration is Staged.`, "success");
      setTransferState(null);
      loadConfig();
    } catch (e: any) {
      toast("Failed to transfer: " + (e.message || String(e)), "error");
    }
  };

  if (loading) return <div className="p-4 text-slate-400">Loading assignments...</div>;
  if (!config) return <div className="p-4 text-slate-400">No configuration found.</div>;

  const relevantComponents = (config.components || []).filter(c => c.lifecycleState !== "REMOVED");

  return (
    <div className="bg-slate-800 rounded-xl p-4 md:p-6 shadow-lg border border-slate-700/50">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
          <Wrench className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-100">Resource Assignments (M6)</h2>
          <p className="text-sm text-slate-400">Manage hardware ownership and transfers</p>
        </div>
      </div>

      <div className="space-y-4">
        {relevantComponents.map((c) => {
          const assignment = getAssignment(c.componentId);
          const isOwnedHere = assignment && assignment.scope === context && (context === "COMPLEX" || assignment.ghId === ghId);
          
          return (
            <div key={c.componentId} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700/50 transition-colors hover:border-slate-600">
              <div>
                <div className="font-medium text-slate-200">{c.name}</div>
                <div className="text-sm text-slate-400 font-mono mt-1">{c.componentId}</div>
              </div>
              
              <div className="flex items-center gap-4 mt-4 sm:mt-0">
                <div className="text-sm">
                  {assignment ? (
                    <StatusBadge
                      status="ACTIVE"
                      text={assignment.scope === "COMPLEX" ? "Assigned: Complex" : `Assigned: ${assignment.ghId}`}
                    />
                  ) : (
                    <StatusBadge status="PENDING" text="Unassigned" />
                  )}
                </div>
                
                {!isOwnedHere && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => handleAssignClick(c)}
                    className="flex items-center gap-2"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    Claim to {context === "COMPLEX" ? "Complex" : ghId}
                  </Button>
                )}
                {isOwnedHere && (
                  <div className="px-3 py-1 text-xs font-medium text-green-400 bg-green-400/10 rounded-full border border-green-400/20">
                    Owned Here
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {relevantComponents.length === 0 && (
          <div className="text-sm text-slate-500 text-center py-4">No components found in configuration.</div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!transferState}
        onClose={() => setTransferState(null)}
        onConfirm={confirmTransfer}
        title="Confirm Resource Transfer"
        confirmText="Acknowledge & Transfer"
        isDanger={true}
      >
        {transferState && (
          <div className="space-y-4">
            <p className="text-slate-300">
              You are about to transfer ownership of <strong>{transferState.component.name}</strong>.
            </p>
            {transferState.oldAssignment && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="text-sm text-red-300">
                  <span className="font-semibold block mb-1">M6 Transfer Warning:</span>
                  This resource is currently owned by {transferState.oldAssignment.scope === "COMPLEX" ? "the Complex" : transferState.oldAssignment.ghId}.
                  Transferring it may invalidate schedules or capabilities in the old owner's domain.
                  <br /><br />
                  <strong className="text-red-200 block mt-2">Physical Move Instructions:</strong> 
                  Please ensure the hardware is physically re-wired to the target location if necessary before confirming this transfer.
                </div>
              </div>
            )}
            <p className="text-sm text-slate-400">
              Transferring will create a new staged Configuration. You must commit the configuration on the ESP32 for it to take effect.
            </p>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
