"use client";

import { forwardRef } from "react";
import { ChevronDown, Info } from "lucide-react";

/* ----------------------------- Button ---------------------------- */

type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "danger-outline" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
  secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-sm",
  outline: "bg-white text-blue-600 border border-blue-200 hover:bg-blue-50",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  "danger-outline": "bg-white text-red-600 border border-red-200 hover:bg-red-50",
  ghost: "text-slate-500 hover:bg-slate-100",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-3.5 text-[13px] gap-2",
  lg: "h-10 px-4 text-sm gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none ${className}`}
      {...props}
    />
  );
}

/* ----------------------------- Inputs ---------------------------- */

export function Label({ required, children, className = "" }: { required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={`mb-1.5 block text-[13px] font-medium text-slate-700 ${className}`}>
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { unit?: string }>(
  function Input({ unit, className = "", ...props }, ref) {
    return (
      <div className={`relative ${className}`}>
        <input
          ref={ref}
          className="h-9.5 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:bg-slate-50 disabled:text-slate-400"
          {...props}
        />
        {unit && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-slate-400">
            {unit}
          </span>
        )}
      </div>
    );
  },
);

export function Textarea({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 ${className}`}
      {...props}
    />
  );
}

export function Select({
  className = "",
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <div className={`relative ${className}`}>
      <select
        className="h-9.5 w-full cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:bg-slate-50 disabled:text-slate-400"
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex cursor-pointer items-center gap-2.5 focus:outline-none"
    >
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-blue-600" : "bg-slate-200"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-4.5" : "left-0.5"}`}
        />
      </span>
      {label && <span className="text-sm font-medium text-slate-800">{label}</span>}
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex cursor-pointer items-center gap-2 text-left focus:outline-none"
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded border transition ${
          checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"
        }`}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-current stroke-2">
            <path d="M2.5 6.5 5 9l4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="text-[13px] text-slate-700">{label}</span>
    </button>
  );
}

/* ------------------------ Radio card group ----------------------- */

export function RadioCard({
  selected,
  onSelect,
  title,
  subtitle,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-left transition focus:outline-none ${
        selected ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-500" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? "border-blue-600" : "border-slate-300"
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-blue-600" />}
      </span>
      <span>
        <span className={`block text-[13px] font-semibold ${selected ? "text-blue-700" : "text-slate-800"}`}>
          {title}
        </span>
        {subtitle && <span className="mt-0.5 block text-xs leading-snug text-slate-500">{subtitle}</span>}
      </span>
    </button>
  );
}

/* --------------------------- Info note --------------------------- */

export function InfoNote({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg bg-blue-50/70 px-3 py-2.5 text-xs leading-relaxed text-blue-700 ${className}`}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/* --------------------------- Progress ---------------------------- */

export function Progress({
  value,
  color = "bg-blue-500",
  className = "",
}: {
  value: number;
  color?: string;
  className?: string;
}) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* -------------------------- Status badge ------------------------- */

export type BadgeTone = "green" | "blue" | "gray" | "amber" | "red" | "purple" | "sky";

const toneClasses: Record<BadgeTone, { box: string; dot: string }> = {
  green: { box: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  blue: { box: "bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  gray: { box: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  amber: { box: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  red: { box: "bg-red-50 text-red-700", dot: "bg-red-500" },
  purple: { box: "bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  sky: { box: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
};

export function Badge({
  tone = "gray",
  dot = true,
  pulse = false,
  children,
  className = "",
}: {
  tone?: BadgeTone;
  dot?: boolean;
  pulse?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const t = toneClasses[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${t.box} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${t.dot} ${pulse ? "pulse-dot" : ""}`} />}
      {children}
    </span>
  );
}

const STATUS_MAP: Record<string, { label: string; tone: BadgeTone; pulse?: boolean }> = {
  completed: { label: "Completed", tone: "green" },
  running: { label: "Running", tone: "blue", pulse: true },
  scheduled: { label: "Scheduled", tone: "gray" },
  missed: { label: "Missed", tone: "amber" },
  failed: { label: "Failed", tone: "red" },
  disabled: { label: "Disabled", tone: "gray" },
  online: { label: "ONLINE", tone: "green" },
  offline: { label: "OFFLINE", tone: "red" },
  normal: { label: "NORMAL", tone: "green" },
  critical: { label: "CRITICAL", tone: "red" },
  warning: { label: "WARNING", tone: "amber" },
  mixing: { label: "Mixing", tone: "green" },
  distributing: { label: "Distributing", tone: "blue" },
  distribution: { label: "Distribution", tone: "blue" },
  waiting: { label: "Waiting", tone: "amber" },
  idle: { label: "Idle", tone: "gray" },
  active: { label: "Active", tone: "green" },
  due: { label: "Due", tone: "amber" },
  calibrated: { label: "Calibrated", tone: "green" },
  success: { label: "Success", tone: "green" },
  enabled: { label: "Enabled", tone: "green" },
  ready: { label: "Ready", tone: "green" },
  open: { label: "Open", tone: "green" },
  auto: { label: "AUTO", tone: "green" },
  on: { label: "ON", tone: "green" },
  off: { label: "OFF", tone: "gray" },
  ok: { label: "OK", tone: "green" },
  partial: { label: "Partial", tone: "amber" },
  filling: { label: "Dalam Pengisian", tone: "green" },
  full: { label: "Penuh", tone: "gray" },
  inprogress: { label: "In Progress", tone: "blue" },
  pending: { label: "Pending", tone: "gray" },
  done: { label: "Completed", tone: "green" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const cfg = STATUS_MAP[status] ?? { label: status, tone: "gray" as BadgeTone };
  return (
    <Badge tone={cfg.tone} pulse={cfg.pulse} className={className}>
      {cfg.label}
    </Badge>
  );
}
