import {
  Activity, Camera, Check, ChevronLeft, ChevronRight, Droplets, Edit3, Gauge,
  Leaf, Lightbulb, MoreVertical, Sprout, Thermometer, Wind, Waves, Wheat
} from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import type { Complex, Greenhouse } from "@/lib/types";
import { greenhouseRealtimeState } from "@/lib/realtime";
import { GreenhouseArt } from "@/components/ui/GreenhouseArt";

// HSP = Hari Setelah Polinasi. Kept as a tooltip/compact metric in the overview card.
const SENSOR_META = [
  { match: "temperature sensor", label: "Temperature", icon: Thermometer, value: (gh: Greenhouse) => gh.telemetry.temperatureC === null ? "--" : `${gh.telemetry.temperatureC.toFixed(1)} °C`, delta: (gh: Greenhouse) => gh.telemetry.tempDeltaC === null ? "--" : `${gh.telemetry.tempDeltaC > 0 ? "+" : ""}${gh.telemetry.tempDeltaC} °C`, color: "text-red-500", bg: "bg-red-50" },
  { match: "humidity sensor", label: "Humidity", icon: Droplets, value: (gh: Greenhouse) => gh.telemetry.humidityPct === null ? "--" : `${gh.telemetry.humidityPct}%`, delta: (gh: Greenhouse) => gh.telemetry.humidityDeltaPct === null ? "--" : `${gh.telemetry.humidityDeltaPct > 0 ? "+" : ""}${gh.telemetry.humidityDeltaPct}%`, color: "text-sky-500", bg: "bg-sky-50" },
  { match: "water level sensor", label: "Tank Level", icon: Waves, value: (gh: Greenhouse) => `${gh.telemetry.tankPct}%`, delta: () => "Live", color: "text-cyan-500", bg: "bg-cyan-50" },
  { match: "light sensor", label: "Light", icon: Activity, value: (gh: Greenhouse) => gh.telemetry.lightLux === null ? "--" : `${Math.round(gh.telemetry.lightLux / 1000)}k lux`, delta: () => "Live", color: "text-amber-500", bg: "bg-amber-50" },
  { match: "flow meter", label: "Flow", icon: Gauge, value: () => "--", delta: () => "Not configured", color: "text-blue-500", bg: "bg-blue-50" },
] as const;

export function GreenhouseOverviewCard({
  greenhouse, complex, onEdit
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
  const activeSensors = sensorCards.filter((sensor) => sensor.equipment?.status === "OK" && greenhouse.online).length;

  // Camera photos are ordered snapshots. Two photo panels are visible:
  // panel 1 is a single view; panel 2 is split into two views.
  // With more than two snapshots, the pair advances as a carousel.
  const cameraPhotos = greenhouse.cameras ?? [];
  const onlineCameraCount = cameraPhotos.filter((camera) => camera.status === "AVAILABLE" && greenhouse.online).length;
  const cameraSystemAvailable = cameraPhotos.length > 0;
  const [cameraStart, setCameraStart] = useState(0);
  const hasCameraCarousel = cameraPhotos.length > 2;
  const nextCamera = (offset: number) =>
    cameraPhotos.length ? cameraPhotos[(cameraStart + offset) % cameraPhotos.length] : undefined;
  const advanceCamera = (direction: 1 | -1) => {
    if (!hasCameraCarousel) return;
    setCameraStart((current) =>
      (current + direction + cameraPhotos.length) % cameraPhotos.length
    );
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

  // One compact carousel alternates between sensors, actions and daily trends.
  const [viewMode, setViewMode] = useState<0 | 1 | 2>(0);
  const touchStartX = useRef(0);

  const goToSlide = (slide: 0 | 1 | 2) => setViewMode(slide);
  const nextSlide = () => setViewMode((current) => ((current + 1) % 3) as 0 | 1 | 2);
  const previousSlide = () => setViewMode((current) => ((current + 2) % 3) as 0 | 1 | 2);

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
    dailyTrend.map((point, index) => {
      const x = 16 + (index * 268) / (dailyTrend.length - 1);
      const value = point[key];
      const y = 96 - (value / 100) * 72;
      return `${x},${y}`;
    }).join(" ");

  useEffect(() => {
    const timer = window.setInterval(() => {
      setViewMode((current) => ((current + 1) % 3) as 0 | 1 | 2);
    }, 6000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <article className={`relative w-full overflow-hidden rounded-2xl border bg-white p-4 shadow-[0_6px_24px_rgba(31,45,38,0.06)] sm:p-5 ${
      healthy ? "border-[#e5ebe7]" : "border-red-200 bg-red-50/20"
    }`}>
      <div className="min-w-0">
        {/* HEADER */}
        <header className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex  items-center gap-2 whitespace-nowrap">
              <Link
                to={`/greenhouse/${greenhouse.id}?complex=${complex.id}`}
                onClick={(event) => event.stopPropagation()}
                className="text-2xl font-bold leading-none tracking-tight text-[#172033] transition hover:text-[#0aa24d] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:text-[28px]"
              >
                {greenhouse.code}
              </Link>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                greenhouse.online ? "bg-[#e8f8ef] text-[#172033]" : "bg-red-100 text-red-700"
              }`}>
                <span className={`h-2 w-2 rounded-full ${
                  greenhouse.online ? "bg-[#10b85a]" : "bg-red-500"
                }`} />
                {greenhouse.online ? "Online" : "Offline"}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#f1f8f3] px-2.5 py-1.5 text-xs font-medium text-[#172033]">
                    <Leaf className="h-3.5 w-3.5 text-[#0baf5a]" />
                    {greenhouse.crop}
                </span>
            </div>
                
          </div>
        </header>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {greenhouse.cropCycle?.status === "NO_CYCLE" ? (
              <span
                title="Belum ada siklus tanam aktif"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#f1f3f5] px-2.5 py-1.5 text-xs font-medium text-[#52627b]"
              >
                <Sprout className="h-3.5 w-3.5 text-slate-400" />
                Belum ada tanaman
              </span>
            ) : greenhouse.cropCycle?.status === "HARVESTED" ? (
              <span
                title="Siklus tanaman selesai dipanen"
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200/70"
              >
                <Wheat className="h-3.5 w-3.5 text-amber-600" />
                Selesai Panen
              </span>
            ) : (
              <>
                <span
                  title="HST = Hari Setelah Tanam"
                  aria-label={`HST, Hari Setelah Tanam: ${(greenhouse.telemetry as Greenhouse["telemetry"] & { hstDays?: number | null }).hstDays ?? "--"} hari`}
                  className="inline-flex cursor-help items-center gap-1.5 rounded-full bg-[#f6f8fa] px-2.5 py-1.5 text-xs text-[#52627b]"
                >
                  <Sprout className="h-3.5 w-3.5 text-emerald-600" />
                  HST {greenhouse.telemetry.hstDays}d
                </span>
                <span
                  title="HSP = Hari Setelah Polinasi"
                  aria-label="HSP = Hari Setelah Polinasi"
                  className="inline-flex shrink-0 cursor-help items-center gap-1 rounded-full bg-[#f6f8fa] px-2.5 py-1.5 text-xs font-medium text-[#52627b]"
                >
                  HSP {(greenhouse.telemetry as Greenhouse["telemetry"] & { hspDays?: number | null }).hspDays ?? "--"}d
                </span>
              </>
            )}
            
            {greenhouse.online && (
                <div className="hidden items-center gap-1 sm:flex" aria-label="Active greenhouse events">
                    <span title="Irrigation pump active" className="grid h-7 w-7 place-items-center rounded-full bg-[#eaf8f0] text-[#0aa24d] ring-1 ring-[#ccefd9]">
                    <Droplets className="h-3.5 w-3.5" />
                    </span>
                    <span
                    title={running ? "Fertigation mixing active" : "Fertigation ready"}
                    className={`grid h-7 w-7 place-items-center rounded-full ring-1 ${
                        running ? "bg-[#eaf8f0] text-[#0aa24d] ring-[#ccefd9]" : "bg-[#f3f6f5] text-[#8a98a9] ring-[#e3e8e5]"
                    }`}
                    >
                    <Waves className="h-3.5 w-3.5" />
                    </span>
                    <span title="Ventilation fan active" className="grid h-7 w-7 place-items-center rounded-full bg-[#eaf5fa] text-[#168fd0] ring-1 ring-[#d5eaf5]">
                    <Wind className="h-3.5 w-3.5" />
                    </span>
                </div>
                )}
            </div>
            {greenhouse.online && (
          <div className="mt-1.5 flex items-center justify-end gap-1 sm:hidden" aria-label="Active greenhouse events">
            <span title="Irrigation pump active" className="grid h-6 w-6 place-items-center rounded-full bg-[#eaf8f0] text-[#0aa24d]">
              <Droplets className="h-3 w-3" />
            </span>
            <span title={running ? "Fertigation mixing active" : "Fertigation ready"} className={`grid h-6 w-6 place-items-center rounded-full ${
              running ? "bg-[#eaf8f0] text-[#0aa24d]" : "bg-[#f3f6f5] text-[#8a98a9]"
            }`}>
              <Waves className="h-3 w-3" />
            </span>
            <span title="Ventilation fan active" className="grid h-6 w-6 place-items-center rounded-full bg-[#eaf5fa] text-[#168fd0]">
              <Wind className="h-3 w-3" />
            </span>
          </div>
        )}

        {/* CAMERAS — exactly 2 photo panels; panel 2 is split and the pair is a carousel */}
        <section className="mt-4" aria-label="Greenhouse camera snapshots">
          <div className="relative">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">

              {/* PHOTO 1 */}
              <div className="relative h-[128px] overflow-hidden rounded-xl bg-[#dce5df]">
                  <GreenhouseArt
                  crop={greenhouse.crop}
                  variant="landscape"
                    className={`h-full w-full ${!cameraIsLive(0) ? "grayscale opacity-45" : ""}`}
                />
                {!cameraSystemAvailable && <div className="absolute inset-0 grid place-items-center bg-red-950/35 text-sm font-semibold text-white">Camera not installed</div>}
                <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />

                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-md bg-black/75 px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
                  <Camera className="h-3.5 w-3.5" />
                  {cameraLabel(0)}
                </span>

                <span className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-md bg-black/75 px-2 py-1.5 text-[11px] font-medium text-white backdrop-blur-sm">
                  <span className={`h-1.5 w-1.5 rounded-full ${cameraIsLive(0) ? "bg-[#10b85a] pulse-dot" : "bg-red-500"}`} />
                  {cameraStatusLabel(0)}
                </span>
              </div>

              {/* PHOTO 2 — SPLIT LEFT / RIGHT */}
              <div className="relative h-[128px] overflow-hidden rounded-xl bg-[#dce5df]">
                <div className="grid h-full grid-cols-2">

                  <div className="relative min-w-0 overflow-hidden border-r border-white/80">
                    <GreenhouseArt
                      crop={greenhouse.crop}
                      variant="landscape"
                      className={`h-full w-full scale-[1.04] ${!cameraIsLive(1) ? "grayscale opacity-45" : ""}`}
                    />
                    {!cameraSystemAvailable && <div className="absolute inset-0 grid place-items-center bg-red-950/35 text-[10px] font-semibold text-white">Inactive</div>}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    <span className="absolute bottom-2 left-2 rounded-md bg-black/75 px-2 py-1 text-[10px] font-semibold text-white">
                      {cameraLabel(1)}
                    </span>
                  </div>

                  <div className="relative min-w-0 overflow-hidden">
                    <GreenhouseArt
                      crop={greenhouse.crop}
                      variant="landscape"
                      className={`h-full w-full scale-[1.16] ${!cameraIsLive(2) ? "grayscale opacity-45" : ""}`}
                    />
                    {!cameraSystemAvailable && <div className="absolute inset-0 grid place-items-center bg-red-950/35 text-[10px] font-semibold text-white">Inactive</div>}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    <span className="absolute bottom-2 left-2 rounded-md bg-black/75 px-2 py-1 text-[10px] font-semibold text-white">
                      {cameraLabel(2)}
                    </span>
                  </div>

                </div>

                <span className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-md bg-black/75 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
                  <span className={`h-1.5 w-1.5 rounded-full ${cameraIsLive(1) || cameraIsLive(2) ? "bg-[#10b85a] pulse-dot" : "bg-red-500"}`} />
                  {cameraStatusLabel(1)}
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
                  className="absolute left-1 top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-white/80 bg-white/90 text-[#30415a] shadow-md hover:bg-white"
                >
                  ‹
                </button>

                <button
                  type="button"
                  aria-label="Next camera photos"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    advanceCamera(1);
                  }}
                  className="absolute right-1 top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-white/80 bg-white/90 text-[#30415a] shadow-md hover:bg-white"
                >
                  ›
                </button>
              </>
            )}
          </div>

          <div className="mt-1.5 flex min-h-9 items-center justify-between gap-3 rounded-lg bg-[#f5f8f7] px-3 py-2 text-[11px] text-[#425875] sm:text-xs">
            <span className="flex min-w-0 items-center gap-1.5">
              <Camera className="h-3.5 w-3.5 shrink-0" />
              <span>Images updated every 15 minutes</span>
            </span>

            <span className="flex shrink-0 items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${greenhouse.online ? "bg-[#10b85a]" : "bg-red-500"}`} />
              {cameraSystemAvailable ? `${onlineCameraCount}/${cameraPhotos.length} Cameras Online` : "No Cameras Installed"}
            </span>
          </div>
        </section>


        {/* SENSOR / ACTION / DAILY TREND CAROUSEL */}
        <section className="min-w-0" aria-label="Greenhouse overview carousel">
          <div
            className="relative overflow-hidden rounded-xl bg-[#fafcfb]"
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0]?.clientX ?? 0;
            }}
            onTouchEnd={(event) => {
              const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
              const delta = endX - touchStartX.current;
              if (Math.abs(delta) < 45) return;
              if (delta < 0) nextSlide();
              else previousSlide();
            }}
          >
            <div
              className="flex w-[300%] transition-transform duration-400 ease-out"
              style={{ transform: `translateX(-${viewMode * (100 / 3)}%)` }}
            >
              {/* SLIDE 1 — SENSORS */}
              <div className="w-1/3 shrink-0 p-2">
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#718097]">Sensors</span>
                  <span className="text-[10px] text-[#718097]">{activeSensors} active</span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
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
                        className={`min-w-0 rounded-lg border border-[#edf0ee] bg-white px-2.5 py-2 ${!usable ? "opacity-55" : ""}`}
                        title={usable ? `${sensor.label} realtime reading` : `${sensor.label}: ${statusLabel} on ${greenhouse.code}`}
                      >
                        <div className={`mb-1.5 grid h-7 w-7 place-items-center rounded-lg ${sensor.bg} ${sensor.color}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="truncate text-[10px] text-[#52627b]">{sensor.label}</div>
                        <div className={`mt-0.5 whitespace-nowrap text-[20px] font-bold leading-tight tracking-tight ${usable ? "text-[#172033]" : "text-[#718097]"}`}>
                          {usable ? sensor.value(greenhouse) : "--"}
                        </div>
                        <div className={`mt-0.5 truncate text-[9px] ${usable ? "text-[#12a955]" : "text-[#718097]"}`}>
                          {usable ? sensor.delta(greenhouse) : statusLabel}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SLIDE 2 — ACTIONS */}
              <div className="w-1/3 shrink-0 p-2">
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#718097]">Actions</span>
                  <span className="text-[10px] text-[#718097]">Scheduled &amp; equipment</span>
                </div>

                <div className="divide-y divide-[#e8ece9] rounded-lg border border-[#edf0ee] bg-white px-3">
                  <div className="flex min-h-[49px] items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#edf5fa] text-blue-500"><Droplets className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[#172033]">Watering</div>
                      <div className="truncate text-[10px] text-[#52627b]">{greenhouse.fertigationSchedules[0]?.time ?? "--:--"} scheduled</div>
                    </div>
                    <span className="shrink-0 rounded-full bg-[#edf7ff] px-2.5 py-1 text-[9px] font-semibold text-[#2388dc]">Upcoming</span>
                  </div>

                  <div className="flex min-h-[49px] items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#edf5fa] text-blue-500"><Wind className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[#172033]">Ventilation</div>
                      <div className="truncate text-[10px] text-[#52627b]">{running ? "Running" : "Auto"}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-semibold ${running ? "bg-[#e6f8ed] text-[#0aa24d]" : "bg-[#f2f4f5] text-[#53627a]"}`}>
                      {running ? "Running" : "Off"}
                    </span>
                  </div>

                  <div className="flex min-h-[49px] items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fff5dc] text-amber-500"><Lightbulb className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[#172033]">Lighting</div>
                      <div className="truncate text-[10px] text-[#52627b]">Not reported</div>
                    </div>
                    <span className="shrink-0 rounded-full bg-[#f2f4f5] px-2.5 py-1 text-[9px] font-semibold text-[#53627a]">Off</span>
                  </div>
                </div>
              </div>

              {/* SLIDE 3 — DAILY LINE CHART */}
              <div className="w-1/3 shrink-0 p-2">
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#718097]">Today</span>
                  <span className="text-[10px] text-[#718097]">06:00 — 18:00</span>
                </div>

                <div className="rounded-lg border border-[#edf0ee] bg-white px-2.5 py-2">
                  <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-[#52627b]">
                    <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-red-400" />Temp</span>
                    <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-sky-400" />Humidity</span>
                    <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-cyan-400" />Soil</span>
                    <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-amber-400" />Light</span>
                  </div>

                  <svg viewBox="0 0 300 116" className="h-[112px] w-full" role="img" aria-label="Daily temperature, humidity, soil moisture and light trend">
                    <line x1="16" y1="24" x2="284" y2="24" stroke="#edf0ee" strokeWidth="1" />
                    <line x1="16" y1="60" x2="284" y2="60" stroke="#edf0ee" strokeWidth="1" />
                    <line x1="16" y1="96" x2="284" y2="96" stroke="#edf0ee" strokeWidth="1" />

                    <polyline points={chartLine("temp")} fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points={chartLine("humidity")} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points={chartLine("soil")} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points={chartLine("light")} fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

                    {dailyTrend.map((point, index) => {
                      const x = 16 + (index * 268) / (dailyTrend.length - 1);
                      return <text key={point.label} x={x} y="111" textAnchor="middle" fontSize="8" fill="#718097">{point.label}</text>;
                    })}
                  </svg>
                </div>
              </div>
            </div>

            {/* Explicit swipe buttons + slide indicators */}
            <div className="flex h-8 items-center justify-center gap-2 border-t border-[#edf0ee] bg-white/80">
              <button
                type="button"
                aria-label="Previous overview"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  previousSlide();
                }}
                className="grid h-6 w-6 place-items-center rounded-full border border-[#e1e7e3] bg-white text-[#52627b] shadow-sm hover:text-[#0aa24d]"
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
                    viewMode === slide ? "w-5 bg-[#10b85a]" : "w-1.5 bg-[#cbd5d0]"
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
                className="grid h-6 w-6 place-items-center rounded-full border border-[#e1e7e3] bg-white text-[#52627b] shadow-sm hover:text-[#0aa24d]"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#e8ece9] pt-3 text-xs">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-[#52627b]" />
            <span>
              <strong className="text-[#172033]">{activeSensors}</strong>{" "}
              <span className="text-[#52627b]">Sensors</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-[#52627b]" />
            <span>
              <strong className="text-[#172033]">3</strong>{" "}
              <span className="text-[#52627b]">Cameras</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className={`grid h-5 w-5 place-items-center rounded-full text-white ${
              healthy ? "bg-[#13b45a]" : "bg-red-500"
            }`}>
              <Check className="h-3 w-3" />
            </span>
            <strong className={healthy ? "text-[#172033]" : "text-red-700"}>
              {healthy ? "All Systems Normal" : "System attention required"}
            </strong>
          </div>

          <div className="ml-auto flex items-center gap-1.5 text-[#52627b]">
            <span className={`h-1.5 w-1.5 rounded-full ${
              greenhouse.online ? "bg-[#10b85a]" : "bg-red-500"
            }`} />
            Last updated: now
          </div>
        </footer>
      </div>

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${greenhouse.code}`}
          title={`Edit ${greenhouse.code}`}
          className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-lg bg-white/90 text-[#30415a] shadow-sm transition hover:text-blue-600"
        >
          <Edit3 className="h-3.5 w-3.5" />
        </button>
      )}
    </article>
  );
}
