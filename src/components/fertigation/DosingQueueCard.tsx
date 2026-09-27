import React, { useEffect, useState, useMemo } from 'react';
import { 
  Layers, 
  Droplets, 
  FlaskConical, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Gauge, 
  ShieldCheck, 
  Activity, 
  RefreshCw,
  Info
} from 'lucide-react';
import { esp32Client } from '@/lib/api/esp32-client';
import type { DosingBatchRuntimeSnapshot, QueuedBatchItem } from '@/lib/types';

interface DosingQueueCardProps {
  currentGhId?: string;
  className?: string;
}

export const DosingQueueCard: React.FC<DosingQueueCardProps> = ({ currentGhId, className = '' }) => {
  const [snapshot, setSnapshot] = useState<DosingBatchRuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [manualSyncing, setManualSyncing] = useState<boolean>(false);

  const fetchStatus = async () => {
    try {
      const data = await esp32Client.getFertigationStatus();
      if (data) {
        // Map raw or enriched response to authoritative DosingBatchRuntimeSnapshot
        const normalized: DosingBatchRuntimeSnapshot = {
          batchId: data.batchId || data.runId || 'IDLE',
          ghId: data.ghId || 'gh-a',
          runtimeState: data.runtimeState || (
            data.state === 'FERT_STATE_FILLING' ? 'MIXING_RAW_WATER' :
            data.state === 'FERT_STATE_DOSING' ? 'DOSING' :
            data.state === 'FERT_STATE_MIX_READY' ? 'READY' :
            data.state === 'FERT_STATE_DELIVERY' ? 'DISTRIBUTING' :
            data.state === 'FERT_STATE_COMPLETE' ? 'COMPLETED' :
            data.state === 'FERT_STATE_FAULTED' ? 'FAILED' :
            data.state === 'FERT_STATE_ABORTED' ? 'CANCELLED' : 'IDLE'
          ),
          activeChannel: data.activeChannel || (
            data.state === 'FERT_STATE_DOSING' ? 'A' : ''
          ),
          rawWaterActualMl: data.rawWaterActualMl ?? data.actualWaterMl ?? 0,
          rawWaterTargetMl: data.rawWaterTargetMl ?? data.targetWaterMl ?? 20000,
          thresholdPercent: data.thresholdPercent ?? 20,
          dosing: data.dosing || { A: 20, B: 20, N: 20 },
          queuedBatches: data.queuedBatches || []
        };
        setSnapshot(normalized);
        setLastUpdated(new Date());
      }
    } catch {
      // Fallback: provide clean idle state if device is connecting
      if (!snapshot) {
        setSnapshot({
          batchId: 'NONE',
          ghId: currentGhId || 'gh-a',
          runtimeState: 'IDLE',
          activeChannel: '',
          rawWaterActualMl: 0,
          rawWaterTargetMl: 20000,
          thresholdPercent: 20,
          dosing: { A: 20, B: 20, N: 20 },
          queuedBatches: []
        });
      }
    } finally {
      setLoading(false);
      setManualSyncing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleManualSync = () => {
    setManualSyncing(true);
    fetchStatus();
  };

  const isDosing = snapshot?.runtimeState === 'DOSING';
  const isFilling = snapshot?.runtimeState === 'MIXING_RAW_WATER';
  const isReady = snapshot?.runtimeState === 'READY';
  const isActive = isDosing || isFilling || isReady;

  const thresholdPercent = snapshot?.thresholdPercent ?? 20;
  const rawActual = snapshot?.rawWaterActualMl ?? 0;
  const rawTarget = snapshot?.rawWaterTargetMl ?? 20000;
  const rawFillPct = rawTarget > 0 ? Math.min(100, Math.round((rawActual / rawTarget) * 100)) : 0;
  const thresholdVolume = Math.round((rawTarget * thresholdPercent) / 100);
  const thresholdReached = rawActual >= thresholdVolume;

  const activeGhMatches = currentGhId ? snapshot?.ghId?.toLowerCase() === currentGhId.toLowerCase() : false;

  // Visual status pill configuration
  const stateBadge = useMemo(() => {
    switch (snapshot?.runtimeState) {
      case 'MIXING_RAW_WATER':
        return { label: 'PENGISIAN AIR BAKU', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse' };
      case 'DOSING':
        return { label: `DOSING AKTIF [CH ${snapshot.activeChannel || 'A'}]`, color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 animate-pulse' };
      case 'READY':
        return { label: 'BATCH SIAP (READY)', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' };
      case 'DISTRIBUTING':
        return { label: 'DISTRIBUSI NUTRISI', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' };
      case 'COMPLETED':
        return { label: 'BATCH SELESAI', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
      case 'FAILED':
        return { label: 'GAGAL / FAULT', color: 'bg-red-500/20 text-red-400 border-red-500/30' };
      case 'QUEUED':
        return { label: 'TERANTRE (QUEUED)', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
      default:
        return { label: 'STANDBY / IDLE', color: 'bg-slate-800 text-slate-400 border-slate-700' };
    }
  }, [snapshot]);

  return (
    <div className={`bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden backdrop-blur-md shadow-xl ${className}`}>
      {/* Top Header */}
      <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-950/40">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white tracking-wide">
                Antrean Dosing Central & Eksekusi Batch
              </h3>
              <span className="px-2 py-0.5 text-xs font-mono rounded bg-slate-800 text-emerald-400 border border-emerald-500/20">
                Complex Scope
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Spesifikasi Otoritatif Section 10.3 & 20 — Pompa Dosing Shared Serial Exclusive
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${stateBadge.color}`}>
            {stateBadge.label}
          </span>
          <button
            onClick={handleManualSync}
            disabled={manualSyncing}
            title="Refresh status terkini dari ESP32"
            className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${manualSyncing ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Active Batch Card */}
        <div className={`p-4 rounded-xl border transition-all ${
          isActive 
            ? 'bg-slate-950/50 border-emerald-500/30 ring-1 ring-emerald-500/10' 
            : 'bg-slate-950/20 border-slate-800/60'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Activity className={`w-4 h-4 ${isActive ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Batch Aktif (Central Dosing Unit)
              </span>
              {currentGhId && (
                <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
                  activeGhMatches 
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  {activeGhMatches ? 'Greenhouse Ini' : `Target: ${snapshot?.ghId || 'GH-A'}`}
                </span>
              )}
            </div>
            <div className="text-xs font-mono text-slate-400">
              Batch ID: <span className="text-slate-200 font-semibold">{snapshot?.batchId || 'NONE'}</span>
            </div>
          </div>

          {/* Raw Water Fill Bar with 20% Threshold Notch */}
          <div className="space-y-1.5 mb-4">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Droplets className="w-3.5 h-3.5 text-blue-400" />
                Air Baku (Raw Water Flow):
                <span className="font-mono text-slate-200 font-medium">
                  {rawActual.toLocaleString()} mL / {rawTarget.toLocaleString()} mL
                </span>
              </span>
              <span className={`text-[11px] font-mono ${thresholdReached ? 'text-emerald-400' : 'text-amber-400'}`}>
                {rawFillPct}% {thresholdReached ? '(Threshold Tercapai)' : `(Butuh ${thresholdVolume.toLocaleString()} mL)`}
              </span>
            </div>

            {/* Custom Meter with Threshold Marker */}
            <div className="relative w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-500"
                style={{ width: `${rawFillPct}%` }}
              />
              {/* Threshold Pin/Notch */}
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                style={{ left: `${thresholdPercent}%` }}
                title={`Threshold Dosing Unlatch: ${thresholdPercent}% (${thresholdVolume.toLocaleString()} mL)`}
              />
            </div>

            <div className="flex justify-between items-center text-[10px] text-slate-500">
              <span>0 mL</span>
              <span className="text-amber-400 font-mono font-medium">
                ▲ Ambang Dosing: {thresholdPercent}% ({thresholdVolume.toLocaleString()} mL)
              </span>
              <span>{rawTarget.toLocaleString()} mL</span>
            </div>
          </div>

          {/* Dosing Channels Breakdown */}
          <div className="pt-3 border-t border-slate-800/80">
            <div className="text-xs font-medium text-slate-300 mb-2 flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5 text-emerald-400" />
              Status Saluran Dosing Nutrisi (Eksekusi Serial A → B → N):
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['A', 'B', 'N'].map((channel) => {
                const targetMl = snapshot?.dosing?.[channel] ?? 20;
                const isCurrentActive = isDosing && snapshot?.activeChannel === channel;
                const isPast = isReady || (isDosing && (
                  (channel === 'A' && snapshot?.activeChannel !== 'A') ||
                  (channel === 'B' && snapshot?.activeChannel === 'N')
                ));

                return (
                  <div 
                    key={channel}
                    className={`p-2.5 rounded-lg border text-center transition-all ${
                      isCurrentActive 
                        ? 'bg-emerald-500/15 border-emerald-500/40 ring-1 ring-emerald-500/20 shadow-lg' 
                        : isPast 
                        ? 'bg-slate-900/60 border-slate-800 text-slate-400' 
                        : 'bg-slate-950/40 border-slate-800/60 text-slate-500'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-300 mb-0.5">
                      Saluran {channel}
                    </div>
                    <div className="text-xs font-mono font-medium text-slate-200">
                      {targetMl} mL
                    </div>
                    <div className="mt-1">
                      {isCurrentActive ? (
                        <span className="inline-block px-1.5 py-0.5 text-[9px] font-mono rounded bg-emerald-500/30 text-emerald-300 border border-emerald-400/30 animate-pulse font-bold">
                          RUNNING
                        </span>
                      ) : isPast ? (
                        <span className="inline-block px-1.5 py-0.5 text-[9px] font-mono rounded bg-slate-800 text-slate-400">
                          DONE
                        </span>
                      ) : (
                        <span className="inline-block px-1.5 py-0.5 text-[9px] font-mono rounded bg-slate-800/40 text-slate-600">
                          QUEUED
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Complex Waiting Queue (Section 10.3) */}
        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-950/30">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Antrean Batch Menunggu (Waiting Queue)
              </span>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {snapshot?.queuedBatches?.length ?? 0} Batch Pending
            </span>
          </div>

          {snapshot?.queuedBatches && snapshot.queuedBatches.length > 0 ? (
            <div className="space-y-2">
              {snapshot.queuedBatches.map((item, idx) => (
                <div 
                  key={item.batchId || idx}
                  className="p-3 rounded-lg border border-slate-800 bg-slate-900/50 flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-medium text-slate-200 flex items-center gap-2">
                      <span>#{idx + 1} {item.batchId}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">
                        Target: {item.ghId}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Jadwal: {item.scheduledTime || 'Next in sequence'} · Target: {item.rawWaterTargetMl ?? 20000} mL Air
                    </div>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    QUEUED
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-slate-500 bg-slate-900/20 rounded-lg border border-slate-800/40">
              <CheckCircle2 className="w-4 h-4 text-emerald-500/60 mx-auto mb-1.5" />
              Tidak ada antrean pending. Unit central dosing standby untuk pemicuan jadwal berikutnya.
            </div>
          )}
        </div>

        {/* Mechanical Safety & Interlock Notice */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 text-xs">
          <div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-slate-300">Central Dosing Serial</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Maksimal 1 batch aktif menggunakan central pump pada satu waktu (Section 10.1).
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60 flex items-start gap-2">
            <Gauge className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-slate-300">Distribusi Boleh Paralel</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Pompa distribusi antar-GH dapat berjalan bersamaan saat batch READY (Section 3.3).
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-slate-300">Radar 220V Fisik</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Cutoff radar sumur memutus daya motor secara fisik independen dari MCU (Section 3.1).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
