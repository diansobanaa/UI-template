"use client";

import { Suspense, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Building2,
  Cpu,
  Droplets,
  Eye,
  Leaf,
  MapPin,
  Pencil,
  Plus,
  Sprout,
  Thermometer,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { MetricCard, SectionCard } from "@/components/ui/cards";
import { Badge, Button, FieldError, Input, Label, StatusBadge } from "@/components/ui/primitives";
import { ConfirmDialog, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { complexService, greenhouseService } from "@/lib/services";
import { useDbVersion } from "@/lib/useDb";
import { errorMessage } from "@/lib/errors";
import { GreenhouseArt } from "@/components/ui/GreenhouseArt";
import { GreenhouseOverviewCard } from "@/components/ui/GreenhouseOverviewCard";
import type { Complex, Greenhouse } from "@/lib/types";

const CROP_OPTIONS = ["Tomato", "Cucumber", "Lettuce", "Spinach", "Strawberry", "Chili", "Bell Pepper", "Broccoli"];

export default function ComplexOverviewPage() {
  return (
    <Suspense fallback={null}>
      <ComplexOverviewContent />
    </Suspense>
  );
}

function ComplexOverviewContent() {
  useDbVersion();
  const [params] = useSearchParams();
  const router = useNavigate();
  const toast = useToast();

  const complexes = complexService.list();
  const [addGhFor, setAddGhFor] = useState<string | null>(null);

  // open Add Greenhouse via ?add=1 from the dashboard
  const initialAdd = params.get("add") === "1";
  const [addGhOpen, setAddGhOpen] = useState(initialAdd);

  const [newCrop, setNewCrop] = useState(CROP_OPTIONS[0]);
  const [ghError, setGhError] = useState<string | null>(null);
  const [savingGh, setSavingGh] = useState(false);
  const [editingComplex, setEditingComplex] = useState<Complex | null>(null);
  const [editingGh, setEditingGh] = useState<Greenhouse | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editCrop, setEditCrop] = useState("");
  const [editTag, setEditTag] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const totalGhs = complexes.reduce((a, c) => a + c.greenhouseIds.length, 0);
  const onlineEsp = complexes.filter((c) => c.esp32.online).length;
  const totalWaterTodayL = complexes.reduce((sum, complex) => sum + (Number.isFinite(complex.water.flowTodayL) ? complex.water.flowTodayL : 0), 0);

  const closeAddGh = () => {
    if (savingGh) return;
    setAddGhOpen(false);
    setAddGhFor(null);
    setGhError(null);
  };

  const openComplexEditor = (complex: Complex) => {
    setEditingComplex(complex);
    setEditingGh(null);
    setEditCode(complex.code);
    setEditName(complex.name);
    setEditLocation(complex.location);
    setEditError(null);
  };

  const openGhEditor = (greenhouse: Greenhouse) => {
    setEditingGh(greenhouse);
    setEditingComplex(null);
    setEditCode(greenhouse.code);
    setEditCrop(greenhouse.crop);
    setEditTag(greenhouse.greenhouseTag);
    setEditError(null);
  };

  const closeEditor = () => {
    if (!savingEdit) {
      setEditingComplex(null);
      setEditingGh(null);
      setEditError(null);
    }
  };

  const saveEditor = async () => {
    setEditError(null);
    setSavingEdit(true);
    try {
      if (editingComplex) {
        await complexService.update(editingComplex.id, { code: editCode, name: editName, location: editLocation });
        toast(`${editCode} updated successfully`, "success");
      } else if (editingGh) {
        await greenhouseService.update(editingGh.id, { code: editCode, crop: editCrop, greenhouseTag: editTag });
        toast(`${editCode} updated successfully`, "success");
      }
      closeEditor();
    } catch (e) {
      setEditError(errorMessage(e));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCreateGh = async () => {
    setGhError(null);
    const target = addGhFor;
    if (!target) {
      setGhError("Create a Complex before adding a Greenhouse.");
      return;
    }
    setSavingGh(true);
    try {
      const created = await greenhouseService.create(target, newCrop);
      setAddGhOpen(false);
      setAddGhFor(null);
      toast(`${created.code} — ${created.crop} created successfully`, "success");
    } catch (e) {
      setGhError(errorMessage(e));
    } finally {
      setSavingGh(false);
    }
  };

  return (
    <AppShell complexId={addGhFor}>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Complex Overview</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">All greenhouse complexes in the ecosystem</p>
        </div>
        <div className="ml-auto">
          <Button onClick={() => router("/onboarding/complex")}>
            <Plus className="h-4 w-4" /> Add Complex & ESP32
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard icon={Building2} iconTone="violet" label="Total Complexes" value={complexes.length} />
        <MetricCard icon={Leaf} iconTone="green" label="Total Greenhouses" value={totalGhs} />
        <MetricCard icon={Cpu} iconTone="blue" label="ESP32 Online" value={`${onlineEsp} / ${complexes.length}`} />
        <MetricCard
          icon={Droplets}
          iconTone="sky"
          label="Water Usage (Today)"
          value={complexes.length === 0 ? "—" : `${totalWaterTodayL.toLocaleString("en-US")} L`}
        >
          <span className="text-xs text-slate-500">{complexes.length === 0 ? "No operational data yet" : "Measured from configured complexes"}</span>
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
                  <Button size="sm" variant="secondary" onClick={() => openComplexEditor(c)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit Complex
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setAddGhFor(c.id); setGhError(null); setAddGhOpen(true); }}>
                    <Plus className="h-3.5 w-3.5" /> Add Greenhouse
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => router(`/onboarding/complex?complex=${encodeURIComponent(c.id)}`)}>
                    <Cpu className="h-3.5 w-3.5" /> {c.esp32.deviceId ? "Manage ESP32" : "Setup ESP32"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => router(`/dashboard?complex=${c.id}`)}>
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
                  <Cpu className="h-3.5 w-3.5 text-slate-400" /> ESP32 {c.esp32.online ? "online" : "offline"} • FW: {c.esp32.firmwareVersion || "v1.0.0"} • CFG: v{c.esp32.configVersion} • {c.esp32.hardwareModel || "Unknown HW"}
                </span>
                <span className="h-3 w-px bg-slate-200" />
                <span>{ghs.length} greenhouses</span>
                <span className="h-3 w-px bg-slate-200" />
                <span>Water today: {c.water.flowTodayL} L</span>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4">
                {ghs.map((g) => <GreenhouseOverviewCard key={g.id} greenhouse={g} complex={c} onEdit={() => openGhEditor(g)} />)}

                {/* Add greenhouse tile */}
                <button
                  onClick={() => { setAddGhFor(c.id); setGhError(null); setAddGhOpen(true); }}
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

      {/* ---------------- Edit metadata modal ---------------- */}
      <Modal
        open={editingComplex !== null || editingGh !== null}
        onClose={closeEditor}
        title={editingComplex ? "Edit Complex Information" : `Edit ${editingGh?.code ?? "Greenhouse"}`}
        footer={
          <>
            <Button variant="secondary" onClick={closeEditor} disabled={savingEdit}>Cancel</Button>
            <Button onClick={saveEditor} disabled={savingEdit}>
              {savingEdit ? "Saving…" : "Save Changes"}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {editError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] font-medium text-red-600">
              {editError}
            </div>
          )}
          <div>
            <Label required>{editingComplex ? "Complex Code" : "Greenhouse Code"}</Label>
            <Input value={editCode} onChange={(event) => setEditCode(event.target.value)} placeholder={editingComplex ? "Complex 01" : "GH tag"} />
          </div>
          {editingComplex ? (
            <>
              <div>
                <Label required>Complex Name</Label>
                <Input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Greenhouse Complex" />
              </div>
              <div>
                <Label required>Location</Label>
                <Input value={editLocation} onChange={(event) => setEditLocation(event.target.value)} placeholder="Lembang, Indonesia" />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label required>Crop / Name</Label>
                <Input value={editCrop} onChange={(event) => setEditCrop(event.target.value)} placeholder="Tomato" />
              </div>
              <div>
                <Label>Greenhouse Tag</Label>
                <Input value={editTag} onChange={(event) => setEditTag(event.target.value)} placeholder="GH tag" />
              </div>
            </>
          )}
          <div className="rounded-lg bg-blue-50/70 px-3 py-2.5 text-xs leading-relaxed text-blue-700">
            Perubahan disimpan ke state aplikasi dan tetap tersedia setelah halaman dimuat ulang.
          </div>
        </div>
      </Modal>

      {/* ---------------- Add Greenhouse modal ---------------- */}
      <Modal
        open={addGhOpen}
        onClose={closeAddGh}
        title="Add Greenhouse"
        footer={
          <>
            <Button variant="secondary" onClick={closeAddGh}>
              Cancel
            </Button>
            <Button onClick={handleCreateGh} disabled={savingGh}>
              {savingGh ? "Creating…" : "Create Greenhouse"}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {ghError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] font-medium text-red-600">
              {ghError}
            </div>
          )}
          <div>
            <Label>Complex</Label>
            <Input
              value={complexes.find((c) => c.id === addGhFor)?.code ?? "–"}
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
