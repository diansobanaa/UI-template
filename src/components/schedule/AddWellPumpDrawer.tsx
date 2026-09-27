"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Droplet, Radar, Timer } from "lucide-react";
import { Button, FieldError, InfoNote, Input, Label, RadioCard, Select, Toggle } from "@/components/ui/primitives";
import { ConfirmDialog, Drawer } from "@/components/ui/overlay";
import { number, required, time as timeValid, assertValid, type FieldErrors } from "@/lib/validation";
import type { RepeatMode, WellPumpSchedule, EquipmentItem } from "@/lib/types";
import { getOperationalSnapshot } from "@/lib/operational-state";
import { useDrawerForm } from "./useDrawerForm";

const DAY_OPTIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseTimeToMinutes(t: string): number {
  const [h, m] = (t || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
}

function calculateIntervalRuns(startTime: string, endTime: string, intervalMin: number): number {
  if (!startTime || !endTime || !intervalMin || intervalMin <= 0) return 0;
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (end <= start) return 0;
  return Math.floor((end - start) / intervalMin) + 1;
}

export function AddWellPumpDrawer({
  open,
  onClose,
  complexId,
  complexCode,
  initial,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  complexId: string;
  complexCode: string;
  /** When provided the drawer runs in EDIT mode pre-filled with this schedule. */
  initial?: WellPumpSchedule | null;
  onSubmit: (input: Omit<WellPumpSchedule, "id">, initial: WellPumpSchedule | null) => Promise<void>;
}) {
  const editing = Boolean(initial);

  const snapshot = getOperationalSnapshot();
  const installedWellPumps = useMemo(() => {
    // 1. Check complex-level equipment first (Well Pump is ghId=null, lives on complex not GH)
    const complex = snapshot.complexes.find((c) => c.id === complexId);
    const complexEq = complex?.equipment || [];
    const complexMatching = complexEq.filter((e) =>
      /WELL_PUMP|WATER_PUMP|RAW_SUBMERSIBLE|pump_well|Deep Well|Well Pump/i.test(`${e.name} ${e.type} ${e.category}`)
    );
    if (complexMatching.length > 0) {
      return complexMatching.map((e) => ({
        value: e.name || "Well Pump",
        label: `${e.name}${(e as any).gpio != null ? ` (GPIO ${(e as any).gpio})` : ""}`,
      }));
    }
    // 2. Fallback: search GH equipment (legacy)
    const ghList = snapshot.greenhouses.filter((g) => g.complexId === complexId);
    const eqList = ghList.flatMap((g) => g.equipment || []);
    const matching = eqList.filter((e) => /WELL_PUMP|WATER_PUMP|RAW_SUBMERSIBLE|pump_well|Deep Well|Well Pump/i.test(`${e.name} ${e.type} ${e.category}`));
    if (matching.length > 0) {
      return matching.map((e) => ({
        value: e.name || "pump_well",
        label: `${e.name}${(e as any).gpio != null ? ` (GPIO ${(e as any).gpio})` : ""}`,
      }));
    }
    // 3. Canonical default
    return [
      { value: "Well Pump", label: "Well Pump (Omron Relay #1 / GPIO 1)" },
    ];
  }, [snapshot, complexId]);

  const [task, setTask] = useState("Run Well Pump (Fill Raw Tank)");
  const [pump, setPump] = useState(() => installedWellPumps[0]?.value ?? "Well Pump");
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [trigger, setTrigger] = useState<"time" | "days" | "interval">("time");
  const [time, setTime] = useState("08:00");
  const [endTime, setEndTime] = useState("12:00");
  const [days, setDays] = useState<string[]>(["Mon", "Wed", "Fri"]);
  const [intervalMin, setIntervalMin] = useState("60");
  const [repeat, setRepeat] = useState<RepeatMode>("Every Day");
  const [duration, setDuration] = useState("30");
  const [durationUnit, setDurationUnit] = useState<"sec" | "min">("sec");
  const [targetL, setTargetL] = useState("500");
  const [useRadar, setUseRadar] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const key = initial?.id ?? "__create__";
    if (loadedFor === key) return;
    setLoadedFor(key);
    setErrors({});
    if (initial) {
      setTask(initial.task);
      setPump(initial.pump || installedWellPumps[0]?.value || "Well Pump");
      setMode("auto");
      const trig = initial.trigger ?? ((initial.repeat as string) === "Interval" ? "interval" : initial.repeat.includes(",") ? "days" : "time");
      setTrigger(trig);
      setTime(initial.time);
      setEndTime(initial.endTime || "12:00");
      setDays(initial.repeat.split(", ").filter((d) => DAY_OPTIONS.includes(d)));
      setIntervalMin(String(initial.intervalMin ?? 60));
      setRepeat(initial.repeat);

      if (initial.durationSec != null && initial.durationSec > 0) {
        if (initial.durationSec % 60 === 0 && initial.durationSec >= 60) {
          setDuration(String(initial.durationSec / 60));
          setDurationUnit("min");
        } else {
          setDuration(String(initial.durationSec));
          setDurationUnit("sec");
        }
      } else if (initial.durationMin != null) {
        if (initial.durationMin < 1) {
          setDuration(String(Math.round(initial.durationMin * 60)));
          setDurationUnit("sec");
        } else {
          setDuration(String(initial.durationMin));
          setDurationUnit("min");
        }
      } else {
        setDuration("30");
        setDurationUnit("sec");
      }

      setTargetL("");
      setUseRadar(true);
    } else {
      setTask("Run Well Pump (Fill Raw Tank)");
      setPump("wp-main");
      setMode("auto");
      setTrigger("time");
      setTime("08:00");
      setEndTime("12:00");
      setDays(["Mon", "Wed", "Fri"]);
      setIntervalMin("60");
      setRepeat("Every Day");
      setDuration("30");
      setDurationUnit("sec");
      setTargetL("500");
      setUseRadar(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const dirty = (() => {
    if (!initial) return task !== "Run Well Pump (Fill Raw Tank)" || duration !== "30" || durationUnit !== "sec" || (trigger === "interval" && endTime !== "12:00");
    return (
      task !== initial.task ||
      time !== initial.time ||
      endTime !== (initial.endTime ?? "12:00") ||
      trigger !== (initial.trigger ?? ((initial.repeat as string) === "Interval" ? "interval" : initial.repeat.includes(",") ? "days" : "time")) ||
      repeat !== initial.repeat
    );
  })();

  const form = useDrawerForm({ open, onClose, dirty });

  const validate = (): FieldErrors => {
    let endTimeError: string | null = null;
    if (trigger === "interval") {
      if (!endTime || !endTime.trim()) {
        endTimeError = "End time is required for interval mode.";
      } else {
        const timeErr = timeValid(endTime, "End time");
        if (timeErr) {
          endTimeError = timeErr;
        } else if (parseTimeToMinutes(endTime) <= parseTimeToMinutes(time)) {
          endTimeError = "End time must be after Start time.";
        }
      }
    }

    return {
      task: required(task, "Task name"),
      time: timeValid(time, "Start time"),
      endTime: endTimeError,
      duration: number(duration, { label: "Duration", positive: true, integer: true }),
      targetL: targetL && targetL.trim() ? number(targetL, { label: "Target volume", positive: true, max: 1000 }) : null,
      intervalMin: trigger === "interval" ? number(intervalMin, { label: "Interval", positive: true, integer: true }) : null,
      days: trigger === "days" && days.length === 0 ? "Select at least one day." : null,
    };
  };

  const submit = () => {
    const errs = validate();
    setErrors(errs);
    try {
      assertValid(errs);
    } catch {
      return;
    }
    form.submit(async () => {
      const durNum = Number(duration) || 30;
      const durSec = durationUnit === "sec" ? durNum : Math.round(durNum * 60);
      const durMin = durationUnit === "min" ? durNum : Number((durNum / 60).toFixed(2));
      const intMinNum = Number(intervalMin) || 60;
      const targetLNum = targetL && targetL.trim() ? Number(targetL) : undefined;

      await onSubmit(
        {
          complexId,
          task: task.trim() || `Well Pump ${time}`,
          pump,
          componentId: "pump_well",
          time,
          endTime: trigger === "interval" ? endTime : undefined,
          trigger,
          days: trigger === "days" ? days : undefined,
          durationMin: durMin,
          durationSec: durSec,
          intervalMin: trigger === "interval" ? intMinNum : undefined,
          targetLiters: targetLNum,
          repeat: trigger === "days" ? (days.join(", ") as RepeatMode) : repeat,
          enabled: initial?.enabled ?? true,
          status: (initial?.enabled ?? true) ? "scheduled" : "disabled",
          lastRun: initial?.lastRun ?? null,
          nextRun: (initial?.enabled ?? true) ? `Today ${time}` : null,
          radar: initial?.radar ?? "filling",
        },
        initial ?? null
      );
    });
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={form.requestClose}
        title={editing ? "Edit Well Pump Schedule" : "Add Well Pump Schedule"}
        subtitle={`${complexCode} • Raw Water Tank`}
        icon={
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <Droplet className="h-5 w-5" />
          </span>
        }
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={form.requestClose}>Cancel</Button>
            <Button size="lg" onClick={submit} disabled={form.saving}>
              {form.saving ? (editing ? "Saving…" : "Creating…") : editing ? "Save Changes" : "Create Schedule"}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {form.errorBanner}

          {/* 1. Schedule Information */}
          <section>
            <Header index={1} title="Schedule Information" icon={<CalendarClock className="h-3.5 w-3.5" />} />
            <div className="space-y-3.5">
              <div>
                <Label required>Task Name</Label>
                <Input value={task} onChange={(e) => setTask(e.target.value)} />
                <FieldError>{errors.task}</FieldError>
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <Label required>Pump</Label>
                  <Select
                    value={pump}
                    onChange={(e) => setPump(e.target.value)}
                    options={installedWellPumps}
                  />
                </div>
                <div>
                  <Label>Mode</Label>
                  <Select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as "auto" | "manual")}
                    options={[
                      { value: "auto", label: "AUTO (schedule)" },
                      { value: "manual", label: "MANUAL" },
                    ]}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 2. Pump Configuration */}
          <section>
            <Header index={2} title="Pump Configuration" icon={<Droplet className="h-3.5 w-3.5" />} />
            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <Label>Max Runtime</Label>
                <Input type="number" value="60" onChange={() => { }} unit="min" />
              </div>
              <div>
                <Label>Flow Rate</Label>
                <Input value="12.4" onChange={() => { }} unit="L/min" />
              </div>
            </div>
          </section>

          {/* 3. Trigger / Schedule Time */}
          <section>
            <Header index={3} title="Trigger / Schedule Time" icon={<CalendarClock className="h-3.5 w-3.5" />} />
            <div className="space-y-3.5">
              <div className="grid grid-cols-3 gap-3">
                <RadioCard selected={trigger === "time"} onSelect={() => setTrigger("time")} title="Time" subtitle="Daily at a set time" />
                <RadioCard selected={trigger === "days"} onSelect={() => setTrigger("days")} title="Days" subtitle="Selected weekdays" />
                <RadioCard selected={trigger === "interval"} onSelect={() => setTrigger("interval")} title="Interval" subtitle="Every N minutes" />
              </div>
              {trigger === "interval" ? (
                <>
                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <Label required>Start Time</Label>
                      <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                      <FieldError>{errors.time}</FieldError>
                    </div>
                    <div>
                      <Label required>End Time</Label>
                      <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                      <FieldError>{errors.endTime}</FieldError>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3.5 items-start">
                    <div>
                      <Label required>Interval (minutes)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={intervalMin}
                        onChange={(e) => setIntervalMin(e.target.value)}
                        unit="min"
                        placeholder="e.g. 30"
                      />
                      <FieldError>{errors.intervalMin}</FieldError>
                    </div>
                    <div className="pt-6">
                      {parseTimeToMinutes(endTime) > parseTimeToMinutes(time) && Number(intervalMin) > 0 ? (
                        <div className="rounded-lg border border-sky-200/60 bg-sky-50 px-3 py-2 text-[12px] font-medium text-sky-800">
                          <span className="font-bold text-sky-900">
                            {calculateIntervalRuns(time, endTime, Number(intervalMin))}x putaran
                          </span>{" "}
                          antara {time} s/d {endTime}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
                          Tentukan Start & End time untuk menghitung putaran
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <Label required>Start Time</Label>
                    <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                    <FieldError>{errors.time}</FieldError>
                  </div>
                  <div>
                    <Label>Repeat</Label>
                    <Select
                      value={repeat}
                      onChange={(e) => setRepeat(e.target.value as RepeatMode)}
                      disabled={trigger !== "time"}
                      options={[
                        { value: "Every Day", label: "Every Day" },
                        { value: "Mon, Wed, Fri", label: "Mon, Wed, Fri" },
                        { value: "Tue, Thu", label: "Tue, Thu" },
                        { value: "Once", label: "Once" },
                      ]}
                    />
                  </div>
                </div>
              )}
              {trigger === "days" && (
                <div className="flex flex-wrap gap-1.5">
                  {DAY_OPTIONS.map((d) => {
                    const active = days.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDays((prev) => (active ? prev.filter((x) => x !== d) : [...prev, d]))}
                        className={`h-9 w-12 cursor-pointer rounded-lg border text-[13px] font-medium transition ${active ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* 4. Pump Operation */}
          <section>
            <Header index={4} title="Pump Operation" icon={<Timer className="h-3.5 w-3.5" />} />
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <Label required>Duration</Label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Input
                        type="number"
                        min={1}
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        placeholder={durationUnit === "sec" ? "30" : "5"}
                      />
                    </div>
                    <div className="w-28 shrink-0">
                      <Select
                        value={durationUnit}
                        onChange={(e) => setDurationUnit(e.target.value as "sec" | "min")}
                        options={[
                          { value: "sec", label: "Detik" },
                          { value: "min", label: "Menit" },
                        ]}
                      />
                    </div>
                  </div>
                  <FieldError>{errors.duration}</FieldError>
                </div>
                <div>
                  <Label>Target Volume (optional)</Label>
                  <Input type="number" min={0} value={targetL} onChange={(e) => setTargetL(e.target.value)} unit="L" placeholder="500" />
                  <FieldError>{errors.targetL}</FieldError>
                </div>
              </div>
              <InfoNote>
                The pump stops at the earliest of: duration reached, target volume reached, or radar reports the tank is
                full (<b>Penuh</b>).
              </InfoNote>
            </div>
          </section>

          {/* 5. Radar Sensor Behavior */}
          <section>
            <Header index={5} title="Radar Sensor Behavior" icon={<Radar className="h-3.5 w-3.5" />} />
            <div className="space-y-3.5">
              <Toggle checked={useRadar} onChange={setUseRadar} label="Use radar sensor as pump interlock" />
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5">
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Dalam Pengisian
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-emerald-700/80">Tank is still filling — pump is allowed to run.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-slate-400" /> Penuh
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">Tank is full — pump must remain OFF.</p>
                </div>
              </div>
              <InfoNote>
                The radar is a binary state (<b>Dalam Pengisian</b> / <b>Penuh</b>) — it is not a percentage. The schedule
                always stays active; the radar only decides whether the physical pump is permitted to run.
              </InfoNote>
            </div>
          </section>
        </div>
      </Drawer>

      <ConfirmDialog
        open={form.confirmDiscard}
        onClose={form.dismissDiscard}
        onConfirm={() => {
          form.dismissDiscard();
          onClose();
        }}
        title="Unsaved changes"
        message="You have unsaved changes. Discard them and close?"
        confirmLabel="Discard Changes"
        danger
      />
    </>
  );
}

function Header({ index, title, icon }: { index: number; title: string; icon: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex items-center gap-2.5 border-b border-slate-100 pb-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-[11px] font-bold text-white">
        {index}
      </span>
      <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
        {icon}
        {title}
      </span>
    </div>
  );
}
