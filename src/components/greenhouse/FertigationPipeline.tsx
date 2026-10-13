"use client";

import React from "react";
import {
  CalendarClock,
  Beaker,
  CheckCircle2,
  Droplets,
  Flag,
  XCircle,
} from "lucide-react";

export type PipelineStage =
  | "idle"
  | "scheduled"
  | "mixing"
  | "ready"
  | "distributing"
  | "done"
  | "failed";

const STAGES: { id: Exclude<PipelineStage, "idle" | "failed">; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "scheduled", label: "Dijadwalkan", icon: CalendarClock },
  { id: "mixing", label: "Mixing", icon: Beaker },
  { id: "ready", label: "Siap", icon: CheckCircle2 },
  { id: "distributing", label: "Distribusi", icon: Droplets },
  { id: "done", label: "Selesai", icon: Flag },
];

const STAGE_ORDER: PipelineStage[] = ["scheduled", "mixing", "ready", "distributing", "done"];

export function FertigationPipeline({
  stage,
  recipeName,
  progressPct,
  onTap,
}: {
  stage: PipelineStage;
  recipeName?: string;
  progressPct?: number;
  onTap?: () => void;
}) {
  if (stage === "idle") {
    return (
      <button
        type="button"
        onClick={onTap}
        className="w-full cursor-pointer rounded-2xl border border-white/10 bg-[#0b2027] p-5 text-left transition hover:border-white/20"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-500/15 text-slate-400">
            <Beaker className="h-5 w-5" />
          </span>
          <div>
            <div className="font-semibold text-white">Tidak ada fertigasi aktif</div>
            <div className="text-sm text-slate-400">Ketuk untuk lihat jadwal atau mulai manual</div>
          </div>
        </div>
      </button>
    );
  }

  if (stage === "failed") {
    return (
      <button
        type="button"
        onClick={onTap}
        className="w-full cursor-pointer rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-left transition hover:border-red-500/50"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/20 text-red-400">
            <XCircle className="h-5 w-5" />
          </span>
          <div>
            <div className="font-semibold text-red-300">Fertigasi gagal</div>
            <div className="text-sm text-red-300/70">
              {recipeName ? `${recipeName} • ` : ""}Ketuk untuk lihat detail dan aksi
            </div>
          </div>
        </div>
      </button>
    );
  }

  const currentIdx = STAGE_ORDER.indexOf(stage);

  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full cursor-pointer rounded-2xl border border-white/10 bg-[#0b2027] p-5 text-left transition hover:border-white/20"
    >
      {recipeName && (
        <div className="mb-4 flex items-center justify-between">
          <div className="font-semibold text-white">{recipeName}</div>
          {progressPct != null && stage !== "done" && (
            <div className="text-sm font-medium text-emerald-300">{Math.round(progressPct)}%</div>
          )}
        </div>
      )}
      <div className="flex items-center">
        {STAGES.map((s, idx) => {
          const Icon = s.icon;
          const isDone = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          return (
            <React.Fragment key={s.id}>
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
                    isDone
                      ? "bg-emerald-500/20 text-emerald-300"
                      : isCurrent
                        ? "bg-emerald-500 text-white shadow-[0_0_16px_rgba(16,185,129,0.5)] animate-pulse"
                        : "bg-white/5 text-slate-500"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span
                  className={`text-[11px] font-medium ${
                    isCurrent ? "text-emerald-300" : isDone ? "text-slate-300" : "text-slate-500"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {idx < STAGES.length - 1 && (
                <div
                  className={`mx-1 mb-6 h-0.5 flex-1 rounded transition ${
                    idx < currentIdx ? "bg-emerald-500/60" : "bg-white/10"
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
      {progressPct != null && stage !== "done" && stage !== "scheduled" && (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
          />
        </div>
      )}
    </button>
  );
}
