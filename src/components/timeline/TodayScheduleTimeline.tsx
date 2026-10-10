"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Droplets,
  Waves,
  Leaf,
  Fan,
  Lightbulb,
  Building2,
  Calendar,
  Layers,
  Sparkles,
  Info,
  CheckCircle2,
  AlertCircle,
  PlayCircle,
  X,
} from "lucide-react";
import { useDeviceClock } from "@/lib/device-clock";
import {
  complexService,
  greenhouseService,
  recipeService,
  scheduleService,
} from "@/lib/services";
import { formatGreenhouseName } from "@/lib/format";
import type {
  FertigationSchedule,
  WellPumpSchedule,
  FanSchedule,
  LightingSchedule,
} from "@/lib/types";
import {
  TimelineMode,
  ScheduleType,
  TimelineRawEvent,
  PlacedTimelineEvent,
  TimelineRow,
  parseClockToMinutes,
  formatMinutesToClock,
  toIsoDate,
  isScheduleActiveOnDate,
  assignLanesToEvents,
  expandIntervalTimes,
} from "./TimelineEngine";

export interface TodayScheduleTimelineProps {
  mode?: TimelineMode;
  complexId?: string;
  greenhouseId?: string;
  selectedCategory?: string; // "all" | "fertigation" | "pump" | "fan" | "lighting"
  className?: string;
}

const HOURS_AXIS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

const SCHEDULE_CATEGORIES_CONFIG: Array<{
  id: ScheduleType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "emerald" | "cyan" | "amber" | "violet";
}> = [
  { id: "fertigation", label: "Fertigation Schedule", icon: Leaf, tone: "emerald" },
  { id: "pump", label: "Well Pump Schedule", icon: Waves, tone: "cyan" },
  { id: "fan", label: "Fan Schedule", icon: Fan, tone: "amber" },
  { id: "lighting", label: "Lighting Schedule (OFF-only)", icon: Lightbulb, tone: "violet" },
];

function getCategoryToneClasses(tone: "emerald" | "cyan" | "amber" | "violet" | "blue") {
  switch (tone) {
    case "cyan":
      return {
        card: "border-cyan-500/50 bg-[#0c2438]/95 text-cyan-100 hover:border-cyan-400 shadow-[0_4px_14px_rgba(6,182,212,0.22)]",
        badge: "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40",
        rowBg: "bg-cyan-950/15",
        icon: "text-cyan-400",
        accent: "bg-cyan-500",
      };
    case "amber":
      return {
        card: "border-amber-500/50 bg-[#2d1e08]/95 text-amber-100 hover:border-amber-400 shadow-[0_4px_14px_rgba(245,158,11,0.22)]",
        badge: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
        rowBg: "bg-amber-950/15",
        icon: "text-amber-400",
        accent: "bg-amber-500",
      };
    case "violet":
      return {
        card: "border-violet-500/50 bg-[#25153f]/95 text-violet-100 hover:border-violet-400 shadow-[0_4px_14px_rgba(139,92,246,0.24)]",
        badge: "bg-violet-500/20 text-violet-300 border border-violet-500/40",
        rowBg: "bg-violet-950/15",
        icon: "text-violet-400",
        accent: "bg-violet-500",
      };
    case "emerald":
    default:
      return {
        card: "border-emerald-500/50 bg-[#09261c]/95 text-emerald-100 hover:border-emerald-400 shadow-[0_4px_14px_rgba(16,185,129,0.22)]",
        badge: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
        rowBg: "bg-emerald-950/15",
        icon: "text-emerald-400",
        accent: "bg-emerald-500",
      };
  }
}

function TodayScheduleTimelineComponent({
  mode = "gh",
  complexId: propComplexId,
  greenhouseId: propGhId,
  selectedCategory: propCategory,
  className = "",
}: TodayScheduleTimelineProps) {
  const clock = useDeviceClock();
  const currentMinutes = Math.floor(clock.secondsSinceMidnight / 60);
  const nowFraction = Math.max(0, Math.min(1, clock.dayFraction));
  const nowPct = nowFraction * 100;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Date Navigation State (offset from clock.date)
  const [offsetDays, setOffsetDays] = useState<number>(0);
  const [activeFilter, setActiveFilter] = useState<string>(propCategory || "all");
  const [selectedEvent, setSelectedEvent] = useState<PlacedTimelineEvent | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<PlacedTimelineEvent | null>(null);

  // Sync category prop changes
  useEffect(() => {
    if (propCategory) setActiveFilter(propCategory);
  }, [propCategory]);

  // Authoritative Selected Date (stable reference across seconds, advances at midnight or on offset change)
  const baseDateStr = clock.dateStr || "";
  const selectedDate = useMemo(() => {
    const [y, m, d] = baseDateStr.split("-").map(Number);
    const dateObj = !isNaN(y) && !isNaN(m) && !isNaN(d) ? new Date(y, m - 1, d) : new Date();
    dateObj.setHours(0, 0, 0, 0);
    dateObj.setDate(dateObj.getDate() + offsetDays);
    return dateObj;
  }, [baseDateStr, offsetDays]);

  const isToday = offsetDays === 0;

  // Selected date formatted label
  const dateDisplayLabel = useMemo(() => {
    if (offsetDays === 0) return "Today";
    if (offsetDays === 1) return "Tomorrow";
    if (offsetDays === -1) return "Yesterday";
    return selectedDate.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }, [offsetDays, selectedDate]);

  const fullDateText = useMemo(() => {
    return selectedDate.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, [selectedDate]);

  // Context resolution: Complex and Greenhouses (memoized to prevent new array references each render)
  const complexes = complexService.list();
  const activeComplex =
    (propComplexId ? complexes.find((c) => c.id === propComplexId) : null) ||
    complexes[0] || {
      id: "complex-01",
      code: "complex-01",
      name: "Complex 01",
    };

  const ghs = useMemo(() => {
    return greenhouseService.byComplex(activeComplex.id);
  }, [activeComplex.id]);

  const activeGh = useMemo(() => {
    return (
      (propGhId ? ghs.find((g) => g.id === propGhId) : null) ||
      ghs[0] || {
        id: "gh-01",
        code: "GH-01",
        name: "Greenhouse 01",
      }
    );
  }, [propGhId, ghs]);

  // ---------------- AUTHORITATIVE SCHEDULE OCCURRENCE CALCULATION ----------------
  const { rows, filterOptions } = useMemo(() => {
    // 1. Authoritative Complex-level Well Pump Schedule (Single source of truth)
    const wellPumps = scheduleService.wellPumpForComplex(activeComplex.id);

    // Compute active occurrences of the single Complex-level Well Pump schedule for selectedDate
    const authoritativeWellPumpOccurrences: TimelineRawEvent[] = [];
    wellPumps.forEach((s) => {
      if (!s.enabled || !s.time || s.time === "--:--") return;
      if (!isScheduleActiveOnDate(s, selectedDate, clock.date)) return;

      const occTimes = expandIntervalTimes(
        s.time,
        s.endTime,
        s.intervalMin || (s.trigger === "interval" ? 180 : undefined)
      );

      occTimes.forEach((occTime, oIdx) => {
        const startMin = parseClockToMinutes(occTime);
        const duration = s.durationMin || (s.durationSec ? Math.round(s.durationSec / 60) : 30);
        const endMin = startMin + duration;

        let status: PlacedTimelineEvent["status"] = "scheduled";
        if (isToday) {
          const isRunning = currentMinutes >= startMin && currentMinutes < endMin;
          const isPast = endMin < currentMinutes;
          status = isRunning ? "running" : isPast ? "completed" : "scheduled";
        } else if (offsetDays < 0) {
          status = "completed";
        } else {
          status = "scheduled";
        }

        authoritativeWellPumpOccurrences.push({
          id: `complex-pump-${s.id}-${oIdx}`,
          sourceScheduleId: s.id,
          scheduleType: "pump",
          sourceScope: "complex",
          isSharedResource: true,
          time: occTime,
          endTime: formatMinutesToClock(endMin),
          durationMin: duration,
          greenhouseCode: "Complex",
          title: s.task || "Well Pump Schedule",
          subtitle: "Shared Complex Resource",
          status,
          radarState: s.radar === "full" ? "Penuh" : "Dalam Pengisian",
          repeatRule:
            s.repeat ||
            (s.trigger === "interval"
              ? `Setiap ${s.intervalMin ? Math.round(s.intervalMin / 60) : 3} Jam`
              : "Setiap Hari"),
          occurrenceIndex: oIdx + 1,
          totalOccurrences: occTimes.length,
        });
      });
    });

    // Filter Options
    const filters: Array<{ id: string; label: string }> = [
      { id: "all", label: "All Schedule" },
      { id: "fertigation", label: "Fertigation Schedule" },
      { id: "pump", label: "Well Pump Schedule" },
      { id: "fan", label: "Fan Schedule" },
      { id: "lighting", label: "Lighting Schedule (OFF-Only)" },
    ];

    // Helper: compute Fertigation occurrences for a given Greenhouse on selectedDate
    function getGhFertOccurrences(ghId: string, ghCode: string): TimelineRawEvent[] {
      const schedules = scheduleService.fertigationForGh(ghId);
      const events: TimelineRawEvent[] = [];

      schedules.forEach((s) => {
        if (!s.enabled || !s.time || s.time === "--:--") return;
        if (!isScheduleActiveOnDate(s, selectedDate, clock.date)) return;

        const occTimes = expandIntervalTimes(
          s.time,
          s.endTime,
          s.intervalHours ? Math.round(s.intervalHours * 60) : undefined
        );

        const recipe =
          activeGh.recipes?.find((r) => r.id === s.recipeId) ||
          recipeService.get(s.recipeId || "") || { name: "Nutrient Standard" };

        occTimes.forEach((occTime, oIdx) => {
          const startMin = parseClockToMinutes(occTime);
          const duration = 60; // Standard single-session delivery duration
          const endMin = startMin + duration;

          let status: PlacedTimelineEvent["status"] = "scheduled";
          if (isToday) {
            const isRunning = currentMinutes >= startMin && currentMinutes < endMin;
            const isPast = endMin < currentMinutes;
            status = isRunning
              ? "running"
              : isPast
              ? s.lastRun
                ? "completed"
                : "missed"
              : s.status === "blocked"
              ? "blocked"
              : "scheduled";
          } else if (offsetDays < 0) {
            status = "completed";
          } else {
            status = s.status === "blocked" ? "blocked" : "scheduled";
          }

          events.push({
            id: `fert-${ghId}-${s.id}-${oIdx}`,
            sourceScheduleId: s.id,
            scheduleType: "fertigation",
            sourceScope: "greenhouse",
            greenhouseId: ghId,
            greenhouseCode: ghCode,
            time: occTime,
            endTime: formatMinutesToClock(endMin),
            durationMin: duration,
            title: `Fertigation (${recipe.name})`,
            subtitle: `${s.targetWaterL || 80} L • ${recipe.name}`,
            status,
            recipeName: recipe.name,
            targetWaterL: s.targetWaterL || 80,
            dosingAml: s.dosingAml || 120,
            dosingBml: s.dosingBml || 120,
            repeatRule: s.repeat || (s.trigger === "interval" ? `Setiap ${s.intervalHours || 4} Jam` : "Setiap Hari"),
            occurrenceIndex: oIdx + 1,
            totalOccurrences: occTimes.length,
          });
        });
      });

      return events;
    }

    // Helper: compute Fan occurrences and ambient badge for a given Greenhouse on selectedDate
    function getGhFanOccurrences(ghId: string, ghCode: string): {
      events: TimelineRawEvent[];
      ambientBadge?: string;
    } {
      const schedules = scheduleService.fanForGh(ghId);
      const events: TimelineRawEvent[] = [];
      let ambientBadge: string | undefined = undefined;

      schedules.forEach((s) => {
        if (!s.enabled) return;

        // If Fan is in Temperature mode, it has NO discrete grid time blocks: render as ambient regulation badge
        if (s.mode === "temperature") {
          const onC = s.onAboveC ?? 30;
          const offC = s.offBelowC ?? 28;
          ambientBadge = `⚡ Auto Fan: ON > ${onC}°C / OFF < ${offC}°C`;
          return;
        }

        // Time-based Fan schedule
        if (!s.time || s.time === "--:--") return;
        if (!isScheduleActiveOnDate(s, selectedDate, clock.date)) return;

        const occTimes = expandIntervalTimes(s.time, undefined, undefined);
        occTimes.forEach((occTime, oIdx) => {
          const startMin = parseClockToMinutes(occTime);
          const duration = s.durationMin || 60;
          const endMin = startMin + duration;

          let status: PlacedTimelineEvent["status"] = "scheduled";
          if (isToday) {
            const isRunning = currentMinutes >= startMin && currentMinutes < endMin;
            const isPast = endMin < currentMinutes;
            status = isRunning ? "running" : isPast ? "completed" : "scheduled";
          } else if (offsetDays < 0) {
            status = "completed";
          } else {
            status = "scheduled";
          }

          events.push({
            id: `fan-${ghId}-${s.id}-${oIdx}`,
            sourceScheduleId: s.id,
            scheduleType: "fan",
            sourceScope: "greenhouse",
            greenhouseId: ghId,
            greenhouseCode: ghCode,
            time: occTime,
            endTime: formatMinutesToClock(endMin),
            durationMin: duration,
            title: "Fan Circulation",
            subtitle: `${duration} min airflow`,
            status,
            fanMode: "time",
            repeatRule: s.repeat || "Setiap Hari",
            occurrenceIndex: oIdx + 1,
            totalOccurrences: occTimes.length,
          });
        });
      });

      return { events, ambientBadge };
    }

    // Helper: compute Lighting occurrences for a given Greenhouse on selectedDate (Dedicated OFF-only)
    function getGhLightingOccurrences(ghId: string, ghCode: string): TimelineRawEvent[] {
      const schedules = scheduleService.lightingForGh(ghId);
      const events: TimelineRawEvent[] = [];

      schedules.forEach((s) => {
        if (!s.enabled || !s.time || s.time === "--:--") return;
        if (!isScheduleActiveOnDate(s, selectedDate, clock.date)) return;

        const occTimes = expandIntervalTimes(s.time, undefined, undefined);
        occTimes.forEach((occTime, oIdx) => {
          const startMin = parseClockToMinutes(occTime);
          const duration = 30; // 30-min block for clear visual footprint on timeline
          const endMin = startMin + duration;

          let status: PlacedTimelineEvent["status"] = "scheduled";
          if (isToday) {
            const isRunning = currentMinutes >= startMin && currentMinutes < endMin;
            const isPast = endMin < currentMinutes;
            status = isRunning ? "running" : isPast ? "completed" : "scheduled";
          } else if (offsetDays < 0) {
            status = "completed";
          } else {
            status = "scheduled";
          }

          events.push({
            id: `light-${ghId}-${s.id}-${oIdx}`,
            sourceScheduleId: s.id,
            scheduleType: "lighting",
            sourceScope: "greenhouse",
            greenhouseId: ghId,
            greenhouseCode: ghCode,
            time: occTime,
            endTime: formatMinutesToClock(endMin),
            durationMin: duration,
            title: s.name || "Lamp Turn OFF",
            subtitle: `OFF @ ${occTime} • Relay IN3`,
            status,
            lightingAction: "OFF",
            actuatorChannel: "Relay IN3 (GPIO 10)",
            repeatRule: s.repeat || "Every Day",
            occurrenceIndex: oIdx + 1,
            totalOccurrences: occTimes.length,
          });
        });
      });

      return events;
    }

    // ---------------- MODE 1: COMPLEX OVERVIEW ----------------
    // Grouping: GREENHOUSE rows (Fertigation + Fan + Lighting) + ONE shared Complex Well Pump row
    if (mode === "complex") {
      const complexRows: TimelineRow[] = [];

      // 1. Greenhouse rows (Fertigation + Fan + Lighting, do NOT repeat Well Pump here)
      if (activeFilter !== "pump") {
        ghs.forEach((gh, idx) => {
          const ghFert = getGhFertOccurrences(gh.id, gh.code);
          const { events: ghFan, ambientBadge: ghAmbientBadge } = getGhFanOccurrences(gh.id, gh.code);
          const ghLight = getGhLightingOccurrences(gh.id, gh.code);

          let combinedGhEvents: TimelineRawEvent[] = [];
          if (activeFilter === "all") {
            combinedGhEvents = [...ghFert, ...ghFan, ...ghLight];
          } else if (activeFilter === "fertigation") {
            combinedGhEvents = ghFert;
          } else if (activeFilter === "fan") {
            combinedGhEvents = ghFan;
          } else if (activeFilter === "lighting") {
            combinedGhEvents = ghLight;
          }

          const { placed, laneCount } = assignLanesToEvents(combinedGhEvents);

          complexRows.push({
            id: gh.id,
            key: gh.id,
            label: formatGreenhouseName(gh, idx),
            subtitle: `${gh.crop || "Crops"} • Fert + Fan + Lighting`,
            rowKind: "greenhouse",
            colorTone: "emerald",
            events: placed,
            laneCount,
            ambientBadge: ghAmbientBadge,
          });
        });
      }

      // 2. Exactly ONE shared Well Pump row for the entire Complex
      if (activeFilter === "all" || activeFilter === "pump") {
        const { placed: placedPump, laneCount: pumpLanes } = assignLanesToEvents(
          authoritativeWellPumpOccurrences
        );
        complexRows.push({
          id: `complex-shared-pump-${activeComplex.id}`,
          key: "pump",
          label: "Well Pump Schedule",
          subtitle: `Shared Complex Resource • ${activeComplex.code}`,
          rowKind: "scheduleType",
          scheduleType: "pump",
          colorTone: "cyan",
          events: placedPump,
          laneCount: pumpLanes,
        });
      }

      return { rows: complexRows, filterOptions: filters };
    }

    // ---------------- MODE 2: GREENHOUSE DETAIL PAGE ----------------
    // Primary Grouping: SCHEDULE TYPE (Fertigation, Well Pump, Fan, Lighting)
    if (mode === "gh") {
      const ghRows: TimelineRow[] = [];
      const ghFert = getGhFertOccurrences(activeGh.id, activeGh.code);
      const { events: ghFan, ambientBadge: ghAmbientBadge } = getGhFanOccurrences(
        activeGh.id,
        activeGh.code
      );
      const ghLight = getGhLightingOccurrences(activeGh.id, activeGh.code);

      // Row 1: Fertigation Schedule
      if (activeFilter === "all" || activeFilter === "fertigation") {
        const { placed, laneCount } = assignLanesToEvents(ghFert);
        ghRows.push({
          id: `gh-${activeGh.id}-row-fertigation`,
          key: "fertigation",
          label: "Fertigation Schedule",
          subtitle: `${activeGh.code} Nutrient delivery`,
          rowKind: "scheduleType",
          scheduleType: "fertigation",
          colorTone: "emerald",
          events: placed,
          laneCount,
        });
      }

      // Row 2: Well Pump Schedule (Shared Complex Resource projected to GH)
      if (activeFilter === "all" || activeFilter === "pump") {
        const { placed, laneCount } = assignLanesToEvents(authoritativeWellPumpOccurrences);
        ghRows.push({
          id: `gh-${activeGh.id}-row-pump`,
          key: "pump",
          label: "Well Pump Schedule",
          subtitle: `Shared Complex Resource • ${activeComplex.code}`,
          rowKind: "scheduleType",
          scheduleType: "pump",
          colorTone: "cyan",
          events: placed,
          laneCount,
        });
      }

      // Row 3: Fan Schedule
      if (activeFilter === "all" || activeFilter === "fan") {
        const { placed, laneCount } = assignLanesToEvents(ghFan);
        ghRows.push({
          id: `gh-${activeGh.id}-row-fan`,
          key: "fan",
          label: "Fan Schedule",
          subtitle: `${activeGh.code} Airflow circulation`,
          rowKind: "scheduleType",
          scheduleType: "fan",
          colorTone: "amber",
          events: placed,
          laneCount,
          ambientBadge: ghAmbientBadge,
        });
      }

      // Row 4: Lighting Schedule (Dedicated OFF-Only)
      if (activeFilter === "all" || activeFilter === "lighting") {
        const { placed, laneCount } = assignLanesToEvents(ghLight);
        ghRows.push({
          id: `gh-${activeGh.id}-row-lighting`,
          key: "lighting",
          label: "Lighting Schedule (OFF-Only)",
          subtitle: `${activeGh.code} Lamp safety shutdown • Relay IN3`,
          rowKind: "scheduleType",
          scheduleType: "lighting",
          colorTone: "violet",
          events: placed,
          laneCount,
        });
      }

      return { rows: ghRows, filterOptions: filters };
    }

    // ---------------- MODE 3: SCHEDULE PAGE (TAB / CONTEXT DRIVEN) ----------------
    const scheduleRows: TimelineRow[] = [];

    if (activeFilter === "pump" || propCategory === "pump") {
      // Well Pump tab: Shows authoritative Complex Well Pump
      const { placed, laneCount } = assignLanesToEvents(authoritativeWellPumpOccurrences);
      scheduleRows.push({
        id: "schedule-tab-pump",
        key: "pump",
        label: "Well Pump Schedule",
        subtitle: `${activeComplex.code} Raw Water Supply`,
        rowKind: "scheduleType",
        scheduleType: "pump",
        colorTone: "cyan",
        events: placed,
        laneCount,
      });
    } else if (activeFilter === "fan" || propCategory === "fan") {
      // Fan tab: Shows Fan schedule for active GH or all GHs
      if (propGhId) {
        const { events: ghFan, ambientBadge: ghAmbientBadge } = getGhFanOccurrences(
          activeGh.id,
          activeGh.code
        );
        const { placed, laneCount } = assignLanesToEvents(ghFan);
        scheduleRows.push({
          id: `schedule-tab-fan-${activeGh.id}`,
          key: "fan",
          label: `Fan Schedule — ${activeGh.code}`,
          subtitle: "Airflow circulation",
          rowKind: "scheduleType",
          scheduleType: "fan",
          colorTone: "amber",
          events: placed,
          laneCount,
          ambientBadge: ghAmbientBadge,
        });
      } else {
        ghs.forEach((gh) => {
          const { events: ghFan, ambientBadge: ghAmbientBadge } = getGhFanOccurrences(
            gh.id,
            gh.code
          );
          const { placed, laneCount } = assignLanesToEvents(ghFan);
          scheduleRows.push({
            id: `schedule-tab-fan-${gh.id}`,
            key: `fan-${gh.id}`,
            label: `Fan Schedule — ${gh.code}`,
            subtitle: "Airflow circulation",
            rowKind: "scheduleType",
            scheduleType: "fan",
            colorTone: "amber",
            events: placed,
            laneCount,
            ambientBadge: ghAmbientBadge,
          });
        });
      }
    } else if (activeFilter === "lighting" || propCategory === "lighting") {
      // Lighting tab: Shows Lighting schedule for active GH or all GHs (Dedicated OFF-only)
      if (propGhId) {
        const ghLight = getGhLightingOccurrences(activeGh.id, activeGh.code);
        const { placed, laneCount } = assignLanesToEvents(ghLight);
        scheduleRows.push({
          id: `schedule-tab-lighting-${activeGh.id}`,
          key: "lighting",
          label: `Lighting Schedule (OFF-Only) — ${activeGh.code}`,
          subtitle: "Dedicated Relay IN3 • Safe OFF",
          rowKind: "scheduleType",
          scheduleType: "lighting",
          colorTone: "violet",
          events: placed,
          laneCount,
        });
      } else {
        ghs.forEach((gh) => {
          const ghLight = getGhLightingOccurrences(gh.id, gh.code);
          const { placed, laneCount } = assignLanesToEvents(ghLight);
          scheduleRows.push({
            id: `schedule-tab-lighting-${gh.id}`,
            key: `lighting-${gh.id}`,
            label: `Lighting Schedule (OFF-Only) — ${gh.code}`,
            subtitle: "Dedicated Relay IN3 • Safe OFF",
            rowKind: "scheduleType",
            scheduleType: "lighting",
            colorTone: "violet",
            events: placed,
            laneCount,
          });
        });
      }
    } else {
      // Fertigation tab or All Schedules tab:
      // If scoped to a specific GH, show schedule types; if Complex-wide, show GH rows then ONE shared Well Pump row
      if (propGhId) {
        const ghFert = getGhFertOccurrences(activeGh.id, activeGh.code);
        const { placed, laneCount } = assignLanesToEvents(ghFert);
        scheduleRows.push({
          id: `schedule-tab-fert-${activeGh.id}`,
          key: "fertigation",
          label: `Fertigation Schedule — ${activeGh.code}`,
          subtitle: "Target nutrient delivery",
          rowKind: "scheduleType",
          scheduleType: "fertigation",
          colorTone: "emerald",
          events: placed,
          laneCount,
        });

        const { placed: placedPump, laneCount: pumpLanes } = assignLanesToEvents(
          authoritativeWellPumpOccurrences
        );
        scheduleRows.push({
          id: `schedule-tab-pump-${activeGh.id}`,
          key: "pump",
          label: "Well Pump Schedule",
          subtitle: `Shared Complex Resource • ${activeComplex.code}`,
          rowKind: "scheduleType",
          scheduleType: "pump",
          colorTone: "cyan",
          events: placedPump,
          laneCount: pumpLanes,
        });

        const ghLight = getGhLightingOccurrences(activeGh.id, activeGh.code);
        const { placed: placedLight, laneCount: lightLanes } = assignLanesToEvents(ghLight);
        scheduleRows.push({
          id: `schedule-tab-lighting-${activeGh.id}`,
          key: "lighting",
          label: `Lighting Schedule (OFF-Only) — ${activeGh.code}`,
          subtitle: "Dedicated Relay IN3 • Safe OFF",
          rowKind: "scheduleType",
          scheduleType: "lighting",
          colorTone: "violet",
          events: placedLight,
          laneCount: lightLanes,
        });
      } else {
        if (activeFilter !== "pump") {
          ghs.forEach((gh, idx) => {
            const ghFert = getGhFertOccurrences(gh.id, gh.code);
            const { events: ghFan } = getGhFanOccurrences(gh.id, gh.code);
            const ghLight = getGhLightingOccurrences(gh.id, gh.code);
            let evs: TimelineRawEvent[] = [];
            if (activeFilter === "all") evs = [...ghFert, ...ghFan, ...ghLight];
            else if (activeFilter === "fertigation") evs = ghFert;
            else if (activeFilter === "fan") evs = ghFan;
            else if (activeFilter === "lighting") evs = ghLight;

            const { placed, laneCount } = assignLanesToEvents(evs);
            scheduleRows.push({
              id: `schedule-tab-gh-${gh.id}`,
              key: gh.id,
              label: formatGreenhouseName(gh, idx),
              subtitle: `${gh.crop || "Crops"} • Fert + Fan + Lighting`,
              rowKind: "greenhouse",
              colorTone: "emerald",
              events: placed,
              laneCount,
            });
          });
        }

        if (activeFilter === "all" || activeFilter === "pump") {
          const { placed: placedPump, laneCount: pumpLanes } = assignLanesToEvents(
            authoritativeWellPumpOccurrences
          );
          scheduleRows.push({
            id: `schedule-tab-pump-${activeComplex.id}`,
            key: "pump",
            label: "Well Pump Schedule",
            subtitle: `Shared Complex Resource • ${activeComplex.code}`,
            rowKind: "scheduleType",
            scheduleType: "pump",
            colorTone: "cyan",
            events: placedPump,
            laneCount: pumpLanes,
          });
        }
      }
    }

    return { rows: scheduleRows, filterOptions: filters };
  }, [
    mode,
    activeComplex.id,
    activeComplex.code,
    activeGh.id,
    activeGh.code,
    activeGh.recipes,
    ghs,
    selectedDate,
    activeFilter,
    propCategory,
    propGhId,
    currentMinutes,
    isToday,
    offsetDays,
  ]);

  // Center / scroll to Now marker
  const handleScrollToNow = () => {
    setOffsetDays(0);
    if (!scrollContainerRef.current) return;
    const scrollEl = scrollContainerRef.current;
    const targetScroll = nowFraction * scrollEl.scrollWidth - scrollEl.clientWidth / 2;
    scrollEl.scrollTo({ left: Math.max(0, targetScroll), behavior: "smooth" });
  };

  const handleScrollStep = (direction: "left" | "right") => {
    if (!scrollContainerRef.current) return;
    const scrollEl = scrollContainerRef.current;
    const step = scrollEl.clientWidth * 0.35;
    scrollEl.scrollBy({ left: direction === "left" ? -step : step, behavior: "smooth" });
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    const chosen = new Date(e.target.value);
    if (isNaN(chosen.getTime())) return;
    const diffMs = chosen.getTime() - clock.date.getTime();
    const diffDays = Math.round(diffMs / 86400000);
    setOffsetDays(diffDays);
  };

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-800 bg-[#0a1320] shadow-[0_18px_55px_rgba(0,0,0,0.38)] ${className}`}
    >
      {/* ---------------- Header Bar with Date Navigation & Filters ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-[#0b1626] px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-400/25 bg-blue-500/10 text-blue-400 shadow-sm">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold tracking-tight text-slate-100">
              Schedule Timeline
            </h2>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] font-medium text-slate-400">
              <span className="font-semibold text-slate-300">{activeComplex.code}</span>
              <span>•</span>
              <span className="text-blue-300 font-semibold">{fullDateText}</span>
              {isToday && (
                <span className="rounded bg-blue-500/20 px-1.5 py-0.2 text-[9px] font-bold text-blue-300 border border-blue-500/30">
                  LIVE
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action & Navigation Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Navigation: [Today] [ < ] [ Date Display ] [ > ] */}
          <div className="flex items-center rounded-lg border border-slate-700/80 bg-[#0f2136] p-0.5 shadow-sm">
            <button
              type="button"
              onClick={handleScrollToNow}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                isToday
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
              title="Return to Today"
            >
              Today
            </button>

            <button
              type="button"
              onClick={() => setOffsetDays((d) => d - 1)}
              aria-label="Previous day"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-300 transition hover:bg-slate-800 hover:text-white"
              title="Previous Day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            {/* Date Display with Hidden Picker Trigger */}
            <div className="relative">
              <button
                type="button"
                onClick={() => dateInputRef.current?.showPicker?.()}
                className="cursor-pointer px-2 py-1 text-xs font-bold text-slate-200 hover:text-blue-300 transition flex items-center gap-1"
                title="Click to jump to date"
              >
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                <span>{dateDisplayLabel}</span>
              </button>
              <input
                ref={dateInputRef}
                type="date"
                value={toIsoDate(selectedDate)}
                onChange={handleDateChange}
                className="pointer-events-none absolute left-0 top-0 opacity-0 h-0 w-0"
                tabIndex={-1}
              />
            </div>

            <button
              type="button"
              onClick={() => setOffsetDays((d) => d + 1)}
              aria-label="Next day"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-300 transition hover:bg-slate-800 hover:text-white"
              title="Next Day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Horizontal Grid Scroll Arrows */}
          <div className="flex items-center rounded-lg border border-slate-700/80 bg-[#0f2136] p-0.5">
            <button
              type="button"
              onClick={() => handleScrollStep("left")}
              aria-label="Scroll grid earlier"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-300 transition hover:bg-slate-800 hover:text-white"
              title="Scroll Earlier"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => handleScrollStep("right")}
              aria-label="Scroll grid later"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-300 transition hover:bg-slate-800 hover:text-white"
              title="Scroll Later"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Filter Dropdown (All Schedules, Fertigation, Well Pump, Fan) */}
          <div className="relative">
            <select
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value)}
              aria-label="Filter schedule types"
              className="cursor-pointer appearance-none rounded-lg border border-slate-700/80 bg-[#0f2136] py-1.5 pl-3 pr-8 text-xs font-semibold text-slate-200 outline-none transition hover:border-blue-400/40 hover:bg-[#132840]"
            >
              {filterOptions.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-[#0b1626] text-slate-200">
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </div>
        </div>
      </div>

      {/* ---------------- Main Timeline Scroll Area ---------------- */}
      <div
        ref={scrollContainerRef}
        className="relative overflow-x-auto scroll-smooth select-none scroll-thin"
      >
        <div className="min-w-[1180px] p-4">
          {/* Time Header Grid Axis (00:00 - 24:00) */}
          <div className="grid grid-cols-[180px_1fr] items-center pb-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 pl-2">
              {mode === "complex" ? "Greenhouse" : "Schedule Type"}
            </div>
            <div className="relative h-6">
              {HOURS_AXIS.map((hour) => {
                const pct = (hour / 24) * 100;
                return (
                  <div
                    key={hour}
                    className="absolute -translate-x-1/2 text-[10px] font-semibold text-slate-400/90"
                    style={{ left: `${pct}%` }}
                  >
                    {String(hour).padStart(2, "0")}:00
                  </div>
                );
              })}
            </div>
          </div>

          {/* Timeline Grid Body */}
          <div className="relative rounded-xl border border-slate-800/90 bg-[#09121f]">
            {/* Background Vertical Time Grid Lines */}
            <div className="pointer-events-none absolute inset-y-0 left-[180px] right-0 z-0">
              {HOURS_AXIS.map((hour) => {
                const pct = (hour / 24) * 100;
                return (
                  <span
                    key={hour}
                    className="absolute inset-y-0 border-l border-slate-800/60"
                    style={{ left: `${pct}%` }}
                  />
                );
              })}
            </div>

            {/* Rows */}
            <div className="relative z-10 divide-y divide-slate-800/70">
              {rows.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No active schedules found for this date.
                </div>
              ) : (
                rows.map((row) => {
                  const toneClasses = getCategoryToneClasses(row.colorTone);
                  const rowLaneHeight = 46;
                  const rowHeight = Math.max(56, row.laneCount * rowLaneHeight + 10);

                  return (
                    <div
                      key={row.id}
                      className={`grid grid-cols-[180px_1fr] items-center transition-colors ${toneClasses.rowBg}`}
                      style={{ minHeight: `${rowHeight}px` }}
                    >
                      {/* Left Column Label & Ambient Badge */}
                      <div className="flex flex-col justify-center border-r border-slate-800/80 px-3 py-2 h-full">
                        <div className="flex items-center gap-2">
                          <span className={`shrink-0 ${toneClasses.icon}`}>
                            {renderRowIcon(row.rowKind, row.scheduleType)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate text-xs font-bold text-slate-200"
                              title={row.label}
                            >
                              {row.label}
                            </div>
                            {row.subtitle && (
                              <div
                                className="truncate text-[10px] text-slate-400"
                                title={row.subtitle}
                              >
                                {row.subtitle}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Ambient Regulation Badge (e.g. Temperature-controlled Fan) */}
                        {row.ambientBadge && (
                          <div
                            className="mt-1.5 inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300 truncate"
                            title={row.ambientBadge}
                          >
                            <Sparkles className="h-2.5 w-2.5 shrink-0 text-amber-400" />
                            <span className="truncate">{row.ambientBadge}</span>
                          </div>
                        )}
                      </div>

                      {/* Right Column Events Container */}
                      <div
                        className="relative h-full w-full"
                        style={{ minHeight: `${rowHeight}px` }}
                      >
                        {row.events.length === 0 ? (
                          <div className="flex h-full items-center pl-4 text-[10px] italic text-slate-600">
                            No discrete occurrences scheduled on this date
                          </div>
                        ) : (
                          row.events.map((event) => {
                            const topPx = 7 + event.laneIndex * rowLaneHeight;
                            const eventTone = getCategoryToneClasses(
                              event.scheduleType === "fertigation"
                                ? "emerald"
                                : event.scheduleType === "pump"
                                ? "cyan"
                                : event.scheduleType === "lighting"
                                ? "violet"
                                : "amber"
                            );

                            const isHovered =
                              hoveredEvent?.id === event.id || selectedEvent?.id === event.id;

                            return (
                              <div
                                key={event.id}
                                onMouseEnter={() => setHoveredEvent(event)}
                                onMouseLeave={() => setHoveredEvent(null)}
                                onClick={() =>
                                  setSelectedEvent(selectedEvent?.id === event.id ? null : event)
                                }
                                className={`group absolute cursor-pointer rounded-lg border px-2 py-1 transition-all ${
                                  eventTone.card
                                } ${
                                  event.status === "running"
                                    ? "ring-2 ring-blue-400/50 shadow-[0_0_18px_rgba(59,130,246,0.35)] animate-pulse"
                                    : ""
                                } ${isHovered ? "z-30 ring-2 ring-white/60 brightness-110" : "z-10"}`}
                                style={{
                                  left: `${event.leftPct}%`,
                                  width: `calc(${event.widthPct}% - 4px)`,
                                  minWidth: "76px",
                                  top: `${topPx}px`,
                                  height: "38px",
                                }}
                                title={`${event.title}: ${event.time} – ${event.endTime || ""} (${event.displayDurationMin} min)`}
                              >
                                <div className="flex h-full flex-col justify-center overflow-hidden">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="truncate text-[10px] font-bold text-slate-100 flex items-center gap-1">
                                      {renderEventIcon(event.scheduleType)}
                                      <span>
                                        {event.time}
                                        {event.endTime
                                          ? ` – ${event.endTime}`
                                          : ` – ${formatMinutesToClock(event.startMinutes + event.displayDurationMin)}`}
                                      </span>
                                    </span>

                                    {/* Shared Resource Badge */}
                                    {event.isSharedResource && (
                                      <span
                                        className="shrink-0 rounded bg-cyan-400/20 px-1 py-0.2 text-[8px] font-bold text-cyan-200 border border-cyan-400/40"
                                        title="Complex-wide shared resource"
                                      >
                                        SHARED
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center justify-between gap-1">
                                    <span className="truncate text-[9px] font-medium text-slate-300/90">
                                      {event.title}
                                    </span>
                                    <span className="shrink-0 text-[8px] text-slate-400">
                                      {event.displayDurationMin}m
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Vertical "Now" Marker Line — STRICTLY GATED ON isToday */}
            {isToday && (
              <div
                className="pointer-events-none absolute bottom-0 top-0 z-20 -translate-x-1/2"
                style={{ left: `calc(180px + (${nowPct} * (100% - 180px) / 100))` }}
              >
                {/* Top Time Badge */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-blue-600 px-2 py-0.5 text-[9px] font-bold text-white shadow-[0_0_14px_rgba(59,130,246,0.7)]">
                  {formatMinutesToClock(currentMinutes)}
                </div>

                {/* Dashed Line */}
                <div className="h-full w-0 border-l-2 border-dashed border-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.6)]" />

                {/* Bottom "Now" Badge */}
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-blue-600 px-2.5 py-0.5 text-[9px] font-bold text-white shadow-[0_0_14px_rgba(59,130,246,0.7)]">
                  Now
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- Tooltip / Details Popover ---------------- */}
      {(hoveredEvent || selectedEvent) && (
        <TimelineDetailPopover
          event={(hoveredEvent || selectedEvent)!}
          onClose={() => {
            setHoveredEvent(null);
            setSelectedEvent(null);
          }}
        />
      )}

      {/* ---------------- Bottom Mini-Map Scrubber ---------------- */}
      <div className="border-t border-slate-800/80 bg-[#08101c] px-4 py-2.5">
        <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
        <div className="relative mt-1.5 h-3 w-full rounded-full border border-slate-800 bg-[#0a1526]">
          {isToday && (
            <>
              {/* Active indicator bar */}
              <div
                className="absolute top-0 bottom-0 rounded-full bg-blue-500/25 border border-blue-400/50"
                style={{
                  left: `${Math.max(0, nowPct - 12)}%`,
                  width: "24%",
                }}
              />
              {/* Current Now indicator */}
              <div
                className="absolute top-[-2px] bottom-[-2px] w-1 -translate-x-1/2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.9)]"
                style={{ left: `${nowPct}%` }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function renderRowIcon(rowKind: "greenhouse" | "scheduleType", scheduleType?: ScheduleType) {
  if (rowKind === "greenhouse") {
    return <Building2 className="h-4 w-4" />;
  }
  switch (scheduleType) {
    case "fertigation":
      return <Leaf className="h-4 w-4" />;
    case "pump":
      return <Waves className="h-4 w-4" />;
    case "fan":
      return <Fan className="h-4 w-4" />;
    case "lighting":
      return <Lightbulb className="h-4 w-4" />;
    default:
      return <Calendar className="h-4 w-4" />;
  }
}

function renderEventIcon(scheduleType: ScheduleType) {
  switch (scheduleType) {
    case "fertigation":
      return <Leaf className="h-3 w-3 shrink-0 text-emerald-400" />;
    case "pump":
      return <Waves className="h-3 w-3 shrink-0 text-cyan-400" />;
    case "fan":
      return <Fan className="h-3 w-3 shrink-0 text-amber-400" />;
    case "lighting":
      return <Lightbulb className="h-3 w-3 shrink-0 text-violet-400" />;
    default:
      return null;
  }
}

function TimelineDetailPopover({
  event,
  onClose,
}: {
  event: PlacedTimelineEvent;
  onClose: () => void;
}) {
  return (
    <div className="border-t border-slate-800/80 bg-[#0d1c2e] p-4 text-xs text-slate-200 transition-all">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/20 text-blue-400">
              {renderEventIcon(event.scheduleType)}
            </span>
            <span className="font-bold text-slate-100 text-sm">{event.title}</span>
            {event.greenhouseCode && (
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                {event.greenhouseCode}
              </span>
            )}
            {event.isSharedResource && (
              <span className="rounded bg-cyan-500/20 border border-cyan-400/40 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                Shared Complex Resource
              </span>
            )}
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                event.status === "running"
                  ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                  : event.status === "completed"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : event.status === "missed"
                  ? "bg-red-500/20 text-red-300 border border-red-500/40"
                  : "bg-slate-700/40 text-slate-300"
              }`}
            >
              {event.status}
            </span>
          </div>

          <div className="text-slate-400">
            {event.time}
            {event.endTime
              ? ` – ${event.endTime}`
              : ` – ${formatMinutesToClock(event.startMinutes + event.displayDurationMin)}`}{" "}
            ({event.displayDurationMin} min)
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer text-slate-400 hover:text-white p-1"
          title="Tutup detail"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Detail Parameters */}
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-4 border-t border-slate-800/70 pt-2.5">
        {event.recipeName && (
          <div>
            <span className="text-slate-400">Recipe:</span>{" "}
            <span className="font-semibold text-slate-100">{event.recipeName}</span>
          </div>
        )}
        {event.targetWaterL !== undefined && (
          <div>
            <span className="text-slate-400">Target Water:</span>{" "}
            <span className="font-semibold text-slate-100">{event.targetWaterL} L</span>
          </div>
        )}
        {event.dosingAml !== undefined && (
          <div>
            <span className="text-slate-400">Dosing A:</span>{" "}
            <span className="font-semibold text-slate-100">{event.dosingAml} ml</span>
          </div>
        )}
        {event.dosingBml !== undefined && (
          <div>
            <span className="text-slate-400">Dosing B:</span>{" "}
            <span className="font-semibold text-slate-100">{event.dosingBml} ml</span>
          </div>
        )}
        {event.radarState && (
          <div>
            <span className="text-slate-400">Radar Tank:</span>{" "}
            <span className="font-semibold text-slate-100">{event.radarState}</span>
          </div>
        )}
        {event.repeatRule && (
          <div>
            <span className="text-slate-400">Recurrence:</span>{" "}
            <span className="font-semibold text-slate-100">{event.repeatRule}</span>
          </div>
        )}
        {event.lightingAction && (
          <div>
            <span className="text-slate-400">Action:</span>{" "}
            <span className="font-semibold text-violet-300">Turn OFF (Padam)</span>
          </div>
        )}
        {event.actuatorChannel && (
          <div>
            <span className="text-slate-400">Actuator:</span>{" "}
            <span className="font-semibold text-slate-100">{event.actuatorChannel}</span>
          </div>
        )}
        {event.totalOccurrences && event.totalOccurrences > 1 && (
          <div>
            <span className="text-slate-400">Occurrence:</span>{" "}
            <span className="font-semibold text-slate-100">
              {event.occurrenceIndex} / {event.totalOccurrences}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export const TodayScheduleTimeline = React.memo(TodayScheduleTimelineComponent);
