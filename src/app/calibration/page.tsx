"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  CheckCircle2,
  FlaskConical,
  History,
  PlayCircle,
  RefreshCcw,
  ShieldAlert,
  Thermometer,
  Waves,
  Wind,
  Droplets,
  Gauge,
  Activity,
  CircleDot,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ComplexSwitcher, GreenhouseSwitcher } from "@/components/layout/bits";
import { SectionCard } from "@/components/ui/cards";
import { Badge, Button, InfoNote, Input, Label, Progress, StatusBadge } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { calibrationService, complexService, greenhouseService } from "@/lib/services";
import { useDbVersion } from "@/lib/useDb";
import { errorMessage } from "@/lib/errors";
import type { CalibrationDevice } from "@/lib/types";

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ph: FlaskConical,
  ec: Activity,
  "dosing-pump": Droplets,
  "flow-meter": Gauge,
  "water-level": Waves,
  "temp-humidity": Thermometer,
  fan: Wind,
};

const FILTERS = [
  { id: "all", label: "All Devices" },
  { id: "sensors", label: "pH / EC / Temp" },
  { id: "dosing-pumps", label: "Dosing Pumps" },
  { id: "flow-meters", label: "Flow Meters" },
  { id: "actuators", label: "Actuators" },
];

export default function CalibrationPage() {
  return (
    <Suspense fallback={null}>
      <CalibrationContent />
    </Suspense>
  );
}

function CalibrationContent() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();

  const complexes = complexService.list();
  const complexId = params.get("complex") ?? complexes[0].id;
  const complex = complexes.find((c) => c.id === complexId) ?? complexes[0];
  const ghs = greenhouseService.byComplex(complex.id);
  const ghId = params.get("gh") ?? ghs[0]?.id ?? "";
  const gh = greenhouseService.get(ghId) ?? ghs[0];

  const [category, setCategory] = useState("all");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [readValue, setReadValue] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  useDbVersion();

  const categories = calibrationService.categories();
  const devices = calibrationService.devicesForCategory(category).filter((d) => !d.ghId || d.ghId === gh.id || d.ghId === null || category === "all" || true);
  const device = devices.find((d) => d.id === selectedDeviceId) ?? devices[0];
  const history = calibrationService.history();
  const reference = calibrationService.reference();

  const setGh = (id: string) => {
    router.replace(`/calibration?complex=${complex.id}&gh=${id}`, { scroll: false });
    setSelectedDeviceId(null);
  };

  const totalDevices = categories.reduce((a, c) => a + c.devices, 0);
  const totalCalibrated = categories.reduce((a, c) => a + c.calibrated, 0);
  const totalDue = categories.reduce((a, c) => a + c.due, 0);

  return (
    <AppShell complexId={complex.id}>
      {/* Context */}
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <ComplexSwitcher complexId={complex.id} complexes={complexes} />
        <GreenhouseSwitcher complexId={complex.id} greenhouses={ghs} ghId={gh.id} onChange={setGh} label="Greenhouse" />
        <div className="ml-auto flex items-center gap-2.5">
          <Button variant="secondary" onClick={() => toast("Hardware sync requested from ESP32", "info")}>
            <RefreshCcw className="h-4 w-4" /> Sync Hardware
          </Button>
          <Button variant="danger" onClick={() => toast("Emergency stop — calibration aborted", "error")}>
            <ShieldAlert className="h-4 w-4" /> Emergency Stop
          </Button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Calibration</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {complex.code} • {gh.code} — device calibration dashboard
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone="green">{totalCalibrated} calibrated</Badge>
          <Badge tone="amber">{totalDue} due</Badge>
          <Badge tone="gray">{totalDevices} devices</Badge>
        </div>
      </div>

      {/* Device categories */}
      <div className="mb-5">
        <SectionCard title="Device Categories" icon={CircleDot} iconTone="blue">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {categories.map((c) => {
              const Icon = CATEGORY_ICONS[c.id] ?? CircleDot;
              const active = category === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={`cursor-pointer rounded-xl border p-3.5 text-left transition ${
                    active ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-500" : "border-[--color-line] bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <Icon className={`h-5 w-5 ${active ? "text-blue-600" : "text-slate-400"}`} />
                    <span className="text-lg font-bold text-slate-900">{c.devices}</span>
                  </div>
                  <div className="mt-2 text-xs font-medium text-slate-600">{c.name}</div>
                  <div className="mt-1.5">
                    <Progress value={(c.calibrated / Math.max(1, c.devices)) * 100} color="bg-emerald-500" />
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">
                    {c.calibrated}/{c.devices} calibrated{c.due > 0 ? ` • ${c.due} due` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* Device list + calibration panel */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          title="Devices"
          icon={FlaskConical}
          iconTone="blue"
          className="xl:col-span-1"
          action={
            <button
              onClick={() => setCategory("all")}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-blue-600 hover:bg-blue-50"
            >
              {category === "all" ? "All" : "Reset"}
            </button>
          }
          bodyClassName="px-5 pb-5"
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setCategory(f.id)}
                className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  category === f.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="scroll-thin max-h-[430px] space-y-2 overflow-y-auto pr-1">
            {devices.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDeviceId(d.id)}
                className={`w-full cursor-pointer rounded-xl border p-3 text-left transition ${
                  device?.id === d.id ? "border-blue-500 bg-blue-50/50 ring-1 ring-blue-500" : "border-[--color-line] bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-slate-800">{d.name}</span>
                  <StatusBadge status={d.online ? "online" : "offline"} />
                </div>
                <div className="mt-1 text-xs text-slate-500">{d.location}</div>
                <div className="mt-1.5 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Last: {d.lastCalibration}</span>
                  <span className={d.due.includes("in") && parseInt(d.due.replace(/\D/g, "")) <= 30 ? "font-medium text-amber-600" : "text-slate-500"}>
                    {d.due}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>

        {/* Calibration panel */}
        {device && (
          <SectionCard
            title="Device Calibration"
            icon={PlayCircle}
            iconTone="green"
            subtitle={`${device.name} • ${device.location}`}
            className="xl:col-span-2"
            action={<StatusBadge status={device.online ? "online" : "offline"} />}
          >
            <CalibrationPanel device={device} readValue={readValue} setReadValue={setReadValue} onStart={() => setConfirmOpen(true)} />
          </SectionCard>
        )}
      </div>

      {/* History + reference */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Calibration History" icon={History} iconTone="slate">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2.5 font-medium">Date & Time</th>
                  <th className="pb-2.5 font-medium">Device</th>
                  <th className="pb-2.5 font-medium">Type</th>
                  <th className="pb-2.5 font-medium">Before</th>
                  <th className="pb-2.5 font-medium">After</th>
                  <th className="pb-2.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-3 text-slate-600">{h.dateTime}</td>
                    <td className="py-2.5 pr-3 font-medium text-slate-800">{h.device}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{h.type}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{h.before}</td>
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{h.after}</td>
                    <td className="py-2.5">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold ${h.result === "Success" ? "text-emerald-600" : "text-red-500"}`}>
                        {h.result === "Success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                        {h.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="Calibration Reference" icon={BookOpen} iconTone="violet">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2.5 font-medium">Device Type</th>
                  <th className="pb-2.5 font-medium">Method</th>
                  <th className="pb-2.5 font-medium">Standard</th>
                  <th className="pb-2.5 font-medium">Frequency</th>
                </tr>
              </thead>
              <tbody>
                {reference.map((r, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-slate-800">{r.deviceType}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{r.method}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{r.standard}</td>
                    <td className="py-2.5 text-slate-500">{r.frequency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { if (!calibrating) setConfirmOpen(false); }}
        onConfirm={async () => {
          if (!device) return;
          setCalibrating(true);
          try {
            await calibrationService.startCalibration(device, device.reading, readValue || device.reading);
            toast(`Calibration for ${device.name.replace(/\s*\(.*\)$/, "")} saved`, "success");
          } catch (e) {
            toast(errorMessage(e), "error");
          } finally {
            setCalibrating(false);
          }
        }}
        title="Start calibration"
        message={
          device
            ? `Run a calibration cycle on ${device.name}? This is a physical operation — the device will be actuated during sampling.`
            : ""
        }
        confirmLabel={calibrating ? "Calibrating…" : "Start Calibration"}
      />
    </AppShell>
  );
}

function CalibrationPanel({
  device,
  readValue,
  setReadValue,
  onStart,
}: {
  device: CalibrationDevice;
  readValue: string;
  setReadValue: (v: string) => void;
  onStart: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-3.5">
        {/* live reading */}
        <div className="rounded-xl border border-[--color-line] bg-slate-50/60 p-4 text-center">
          <div className="text-xs text-slate-500">Current Reading</div>
          <div className="mt-1 text-4xl font-bold text-slate-900">
            {device.reading}
            <span className="ml-1 text-base font-medium text-slate-400">{device.unit}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">{device.online ? "Live • updated 2s ago" : "Device offline"}</div>
        </div>

        {/* calibration form */}
        <div>
          <Label required>Measured Value</Label>
          <Input
            value={readValue}
            onChange={(e) => setReadValue(e.target.value)}
            placeholder={`Enter measured ${device.measuredUnit || "value"}`}
            unit={device.measuredUnit || undefined}
          />
        </div>
        <div>
          <Label>Standard / Reference</Label>
          <div className="flex flex-wrap gap-1.5">
            {device.standardOptions.map((o) => (
              <span
                key={o}
                className="cursor-default rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-600"
              >
                {o} {device.standardUnit}
              </span>
            ))}
          </div>
        </div>
        <div className="flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={onStart}>
            <RefreshCcw className="h-4 w-4" /> Re-read
          </Button>
          <Button className="flex-1" onClick={onStart}>
            <PlayCircle className="h-4 w-4" /> Start Calibration
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-2.5 text-[13px]">
          {[
            ["Device", device.name],
            ["Location", device.location],
            ["Method", `${device.method === "single" ? "1" : device.method === "two" ? "2" : "3"}-point calibration`],
            ["Last Calibration", device.lastCalibration],
            ["Next Due", device.due],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between rounded-lg border border-slate-100 px-3.5 py-2.5">
              <span className="text-slate-500">{k}</span>
              <span className="font-semibold text-slate-800">{v}</span>
            </div>
          ))}
        </div>
        <InfoNote>
          Calibration is a physical operation: the device is actuated for a fixed sampling period. The ESP32 keeps
          authority over safety — an emergency stop aborts the cycle immediately.
        </InfoNote>
      </div>
    </div>
  );
}
