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
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { MetricCard, SectionCard } from "@/components/ui/cards";
import { Badge, Button, FieldError, Input, Label, StatusBadge } from "@/components/ui/primitives";
import { ConfirmDialog, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { complexService, greenhouseService } from "@/lib/services";
import { refreshOperationalState } from "@/lib/operational-state";
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
  const queryComplexId = params.get("complex");
  const matchingComplex = complexes.find((c) => c.id === queryComplexId);
  // TODO(F-H1): remove complexes[0] silent fallback — butuh audit call site untuk pastikan tidak regress.
  const initialComplexId = matchingComplex?.id || (complexes[0]?.id ?? null);
  const [addGhFor, setAddGhFor] = useState<string | null>(initialComplexId);
  const [deletingGh, setDeletingGh] = useState<Greenhouse | null>(null);
  const [deletingGhBusy, setDeletingGhBusy] = useState(false);

  // open Add Greenhouse via ?add=1 from the dashboard
  const initialAdd = params.get("add") === "1";
  const [addGhOpen, setAddGhOpen] = useState(initialAdd);

  const [newCrop, setNewCrop] = useState(CROP_OPTIONS[0]);
  const [newAreaM2, setNewAreaM2] = useState("500");
  const [ghError, setGhError] = useState<string | null>(null);
  const [savingGh, setSavingGh] = useState(false);
  const [editingComplex, setEditingComplex] = useState<Complex | null>(null);
  const [editingGh, setEditingGh] = useState<Greenhouse | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editCrop, setEditCrop] = useState("");
  const [editTag, setEditTag] = useState("");
  const [editAreaM2, setEditAreaM2] = useState("500");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const totalGhs = complexes.reduce((a, c) => a + c.greenhouseIds.length, 0);
  const onlineEsp = complexes.filter((c) => c.esp32.online).length;
  const totalWaterTodayL = complexes.reduce((sum, complex) => sum + (Number.isFinite(complex.water.flowTodayL) ? complex.water.flowTodayL : 0), 0);

  const closeAddGh = () => {
    if (savingGh) return;
    setAddGhOpen(false);
    setGhError(null);
    setNewAreaM2("500");
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
    setEditAreaM2(greenhouse.areaM2 ? String(greenhouse.areaM2) : "500");
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
        const parsedArea = parseFloat(editAreaM2);
        if (isNaN(parsedArea) || parsedArea <= 0) {
          setEditError("Luas area (m²) harus berupa angka positif.");
          setSavingEdit(false);
          return;
        }
        await greenhouseService.update(editingGh.id, {
          code: editCode,
          crop: editCrop,
          greenhouseTag: editTag,
          areaM2: parsedArea,
        });
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
    // TODO(F-H1): remove complexes[0] silent fallback — butuh audit call site untuk pastikan tidak regress.
    const target = addGhFor || complexes[0]?.id;
    if (!target) {
      setGhError("Create a Complex before adding a Greenhouse.");
      return;
    }
    const parsedArea = parseFloat(newAreaM2);
    if (isNaN(parsedArea) || parsedArea <= 0) {
      setGhError("Luas area (m²) harus berupa angka positif.");
      return;
    }
    setSavingGh(true);
    try {
      const created = await greenhouseService.create(target, newCrop, parsedArea);
      setAddGhOpen(false);
      setNewAreaM2("500");
      setAddGhFor(target);
      toast(`${created.code} — ${created.crop} created successfully`, "success");
    } catch (e) {
      setGhError(errorMessage(e));
    } finally {
      setSavingGh(false);
    }
  };

  const handleDeleteGh = async () => {
    if (!deletingGh) return;
    setDeletingGhBusy(true);
    try {
      await greenhouseService.delete(deletingGh.id);
      toast(`${deletingGh.code} deleted successfully`, "success");
      setDeletingGh(null);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setDeletingGhBusy(false);
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

  const ACTIVE_STATUSES = [
    "REQUESTED",
    "PREFLIGHTING",
    "LOCKED",
    "RETIRING_DEVICE",
    "PURGING",
    "VERIFYING",
    "RUNNING",
    "PENDING",
  ];

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

  const refreshPreview = async () => {
    if (!deletingComplex) return;
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const p = await complexService.getDeletionPreview(deletingComplex.id);
      setDeletionPreview(p);
    } catch (err) {
      setPreviewError(errorMessage(err));
    } finally {
      setLoadingPreview(false);
    }
  };

  const closeDeleteModal = () => {
    if (deleting && activeDeletionJob && ACTIVE_STATUSES.includes(activeDeletionJob.status)) {
      return;
    }
    const targetComplexId = deletingComplex?.id;
    const isCompleted = activeDeletionJob?.status === "COMPLETED";

    setDeletingComplex(null);
    setDeletionPreview(null);
    setActiveDeletionJob(null);
    setDeleteError(null);
    setDeleting(false);

    if (isCompleted && targetComplexId) {
      const remaining = complexes.filter((item) => item.id !== targetComplexId);
      if (params.get("complex") === targetComplexId) {
        if (remaining.length > 0) {
          router(`/complex?complex=${encodeURIComponent(remaining[0].id)}`, { replace: true });
        } else {
          router("/complex", { replace: true });
        }
      }
    }
  };

  const executeDeleteComplex = async () => {
    if (!deletingComplex || !deletionPreview) return;
    if (deletionPreview.deletionBlockedByDevice) return;
    const isConfirmed = deleteConfirmInput.trim() === deletingComplex.code.trim() || Boolean(activeDeletionJob);
    if (!isConfirmed) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      let job = await complexService.deleteComplex(deletingComplex.id, {
        requestedBy: "operator",
        requestReason: "Operator triggered complex deletion",
      });
      setActiveDeletionJob(job);

      // Poll as long as the deletion job is actively executing
      while (ACTIVE_STATUSES.includes(job.status)) {
        await new Promise((res) => setTimeout(res, 600));
        job = await complexService.getDeletionJob(job.jobId);
        setActiveDeletionJob(job);
      }

      if (job.status === "COMPLETED") {
        toast(`${deletingComplex.code} deleted successfully. Research records preserved.`, "success");
        // Remove locally from client operational state
        complexService.removeLocal(deletingComplex.id);
        // Refresh master operational context from backend in background
        await refreshOperationalState().catch(() => {});

        const remaining = complexes.filter((item) => item.id !== deletingComplex.id);
        if (addGhFor === deletingComplex.id) {
          setAddGhFor(remaining[0]?.id ?? null);
        }

        // Reconcile route if URL had deleted complex
        if (params.get("complex") === deletingComplex.id) {
          if (remaining.length > 0) {
            router(`/complex?complex=${encodeURIComponent(remaining[0].id)}`, { replace: true });
          } else {
            router("/complex", { replace: true });
          }
        }
      } else if (job.status === "WAITING_DEVICE") {
        setDeleteError("Deletion halted: bound controller is unreachable. The controller must be online to execute hardware retirement before data purge can proceed.");
      } else if (job.status === "FAILED_RETRYABLE") {
        setDeleteError(`Deletion interrupted (${job.currentStep || "retryable step"}): ${job.errorMessage || "A transient failure occurred. You can retry safely."}`);
      } else if (job.status === "FAILED_TERMINAL") {
        setDeleteError(`Deletion failed terminally: ${job.errorMessage || "Integrity verification failed."}`);
      }
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    // TODO(F-H1): remove complexes[0] silent fallback — butuh audit call site untuk pastikan tidak regress.
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
        {complexes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/40 p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
              <Building2 className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-100">No Greenhouse Complexes Configured</h3>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-400">
              There are currently no operational complexes in the database. Create a new complex to pair an ESP32-S3 controller, configure greenhouses, and start telemetry logging.
            </p>
            <div className="mt-6">
              <Button onClick={() => router("/onboarding/complex")} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                <Plus className="h-4 w-4" /> Add Complex & ESP32
              </Button>
            </div>
          </div>
        ) : (
          complexes.map((c) => {
            const ghs = greenhouseService.byComplex(c.id);
            return (
              <SectionCard
                key={c.id}
                title={c.name || c.code}
                subtitle={`${c.code && c.name ? `${c.code} • ` : ""}${c.location}`}
                icon={Building2}
                iconTone="violet"
                action={
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <StatusBadge status={c.systemStatus.toLowerCase()} />
                    <Button size="sm" variant="secondary" onClick={() => router(`/dashboard?complex=${c.id}`)}>
                      <Eye className="h-3.5 w-3.5" /> Dashboard
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setAddGhFor(c.id); setGhError(null); setAddGhOpen(true); }}>
                      <Plus className="h-3.5 w-3.5" /> Add GH
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => router(`/onboarding/complex?complex=${encodeURIComponent(c.id)}`)}>
                      <Cpu className="h-3.5 w-3.5" /> {c.esp32.deviceId ? "ESP32" : "Setup ESP32"}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => openComplexEditor(c)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button size="sm" variant="danger-outline" onClick={() => openDeleteModal(c)} title={`Delete ${c.code}`}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </div>
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
                  <span>Area: {ghs.reduce((sum, g) => sum + (g.areaM2 || 0), 0).toLocaleString("en-US")} m²</span>
                  <span className="h-3 w-px bg-slate-200" />
                  <span>Water today: {c.water.flowTodayL} L</span>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4">
                  {ghs.map((g) => (
                    <GreenhouseOverviewCard
                      key={g.id}
                      greenhouse={g}
                      complex={c}
                      onEdit={() => openGhEditor(g)}
                      onDelete={() => setDeletingGh(g)}
                    />
                  ))}

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
          })
        )}
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
              <div>
                <Label required>Luas Area (m²)</Label>
                <Input
                  type="number"
                  min="1"
                  step="any"
                  value={editAreaM2}
                  onChange={(event) => setEditAreaM2(event.target.value)}
                  placeholder="500"
                />
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
                // TODO(F-H1): remove complexes[0] silent fallback — butuh audit call site untuk pastikan tidak regress.
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
                // TODO(F-H1): remove complexes[0] silent fallback — butuh audit call site untuk pastikan tidak regress.
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
          <div>
            <Label required>Luas Area (m²)</Label>
            <Input
              type="number"
              min="1"
              step="any"
              value={newAreaM2}
              onChange={(event) => setNewAreaM2(event.target.value)}
              placeholder="500"
            />
          </div>
        </div>
      </Modal>

      {/* ---------------- Delete Complex Modal ---------------- */}
      <Modal
        open={deletingComplex !== null}
        onClose={closeDeleteModal}
        width={640}
        title={
          <div className="flex items-center gap-2 text-slate-900">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 text-red-600">
              <Trash2 className="h-4 w-4" />
            </div>
            <span>Delete Complex: <span className="font-semibold text-red-600">{deletingComplex?.code ?? ""}</span></span>
          </div>
        }
        footer={
          activeDeletionJob?.status === "COMPLETED" ? (
            <Button
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
              onClick={closeDeleteModal}
            >
              <CheckCircle2 className="h-4 w-4" /> Done & Return to Overview
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={closeDeleteModal}
                disabled={Boolean(deleting && activeDeletionJob && ACTIVE_STATUSES.includes(activeDeletionJob.status))}
              >
                Cancel
              </Button>
              {activeDeletionJob?.status === "FAILED_RETRYABLE" ? (
                <Button
                  variant="danger"
                  onClick={executeDeleteComplex}
                  disabled={deleting}
                >
                  <RefreshCw className={`h-4 w-4 ${deleting ? "animate-spin" : ""}`} /> Retry Deletion
                </Button>
              ) : activeDeletionJob?.status === "WAITING_DEVICE" ? (
                <Button
                  variant="danger"
                  onClick={executeDeleteComplex}
                  disabled={deleting}
                >
                  <RefreshCw className={`h-4 w-4 ${deleting ? "animate-spin" : ""}`} /> Re-check & Resume Deletion
                </Button>
              ) : (
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
          )
        }
      >
        <div className="max-h-[72vh] overflow-y-auto pr-1 space-y-4 text-xs">
          {previewError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-800">
              <div className="flex items-center justify-between font-semibold">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600" /> Preflight Preview Failed
                </span>
                <button
                  type="button"
                  onClick={() => refreshPreview()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 underline hover:text-red-900"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                </button>
              </div>
              <p className="mt-1.5 leading-relaxed">{previewError}</p>
            </div>
          )}

          {loadingPreview && !deletionPreview && (
            <div className="flex flex-col items-center justify-center py-10 text-slate-500">
              <Loader2 className="h-7 w-7 animate-spin text-blue-600 mb-2.5" />
              <p className="text-xs font-medium text-slate-700">Analyzing scoped records & controller reachability…</p>
              <p className="mt-1 text-[11px] text-slate-400">Scanning SQLite databases across 7 operational domains</p>
            </div>
          )}

          {/* COMPLETED STATE VIEW */}
          {activeDeletionJob?.status === "COMPLETED" && (
            <div className="space-y-4 py-2 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Complex Successfully Deleted</h3>
                <p className="mt-1 text-slate-500 leading-relaxed">
                  All operational configuration and telemetry for <code className="font-semibold text-slate-800">{deletingComplex?.code}</code> have been permanently purged.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-left">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                  <div className="flex items-center gap-1.5 text-emerald-800 font-semibold text-[11px] uppercase tracking-wider">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Research Data
                  </div>
                  <div className="mt-1 text-base font-bold text-emerald-950">100% Retained</div>
                  <p className="mt-0.5 text-[11px] text-emerald-700">Historical cycles & observations intact</p>
                </div>

                <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3">
                  <div className="flex items-center gap-1.5 text-blue-800 font-semibold text-[11px] uppercase tracking-wider">
                    <Cpu className="h-3.5 w-3.5 text-blue-600" /> ESP32 Controller
                  </div>
                  <div className="mt-1 text-base font-bold text-blue-950">Retired & Unbound</div>
                  <p className="mt-0.5 text-[11px] text-blue-700">Actuators safe, Wi-Fi kept</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-1.5 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
                    <Trash2 className="h-3.5 w-3.5 text-slate-500" /> Records Purged
                  </div>
                  <div className="mt-1 text-base font-bold text-slate-900">
                    {activeDeletionJob.recordsPurgedTotal} Rows
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">Across 7 SQLite tables</p>
                </div>
              </div>
            </div>
          )}

          {/* ACTIVE DELETION PROGRESS VIEW */}
          {activeDeletionJob && activeDeletionJob.status !== "COMPLETED" && (
            <div className="space-y-4 py-1">
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-blue-950 flex items-center gap-2">
                    {activeDeletionJob.status === "WAITING_DEVICE" ? (
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                    ) : activeDeletionJob.status === "FAILED_RETRYABLE" ? (
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    )}
                    Status: {activeDeletionJob.status}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    Step: {activeDeletionJob.currentStep}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="mt-3 h-2 w-full rounded-full bg-blue-100 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      activeDeletionJob.status === "WAITING_DEVICE"
                        ? "bg-amber-500"
                        : activeDeletionJob.status === "FAILED_RETRYABLE"
                        ? "bg-red-500"
                        : "bg-blue-600"
                    }`}
                    style={{
                      width: `${
                        activeDeletionJob.status === "WAITING_DEVICE"
                          ? 25
                          : activeDeletionJob.status === "FAILED_RETRYABLE"
                          ? 40
                          : Math.min(95, Math.max(15, (((activeDeletionJob as any).currentStepNo as number) || 1) * 9))
                      }%`,
                    }}
                  />
                </div>

                {activeDeletionJob.status === "WAITING_DEVICE" && (
                  <p className="mt-2.5 text-xs text-amber-800 leading-relaxed font-medium">
                    Deletion halted safely: The bound controller is currently unreachable. Autonomous irrigation schedules and actuators must be verified safe before data purge can proceed. Please restore power or network connectivity to the ESP32 and click &ldquo;Re-check &amp; Resume Deletion&rdquo;.
                  </p>
                )}

                {activeDeletionJob.status === "FAILED_RETRYABLE" && (
                  <p className="mt-2.5 text-xs text-red-800 leading-relaxed font-medium">
                    A transient error occurred during step <code className="bg-red-100 px-1 rounded">{activeDeletionJob.currentStep}</code>: {activeDeletionJob.errorMessage}. You can safely retry without data corruption.
                  </p>
                )}
              </div>

              {/* Step Audit Tracker */}
              {activeDeletionJob.steps && activeDeletionJob.steps.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Saga Execution Trail
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {activeDeletionJob.steps.map((step) => {
                      const st = step.status as string;
                      const isDone = st === "SUCCEEDED" || st === "SKIPPED" || st === "COMPLETED";
                      const isRunning = st === "RUNNING" || st === "IN_PROGRESS";
                      const isFailed = st === "FAILED" || st === "FAILED_RETRYABLE";
                      return (
                        <div
                          key={step.stepName}
                          className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition ${
                            isRunning
                              ? "bg-blue-50 border border-blue-200 text-blue-950 font-medium"
                              : isDone
                              ? "bg-slate-50 text-slate-700"
                              : isFailed
                              ? "bg-red-50 text-red-900 border border-red-200"
                              : "text-slate-400"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {isDone ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                            ) : isRunning ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 shrink-0" />
                            ) : isFailed ? (
                              <XCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                            ) : (
                              <span className="h-3.5 w-3.5 rounded-full border border-slate-300 inline-block shrink-0" />
                            )}
                            <span>{step.stepName}</span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {step.recordsAffected > 0 ? (
                              <span className="text-emerald-700 font-semibold">{step.recordsAffected} purged</span>
                            ) : (
                              step.status
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* INITIAL PREFLIGHT CONFIRMATION VIEW */}
          {deletionPreview && !activeDeletionJob && (
            <>
              {/* Controller Status Alert */}
              {deletionPreview.deletionBlockedByDevice ? (
                <div className="rounded-xl border border-red-200 bg-red-50/90 p-4 text-xs text-red-900">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-red-950 text-sm">Deletion Blocked: Controller Offline</p>
                        <button
                          type="button"
                          onClick={() => refreshPreview()}
                          disabled={loadingPreview}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 transition shadow-sm"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${loadingPreview ? "animate-spin" : ""}`} />
                          Re-check Controller
                        </button>
                      </div>
                      <p className="mt-1.5 leading-relaxed text-red-800">
                        Bound controller <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono font-semibold text-[11px] text-red-900">{deletionPreview.boundDevice.deviceId}</code> is unreachable on local network.
                      </p>
                      <p className="mt-1 text-[11px] text-red-700 leading-relaxed">
                        <strong>Safety Invariant:</strong> Physical actuators must be unlatched safe and autonomous schedules stopped on the hardware before system records can be purged. Power on the device or reconnect to Wi-Fi to proceed.
                      </p>
                    </div>
                  </div>
                </div>
              ) : deletionPreview.boundDevice.deviceId ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold">
                      <Cpu className="h-4 w-4 text-amber-600" />
                      <span>Bound Controller Online: <code className="font-bold text-amber-950">{deletionPreview.boundDevice.deviceId}</code></span>
                    </div>
                    <button
                      type="button"
                      onClick={() => refreshPreview()}
                      disabled={loadingPreview}
                      className="text-[11px] text-amber-800 hover:text-amber-950 font-medium flex items-center gap-1"
                    >
                      <RefreshCw className={`h-3 w-3 ${loadingPreview ? "animate-spin" : ""}`} /> Re-check
                    </button>
                  </div>
                  <p className="mt-1.5 text-amber-800 leading-relaxed">
                    Controller will be retired safely: Autonomous schedules stopped, actuators forced OFF/safe, and NVS configuration wiped to UNBOUND. Wi-Fi credentials are preserved.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-slate-400" />
                  <span>No ESP32 controller is currently bound to this Complex. Database purge will proceed directly.</span>
                </div>
              )}

              {/* Research Protection Banner - MANDATORY INVARIANT */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 text-xs text-emerald-950">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-sm text-emerald-950">Research Data is Fully Preserved</p>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 uppercase tracking-wide">
                        Immutable Vault
                      </span>
                    </div>
                    <p className="leading-relaxed text-emerald-800">
                      Agronomic scientific records in <code className="bg-emerald-100/70 px-1 py-0.5 rounded text-[11px] font-mono font-medium">agrotech_research.sqlite3</code> will remain 100% untouched.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1 text-[11px] font-medium text-emerald-900">
                      <span className="rounded-md bg-white/80 border border-emerald-200 px-2 py-0.5">
                        🌱 <strong>{deletionPreview.countsPreservedUntouched.cropCycles}</strong> Cycles
                      </span>
                      <span className="rounded-md bg-white/80 border border-emerald-200 px-2 py-0.5">
                        🌿 <strong>{deletionPreview.countsPreservedUntouched.plants}</strong> Plants
                      </span>
                      <span className="rounded-md bg-white/80 border border-emerald-200 px-2 py-0.5">
                        🍅 <strong>{deletionPreview.countsPreservedUntouched.fruits}</strong> Fruits
                      </span>
                      <span className="rounded-md bg-white/80 border border-emerald-200 px-2 py-0.5">
                        📝 <strong>{deletionPreview.countsPreservedUntouched.observations}</strong> Observations
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Scope to Purge Summary */}
              <div>
                <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Operational Records to be Purged
                </Label>
                <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-slate-700">
                    <span className="text-slate-400 block text-[11px]">Greenhouses</span>
                    <span className="text-base font-bold text-slate-900">{deletionPreview.countsToPurge.greenhouses}</span>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-slate-700">
                    <span className="text-slate-400 block text-[11px]">Schedules</span>
                    <span className="text-base font-bold text-slate-900">{deletionPreview.countsToPurge.schedules}</span>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-slate-700">
                    <span className="text-slate-400 block text-[11px]">Telemetry Samples</span>
                    <span className="text-base font-bold text-slate-900">{deletionPreview.countsToPurge.telemetrySamples}</span>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-slate-700">
                    <span className="text-slate-400 block text-[11px]">Event Logs</span>
                    <span className="text-base font-bold text-slate-900">{deletionPreview.countsToPurge.eventLogs}</span>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-slate-700">
                    <span className="text-slate-400 block text-[11px]">Sensor Calibrations</span>
                    <span className="text-base font-bold text-slate-900">{deletionPreview.countsToPurge.calibrations}</span>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-slate-700">
                    <span className="text-slate-400 block text-[11px]">Fertigation Runs</span>
                    <span className="text-base font-bold text-slate-900">{deletionPreview.countsToPurge.fertigationRuns}</span>
                  </div>
                </div>
              </div>

              {/* Confirmation Input */}
              {!deletionPreview.deletionBlockedByDevice && (
                <div className="pt-3 border-t border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label required className="text-slate-800 font-medium">
                      Type <code className="font-mono font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded select-all">{deletingComplex?.code}</code> to confirm:
                    </Label>
                    {deleteConfirmInput.trim() === deletingComplex?.code.trim() ? (
                      <span className="text-emerald-600 font-semibold text-xs flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Match confirmed
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[11px]">Case-sensitive</span>
                    )}
                  </div>
                  <Input
                    value={deleteConfirmInput}
                    onChange={(e) => setDeleteConfirmInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        deleteConfirmInput.trim() === deletingComplex?.code.trim() &&
                        !deletionPreview.deletionBlockedByDevice &&
                        !deleting
                      ) {
                        executeDeleteComplex();
                      }
                    }}
                    placeholder={deletingComplex?.code}
                    className={`transition ${
                      deleteConfirmInput.trim() === deletingComplex?.code.trim()
                        ? "border-emerald-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                        : ""
                    }`}
                  />
                </div>
              )}
            </>
          )}

          {deleteError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 font-medium leading-relaxed">
              {deleteError}
            </div>
          )}
        </div>
      </Modal>
 
      {/* ---------------- Delete greenhouse confirmation modal ---------------- */}
      <ConfirmDialog
        open={deletingGh !== null}
        onClose={() => { if (!deletingGhBusy) setDeletingGh(null); }}
        onConfirm={handleDeleteGh}
        title="Delete Greenhouse"
        message={`Are you sure you want to delete ${deletingGh?.code ?? "this greenhouse"}? This operation will remove the greenhouse and record a tombstone in the System Topology Pool.`}
        confirmLabel={deletingGhBusy ? "Deleting…" : "Delete Greenhouse"}
        danger
      />

    </AppShell>
  );
}
