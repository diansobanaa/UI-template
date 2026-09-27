"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { type LucideIcon,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Cpu,
  Database,
  HardDrive,
  Link2,
  Loader2,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Wifi,
  Wrench,
  XCircle,
} from "lucide-react";
import { AppShell, PageTitleBlock } from "@/components/layout/AppShell";
import { Button, FieldError, Input, Label } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { complexService } from "@/lib/services";
import { getActiveBootstrapIp, saveBootstrapIp } from "@/lib/bootstrap-address";
import { Esp32Client } from "@/lib/api/esp32-client";
import { defaultConfig, ESP32_API_BASE, DEFAULT_API_TOKEN, isPythonBackendEnabled } from "@/lib/api/backend-client";
import type { CapabilitiesResponse, ConfigurationPayload, HealthResponse, InventoryResponse, StatusResponse } from "@/lib/api/contracts";
import { getCanonicalBaselineComponents } from "@/lib/data/canonicalHardwareBaseline";
import { PythonClient } from "@/lib/api/python-client";
import { errorMessage } from "@/lib/errors";
import type { Complex } from "@/lib/types";

const STEPS = [
  { title: "Complex", subtitle: "Identity & site" },
  { title: "Discover", subtitle: "Find controller" },
  { title: "Verify", subtitle: "Prove identity" },
  { title: "Bind", subtitle: "Attach controller" },
  { title: "Inventory", subtitle: "Discover hardware" },
] as const;

type ProbeResult = {
  endpoint: string;
  health: HealthResponse;
  status: StatusResponse;
};

function normalizeEndpoint(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/$/, "");
}

function onboardingClient(endpoint: string) {
  return new Esp32Client({
    ...defaultConfig,
    esp32BaseUrl: normalizeEndpoint(endpoint),
    directEsp32Enabled: true,
    token: defaultConfig.token || DEFAULT_API_TOKEN,
  });
}

function checkIcon(ok: boolean, pending = false) {
  if (pending) return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  return ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-slate-300" />;
}

export default function ComplexOnboardingPage() {
  const [params] = useSearchParams();
  const router = useNavigate();
  const toast = useToast();
  const requestedComplexId = params.get("complex") || "";
  const existing = requestedComplexId ? complexService.get(requestedComplexId) : undefined;

  const [step, setStep] = useState(existing ? 1 : 0);
  const [complex, setComplex] = useState<Complex | undefined>(existing);
  const [complexName, setComplexName] = useState(existing?.name || "");
  const [complexCode, setComplexCode] = useState(existing?.code || "");
  const [location, setLocation] = useState(existing?.location || "");
  const [endpoint, setEndpoint] = useState(existing?.esp32.endpoint || getActiveBootstrapIp() || ESP32_API_BASE || "");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [probeState, setProbeState] = useState<"idle" | "running" | "success" | "error">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing) {
      setComplex(existing);
      setComplexName(existing.name);
      setComplexCode(existing.code);
      setLocation(existing.location);
      setEndpoint(existing.esp32.endpoint || getActiveBootstrapIp() || ESP32_API_BASE || "");
    }
  }, [existing?.id]);

  const identity = probe?.health;
  const identityReady = Boolean(identity?.deviceId) && identity?.apiVersion === "v1" && identity?.schemaVersion === 1;
  const complexMatch = Boolean(identity?.complexId && complex && identity.complexId === complex.id);
  const controllerUnassigned = Boolean(identity && !identity.complexId);
  const controllerConflict = Boolean(identity?.complexId && complex && identity.complexId !== complex.id);
  const bound = Boolean(complex?.esp32.deviceId && identity?.deviceId === complex.esp32.deviceId);
  const inventoryReady = Boolean(inventory && probe?.health);
  const capabilitiesReady = Boolean(capabilities && capabilities.valid !== false);
  const complexReady = Boolean(complex && identityReady && !controllerConflict && probe && inventoryReady && capabilitiesReady && (bound || complex.esp32.deviceId === identity?.deviceId));
  const installedCount = inventory?.components?.length ?? 0;
  const commissionedCount = inventory?.components?.filter((component) => component.lifecycleState === "COMMISSIONED" || component.lifecycleState === "ENABLED").length ?? 0;

  const canAdvance = useMemo(() => {
    if (step === 0) return Boolean(complexName.trim() && location.trim());
    if (step === 1) return probeState === "success" && Boolean(probe);
    if (step === 2) return identityReady && !controllerConflict;
    if (step === 3) return Boolean(bound);
    return complexReady;
  }, [step, complexName, location, probeState, probe, identityReady, controllerConflict, bound, complexReady]);

  async function createOrUpdateComplex() {
    setError(null);
    if (!complexName.trim() || !location.trim()) {
      setError("Complex name and location are required.");
      return false;
    }
    setBusy(true);
    try {
      if (!complex) {
        const created = await complexService.create(location, { name: complexName.trim(), code: complexCode.trim() || undefined });
        setComplex(created);
        setComplexName(created.name);
        setComplexCode(created.code);
        setLocation(created.location);
        toast(`${created.code} created. Continue with ESP32 discovery.`, "success");
      } else {
        const updated = await complexService.update(complex.id, { name: complexName.trim(), code: complexCode.trim() || complex.code, location: location.trim() });
        setComplex(updated);
      }
      return true;
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      toast(msg, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function discoverController() {
    setError(null);
    const target = normalizeEndpoint(endpoint);
    if (!target) {
      setError("Enter the ESP32 hostname or IP address.");
      return;
    }
    setProbe(null);
    setInventory(null);
    setCapabilities(null);
    setProbeState("running");
    try {
      const client = onboardingClient(target);
      const [health, status] = await Promise.all([client.getHealth(), client.getStatus()]);
      if (!health.deviceId) throw new Error("ESP32 responded without a deviceId.");
      if (health.apiVersion !== "v1" || health.schemaVersion !== 1) {
        throw new Error(`ESP32 API incompatibility: expected v1/schema 1, got ${health.apiVersion || "missing"}/schema ${health.schemaVersion ?? "missing"}.`);
      }
      const statusDeviceId = String(status.device?.deviceId || "");
      if (statusDeviceId && statusDeviceId !== health.deviceId) throw new Error("Health and status report different controller identities.");
      setProbe({ endpoint: target, health, status });
      saveBootstrapIp(target);
      setProbeState("success");
    } catch (e) {
      setProbeState("error");
      setError(errorMessage(e));
    }
  }

  async function loadStatusAndIdentity(): Promise<boolean> {
    if (!probe) return false;
    setError(null);
    setBusy(true);
    try {
      const client = onboardingClient(probe.endpoint);
      const [health, status] = await Promise.all([client.getHealth(), client.getStatus()]);
      if (!health.deviceId || health.apiVersion !== "v1" || health.schemaVersion !== 1) {
        throw new Error("Controller identity is not compatible with the v1/schema 1 onboarding contract.");
      }
      const statusDeviceId = String(status.device?.deviceId || "");
      if (statusDeviceId !== health.deviceId) throw new Error("Health and status report different controller identities.");
      setProbe((current) => (current ? { ...current, health, status } : current));
      return true;
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const [retiring, setRetiring] = useState(false);

  async function handleForceRetire() {
    if (!probe || !identity) return;
    setError(null);
    setRetiring(true);
    try {
      const client = onboardingClient(probe.endpoint);
      await client.retireDevice(identity.complexId || undefined, "Manual unbind during onboarding");
      toast(`Controller ${identity.deviceId} successfully retired & unbound.`, "success");
      await loadStatusAndIdentity();
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      toast(msg, "error");
    } finally {
      setRetiring(false);
    }
  }

  async function bindController() {
    if (!complex || !probe || !identity) return;
    setError(null);
    setBusy(true);
    try {
      const client = onboardingClient(probe.endpoint);
      // 1. If the physical controller was previously bound to another complex, retire the old assignment first
      if (identity.complexId && identity.complexId !== complex.id) {
        try {
          await client.retireDevice(identity.complexId, "Reassigning during onboarding");
          await new Promise((res) => setTimeout(res, 400));
        } catch (retireErr) {
          console.warn("Could not unbind prior complex assignment, proceeding with direct bind:", retireErr);
        }
      }

      // 2. Perform authoritative direct bind on physical ESP32
      await client.bindDevice(identity.deviceId, complex.id);

      // 3. Persist binding into local complex master record
      const updated = await complexService.bindEsp32Controller(complex.id, {
        deviceId: identity.deviceId,
        endpoint: probe.endpoint,
        apiVersion: identity.apiVersion,
        schemaVersion: identity.schemaVersion,
        firmwareVersion: identity.firmwareVersion,
        hardwareModel: probe.status?.device?.hardwareModel,
        inventoryVersion: identity.inventoryVersion,
      });
      setComplex(updated);
      setProbeState("success");
      toast(`${updated.code} is now bound to ${identity.deviceId}`, "success");

      // 4. Refresh probe identity so identity.complexId reflects the new binding
      await loadStatusAndIdentity();

      // 5. Advance immediately to Step 4 (Discover inventory)
      setStep(4);
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  }

  async function discoverInventory() {
    if (!probe) return;
    setError(null);
    setBusy(true);
    try {
      const client = onboardingClient(probe.endpoint);
      const [nextInventory, nextCapabilities] = await Promise.all([client.getInventory(), client.getCapabilities()]);
      if (nextInventory.deviceId !== identity?.deviceId) throw new Error("Inventory belongs to a different controller identity.");
      if (nextInventory.complexId && complex && nextInventory.complexId !== complex.id) throw new Error("Inventory belongs to a different Complex.");
      setInventory(nextInventory);
      setCapabilities(nextCapabilities);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (step === 4 && bound && !inventory && !busy) {
      discoverInventory();
    }
  }, [step, bound, inventory, busy]);

  const [provisioningBaseline, setProvisioningBaseline] = useState(false);
  const [includeFan, setIncludeFan] = useState(false);

  async function deployBaselineHardware() {
    if (!probe || !complex) return;
    setProvisioningBaseline(true);
    setError(null);
    try {
      const client = onboardingClient(probe.endpoint);
      const baselineComponents = getCanonicalBaselineComponents(complex.id, { includeFan });
      const currentVersion = probe?.status?.configuration?.version ?? 0;
      const nextVersion = currentVersion + 1;

      const fullConfigPayload: ConfigurationPayload = {
        complexId: complex.id,
        version: nextVersion,
        updatedAt: new Date().toISOString(),
        components: baselineComponents,
        assignments: [],
        schedules: [],
        recipes: [],
        topology: [],
        settings: {},
      };

      await client.saveConfiguration(fullConfigPayload, undefined, currentVersion);

      if (isPythonBackendEnabled()) {
        try {
          const pyClient = new PythonClient();
          await pyClient.saveConfiguration(complex.id, fullConfigPayload);
        } catch (err) {
          console.warn("Python backend sync notice:", err);
        }
      }

      toast(`Standard hardware template deployed successfully (${baselineComponents.length} components)!`, "success");
      await discoverInventory();
      await loadStatusAndIdentity();
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      toast(msg, "error");
    } finally {
      setProvisioningBaseline(false);
    }
  }

  async function next() {
    if (step === 0) {
      const ok = await createOrUpdateComplex();
      if (ok) setStep(1);
      return;
    }
    if (step === 1) {
      if (!probe) {
        await discoverController();
        return;
      }
      const verified = await loadStatusAndIdentity();
      if (verified) setStep(2);
      return;
    }
    if (step === 2) {
      if (identityReady && !controllerConflict) setStep(3);
      return;
    }
    if (step === 3) {
      if (!bound) {
        await bindController();
        return;
      }
      setStep(4);
      return;
    }
    if (step === 4) {
      if (!inventory) {
        await discoverInventory();
        return;
      }
      if (complexReady && complex) router(`/complex?complex=${encodeURIComponent(complex.id)}`);
    }
  }

  const statusSummary = probe?.status;

  return (
    <AppShell complexId={complex?.id}>
      <div className="mx-auto max-w-6xl">
        <PageTitleBlock
          title="Complex & ESP32 Onboarding"
          subtitle="Create the Complex, discover its controller, verify identity, bind it, and discover hardware."
        >
          <Button variant="secondary" onClick={() => router(complex ? `/complex?complex=${complex.id}` : "/complex")}>
            <ArrowLeft className="h-4 w-4" /> Back to Complexes
          </Button>
        </PageTitleBlock>

        <div className="mb-6 overflow-hidden rounded-2xl border border-white/10 bg-[#0b1921] shadow-2xl shadow-black/20">
          <div className="border-b border-white/10 px-5 py-5 sm:px-7">
            <div className="flex items-center gap-2 overflow-x-auto">
              {STEPS.map((item, index) => {
                const completed = index < step || (index === 4 && complexReady);
                const active = index === step;
                return (
                  <div key={item.title} className="flex min-w-[140px] flex-1 items-center gap-2">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${completed ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300" : active ? "border-blue-400/60 bg-blue-400/10 text-blue-300" : "border-white/10 bg-white/[0.04] text-slate-500"}`}>
                      {completed ? <Check className="h-4 w-4" /> : index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className={`text-xs font-semibold ${active ? "text-white" : "text-slate-300"}`}>{item.title}</div>
                      <div className="text-[11px] text-slate-500">{item.subtitle}</div>
                    </div>
                    {index < STEPS.length - 1 && <div className="ml-auto hidden h-px flex-1 bg-white/10 sm:block" />}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_330px]">
            <div>
              {error && (
                <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                  <div>{error}</div>
                </div>
              )}

              {step === 0 && (
                <section className="space-y-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300/80">Step 1 / 5</p>
                    <h2 className="mt-1 text-2xl font-semibold text-white">Create the Complex</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">A Complex is the controller boundary for one ESP32. We create the permanent Complex record first; the controller is attached only after its identity is verified.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label required>Complex name</Label>
                      <Input value={complexName} onChange={(e) => setComplexName(e.target.value)} placeholder="Research Complex North" />
                    </div>
                    <div>
                      <Label>Complex code</Label>
                      <Input value={complexCode} onChange={(e) => setComplexCode(e.target.value)} placeholder="Complex 01" />
                    </div>
                    <div className="sm:col-span-2">
                      <Label required>Location</Label>
                      <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lembang, Indonesia" />
                      <FieldError>{!location.trim() ? "Location is required." : null}</FieldError>
                    </div>
                  </div>
                </section>
              )}

              {step === 1 && (
                <section className="space-y-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300/80">Step 2 / 5</p>
                    <h2 className="mt-1 text-2xl font-semibold text-white">Discover the ESP32 controller</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">The browser cannot enumerate mDNS services reliably, so discovery uses the repository contract: known hostname, last-known endpoint, or a manually entered local IP/hostname, then a real <code>/api/v1/health</code> handshake.</p>
                  </div>
                  <div className="rounded-2xl border border-blue-400/20 bg-blue-400/[0.06] p-4">
                    <div className="flex items-start gap-3">
                      <Network className="mt-0.5 h-5 w-5 text-blue-300" />
                      <div>
                        <div className="font-semibold text-white">Controller endpoint</div>
                        <div className="mt-1 text-xs leading-relaxed text-slate-400">Use the device hostname such as <code>esp32-&lt;device-id&gt;.local</code>, its last-known IP, or the current local address.</div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label required>Hostname / IP / endpoint</Label>
                    <div className="flex gap-2">
                      <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="esp32-controller-AABBCCDDEEFF.local or <ESP32_IP>" />
                      <Button onClick={discoverController} disabled={probeState === "running"}>
                        {probeState === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                        Probe
                      </Button>
                    </div>
                  </div>
                  {probe && (
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/10"><Server className="h-5 w-5 text-emerald-300" /></div>
                          <div><div className="text-sm font-semibold text-white">Controller reachable</div><div className="text-xs text-slate-400">{probe.endpoint}</div></div>
                        </div>
                        <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">HEALTH OK</span>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {step === 2 && (
                <section className="space-y-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300/80">Step 3 / 5</p>
                    <h2 className="mt-1 text-2xl font-semibold text-white">Verify controller identity</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">The address is only transport information. The ESP32 <strong className="text-slate-200">deviceId</strong> is the controller identity. A controller reporting another Complex is blocked.</p>
                  </div>
                  {identity && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoRow icon={Cpu} label="Device ID" value={identity.deviceId} ok />
                      <InfoRow icon={Network} label="Complex ID reported by device" value={identity.complexId || "Unassigned"} ok={!controllerConflict} danger={controllerConflict} />
                      <InfoRow icon={ShieldCheck} label="API version" value={identity.apiVersion} ok={identity.apiVersion === "v1"} />
                      <InfoRow icon={Database} label="Schema version" value={String(identity.schemaVersion)} ok={identity.schemaVersion === 1} />
                      <InfoRow icon={HardDrive} label="Firmware" value={identity.firmwareVersion || "—"} ok />
                      <InfoRow icon={Server} label="Hardware model" value={String(statusSummary?.device?.hardwareModel || "—")} ok />
                      <InfoRow icon={Wifi} label="Network state" value={String(statusSummary?.network?.state || "—")} ok={Boolean(statusSummary?.network?.connected)} />
                      <InfoRow icon={Network} label="Network IP" value={String(statusSummary?.network?.ip || "—")} ok={Boolean(statusSummary?.network?.ip)} />
                      <InfoRow icon={Network} label="mDNS hostname" value={statusSummary?.network?.hostname ? `${String(statusSummary.network.hostname)}.local` : "—"} ok={Boolean(statusSummary?.network?.hostname)} />
                    </div>
                  )}
                  {controllerConflict && (
                    <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200 space-y-2.5">
                      <p>
                        This controller reports <strong>{identity?.complexId}</strong>, not <strong>{complex?.id}</strong>. Binding is blocked to prevent cross-Complex attachment.
                      </p>
                      <p className="text-xs text-red-300 leading-relaxed">
                        To reassign this controller, you can unbind and retire it directly below, or delete Complex <strong>{identity?.complexId}</strong> from the Complex Overview page.
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={handleForceRetire}
                          disabled={retiring || busy}
                          className="text-xs font-semibold"
                        >
                          {retiring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          Force Unbind &amp; Retire Controller
                        </Button>
                        <Link
                          to="/complex"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition"
                        >
                          Go to Complex Overview <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  )}
                  {controllerUnassigned && (
                    <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
                      The controller is not currently assigned to a Complex. This is the expected state for a new controller and can be bound after verification.
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm">
                    {controllerConflict ? (
                      <>
                        <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                        <span className="text-red-300 font-medium">
                          Identity rejected: Controller is currently bound to another Complex ({identity?.complexId})
                        </span>
                      </>
                    ) : identityReady ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span className="text-slate-300">Identity contract verified &amp; ready for binding</span>
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-blue-400 shrink-0" />
                        <span className="text-slate-400">Verifying controller identity contract…</span>
                      </>
                    )}
                  </div>
                </section>
              )}

              {step === 3 && (
                <section className="space-y-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300/80">Step 4 / 5</p>
                    <h2 className="mt-1 text-2xl font-semibold text-white">Bind controller to this Complex</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">Binding persists the verified `deviceId` and transport endpoint in the Complex master record. It does not create an active hardware configuration or mark components as commissioned.</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <InfoRow label="Complex" value={complex?.code || "—"} ok />
                      <InfoRow label="Controller" value={identity?.deviceId || "—"} ok={Boolean(identity?.deviceId)} />
                      <InfoRow label="Endpoint" value={probe?.endpoint || "—"} ok={Boolean(probe?.endpoint)} />
                      <InfoRow label="Current binding" value={bound ? "Already bound to this Complex" : (identity?.complexId ? `Bound to ${identity.complexId}` : "Not bound")} ok={bound || !identity?.complexId} />
                    </div>
                  </div>
                  {!bound && (
                    <Button size="lg" onClick={bindController} disabled={busy || controllerConflict || !identityReady}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                      Bind controller
                    </Button>
                  )}
                  {bound && <div className="flex items-center gap-2 text-sm font-medium text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Controller bound successfully.</div>}
                </section>
              )}

              {step === 4 && (
                <section className="space-y-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300/80">Step 5 / 5</p>
                    <h2 className="mt-1 text-2xl font-semibold text-white">Discover inventory & mark Complex Ready</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">Inventory is the controller's observed hardware inventory. Registration is not commissioning, and inventory discovery does not silently deploy a configuration.</p>
                  </div>
                  {!inventory && (
                    <Button size="lg" onClick={discoverInventory} disabled={busy || !bound}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Discover hardware inventory
                    </Button>
                  )}
                  {inventory && (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Stat label="Detected components" value={String(installedCount)} />
                        <Stat label="Commissioned" value={String(commissionedCount)} />
                        <Stat label="Inventory version" value={String(inventory.inventoryVersion)} />
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        {inventory.components.length === 0 ? (
                          <div className="flex items-start gap-3 text-sm text-amber-200"><CircleAlert className="mt-0.5 h-4 w-4 text-amber-300" /><div><strong>No installed components reported yet.</strong><p className="mt-1 text-xs leading-relaxed text-slate-400">The controller is reachable and registered, but physical installation/commissioning is still pending.</p></div></div>
                        ) : (
                          <div className="space-y-2">
                            {inventory.components.map((component) => (
                              <div key={component.componentId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0b1921] px-3 py-2.5">
                                <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-100">{component.name}</div><div className="truncate text-xs text-slate-500">{component.componentId} • {component.supportedTypeId} • {component.role || "No role"}</div></div>
                                <div className="shrink-0 text-right"><div className="text-[11px] font-semibold text-slate-300">{component.lifecycleState}</div><div className="text-[10px] text-slate-500">{component.deploymentStatus}</div></div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {inventory.components.length === 0 ? (
                        <div className="rounded-2xl border border-blue-500/30 bg-blue-950/30 p-5 shadow-xl space-y-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <Sparkles className="h-5 w-5 text-blue-400" />
                                <h3 className="text-base font-semibold text-white">Fast Setup: Deploy Standard AgroTech Panel</h3>
                              </div>
                              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                                Deploy the 5 canonical hardware actuators (Relay 1 = Well Pump, Relay 2 = Dist Pump, Relay 3 = Raw Submersible, MOSFET 1 &amp; 2 = Dosing A &amp; B) with one click. No manual pin mapping required.
                              </p>
                            </div>
                          </div>

                          <div className="grid gap-2.5 sm:grid-cols-2 text-xs">
                            <div className="flex items-center gap-2.5 rounded-xl bg-black/30 border border-white/10 p-2.5 text-slate-200">
                              <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                              <div className="min-w-0">
                                <div className="font-semibold text-white truncate">Well Pump</div>
                                <div className="text-[11px] text-slate-400">Relay Ch 1 • GPIO 1 • Active Low</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2.5 rounded-xl bg-black/30 border border-white/10 p-2.5 text-slate-200">
                              <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                              <div className="min-w-0">
                                <div className="font-semibold text-white truncate">Distribution Pump</div>
                                <div className="text-[11px] text-slate-400">Relay Ch 2 • GPIO 2 • Active Low</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2.5 rounded-xl bg-black/30 border border-white/10 p-2.5 text-slate-200">
                              <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                              <div className="min-w-0">
                                <div className="font-semibold text-white truncate">Raw Submersible Pump</div>
                                <div className="text-[11px] text-slate-400">Relay Ch 4 • GPIO 4 • Active Low</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2.5 rounded-xl bg-black/30 border border-white/10 p-2.5 text-slate-200">
                              <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                              <div className="min-w-0">
                                <div className="font-semibold text-white truncate">Dosing Pumps A &amp; B</div>
                                <div className="text-[11px] text-slate-400">MOSFET Drivers • GPIO 5 &amp; 6</div>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-white/10">
                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={includeFan}
                                onChange={(e) => setIncludeFan(e.target.checked)}
                                className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500"
                              />
                              <span>Include Greenhouse Blower Fan (Relay Ch 3 / GPIO 10)</span>
                            </label>

                            <Button
                              onClick={deployBaselineHardware}
                              disabled={provisioningBaseline || busy || !bound}
                              className="bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md shadow-blue-900/30"
                            >
                              {provisioningBaseline ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                              Deploy Standard Baseline ({includeFan ? 6 : 5} Components)
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={deployBaselineHardware}
                            disabled={provisioningBaseline || busy || !bound}
                            className="text-xs text-slate-400 hover:text-blue-400"
                          >
                            {provisioningBaseline ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                            Re-apply Standard Panel Baseline
                          </Button>
                        </div>
                      )}
                      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5">
                        <div className="flex items-start gap-3">
                          <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-300" />
                          <div>
                            <div className="text-lg font-semibold text-white">Complex Ready</div>
                            <p className="mt-1 text-sm leading-relaxed text-slate-400">Controller identity is verified, binding is persisted, and the inventory endpoint has responded successfully. This is an onboarding-ready state; physical hardware commissioning remains a separate gate.</p>
                          </div>
                        </div>
                      </div>
                      {capabilities && !capabilities.valid ? (
                        <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">Controller capabilities are not yet valid for onboarding readiness: {capabilities.issues?.map((issue) => issue.message).filter(Boolean).join("; ") || "Resolve the reported controller capability issues before continuing."}</div>
                      ) : null}
                    </div>
                  )}
                </section>
              )}
            </div>

            <aside className="rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Readiness</div>
              <div className="mt-4 space-y-3">
                <ReadinessRow label="Complex record" value={Boolean(complex)} />
                <ReadinessRow label="Controller reachable" value={Boolean(probe)} />
                <ReadinessRow label="Identity verified" value={identityReady && !controllerConflict} />
                <ReadinessRow label="Controller bound" value={bound} />
                <ReadinessRow label="Inventory discovered" value={inventoryReady} />
                <ReadinessRow label="Capabilities valid" value={capabilitiesReady} />
              </div>
              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="text-xs font-semibold text-slate-300">Authority boundary</div>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">UI initiates requests and displays state. ESP32 owns physical/runtime execution. Inventory remains observed device state; it does not become active configuration automatically.</p>
              </div>
            </aside>
          </div>

          <div className="flex items-center justify-between border-t border-white/10 px-5 py-4 sm:px-7">
            <Button variant="ghost" onClick={() => setStep((current) => Math.max(existing ? 1 : 0, current - 1))} disabled={step <= (existing ? 1 : 0) || busy}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={next} disabled={!canAdvance || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : step === 4 ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              {step === 0 ? "Create & continue" : step === 1 ? "Verify identity" : step === 2 ? "Continue to binding" : step === 3 ? (bound ? "Continue to inventory" : "Bind controller") : inventory ? "Open Complex" : "Discover inventory"}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between px-1 text-xs text-slate-600">
          <span>Onboarding uses the canonical UI ↔ ESP32 contract.</span>
          <Link to="/complex" className="text-slate-500 hover:text-slate-300">Back to Complex list</Link>
        </div>
      </div>
    </AppShell>
  );
}

function InfoRow({ icon: Icon, label, value, ok = true, danger = false }: { icon?: LucideIcon; label: string; value: string; ok?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      {Icon ? <Icon className={`mt-0.5 h-4 w-4 ${danger ? "text-red-300" : ok ? "text-emerald-300" : "text-slate-500"}`} /> : <div className="mt-0.5">{checkIcon(ok)}</div>}
      <div className="min-w-0"><div className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">{label}</div><div className={`mt-1 break-all text-sm font-medium ${danger ? "text-red-200" : "text-slate-200"}`}>{value}</div></div>
    </div>
  );
}

function ReadinessRow({ label, value }: { label: string; value: boolean }) {
  return <div className="flex items-center justify-between gap-3"><div className="text-sm text-slate-400">{label}</div><div className="flex items-center gap-2">{checkIcon(value)}<span className={`text-xs font-semibold ${value ? "text-emerald-300" : "text-slate-500"}`}>{value ? "Ready" : "Pending"}</span></div></div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="text-2xl font-bold text-white">{value}</div><div className="mt-1 text-xs text-slate-500">{label}</div></div>;
}
