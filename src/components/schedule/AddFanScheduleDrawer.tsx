"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Fan, Thermometer, Timer } from "lucide-react";
import { Button, FieldError, InfoNote, Input, Label, RadioCard, Select } from "@/components/ui/primitives";
import { ConfirmDialog, Drawer } from "@/components/ui/overlay";
import { number, time as timeValid, assertValid, type FieldErrors } from "@/lib/validation";
import type { FanSchedule, RepeatMode } from "@/lib/types";
import { useDrawerForm } from "./useDrawerForm";

export function AddFanScheduleDrawer({
  open,
  onClose,
  ghId,
  ghCode,
  initial,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  ghId: string;
  ghCode: string;
  /** When provided the drawer runs in EDIT mode pre-filled with this schedule. */
  initial?: FanSchedule | null;
  onSubmit: (input: Omit<FanSchedule, "id">, initial: FanSchedule | null) => Promise<void>;
}) {
  const editing = Boolean(initial);

  const [mode, setMode] = useState<"time" | "temperature">("time");
  const [time, setTime] = useState("07:00");
  const [duration, setDuration] = useState("60");
  const [repeat, setRepeat] = useState<RepeatMode>("Every Day");
  const [onAbove, setOnAbove] = useState("30");
  const [offBelow, setOffBelow] = useState("28");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const key = initial?.id ?? "__create__";
    if (loadedFor === key) return;
    setLoadedFor(key);
    setErrors({});
    if (initial) {
      setMode(initial.mode);
      setTime(initial.mode === "time" ? initial.time : "07:00");
      setDuration(String(initial.durationMin));
      setRepeat(initial.repeat);
      setOnAbove(String(initial.onAboveC ?? 30));
      setOffBelow(String(initial.offBelowC ?? 28));
    } else {
      setMode("time");
      setTime("07:00");
      setDuration("60");
      setRepeat("Every Day");
      setOnAbove("30");
      setOffBelow("28");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const dirty = (() => {
    if (!initial) return true;
    return (
      mode !== initial.mode ||
      (mode === "time" && time !== initial.time) ||
      duration !== String(initial.durationMin) ||
      (mode === "temperature" && (onAbove !== String(initial.onAboveC ?? 30) || offBelow !== String(initial.offBelowC ?? 28)))
    );
  })();

  const form = useDrawerForm({ open, onClose, dirty });

  const hysteresisValid = mode === "time" || Number(onAbove) > Number(offBelow);

  const validate = (): FieldErrors => ({
    time: mode === "time" ? timeValid(time, "Start time") : null,
    duration: number(duration, { label: "Run duration", positive: true, integer: true }),
    onAbove: mode === "temperature" ? number(onAbove, { label: "Fan ON threshold" }) : null,
    offBelow: mode === "temperature" ? number(offBelow, { label: "Fan OFF threshold" }) : null,
    hysteresis: hysteresisValid ? null : "ON threshold must be higher than OFF threshold.",
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
          ghId,
          mode,
          time: mode === "time" ? time : "--:--",
          durationMin: Number(duration) || 60,
          onAboveC: mode === "temperature" ? Number(onAbove) : undefined,
          offBelowC: mode === "temperature" ? Number(offBelow) : undefined,
          repeat,
          enabled: initial?.enabled ?? true,
          status: (initial?.enabled ?? true) ? "scheduled" : "disabled",
          lastRun: initial?.lastRun ?? null,
          nextRun: mode === "time" ? `Today ${time}` : "Temperature based",
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
        title={editing ? "Edit Fan Schedule" : "Add Fan Schedule"}
        subtitle={`Greenhouse ${ghCode}`}
        icon={
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Fan className="h-5 w-5" />
          </span>
        }
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={form.requestClose}>Cancel</Button>
            <Button size="lg" disabled={form.saving} onClick={submit}>
              {form.saving ? (editing ? "Saving…" : "Creating…") : editing ? "Save Changes" : "Create Schedule"}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {form.errorBanner}

          {/* Control mode */}
          <section>
            <ModeHeader index={1} title="Control Mode" icon={<Fan className="h-3.5 w-3.5" />} />
            <div className="grid grid-cols-2 gap-3">
              <RadioCard
                selected={mode === "time"}
                onSelect={() => setMode("time")}
                title="Time Based"
                subtitle="Run at a fixed time for a duration"
              />
              <RadioCard
                selected={mode === "temperature"}
                onSelect={() => setMode("temperature")}
                title="Temperature Based"
                subtitle="Automatic ON/OFF by temperature thresholds"
              />
            </div>
          </section>

          {mode === "time" ? (
            <>
              <section>
                <ModeHeader index={2} title="Trigger / Schedule Time" icon={<CalendarClock className="h-3.5 w-3.5" />} />
                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <Label required>Start Time</Label>
                    <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                    <FieldError>{errors.time}</FieldError>
                  </div>
                  <div>
                    <Label required>Repeat</Label>
                    <Select
                      value={repeat}
                      onChange={(e) => setRepeat(e.target.value as RepeatMode)}
                      options={[
                        { value: "Every Day", label: "Every Day" },
                        { value: "Every Weekday", label: "Every Weekday (Mon–Fri)" },
                        { value: "Every Weekend", label: "Every Weekend (Sat–Sun)" },
                        { value: "Once", label: "Once" },
                      ]}
                    />
                  </div>
                </div>
              </section>
              <section>
                <ModeHeader index={3} title="Fan Operation" icon={<Timer className="h-3.5 w-3.5" />} />
                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <Label required>Run Duration</Label>
                    <Input type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} unit="min" />
                    <FieldError>{errors.duration}</FieldError>
                  </div>
                </div>
                <InfoNote className="mt-3">
                  Example: start 07:00 and run for 60 minutes every day — helps remove leaf moisture after morning
                  watering.
                </InfoNote>
              </section>
            </>
          ) : (
            <section>
              <ModeHeader index={2} title="Temperature Thresholds" icon={<Thermometer className="h-3.5 w-3.5" />} />
              <div className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <Label required>Fan ON above</Label>
                    <Input type="number" value={onAbove} onChange={(e) => setOnAbove(e.target.value)} unit="°C" />
                    <FieldError>{errors.onAbove}</FieldError>
                  </div>
                  <div>
                    <Label required>Fan OFF below</Label>
                    <Input type="number" value={offBelow} onChange={(e) => setOffBelow(e.target.value)} unit="°C" />
                    <FieldError>{errors.offBelow}</FieldError>
                  </div>
                </div>

                {/* Hysteresis visual */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="mb-3 text-[13px] font-bold text-slate-700">Hysteresis</div>
                  <div className="relative">
                    <div className="h-2 w-full rounded-full bg-gradient-to-r from-sky-300 via-emerald-300 to-red-300" />
                    <div className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 bg-slate-700" style={{ left: "72%" }} />
                    <div className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 bg-slate-700" style={{ left: "52%" }} />
                  </div>
                  <div className="mt-2 flex justify-between text-xs">
                    <span className="text-sky-600">Cool</span>
                    <span className="font-semibold text-slate-600">OFF &lt; {offBelow}°C</span>
                    <span className="font-semibold text-slate-600">ON &gt; {onAbove}°C</span>
                    <span className="text-red-500">Hot</span>
                  </div>
                  <div className="mt-3 space-y-1.5 text-xs leading-relaxed text-slate-500">
                    <p>
                      <span className="font-semibold text-red-500">Fan ON</span> when temperature &gt; {onAbove}°C —
                      reduces greenhouse heat.
                    </p>
                    <p>
                      <span className="font-semibold text-sky-600">Fan OFF</span> when temperature &lt; {offBelow}°C —
                      the gap prevents rapid ON/OFF cycling.
                    </p>
                  </div>
                </div>
                {!hysteresisValid && (
                  <p className="text-xs font-medium text-red-500">
                    ON threshold must be higher than OFF threshold.
                  </p>
                )}
              </div>
            </section>
          )}

          <InfoNote>
            Fans help remove leaf moisture after the morning fertigasi and reduce greenhouse heat during the day.
          </InfoNote>
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

function ModeHeader({ index, title, icon }: { index: number; title: string; icon: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex items-center gap-2.5 border-b border-slate-100 pb-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
        {index}
      </span>
      <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
        {icon}
        {title}
      </span>
    </div>
  );
}
