"use client";

import { useEffect, useState } from "react";
import { getSystemDate, toIsoDateString } from "@/lib/cropCycleProcessor";
import { AlertCircle, BookmarkPlus, CalendarClock, CheckCircle2, Droplets, ShieldCheck, Zap } from "lucide-react";
import { Button, Checkbox, FieldError, InfoNote, Input, Label, RadioCard, Select, Textarea, Toggle } from "@/components/ui/primitives";
import { ConfirmDialog, Drawer } from "@/components/ui/overlay";
import { number, required, time as timeValid, assertValid, type FieldErrors } from "@/lib/validation";
import type { FertigationSchedule, RepeatMode, TriggerType } from "@/lib/types";
import { recipeService } from "@/lib/services";
import { useDrawerForm } from "./useDrawerForm";

const DAY_OPTIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AddFertigationDrawer({
  open,
  onClose,
  ghId,
  ghCode,
  recipes,
  dosingComponents,
  initial,
  tankCapacityL,
  isFallbackMode = false,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  ghId: string;
  ghCode: string;
  recipes: { id: string; name: string; waterL: number; dosingAml?: number; dosingBml?: number; dosingChannels?: Array<{ componentId: string; requestedMl: number; calibrationId?: string; calibrationVersion?: number }> }[];
  dosingComponents: Array<{ componentId: string; name: string; channel?: string; calibrationId?: string; calibrationVersion?: number }>;
  /** When provided the drawer runs in EDIT mode pre-filled with this schedule. */
  initial?: FertigationSchedule | null;
  tankCapacityL?: number;
  isFallbackMode?: boolean;
  onSubmit: (input: Omit<FertigationSchedule, "id">, initial: FertigationSchedule | null) => Promise<void>;
}) {
  const editing = Boolean(initial);

  const [name, setName] = useState("");
  const [recipeId, setRecipeId] = useState(initial?.recipeId ?? "");
  const [recipeList, setRecipeList] = useState(recipes);
  const [recipeName, setRecipeName] = useState("");
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [recipeMessage, setRecipeMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [trigger, setTrigger] = useState<TriggerType>("specific-time");
  const [time, setTime] = useState("06:00");
  const [repeat, setRepeat] = useState<RepeatMode>("Every Day");
  const [days, setDays] = useState<string[]>(["Mon", "Wed", "Fri"]);
  const [intervalH, setIntervalH] = useState("4");
  const [date, setDate] = useState(() => toIsoDateString(getSystemDate()));
  const [targetMode, setTargetMode] = useState<"volume" | "ppm">("volume");
  const [water, setWater] = useState("80");
  const [rawWaterStartThresholdPercent, setRawWaterStartThresholdPercent] = useState("20");
  const [dosingChannels, setDosingChannels] = useState<Record<string, string>>({});
  const [ppm, setPpm] = useState("");
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
    setRecipeList(recipes);
    setRecipeMessage(null);
    if (initial) {
      setName(initial.name);
      setRecipeId(initial.recipeId || "");
      const found = recipes.find((r) => r.id === initial.recipeId);
      setRecipeName(found?.name || "");
      setEnabled(initial.enabled);
      setTrigger(initial.trigger);
      setTime(initial.time);
      const r = initial.repeat || "Every Day";
      setRepeat(r as any);
      setDays(r.split(", ").filter((d) => DAY_OPTIONS.includes(d)));
      setIntervalH(String(initial.intervalHours ?? 4));
      setDate(initial.date ?? toIsoDateString(getSystemDate()));
      setTargetMode(initial.targetMode);
      setWater(String(initial.targetWaterL));
      setRawWaterStartThresholdPercent(String(initial.rawWaterStartThresholdPercent ?? 20));
      setDosingChannels(Object.fromEntries((initial.dosingChannels ?? []).map((c) => [c.componentId, String(c.requestedMl)])));
      setPpm(initial.targetPpm == null ? "" : String(initial.targetPpm));
      setMissedExecute(initial.missedPolicy === "execute");
      setRecoveryH(String(initial.recoveryWindowH));
      setOnlyToday(initial.onlyToday);
      setNotes("");
    } else {
      setName(isFallbackMode ? "Emergency Water Flush" : "");
      setRecipeId("");
      setRecipeName("");
      setEnabled(true);
      setTrigger("specific-time");
      setTime("06:00");
      setRepeat("Every Day");
      setDays(["Mon", "Wed", "Fri"]);
      setIntervalH("4");
      setDate(toIsoDateString(getSystemDate()));
      setTargetMode("volume");
      setWater(isFallbackMode ? "40" : "80");
      setRawWaterStartThresholdPercent("20");
      setDosingChannels({});
      setPpm("");
      setMissedExecute(true);
      setRecoveryH("2");
      setOnlyToday(true);
      setNotes("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, isFallbackMode]);

  useEffect(() => {
    const fromService = recipeService.list();
    const combined = [...recipes];
    for (const r of fromService) {
      if (!combined.some((x) => x.id === r.id)) {
        combined.push(r);
      }
    }
    setRecipeList(combined);
  }, [recipes, open]);

  const recipe = recipeList.find((r) => r.id === recipeId);

  const dirty = (() => {
    if (!initial) {
      return Boolean(name || notes || recipeId);
    }
    return (
      name !== initial.name ||
      recipeId !== (initial.recipeId || "") ||
      enabled !== initial.enabled ||
      trigger !== initial.trigger ||
      time !== initial.time ||
      repeat !== initial.repeat ||
      targetMode !== initial.targetMode ||
      water !== String(initial.targetWaterL) ||
      JSON.stringify(dosingChannels) !== JSON.stringify(Object.fromEntries((initial.dosingChannels ?? []).map((c) => [c.componentId, String(c.requestedMl)])))
    );
  })();

  const form = useDrawerForm({ open, onClose, dirty });

  // keep targets in sync when recipe changes (volume mode, create only)
  useEffect(() => {
    if (open && !editing && targetMode === "volume" && recipe) {
      setWater(String(recipe.waterL));
      setDosingChannels(Object.fromEntries((recipe.dosingChannels ?? []).map((c) => [c.componentId, String(c.requestedMl)])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId, open]);

  const handleSaveRecipe = async () => {
    setSavingRecipe(true);
    setRecipeMessage(null);
    try {
      const targetName = recipeName.trim() || name.trim() || `Recipe ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      const targetW = Number(water) || 80;
      const currentChannels = dosingComponents
        .map((c) => ({
          componentId: c.componentId,
          requestedMl: Number(dosingChannels[c.componentId] || 0),
          ...(c.calibrationId ? { calibrationId: c.calibrationId } : {}),
          ...(c.calibrationVersion ? { calibrationVersion: c.calibrationVersion } : {}),
        }))
        .filter((c) => c.requestedMl > 0);

      const rId = recipeId || `rcp-${Date.now()}`;
      const toSave = {
        id: rId,
        recipeId: rId,
        name: targetName,
        waterL: targetW,
        targetWaterL: targetW,
        // F-C5: Hanya tulis dosingChannels[] — legacy dosingAml/dosingBml akan dihapus di follow-up cleanup.
        dosingChannels: currentChannels,
        targetPpm: targetMode === "ppm" ? Number(ppm) || undefined : undefined,
        targetEc: "-",
        ghId,
      };

      const saved = await recipeService.save(toSave);
      setRecipeList((prev) => [...prev.filter((r) => r.id !== saved.id), saved]);
      setRecipeId(saved.id);
      setRecipeName(saved.name);
      setRecipeMessage({
        type: "success",
        text: `Recipe "${saved.name}" berhasil disimpan ke MicroSD ESP32.`,
      });
    } catch (err: any) {
      console.warn("[AddFertigationDrawer] Save recipe error:", err);
      const isStorageUnavailable =
        err?.code === "STORAGE_UNAVAILABLE" ||
        err?.status === 503 ||
        /storage.*unavailable|microsd|sd.*unmounted/i.test(err?.message || "");
      if (isStorageUnavailable) {
        setRecipeMessage({
          type: "error",
          text: "Storage Unavailable: MicroSD card tidak terpasang di ESP32. Recipe tidak dapat disimpan ke persistent storage.",
        });
      } else {
        setRecipeMessage({
          type: "error",
          text: err?.message || "Gagal menyimpan recipe ke ESP32.",
        });
      }
    } finally {
      setSavingRecipe(false);
    }
  };

  const maxCapacity = tankCapacityL && tankCapacityL > 0 ? tankCapacityL : 100;
  const validate = (): FieldErrors => {
    if (isFallbackMode) {
      return {
        name: required(name, "Fallback procedure name"),
        water: number(water, { label: "Target water", positive: true, max: maxCapacity }),
      };
    }
    const errs: FieldErrors = {
      name: required(name, "Schedule name"),
      time: timeValid(time),
      intervalH: trigger === "interval" ? number(intervalH, { label: "Interval", positive: true, integer: true }) : null,
      date: trigger === "specific-date" ? required(date, "Date") : null,
      water: number(water, { label: "Target water", positive: true, max: maxCapacity }),
      rawWaterStartThresholdPercent: number(rawWaterStartThresholdPercent, { label: "Threshold (%)", positive: true, min: 1, max: 100 }),
      ppm: targetMode === "ppm" ? number(ppm, { label: "Target PPM", positive: true }) : null,
      dosingChannels:
        targetMode === "volume" && dosingComponents.length > 0
          ? (Object.values(dosingChannels).some((value) => Number(value) > 0) ? null : "Add at least one dosing channel.")
          : targetMode === "volume" ? "No operational dosing channels are available from the authoritative inventory." : null,
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
          name: name.trim() || (isFallbackMode ? "Emergency Water Flush" : `Schedule ${time}`),
          recipeId: isFallbackMode ? "" : (recipeId || ""),
          enabled,
          trigger: isFallbackMode ? "specific-time" : trigger,
          time: isFallbackMode ? "" : time,
          repeat: isFallbackMode ? "Every Day" : (trigger === "days-of-week" ? (days.join(", ") as RepeatMode) : repeat),
          intervalHours: !isFallbackMode && trigger === "interval" ? Number(intervalH) || undefined : undefined,
          date: !isFallbackMode && trigger === "specific-date" ? date : undefined,
          targetMode,
          targetWaterL: Number(water) || 0,
          rawWaterStartThresholdPercent: Number(rawWaterStartThresholdPercent) || 20,
          // F-C5: Hanya tulis dosingChannels[] — legacy dosingAml/dosingBml akan dihapus di follow-up cleanup.
          dosingChannels: targetMode === "volume"
            ? dosingComponents
                .map((c) => ({
                  componentId: c.componentId,
                  requestedMl: Number(dosingChannels[c.componentId] || 0),
                  ...(c.calibrationId ? { calibrationId: c.calibrationId } : {}),
                  ...(c.calibrationVersion ? { calibrationVersion: c.calibrationVersion } : {}),
                }))
                .filter((c) => c.requestedMl > 0)
            : [],
          targetPpm: targetMode === "ppm" ? Number(ppm) || undefined : undefined,
          fallbackEnabled: false,
          fallbackScheduleId: undefined,
          isFallback: Boolean(isFallbackMode),
          missedPolicy: isFallbackMode ? "execute" : (missedExecute ? "execute" : "skip"),
          recoveryWindowH: isFallbackMode ? 2 : (Number(recoveryH) || 2),
          onlyToday,
          status: enabled ? "scheduled" : "disabled",
          lastRun: initial?.lastRun ?? null,
          nextRun: isFallbackMode ? null : (enabled ? `Today ${time}` : null),
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
        title={editing ? (isFallbackMode ? "Edit Fallback Procedure" : "Edit Fertigation Schedule") : (isFallbackMode ? "Configure Fallback Procedure" : "Add Fertigation Schedule")}
        subtitle={isFallbackMode ? `Emergency Standby Routine (Plan B) • Greenhouse ${ghCode}` : `Greenhouse ${ghCode}`}
        icon={
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${isFallbackMode ? "bg-amber-500/15 text-amber-400" : "bg-blue-50 text-blue-600"}`}>
            {isFallbackMode ? <ShieldCheck className="h-5 w-5" /> : <Droplets className="h-5 w-5" />}
          </span>
        }
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={form.requestClose}>Cancel</Button>
            <Button size="lg" onClick={submit} disabled={form.saving}>
              {form.saving ? (editing ? "Saving…" : "Creating…") : editing ? "Save Changes" : isFallbackMode ? "Save Fallback Procedure" : "Create Schedule"}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {form.errorBanner}

          {/* 1. Schedule / Fallback Information */}
          <section>
            <SectionTitle
              index={1}
              title={isFallbackMode ? "Fallback Procedure Information" : "Schedule Information"}
              icon={<CalendarClock className="h-3.5 w-3.5" />}
            />
            <div className="space-y-3.5">
              <div>
                <Label required>{isFallbackMode ? "Procedure Name" : "Schedule Name"}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isFallbackMode ? "e.g. Emergency Water Flush" : "e.g. Morning Fertigation"}
                />
                <FieldError>{errors.name}</FieldError>
              </div>

              {!isFallbackMode ? (
                <>
                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <Label>Recipe (optional)</Label>
                      <Select
                        value={recipeId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRecipeId(val);
                          const found = recipeList.find((r) => r.id === val);
                          if (found) {
                            setRecipeName(found.name);
                          }
                        }}
                        options={[
                          { value: "", label: "-- No Recipe (None) --" },
                          ...recipeList.map((r) => ({ value: r.id, label: r.name })),
                        ]}
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

                  {/* Recipe save tool */}
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <Input
                          placeholder={recipe ? recipe.name : "Nama recipe baru (opsional)..."}
                          value={recipeName}
                          onChange={(e) => setRecipeName(e.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        onClick={handleSaveRecipe}
                        disabled={savingRecipe}
                        className="whitespace-nowrap"
                      >
                        <BookmarkPlus className="mr-1.5 h-4 w-4 text-blue-600" />
                        {savingRecipe ? "Menyimpan…" : "Simpan Recipe"}
                      </Button>
                    </div>
                    {recipeMessage && (
                      <div
                        className={`flex items-start gap-2 rounded-lg p-2.5 text-xs font-medium leading-relaxed ${
                          recipeMessage.type === "success"
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                            : "bg-amber-50 text-amber-800 border border-amber-200"
                        }`}
                      >
                        {recipeMessage.type === "success" ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                        ) : (
                          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                        )}
                        <span>{recipeMessage.text}</span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div>
                  <Label>Status</Label>
                  <div className="flex h-9.5 items-center">
                    <Toggle checked={enabled} onChange={setEnabled} label={enabled ? "Armed / Active (Dipersenjatai)" : "Disarmed / Nonaktif (Off)"} />
                  </div>
                </div>
              )}

              <div>
                <Label>Notes</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" />
              </div>
            </div>
          </section>

          {/* 2. Trigger / Schedule Time (Primary Schedules Only) */}
          {!isFallbackMode && (
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
          )}

          {/* Fertigation Target / Emergency Water Flush Target */}
          <section>
            <SectionTitle
              index={isFallbackMode ? 2 : 3}
              title={isFallbackMode ? "Emergency Water Flush Target" : "Fertigation Target"}
              icon={<Droplets className="h-3.5 w-3.5" />}
            />
            {isFallbackMode ? (
              <div className="space-y-3.5">
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
                  <strong>Standby Flush Routine (Plan B):</strong> Prosedur darurat ini otomatis mengeksekusi penyiraman air baku murni untuk mengamankan tanaman ketika jadwal fertigasi utama mengalami kegagalan (misalnya pompa dosing macet atau sensor error).
                </div>
                <div>
                  <Label required>Emergency Flush Water Volume</Label>
                  <Input
                    type="number"
                    min={1}
                    value={water}
                    onChange={(e) => setWater(e.target.value)}
                    unit="L"
                  />
                  <FieldError>{errors.water}</FieldError>
                </div>
              </div>
            ) : (
              <>
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
                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <Label required>Target Water</Label>
                      <Input type="number" min={0} value={water} onChange={(e) => setWater(e.target.value)} unit="L" />
                      <FieldError>{errors.water}</FieldError>
                    </div>
                    <div>
                      <Label required>Raw Water Start Threshold (%)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={rawWaterStartThresholdPercent}
                        onChange={(e) => setRawWaterStartThresholdPercent(e.target.value)}
                        unit="%"
                        placeholder="20"
                      />
                      <FieldError>{errors.rawWaterStartThresholdPercent}</FieldError>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Injeksi pupuk serial dimulai setelah volume air baku mencapai {rawWaterStartThresholdPercent || 20}% dari target.
                  </div>
                  {targetMode === "volume" ? (
                    <div className="space-y-3.5">
                      <div>
                        <Label required>Dosing Channels (up to 7)</Label>
                        {dosingComponents.length === 0 ? (
                          <InfoNote>No operational dosing channels are available from the authoritative inventory. Commission/configure a dosing pump before creating a volume fertigation schedule.</InfoNote>
                        ) : (
                          <div className="grid grid-cols-2 gap-3">
                            {dosingComponents.map((component) => (
                              <div key={component.componentId}>
                                <Label>{component.name}{component.channel ? ` · CH ${component.channel}` : ""}</Label>
                                <Input
                                  type="number"
                                  min={0}
                                  value={dosingChannels[component.componentId] ?? ""}
                                  onChange={(e) => setDosingChannels((prev) => ({ ...prev, [component.componentId]: e.target.value }))}
                                  unit="ml"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        <FieldError>{errors.dosingChannels}</FieldError>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <Label required>Target PPM</Label>
                        <Input type="number" min={0} value={ppm} onChange={(e) => setPpm(e.target.value)} unit="ppm" />
                        <FieldError>{errors.ppm}</FieldError>
                      </div>
                      <InfoNote>
                        In PPM mode the backend calculates the required dosing volume (ml) from target water, target PPM,
                        and the authoritative calibration/execution plan. No dosing estimate is shown until the backend resolves the active components.
                      </InfoNote>
                    </>
                  )}
                </div>
              </>
            )}
          </section>

          {/* 4. Missed Schedule / Power Recovery (Primary Schedules Only) */}
          {!isFallbackMode && (
            <section>
              <SectionTitle index={4} title="Missed Schedule / Power Recovery" icon={<Zap className="h-3.5 w-3.5" />} />
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
          )}
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
