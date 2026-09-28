import { useState, useEffect, Suspense } from "react";
import { Wrench } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AppShell, PageTitleBlock } from "@/components/layout/AppShell";
import { complexService, greenhouseService, hardwareService } from "@/lib/services";
import { useDbVersion } from "@/lib/useDb";
import { hardwareCatalog } from "@/lib/data/hardwareCatalog";
import { InstalledComponent, SupportedComponentDefinition } from "@/lib/types/equipment";
import { InstalledComponentsList } from "@/components/ui/equipment/InstalledComponentsList";
import { SupportedCatalogList } from "@/components/ui/equipment/SupportedCatalogList";
import { SupportedEquipmentChecklist } from "@/components/ui/equipment/SupportedEquipmentChecklist";
import { ComplexSwitcher } from "@/components/layout/bits";

export default function EquipmentPage() {
  return (
    <Suspense fallback={null}>
      <EquipmentContent />
    </Suspense>
  );
}

function EquipmentContent() {
  useDbVersion();
  const [params] = useSearchParams();
  const availableComplexes = complexService.list();
  const rawComplexId = (params.get("complex") ?? "").trim();
  const activeComplex = (rawComplexId ? availableComplexes.find((c) => c.id === rawComplexId) : null) ?? availableComplexes[0];
  const complexId = activeComplex?.id ?? "complex-01";
  const ghs = complexId ? greenhouseService.byComplex(complexId) : [];

  const [activeTab, setActiveTab] = useState<"checklist" | "installed" | "catalog">("checklist");
  const [catalog, setCatalog] = useState<SupportedComponentDefinition[]>(hardwareCatalog);
  const [installed, setInstalled] = useState<InstalledComponent[]>([]);
  const [deployment, setDeployment] = useState<{ status: string; activeVersion: number; candidateVersion: number; previousVersion: number; deploymentId?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const catData = await hardwareService.getSupportedCatalog().catch(() => hardwareCatalog);
      setCatalog(catData && catData.length > 0 ? catData : hardwareCatalog);

      const instData = await hardwareService.getInstalledComponents(complexId).catch(() => []);
      setInstalled(instData);

      try {
        const dep = await hardwareService.getConfigurationDeployment().catch(() => null);
        setDeployment(dep as any);
      } catch {
        setDeployment(null);
      }
    } catch (e) {
      console.error(e);
      setCatalog(hardwareCatalog);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [complexId]);

  return (
    <AppShell complexId={complexId}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <PageTitleBlock
              title="Hardware Management"
              subtitle={`Controller: ${activeComplex?.name || activeComplex?.code || complexId} · ${ghs.length} Greenhouse${ghs.length === 1 ? "" : "s"}`}
            />
          </div>
          <div className="flex items-center gap-3">
            <ComplexSwitcher complexId={complexId} complexes={availableComplexes} />
          </div>
        </div>

      {deployment && (
        <div className={`rounded-xl border p-4 ${deployment.status === "ACTIVE" || deployment.status === "ROLLED_BACK" ? "border-emerald-500/20 bg-emerald-500/5" : deployment.status === "CANDIDATE_STAGED" ? "border-amber-500/20 bg-amber-500/5" : "border-rose-500/20 bg-rose-500/5"}`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Configuration Deployment</div>
              <div className="mt-1 text-sm font-semibold text-slate-100">{deployment.status}</div>
              <div className="mt-1 text-xs text-slate-400">Active v{deployment.activeVersion} · Candidate v{deployment.candidateVersion} · Previous v{deployment.previousVersion}</div>
            </div>
            {deployment.deploymentId && <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-[10px] font-mono text-slate-300">{deployment.deploymentId}</span>}
          </div>
        </div>
      )}

      <div className="border-b border-slate-700/50">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab("checklist")}
            className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium ${
              activeTab === "checklist"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:border-slate-300 hover:text-slate-300"
            }`}
          >
            Supported Equipment (Pin Map)
          </button>
          <button
            onClick={() => setActiveTab("installed")}
            className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium ${
              activeTab === "installed"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:border-slate-300 hover:text-slate-300"
            }`}
          >
            Active Inventory ({installed.length})
          </button>
          <button
            onClick={() => setActiveTab("catalog")}
            className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium ${
              activeTab === "catalog"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:border-slate-300 hover:text-slate-300"
            }`}
          >
            Hardware Catalog ({catalog.length})
          </button>
        </nav>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading...</div>
        ) : activeTab === "checklist" ? (
          <SupportedEquipmentChecklist 
            complexId={complexId} 
            greenhouses={ghs}
            installedComponents={installed} 
            activeVersion={deployment?.activeVersion ?? (deployment as any)?.configurationVersion}
            onRefresh={() => loadData(true)} 
          />
        ) : activeTab === "installed" ? (
          <InstalledComponentsList 
            components={installed} 
            catalog={catalog} 
            complexId={complexId}
            greenhouses={ghs}
            onRefresh={loadData} 
          />
        ) : (
          <SupportedCatalogList catalog={catalog} />
        )}
      </div>
    </div>
    </AppShell>
  );
}
