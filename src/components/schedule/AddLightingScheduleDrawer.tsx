"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button, FieldError, InfoNote, Input, Label, Select } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/overlay";
import { time as timeValid, assertValid, type FieldErrors } from "@/lib/validation";
import type { LightingSchedule, RepeatMode } from "@/lib/types";
import { useDrawerForm } from "./useDrawerForm";

export function AddLightingScheduleDrawer({
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
  initial?: LightingSchedule | null;
  onSubmit: (input: Omit<LightingSchedule, "id">, initial: LightingSchedule | null) => Promise<void>;
}) {
  const editing = Boolean(initial);

  const [name, setName] = useState("Night Shutoff");
  const [time, setTime] = useState("22:00");
  const [repeat, setRepeat] = useState<RepeatMode>("Every Day");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const key = initial?.id ?? "__create__";
    if (loadedFor === key) return;
    setLoadedFor(key);
    setErrors({});
    if (initial) {
      setName(initial.name || "Night Shutoff");
      setTime(initial.time || "22:00");
      setRepeat(initial.repeat || "Every Day");
    } else {
      setName("Night Shutoff");
      setTime("22:00");
      setRepeat("Every Day");
    }
  }, [open, initial?.id]);

  const dirty = (() => {
    if (!initial) return true;
    return (
      name !== initial.name ||
      time !== initial.time ||
      repeat !== initial.repeat
    );
  })();

  const form = useDrawerForm({ open, onClose, dirty });

  const validate = (): FieldErrors => ({
    time: timeValid(time, "OFF Time"),
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
          name: name.trim() || `Light OFF — ${time}`,
          time,
          repeat,
          action: "off",
          enabled: initial?.enabled ?? true,
          status: (initial?.status as any) || "scheduled",
          lastRun: initial?.lastRun ?? null,
          nextRun: initial?.nextRun ?? null,
        },
        initial ?? null
      );
    });
  };

  return (
    <Drawer
      open={open}
      onClose={form.requestClose}
      title={editing ? `Edit Lighting OFF Schedule — ${ghCode}` : `Add Lighting OFF Schedule — ${ghCode}`}
      subtitle="Dedicated Greenhouse Lighting automatic turn-off"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={form.requestClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={form.saving}>
            {form.saving ? "Saving..." : editing ? "Save Changes" : "Create Schedule"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-950/20 p-3 text-xs text-amber-300/90">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <div className="font-semibold text-amber-300">Manual ON Only • Dedicated OFF Schedules</div>
            <div className="mt-0.5">Greenhouse lighting can only be turned ON manually via the Web UI or the physical button on the ESP32. Scheduled actions are strictly restricted to turn-OFF only.</div>
          </div>
        </div>

        <div>
          <Label htmlFor="sched-name">Schedule Name</Label>
          <Input
            id="sched-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Night Shutoff"
          />
        </div>

        <div>
          <Label htmlFor="sched-time">Turn-OFF Time</Label>
          <Input
            id="sched-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          {errors.time && <FieldError>{errors.time}</FieldError>}
        </div>

        <div>
          <Label htmlFor="sched-repeat">Recurrence</Label>
          <Select
            id="sched-repeat"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as RepeatMode)}
            options={[
              { value: "Every Day", label: "Every Day (Daily)" },
              { value: "Weekdays", label: "Weekdays (Mon - Fri)" },
              { value: "Weekends", label: "Weekends (Sat - Sun)" },
            ]}
          />
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3 text-xs text-slate-400">
          <div className="font-semibold text-slate-300">Action: TURN OFF (Relay CH3)</div>
          <p className="mt-1">
            This schedule executes an idempotent OFF command on Relay Channel 3 (GPIO 10). No automatic scheduled ON exists.
          </p>
        </div>
      </div>
    </Drawer>
  );
}
