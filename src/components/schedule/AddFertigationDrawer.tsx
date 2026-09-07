"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Droplets, ShieldCheck, Zap } from "lucide-react";
import { Button, Checkbox, FieldError, InfoNote, Input, Label, RadioCard, Select, Textarea, Toggle } from "@/components/ui/primitives";
import { ConfirmDialog, Drawer } from "@/components/ui/overlay";
import { allRecipes } from "@/lib/data/greenhouses";
import { number, required, time as timeValid, assertValid, type FieldErrors } from "@/lib/validation";
import type { FertigationSchedule, RepeatMode, TriggerType } from "@/lib/types";
import { useDrawerForm } from "./useDrawerForm";

const DAY_OPTIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AddFertigationDrawer({
  open,
  onClose,
  ghId,
  ghCode,
  recipes,
  initial,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  ghId: string;
  ghCode: string;
  recipes: { id: string; name: string; waterL: number; dosingAml: number; dosingBml: number }[];
  /** When provided the drawer runs in EDIT mode pre-filled with this schedule. */
  initial?: FertigationSchedule | null;
  onSubmit: (input: Omit<FertigationSchedule, "id">, initial: FertigationSchedule | null) => Promise<void>;
}) {
  const editing = Boolean(initial);

  const [name, setName] = useState("");
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? allRecipes[0].id);
  const [enabled, setEnabled] = useState(true);
  const [trigger, setTrigger] = useState<TriggerType>("specific-time");
  const [time, setTime] = useState("06:00");
  const [repeat, setRepeat] = useState<RepeatMode>("Every Day");
  const [days, setDays] = useState<string[]>(["Mon", "Wed", "Fri"]);
  const [intervalH, setIntervalH] = useState("4");
  const [date, setDate] = useState("2026-09-10");
  const [targetMode, setTargetMode] = useState<"volume" | "ppm">("volume");
  const [water, setWater] = useState("80");
  const [dosingA, setDosingA] = useState("120");
  const [dosingB, setDosingB] = useState("120");
  const [ppm, setPpm] = useState("1500");
  const [fallbackOn, setFallbackOn] = useState(true);
  const [missedExecute, setMissedExecute] = useState(true);
  const [recoveryH, setRecoveryH] = useState("2");
  const [onlyToday, setOnlyToday] = useState(true);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // (Re)populate the form whenever the drawer opens for a schedule.
  useEffect(() => {
    if (!open) return;
    const key = initial?.id ?? "__create__";
    if (loadedFor === key) return;
    setLoadedFor(key);
    setErrors({});
    if (initial) {
      setName(initial.name);
      setRecipeId(initial.recipeId);
      setEnabled(initial.enabled);
      setTrigger(initial.trigger);
      setTime(initial.time);
      setRepeat(initial.repeat);
      setDays(initial.repeat.split(", ").filter((d) => DAY_OPTIONS.includes(d)));
      setIntervalH(String(initial.intervalHours ?? 4));
      setDate(initial.date ?? "2026-09-10");
      setTargetMode(initial.targetMode);
      setWater(String(initial.targetWaterL));
      setDosingA(String(initial.dosingAml));
      setDosingB(String(initial.dosingBml));
      setPpm(String(initial.targetPpm ?? 1500));
      setFallbackOn(initial.fallbackEnabled);
      setMissedExecute(initial.missedPolicy === "execute");
      setRecoveryH(String(initial.recoveryWindowH));
      setOnlyToday(initial.onlyToday);
      setNotes("");
    } else {
      setName("");
      setRecipeId(recipes[0]?.id ?? allRecipes[0].id);
      setEnabled(true);
      setTrigger("specific-time");
      setTime("06:00");
      setRepeat("Every Day");
      setDays(["Mon", "Wed", "Fri"]);
      setIntervalH("4");
      setDate("2026-09-10");
      setTargetMode("volume");
      setWater("80");
      setDosingA("120");
      setDosingB("120");
      setPpm("1500");
      setFallbackOn(true);
      setMissedExecute(true);
      setRecoveryH("2");
      setOnlyToday(true);
      setNotes("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const recipe = recipes.find((r) => r.id === recipeId) ?? allRecipes[0];

  const dirty = (() => {
    if (!initial) {
      return Boolean(name || notes);
    }
    return (
      name !== initial.name ||
      recipeId !== initial.recipeId ||
      enabled !== initial.enabled ||
      trigger !== initial.trigger ||
      time !== initial.time ||
      repeat !== initial.repeat ||
      targetMode !== initial.targetMode ||
      water !== String(initial.targetWaterL) ||
      dosingA !== String(initial.dosingAml) ||
      dosingB !== String(initial.dosingBml)
    );
  })();

  const form = useDrawerForm({ open, onClose, dirty });

  // keep targets in sync when recipe changes (volume mode, create only)
  useEffect(() => {
    if (open && !editing && targetMode === "volume") {
      setWater(String(recipe.waterL));
      setDosingA(String(recipe.dosingAml));
      setDosingB(String(recipe.dosingBml));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId, open]);

  const validate = (): FieldErrors => {
    const errs: FieldErrors = {
      name: required(name, "Schedule name"),
      time: timeValid(time),
      intervalH: trigger === "interval" ? number(intervalH, { label: "Interval", positive: true, integer: true }) : null,
      date: trigger === "specific-date" ? required(date, "Date") : null,
      water: number(water, { label: "Target water", positive: true }),
      ppm: targetMode === "ppm" ? number(ppm, { label: "Target PPM", positive: true }) : null,
      dosingA: targetMode === "volume" ? number(dosingA, { label: "Dosing Pump A", min: 0 }) : null,
      dosingB: targetMode === "volume" ? number(dosingB, { label: "Dosing Pump B", min: 0 }) : null,
      recoveryH: number(recoveryH, { label: "Recovery window", positive: true }),
      days: trigger === "days-of-week" && days.length === 0 ? "Select at least one day." : null,
    };
    return errs;
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
      await onSubmit(
        {
          ghId,
          name: name.trim() || `Schedule ${time}`,
          recipeId,
          enabled,
          trigger,
          time,
          repeat: trigger === "days-of-week" ? (days.join(", ") as RepeatMode) : repeat,
          intervalHours: trigger === "interval" ? Number(intervalH) || undefined : undefined,
          date: trigger === "specific-date" ? date : undefined,
          targetMode,
          targetWaterL: Number(water) || 0,
          dosingAml: Number(dosingA) || 0,
          dosingBml: Number(dosingB) || 0,
          targetPpm: targetMode === "ppm" ? Number(ppm) || undefined : undefined,
          fallbackEnabled: fallbackOn,
          missedPolicy: missedExecute ? "execute" : "skip",
          recoveryWindowH: Number(recoveryH) || 2,
          onlyToday,
          status: enabled ? "scheduled" : "disabled",
          lastRun: initial?.lastRun ?? null,
          nextRun: enabled ? `Today ${time}` : null,
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
        title={editing ? "Edit Fertigation Schedule" : "Add Fertigation Schedule"}
        subtitle={`Greenhouse ${ghCode}`}
        icon={
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Droplets className="h-5 w-5" />
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
            <SectionTitle index={1} title="Schedule Information" icon={<CalendarClock className="h-3.5 w-3.5" />} />
            <div className="space-y-3.5">
              <div>
                <Label required>Schedule Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning Fertigation" />
                <FieldError>{errors.name}</FieldError>
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <Label required>Recipe</Label>
                  <Select
                    value={recipeId}
                    onChange={(e) => setRecipeId(e.target.value)}
                    options={recipes.map((r) => ({ value: r.id, label: r.name }))}
                  />
                  <FieldError>{errors.recipeId}</FieldError>
                </div>
                <div>
                  <Label>Enabled</Label>
                  <div className="flex h-9.5 items-center">
                    <Toggle checked={enabled} onChange={setEnabled} label={enabled ? "Enabled" : "Disabled"} />
                  </div>
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" />
              </div>
            </div>
          </section>

          {/* 2. Trigger / Schedule Time */}
          <section>
            <SectionTitle index={2} title="Trigger / Schedule Time" icon={<CalendarClock className="h-3.5 w-3.5" />} />
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <RadioCard selected={trigger === "specific-time"} onSelect={() => setTrigger("specific-time")} title="Specific Time" subtitle="Run at a chosen time" />
                <RadioCard selected={trigger === "days-of-week"} onSelect={() => setTrigger("days-of-week")} title="Days of Week" subtitle="Repeat on selected days" />
                <RadioCard selected={trigger === "interval"} onSelect={() => setTrigger("interval")} title="Interval" subtitle="Every N hours" />
                <RadioCard selected={trigger === "specific-date"} onSelect={() => setTrigger("specific-date")} title="Specific Date" subtitle="Run once on a date" />
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <Label required>Time</Label>
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  <FieldError>{errors.time}</FieldError>
                </div>
                <div>
                  <Label>Repeat</Label>
                  <Select
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value as RepeatMode)}
                    disabled={trigger === "days-of-week" || trigger === "specific-date"}
                    options={[
                      { value: "Every Day", label: "Every Day" },
                      { value: "Every Weekday", label: "Every Weekday (Mon–Fri)" },
                      { value: "Every Weekend", label: "Every Weekend (Sat–Sun)" },
                      { value: "Mon, Wed, Fri", label: "Mon, Wed, Fri" },
                      { value: "Tue, Thu", label: "Tue, Thu" },
                      { value: "Once", label: "Once" },
                    ]}
                  />
                </div>
              </div>
              {trigger === "days-of-week" && (
                <div>
                  <Label>Days of Week</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {DAY_OPTIONS.map((d) => {
                      const active = days.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDays((prev) => (active ? prev.filter((x) => x !== d) : [...prev, d]))}
                          className={`h-9 w-12 cursor-pointer rounded-lg border text-[13px] font-medium transition ${
                            active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          }`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                  <FieldError>{errors.days}</FieldError>
                </div>
              )}
              {trigger === "interval" && (
                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <Label required>Interval (hours)</Label>
                    <Input type="number" min={1} value={intervalH} onChange={(e) => setIntervalH(e.target.value)} unit="hour" />
                    <FieldError>{errors.intervalH}</FieldError>
                  </div>
                </div>
              )}
              {trigger === "specific-date" && (
                <div>
                  <Label required>Date</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  <FieldError>{errors.date}</FieldError>
                </div>
              )}
            </div>
          </section>

          {/* 3. Fertigation Target — VERTICAL layout */}
          <section>
            <SectionTitle index={3} title="Fertigation Target" icon={<Droplets className="h-3.5 w-3.5" />} />
            <div className="mb-3.5 grid grid-cols-2 gap-3">
              <RadioCard
                selected={targetMode === "volume"}
                onSelect={() => setTargetMode("volume")}
                title="Volume Mode"
                subtitle="Fixed water + dosing volume"
              />
              <RadioCard
                selected={targetMode === "ppm"}
                onSelect={() => setTargetMode("ppm")}
                title="PPM Mode"
                subtitle="Backend computes dosing from target PPM"
              />
            </div>
            <div className="space-y-3.5">
              <div>
                <Label required>Target Water</Label>
                <Input type="number" min={0} value={water} onChange={(e) => setWater(e.target.value)} unit="L" />
                <FieldError>{errors.water}</FieldError>
              </div>
              {targetMode === "volume" ? (
                <>
                  <div>
                    <Label required>Dosing Pump A</Label>
                    <Input type="number" min={0} value={dosingA} onChange={(e) => setDosingA(e.target.value)} unit="ml" />
                    <FieldError>{errors.dosingA}</FieldError>
                  </div>
                  <div>
                    <Label required>Dosing Pump B</Label>
                    <Input type="number" min={0} value={dosingB} onChange={(e) => setDosingB(e.target.value)} unit="ml" />
                    <FieldError>{errors.dosingB}</FieldError>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label required>Target PPM</Label>
                    <Input type="number" min={0} value={ppm} onChange={(e) => setPpm(e.target.value)} unit="ppm" />
                    <FieldError>{errors.ppm}</FieldError>
                  </div>
                  <InfoNote>
                    In PPM mode the backend calculates the required dosing volume (ml) from target water, target PPM,
                    and dosing pump calibration. Estimated: A ≈ {Math.round((Number(water) || 0) * 1.5)} ml, B ≈{" "}
                    {Math.round((Number(water) || 0) * 1.5)} ml.
                  </InfoNote>
                </>
              )}
            </div>
          </section>

          {/* 4. Fallback Configuration */}
          <section>
            <SectionTitle index={4} title="Fallback Configuration" icon={<ShieldCheck className="h-3.5 w-3.5" />} />
            <div className="space-y-3">
              <Toggle
                checked={fallbackOn}
                onChange={setFallbackOn}
                label="Use fallback when backend / primary schedule unavailable"
              />
              {fallbackOn && (
                <Select
                  value="default"
                  onChange={() => {}}
                  options={[{ value: "default", label: "Default Fallback — last valid configuration on ESP32" }]}
                />
              )}
            </div>
          </section>

          {/* 5. Missed Schedule / Power Recovery */}
          <section>
            <SectionTitle index={5} title="Missed Schedule / Power Recovery" icon={<Zap className="h-3.5 w-3.5" />} />
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <RadioCard selected={missedExecute} onSelect={() => setMissedExecute(true)} title="Execute missed schedule" subtitle="Run as soon as possible" />
                <RadioCard selected={!missedExecute} onSelect={() => setMissedExecute(false)} title="Skip missed schedule" subtitle="Wait for next occurrence" />
              </div>
              <div>
                <Label>Recovery Window</Label>
                <Input type="number" min={1} value={recoveryH} onChange={(e) => setRecoveryH(e.target.value)} unit="hour" />
                <FieldError>{errors.recoveryH}</FieldError>
              </div>
              <Checkbox checked={onlyToday} onChange={setOnlyToday} label="Recover only today's missed schedule" />
            </div>
          </section>
        </div>
      </Drawer>

      {/* unsaved changes guard */}
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

function SectionTitle({ index, title, icon }: { index: number; title: string; icon: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex items-center gap-2.5 border-b border-slate-100 pb-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
        {index}
      </span>
      <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
        {icon}
        {title}
      </span>
    </div>
  );
}
