"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  Cpu,
  Droplets,
  Eye,
  Leaf,
  MapPin,
  Plus,
  Sprout,
  Thermometer,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { MetricCard, SectionCard } from "@/components/ui/cards";
import { Badge, Button, Input, Label, StatusBadge } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { complexService, greenhouseService } from "@/lib/services";
import { GreenhouseArt } from "@/components/ui/GreenhouseArt";

const CROP_OPTIONS = ["Tomato", "Cucumber", "Lettuce", "Spinach", "Strawberry", "Chili", "Bell Pepper", "Broccoli"];

export default function ComplexOverviewPage() {
  return (
    <Suspense fallback={null}>
      <ComplexOverviewContent />
    </Suspense>
  );
}

function ComplexOverviewContent() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();

  const complexes = complexService.list();
  const [addComplexOpen, setAddComplexOpen] = useState(false);
  const [addGhFor, setAddGhFor] = useState<string | null>(null);

  // open Add Greenhouse via ?add=1 from the dashboard
  const initialAdd = params.get("add") === "1";
  const [addGhOpen, setAddGhOpen] = useState(initialAdd);

  const [newLocation, setNewLocation] = useState("");
  const [newCrop, setNewCrop] = useState(CROP_OPTIONS[0]);

  const totalGhs = complexes.reduce((a, c) => a + c.greenhouseIds.length, 0);
  const onlineEsp = complexes.filter((c) => c.esp32.online).length;

  return (
    <AppShell complexId={complexes[0].id}>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Complex Overview</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">All greenhouse complexes in the ecosystem</p>
        </div>
        <div className="ml-auto">
          <Button onClick={() => setAddComplexOpen(true)}>
            <Plus className="h-4 w-4" /> Add Complex
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard icon={Building2} iconTone="violet" label="Total Complexes" value={complexes.length} />
        <MetricCard icon={Leaf} iconTone="green" label="Total Greenhouses" value={totalGhs} />
        <MetricCard icon={Cpu} iconTone="blue" label="ESP32 Online" value={`${onlineEsp} / ${complexes.length}`} />
        <MetricCard icon={Droplets} iconTone="sky" label="Water Usage (Today)" value="2,310 L">
          <span className="text-xs text-emerald-600">+8% vs yesterday</span>
        </MetricCard>
      </div>

      {/* Complex cards */}
      <div className="space-y-5">
        {complexes.map((c) => {
          const ghs = greenhouseService.byComplex(c.id);
          return (
            <SectionCard
              key={c.id}
              title={c.code}
              subtitle={c.location}
              icon={Building2}
              iconTone="violet"
              action={
                <>
                  <StatusBadge status={c.systemStatus.toLowerCase()} />
                  <Button size="sm" variant="outline" onClick={() => { setAddGhFor(c.id); setAddGhOpen(true); }}>
                    <Plus className="h-3.5 w-3.5" /> Add Greenhouse
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => router.push(`/dashboard?complex=${c.id}`)}>
                    <Eye className="h-3.5 w-3.5" /> View Details
                  </Button>
                </>
              }
            >
              {/* complex meta */}
              <div className="mb-4 flex flex-wrap items-center gap-2.5 text-[13px] text-slate-500">
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" /> {c.location}
                </span>
                <span className="h-3 w-px bg-slate-200" />
                <span className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-slate-400" /> ESP32 {c.esp32.online ? "online" : "offline"} • v{c.esp32.configVersion}
                </span>
                <span className="h-3 w-px bg-slate-200" />
                <span>{ghs.length} greenhouses</span>
                <span className="h-3 w-px bg-slate-200" />
                <span>Water today: {c.water.flowTodayL} L</span>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {ghs.map((g) => (
                  <Link
                    key={g.id}
                    href={`/greenhouse/${g.id}?complex=${c.id}`}
                    className="group overflow-hidden rounded-xl border border-[--color-line] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <div className="relative h-[90px] overflow-hidden">
                      <GreenhouseArt crop={g.crop} className="h-full w-full" />
                      <span className="absolute left-2.5 top-2.5">
                        <StatusBadge status={g.online ? "online" : "offline"} />
                      </span>
                    </div>
                    <div className="px-3.5 pb-3.5 pt-3">
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-slate-900">{g.code}</div>
                        <span className="text-[13px] text-slate-500">{g.crop}</span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Thermometer className="h-3.5 w-3.5 text-slate-400" />
                          {g.telemetry.temperatureC !== null ? `${g.telemetry.temperatureC.toFixed(1)}°C` : "–"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Sprout className="h-3.5 w-3.5 text-slate-400" /> HST {g.telemetry.hstDays}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <StatusBadge status={g.fertigationState} />
                        <span className="text-[11px] font-medium text-blue-600 group-hover:underline">View Details</span>
                      </div>
                    </div>
                  </Link>
                ))}

                {/* Add greenhouse tile */}
                <button
                  onClick={() => {
                    setAddGhFor(c.id);
                    setAddGhOpen(true);
                  }}
                  className="flex min-h-[190px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 text-slate-400 transition hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-500"
                >
                  <Plus className="h-7 w-7" />
                  <span className="text-sm font-medium">Add Greenhouse</span>
                </button>
              </div>
            </SectionCard>
          );
        })}
      </div>

      {/* ---------------- Add Complex modal ---------------- */}
      <Modal
        open={addComplexOpen}
        onClose={() => setAddComplexOpen(false)}
        title="Add Complex"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddComplexOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                complexService.create(newLocation.trim() || "New Location");
                setAddComplexOpen(false);
                setNewLocation("");
                toast("Complex created", "success");
                router.refresh();
              }}
            >
              Create Complex
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div>
            <Label>Complex Name</Label>
            <Input value={`Complex ${String(complexes.length + 1).padStart(2, "0")}`} disabled />
          </div>
          <div>
            <Label required>Location</Label>
            <Input value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="e.g. Lembang, Indonesia" />
          </div>
          <div className="rounded-lg bg-blue-50/70 px-3 py-2.5 text-xs leading-relaxed text-blue-700">
            A complex is controlled by one ESP32. After creation, pair the controller and discover its hardware in the
            later backend phase.
          </div>
        </div>
      </Modal>

      {/* ---------------- Add Greenhouse modal ---------------- */}
      <Modal
        open={addGhOpen}
        onClose={() => {
          setAddGhOpen(false);
          setAddGhFor(null);
        }}
        title="Add Greenhouse"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setAddGhOpen(false);
                setAddGhFor(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const target = addGhFor ?? complexes[0].id;
                greenhouseService.create(target, newCrop);
                setAddGhOpen(false);
                setAddGhFor(null);
                toast(`${newCrop} greenhouse added`, "success");
                router.refresh();
              }}
            >
              Create Greenhouse
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div>
            <Label>Complex</Label>
            <Input
              value={complexes.find((c) => c.id === (addGhFor ?? complexes[0].id))?.code ?? "–"}
              disabled
            />
          </div>
          <div>
            <Label required>Crop</Label>
            <div className="flex flex-wrap gap-1.5">
              {CROP_OPTIONS.map((crop) => (
                <button
                  key={crop}
                  onClick={() => setNewCrop(crop)}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] font-medium transition ${
                    newCrop === crop
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {crop}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
