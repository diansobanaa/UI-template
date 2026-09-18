"use client";

import { useEffect, useState } from "react";
import { esp32Client } from "@/lib/api/esp32-client";
import { GhTopologyState } from "@/lib/api/contracts";
import { Network, CheckCircle2, AlertTriangle, Info, Zap } from "lucide-react";
import { SectionCard } from "@/components/ui/cards";

export function TopologyViewer({ ghId, complexId }: { ghId: string; complexId: string }) {
  const [topology, setTopology] = useState<GhTopologyState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchTopology = async () => {
      try {
        const res = await esp32Client.getTopology();
        if (!mounted) return;
        const ghTopo = res.greenhouses.find(g => g.ghId === ghId);
        if (ghTopo) {
          setTopology(ghTopo);
        }
      } catch (err) {
        console.error("Failed to fetch topology:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchTopology();
    // Poll every 5s just like other status
    const interval = setInterval(fetchTopology, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [ghId, complexId]);

  if (loading && !topology) {
    return (
      <SectionCard title="Topology & Capability Engine" icon={Network} iconTone="blue" className="bg-[#0b2027] border-[--color-line]">
        <div className="p-4 text-center text-sm text-slate-400">Loading topology state...</div>
      </SectionCard>
    );
  }

  if (!topology) {
    return (
      <SectionCard title="Topology & Capability Engine" icon={Network} iconTone="blue" className="bg-[#0b2027] border-[--color-line]">
        <div className="p-4 flex items-start space-x-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="text-sm">No topology data available for this greenhouse. Configure assignments to generate topology.</div>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Topology & Capability Engine" icon={Network} iconTone="blue" className="bg-[#0b2027] border-[--color-line]" subtitle="Deterministic reachability and routability computed by ESP32">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Reachability Status */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-slate-300">Route Availability</h4>
          
          <div className={`p-3 rounded-lg border ${topology.hydraulicallyReachable ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'} flex items-start space-x-3`}>
            {topology.hydraulicallyReachable ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <AlertTriangle className="h-5 w-5 text-red-400" />}
            <div>
              <div className={`text-sm font-medium ${topology.hydraulicallyReachable ? 'text-emerald-400' : 'text-red-400'}`}>
                {topology.hydraulicallyReachable ? "Hydraulically Reachable" : "Not Reachable"}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {topology.hydraulicallyReachable 
                  ? "Path from source tank to destination is valid."
                  : topology.blockingReason || "Missing required physical components (Pump, Source, or Dest)."}
              </div>
            </div>
          </div>

          <div className={`p-3 rounded-lg border ${topology.automaticallyRoutable ? 'bg-emerald-500/10 border-emerald-500/20' : (topology.manuallyRoutable ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-slate-800/50 border-slate-700/50')} flex items-start space-x-3`}>
            {topology.automaticallyRoutable ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <Info className="h-5 w-5 text-yellow-400" />}
            <div>
              <div className={`text-sm font-medium ${topology.automaticallyRoutable ? 'text-emerald-400' : 'text-yellow-400'}`}>
                {topology.automaticallyRoutable ? "Automatically Routable" : (topology.manuallyRoutable ? "Manual Routing Required" : "Cannot Route")}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {topology.automaticallyRoutable 
                  ? "System has automatic valves to switch paths."
                  : topology.manuallyRoutable 
                    ? topology.blockingReason || "Operator physical connection is required." 
                    : "Path is neither automatic nor manually routable."}
              </div>
              {topology.manuallyRoutable && (
                <div className="mt-2 text-[10px] text-yellow-500 bg-yellow-500/10 p-2 rounded">
                  <strong>Note:</strong> Operator confirmation does not prove physical connection.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Capabilities */}
        <div>
          <h4 className="text-sm font-medium text-slate-300 mb-3">Derived Capabilities</h4>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(topology.capabilities).map(([key, val]) => (
              <div key={key} className={`p-2 rounded border text-xs font-medium flex items-center justify-between ${val ? 'bg-blue-500/10 border-blue-500/30 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-500 opacity-60'}`}>
                <span className="truncate pr-2">{key.replace("CAN_", "")}</span>
                {val ? <CheckCircle2 className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border border-slate-600" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
