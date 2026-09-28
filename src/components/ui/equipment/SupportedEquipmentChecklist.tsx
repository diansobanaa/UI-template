import { useState, useEffect, useMemo } from "react";
import { Check, Cpu, Power, CheckCircle2, RotateCcw, AlertTriangle, Lock, Building2, Warehouse, X, Sparkles, Layers, Droplets, Info } from "lucide-react";
import { CANONICAL_GPIO_PIN_MAP } from "@/lib/data/gpioPinMap";
import type { InstalledComponent, ConfigurationPayload } from "@/lib/api/contracts";
import { Greenhouse } from "@/lib/types";
import { hardwareService, complexService } from "@/lib/services";

interface SupportedEquipmentChecklistProps {
  complexId: string;
  greenhouses: Greenhouse[];
  installedComponents: InstalledComponent[];
  activeVersion?: number;
  onRefresh: () => Promise<void>;
}

function extractAppliedState(
  installedComponents: InstalledComponent[],
  greenhouses: Greenhouse[]
): { pins: Set<number>; assignments: Record<number, string | null> } {
  const pins = new Set<number>();
  const assignments: Record<number, string | null> = {};

  if (installedComponents && installedComponents.length > 0) {
    installedComponents.forEach((c) => {
      const gpio = c.wiring?.gpio;
      if (gpio != null && gpio >= 0) {
        if (c.lifecycleState !== "DISABLED" && c.lifecycleState !== "REMOVED") {
          pins.add(gpio);
        }
        assignments[gpio] = c.assignment?.ghId ?? null;
      }
    });
  } else {
    // Default baseline if no components installed yet
    CANONICAL_GPIO_PIN_MAP.forEach((item) => {
      if (item.equipment?.defaultActive) {
        pins.add(item.gpio);
        if (item.equipment.scope === "PER_GH" && greenhouses.length > 0) {
          assignments[item.gpio] = greenhouses[0].id;
        } else {
          assignments[item.gpio] = null;
        }
      }
    });
  }
  return { pins, assignments };
}

export function SupportedEquipmentChecklist({
  complexId,
  greenhouses,
  installedComponents,
  activeVersion,
  onRefresh,
}: SupportedEquipmentChecklistProps) {
  // 1. APPLIED STATE: Authoritative state loaded from ESP32 on startup/refresh
  const initialApplied = useMemo(
    () => extractAppliedState(installedComponents, greenhouses),
    [installedComponents, greenhouses]
  );
  const [appliedPins, setAppliedPins] = useState<Set<number>>(initialApplied.pins);
  const [appliedAssignments, setAppliedAssignments] = useState<Record<number, string | null>>(initialApplied.assignments);

  // 2. DRAFT STATE: Temporary UI editing state in browser RAM only
  // MUST NOT be persisted to localStorage, sessionStorage, cookies, IndexedDB, Cache API
  // MUST NOT be sent to ESP32 on every checkbox click
  const [draftPins, setDraftPins] = useState<Set<number>>(new Set(initialApplied.pins));
  const [draftAssignments, setDraftAssignments] = useState<Record<number, string | null>>({ ...initialApplied.assignments });

  const [locationFilter, setLocationFilter] = useState<"ALL" | "SHARED" | string>("ALL");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Sync state when installedComponents or complexId changes (e.g. after refresh or complex switch)
  // Per REFRESH BEHAVIOR: discard unsaved draft, load authoritative applied configuration from ESP32
  useEffect(() => {
    const { pins, assignments } = extractAppliedState(installedComponents, greenhouses);
    setAppliedPins(pins);
    setAppliedAssignments(assignments);
    // Transient draft is initialized exclusively from applied ESP32 state
    setDraftPins(new Set(pins));
    setDraftAssignments({ ...assignments });
    setLocationFilter("ALL");
  }, [installedComponents, complexId]);

  // Determine if there are unsaved draft changes in RAM
  const hasUnsavedChanges = useMemo(() => {
    if (draftPins.size !== appliedPins.size) return true;
    for (const p of draftPins) {
      if (!appliedPins.has(p)) return true;
    }
    for (const [gpioStr, ghId] of Object.entries(draftAssignments)) {
      const gpio = Number(gpioStr);
      if (draftPins.has(gpio) && (appliedAssignments[gpio] ?? null) !== (ghId ?? null)) {
        return true;
      }
    }
    return false;
  }, [draftPins, appliedPins, draftAssignments, appliedAssignments]);

  // Checkbox toggle: modifies DRAFT in RAM only. ZERO network requests!
  const togglePin = (gpio: number) => {
    setDraftPins((prev) => {
      const next = new Set(prev);
      if (next.has(gpio)) {
        next.delete(gpio);
      } else {
        next.add(gpio);
      }
      return next;
    });
    setFeedback(null);
  };

  // Assignment change: modifies DRAFT in RAM only. ZERO network requests!
  const changeAssignment = (gpio: number, ghId: string | null) => {
    setDraftAssignments((prev) => ({
      ...prev,
      [gpio]: ghId,
    }));
    setFeedback(null);
  };

  // Check all actuators: modifies DRAFT in RAM only
  const handleSelectAllActuators = () => {
    setDraftPins((prev) => {
      const next = new Set(prev);
      CANONICAL_GPIO_PIN_MAP.forEach((item) => {
        if (item.category === "ACTUATOR" && item.selectable) {
          next.add(item.gpio);
        }
      });
      return next;
    });
    setFeedback(null);
  };

  // Reset standard baseline: modifies DRAFT in RAM only
  const handleResetBaseline = () => {
    const baseline = new Set<number>();
    const assignMap: Record<number, string | null> = {};

    CANONICAL_GPIO_PIN_MAP.forEach((item) => {
      if (item.equipment?.defaultActive) {
        baseline.add(item.gpio);
        if (item.equipment.scope === "PER_GH" && greenhouses.length > 0) {
          assignMap[item.gpio] = greenhouses[0].id;
        } else {
          assignMap[item.gpio] = null;
        }
      }
    });

    setDraftPins(baseline);
    setDraftAssignments(assignMap);
    setFeedback(null);
  };

  // CANCEL: Discard draft and revert back to authoritative applied state in RAM
  const handleCancel = () => {
    setDraftPins(new Set(appliedPins));
    setDraftAssignments({ ...appliedAssignments });
    setFeedback(null);
  };

  // APPLY: Send ONE authoritative mutation to ESP32
  const handleApply = async () => {
    const targetComplexId = complexId || complexService.list()[0]?.id || "complex-01";
    if (!targetComplexId) {
      setFeedback({ type: "error", message: "Tidak ada complex aktif untuk menerapkan konfigurasi." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const componentsToDeploy: InstalledComponent[] = [];

      CANONICAL_GPIO_PIN_MAP.forEach((item) => {
        if (!item.equipment || !item.selectable) return;
        const isReady = draftPins.has(item.gpio);
        const assignedGhId =
          draftAssignments[item.gpio] ??
          (item.equipment.scope === "PER_GH" && greenhouses.length > 0 ? greenhouses[0].id : null);

        componentsToDeploy.push({
          componentId: item.equipment.componentId,
          name: item.equipment.name,
          supportedTypeId: item.equipment.supportedTypeId,
          role: item.equipment.role,
          lifecycleState: isReady ? "COMMISSIONED" : "DISABLED",
          deploymentStatus: "APPLIED",
          assignment: {
            complexId: targetComplexId,
            ...(assignedGhId ? { ghId: assignedGhId } : {}),
          },
          wiring: {
            interface: "GPIO",
            gpio: item.gpio,
            polarity: item.equipment.polarity,
          },
          parameters: item.equipment.parameters || {},
        });
      });

      // Preserve any non-GPIO/external components already installed
      if (installedComponents) {
        installedComponents.forEach((comp) => {
          if (comp.wiring?.interface !== "GPIO" || comp.wiring?.gpio === undefined) {
            if (!componentsToDeploy.some((c) => c.componentId === comp.componentId)) {
              componentsToDeploy.push(comp);
            }
          }
        });
      }

      const payload: ConfigurationPayload = {
        complexId: targetComplexId,
        version: activeVersion && activeVersion > 0 && activeVersion < 1000000 ? activeVersion : 0,
        updatedAt: new Date().toISOString(),
        components: componentsToDeploy,
        assignments: [],
        schedules: [],
        recipes: [],
        topology: [],
        settings: {},
      };

      // Exactly ONE authoritative mutation to ESP32
      const saved = await hardwareService.saveConfiguration(targetComplexId, payload);

      // On success: ESP32 response becomes the new applied state
      const { pins: newAppliedPins, assignments: newAppliedAssigns } = extractAppliedState(
        saved.components || componentsToDeploy,
        greenhouses
      );

      setAppliedPins(newAppliedPins);
      setAppliedAssignments(newAppliedAssigns);
      setDraftPins(new Set(newAppliedPins));
      setDraftAssignments({ ...newAppliedAssigns });

      setFeedback({
        type: "success",
        message: `Konfigurasi peralatan berhasil diterapkan ke controller ${targetComplexId} (v${saved.version || "aktif"})!`,
      });

      // Asynchronously refresh parent data without blocking the apply feedback
      onRefresh().catch(console.error);
    } catch (err: any) {
      console.error("[EquipmentChecklist.handleApply]", err);
      // On failure: keep old applied state authoritative, keep draft in UI so operator can correct it
      setFeedback({
        type: "error",
        message: `Gagal menerapkan konfigurasi ke ESP32: ${err?.message || "Kesalahan koneksi / waktu habis"}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const allSelectableItems = useMemo(
    () => CANONICAL_GPIO_PIN_MAP.filter((p) => p.selectable && p.equipment),
    []
  );

  const filteredItems = useMemo(() => {
    if (locationFilter === "ALL") return allSelectableItems;
    if (locationFilter === "SHARED") {
      return allSelectableItems.filter((p) => !draftAssignments[p.gpio]);
    }
    return allSelectableItems.filter((p) => draftAssignments[p.gpio] === locationFilter);
  }, [allSelectableItems, locationFilter, draftAssignments]);

  const sharedCount = allSelectableItems.filter((p) => !draftAssignments[p.gpio] && draftPins.has(p.gpio)).length;
  const totalActive = Array.from(draftPins).filter((gpio) =>
    CANONICAL_GPIO_PIN_MAP.some((p) => p.gpio === gpio && p.selectable)
  ).length;

  const systemItems = CANONICAL_GPIO_PIN_MAP.filter((p) => p.category === "SYSTEM_RESERVED");

  return (
    <div className="space-y-8">
      {/* Top Banner & Action Bar */}
      <div className="rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900 via-slate-800/80 to-slate-900 p-6 shadow-xl backdrop-blur-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-blue-400" />
              <h2 className="text-xl font-bold text-white tracking-wide">Supported Equipment Checklist</h2>
              {hasUnsavedChanges && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                  Draft Belum Diterapkan
                </span>
              )}
            </div>
            <p className="text-sm text-slate-400">
              Konfigurasi perangkat keras panel untuk <strong className="text-slate-200">{complexId}</strong>. Centang peralatan (Draft), lalu tekan <strong className="text-blue-300">Terapkan (Apply)</strong> untuk menyimpan ke ESP32.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/20">
                <Power className="w-3.5 h-3.5" />
                {totalActive} of {allSelectableItems.length} Terminals Active (Draft)
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                <Building2 className="w-3 h-3 text-blue-400" />
                Shared: {sharedCount}
              </span>
              {greenhouses.map((g) => {
                const count = allSelectableItems.filter(
                  (p) => draftAssignments[p.gpio] === g.id && draftPins.has(p.gpio)
                ).length;
                return (
                  <span
                    key={g.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/40 text-emerald-300 border border-emerald-800/30"
                  >
                    <Warehouse className="w-3 h-3 text-emerald-400" />
                    {g.code || g.greenhouseTag || g.id}: {count}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleResetBaseline}
              disabled={isSaving}
              type="button"
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              title="Reset ke setelan standar panel (5 Pompa + Sensor Standar)"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              Reset Baseline
            </button>

            <button
              onClick={handleSelectAllActuators}
              disabled={isSaving}
              type="button"
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              Pilih Semua Aktuator
            </button>

            {/* Cancel Button (Visible/Enabled when there are draft changes) */}
            <button
              onClick={handleCancel}
              disabled={!hasUnsavedChanges || isSaving}
              type="button"
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Batalkan perubahan draft dan kembalikan ke konfigurasi ESP32 saat ini"
            >
              <X className="w-3.5 h-3.5 text-slate-400" />
              Batal (Cancel)
            </button>

            {/* Apply Button */}
            <button
              onClick={handleApply}
              disabled={!hasUnsavedChanges || isSaving}
              type="button"
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed ${
                hasUnsavedChanges
                  ? "bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-blue-600/30 ring-2 ring-blue-400/50 animate-pulse"
                  : "bg-slate-800 text-slate-400 border border-slate-700"
              }`}
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Menerapkan ke ESP32...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  Terapkan (Apply)
                </>
              )}
            </button>
          </div>
        </div>

        {/* Unsaved Changes Banner */}
        {hasUnsavedChanges && (
          <div className="mt-4 p-3.5 rounded-xl border border-amber-500/30 bg-amber-950/30 flex items-center justify-between gap-4 text-sm animate-fade-in">
            <div className="flex items-center gap-2.5 text-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Perubahan belum diterapkan:</strong> Centang peralatan hanya mengubah draft di browser. Tekan{" "}
                <strong>Terapkan (Apply)</strong> untuk menyimpan ke ESP32, atau <strong>Batal</strong> untuk membuang draft.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCancel}
                disabled={isSaving}
                className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={isSaving}
                className="px-3.5 py-1 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors shadow-sm"
              >
                {isSaving ? "Menyimpan..." : "Terapkan (Apply)"}
              </button>
            </div>
          </div>
        )}

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`mt-4 p-4 rounded-xl border flex items-center gap-3 text-sm animate-fade-in ${
              feedback.type === "success"
                ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
                : "bg-red-950/40 border-red-500/30 text-red-300"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            )}
            <p className="flex-1">{feedback.message}</p>
          </div>
        )}
      </div>

      {/* Scope & Location Filter Chips */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <span className="text-xs font-medium text-slate-400 mr-2">Filter Lingkup:</span>

        <button
          type="button"
          onClick={() => setLocationFilter("ALL")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            locationFilter === "ALL"
              ? "bg-blue-600 text-white shadow-sm"
              : "bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          }`}
        >
          Semua Peralatan ({allSelectableItems.length})
        </button>

        <button
          type="button"
          onClick={() => setLocationFilter("SHARED")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
            locationFilter === "SHARED"
              ? "bg-blue-600 text-white shadow-sm"
              : "bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          }`}
        >
          <Building2 className="w-3.5 h-3.5" />
          🏢 Shared Fasilitas Bersama ({allSelectableItems.filter((p) => !draftAssignments[p.gpio]).length})
        </button>

        {greenhouses.map((g) => {
          const count = allSelectableItems.filter((p) => draftAssignments[p.gpio] === g.id).length;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setLocationFilter(g.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                locationFilter === g.id
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              <Warehouse className="w-3.5 h-3.5" />
              🌿 {g.code || g.greenhouseTag || g.id} ({count})
            </button>
          );
        })}
      </div>

      {/* Informative Shared Infrastructure Banner when filtering by specific Greenhouse */}
      {locationFilter !== "ALL" && locationFilter !== "SHARED" && (() => {
        const currentGh = greenhouses.find((g) => g.id === locationFilter);
        const mixingPumpChecked = draftPins.has(40);
        const dosingAChecked = draftPins.has(5);
        const dosingBChecked = draftPins.has(6);
        const wellPumpChecked = draftPins.has(1);

        return (
          <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-r from-blue-950/40 via-slate-900/60 to-slate-900/40 p-4 shadow-sm animate-fade-in space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-blue-500/20 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-white">
                      Tangki Mixing & Fasilitas Bersama (Shared Infrastructure)
                    </h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Aktif Melayani {currentGh?.code || currentGh?.greenhouseTag || locationFilter}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Tangki Mixing (1.000 L) dan aktuator persiapan nutrisi berada di tingkat Fasilitas Bersama (Complex) untuk melayani greenhouse ini saat jadwal fertigasi berjalan.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setLocationFilter("SHARED")}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-300 bg-blue-950/60 hover:bg-blue-900/60 border border-blue-800/40 transition-colors flex items-center gap-1.5 self-start sm:self-auto shrink-0"
              >
                <Building2 className="w-3.5 h-3.5" />
                Buka Tab Fasilitas Bersama
              </button>
            </div>

            {/* Sub-grid of Shared Equipment status for Fertigation */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Kontainer</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Siap</span>
                </div>
                <div className="mt-1">
                  <div className="text-xs font-semibold text-slate-200">Tangki Mixing</div>
                  <div className="text-[10px] text-slate-400">{currentGh?.telemetry?.tankCapacityL || 1000} Liter</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-slate-400">GPIO 40</span>
                  <button
                    type="button"
                    onClick={() => togglePin(40)}
                    disabled={isSaving}
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                      mixingPumpChecked
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
                    }`}
                  >
                    {mixingPumpChecked ? "✓ Ready" : "+ Aktifkan"}
                  </button>
                </div>
                <div className="mt-1">
                  <div className="text-xs font-semibold text-slate-200">Pompa Sirkulasi Mixing</div>
                  <div className="text-[10px] text-slate-400">220V AC (Relay IN4)</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-slate-400">GPIO 5 & 6</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                    dosingAChecked && dosingBChecked
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  }`}>
                    {dosingAChecked && dosingBChecked ? "✓ Ready" : "Sebagian"}
                  </span>
                </div>
                <div className="mt-1">
                  <div className="text-xs font-semibold text-slate-200">Dosing Pupuk A & B</div>
                  <div className="text-[10px] text-slate-400">12V DC Peristaltik</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-slate-400">GPIO 1</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                    wellPumpChecked
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-slate-700 text-slate-400 border-slate-600"
                  }`}>
                    {wellPumpChecked ? "✓ Ready" : "Off"}
                  </span>
                </div>
                <div className="mt-1">
                  <div className="text-xs font-semibold text-slate-200">Pompa Air Baku (Deep Well)</div>
                  <div className="text-[10px] text-slate-400">220V AC Submersible</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Equipment Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredItems.map((item) => {
          const eq = item.equipment!;
          const isChecked = draftPins.has(item.gpio);
          const wasAppliedChecked = appliedPins.has(item.gpio);
          const isModifiedInDraft = isChecked !== wasAppliedChecked;
          const currentGhId = draftAssignments[item.gpio] ?? null;

          return (
            <div
              key={item.gpio}
              className={`rounded-2xl border p-5 transition-all flex flex-col justify-between select-none ${
                isChecked
                  ? isModifiedInDraft
                    ? "border-amber-500/60 bg-slate-800/80 shadow-lg shadow-amber-950/20 ring-1 ring-amber-500/40"
                    : "border-blue-500/50 bg-slate-800/60 shadow-lg shadow-blue-950/20 ring-1 ring-blue-500/20"
                  : isModifiedInDraft
                  ? "border-amber-500/40 bg-slate-900/60 ring-1 ring-amber-500/20"
                  : "border-slate-800/80 bg-slate-900/50 opacity-60 hover:opacity-90 hover:border-slate-700"
              }`}
            >
              <div>
                {/* Header: Pin, Category & Checkbox */}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-blue-300 border border-slate-700">
                        GPIO {item.gpio}
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800/80 text-amber-300 border border-slate-700/50">
                        {eq.voltage}
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/40">
                        {eq.category}
                      </span>
                      {isModifiedInDraft && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          Draft
                        </span>
                      )}
                    </div>
                    <h4 className="text-sm font-semibold text-white mt-1.5">{eq.name}</h4>
                  </div>

                  {/* Toggle Checkbox (RAM Draft Toggle Only — Zero Network Calls) */}
                  <button
                    type="button"
                    onClick={() => togglePin(item.gpio)}
                    disabled={isSaving}
                    title={isChecked ? "Klik untuk menonaktifkan pada draft" : "Klik untuk menandai Ready pada draft"}
                    className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-all cursor-pointer ${
                      isChecked
                        ? "bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-600/30"
                        : "border-slate-600 bg-slate-800 text-transparent hover:border-slate-500"
                    }`}
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                  </button>
                </div>

                <p className="text-xs text-slate-400 mt-2.5 leading-relaxed">{eq.description}</p>
              </div>

              {/* Bottom: Assignment & Terminal info */}
              <div className="mt-5 pt-3 border-t border-slate-800 flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    Terminal: <strong className="text-slate-300">{eq.terminalName}</strong>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`font-semibold px-2 py-0.5 rounded-full ${
                        isChecked
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      {isChecked ? "Ready" : "Not Ready"}
                    </span>
                  </div>
                </div>

                {/* Assignment Selector (Shared vs Per-GH) */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1 shrink-0">
                    {currentGhId ? (
                      <Warehouse className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Building2 className="w-3 h-3 text-blue-400" />
                    )}
                    Alokasi:
                  </span>

                  {eq.scope === "SHARED" ? (
                    <span className="text-[11px] font-medium text-blue-300 bg-blue-950/40 border border-blue-800/30 px-2.5 py-1 rounded-lg">
                      🏢 Shared Facility (Semua GH)
                    </span>
                  ) : (
                    <select
                      value={currentGhId || ""}
                      onChange={(e) => changeAssignment(item.gpio, e.target.value || null)}
                      disabled={isSaving}
                      className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1 outline-none focus:border-blue-500 cursor-pointer"
                    >
                      <option value="">🏢 Shared (Fasilitas Bersama)</option>
                      {greenhouses.map((g) => (
                        <option key={g.id} value={g.id}>
                          🌿 {g.code || g.greenhouseTag || g.id}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Section 3: Dedicated System & Safety Interlocks (Locked) */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-purple-400" />
            <h3 className="text-base font-semibold text-slate-200">System Buses & Mandatory Safety Interlocks</h3>
          </div>
          <span className="text-xs text-purple-400 font-medium">Permanently Protected (Hardware Fixed)</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {systemItems.slice(0, 6).map((item) => (
            <div
              key={item.gpio}
              className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-3.5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-purple-300 border border-slate-700/80">
                    GPIO {item.gpio}
                  </span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/30 flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5" />
                    LOCKED
                  </span>
                </div>
                <h4 className="text-xs font-semibold text-slate-200 mt-2">{item.terminalLabel}</h4>
              </div>
              <p className="text-[11px] text-slate-500 mt-2">{item.disabledReason}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky Bottom Action Bar when there are unsaved draft changes */}
      {hasUnsavedChanges && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 px-6 py-3.5 rounded-2xl border border-amber-500/40 bg-slate-900/95 backdrop-blur-xl shadow-2xl shadow-amber-950/40 animate-fade-in-up">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Ada perubahan draft peralatan</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
            >
              Batal (Cancel)
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:bg-blue-700 shadow-md shadow-blue-600/30 transition-all flex items-center gap-1.5"
            >
              {isSaving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Menerapkan...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5 text-white" />
                  Terapkan ke ESP32 (Apply)
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
