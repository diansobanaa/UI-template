/**
 * TimelineEngine.ts
 *
 * Authoritative layout, occurrence evaluation, and lane packing engine for AgroTech Schedule Timeline.
 *
 * Rules:
 * 1. Schedule Types are the canonical categories:
 *    - "fertigation": Fertigation Schedule
 *    - "pump": Well Pump Schedule (Shared Complex resource projected to GH)
 *    - "fan": Fan Schedule (Time-based occurrences or ambient temperature regulation)
 * 2. Recurrence evaluation strictly follows existing Add Schedule configuration:
 *    - Specific Time, Days of Week, Interval, Specific Date
 *    - Bitmask: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64
 * 3. Future dates supported via deterministic date recurrence matching.
 * 4. Zero duplicate schedule definitions: Well Pump is Complex-scoped, projected visually to GH.
 * 5. Collision-free greedy lane assignment guarantees overlapping events never share the same lane.
 */

import type { FertigationSchedule, WellPumpSchedule, FanSchedule, RepeatMode } from "@/lib/types";

export type TimelineMode = "complex" | "gh" | "schedule";
export type ScheduleType = "fertigation" | "pump" | "fan" | "lighting";

export interface TimelineRawEvent {
  id: string;
  sourceScheduleId: string;
  scheduleType: ScheduleType;
  time: string; // "HH:MM"
  endTime?: string; // "HH:MM"
  durationMin: number;
  greenhouseId?: string;
  greenhouseCode: string;
  title: string;
  subtitle?: string;
  status: "completed" | "running" | "scheduled" | "missed" | "blocked" | "disabled";
  isSharedResource?: boolean; // True for Complex-level Well Pump projected to GH
  sourceScope: "complex" | "greenhouse";
  occurrenceIndex?: number;
  totalOccurrences?: number;
  // Metadata for inspection popover
  recipeName?: string;
  targetWaterL?: number;
  dosingAml?: number;
  dosingBml?: number;
  dosingChannels?: Array<{ componentId: string; requestedMl: number }>;
  radarState?: string;
  repeatRule?: string;
  fanMode?: "time" | "temperature";
  temperatureRule?: string;
  lightingAction?: "OFF";
  actuatorChannel?: string;
}

export interface PlacedTimelineEvent extends TimelineRawEvent {
  startMinutes: number; // 0..1440
  endMinutes: number; // 0..1440
  displayDurationMin: number;
  laneIndex: number;
  leftPct: number;
  widthPct: number;
}

export interface TimelineRow {
  id: string;
  key: string;
  label: string;
  subtitle?: string;
  rowKind: "greenhouse" | "scheduleType";
  scheduleType?: ScheduleType;
  colorTone: "violet" | "cyan" | "emerald" | "amber" | "blue";
  events: PlacedTimelineEvent[];
  laneCount: number;
  ambientBadge?: string; // E.g. "⚡ Auto Fan: ON > 30°C / OFF < 28°C"
}

/**
 * Converts "HH:MM" string to minutes from midnight (0..1439).
 */
export function parseClockToMinutes(timeStr: string): number {
  if (!timeStr || typeof timeStr !== "string" || timeStr === "--:--") return 0;
  const parts = timeStr.trim().split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const validH = Number.isFinite(h) ? Math.max(0, Math.min(23, h)) : 0;
  const validM = Number.isFinite(m) ? Math.max(0, Math.min(59, m)) : 0;
  return validH * 60 + validM;
}

/**
 * Formats minutes from midnight to "HH:MM".
 */
export function formatMinutesToClock(totalMinutes: number): string {
  const normalized = Math.max(0, Math.round(totalMinutes)) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Formats Date object to "YYYY-MM-DD" ISO date string for matching.
 */
export function toIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Evaluates whether a schedule runs on a given target calendar date
 * based on the canonical recurrence model used by Add Schedule and repeatToTrigger().
 */
export function isScheduleActiveOnDate(
  item: {
    enabled?: boolean;
    trigger?: string;
    repeat?: string | RepeatMode;
    date?: string;
    days?: string[];
    nextRun?: string | null;
  },
  targetDate: Date,
  referenceDate: Date = new Date()
): boolean {
  if (item.enabled === false) return false;

  const targetIso = toIsoDate(targetDate);
  const trigger = (item.trigger || "").toLowerCase();
  const repeat = (item.repeat || "Every Day").toLowerCase();

  // 1. Specific Date / Once trigger
  if (trigger.includes("specific-date") || repeat === "once") {
    if (item.date && item.date.trim()) {
      return item.date.trim() === targetIso;
    }
    // If no explicit date is provided (Fan/WellPump schedules or specific-time + Once),
    // resolve scheduled date via nextRun or default to referenceDate (Today).
    const todayIso = toIsoDate(referenceDate);
    if (item.nextRun) {
      const nr = item.nextRun.toLowerCase();
      if (nr.includes("today") || nr.includes("hari ini")) {
        return targetIso === todayIso;
      }
      if (nr.includes("tomorrow") || nr.includes("besok")) {
        const tomorrow = new Date(referenceDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return targetIso === toIsoDate(tomorrow);
      }
      const dateMatch = item.nextRun.match(/\d{4}-\d{2}-\d{2}/);
      if (dateMatch) {
        return targetIso === dateMatch[0];
      }
    }
    return targetIso === todayIso;
  }

  // 2. Day of Week bitmask evaluation
  // Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64
  const jsDay = targetDate.getDay(); // 0 is Sunday, 1..6 is Mon..Sat
  const dayBit = jsDay === 0 ? 64 : 1 << (jsDay - 1);

  let daysOfWeek = 127; // Default: Every Day
  if (repeat === "every weekday") daysOfWeek = 31; // Mon-Fri
  else if (repeat === "every weekend") daysOfWeek = 96; // Sat-Sun
  else if (repeat === "mon, wed, fri") daysOfWeek = 21; // Mon, Wed, Fri
  else if (repeat === "tue, thu") daysOfWeek = 10; // Tue, Thu
  else if (Array.isArray(item.days) && item.days.length > 0) {
    const dayMap: Record<string, number> = { mon: 1, tue: 2, wed: 4, thu: 8, fri: 16, sat: 32, sun: 64 };
    let mask = 0;
    for (const d of item.days) {
      const code = String(d).toLowerCase().slice(0, 3);
      if (dayMap[code]) mask |= dayMap[code];
    }
    if (mask > 0) daysOfWeek = mask;
  } else if (repeat.includes(",")) {
    // Comma separated days e.g. "Mon, Wed, Fri"
    const dayMap: Record<string, number> = { mon: 1, tue: 2, wed: 4, thu: 8, fri: 16, sat: 32, sun: 64 };
    let mask = 0;
    const parts = repeat.split(",").map((p) => p.trim().toLowerCase().slice(0, 3));
    for (const p of parts) {
      if (dayMap[p]) mask |= dayMap[p];
    }
    if (mask > 0) daysOfWeek = mask;
  }

  return (daysOfWeek & dayBit) !== 0;
}

/**
 * Expands interval schedule times between startTime and endTime.
 */
export function expandIntervalTimes(
  startTimeStr: string,
  endTimeStr?: string,
  intervalMinutes?: number
): string[] {
  if (!startTimeStr || startTimeStr === "--:--") return [];
  if (!intervalMinutes || intervalMinutes <= 0) return [startTimeStr];

  const start = parseClockToMinutes(startTimeStr);
  let end = endTimeStr ? parseClockToMinutes(endTimeStr) : 1440;
  if (end <= start && endTimeStr) {
    end = start;
  }

  const occurrences: string[] = [];
  for (let t = start; t <= end; t += intervalMinutes) {
    if (t >= 1440) break;
    occurrences.push(formatMinutesToClock(t));
  }

  return occurrences.length > 0 ? occurrences : [startTimeStr];
}

/**
 * Greedy collision-free lane assignment algorithm.
 * Guarantees zero collision: overlapping events are assigned to separate lanes,
 * and sequential non-overlapping events share the same lane to minimize vertical space.
 */
export function assignLanesToEvents(
  events: TimelineRawEvent[],
  bufferMinutes: number = 2
): { placed: PlacedTimelineEvent[]; laneCount: number } {
  if (!events || events.length === 0) {
    return { placed: [], laneCount: 1 };
  }

  const items = events.map((event) => {
    const startMinutes = parseClockToMinutes(event.time);
    const duration = Math.max(1, event.durationMin || 30);
    const endMinutes = Math.min(1440, startMinutes + duration);
    const leftPct = (startMinutes / 1440) * 100;
    // Proportional width: 60 min is 2x wider than 30 min.
    // Minimum 2% ensures compact text is readable without clipping.
    const widthPct = Math.max(2.0, (duration / 1440) * 100);

    return {
      ...event,
      startMinutes,
      endMinutes,
      displayDurationMin: duration,
      leftPct,
      widthPct,
    };
  });

  // Sort by start time ascending, then duration descending
  items.sort((a, b) => a.startMinutes - b.startMinutes || b.displayDurationMin - a.displayDurationMin);

  const laneEnds: number[] = [];
  const placed: PlacedTimelineEvent[] = [];

  for (const item of items) {
    const visualFootprintEnd = Math.max(item.endMinutes, item.startMinutes + Math.max(item.displayDurationMin, 30));

    let assignedLane = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (item.startMinutes >= laneEnds[i] + bufferMinutes) {
        assignedLane = i;
        break;
      }
    }

    if (assignedLane === -1) {
      assignedLane = laneEnds.length;
      laneEnds.push(visualFootprintEnd);
    } else {
      laneEnds[assignedLane] = visualFootprintEnd;
    }

    placed.push({
      ...item,
      laneIndex: assignedLane,
    });
  }

  return {
    placed,
    laneCount: Math.max(1, laneEnds.length),
  };
}
