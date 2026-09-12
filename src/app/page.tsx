"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import {
  Activity,
  Camera,
  Maximize2,
  Apple,
  Beaker,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Droplets,
  FlaskConical,
  History,
  Info,
  Leaf,
  Plus,
  RotateCcw,
  Sprout,
  Settings,
  Sun,
  Thermometer,
  Trash2,
  TrendingDown,
  TrendingUp,
  Waves,
  Wind,
  Wheat,
  Wrench,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { SectionCard, ViewAllButton } from "@/components/ui/cards";
import { Badge, Button, FieldError, Input, Label, Progress, StatusBadge, Textarea } from "@/components/ui/primitives";
import { AreaChart, DualLineChart, Donut } from "@/components/ui/charts";
import { GreenhouseArt } from "@/components/ui/GreenhouseArt";
import { ConfirmDialog, Modal } from "@/components/ui/overlay";
import { ScheduleContent } from "@/app/schedule/page";
import { useToast } from "@/components/ui/toast";
import { complexService, cropCycleService, fertigationService, greenhouseService } from "@/lib/services";
import { useDbVersion } from "@/lib/useDb";
import { formatIndoDate, processCropCycle } from "@/lib/cropCycleProcessor";
import { errorMessage } from "@/lib/errors";
import { number, required } from "@/lib/validation";
import { environmentMetrics, fruitDevFor } from "@/lib/data/environment";
import { delta, lux, n } from "@/lib/format";
import type { RangeId } from "./range-types";
import { greenhouseRealtimeState } from "@/lib/realtime";
import { LiveStatus } from "@/components/ui/LiveStatus";
import type { Greenhouse } from "@/lib/types";
import { CropCycleModals } from "@/components/ui/CropCycleModals";

const RANGE_OPTIONS: { id: RangeId; label: string }[] = [
  { id: "24H", label: "24 Hours" },
  { id: "7D", label: "7 Days" },
  { id: "30D", label: "30 Days" },
];

const METRIC_TABS = [
  { id: "temperature", label: "Temperature" },
  { id: "humidity", label: "Humidity" },
  { id: "light", label: "Light" },
  { id: "tank", label: "Water/Tank Level" },
  { id: "fertigation", label: "Fertigation" },
] as const;

interface CropCycleTimelineProps {
  gh: Greenhouse;
  onRefresh?: () => void;
  className?: string;
  manageOpen?: boolean;
  onManageOpenChange?: (open: boolean) => void;
  display?: "full" | "cards" | "timeline";
}

type TimelinePoint = {
  id: string;
  name: string;
  startHst: number;
  endHst: number;
  note: string;
};

type MaintenancePoint = {
  id: string;
  name: string;
  hst: number;
  category: string;
  note: string;
};

type SavedTimelineConfig = {
  targetHarvestHst: number;
  points: TimelinePoint[];
  maintenance?: MaintenancePoint[];
};

const timelineStorageKey = (ghId: string) => `greenhouse-crop-timeline:${ghId}`;

const timelineDateAtHst = (tanggalTanam: string | null | undefined, hstValue: number) => {
  if (!tanggalTanam || !Number.isFinite(hstValue)) return null;
  const date = new Date(`${tanggalTanam}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + Math.max(0, Math.round(hstValue)));
  return date.toISOString().slice(0, 10);
};

const defaultMaintenancePoints = (): MaintenancePoint[] => [];

const defaultTimelinePoints = (): TimelinePoint[] => [
  { id: "seed", name: "Semai", startHst: 0, endHst: 10, note: "" },
  { id: "vegetative", name: "Vegetatif", startHst: 11, endHst: 25, note: "" },
  { id: "flowering", name: "Berbunga", startHst: 26, endHst: 45, note: "" },
  { id: "fruiting", name: "Pembuahan", startHst: 46, endHst: 65, note: "" },
  { id: "ripening", name: "Pematangan", startHst: 66, endHst: 85, note: "" },
  { id: "harvest", name: "Panen", startHst: 86, endHst: 90, note: "" },
];

export function CropCycleTimeline({
  gh,
  onRefresh,
  className = "",
  manageOpen: controlledManageOpen,
  onManageOpenChange,
  display = "full",
}: CropCycleTimelineProps) {
  const toast = useToast();
  const cycle = gh.cropCycle ?? {
    status: "NO_CYCLE",
    tanggalTanam: null,
    tanggalPolinasi: null,
  };

  const [startNormalOpen, setStartNormalOpen] = useState(false);
  const [startOngoingOpen, setStartOngoingOpen] = useState(false);
  const [polinasiOpen, setPolinasiOpen] = useState(false);
  const [internalManageOpen, setInternalManageOpen] = useState(false);
  const manageOpen = controlledManageOpen ?? internalManageOpen;
  const setManageOpen = (open: boolean) => {
    setInternalManageOpen(open);
    onManageOpenChange?.(open);
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ ghId?: string }>).detail;
      if (detail?.ghId === gh.id) setManageOpen(true);
    };
    window.addEventListener("crop-cycle-open-manage", handler);
    return () => window.removeEventListener("crop-cycle-open-manage", handler);
  }, [gh.id]);
  const [harvestOpen, setHarvestOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const handleStartCycle = async (
    tanggalTanam: string,
    options?: { variety?: string; plantCount?: number; notes?: string }
  ) => {
    try {
      await cropCycleService.startCycle(gh.id, tanggalTanam, options);
      toast(`Siklus tanam dimulai untuk ${gh.code}.`, "success");
      onRefresh?.();
    } catch (err) { toast(errorMessage(err), "error"); throw err; }
  };

  const handleStartOngoingCycle = async (
    tanggalTanam: string,
    options?: { variety?: string; plantCount?: number; tanggalPolinasi?: string; notes?: string }
  ) => {
    try {
      await cropCycleService.startOngoingCycle(gh.id, tanggalTanam, options);
      toast(`Siklus berjalan berhasil disimpan.`, "success");
      onRefresh?.();
    } catch (err) { toast(errorMessage(err), "error"); throw err; }
  };

  const handleRecordPolinasi = async (
    tanggalPolinasi: string,
    options?: { pollinationMethod?: "natural" | "bee" | "manual"; notes?: string }
  ) => {
    try {
      await cropCycleService.recordPolinasi(gh.id, tanggalPolinasi, options);
      toast(`Tanggal polinasi dicatat. HSP aktif.`, "success");
      onRefresh?.();
    } catch (err) { toast(errorMessage(err), "error"); throw err; }
  };

  const handleUpdateTanggalTanam = async (newDate: string) => {
    try {
      await cropCycleService.updateTanggalTanam(gh.id, newDate);
      toast(`Tanggal tanam diperbarui. HST disesuaikan.`, "success");
      onRefresh?.();
    } catch (err) { toast(errorMessage(err), "error"); throw err; }
  };

  const handleUpdateTanggalPolinasi = async (
    newDate: string,
    options?: { pollinationMethod?: "natural" | "bee" | "manual" }
  ) => {
    try {
      await cropCycleService.updateTanggalPolinasi(gh.id, newDate, options);
      toast(`Tanggal polinasi diperbarui. HSP disesuaikan.`, "success");
      onRefresh?.();
    } catch (err) { toast(errorMessage(err), "error"); throw err; }
  };

  const handleUpdateMetadata = async (updates: { variety?: string; plantCount?: number; notes?: string }) => {
    try {
      await cropCycleService.updateMetadata(gh.id, updates);
      toast(`Data tanaman diperbarui.`, "success");
      onRefresh?.();
    } catch (err) { toast(errorMessage(err), "error"); throw err; }
  };

  const handleDeleteTanggalPolinasi = async () => {
    try {
      await cropCycleService.deleteTanggalPolinasi(gh.id);
      toast(`Tanggal polinasi dihapus. HSP direset.`, "info");
      onRefresh?.();
    } catch (err) { toast(errorMessage(err), "error"); throw err; }
  };

  const handleResetCycle = async () => {
    try {
      await cropCycleService.resetCycle(gh.id);
      toast(`Siklus tanam dibatalkan.`, "info");
      onRefresh?.();
    } catch (err) { toast(errorMessage(err), "error"); throw err; }
  };

  const handleHarvest = async (options?: {
    harvestDate?: string; yieldKg?: number; grade?: string; notes?: string;
  }) => {
    try {
      await cropCycleService.harvest(gh.id, options);
      toast(`Siklus panen ${gh.code} selesai dicatat.`, "success");
      onRefresh?.();
    } catch (err) { toast(errorMessage(err), "error"); throw err; }
  };

  const metrics = processCropCycle(gh);
  const hst = metrics.hst;
  const hsp = metrics.hsp;

  const [timelineConfig, setTimelineConfig] = useState<SavedTimelineConfig | null>(null);
  useEffect(() => {
    const load = () => {
      try {
        const raw = window.localStorage.getItem(timelineStorageKey(gh.id));
        if (!raw) {
          setTimelineConfig(null);
          return;
        }
        const saved = JSON.parse(raw) as SavedTimelineConfig;
        if (
          Number.isFinite(Number(saved.targetHarvestHst)) &&
          Number(saved.targetHarvestHst) > 0 &&
          Array.isArray(saved.points) &&
          saved.points.length
        ) {
          setTimelineConfig({
            targetHarvestHst: Number(saved.targetHarvestHst),
            points: saved.points
              .map((point) => ({
                ...point,
                startHst: Number(point.startHst),
                endHst: Number(point.endHst),
              }))
              .filter(
                (point) =>
                  point.name?.trim() &&
                  Number.isFinite(point.startHst) &&
                  Number.isFinite(point.endHst)
              ),
            maintenance: Array.isArray(saved.maintenance)
              ? saved.maintenance
                  .map((item) => ({
                    ...item,
                    hst: Number(item.hst),
                    name: String(item.name ?? ""),
                    category: String(item.category ?? "Lainnya"),
                    note: String(item.note ?? ""),
                  }))
                  .filter((item) => item.name.trim() && Number.isFinite(item.hst))
              : defaultMaintenancePoints(),
          });
        } else {
          setTimelineConfig(null);
        }
      } catch {
        setTimelineConfig(null);
      }
    };
    load();
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ ghId?: string; config?: SavedTimelineConfig }>).detail;
      if (detail?.ghId !== gh.id || !detail.config) return;
      const saved = detail.config;
      if (
        Number.isFinite(saved.targetHarvestHst) &&
        saved.targetHarvestHst > 0 &&
        Array.isArray(saved.points) &&
        saved.points.length
      ) {
        setTimelineConfig({
          targetHarvestHst: saved.targetHarvestHst,
          points: saved.points.map((point) => ({
            ...point,
            startHst: Number(point.startHst),
            endHst: Number(point.endHst),
          })),
          maintenance: Array.isArray(saved.maintenance)
            ? saved.maintenance
                .map((item) => ({
                  ...item,
                  hst: Number(item.hst),
                  name: String(item.name ?? ""),
                  category: String(item.category ?? "Lainnya"),
                  note: String(item.note ?? ""),
                }))
                .filter((item) => item.name.trim() && Number.isFinite(item.hst))
            : defaultMaintenancePoints(),
        });
      } else {
        load();
      }
    };
    window.addEventListener("crop-timeline-config-updated", onUpdated);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("crop-timeline-config-updated", onUpdated);
      window.removeEventListener("storage", load);
    };
  }, [gh.id]);

  const phases = useMemo(() => {
    const points = timelineConfig?.points ?? defaultTimelinePoints();
    return [...points].sort((a, b) => a.startHst - b.startHst);
  }, [timelineConfig]);
  const totalHst = Math.max(1, timelineConfig?.targetHarvestHst ?? phases[phases.length - 1]?.endHst ?? 90);
  const currentPhase = phases.find((phase) => hst >= phase.startHst && hst <= phase.endHst) ?? null;
  const hariLagi = Math.max(0, totalHst - hst);

  const getVisuals = (id: string, isEnd?: boolean) => {
    if (isEnd) return { color: "text-amber-400", border: "border-amber-400", bg: "bg-amber-400", icon: Wheat, desc: "Target akhir siklus" };
    if (id === "seed") return { color: "text-emerald-400", border: "border-emerald-400", bg: "bg-emerald-400", icon: Sprout, desc: "Awal siklus tanam" };
    if (id === "vegetative") return { color: "text-lime-400", border: "border-lime-400", bg: "bg-lime-400", icon: Leaf, desc: "Pertumbuhan daun dan batang" };
    if (id === "flowering") return { color: "text-pink-400", border: "border-pink-400", bg: "bg-pink-400", icon: Sun, desc: "Mulai muncul bunga" };
    if (id === "fruiting") return { color: "text-teal-400", border: "border-teal-400", bg: "bg-teal-400", icon: Apple, desc: "Fase pertumbuhan buah (46 – 65)" };
    if (id === "ripening") return { color: "text-blue-400", border: "border-blue-400", bg: "bg-blue-400", icon: Apple, desc: "Buah mulai matang" };
    if (id.startsWith("maintenance:")) return { color: "text-amber-300", border: "border-amber-300", bg: "bg-amber-300", icon: Wrench, desc: "Rencana jadwal perawatan" };
    return { color: "text-white", border: "border-white", bg: "bg-white", icon: Sprout, desc: "" };
  };

  const renderPoints = phases.map((p) => ({
    id: p.id,
    name: p.name,
    hst: p.startHst,
    isEnd: false,
    note: p.note,
  }));
  const maintenancePoints = useMemo(() =>
    (timelineConfig?.maintenance ?? defaultMaintenancePoints())
      .filter((item) => Number.isFinite(item.hst) && item.hst >= 0 && item.hst <= totalHst && item.name?.trim())
      .sort((a, b) => a.hst - b.hst),
    [timelineConfig, totalHst],
  );

  const lastPhase = phases[phases.length - 1];
  if (lastPhase) {
    renderPoints.push({
      id: "target_harvest",
      name: "Target Panen",
      hst: totalHst,
      isEnd: true,
      note: "Target akhir siklus",
    });
  }

  const realPos = Math.min(100, Math.max(0, (hst / totalHst) * 100));

  // Layout collision PROJECTION dihitung dari ukuran DOM yang sebenarnya.
  // Tidak ada lebar label / jarak antar titik / jumlah lane yang di-hardcode.
  const projectionLabelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const maintenanceLabelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [projectionLabelLanes, setProjectionLabelLanes] = useState<number[]>([]);
  const [projectionLabelLaneStep, setProjectionLabelLaneStep] = useState(0);
  const [maintenanceLabelLanes, setMaintenanceLabelLanes] = useState<number[]>([]);
  const [maintenanceLabelLaneStep, setMaintenanceLabelLaneStep] = useState(0);
  type TimelineVisual = {
    color: string;
    border: string;
    bg: string;
    icon: typeof Sprout;
    desc: string;
  };
  const [activeTimelineTooltip, setActiveTimelineTooltip] = useState<{
    kind: "phase" | "projection" | "maintenance" | "real";
    rect: DOMRect;
    point?: TimelinePoint & { hst: number; isEnd: boolean; note: string };
    phase?: TimelinePoint;
    dateStr?: string;
    visual?: TimelineVisual;
    isTanam?: boolean;
  } | null>(null);

  const showTimelineTooltip = (payload: NonNullable<typeof activeTimelineTooltip>) => {
    setActiveTimelineTooltip(payload);
  };

  const hideTimelineTooltip = () => setActiveTimelineTooltip(null);

  useLayoutEffect(() => {
    const calculateProjectionLanes = () => {
      const measured = renderPoints
        .map((pt, index) => {
          const el = projectionLabelRefs.current[index];
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            index,
            left: rect.left,
            right: rect.right,
            height: rect.height,
          };
        })
        .filter((item): item is { index: number; left: number; right: number; height: number } => item !== null)
        .sort((a, b) => a.left - b.left);

      if (!measured.length) {
        if (projectionLabelLanes.length) setProjectionLabelLanes([]);
        return;
      }

      const gap = Math.max(8, measured.reduce((sum, item) => sum + item.height, 0) / measured.length * 0.2);
      const laneBottoms: number[] = [];
      const lanes = Array(renderPoints.length).fill(0);

      for (const item of measured) {
        let lane = 0;
        while (laneBottoms[lane] !== undefined && item.left < laneBottoms[lane] + gap) {
          lane += 1;
        }
        lanes[item.index] = lane;
        laneBottoms[lane] = item.right;
      }

      const tallestLabel = Math.max(...measured.map((item) => item.height));
      const laneStep = tallestLabel + gap;

      setProjectionLabelLaneStep((prev) => (Math.abs(prev - laneStep) < 0.5 ? prev : laneStep));
      setProjectionLabelLanes((prev) =>
        prev.length === lanes.length && prev.every((lane, index) => lane === lanes[index]) ? prev : lanes,
      );
    };

    const frame = requestAnimationFrame(calculateProjectionLanes);
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(calculateProjectionLanes)
      : null;

    projectionLabelRefs.current.forEach((el) => el && resizeObserver?.observe(el));
    window.addEventListener("resize", calculateProjectionLanes);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", calculateProjectionLanes);
    };
  }, [renderPoints, totalHst]);

  useLayoutEffect(() => {
    const calculateMaintenanceLanes = () => {
      const measured = maintenancePoints
        .map((item, index) => {
          const el = maintenanceLabelRefs.current[index];
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { index, left: rect.left, right: rect.right, height: rect.height };
        })
        .filter((item): item is { index: number; left: number; right: number; height: number } => item !== null)
        .sort((a, b) => a.left - b.left);
      if (!measured.length) {
        if (maintenanceLabelLanes.length) setMaintenanceLabelLanes([]);
        return;
      }
      const gap = Math.max(8, measured.reduce((sum, item) => sum + item.height, 0) / measured.length * 0.2);
      const laneRightEdges: number[] = [];
      const lanes = Array(maintenancePoints.length).fill(0);
      for (const item of measured) {
        let lane = 0;
        while (laneRightEdges[lane] !== undefined && item.left < laneRightEdges[lane] + gap) lane += 1;
        lanes[item.index] = lane;
        laneRightEdges[lane] = item.right;
      }
      const tallest = Math.max(...measured.map((item) => item.height));
      const laneStep = tallest + gap;
      setMaintenanceLabelLaneStep((prev) => Math.abs(prev - laneStep) < 0.5 ? prev : laneStep);
      setMaintenanceLabelLanes((prev) => prev.length === lanes.length && prev.every((lane, index) => lane === lanes[index]) ? prev : lanes);
    };
    const frame = requestAnimationFrame(calculateMaintenanceLanes);
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(calculateMaintenanceLanes) : null;
    maintenanceLabelRefs.current.forEach((el) => el && resizeObserver?.observe(el));
    window.addEventListener("resize", calculateMaintenanceLanes);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", calculateMaintenanceLanes);
    };
  }, [maintenancePoints]);

  const maxProjectionLane = projectionLabelLanes.length
    ? Math.max(...projectionLabelLanes)
    : 0;
  const maxMaintenanceLane = maintenanceLabelLanes.length
    ? Math.max(...maintenanceLabelLanes)
    : 0;
  const projectionTopPadding = Math.max(
    96,
    Math.ceil(48 + (maxProjectionLane + 1) * projectionLabelLaneStep),
  );
  const maintenanceBottomPadding = Math.max(
    34,
    Math.ceil(20 + (maxMaintenanceLane + 1) * maintenanceLabelLaneStep),
  );
  const timelineHeight = Math.max(260, 226 + maintenanceBottomPadding);

  const realDate = timelineDateAtHst(cycle.tanggalTanam, hst);
  const realDateStr = realDate ? formatIndoDate(realDate) : "--";
  const ActiveTimelineTooltipIcon = activeTimelineTooltip?.visual?.icon;

  return (
    <div className={`w-full ${className}`}>
      {/* ── STATE 1: NO_CYCLE ── */}
      {cycle.status === "NO_CYCLE" && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-6 text-center backdrop-blur-sm">
          <div className="relative mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-emerald-300 ring-1 ring-white/15">
            <Sprout className="h-7 w-7" />
            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white ring-1 ring-emerald-200">
              <Plus className="h-3 w-3 text-emerald-700" />
            </span>
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-200/70">{gh.code}</div>
          <h3 className="mt-1 text-lg font-bold text-white">Belum Ada Tanaman</h3>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-emerald-100/60">
            Greenhouse belum memiliki siklus aktif. Mulai untuk mengaktifkan HST dan pemantauan nutrisi.
          </p>
          <div className="mt-4 flex flex-col items-center gap-2">
            <Button
              id="btn-mulai-menanam"
              size="sm"
              onClick={() => setStartNormalOpen(true)}
              className="cursor-pointer bg-emerald-500 px-5 text-white hover:bg-emerald-600 active:scale-[0.98]"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              + Mulai Menanam
            </Button>
            <button
              id="link-ongoing-cycle"
              type="button"
              onClick={() => setStartOngoingOpen(true)}
              className="flex cursor-pointer items-center gap-1 text-[11px] text-emerald-200/80 hover:text-white hover:underline"
            >
              <span>Sudah ada tanaman berjalan? Masukkan tanggal tanam</span>
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* ── STATE 2: ACTIVE ── */}
      {cycle.status === "ACTIVE" && (
        <div>
          {display !== "timeline" && (
            <>
          {/* ── Header row ── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-300 ring-1 ring-white/15">
                <Sprout className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{gh.code.toLowerCase()}</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-800 shadow-sm">
                    Siklus Aktif
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-emerald-100/65">
                  {gh.crop} • {n(gh.plants.total)} plants
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                id="btn-kelola-siklus"
                type="button"
                onClick={() => setManageOpen(true)}
                className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/20 active:scale-[0.98]"
              >
                <Settings className="h-3.5 w-3.5" />
                Kelola Siklus
              </button>
              <button
                id="btn-hari-panen"
                type="button"
                onClick={() => setHarvestOpen(true)}
                className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-500/20 px-3.5 py-2 text-xs font-bold text-amber-300 backdrop-blur transition hover:bg-amber-500/30 active:scale-[0.98]"
              >
                <Wheat className="h-3.5 w-3.5" />
                Hari Panen
              </button>
            </div>
          </div>

          {/* ── 3 Compact info cards ── */}
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {/* TANAM */}
            <div className="relative overflow-hidden rounded-xl border border-emerald-500/25 bg-emerald-900/40 p-3.5 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold tracking-wide text-emerald-300">
                  🌱 TANAM
                </span>
                <span className="rounded-full bg-emerald-500/25 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                  HST {hst} hari
                </span>
              </div>
              <div className="mt-2 text-base font-bold text-white">
                {formatIndoDate(cycle.tanggalTanam)}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                <span>↓</span> Umur tanaman aktif
              </div>
            </div>

            {/* POLINASI */}
            {cycle.tanggalPolinasi ? (
              <div className="relative overflow-hidden rounded-xl border border-violet-500/25 bg-violet-900/40 p-3.5 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold tracking-wide text-violet-300">
                    🌼 POLINASI
                  </span>
                  <span className="rounded-full bg-violet-500/25 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                    HSP {hsp} hari
                  </span>
                </div>
                <div className="mt-2 text-base font-bold text-white">
                  {formatIndoDate(cycle.tanggalPolinasi)}
                </div>
                <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-violet-400">
                  <span>↓</span> Fase pembuahan
                </div>
              </div>
            ) : (
              <div className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-dashed border-violet-500/25 bg-violet-900/20 p-3.5 backdrop-blur-sm">
                <span className="text-[11px] font-extrabold tracking-wide text-violet-300/70">
                  🌼 POLINASI
                </span>
                <p className="mt-2 text-[11px] leading-relaxed text-violet-200/60">
                  Belum dicatat. Catat untuk mengaktifkan HSP.
                </p>
                <button
                  id="btn-catat-polinasi"
                  type="button"
                  onClick={() => setPolinasiOpen(true)}
                  className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1 rounded-lg border border-violet-400/30 bg-white/5 py-1 text-[11px] font-bold text-violet-300 transition hover:bg-violet-500/15 active:scale-[0.98]"
                >
                  <Plus className="h-3 w-3" /> Catat Polinasi
                </button>
              </div>
            )}

            {/* HARI PANEN */}
            <div className="relative overflow-hidden rounded-xl border border-amber-500/25 bg-amber-900/35 p-3.5 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold tracking-wide text-amber-300">
                  🌾 HARI PANEN
                </span>
                <span className="rounded-full bg-amber-400/25 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  {metrics.harvestBadgeLabel}
                </span>
              </div>
              <div className="mt-2 text-base font-bold text-white">
                {hariLagi > 0 ? `${hariLagi} hari lagi` : "Siap Panen!"}
              </div>
              <button
                type="button"
                onClick={() => setHarvestOpen(true)}
                className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-amber-400 transition hover:text-amber-300 cursor-pointer"
              >
                <span>↓</span> Tandai hari panen
              </button>
            </div>
          </div>
            </>
          )}

          {/* ── TIMELINE DENGAN TEKNIK LEVITASI ANTARA PROJECTION & REAL ── */}
          {display !== "cards" && (
          <div className="bg-[#0a251a] border border-emerald-900/50 p-6 shadow-xl pb-0">
            {/* Header + Interactive Tooltip Icon */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  Timeline Masa Tanam — {gh.crop}
                </h2>
                <div className="group relative z-[100]">
                  <button
                    type="button"
                    className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                  {/* Tooltip Cara Membaca & Legend */}
                  <div className="pointer-events-none absolute left-0 top-8 z-[99999] hidden w-[340px] rounded-2xl border border-emerald-500/40 bg-[#072018]/95 p-4 shadow-2xl backdrop-blur-md group-hover:block group-focus-within:block">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs mb-3">
                      <Info className="w-4 h-4" /> Cara membaca timeline
                    </div>
                    <ul className="text-[11px] text-emerald-100/80 space-y-2 leading-relaxed list-disc pl-4">
                      <li>
                        Titik berwarna solid dengan glow berada di posisi{" "}
                        <b>levitasi atas (REAL)</b>.
                      </li>
                      <li>
                        Titik proyeksi berada di posisi normal di atas/bawah garis
                        timeline.
                      </li>
                      <li>
                        Garis hijau menunjukkan progres aktual, garis putus-putus
                        menunjukkan rencana ke depan.
                      </li>
                      <li>
                        Arah timeline dari kiri ke kanan mengikuti urutan waktu (HST dan
                        tanggal).
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-emerald-100/60 hidden sm:block">
                Arahkan kursor ke titik / nama fase untuk detail
              </p>
            </div>

            {/* Timeline Container - No negative top bounding issues */}
            <div className="w-full relative rounded-xl border border-white/5 bg-[#06171f]/50">
              <div className="overflow-x-auto custom-scrollbar">
                {/* Kontainer Utama Ditinggikan agar elemen di atas garis tidak terpotong */}
                <div className="relative min-w-[1100px] px-[80px]" style={{ height: `${timelineHeight}px` }}>
                  
                  {/* BASE TRACK (Garis Putus-Putus Rencana) - Posisinya diturunkan ke 160px */}
                  <div className="absolute top-[160px] left-[80px] right-[80px] h-[3px] bg-white/20 border-t-2 border-dashed border-white/30" />
                  
                  {/* WRAPPER KONTEN (Mengikuti batas kiri-kanan track) */}
                  <div className="absolute top-0 bottom-0 left-[80px] right-[80px]">
                    
                    {/* PROGRESS TRACK (Garis Hijau Aktual) */}
                    <div
                      className="absolute top-[160px] left-0 h-[3px] bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)] z-10"
                      style={{ width: `${realPos}%` }}
                    />

                    {/* PHASE INTERVAL LABELS (Balok Fase di bawah Garis) */}
                    <div className="absolute top-[172px] left-0 right-0 flex h-[32px] z-0">
                      {phases.map((p) => {
                        const pStartPos = (p.startHst / totalHst) * 100;
                        const pEndHst = Math.min(p.endHst, totalHst);
                        const pEndPos = (pEndHst / totalHst) * 100;
                        const width = pEndPos - pStartPos;
                        if (width <= 0) return null;
                        const vis = getVisuals(p.id);

                        return (
                          <div
                            key={`bar-${p.id}`}
                            className="absolute top-0 bottom-0 px-[1px] z-10 hover:z-[9999]"
                            style={{ left: `${pStartPos}%`, width: `${width}%` }}
                          >
                            <div className="w-full h-full relative bg-[#081f2a]/90 flex flex-col items-center justify-center rounded-md border border-white/5 hover:border-white/20 transition-colors group cursor-pointer">
                              <div className={`absolute top-0 left-0 right-0 h-[2px] ${vis.bg}`} />
                              <div className="text-[10px] font-semibold text-white truncate px-1 max-w-full">
                                {p.name}
                              </div>
                              <div className="text-[9px] text-white/50 leading-none truncate">
                                {p.startHst} – {p.endHst}
                              </div>

                              <div
                                onMouseEnter={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  showTimelineTooltip({ kind: "phase", rect, phase: p, visual: vis });
                                }}
                                onMouseLeave={hideTimelineTooltip}
                                className="absolute inset-0 z-[60]"
                                aria-hidden="true"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* PROJECTIONS (Titik & Label Proyeksi Normal) */}
                    {renderPoints.map((pt, i) => {
                      const pos = (pt.hst / totalHst) * 100;
                      const vis = getVisuals(pt.id, pt.isEnd);
                      const dateStr = timelineDateAtHst(cycle.tanggalTanam, pt.hst)
                        ? formatIndoDate(timelineDateAtHst(cycle.tanggalTanam, pt.hst))
                        : "--";
                      const isTanam = pt.hst === 0;

                      // Auto-hide label proyeksi bila HST-nya sangat dekat dengan REAL untuk mencegah tumpukan
                      const isOverlapWithReal = Math.abs(pt.hst - hst) < 2;

                      return (
                        <div key={`pt-${i}`} className="absolute top-0 bottom-0 z-20 hover:z-[9999]" style={{ left: `${pos}%` }}>
                          
                          {/* Label PROJECTION */}
                          <div
                            ref={(el) => { projectionLabelRefs.current[i] = el; }}
                            className={`absolute -translate-x-1/2 flex flex-col items-center whitespace-nowrap transition-opacity duration-200 ${
                              isOverlapWithReal ? "opacity-0 pointer-events-none" : "opacity-100"
                            }`}
                            style={{
                              // Mulai dari atas garis (160px), dikurangi jarak yang aman
                              top: `calc(140px - 36px - ${projectionLabelLanes[i] ?? 0} * ${projectionLabelLaneStep}px)`,
                            }}
                          >
                            <div className={`flex items-center gap-1 text-[10px] font-bold ${vis.color}`}>
                              <vis.icon className="w-3 h-3" />
                              {pt.name}
                            </div>
                            <div className="text-[9.5px] font-medium text-white">{dateStr}</div>
                            <div className="text-[8.5px] text-white/40">HST {pt.hst}</div>
                          </div>

                          {/* Marker Dot Proyeksi (Y=156px) - Sentris dengan Garis */}
                          <div className="absolute top-[156px] -translate-x-1/2 group cursor-pointer">
                            <div className={`w-[11px] h-[11px] rounded-full border-[2.5px] ${vis.border} bg-[#06171f] transition-transform group-hover:scale-150`} />
                            <div
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                showTimelineTooltip({ kind: "projection", rect, point: pt, dateStr, visual: vis, isTanam });
                              }}
                              onMouseLeave={hideTimelineTooltip}
                              className="absolute -inset-2 z-[60] rounded-full"
                              aria-hidden="true"
                            />
                          </div>
                        </div>
                      );
                    })}

                    {/* MAINTENANCE / PERAWATAN */}
                    {maintenancePoints.map((item, index) => {
                      const pos = (item.hst / totalHst) * 100;
                      const date = timelineDateAtHst(cycle.tanggalTanam, item.hst);
                      const dateStr = date ? formatIndoDate(date) : "--";
                      const maintenanceVisual = getVisuals(`maintenance:${item.id}`);
                      return (
                        <div key={`maintenance-${item.id}`} className="absolute top-0 bottom-0 z-30 hover:z-[9999]" style={{ left: `${pos}%` }}>
                          <div
                            ref={(el) => { maintenanceLabelRefs.current[index] = el; }}
                            className="absolute -translate-x-1/2 flex flex-col items-center whitespace-nowrap"
                            style={{ top: `${214 + (maintenanceLabelLanes[index] ?? 0) * maintenanceLabelLaneStep}px` }}
                          >
                            <div className="flex items-center gap-1 text-[9.5px] font-bold text-amber-300">
                              <Wrench className="h-3 w-3" />
                              {item.name}
                            </div>
                            <div className="text-[8.5px] font-medium text-white/75">HST {item.hst} · {item.category}</div>
                          </div>
                          <div className="absolute top-[210px] -translate-x-1/2 group cursor-pointer">
                            <div className="flex h-4 w-4 rotate-45 items-center justify-center rounded-[4px] border-2 border-amber-300 bg-[#3a2410] shadow-[0_0_12px_rgba(251,191,36,0.45)] transition-transform group-hover:scale-125">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-200" />
                            </div>
                            <div
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                showTimelineTooltip({ kind: "maintenance", rect, dateStr, visual: maintenanceVisual, point: { id: item.id, name: item.name, hst: item.hst, isEnd: false, note: item.note } });
                              }}
                              onMouseLeave={hideTimelineTooltip}
                              className="absolute -inset-2 z-[60] rounded-full"
                              aria-label={`${item.name}, HST ${item.hst}`}
                            />
                          </div>
                        </div>
                      );
                    })}

                    {/* REAL (AKTUAL) - MELAYANG LEBIH TINGGI */}
                    <div className="absolute top-0 bottom-0 z-40 hover:z-[9999]" style={{ left: `${realPos}%` }}>
                      {/* Marker Dot Real (Y=153px) - Sentris dengan Garis */}
                      <div className="absolute top-[153px] -translate-x-1/2 group cursor-pointer">
                        
                        {/* LABEL REAL - Mengambang tinggi aman di dalam scroll container */}
                        <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none">
                          <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-300 bg-[#072018]/95 px-2.5 py-0.5 rounded-md border border-emerald-500/40 whitespace-nowrap shadow-md backdrop-blur-md">
                            <Apple className="w-3.5 h-3.5 text-emerald-400" />
                            {currentPhase?.name || "Aktual"}
                          </div>
                          <div className="text-[10px] font-medium text-white whitespace-nowrap mt-0.5">
                            {realDateStr}
                          </div>
                          
                          {/* Pill Status Mengambang / Levitasi */}
                          <div className="mt-1 bg-[#09352c] border border-emerald-400 px-3 py-0.5 rounded-full text-[9.5px] font-extrabold text-emerald-300 shadow-[0_4px_15px_rgba(16,185,129,0.4)] whitespace-nowrap">
                            REAL · HST {hst}
                          </div>

                          {/* Garis Indikator Penunjuk Ke Titik Timeline */}
                          <div className="w-[1.5px] h-6 bg-gradient-to-b from-emerald-400 to-transparent mt-1" />
                        </div>

                        {/* Elevated Glowing Marker Dot */}
                        <div className="w-[16px] h-[16px] rounded-full border-[3px] border-white bg-emerald-400 shadow-[0_0_0_5px_rgba(52,211,153,0.2),0_0_20px_rgba(52,211,153,1)] transition-transform group-hover:scale-125 -ml-[2.5px] -mt-[2.5px]" />

                        <div
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            showTimelineTooltip({ kind: "real", rect, dateStr: realDateStr });
                          }}
                          onMouseLeave={hideTimelineTooltip}
                          className="absolute -inset-3 z-[60] rounded-full"
                          aria-hidden="true"
                        />
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

          {activeTimelineTooltip &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                role="tooltip"
                className="pointer-events-none fixed z-[2147483646] w-max max-w-[360px] rounded-2xl border border-white/15 bg-[#071a17]/[.98] p-3.5 text-left shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl"
                style={{
                  left: Math.min(
                    Math.max(12, activeTimelineTooltip.rect.left + activeTimelineTooltip.rect.width / 2 - 180),
                    window.innerWidth - 372
                  ),
                  top: Math.max(
                    12,
                    activeTimelineTooltip.rect.top - 12
                  ),
                  transform: "translateY(-100%)",
                }}
              >
                {activeTimelineTooltip.kind === "phase" && activeTimelineTooltip.phase && activeTimelineTooltip.visual && (
                  <>
                    <div className={`flex items-center gap-1.5 text-[11px] font-bold mb-1 ${activeTimelineTooltip.visual.color}`}>
                      <ActiveTimelineTooltipIcon className="w-3.5 h-3.5" />
                      {activeTimelineTooltip.phase.name}
                    </div>
                    <div className="text-[10px] text-white/60">
                      HST {activeTimelineTooltip.phase.startHst} – {activeTimelineTooltip.phase.endHst}
                    </div>
                    <div className="text-[9.5px] text-white/80 leading-relaxed border-t border-white/10 pt-1.5 mt-1.5">
                      {activeTimelineTooltip.phase.note || activeTimelineTooltip.visual.desc}
                    </div>
                  </>
                )}

                {activeTimelineTooltip.kind === "projection" && activeTimelineTooltip.point && activeTimelineTooltip.visual && (
                  <>
                    <div className={`flex items-center gap-1.5 text-[11px] font-bold mb-1 ${activeTimelineTooltip.visual.color}`}>
                      <ActiveTimelineTooltipIcon className="w-3.5 h-3.5" />
                      {activeTimelineTooltip.point.name} {!activeTimelineTooltip.isTanam && "(Rencana)"}
                    </div>
                    <div className="text-[11px] font-medium text-white">{activeTimelineTooltip.dateStr}</div>
                    <div className="text-[10px] text-white/50 mb-2">HST {activeTimelineTooltip.point.hst}</div>
                    <div className="text-[10px] text-white/80 leading-relaxed border-t border-white/10 pt-2">
                      {activeTimelineTooltip.point.note || activeTimelineTooltip.visual.desc}
                    </div>
                  </>
                )}

                {activeTimelineTooltip.kind === "maintenance" && activeTimelineTooltip.point && (
                  <>
                    <div className="flex items-center gap-1.5 text-[11px] font-bold mb-1.5 text-amber-300">
                      <Wrench className="w-3.5 h-3.5" />
                      {activeTimelineTooltip.point.name}
                    </div>
                    <div className="text-[11px] font-medium text-white">{activeTimelineTooltip.dateStr}</div>
                    <div className="text-[10px] text-amber-200/70 mb-2">HST {activeTimelineTooltip.point.hst} · Rencana Perawatan</div>
                    <div className="text-[10px] text-white/80 leading-relaxed border-t border-amber-500/20 pt-2">
                      {activeTimelineTooltip.point.note || "Jadwal tindakan perawatan yang direncanakan."}
                    </div>
                  </>
                )}

                {activeTimelineTooltip.kind === "real" && (
                  <>
                    <div className="flex items-center gap-1.5 text-[11px] font-bold mb-1.5 text-emerald-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white" />
                      Aktual (REAL)
                    </div>
                    <div className="text-[12px] font-bold text-white">{activeTimelineTooltip.dateStr}</div>
                    <div className="text-[10px] text-emerald-200/70 mb-2">HST {hst}</div>
                    <div className="text-[10.5px] text-emerald-100/90 leading-relaxed border-t border-emerald-500/30 pt-2.5">
                      Sedang dalam fase <span className="font-bold text-white">{currentPhase?.name || "Aktif"}</span> {currentPhase ? `(${currentPhase.startHst} – ${currentPhase.endHst})` : ""}
                    </div>
                  </>
                )}
              </div>,
              document.body
            )}
        </div>
      )}

      {/* ── STATE 3: HARVESTED ── */}
      {cycle.status === "HARVESTED" && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/25">
                <Wheat className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-white/60">{gh.code}</span>
                  <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                    🌾 Siklus Selesai
                  </span>
                </div>
                <h3 className="text-base font-bold text-white">Panen Terakhir Selesai</h3>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                id="btn-lihat-riwayat"
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                <History className="h-3.5 w-3.5" /> Lihat Riwayat
              </button>
              <Button
                id="btn-mulai-siklus-baru"
                size="sm"
                onClick={() => setStartNormalOpen(true)}
                className="bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.98]"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> + Mulai Siklus Baru
              </Button>
            </div>
          </div>

          {cycle.lastHarvestSummary && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-900/30 p-2.5">
                <div className="text-[10px] text-emerald-300/70">Tanggal Tanam</div>
                <div className="mt-0.5 font-bold text-white">{formatIndoDate(cycle.lastHarvestSummary.tanggalTanam)}</div>
              </div>
              <div className="rounded-xl border border-violet-500/25 bg-violet-900/30 p-2.5">
                <div className="text-[10px] text-violet-300/70">Tanggal Polinasi</div>
                <div className="mt-0.5 font-bold text-white">{formatIndoDate(cycle.lastHarvestSummary.tanggalPolinasi)}</div>
              </div>
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-900/30 p-2.5">
                <div className="text-[10px] text-emerald-300/70">Total HST Panen</div>
                <div className="mt-0.5 font-bold text-emerald-300">{cycle.lastHarvestSummary.hstAtHarvest} hari</div>
              </div>
              <div className="rounded-xl border border-amber-500/25 bg-amber-900/30 p-2.5">
                <div className="text-[10px] text-amber-300/70">
                  Panen: {formatIndoDate(cycle.lastHarvestSummary.harvestDate)}
                </div>
                <div className="mt-0.5 font-bold text-amber-300">
                  {cycle.lastHarvestSummary.yieldKg ? `${cycle.lastHarvestSummary.yieldKg} kg` : "Tercatat"}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {display !== "timeline" &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[2147483647] pointer-events-none">
            <div className="pointer-events-auto">
              <CropCycleModals
                gh={gh}
                startNormalOpen={startNormalOpen}
                onCloseStartNormal={() => setStartNormalOpen(false)}
                startOngoingOpen={startOngoingOpen}
                onCloseStartOngoing={() => setStartOngoingOpen(false)}
                polinasiOpen={polinasiOpen}
                onClosePolinasi={() => setPolinasiOpen(false)}
                manageOpen={manageOpen}
                onCloseManage={() => setManageOpen(false)}
                harvestOpen={harvestOpen}
                onCloseHarvest={() => setHarvestOpen(false)}
                historyOpen={historyOpen}
                onCloseHistory={() => setHistoryOpen(false)}
                onStartCycle={handleStartCycle}
                onStartOngoingCycle={handleStartOngoingCycle}
                onRecordPolinasi={handleRecordPolinasi}
                onUpdateTanggalTanam={handleUpdateTanggalTanam}
                onUpdateTanggalPolinasi={handleUpdateTanggalPolinasi}
                onUpdateMetadata={handleUpdateMetadata}
                onDeleteTanggalPolinasi={handleDeleteTanggalPolinasi}
                onResetCycle={handleResetCycle}
                onHarvest={handleHarvest}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export default function GreenhousePage() {
  return (
    <Suspense fallback={null}>
      <GreenhouseContent />
    </Suspense>
  );
}

function GreenhouseContent() {
  useDbVersion();
  const [params] = useSearchParams();
  const router = useNavigate();
  const { ghId: routeGhId } = useParams<{ ghId: string }>();
  const toast = useToast();

  const [estopOpen, setEstopOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const complexes = complexService.list();
  const complexId = params.get("complex") ?? complexes[0].id;
  const complex = complexes.find((c) => c.id === complexId) ?? complexes[0];
  const ghs = greenhouseService.byComplex(complex.id);
  const ghId = params.get("gh") ?? routeGhId ?? ghs[0]?.id;
  const gh = greenhouseService.get(ghId ?? "") ?? ghs[0];
  if (!gh) return null;

  const handleResume = async () => {
    setResuming(true);
    try {
      await fertigationService.resume(complex.id);
      toast(`System resumed — actuators and schedules for ${complex.code} can run again`, "success");
      setResumeOpen(false);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setResuming(false);
    }
  };

  const handleEmergencyStop = async () => {
    setStopping(true);
    try {
      await fertigationService.emergencyStop(complex.id);
      toast(`Emergency stop executed for ${gh.code} — all actuators off until manually resumed`, "warning");
      setEstopOpen(false);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setStopping(false);
    }
  };

  const idx = Math.max(0, ghs.findIndex((g) => g.id === gh.id));
  const prevGh = ghs[(idx - 1 + ghs.length) % ghs.length];
  const nextGh = ghs[(idx + 1) % ghs.length];
  const go = (id: string) => router(`/greenhouse/${id}?complex=${complex.id}`, { replace: true });
  const [range, setRange] = useState<RangeId>("24H");
  const [metric, setMetric] = useState<(typeof METRIC_TABS)[number]["id"]>("temperature");
  const [metricCarouselLocked, setMetricCarouselLocked] = useState(false);
  const [obsOpen, setObsOpen] = useState(false);
  const [obsDeleteTarget, setObsDeleteTarget] = useState<{ id: string; plantId: string } | null>(null);
  const [obsDeleting, setObsDeleting] = useState(false);
  const metrics = useMemo(() => environmentMetrics(gh), [gh]);
  const active = metrics.find((m) => m.id === metric)!;
  const activePoints = (active as unknown as { ranges: Record<RangeId, typeof active.points> }).ranges[range];

  // Environmental chart carousel:
  // - runs automatically while unlocked
  // - selecting a mini chart locks the main chart on that metric
  // - Reset resumes the carousel from the selected metric
  useEffect(() => {
    if (metricCarouselLocked) return;
    const timer = window.setInterval(() => {
      setMetric((current) => {
        const currentIndex = METRIC_TABS.findIndex((item) => item.id === current);
        return METRIC_TABS[(currentIndex + 1) % METRIC_TABS.length].id;
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [metricCarouselLocked]);

  const selectMetric = (id: (typeof METRIC_TABS)[number]["id"]) => {
    setMetric(id);
    setMetricCarouselLocked(true);
  };

  const resetMetricCarousel = () => {
    setMetricCarouselLocked(false);
  };

  const nextSchedule = gh.fertigationSchedules.find((s) => s.status === "scheduled");
  const fruitSeries = fruitDevFor(gh);
  const observations = fertigationService.observationsForGh(gh.id);

  const handleDeleteObservation = async () => {
    if (!obsDeleteTarget) return;
    setObsDeleting(true);
    try {
      await fertigationService.deleteObservation(obsDeleteTarget.id);
      toast(`Observation for ${obsDeleteTarget.plantId} deleted`, "info");
      setObsDeleteTarget(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setObsDeleting(false);
    }
  };

  const tempDeltaClass = (gh.telemetry.tempDeltaC ?? 0) >= 0 ? "text-red-500" : "text-blue-500";
  const TempTrendIcon = (gh.telemetry.tempDeltaC ?? 0) >= 0 ? TrendingUp : TrendingDown;
  const equipmentCards = [
    { name: "Mixing Tank", status: gh.equipment.find((item) => item.name.toLowerCase().includes("mixing tank"))?.status ?? "OFFLINE", detail: `${gh.telemetry.tankPct}% volume` },
    { name: "Distribution Pump", status: gh.equipment.find((item) => item.name.toLowerCase().includes("distribution pump"))?.status ?? "OFFLINE", detail: gh.fertigationState === "DISTRIBUTING" ? "Running now" : "Ready" },
    { name: "Raw Water Valve", status: gh.online ? "OK" : "OFFLINE", detail: "GH dedicated route" },
    { name: "Nutrient Valve", status: gh.online ? "OK" : "OFFLINE", detail: "Dosing route" },
    ...["Temperature Sensor", "Humidity Sensor", "Light Sensor", "Flow Meter"].map((name) => ({
      name,
      status: gh.equipment.find((item) => item.name.toLowerCase().includes(name.toLowerCase()))?.status ?? "OFFLINE",
      detail: "Telemetry channel",
    })),
  ];
  const ghRealtimeState = greenhouseRealtimeState(gh);

  // Derived presentation data: no new/fabricated measurements are introduced.
  // These values are calculated only from the existing metric payload and telemetry.
  const currentMetricValue = (metricId: string) => {
    if (metricId === "temperature") return gh.telemetry.temperatureC;
    if (metricId === "humidity") return gh.telemetry.humidityPct;
    if (metricId === "light") return gh.telemetry.lightLux !== null ? gh.telemetry.lightLux / 1000 : null;
    if (metricId === "tank") return gh.telemetry.tankPct;
    return null;
  };

  const activeCurrent = currentMetricValue(active.id);
  const activeAvg = Number(active.avg);
  const activeMin = Number(active.min);
  const activeMax = Number(active.max);
  const activePosition =
    activeCurrent !== null && Number.isFinite(activeMin) && Number.isFinite(activeMax) && activeMax > activeMin
      ? Math.max(0, Math.min(100, ((activeCurrent - activeMin) / (activeMax - activeMin)) * 100))
      : null;
  const activeVsAverage =
    activeCurrent !== null && Number.isFinite(activeAvg)
      ? activeCurrent - activeAvg
      : null;

  return (
    <AppShell complexId={complex.id}>
      <style>{`
        .gh-surface {
          transition: background-color 160ms ease, box-shadow 160ms ease;
        }
        .gh-surface:hover {
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.035);
        }
      `}</style>
      {/* ---------------- Hero + Environmental — unified edge-to-edge block ---------------- */}
      <div className="-mx-1.5 -mt-1.5 overflow-hidden">
      {/* ---------------- Hero ---------------- */}
      <div className={`relative min-h-[340px] overflow-hidden rounded-t-2xl rounded-b-none border bg-[#173b2e] shadow-[0_12px_34px_rgba(15,23,42,0.12)] ${ghRealtimeState === "live" ? "border-emerald-900/10" : "border-red-300 ring-2 ring-red-100"}`}>
        <div className="absolute inset-0">
          <GreenhouseArt crop={gh.crop} variant="landscape" className="h-full w-full" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#173b2e] via-[#173b2e]/92 from-0% via-45% to-[#173b2e]/25" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#173b2e]/70 via-transparent to-[#173b2e]/15" />
        </div>
        <div className="relative z-10 flex min-h-[340px] flex-col justify-between gap-5 p-6 lg:flex-row lg:items-center lg:gap-8">
          <div className="min-w-0 max-w-[46%] text-white">
            <div className="flex items-center gap-2.5">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                <Sprout className="h-6 w-6 text-emerald-300" />
              </span>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-200/90">{complex.code} / {gh.crop}</div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-3xl font-bold leading-tight tracking-tight">{gh.code}</h1>
                  {gh.cropCycle?.status === "ACTIVE" && (
                    <span className="rounded-full bg-emerald-500 px-2.5 py-0.5 text-[11px] font-extrabold text-white shadow-md shadow-emerald-900/40">
                      Active
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-4 max-w-md border-l border-lime-300/70 pl-3 text-xs leading-relaxed text-emerald-50/80">
              {gh.cropCycle?.status === "ACTIVE"
                ? <>Active crop cycle for <span className="font-semibold text-white">{n(gh.plants.total)} {gh.crop.toLowerCase()} plants</span>. Harvest readiness is the next operator checkpoint.</>
                : gh.cropCycle?.status === "HARVESTED"
                ? <>Siklus panen selesai. Greenhouse siap memulai siklus tanam berikutnya.</>
                : <>Greenhouse belum memiliki siklus tanam aktif. Mulai siklus untuk mengaktifkan monitoring.</>}
            </div>
            <div className="mt-4 grid max-w-md grid-cols-3 border-y border-white/15 py-3">
              <div className="border-r border-white/15 pr-3"><div className="text-[10px] uppercase tracking-[0.14em] text-emerald-200/60">HST</div><div className="mt-1 text-lg font-bold">{gh.telemetry.hstDays} <span className="text-[10px] font-medium text-emerald-100/60">days</span></div></div>
              <div className="border-r border-white/15 px-3"><div className="text-[10px] uppercase tracking-[0.14em] text-emerald-200/60">HSP</div><div className="mt-1 text-lg font-bold">{gh.telemetry.hspDays ?? "--"} <span className="text-[10px] font-medium text-emerald-100/60">days</span></div></div>
              <div className="pl-3"><div className="text-[10px] uppercase tracking-[0.14em] text-emerald-200/60">Tank</div><div className="mt-1 text-lg font-bold">{gh.telemetry.tankPct}<span className="text-[10px] font-medium text-emerald-100/60">%</span></div></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone="green" pulse>● {gh.online ? "ONLINE" : "OFFLINE"}</Badge>
              <Badge tone="green">● {gh.health}</Badge>
              <LiveStatus state={ghRealtimeState} label={`${gh.code} realtime state`} />
              <span className="text-xs text-slate-200/80">{gh.plants.latestObservation}</span>
            </div>
          </div>

          <div className="ml-auto flex w-full min-w-0 flex-col gap-5 lg:max-w-[60%]">
            <div className="flex flex-wrap items-center justify-end gap-2.5">
              {gh.cropCycle?.status === "ACTIVE" && (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("crop-cycle-open-manage", { detail: { ghId: gh.id } }))}
                  title="Buka Kelola Siklus"
                >
                  <Clock className="h-4 w-4" /> Kelola Siklus
                </Button>
              )}
              <Button variant="secondary" onClick={() => router(`/schedule?complex=${complex.id}&gh=${gh.id}`)}>
                <CalendarClock className="h-4 w-4" /> Schedule
              </Button>
              <Button variant="secondary" onClick={() => router(`/fertigation?complex=${complex.id}`)}>
                <Droplets className="h-4 w-4" /> Fertigation
              </Button>
              {complex.emergencyStopped ? (
                <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setResumeOpen(true)}>
                  Resume System
                </Button>
              ) : (
                <Button variant="danger" onClick={() => setEstopOpen(true)}>
                  Emergency Stop
                </Button>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => go(prevGh.id)}
                  aria-label="Previous greenhouse"
                  className="flex h-10 w-9 cursor-pointer items-center justify-center rounded-lg border border-white/25 bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="rounded-lg bg-white/15 px-3.5 py-2 text-sm font-bold text-white backdrop-blur">
                  {gh.code} of {String(ghs.length).padStart(2, "0")}
                </span>
                <button
                  onClick={() => go(nextGh.id)}
                  aria-label="Next greenhouse"
                  className="flex h-10 w-9 cursor-pointer items-center justify-center rounded-lg border border-white/25 bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Crop lifecycle cards */}
            <div className="w-full">
              <CropCycleTimeline gh={gh} display="cards" className="mb-0" />
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- Crop lifecycle timeline — standalone ---------------- */}
      <div className="w-full mt-0">
        <CropCycleTimeline gh={gh} display="timeline" />
      </div>

      {/* ---------------- Charts + plant data ---------------- */}
      <div>
        <SectionCard
          title="Environmental Conditions"
          icon={Activity}
          iconTone="green"
          subtitle={`Real-time monitoring • 24H telemetry from ${gh.code}`}
          className="gh-surface overflow-hidden !rounded-b-2xl !rounded-t-none !border-x !border-b !border-t-0 !border-emerald-400/30 !bg-[#071c25] !shadow-[0_18px_55px_rgba(2,6,23,0.40)] text-slate-100"
          action={
            <div className="flex overflow-hidden rounded-xl border border-white/10 bg-black/10 p-0.5">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  className={`cursor-pointer rounded-lg px-3.5 py-2 text-[11px] font-semibold transition ${
                    range === r.id
                      ? "bg-emerald-500 text-white shadow-[0_4px_16px_rgba(16,185,129,.32)]"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          }
        >
          {/* Top environmental metric cards — exact reference labels and hierarchy */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {metrics.map((item) => {
              const itemPoints = (item as unknown as { ranges: Record<RangeId, typeof item.points> }).ranges[range];
              const itemCurrent = currentMetricValue(item.id);
              const isFertigation = item.id === "fertigation";
              const isTank = item.id === "tank";
              const deltaValue =
                item.id === "temperature"
                  ? gh.telemetry.tempDeltaC
                  : item.id === "humidity"
                    ? gh.telemetry.humidityDeltaPct
                    : null;
              const iconClass =
                item.id === "temperature"
                  ? "bg-red-500/20 text-red-300 ring-1 ring-red-400/15"
                  : item.id === "humidity"
                    ? "bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/15"
                    : item.id === "light"
                      ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/15"
                      : item.id === "tank"
                        ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-400/15"
                        : "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/15";

              const Icon = item.id === "temperature" ? Thermometer : item.id === "humidity" ? Droplets : item.id === "light" ? Sun : isTank ? Waves : Wind;
              const displayValue =
                item.id === "temperature"
                  ? gh.telemetry.temperatureC !== null ? gh.telemetry.temperatureC.toFixed(1) : "–"
                  : item.id === "humidity"
                    ? gh.telemetry.humidityPct !== null ? gh.telemetry.humidityPct.toFixed(1) : "–"
                    : item.id === "light"
                      ? gh.telemetry.lightLux !== null ? Math.round(gh.telemetry.lightLux).toLocaleString() : "–"
                      : item.id === "tank"
                        ? gh.telemetry.tankL !== null ? `${n(gh.telemetry.tankL)}` : "–"
                        : "";
              const displayUnit =
                item.id === "temperature" ? "°C" : item.id === "humidity" ? "%" : item.id === "light" ? "lux" : item.id === "tank" ? "L" : "";

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectMetric(item.id as (typeof METRIC_TABS)[number]["id"])}
                  className={`group relative min-w-0 overflow-hidden rounded-xl border bg-[#0b222c] px-3.5 py-3 text-left transition ${
                    item.id === metric
                      ? "border-white/15 shadow-[0_8px_24px_rgba(0,0,0,.18)]"
                      : "border-white/10 hover:border-white/15 hover:bg-[#0d2732]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${iconClass}`}>
                        <Icon className="h-6 w-6" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-medium text-slate-300">
                          {item.id === "tank" ? "Tank Level" : item.label}
                        </div>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          {isFertigation ? (
                            <span className="text-[11px] font-semibold text-emerald-300">Next run {nextSchedule?.time ?? "–"}</span>
                          ) : (
                            <>
                              <span className="text-[22px] font-bold tracking-tight text-white">{displayValue}</span>
                              <span className="text-[11px] font-medium text-slate-400">{displayUnit}</span>
                            </>
                          )}
                        </div>
                        {item.id === "tank" && <div className="mt-0.5 text-[10px] text-slate-400">Today</div>}
                        {deltaValue !== null && (
                          <div className={`mt-2 flex items-center gap-1 text-[10px] font-semibold ${deltaValue >= 0 ? "text-emerald-400" : "text-blue-300"}`}>
                            {deltaValue >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                            {deltaValue > 0 ? "+" : ""}{deltaValue} {item.id === "temperature" ? "°C" : "%"} <span className="font-normal text-slate-400">vs avg</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 h-[44px] overflow-hidden">
                    <AreaChart points={itemPoints} color={item.color} height={44} />
                  </div>
                  <div className="mt-1 text-[10px] font-medium text-slate-300">
                    {item.min} – {item.max} {item.id === "light" ? "klux" : item.unit}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Environmental 24H */}
          <div className="mt-5 rounded-2xl border border-white/10 bg-[#081b24] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-400/10">
                  <Activity className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[17px] font-bold tracking-tight text-white">Environmental 24H</h3>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">Temperature, Humidity, Light, Tank Level and Fertigation • {gh.code}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={metric}
                  onChange={(e) => selectMetric(e.target.value as (typeof METRIC_TABS)[number]["id"])}
                  className="h-9 rounded-lg border border-emerald-400/40 bg-[#0b252f] px-3 text-[11px] font-semibold text-white outline-none focus:border-emerald-400"
                >
                  {METRIC_TABS.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
                </select>
                <div className="flex overflow-hidden rounded-lg border border-white/10 bg-black/10 p-0.5">
                  <button type="button" className="rounded-md bg-emerald-500 px-3 py-1.5 text-[10px] font-semibold text-white">● Live</button>
                  <button type="button" className="rounded-md px-3 py-1.5 text-[10px] font-medium text-slate-300">Daily Avg</button>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 rounded-xl border border-white/5 bg-[#06171f] p-3">
                <div className="flex items-center justify-between px-1 text-[10px] text-slate-400">
                  <span>{active.unit === "°C" ? "°C" : active.unit}</span>
                  <span>24 Hours</span>
                </div>
                <div className="mt-1 h-[245px]">
                  <AreaChart
                    key={`${gh.id}-${metric}-${range}`}
                    points={activePoints}
                    color="#22d3a1"
                    height={245}
                  />
                </div>
                <div className="mt-1 grid grid-cols-6 text-[9px] text-slate-500">
                  {['00:00','04:00','08:00','12:00','16:00','20:00'].map((t) => <span key={t}>{t}</span>)}
                </div>
              </div>

              <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#071a22] p-5">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(30,100,79,.22),transparent_45%),radial-gradient(circle_at_20%_85%,rgba(16,185,129,.10),transparent_42%)]" />
                <div className="relative z-10">
                  <div className="flex items-center gap-2">
                    <Sprout className="h-6 w-6 text-emerald-400" />
                    <div>
                      <div className="text-[17px] font-bold text-white">Live Profile</div>
                      <div className="text-[10px] text-slate-400">Current Reading</div>
                    </div>
                  </div>

                  <div className="mt-7 flex items-end gap-1.5">
                    <span className="text-[46px] font-extrabold leading-none tracking-tight text-white">
                      {activeCurrent !== null ? (active.id === "temperature" ? activeCurrent.toFixed(1) : activeCurrent) : active.id === "fertigation" ? "–" : "–"}
                    </span>
                    {activeCurrent !== null && <span className="pb-1 text-sm font-medium text-slate-300">{active.unit}</span>}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-emerald-400">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500/15">✓</span>
                    Feels stable
                  </div>

                  {activePosition !== null && (
                    <>
                      <div className="mt-7 h-2 rounded-full bg-slate-700/80">
                        <div className="relative h-full rounded-full bg-emerald-400" style={{ width: `${activePosition}%` }}>
                          <span className="absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-500 shadow-[0_0_16px_rgba(52,211,153,.55)]" />
                        </div>
                      </div>
                      <div className="mt-2 flex justify-between text-[10px] font-medium text-slate-400">
                        <span>{active.min}</span><span>{active.max}</span>
                      </div>
                      <div className="mt-2 text-[12px] text-slate-300"><span className="font-bold text-white">{activePosition.toFixed(0)}%</span> through today's observed range</div>
                    </>
                  )}

                  <div className="mt-7 border-t border-white/10 pt-4">
                    <div className="text-[11px] text-slate-400">Compared with 24H Average</div>
                    <div className="mt-2 flex items-center gap-2">
                      {activeVsAverage !== null ? (
                        <>
                          {activeVsAverage >= 0 ? <TrendingUp className="h-5 w-5 text-emerald-400" /> : <TrendingDown className="h-5 w-5 text-sky-300" />}
                          <span className="text-[18px] font-bold text-emerald-400">{activeVsAverage >= 0 ? "+" : ""}{activeVsAverage.toFixed(active.id === "temperature" ? 1 : 0)} {active.unit}</span>
                        </>
                      ) : (
                        <span className="text-sm font-semibold text-slate-300">{gh.fertigationState}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Environmental 24H Overview */}
          <div className="mt-3 rounded-2xl border border-white/10 bg-[#081b24] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-400/10">
                  <Activity className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-[17px] font-bold tracking-tight text-white">Environmental 24H Overview</h3>
                  <p className="mt-0.5 text-[11px] text-slate-400">Min, average, max and current values for each parameter</p>
                </div>
              </div>
              <span className="pt-1 text-[10px] font-medium text-slate-300">min – max</span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              {metrics.map((item) => {
                const current = currentMetricValue(item.id);
                const min = Number(item.min);
                const max = Number(item.max);
                const avg = Number(item.avg);
                const pos = current !== null && Number.isFinite(min) && Number.isFinite(max) && max > min ? Math.max(0, Math.min(100, ((current - min) / (max - min)) * 100)) : null;
                const label = item.id === "tank" ? "Water/Tank Level (%)" : item.id === "fertigation" ? "Fertigation (L)" : `${item.label} (${item.unit})`;
                const barClass = item.id === "temperature" ? "bg-red-500" : item.id === "humidity" ? "bg-blue-500" : item.id === "light" ? "bg-amber-400" : item.id === "tank" ? "bg-violet-500" : "bg-emerald-400";
                return (
                  <button
                    key={`overview-${item.id}`}
                    type="button"
                    onClick={() => selectMetric(item.id as (typeof METRIC_TABS)[number]["id"])}
                    className="rounded-xl border border-white/10 bg-[#0b222c] p-3 text-left transition hover:border-white/15 hover:bg-[#0e2834]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-semibold text-slate-200">{label}</span>
                      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      <div><div className="text-[9px] text-slate-500">Min</div><div className="mt-0.5 text-sm font-bold text-white">{item.min}</div></div>
                      <div><div className="text-[9px] text-slate-500">Avg</div><div className="mt-0.5 text-sm font-bold text-white">{item.avg}</div></div>
                      <div><div className="text-[9px] text-slate-500">Max</div><div className="mt-0.5 text-sm font-bold text-white">{item.max}</div></div>
                      <div><div className="text-[9px] text-slate-500">Current</div><div className="mt-0.5 text-sm font-bold text-white">{current ?? "–"}</div></div>
                    </div>
                    <div className="mt-4 h-2 rounded-full bg-slate-700/80">
                      {pos !== null && <div className={`relative h-full rounded-full ${barClass}`} style={{ width: `${pos}%` }}><span className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-white shadow-sm" /></div>}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                      <span>{item.min} – {item.max}</span>
                      <span>{item.id === "light" ? "klux" : item.unit}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </SectionCard>
      </div>
      </div>

      {/* Plant & Fruit Data */}
      <div className="mt-5">
        <SectionCard className="gh-surface !border-0 !shadow-none bg-white"
          title="Plant & Fruit Data"
          icon={Leaf}
          iconTone="green"
          action={
            <Button size="sm" variant="outline" onClick={() => setObsOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Observation
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[--color-line] bg-slate-50/60 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Sprout className="h-4 w-4 text-emerald-500" /> Plants
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-3xl font-bold text-slate-900">{n(gh.plants.total)}</span>
                <span className="pb-1 text-xs text-slate-500">/ {n(gh.plants.tracked)} tracked</span>
              </div>
              <div className="mt-2 flex gap-1.5 text-[11px]">
                <Badge tone="green">{gh.plants.alive} alive</Badge>
                <Badge tone="red">{gh.plants.dead} dead</Badge>
              </div>
            </div>
            <div className="rounded-xl border border-[--color-line] bg-slate-50/60 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Apple className="h-4 w-4 text-red-400" /> Fruits
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-3xl font-bold text-slate-900">{n(gh.plants.totalFruits)}</span>
                <span className="pb-1 text-xs text-slate-500">recorded</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Avg weight: <span className="font-semibold text-slate-700">{n(gh.plants.avgFruitWeightG)} g</span>
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-lg bg-blue-50/70 px-3 py-2 text-[11px] leading-relaxed text-blue-700">
            Last observation: <span className="font-semibold">{gh.plants.latestObservation}</span> — plant height avg {gh.plants.avgHeightCm} cm.
          </div>
          {observations.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Recent Observations</div>
              {observations.slice(0, 3).map((o) => (
                <div key={o.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-2 text-xs">
                  <span className="font-semibold text-slate-700">{o.plantId}</span>
                  <span className="text-slate-500">{o.heightCm} cm • {o.leafCount} leaves • {o.fruitCount} fruits</span>
                  <span className="ml-auto text-slate-400">{o.at}</span>
                  <button aria-label="Delete observation" title="Delete observation" onClick={() => setObsDeleteTarget(o)} className="cursor-pointer text-slate-300 transition hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>


      {/* ---------------- Sensor row ---------------- */}
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <div className="group rounded-none border-0 border-l-2 border-red-400 bg-white/70 p-4 shadow-none transition hover:bg-red-50/40">
          <div className="flex items-center justify-between">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-500">
              <Thermometer className="h-[18px] w-[18px]" />
            </span>
            <span className={`flex items-center gap-1 text-xs font-semibold ${tempDeltaClass}`}>
              <TempTrendIcon className="h-3.5 w-3.5" />
              {delta(gh.telemetry.tempDeltaC, "°C")}
            </span>
          </div>
          <div className="mt-2.5 text-xs text-slate-500">Temperature</div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.temperatureC !== null ? gh.telemetry.temperatureC.toFixed(1) : "–"}<span className="text-sm font-medium text-slate-400"> °C</span>
          </div>
        </div>
        <div className="group rounded-none border-0 border-l-2 border-sky-400 bg-white/70 p-4 shadow-none transition hover:bg-sky-50/40">
          <div className="flex items-center justify-between">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-500">
              <Droplets className="h-[18px] w-[18px]" />
            </span>
            <span className={`flex items-center gap-1 text-xs font-semibold ${(gh.telemetry.humidityDeltaPct ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              {(gh.telemetry.humidityDeltaPct ?? 0) >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {delta(gh.telemetry.humidityDeltaPct)}
            </span>
          </div>
          <div className="mt-2.5 text-xs text-slate-500">Humidity</div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.humidityPct ?? "–"}<span className="text-sm font-medium text-slate-400"> %</span>
          </div>
        </div>
        <div className="group rounded-none border-0 border-l-2 border-amber-400 bg-white/70 p-4 shadow-none transition hover:bg-amber-50/40">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-500">
            <Sun className="h-[18px] w-[18px]" />
          </span>
          <div className="mt-2.5 text-xs text-slate-500">Light</div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.lightLux !== null ? (gh.telemetry.lightLux / 1000).toFixed(1) : "–"}<span className="text-sm font-medium text-slate-400"> klux</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">{lux(gh.telemetry.lightLux)}</div>
        </div>
        <div className="group rounded-none border-0 border-l-2 border-emerald-500 bg-white/70 p-4 shadow-none transition hover:bg-emerald-50/40">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <Sprout className="h-[18px] w-[18px]" />
          </span>
          <div className="mt-2.5 text-xs text-slate-500">HST <span className="text-slate-400">(Hari Setelah Tanam)</span></div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.cropCycle?.status === "ACTIVE" ? (
              <>
                {gh.telemetry.hstDays}<span className="text-sm font-medium text-slate-400"> days</span>
              </>
            ) : gh.cropCycle?.status === "HARVESTED" ? (
              <span className="text-base font-bold text-amber-700">Panen</span>
            ) : (
              <span className="text-slate-400">–</span>
            )}
          </div>
        </div>
        <div className="group rounded-none border-0 border-l-2 border-violet-400 bg-white/70 p-4 shadow-none transition hover:bg-violet-50/40">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-500">
            <Apple className="h-[18px] w-[18px]" />
          </span>
          <div className="mt-2.5 text-xs text-slate-500">HSP <span className="text-slate-400">(Hari Setelah Polinasi)</span></div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.cropCycle?.status === "ACTIVE" && gh.telemetry.hspDays !== null ? (
              <>
                {gh.telemetry.hspDays}<span className="text-sm font-medium text-slate-400"> days</span>
              </>
            ) : (
              <span className="text-slate-400">–</span>
            )}
          </div>
        </div>
        <div className="group rounded-none border-0 border-l-2 border-blue-400 bg-white/70 p-4 shadow-none transition hover:bg-blue-50/40">
          <div className="flex items-center justify-between">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-500">
              <Waves className="h-[18px] w-[18px]" />
            </span>
            <span className={`text-xs font-semibold ${(gh.telemetry.waterDeltaPct ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              {delta(gh.telemetry.waterDeltaPct)}
            </span>
          </div>
          <div className="mt-2.5 text-xs text-slate-500">Water Today</div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.waterTodayL !== null ? n(gh.telemetry.waterTodayL) : "–"}<span className="text-sm font-medium text-slate-400"> L</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            Yesterday: {gh.telemetry.waterYesterdayL !== null ? `${n(gh.telemetry.waterYesterdayL)} L` : "–"}
          </div>
        </div>
      </div>

      {/* ---------------- Camera Monitoring ---------------- */}
      <SectionCard
        title="Camera Monitoring"
        icon={Camera}
        iconTone="slate"
        subtitle={gh.online ? "3 cameras • snapshots every 15 minutes" : "Camera feeds unavailable"}
        className="mb-5 gh-surface !border-0 !shadow-none bg-white/95 ring-1 ring-slate-200/70"
        action={
          <div className="flex items-center gap-2 text-[11px]">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${gh.online ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${gh.online ? "bg-emerald-500" : "bg-red-500"}`} />
              {gh.online ? "3 Online" : "Offline"}
            </span>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          {/* Main camera */}
          <div className="group relative min-h-[250px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 lg:min-h-[330px]">
            <GreenhouseArt crop={gh.crop} variant="landscape" className="h-full w-full transition duration-500 group-hover:scale-[1.01]" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-950/10 to-transparent" />
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-slate-950/65 px-2.5 py-1.5 text-[10px] font-semibold text-white backdrop-blur">
              <Camera className="h-3 w-3" /> Camera 1
            </div>
            <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/90 px-2.5 py-1.5 text-[10px] font-semibold text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-white" /> LIVE
            </span>
            <button type="button" aria-label="Open Camera 1" className="absolute right-3 bottom-14 grid h-8 w-8 place-items-center rounded-lg bg-black/45 text-white backdrop-blur transition hover:bg-black/65">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3 text-white">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{gh.code} · {gh.crop}</div>
                <div className="mt-0.5 text-[10px] text-white/75">Camera 1 · greenhouse overview</div>
              </div>
              <div className="shrink-0 text-right text-[10px] text-white/75">15 min ago</div>
            </div>
          </div>

          {/* Secondary cameras — intentionally split into two compact feeds */}
          <div className="grid min-h-[250px] grid-rows-2 gap-3 lg:min-h-[330px]">
            {[2, 3].map((camera) => (
              <div key={camera} className="group relative min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                <GreenhouseArt crop={gh.crop} variant="landscape" className="h-full w-full transition duration-500 group-hover:scale-[1.01]" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />
                <div className="absolute left-2.5 top-2.5 rounded-full bg-slate-950/65 px-2 py-1 text-[9px] font-semibold text-white backdrop-blur">
                  Camera {camera}
                </div>
                <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[9px] font-medium text-white backdrop-blur">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> 15m ago
                </span>
                <div className="absolute inset-x-2.5 bottom-2.5 flex items-end justify-between gap-2 text-white">
                  <div>
                    <div className="text-[11px] font-semibold">Camera {camera}</div>
                    <div className="text-[9px] text-white/70">Snapshot</div>
                  </div>
                  <button type="button" aria-label={`Open Camera ${camera}`} className="grid h-7 w-7 place-items-center rounded-lg bg-black/40 backdrop-blur transition hover:bg-black/65">
                    <Maximize2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Card information condensed into one monitoring strip */}
        <div className="mt-3 grid grid-cols-2 divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-100 bg-slate-50/70 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Temperature", value: gh.telemetry.temperatureC !== null ? `${gh.telemetry.temperatureC.toFixed(1)} °C` : "–" },
            { label: "Humidity", value: gh.telemetry.humidityPct !== null ? `${gh.telemetry.humidityPct}%` : "–" },
            { label: "Light", value: gh.telemetry.lightLux !== null ? `${(gh.telemetry.lightLux / 1000).toFixed(1)} klux` : "–" },
            { label: "HST", value: gh.cropCycle?.status === "ACTIVE" ? `${gh.telemetry.hstDays} days` : gh.cropCycle?.status === "HARVESTED" ? "Panen" : "–", hint: "Hari Setelah Tanam" },
            { label: "HSP", value: gh.cropCycle?.status === "ACTIVE" && gh.telemetry.hspDays !== null ? `${gh.telemetry.hspDays} days` : "–", hint: "Hari Setelah Polinasi" },
            { label: "Water Today", value: gh.telemetry.waterTodayL !== null ? `${n(gh.telemetry.waterTodayL)} L` : "–" },
          ].map((item) => (
            <div key={item.label} className="min-w-0 px-3 py-2.5">
              <div className="truncate text-[10px] text-slate-400" title={item.hint}>{item.label}</div>
              <div className="mt-0.5 truncate text-sm font-bold text-slate-800">{item.value}</div>
            </div>
          ))}
        </div>
      </SectionCard>


      {/* ---------------- Fertigation row ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Current fertigation / tank */}
        {gh.currentRun ? (
          <SectionCard
            title="Current Fertigation"
            icon={Droplets}
            iconTone="blue"
            subtitle={`Started ${gh.currentRun.startedAt} • ETA ${gh.currentRun.estimatedFinish}`}
            className="xl:col-span-2 gh-surface !border-0 !shadow-none bg-white"
            action={<StatusBadge status="running" />}
          >
            <div className="mb-3.5 flex items-center justify-between text-[13px]">
              <span className="font-semibold text-slate-800">{gh.currentRun.recipeName}</span>
              <span className="text-slate-500">
                {gh.currentRun.elapsedLabel} elapsed • {gh.currentRun.progressPct}%
              </span>
            </div>
            <Progress value={gh.currentRun.progressPct} className="h-2" />
            <div className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Water", value: `${gh.currentRun.waterDoneL} / ${gh.currentRun.targetWaterL} L` },
                { label: "Dosing A", value: `${gh.currentRun.dosingADoneMl} / ${gh.currentRun.dosingAml} ml` },
                { label: "Dosing B", value: `${gh.currentRun.dosingBDoneMl} / ${gh.currentRun.dosingBml} ml` },
                { label: "Estimated Finish", value: gh.currentRun.estimatedFinish },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                  <div className="text-[11px] text-slate-400">{s.label}</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-800">{s.value}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : (
          <SectionCard title="Mixing Tank" icon={Beaker} iconTone="blue" className="xl:col-span-2 gh-surface !border-0 !shadow-none bg-white" realtime={ghRealtimeState}>
            <div className="flex items-center gap-5">
              <div className="relative h-24 w-16 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                <div className="absolute bottom-0 w-full bg-gradient-to-t from-blue-500 to-sky-400" style={{ height: `${gh.telemetry.tankPct}%` }} />
                <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-700">
                  {gh.telemetry.tankPct}%
                </div>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: "Capacity", value: `${gh.telemetry.tankCapacityL} L` },
                  { label: "Current", value: `${gh.telemetry.tankL} L` },
                  { label: "Temperature", value: "27.8 °C" },
                  { label: "Next Refill", value: nextSchedule ? `Today ${nextSchedule.time}` : "–" },
                  { label: "State", value: gh.fertigationState },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                    <div className="text-[11px] text-slate-400">{s.label}</div>
                    <div className="mt-0.5 text-sm font-bold text-slate-800">{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        )}

        {/* Next schedule */}
        <SectionCard className="gh-surface !border-0 !shadow-none bg-white"
          title="Next Schedule"
          icon={CalendarClock}
          iconTone="violet"
          action={<ViewAllButton onClick={() => router(`/schedule?complex=${complex.id}&gh=${gh.id}`)}>View Schedule</ViewAllButton>}
        >
          {nextSchedule ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
                  <Clock className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-lg font-bold text-slate-900">{nextSchedule.time}</div>
                  <div className="text-xs text-slate-500">{nextSchedule.name}</div>
                </div>
                <StatusBadge status="scheduled" className="ml-auto" />
              </div>
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between"><span className="text-slate-500">Recipe</span><span className="font-medium text-slate-800">{gh.recipes.find((r) => r.id === nextSchedule.recipeId)?.name ?? "–"}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Target Water</span><span className="font-medium text-slate-800">{nextSchedule.targetWaterL} L</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Repeat</span><span className="font-medium text-slate-800">{nextSchedule.repeat}</span></div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No upcoming schedule for this greenhouse.</p>
          )}
        </SectionCard>
      </div>

      {/* ---------------- Today's schedule + history ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard className="gh-surface !border-0 !shadow-none bg-white"
          title="Today's Fertigation Schedule"
          icon={CalendarClock}
          iconTone="blue"
          action={<ViewAllButton onClick={() => router(`/schedule?complex=${complex.id}&gh=${gh.id}`)}>View All</ViewAllButton>}
        >
          {gh.fertigationSchedules.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-400">
              No fertigation schedules configured for this greenhouse.
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2 font-medium">Time</th>
                  <th className="pb-2 font-medium">Recipe</th>
                  <th className="pb-2 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {gh.fertigationSchedules.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 font-semibold text-slate-800">{s.time}</td>
                    <td className="py-2.5 text-slate-600">{gh.recipes.find((r) => r.id === s.recipeId)?.name ?? "–"}</td>
                    <td className="py-2.5 text-slate-600">~23 min</td>
                    <td className="py-2.5"><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard className="gh-surface !border-0 !shadow-none bg-white"
          title="Fertigation History"
          icon={History}
          iconTone="slate"
          realtime={ghRealtimeState}
          action={<ViewAllButton onClick={() => router(`/fertigation?complex=${complex.id}`)}>View All</ViewAllButton>}
        >
          {gh.history.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-400">
              No fertigation history recorded yet for this greenhouse.
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2 font-medium">Date & Time</th>
                  <th className="pb-2 font-medium">Recipe</th>
                  <th className="pb-2 font-medium">Water</th>
                  <th className="pb-2 font-medium">Dosing</th>
                  <th className="pb-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {gh.history.map((h) => (
                  <tr key={h.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 font-medium text-slate-800">{h.date} {h.time}</td>
                    <td className="py-2.5 text-slate-600">{h.recipeName}</td>
                    <td className="py-2.5 text-slate-600">{h.waterL} L</td>
                    <td className="py-2.5 text-slate-600">A {h.dosingAml} / B {h.dosingBml} ml</td>
                    <td className="py-2.5"><StatusBadge status={h.result} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      {/* ---------------- Complete greenhouse schedule ---------------- */}
      <ScheduleContent embedded selectedComplexId={complex.id} selectedGreenhouseId={gh.id} />

      {/* ---------------- Plant overview + fruit development ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard className="gh-surface !border-0 !shadow-none bg-white" title="Plant Overview" icon={Sprout} iconTone="green">
          <div className="flex items-center gap-6">
            <Donut
              total={gh.plants.total}
              label="Plants"
              segments={[
                { value: gh.plants.alive, color: "#10b981" },
                { value: gh.plants.dead, color: "#ef4444" },
              ]}
            />
            <div className="flex-1 space-y-2.5">
              {[
                { label: "Alive", value: gh.plants.alive, color: "bg-emerald-500", pct: Math.round((gh.plants.alive / Math.max(1, gh.plants.total)) * 100) },
                { label: "Dead", value: gh.plants.dead, color: "bg-red-500", pct: Math.round((gh.plants.dead / Math.max(1, gh.plants.total)) * 100) },
                { label: "Tracked", value: gh.plants.tracked, color: "bg-blue-500", pct: Math.round((gh.plants.tracked / Math.max(1, gh.plants.total)) * 100) },
              ].map((r) => (
                <div key={r.label}>
                  <div className="mb-1 flex items-center justify-between text-[13px]">
                    <span className="text-slate-600">{r.label}</span>
                    <span className="font-semibold text-slate-800">{r.value} ({r.pct}%)</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${r.color}`} style={{ width: `${r.pct}%` }} />
                  </div>
                </div>
              ))}
              <div className="pt-1 text-[11px] text-slate-400">Survival rate {Math.round((gh.plants.alive / Math.max(1, gh.plants.total)) * 100)}%</div>
            </div>
          </div>
        </SectionCard>

        <SectionCard className="gh-surface !border-0 !shadow-none bg-white"
          title="Fruit Development"
          icon={Apple}
          iconTone="red"
          subtitle="Count and average weight over the season"
        >
          <DualLineChart
            points={fruitSeries.map((p) => ({ label: p.label, a: p.count, b: p.weight }))}
            height={210}
          />
          <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Fruit count</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" /> Avg weight (g)</span>
          </div>
        </SectionCard>
      </div>

      {/* ---------------- Equipment ---------------- */}
      <SectionCard className="gh-surface !border-0 !shadow-none bg-white" title="GH Hardware &amp; Capability" icon={Wrench} iconTone="slate" realtime={ghRealtimeState} subtitle="Dedicated hardware reported by the Complex controller">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {equipmentCards.map((eq) => (
            <div key={eq.name} className={`rounded-xl border p-3 text-center ${eq.status === "OFFLINE" ? "border-slate-200 bg-slate-100/80 opacity-70" : "border-[--color-line] bg-slate-50/60"}`}>
              <div className="text-sm font-semibold text-slate-800">{eq.name}</div>
              <div className="mt-1 text-[10px] text-slate-400">{eq.detail}</div>
              <div className="mt-2 flex justify-center">
                <StatusBadge status={eq.status.toLowerCase()} />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ---------------- Add Observation modal ---------------- */}
      {typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[2147483647] pointer-events-none">
            <div className="pointer-events-auto">
              <ObservationModal
                open={obsOpen}
                onClose={() => setObsOpen(false)}
                ghCode={gh.code}
                onSubmit={async (draft) => {
                  await fertigationService.addObservation(gh.id, { ...draft, ghId: gh.id });
                  toast(`Observation for ${draft.plantId} saved`, "success");
                }}
              />

              <ConfirmDialog
                open={estopOpen}
                onClose={() => { if (!stopping) setEstopOpen(false); }}
                onConfirm={handleEmergencyStop}
                title="Emergency Stop"
                message={`Stop all pumps and close all valves for ${gh.code} (${complex.code})? This affects physical equipment. The system stays in a safe state until you press Resume System.`}
                confirmLabel={stopping ? "Stopping…" : "Stop Everything"}
                danger
              />
              <ConfirmDialog
                open={resumeOpen}
                onClose={() => { if (!resuming) setResumeOpen(false); }}
                onConfirm={handleResume}
                title="Resume System"
                message={`Lift the latched emergency stop on ${complex.code}? Pumps and valves become available again; schedules resume their normal behaviour.`}
                confirmLabel={resuming ? "Resuming…" : "Resume System"}
              />

              <ConfirmDialog
                open={obsDeleteTarget !== null}
                onClose={() => setObsDeleteTarget(null)}
                onConfirm={handleDeleteObservation}
                title="Delete observation"
                message={`Are you sure you want to delete the observation for plant ${obsDeleteTarget?.plantId}? This cannot be undone.`}
                confirmLabel={obsDeleting ? "Deleting…" : "Delete"}
                danger
              />
            </div>
          </div>,
          document.body
        )}
    </AppShell>
  );
}

function ObservationModal({
  open,
  onClose,
  ghCode,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  ghCode: string;
  onSubmit: (draft: { plantId: string; heightCm: number; leafCount: number; fruitCount: number; notes: string }) => Promise<void>;
}) {
  const [plantId, setPlantId] = useState("B1N4.1");
  const [height, setHeight] = useState("85");
  const [leaves, setLeaves] = useState("21");
  const [fruits, setFruits] = useState("4");
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const validate = () => {
    const errs: Record<string, string | null> = {
      plantId: required(plantId, "Plant ID"),
      height: number(height, { label: "Height", positive: true }),
      leaves: number(leaves, { label: "Leaf count", min: 0 }),
      fruits: number(fruits, { label: "Fruit count", min: 0 }),
    };
    setErrors(errs);
    return !Object.values(errs).some(Boolean);
  };

  return (
    <>
      <Modal
        open={open}
        onClose={() => { if (!saving) onClose(); }}
        title={`Add Observation — ${ghCode}`}
        width={520}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button
              onClick={() => {
                if (validate()) setConfirmOpen(true);
              }}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save Observation"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3.5">
          <div className="col-span-2">
            <Label required>Plant ID</Label>
            <Input value={plantId} onChange={(e) => setPlantId(e.target.value)} placeholder="B1N4.1" />
            <FieldError>{errors.plantId}</FieldError>
          </div>
          <div>
            <Label required>Height (cm)</Label>
            <Input type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
            <FieldError>{errors.height}</FieldError>
          </div>
          <div>
            <Label required>Leaf Count</Label>
            <Input type="number" value={leaves} onChange={(e) => setLeaves(e.target.value)} />
            <FieldError>{errors.leaves}</FieldError>
          </div>
          <div>
            <Label required>Fruit Count</Label>
            <Input type="number" value={fruits} onChange={(e) => setFruits(e.target.value)} />
            <FieldError>{errors.fruits}</FieldError>
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condition, pests, treatment…" />
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setSaving(true);
          try {
            await onSubmit({ plantId: plantId.trim(), heightCm: Number(height) || 0, leafCount: Number(leaves) || 0, fruitCount: Number(fruits) || 0, notes });
            onClose();
          } finally {
            setSaving(false);
          }
        }}
        title="Save observation"
        message={`Record a new observation for plant ${plantId}?`}
        confirmLabel="Save"
      />
    </>
  );
}
