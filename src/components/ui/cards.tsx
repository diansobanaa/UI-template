"use client";

import type { LucideIcon } from "lucide-react";
import type { RealtimeState } from "@/lib/realtime";
import { LiveStatus } from "@/components/ui/LiveStatus";

export function SectionCard({
  title,
  icon: Icon,
  iconTone = "blue",
  action,
  subtitle,
  children,
  className = "",
  bodyClassName = "",
  realtime,
}: {
  title: React.ReactNode;
  icon?: LucideIcon;
  iconTone?: "blue" | "green" | "amber" | "red" | "violet" | "sky" | "slate";
  action?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  realtime?: RealtimeState;
}) {
  const tones: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    violet: "bg-violet-50 text-violet-600",
    sky: "bg-sky-50 text-sky-600",
    slate: "bg-slate-100 text-slate-500",
  };
  return (
    <section
      className={`rounded-xl border shadow-[0_1px_2px_rgba(15,23,42,0.05)] ${realtime === "problem" || realtime === "offline" ? "border-red-200 bg-red-50/35" : "border-[--color-line] bg-white"} ${className}`}
    >
      <header className="flex items-center gap-2.5 px-5 pb-3 pt-4">
        {Icon && (
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tones[iconTone]}`}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-bold text-slate-900">{title}</h3>
          {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">{realtime && <LiveStatus state={realtime} />} {action}</div>
      </header>
      <div className={bodyClassName || "px-5 pb-5"}>{children}</div>
    </section>
  );
}

export function ViewAllButton({ children = "View All", onClick }: { children?: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-blue-600 transition-colors hover:bg-blue-50 focus:outline-none"
    >
      {children}
    </button>
  );
}

/** KPI stat card used in dashboard strips. */
export function MetricCard({
  icon: Icon,
  iconTone = "blue",
  label,
  value,
  children,
  onClick,
  className = "",
}: {
  icon: LucideIcon;
  iconTone?: "blue" | "green" | "amber" | "red" | "violet" | "sky" | "slate";
  label: React.ReactNode;
  value: React.ReactNode;
  children?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const tones: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    violet: "bg-violet-50 text-violet-600",
    sky: "bg-sky-50 text-sky-600",
    slate: "bg-slate-100 text-slate-500",
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`flex min-w-0 items-start gap-3 rounded-xl border border-[--color-line] bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] ${onClick ? "cursor-pointer transition-shadow hover:shadow-md" : ""} ${className}`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[iconTone]}`}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-slate-500">{label}</span>
        <span className="mt-0.5 block text-2xl font-bold leading-tight text-slate-900">{value}</span>
        {children && <span className="mt-1.5 block">{children}</span>}
      </span>
    </Tag>
  );
}
