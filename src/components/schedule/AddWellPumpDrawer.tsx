"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Droplet, Radar, Timer } from "lucide-react";
import { Button, FieldError, InfoNote, Input, Label, RadioCard, Select, Toggle } from "@/components/ui/primitives";
import { ConfirmDialog, Drawer } from "@/components/ui/overlay";
import { number, required, time as timeValid, assertValid, type FieldErrors } from "@/lib/validation";
import type { RepeatMode, WellPumpSchedule } from "@/lib/types";
import { useDrawerForm } from "./useDrawerForm";

const DAY_OPTIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

  const [task, setTask] = useState("Run Well Pump (Fill Raw Tank)");
  const [pump, setPump] = useState("wp-main");
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [trigger, setTrigger] = useState<"time" | "days" | "interval">("time");
  const [time, setTime] = useState("08:00");
  const [days, setDays] = useState<string[]>(["Mon", "Wed", "Fri"]);
  const [intervalH, setIntervalH] = useState("12");
  const [repeat, setRepeat] = useState<RepeatMode>("Every Day");
  const [duration, setDuration] = useState("30");
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
      setPump("wp-main");
      setMode("auto");
      setTrigger(initial.repeat.includes(",") ? "days" : "time");
      setTime(initial.time);
      setDays(initial.repeat.split(", ").filter((d) => DAY_OPTIONS.includes(d)));
      setIntervalH("12");
      setRepeat(initial.repeat);
      setDuration(String(initial.durationMin));
      setTargetL("");
      setUseRadar(true);
    } else {
      setTask("Run Well Pump (Fill Raw Tank)");
      setPump("wp-main");
      setMode("auto");
      setTrigger("time");
      setTime("08:00");
      setDays(["Mon", "Wed", "Fri"]);
      setIntervalH("12");
      setRepeat("Every Day");
      setDuration("30");
      setTargetL("500");
      setUseRadar(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const dirty = (() => {
    if (!initial) return task !== "Run Well Pump (Fill Raw Tank)";
    return (
      task !== initial.task ||
      time !== initial.time ||
      duration !== String(initial.durationMin) ||
      repeat !== initial.repeat
    );
  })();

  const form = useDrawerForm({ open, onClose, dirty });

  const validate = (): FieldErrors => ({
    task: required(task, "Task name"),
    time: timeValid(time, "Start time"),
    duration: number(duration, { label: "Duration", positive: true, integer: true }),
    intervalH: trigger === "interval" ? number(intervalH, { label: "Interval", positive: true, integer: true }) : null,
    days: trigger === "days" && days.length === 0 ? "Select at least one day." : null,
  });

  const submit = () => {
    const errs = validate();
    setErrors(errs);
    try {
      assertValid(errs);
    } catch {
      return;
    }
    form.submit(async () => {
      await onSubmit(
        {
          complexId,
          task: task.trim() || `Well Pump ${time}`,
          time,
          durationMin: Number(duration) || 30,
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
                    options={[
                      { value: "wp-main", label: "Well Pump — Main" },
                      { value: "wp-backup", label: "Well Pump — Backup" },
                    ]}
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
                <Input type="number" value="60" onChange={() => {}} unit="min" />
              </div>
              <div>
                <Label>Flow Rate</Label>
                <Input value="12.4" onChange={() => {}} unit="L/min" />
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
                <RadioCard selected={trigger === "interval"} onSelect={() => setTrigger("interval")} title="Interval" subtitle="Every N hours" />
              </div>
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
              {trigger === "days" && (
                <div className="flex flex-wrap gap-1.5">
                  {DAY_OPTIONS.map((d) => {
                    const active = days.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDays((prev) => (active ? prev.filter((x) => x !== d) : [...prev, d]))}
                        className={`h-9 w-12 cursor-pointer rounded-lg border text-[13px] font-medium transition ${
                          active ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              )}
              {trigger === "interval" && (
                <div>
                  <Label required>Interval (hours)</Label>
                  <Input type="number" min={1} value={intervalH} onChange={(e) => setIntervalH(e.target.value)} unit="hour" />
                  <FieldError>{errors.intervalH}</FieldError>
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
                  <Input type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} unit="min" />
                  <FieldError>{errors.duration}</FieldError>
                </div>
                <div>
                  <Label>Target Volume (optional)</Label>
                  <Input type="number" min={0} value={targetL} onChange={(e) => setTargetL(e.target.value)} unit="L" />
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
