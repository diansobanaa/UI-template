"use client";

import { useId } from "react";
import type { SeriesPoint } from "@/lib/types";

/* ---------------------------- AreaChart --------------------------- */

export function AreaChart({
  points,
  color = "#16a34a",
  height = 210,
  yTicks = 4,
  xLabelEvery = 4,
  unit = "",
}: {
  points: SeriesPoint[];
  color?: string;
  height?: number;
  yTicks?: number;
  xLabelEvery?: number;
  unit?: string;
}) {
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const W = 1000;
  const H = 260;
  const padL = 46;
  const padR = 12;
  const padT = 14;
  const padB = 30;

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max === min) {
    max += 1;
    min -= 1;
  }
  const pad = (max - min) * 0.12;
  min = Math.max(0, min - pad);
  max = max + pad;

  const x = (i: number) => padL + (i / Math.max(1, points.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${H - padB} L${padL},${H - padB} Z`;

  const fmtY = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v * 10) / 10}`);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = min + ((max - min) / yTicks) * i;
        return (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#eef1f6" strokeWidth="1" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill="#94a3b8">
              {fmtY(v)}
            </text>
          </g>
        );
      })}
      <path d={areaPath} fill={`url(#grad-${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r="3.4" fill={color} stroke="#fff" strokeWidth="1.6" />
      ))}
      {points.map((p, i) =>
        i % xLabelEvery === 0 ? (
          <text key={`x-${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="#94a3b8">
            {p.label}
          </text>
        ) : null
      )}
      {unit && (
        <text x={padL - 8} y={padT - 2} textAnchor="end" fontSize="11" fill="#cbd5e1">
          {unit}
        </text>
      )}
    </svg>
  );
}

/* -------------------------- DualLineChart ------------------------- */

export function DualLineChart({
  points,
  colorA = "#10b981",
  colorB = "#3b82f6",
  height = 200,
}: {
  points: { label: string; a: number; b: number }[];
  colorA?: string;
  colorB?: string;
  height?: number;
}) {
  const W = 1000;
  const H = 260;
  const padL = 42;
  const padR = 46;
  const padT = 14;
  const padB = 30;

  const aVals = points.map((p) => p.a);
  const bVals = points.map((p) => p.b);
  const aMin = Math.min(...aVals, 0);
  const aMax = Math.max(...aVals) * 1.1 || 1;
  const bMin = Math.min(...bVals, 0);
  const bMax = Math.max(...bVals) * 1.1 || 1;

  const x = (i: number) => padL + (i / Math.max(1, points.length - 1)) * (W - padL - padR);
  const ya = (v: number) => padT + (1 - (v - aMin) / (aMax - aMin)) * (H - padT - padB);
  const yb = (v: number) => padT + (1 - (v - bMin) / (bMax - bMin)) * (H - padT - padB);

  const pathFor = (get: (i: number) => number) =>
    points.map((_, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${get(i).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const v = aMin + (aMax - aMin) * t;
        return (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={ya(v)} y2={ya(v)} stroke="#eef1f6" strokeWidth="1" />
            <text x={padL - 8} y={ya(v) + 4} textAnchor="end" fontSize="12" fill="#94a3b8">
              {Math.round(v)}
            </text>
            <text x={W - padR + 8} y={yb(bMin + (bMax - bMin) * t) + 4} textAnchor="start" fontSize="12" fill="#94a3b8">
              {Math.round(bMin + (bMax - bMin) * t)}
            </text>
          </g>
        );
      })}
      <path d={pathFor((i) => yb(points[i].b))} fill="none" stroke={colorB} strokeWidth="2" strokeDasharray="1 0" vectorEffect="non-scaling-stroke" />
      <path d={pathFor((i) => ya(points[i].a))} fill="none" stroke={colorA} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={ya(p.a)} r="3.2" fill={colorA} stroke="#fff" strokeWidth="1.4" />
          <circle cx={x(i)} cy={yb(p.b)} r="3.2" fill={colorB} stroke="#fff" strokeWidth="1.4" />
        </g>
      ))}
      {points.map((p, i) => (
        <text key={`l-${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="#94a3b8">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

/* ------------------------------ Donut ----------------------------- */

export function Donut({
  total,
  label = "Total",
  segments,
  size = 132,
  stroke = 15,
}: {
  total: number;
  label?: string;
  segments: { value: number; color: string }[];
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sum = segments.reduce((a, s) => a + s.value, 0) || 1;
  let offset = 0;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef1f6" strokeWidth={stroke} />
        {segments.map((s, i) => {
          const len = (s.value / sum) * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - 3)} ${c - Math.max(0, len - 3)}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-slate-900">{total}</span>
        <span className="text-xs text-slate-400">{label}</span>
      </div>
    </div>
  );
}
