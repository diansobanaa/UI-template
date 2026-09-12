import {
  Activity,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Edit3,
  Gauge,
  Leaf,
  Lightbulb,
  Sprout,
  Thermometer,
  Wind,
  Waves,
  Wheat,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import type { Complex, Greenhouse } from "@/lib/types";
import { greenhouseRealtimeState } from "@/lib/realtime";
import { GreenhouseArt } from "@/components/ui/GreenhouseArt";

const SENSOR_META = [
  {
    match: "temperature sensor",
    label: "Temperature",
    icon: Thermometer,
    value: (gh: Greenhouse) =>
      gh.telemetry.temperatureC === null ? "--" : `${gh.telemetry.temperatureC.toFixed(1)} °C`,
    delta: (gh: Greenhouse) =>
      gh.telemetry.tempDeltaC === null
        ? "--"
        : `${gh.telemetry.tempDeltaC > 0 ? "+" : ""}${gh.telemetry.tempDeltaC} °C`,
    accent: "text-rose-300",
    iconBg: "bg-rose-400/10",
    ring: "ring-rose-300/10",
  },
  {
    match: "humidity sensor",
    label: "Humidity",
    icon: Droplets,
    value: (gh: Greenhouse) => (gh.telemetry.humidityPct === null ? "--" : `${gh.telemetry.humidityPct}%`),
    delta: (gh: Greenhouse) =>
      gh.telemetry.humidityDeltaPct === null
        ? "--"
        : `${gh.telemetry.humidityDeltaPct > 0 ? "+" : ""}${gh.telemetry.humidityDeltaPct}%`,
    accent: "text-sky-300",
    iconBg: "bg-sky-400/10",
    ring: "ring-sky-300/10",
  },
  {
    match: "water level sensor",
    label: "Tank Level",
    icon: Waves,
    value: (gh: Greenhouse) => `${gh.telemetry.tankPct}%`,
    delta: () => "Live",
    accent: "text-cyan-300",
    iconBg: "bg-cyan-400/10",
    ring: "ring-cyan-300/10",
  },
  {
    match: "light sensor",
    label: "Light",
    icon: Activity,
    value: (gh: Greenhouse) =>
      gh.telemetry.lightLux === null ? "--" : `${Math.round(gh.telemetry.lightLux / 1000)}k lux`,
    delta: () => "Live",
    accent: "text-amber-300",
    iconBg: "bg-amber-400/10",
    ring: "ring-amber-300/10",
  },
  {
    match: "flow meter",
    label: "Flow",
    icon: Gauge,
    value: () => "--",
    delta: () => "Not configured",
    accent: "text-blue-300",
    iconBg: "bg-blue-400/10",
    ring: "ring-blue-300/10",
  },
] as const;

export function GreenhouseOverviewCard({
  greenhouse,
  complex,
  onEdit,
}: {
  greenhouse: Greenhouse;
  complex: Complex;
  onEdit?: () => void;
}) {
  const state = greenhouseRealtimeState(greenhouse);
  const equipmentNames = greenhouse.equipment.map((item) => item.name.toLowerCase());

  const sensorCards = SENSOR_META.map((sensor) => ({
    ...sensor,
    equipment: greenhouse.equipment.find((item) => item.name.toLowerCase().includes(sensor.match)),
    available: equipmentNames.some((name) => name.includes(sensor.match)),
  }));

  const running =
    greenhouse.fertigationState === "MIXING" ||
    greenhouse.fertigationState === "DISTRIBUTING";

  const healthy = state === "live";
  const activeSensors = sensorCards.filter(
    (sensor) => sensor.equipment?.status === "OK" && greenhouse.online,
  ).length;

  const cameraPhotos = greenhouse.cameras ?? [];
  const onlineCameraCount = cameraPhotos.filter(
    (camera) => camera.status === "AVAILABLE" && greenhouse.online,
  ).length;
  const cameraSystemAvailable = cameraPhotos.length > 0;
  const [cameraStart, setCameraStart] = useState(0);
  const hasCameraCarousel = cameraPhotos.length > 2;

  const nextCamera = (offset: number) =>
    cameraPhotos.length ? cameraPhotos[(cameraStart + offset) % cameraPhotos.length] : undefined;

  const advanceCamera = (direction: 1 | -1) => {
    if (!hasCameraCarousel) return;
    setCameraStart((current) => (current + direction + cameraPhotos.length) % cameraPhotos.length);
  };

  const cameraLabel = (offset: number) => nextCamera(offset)?.name ?? "No camera";

  const cameraIsLive = (offset: number) => {
    const camera = nextCamera(offset);
    return Boolean(camera && camera.status === "AVAILABLE" && greenhouse.online);
  };

  const cameraStatusLabel = (offset: number) => {
    const camera = nextCamera(offset);
    if (!camera) return "Not installed";
    if (!greenhouse.online) return "GH offline";
    if (camera.status === "OFFLINE") return "Offline";
    if (camera.status === "FAULT") return "Fault";
    if (camera.status === "DISABLED") return "Disabled";
    return camera.capturedAt ?? "Live now";
  };

  const [viewMode, setViewMode] = useState<0 | 1 | 2>(0);
  const touchStartX = useRef(0);

  const nextSlide = () => setViewMode((current) => ((current + 1) % 3) as 0 | 1 | 2);
  const previousSlide = () => setViewMode((current) => ((current + 2) % 3) as 0 | 1 | 2);
  const goToSlide = (slide: 0 | 1 | 2) => setViewMode(slide);

  const dailyTrend = [
    { label: "06", temp: 23, humidity: 78, soil: 64, light: 18 },
    { label: "08", temp: 24, humidity: 76, soil: 65, light: 42 },
    { label: "10", temp: 26, humidity: 72, soil: 66, light: 68 },
    { label: "12", temp: 28, humidity: 69, soil: 63, light: 84 },
    { label: "14", temp: 29, humidity: 67, soil: 61, light: 76 },
    { label: "16", temp: 27, humidity: 70, soil: 62, light: 52 },
    { label: "18", temp: 25, humidity: 74, soil: 64, light: 22 },
  ];

  const chartLine = (key: "temp" | "humidity" | "soil" | "light") =>
    dailyTrend
      .map((point, index) => {
        const x = 16 + (index * 268) / (dailyTrend.length - 1);
        const value = point[key];
        const y = 96 - (value / 100) * 72;
        return `${x},${y}`;
      })
      .join(" ");

  useEffect(() => {
    const timer = window.setInterval(() => {
      setViewMode((current) => ((current + 1) % 3) as 0 | 1 | 2);
    }, 6000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <article
      className={`relative w-full overflow-hidden rounded-[24px] border p-4 shadow-[0_18px_55px_rgba(0,0,0,.18)] transition duration-300 sm:p-5 ${
        healthy
          ? "border-emerald-300/10 bg-[linear-gradient(145deg,rgba(14,35,41,.98),rgba(7,24,29,.98))]"
          : "border-red-400/25 bg-[linear-gradient(145deg,rgba(37,20,24,.98),rgba(13,20,24,.98))]"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(25,213,145,.09),transparent_33%),radial-gradient(circle_at_bottom_left,rgba(34,197,94,.05),transparent_32%)]" />
      <div className="relative min-w-0">
        <header className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <Link
                to={`/greenhouse/${greenhouse.id}?complex=${complex.id}`}
                onClick={(event) => event.stopPropagation()}
                className="text-[27px] font-extrabold leading-none tracking-[-0.04em] text-white transition hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                {greenhouse.code}
              </Link>

              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  greenhouse.online
                    ? "border-emerald-300/15 bg-emerald-400/10 text-emerald-200"
                    : "border-red-300/20 bg-red-400/10 text-red-200"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    greenhouse.online ? "bg-emerald-300 pulse-dot" : "bg-red-400"
                  }`}
                />
                {greenhouse.online ? "Online" : "Offline"}
              </span>

              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-300/10 bg-emerald-400/5 px-2.5 py-1 text-[11px] font-medium text-slate-200">
                <Leaf className="h-3.5 w-3.5 text-emerald-300" />
                {greenhouse.crop}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {greenhouse.cropCycle?.status === "NO_CYCLE" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.035] px-2.5 py-1.5 text-[11px] font-medium text-slate-400">
                  <Sprout className="h-3.5 w-3.5 text-slate-500" />
                  Belum ada tanaman
                </span>
              ) : greenhouse.cropCycle?.status === "HARVESTED" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-200">
                  <Wheat className="h-3.5 w-3.5 text-amber-300" />
                  Selesai Panen
                </span>
              ) : (
                <>
                  <span
                    title="HST = Hari Setelah Tanam"
                    className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.035] px-2.5 py-1.5 text-[11px] text-slate-300"
                  >
                    <Sprout className="h-3.5 w-3.5 text-emerald-300" />
                    HST {greenhouse.telemetry.hstDays}d
                  </span>
                  <span
                    title="HSP = Hari Setelah Polinasi"
                    className="inline-flex shrink-0 cursor-help items-center gap-1 rounded-full border border-white/8 bg-white/[0.035] px-2.5 py-1.5 text-[11px] font-medium text-slate-300"
                  >
                    HSP {(greenhouse.telemetry as Greenhouse["telemetry"] & { hspDays?: number | null }).hspDays ?? "--"}d
                  </span>
                </>
              )}

              {greenhouse.online && (
                <div className="hidden items-center gap-1 sm:flex" aria-label="Active greenhouse events">
                  <span className="grid h-7 w-7 place-items-center rounded-full border border-emerald-300/10 bg-emerald-400/8 text-emerald-300">
                    <Droplets className="h-3.5 w-3.5" />
                  </span>
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-full border ${
                      running
                        ? "border-emerald-300/10 bg-emerald-400/8 text-emerald-300"
                        : "border-white/8 bg-white/[0.035] text-slate-500"
                    }`}
                  >
                    <Waves className="h-3.5 w-3.5" />
                  </span>
                  <span className="grid h-7 w-7 place-items-center rounded-full border border-sky-300/10 bg-sky-400/8 text-sky-300">
                    <Wind className="h-3.5 w-3.5" />
                  </span>
                </div>
              )}
            </div>
          </div>

          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${greenhouse.code}`}
              title={`Edit ${greenhouse.code}`}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.035] text-slate-400 transition hover:border-emerald-300/20 hover:text-emerald-300"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
          )}
        </header>

        {/* Camera strip */}
        <section className="mt-4" aria-label="Greenhouse camera snapshots">
          <div className="relative">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="relative h-[136px] overflow-hidden rounded-[18px] border border-white/10 bg-[#0c171c]">
                <GreenhouseArt
                  crop={greenhouse.crop}
                  variant="landscape"
                  className={`h-full w-full ${!cameraIsLive(0) ? "grayscale opacity-35" : ""}`}
                />
                {!cameraSystemAvailable && (
                  <div className="absolute inset-0 grid place-items-center bg-red-950/45 text-xs font-semibold text-red-100">
                    Camera not installed
                  </div>
                )}
                <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,.72),transparent_55%,rgba(0,0,0,.08))]" />

                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/65 px-2.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur-md">
                  <Camera className="h-3.5 w-3.5" />
                  {cameraLabel(0)}
                </span>

                <span className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/60 px-2 py-1 text-[10px] font-semibold text-slate-100 backdrop-blur-md">
                  <span className={`h-1.5 w-1.5 rounded-full ${cameraIsLive(0) ? "bg-emerald-300 pulse-dot" : "bg-red-400"}`} />
                  {cameraIsLive(0) ? "Live" : cameraStatusLabel(0)}
                </span>
              </div>

              <div className="relative h-[136px] overflow-hidden rounded-[18px] border border-white/10 bg-[#0c171c]">
                <div className="grid h-full grid-cols-2">
                  <div className="relative min-w-0 overflow-hidden border-r border-white/15">
                    <GreenhouseArt
                      crop={greenhouse.crop}
                      variant="landscape"
                      className={`h-full w-full scale-[1.04] ${!cameraIsLive(1) ? "grayscale opacity-35" : ""}`}
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,.7),transparent_60%)]" />
                    <span className="absolute bottom-2 left-2 rounded-md border border-white/10 bg-black/65 px-2 py-1 text-[9px] font-semibold text-white backdrop-blur-md">
                      {cameraLabel(1)}
                    </span>
                  </div>

                  <div className="relative min-w-0 overflow-hidden">
                    <GreenhouseArt
                      crop={greenhouse.crop}
                      variant="landscape"
                      className={`h-full w-full scale-[1.14] ${!cameraIsLive(2) ? "grayscale opacity-35" : ""}`}
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,.7),transparent_60%)]" />
                    <span className="absolute bottom-2 left-2 rounded-md border border-white/10 bg-black/65 px-2 py-1 text-[9px] font-semibold text-white backdrop-blur-md">
                      {cameraLabel(2)}
                    </span>
                  </div>
                </div>

                <span className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/60 px-2 py-1 text-[10px] font-medium text-slate-100 backdrop-blur-md">
                  <span className={`h-1.5 w-1.5 rounded-full ${cameraIsLive(1) || cameraIsLive(2) ? "bg-emerald-300 pulse-dot" : "bg-red-400"}`} />
                  {cameraIsLive(1) || cameraIsLive(2) ? "Live" : cameraStatusLabel(1)}
                </span>
              </div>
            </div>

            {hasCameraCarousel && (
              <>
                <button
                  type="button"
                  aria-label="Previous camera photos"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    advanceCamera(-1);
                  }}
                  className="absolute left-1 top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-[#0c2026]/85 text-slate-200 shadow-lg backdrop-blur hover:bg-[#13333b]"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next camera photos"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    advanceCamera(1);
                  }}
                  className="absolute right-1 top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-[#0c2026]/85 text-slate-200 shadow-lg backdrop-blur hover:bg-[#13333b]"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          <div className="mt-2 flex min-h-9 items-center justify-between gap-3 rounded-xl border border-emerald-300/8 bg-emerald-400/[0.035] px-3 py-2 text-[10px] text-slate-400 sm:text-[11px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <Camera className="h-3.5 w-3.5 shrink-0 text-emerald-300/80" />
              <span>Images updated every 15 minutes</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${greenhouse.online ? "bg-emerald-300" : "bg-red-400"}`} />
              {cameraSystemAvailable ? `${onlineCameraCount}/${cameraPhotos.length} Cameras Online` : "No Cameras Installed"}
            </span>
          </div>
        </section>

        {/* Secondary card */}
        <section className="mt-3 min-w-0" aria-label="Greenhouse overview carousel">
          <div
            className="relative overflow-hidden rounded-[18px] border border-emerald-300/8 bg-black/10"
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0]?.clientX ?? 0;
            }}
            onTouchEnd={(event) => {
              const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
              const difference = endX - touchStartX.current;
              if (Math.abs(difference) < 45) return;
              if (difference < 0) nextSlide();
              else previousSlide();
            }}
          >
            <div
              className="flex w-[300%] transition-transform duration-500 ease-out"
              style={{ transform: `translateX(-${viewMode * (100 / 3)}%)` }}
            >
              {/* Sensors */}
              <div className="w-1/3 shrink-0 p-2.5">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Sensors</span>
                  <span className="text-[10px] text-slate-600">{activeSensors} active</span>
                </div>

                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  {sensorCards.map((sensor) => {
                    const Icon = sensor.icon;
                    const status = sensor.equipment?.status;
                    const usable = sensor.available && status === "OK" && greenhouse.online;
                    const statusLabel = !sensor.available
                      ? "Not installed"
                      : !greenhouse.online
                        ? "GH offline"
                        : status === "WARNING"
                          ? "Needs attention"
                          : status === "FAULT"
                            ? "Fault"
                            : status === "OFFLINE"
                              ? "Offline"
                              : "Live";

                    return (
                      <div
                        key={sensor.label}
                        className={`min-w-0 rounded-[14px] border border-white/8 bg-white/[0.025] px-2.5 py-2.5 ${!usable ? "opacity-55" : ""}`}
                        title={usable ? `${sensor.label} realtime reading` : `${sensor.label}: ${statusLabel} on ${greenhouse.code}`}
                      >
                        <div className={`mb-2 grid h-7 w-7 place-items-center rounded-lg ring-1 ${sensor.iconBg} ${sensor.accent} ${sensor.ring}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="truncate text-[10px] text-slate-500">{sensor.label}</div>
                        <div className={`mt-0.5 whitespace-nowrap text-[19px] font-extrabold leading-tight tracking-tight ${usable ? "text-white" : "text-slate-600"}`}>
                          {usable ? sensor.value(greenhouse) : "--"}
                        </div>
                        <div className={`mt-1 truncate text-[9px] ${usable ? "text-emerald-300" : "text-slate-600"}`}>
                          {usable ? sensor.delta(greenhouse) : statusLabel}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="w-1/3 shrink-0 p-2.5">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Scheduled actions</span>
                  <span className="text-[10px] text-slate-600">Today</span>
                </div>

                <div className="divide-y divide-white/8 rounded-[14px] border border-white/8 bg-white/[0.025] px-3">
                  <div className="flex min-h-[52px] items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-sky-300/10 bg-sky-400/8 text-sky-300">
                      <Droplets className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-white">Watering</div>
                      <div className="truncate text-[10px] text-slate-500">
                        {greenhouse.fertigationSchedules[0]?.time ?? "--:--"} scheduled
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-sky-300/15 bg-sky-400/10 px-2.5 py-1 text-[9px] font-semibold text-sky-200">
                      Upcoming
                    </span>
                  </div>

                  <div className="flex min-h-[52px] items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-sky-300/10 bg-sky-400/8 text-sky-300">
                      <Wind className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-white">Ventilation</div>
                      <div className="truncate text-[10px] text-slate-500">{running ? "Running" : "Auto mode"}</div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-semibold ${
                        running
                          ? "border-emerald-300/15 bg-emerald-400/10 text-emerald-200"
                          : "border-white/8 bg-white/[0.04] text-slate-400"
                      }`}
                    >
                      {running ? "Running" : "Off"}
                    </span>
                  </div>

                  <div className="flex min-h-[52px] items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-amber-300/10 bg-amber-400/8 text-amber-300">
                      <Lightbulb className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-white">Lighting</div>
                      <div className="truncate text-[10px] text-slate-500">Not reported</div>
                    </div>
                    <span className="shrink-0 rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[9px] font-semibold text-slate-400">Off</span>
                  </div>
                </div>
              </div>

              {/* Daily trend */}
              <div className="w-1/3 shrink-0 p-2.5">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Today</span>
                  <span className="text-[10px] text-slate-600">06:00 — 18:00</span>
                </div>

                <div className="rounded-[14px] border border-white/8 bg-white/[0.025] px-2.5 py-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-slate-500">
                    <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-rose-300" />Temp</span>
                    <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-sky-300" />Humidity</span>
                    <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-cyan-300" />Soil</span>
                    <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-amber-300" />Light</span>
                  </div>

                  <svg viewBox="0 0 300 116" className="h-[112px] w-full" role="img" aria-label="Daily temperature, humidity, soil moisture and light trend">
                    <line x1="16" y1="24" x2="284" y2="24" stroke="rgba(255,255,255,.08)" strokeWidth="1" />
                    <line x1="16" y1="60" x2="284" y2="60" stroke="rgba(255,255,255,.08)" strokeWidth="1" />
                    <line x1="16" y1="96" x2="284" y2="96" stroke="rgba(255,255,255,.08)" strokeWidth="1" />
                    <polyline points={chartLine("temp")} fill="none" stroke="#fb7185" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points={chartLine("humidity")} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points={chartLine("soil")} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points={chartLine("light")} fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    {dailyTrend.map((point, index) => {
                      const x = 16 + (index * 268) / (dailyTrend.length - 1);
                      return (
                        <text key={point.label} x={x} y="111" textAnchor="middle" fontSize="8" fill="#647c80">
                          {point.label}
                        </text>
                      );
                    })}
                  </svg>
                </div>
              </div>
            </div>

            <div className="flex h-9 items-center justify-center gap-2 border-t border-white/8 bg-black/10">
              <button
                type="button"
                aria-label="Previous overview"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  previousSlide();
                }}
                className="grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-white/[0.035] text-slate-400 hover:text-emerald-300"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              {[0, 1, 2].map((slide) => (
                <button
                  key={slide}
                  type="button"
                  aria-label={`Show ${slide === 0 ? "sensors" : slide === 1 ? "actions" : "daily trends"}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    goToSlide(slide as 0 | 1 | 2);
                  }}
                  className={`h-1.5 rounded-full transition-all ${
                    viewMode === slide ? "w-5 bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,.55)]" : "w-1.5 bg-slate-700"
                  }`}
                />
              ))}

              <button
                type="button"
                aria-label="Next overview"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  nextSlide();
                }}
                className="grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-white/[0.035] text-slate-400 hover:text-emerald-300"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </section>

        <footer className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/8 pt-3 text-[10px] sm:text-[11px]">
          <div className="flex items-center gap-2 text-slate-500">
            <Gauge className="h-3.5 w-3.5 text-slate-500" />
            <span><strong className="text-slate-200">{activeSensors}</strong> Sensors</span>
          </div>
          <div className="flex items-center gap-2 text-slate-500">
            <Camera className="h-3.5 w-3.5 text-slate-500" />
            <span><strong className="text-slate-200">{cameraPhotos.length}</strong> Cameras</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`grid h-5 w-5 place-items-center rounded-full ${healthy ? "bg-emerald-400 text-[#04231a]" : "bg-red-400 text-[#2d0608]"}`}>
              <Check className="h-3 w-3" />
            </span>
            <strong className={healthy ? "text-emerald-200" : "text-red-200"}>
              {healthy ? "All Systems Normal" : "System attention required"}
            </strong>
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-slate-600">
            <span className={`h-1.5 w-1.5 rounded-full ${greenhouse.online ? "bg-emerald-300" : "bg-red-400"}`} />
            Last updated: now
          </div>
        </footer>
      </div>
    </article>
  );
}
