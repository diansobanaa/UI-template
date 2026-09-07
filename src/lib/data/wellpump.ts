import type { WellPumpSchedule } from "@/lib/types";

/** Well Pump schedules are Complex-level (raw water tank filling). */
export const wellPumpSchedules: WellPumpSchedule[] = [
  {
    id: "wp-c1-0800",
    complexId: "complex-01",
    task: "Run Well Pump (Fill Raw Tank)",
    time: "08:00",
    durationMin: 30,
    repeat: "Every Day",
    enabled: true,
    status: "completed",
    lastRun: "2 Sep 08:00",
    nextRun: "3 Sep 08:00",
    radar: "filling",
  },
  {
    id: "wp-c2-0700",
    complexId: "complex-02",
    task: "Run Well Pump (Fill Raw Tank)",
    time: "07:00",
    durationMin: 30,
    repeat: "Every Day",
    enabled: true,
    status: "completed",
    lastRun: "2 Sep 07:00",
    nextRun: "3 Sep 07:00",
    radar: "filling",
  },
  {
    id: "wp-c3-0900",
    complexId: "complex-03",
    task: "Run Well Pump (Fill Raw Tank)",
    time: "09:00",
    durationMin: 30,
    repeat: "Every Day",
    enabled: false,
    status: "disabled",
    lastRun: null,
    nextRun: null,
    radar: "filling",
  },
];
