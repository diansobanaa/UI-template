"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Droplets, ShieldCheck, Zap } from "lucide-react";
import { Button, Checkbox, InfoNote, Input, Label, RadioCard, Select, Textarea, Toggle } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/overlay";
import { allRecipes } from "@/lib/data/greenhouses";
import type { FertigationSchedule, RepeatMode, TriggerType } from "@/lib/types";

const DAY_OPTIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AddFertigationDrawer({
  open,
  onClose,
  ghId,
  ghCode,
  recipes,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  ghId: string;
  ghCode: string;
  recipes: { id: string; name: string; waterL: number; dosingAml: number; dosingBml: number }[];
  onCreate: (input: Omit<FertigationSchedule, "id">) => void;
}) {
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

  const recipe = recipes.find((r) => r.id === recipeId) ?? allRecipes[0];

  // keep targets in sync when recipe changes (volume mode)
  useEffect(() => {
    if (open && targetMode === "volume") {
      setWater(String(recipe.waterL));
      setDosingA(String(recipe.dosingAml));
      setDosingB(String(recipe.dosingBml));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId, open]);

  const submit = () => {
    onCreate({
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
      status: "scheduled",
      lastRun: null,
      nextRun: `Today ${time}`,
    });
    onClose();
    setName("");
    setNotes("");
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add Fertigation Schedule"
      subtitle={`Greenhouse ${ghCode}`}
      icon={
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <Droplets className="h-5 w-5" />
        </span>
      }
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onClose}>Cancel</Button>
          <Button size="lg" onClick={submit}>Create Schedule</Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* 1. Schedule Information */}
        <section>
          <SectionTitle index={1} title="Schedule Information" icon={<CalendarClock className="h-3.5 w-3.5" />} />
          <div className="space-y-3.5">
            <div>
              <Label required>Schedule Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning Fertigation" />
            </div>
            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <Label required>Recipe</Label>
                <Select
                  value={recipeId}
                  onChange={(e) => setRecipeId(e.target.value)}
                  options={recipes.map((r) => ({ value: r.id, label: r.name }))}
                />
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
              </div>
            )}
            {trigger === "interval" && (
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <Label required>Interval (hours)</Label>
                  <Input type="number" min={1} value={intervalH} onChange={(e) => setIntervalH(e.target.value)} unit="hour" />
                </div>
              </div>
            )}
            {trigger === "specific-date" && (
              <div>
                <Label required>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
            </div>
            {targetMode === "volume" ? (
              <>
                <div>
                  <Label required>Dosing Pump A</Label>
                  <Input type="number" min={0} value={dosingA} onChange={(e) => setDosingA(e.target.value)} unit="ml" />
                </div>
                <div>
                  <Label required>Dosing Pump B</Label>
                  <Input type="number" min={0} value={dosingB} onChange={(e) => setDosingB(e.target.value)} unit="ml" />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label required>Target PPM</Label>
                  <Input type="number" min={0} value={ppm} onChange={(e) => setPpm(e.target.value)} unit="ppm" />
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
            </div>
            <Checkbox checked={onlyToday} onChange={setOnlyToday} label="Recover only today's missed schedule" />
          </div>
        </section>
      </div>
    </Drawer>
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
