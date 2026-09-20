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
  Trash2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  CheckCircle2,
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
import type { ComplexDeletionPreview, DeletionJob } from "@/lib/api/contracts";

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
  const initialComplexId = params.get("complex") || (complexes[0]?.id ?? null);
  const [addGhFor, setAddGhFor] = useState<string | null>(initialComplexId);

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
    const target = addGhFor || complexes[0]?.id;
    if (!target) {
      setGhError("Create a Complex before adding a Greenhouse.");
      return;
    }
    setSavingGh(true);
    try {
      const created = await greenhouseService.create(target, newCrop);
      setAddGhOpen(false);
      setAddGhFor(target);
      toast(`${created.code} — ${created.crop} created successfully`, "success");
    } catch (e) {
      setGhError(errorMessage(e));
    } finally {
      setSavingGh(false);
    }
  };

  // Delete complex modal state
  const [deletingComplex, setDeletingComplex] = useState<Complex | null>(null);
  const [deletionPreview, setDeletionPreview] = useState<ComplexDeletionPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [activeDeletionJob, setActiveDeletionJob] = useState<DeletionJob | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openDeleteModal = async (c: Complex) => {
    setDeletingComplex(c);
    setDeletionPreview(null);
    setPreviewError(null);
    setDeleteConfirmInput("");
    setDeleting(false);
    setActiveDeletionJob(null);
    setDeleteError(null);
    setLoadingPreview(true);
    try {
      const p = await complexService.getDeletionPreview(c.id);
      setDeletionPreview(p);
    } catch (err) {
      setPreviewError(errorMessage(err));
    } finally {
      setLoadingPreview(false);
    }
  };

  const closeDeleteModal = () => {
    if (deleting && activeDeletionJob && !["COMPLETED", "FAILED_TERMINAL", "WAITING_DEVICE", "CANCELLED"].includes(activeDeletionJob.status)) {
      return;
    }
    setDeletingComplex(null);
    setDeletionPreview(null);
    setActiveDeletionJob(null);
    setDeleteError(null);
    setDeleting(false);
  };

  const executeDeleteComplex = async () => {
    if (!deletingComplex || !deletionPreview) return;
    if (deletionPreview.deletionBlockedByDevice) return;
    if (deleteConfirmInput.trim() !== deletingComplex.code.trim()) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      let job = await complexService.deleteComplex(deletingComplex.id, {
        requestedBy: "operator",
        requestReason: "Operator triggered complex deletion",
      });
      setActiveDeletionJob(job);

      while (["PENDING", "RUNNING"].includes(job.status)) {
        await new Promise((res) => setTimeout(res, 750));
        job = await complexService.getDeletionJob(job.jobId);
        setActiveDeletionJob(job);
      }

      if (job.status === "COMPLETED") {
        toast(`${deletingComplex.code} deleted successfully. Research records preserved.`, "success");
        const remaining = complexes.filter((item) => item.id !== deletingComplex.id);
        if (addGhFor === deletingComplex.id) {
          setAddGhFor(remaining[0]?.id ?? null);
        }
      } else if (job.status === "WAITING_DEVICE") {
        setDeleteError("Deletion halted: bound controller is unreachable. The controller must be online to retire before purging data.");
      } else if (job.status === "FAILED_TERMINAL") {
        setDeleteError(job.errorMessage || "Deletion failed terminally.");
      }
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppShell complexId={addGhFor || complexes[0]?.id}>
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
                  <Button size="sm" variant="danger-outline" onClick={() => openDeleteModal(c)}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete Complex
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
            <Label required>Complex</Label>
            {complexes.length > 1 ? (
              <select
                value={addGhFor || complexes[0]?.id || ""}
                onChange={(event) => setAddGhFor(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                {complexes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} ({c.name || c.location})
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={complexes.find((c) => c.id === (addGhFor || complexes[0]?.id))?.code ?? "–"}
                disabled
              />
            )}
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

      {/* ---------------- Delete Complex Modal ---------------- */}
      <Modal
        open={deletingComplex !== null}
        onClose={closeDeleteModal}
        title={`Delete Complex: ${deletingComplex?.code ?? ""}`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={closeDeleteModal}
              disabled={deleting && activeDeletionJob?.status !== "COMPLETED"}
            >
              {activeDeletionJob?.status === "COMPLETED" ? "Close" : "Cancel"}
            </Button>
            {activeDeletionJob?.status !== "COMPLETED" && (
              <Button
                variant="danger"
                onClick={executeDeleteComplex}
                disabled={
                  loadingPreview ||
                  deleting ||
                  Boolean(deletionPreview?.deletionBlockedByDevice) ||
                  deleteConfirmInput.trim() !== deletingComplex?.code.trim()
                }
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" /> Delete Complex
                  </>
                )}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {previewError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 text-red-600" /> Preflight Preview Failed
              </div>
              <p className="mt-1">{previewError}</p>
            </div>
          )}

          {loadingPreview && (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600 mb-2" />
              <p className="text-xs">Analyzing scoped records and hardware state...</p>
            </div>
          )}

          {deletionPreview && (
            <>
              {/* Controller Status Alert */}
              {deletionPreview.deletionBlockedByDevice ? (
                <div className="rounded-xl border border-red-200 bg-red-50/80 p-3.5 text-xs text-red-800">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="h-5 w-5 shrink-0 text-red-600" />
                    <div>
                      <p className="font-semibold text-red-900">Deletion Blocked: Controller Offline</p>
                      <p className="mt-1 leading-relaxed">
                        Bound controller <code className="rounded bg-red-100 px-1 py-0.5 font-mono text-[11px]">{deletionPreview.boundDevice.deviceId}</code> is unreachable.
                        To ensure physical actuators are safely unlatched and no orphaned autonomous schedules persist, the controller must be online before data purge can proceed.
                      </p>
                      <p className="mt-2 text-red-700">Please power on the controller or restore network connectivity to proceed with retirement.</p>
                    </div>
                  </div>
                </div>
              ) : deletionPreview.boundDevice.deviceId ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-amber-600" />
                    <span>
                      Bound controller <code className="font-semibold text-amber-900">{deletionPreview.boundDevice.deviceId}</code> is online and will be retired cleanly (Wi-Fi credentials preserved).
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  No ESP32 controller is currently bound to this Complex.
                </div>
              )}

              {/* Research Protection Banner - MANDATORY CANONICAL INVARIANT */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs text-emerald-900">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
                  <div>
                    <p className="font-semibold text-emerald-950">Research Data is Fully Preserved</p>
                    <p className="mt-0.5 leading-relaxed text-emerald-800">
                      Agronomic research records remain 100% untouched.{" "}
                      <strong>{deletionPreview.countsPreservedUntouched.cropCycles}</strong> cycles,{" "}
                      <strong>{deletionPreview.countsPreservedUntouched.plants}</strong> plants,{" "}
                      <strong>{deletionPreview.countsPreservedUntouched.fruits}</strong> fruits, and{" "}
                      <strong>{deletionPreview.countsPreservedUntouched.observations}</strong> observations are preserved for scientific analysis.
                    </p>
                  </div>
                </div>
              </div>

              {/* Scope to Purge Summary */}
              <div>
                <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Operational Records to be Purged
                </Label>
                <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-slate-700">
                    <span className="text-slate-400 block text-[11px]">Greenhouses</span>
                    <span className="text-sm font-semibold">{deletionPreview.countsToPurge.greenhouses}</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-slate-700">
                    <span className="text-slate-400 block text-[11px]">Schedules</span>
                    <span className="text-sm font-semibold">{deletionPreview.countsToPurge.schedules}</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-slate-700">
                    <span className="text-slate-400 block text-[11px]">Telemetry Samples</span>
                    <span className="text-sm font-semibold">{deletionPreview.countsToPurge.telemetrySamples}</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-slate-700">
                    <span className="text-slate-400 block text-[11px]">Event Logs</span>
                    <span className="text-sm font-semibold">{deletionPreview.countsToPurge.eventLogs}</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-slate-700">
                    <span className="text-slate-400 block text-[11px]">Calibrations</span>
                    <span className="text-sm font-semibold">{deletionPreview.countsToPurge.calibrations}</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-slate-700">
                    <span className="text-slate-400 block text-[11px]">Fertigation Runs</span>
                    <span className="text-sm font-semibold">{deletionPreview.countsToPurge.fertigationRuns}</span>
                  </div>
                </div>
              </div>

              {/* Live Job Progress if Running */}
              {activeDeletionJob && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-blue-900 flex items-center gap-2">
                      {activeDeletionJob.status === "COMPLETED" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                      )}
                      Status: {activeDeletionJob.status}
                    </span>
                    <span className="text-slate-500 font-mono text-[11px]">Step: {activeDeletionJob.currentStep}</span>
                  </div>
                  {activeDeletionJob.status === "COMPLETED" && (
                    <p className="text-emerald-700 font-medium">
                      All operational records purged successfully ({activeDeletionJob.recordsPurgedTotal} records affected). Research database verified untouched.
                    </p>
                  )}
                  {activeDeletionJob.errorMessage && (
                    <p className="text-red-600">{activeDeletionJob.errorMessage}</p>
                  )}
                </div>
              )}

              {/* Confirmation Input - Only enabled if not blocked */}
              {!activeDeletionJob && !deletionPreview.deletionBlockedByDevice && (
                <div className="pt-2 border-t border-slate-100">
                  <Label required className="text-slate-700">
                    Type <code className="font-bold text-red-600 bg-red-50 px-1 py-0.5 rounded">{deletingComplex?.code}</code> to confirm deletion:
                  </Label>
                  <Input
                    value={deleteConfirmInput}
                    onChange={(e) => setDeleteConfirmInput(e.target.value)}
                    placeholder={deletingComplex?.code}
                    className="mt-1"
                  />
                </div>
              )}
            </>
          )}

          {deleteError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 font-medium">
              {deleteError}
            </div>
          )}
        </div>
      </Modal>

    </AppShell>
  );
}
