import { SupportedComponentDefinition } from "@/lib/types/equipment";
import { Info, Cpu, Zap, Activity } from "lucide-react";

export function SupportedCatalogList({ catalog }: { catalog: SupportedComponentDefinition[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
      {catalog.map((item) => (
        <div key={item.supportedTypeId} className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-6 flex flex-col gap-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-lg font-semibold text-slate-100">{item.displayName}</h3>
              <p className="text-xs text-slate-400 font-mono mt-1">{item.supportedTypeId}</p>
            </div>
            <span className="px-2 py-1 bg-slate-700 rounded text-xs font-medium text-slate-300">
              {item.category}
            </span>
          </div>

          <div className="space-y-3 flex-grow">
            <div className="flex items-start gap-2 text-sm text-slate-300">
              <Info className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <p>{item.installationGuide.purpose}</p>
            </div>
            <div className="flex items-start gap-2 text-sm text-slate-300">
              <Cpu className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
              <p>Interface: <span className="font-medium text-blue-300">{item.interfaceType}</span> ({item.driverType})</p>
            </div>
            {item.parameterDefinitions.length > 0 && (
              <div className="flex items-start gap-2 text-sm text-slate-300">
                <Zap className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                <p>Params: {item.parameterDefinitions.map(p => p.name).join(", ")}</p>
              </div>
            )}
            <div className="flex items-start gap-2 text-sm text-slate-300">
              <Activity className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-slate-200 mb-1">Capabilities:</p>
                <ul className="list-disc pl-4 space-y-1">
                  {item.supportedCapabilities.map(cap => (
                    <li key={cap.id} className="text-xs text-slate-400">
                      <strong className="text-slate-300">{cap.name}</strong> - {cap.description}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          
          <div className="mt-4 pt-4 border-t border-slate-700/50">
            <button className="w-full py-2 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-sm font-medium text-slate-200 transition-colors">
              View Installation Guide
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
