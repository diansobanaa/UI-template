"use client";

import { Fragment } from "react";

export interface TimelineEvent {
  time: string; // "06:00"
  title: string; // "Fertigation"
  sub?: string; // "80 L"
  status: "completed" | "running" | "scheduled" | "missed";
}

const DOT_COLORS: Record<TimelineEvent["status"], string> = {
  completed: "bg-emerald-500",
  running: "bg-blue-500",
  scheduled: "bg-slate-300",
  missed: "bg-red-500",
};

const LABEL_COLORS: Record<TimelineEvent["status"], string> = {
  completed: "text-slate-800",
  running: "text-blue-700",
  scheduled: "text-slate-500",
  missed: "text-red-600",
};

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Horizontal 00:00–24:00 schedule timeline with status dots and "Now" marker. */
export function Timeline({ events, nowPct }: { events: TimelineEvent[]; nowPct: number }) {
  // stagger labels in two rows when events are close together
  const positioned: (TimelineEvent & { pct: number; row: number })[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const pct = (toMinutes(e.time) / 1440) * 100;
    let row = 0;
    if (i > 0) {
      const prev = positioned[i - 1];
      const prevPct = (toMinutes(events[i - 1].time) / 1440) * 100;
      row = pct - prevPct < 7 ? 1 - prev.row : 0;
    }
    positioned.push({ ...e, pct, row });
  }

  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  return (
    <div className="px-2 pb-1">
      <div className="relative h-[150px]">
        {/* event labels */}
        {positioned.map((e) => (
          <Fragment key={e.time + e.title}>
            <div
              className={`absolute w-28 -translate-x-1/2 text-center ${e.status === "running" ? "rounded-lg bg-blue-50 px-1 py-0.5 ring-1 ring-blue-100" : ""}`}
              style={{ left: `${e.pct}%`, top: e.row === 0 ? 4 : 42 }}
            >
              <div className={`text-[13px] font-bold ${e.status === "running" ? "text-blue-700" : "text-slate-800"}`}>
                {e.time}
              </div>
              <div className={`text-[11px] leading-tight ${LABEL_COLORS[e.status]}`}>{e.title}</div>
              {e.sub && <div className="text-[11px] text-slate-400">{e.sub}</div>}
            </div>
            {/* dot on axis */}
            <span
              className={`absolute h-3 w-3 -translate-x-1/2 rounded-full ${DOT_COLORS[e.status]} ${
                e.status === "running" ? "pulse-dot ring-4 ring-blue-100" : ""
              }`}
              style={{ left: `${e.pct}%`, top: 88 }}
            />
          </Fragment>
        ))}

        {/* axis */}
        <div className="absolute left-0 right-0 top-[93.5px] h-px bg-slate-200" />

        {/* hour ticks */}
        {hours.map((h) => (
          <div key={h} className="absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%`, top: 88 }}>
            <span className="block h-2.5 w-px bg-slate-300" style={{ marginTop: 0 }} />
          </div>
        ))}
        {hours.map((h) => (
          <span
            key={`l-${h}`}
            className="absolute -translate-x-1/2 text-[11px] text-slate-400"
            style={{ left: `${(h / 24) * 100}%`, top: 104 }}
          >
            {String(h).padStart(2, "0")}:00
          </span>
        ))}

        {/* now marker */}
        <div className="absolute -translate-x-1/2" style={{ left: `${nowPct}%`, top: 84 }}>
          <div className="flex flex-col items-center">
            <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Now</span>
            <span className="mt-0.5 h-3 w-px bg-blue-400" />
          </div>
        </div>
      </div>
    </div>
  );
}
