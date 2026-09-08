"use client";

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
  // Give nearby events separate lanes. This keeps dense complex-wide schedules legible.
  const positioned: (TimelineEvent & { pct: number; lane: number })[] = [];
  const laneEnds = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (const event of [...events].sort((a, b) => toMinutes(a.time) - toMinutes(b.time))) {
    const pct = (toMinutes(event.time) / 1440) * 100;
    const lane = laneEnds.findIndex((end) => pct - end >= 10);
    const selectedLane = lane === -1 ? laneEnds.indexOf(Math.min(...laneEnds)) : lane;
    laneEnds[selectedLane] = pct;
    positioned.push({ ...event, pct, lane: selectedLane });
  }

  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  return (
    <div className="overflow-x-auto px-2 pb-1">
      <div className="relative min-w-[1080px] h-[232px]">
        {/* event labels */}
        {positioned.map((e, index) => (
          <div key={`${e.time}-${e.title}-${index}`}>
            <div
              className={`absolute w-28 -translate-x-1/2 rounded-lg border px-2 py-1 text-center shadow-sm ${
                e.status === "running"
                  ? "border-blue-200 bg-blue-50 ring-2 ring-blue-100"
                  : e.status === "missed"
                    ? "border-red-100 bg-red-50/70"
                    : "border-slate-100 bg-white"
              }`}
              style={{ left: `${e.pct}%`, top: 4 + e.lane * 42 }}
            >
              <div className={`text-xs font-bold ${e.status === "running" ? "text-blue-700" : "text-slate-800"}`}>
                {e.time}
              </div>
              <div className={`truncate text-[10px] leading-tight ${LABEL_COLORS[e.status]}`} title={e.title}>{e.title}</div>
              {e.sub && <div className="text-[10px] text-slate-400">{e.sub}</div>}
            </div>
            <span
              className={`absolute w-px bg-slate-200 ${e.status === "running" ? "bg-blue-300" : ""}`}
              style={{ left: `${e.pct}%`, top: 40 + e.lane * 42, height: `${143 - e.lane * 42}px` }}
            />
            {/* dot on axis */}
            <span
              className={`absolute h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white shadow ${DOT_COLORS[e.status]} ${
                e.status === "running" ? "pulse-dot ring-4 ring-blue-100" : ""
              }`}
              style={{ left: `${e.pct}%`, top: 178 }}
            />
          </div>
        ))}

        {/* axis */}
        <div className="absolute left-0 right-0 top-[183px] h-px bg-slate-200" />

        {/* hour ticks */}
        {hours.map((h) => (
          <div key={h} className="absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%`, top: 178 }}>
            <span className="block h-2.5 w-px bg-slate-300" style={{ marginTop: 0 }} />
          </div>
        ))}
        {hours.map((h) => (
          <span
            key={`l-${h}`}
            className="absolute -translate-x-1/2 text-[11px] text-slate-400"
            style={{ left: `${(h / 24) * 100}%`, top: 195 }}
          >
            {String(h).padStart(2, "0")}:00
          </span>
        ))}

        {/* now marker */}
        <div className="absolute -translate-x-1/2" style={{ left: `${nowPct}%`, top: 172 }}>
          <div className="flex flex-col items-center">
            <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Now</span>
            <span className="mt-0.5 h-3 w-px bg-blue-400" />
          </div>
        </div>
      </div>
    </div>
  );
}
