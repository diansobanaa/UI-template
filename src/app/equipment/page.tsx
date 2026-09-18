"use client";

import { useState, useEffect } from "react";
import { Wrench } from "lucide-react";
import { hardwareService } from "@/lib/services";
import { InstalledComponent, SupportedComponentDefinition } from "@/lib/types/equipment";
import { InstalledComponentsList } from "@/components/ui/equipment/InstalledComponentsList";
import { SupportedCatalogList } from "@/components/ui/equipment/SupportedCatalogList";

export default function EquipmentPage() {
  const [activeTab, setActiveTab] = useState<"installed" | "catalog">("installed");
  const [catalog, setCatalog] = useState<SupportedComponentDefinition[]>([]);
  const [installed, setInstalled] = useState<InstalledComponent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [catData, instData] = await Promise.all([
        hardwareService.getSupportedCatalog(),
        hardwareService.getInstalledComponents()
      ]);
      setCatalog(catData);
      setInstalled(instData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8 space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
          <Wrench className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Hardware Management</h1>
          <p className="text-sm text-slate-400">Manage supported catalog and installed components</p>
        </div>
      </div>

      <div className="border-b border-slate-700/50">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab("installed")}
            className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium ${
              activeTab === "installed"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:border-slate-300 hover:text-slate-300"
            }`}
          >
            Installed Components ({installed.length})
          </button>
          <button
            onClick={() => setActiveTab("catalog")}
            className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium ${
              activeTab === "catalog"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:border-slate-300 hover:text-slate-300"
            }`}
          >
            Supported Catalog ({catalog.length})
          </button>
        </nav>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading...</div>
        ) : activeTab === "installed" ? (
          <InstalledComponentsList components={installed} catalog={catalog} onRefresh={loadData} />
        ) : (
          <SupportedCatalogList catalog={catalog} />
        )}
      </div>
    </div>
  );
}
