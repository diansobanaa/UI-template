"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Apple,
  BarChart3,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Clock,
  Droplets,
  FlaskConical,
  Home,
  Leaf,
  ScrollText,
  Search,
  Settings,
  ShoppingBasket,
  Sprout,
  RotateCcw,
  Wrench,
} from "lucide-react";
import { complexService, greenhouseService } from "@/lib/services";
import { resetMockDb } from "@/lib/store";

interface NavLeaf {
  id: string;
  label: string;
  href?: string; // when absent the item is not part of this prototype phase
  icon: React.ComponentType<{ className?: string }>;
  match?: (path: string) => boolean;
}

/** NEW — second-level group (e.g. "Complex 01") that nests GH leaves. */
interface NavGroup {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: NavLeaf[];
}

type NavChild = NavLeaf | NavGroup;

interface NavNode {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: NavChild[];
  href?: string;
}

/** Type guard: a child with `children` is a nested group (Complex 0X). */
function isNavGroup(c: NavChild): c is NavGroup {
  return Array.isArray((c as NavGroup).children);
}

function SidebarInner({ collapsed, onToggleCollapse }: { collapsed: boolean; onToggleCollapse?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const complexId = params.get("complex") ?? "complex-01";
  const [open, setOpen] = useState<Record<string, boolean>>({ Complex: true, Research: false });

  const activeGhId = pathname.startsWith("/greenhouse/") ? pathname.split("/")[2] : null;

  // NEW — one nested group per complex, each with its own GH leaves.
  const complexGroups: NavGroup[] = complexService.list().map((cx) => ({
    id: cx.id,
    label: cx.code,
    icon: Building2,
    children: greenhouseService.byComplex(cx.id).map((g) => ({
      id: g.id,
      label: g.code,
      href: `/greenhouse/${g.id}?complex=${cx.id}`,
      icon: Sprout,
      match: (p: string) => p === `/greenhouse/${g.id}`,
    })),
  }));

  const nodes: NavNode[] = [
    { id: "dashboard", label: "Dashboard", icon: Home, href: "/dashboard" },
    {
      id: "complex",
      label: "Complex",
      icon: Building2,
      children: [
        { id: "overview", label: "Overview", href: `/complex?complex=${complexId}`, icon: ClipboardList, match: (p) => p === "/complex" },
        ...complexGroups,
      ],
    },
    { id: "schedule", label: "Schedule & Timer", icon: Clock, href: `/schedule?complex=${complexId}` },
    { id: "fertigation", label: "Fertigation", icon: Droplets, href: `/fertigation?complex=${complexId}` },
    { id: "calibration", label: "Calibration", icon: FlaskConical, href: `/calibration?complex=${complexId}` },
    {
      id: "research",
      label: "Research",
      icon: BookOpen,
      children: [
        { id: "experiments", label: "Experiments", icon: FlaskConical },
        { id: "plants", label: "Plants", icon: Leaf },
        { id: "fruits", label: "Fruits", icon: Apple },
        { id: "observations", label: "Observations", icon: Search },
        { id: "harvest", label: "Harvest", icon: ShoppingBasket },
      ],
    },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "equipment", label: "Equipment", icon: Wrench },
    { id: "settings", label: "Settings", icon: Settings },
    { id: "events", label: "Events & Logs", icon: ScrollText, href: "/events" },
  ];

  const isActive = (n: NavNode) => n.href && (pathname === n.href.split("?")[0]);

  // UPDATED — childActive now recurses into nested groups.
  const childActive = (n: NavNode) =>
    n.children?.some((c) =>
      isNavGroup(c)
        ? c.children.some((leaf) => Boolean(leaf.href) && Boolean(leaf.match?.(pathname)))
        : Boolean(c.href) && Boolean(c.match?.(pathname)),
    ) ?? false;

  /** NEW — auto-expand a group while it holds the active GH (manual toggle wins via `open`). */
  const groupHasActive = (g: NavGroup) => g.children.some((leaf) => Boolean(leaf.href) && Boolean(leaf.match?.(pathname)));

  return (
    <aside
      className={`flex h-full flex-col bg-[#0b1220] text-slate-300 transition-all duration-200 ${collapsed ? "w-[68px]" : "w-[216px]"
        }`}
    >
      {/* brand */}
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-green-600 shadow-md">
          <Leaf className="h-5 w-5 text-white" />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold text-white">AgroTech</div>
            <div className="truncate text-[10px] text-slate-400">Smart Greenhouse System</div>
          </div>
        )}
      </div>

      {/* nav */}
      <nav className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {nodes.map((n) => {
          const expanded = open[n.id] ?? false;
          const active = isActive(n) || (n.id === "complex" && Boolean(activeGhId));
          if (n.children) {
            return (
              <div key={n.id} className="mt-0.5">
                <button
                  onClick={() => setOpen((o) => ({ ...o, [n.id]: !expanded }))}
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${childActive(n) || expanded ? "text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    }`}
                  title={collapsed ? n.label : undefined}
                >
                  <n.icon className="h-[17px] w-[17px] shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left font-medium">{n.label}</span>
                      {expanded ? (
                        <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                      )}
                    </>
                  )}
                </button>
                {expanded && !collapsed && (
                  <div className="ml-[18px] border-l border-white/10 pl-1.5">
                    {n.children.map((c) => {
                      // NEW — nested group: "Complex 01/02/03" wrapping its GH leaves.
                      if (isNavGroup(c)) {
                        const gExpanded = open[c.id] ?? groupHasActive(c);
                        const gActive = groupHasActive(c);
                        return (
                          <div key={c.id} className="mt-0.5">
                            <button
                              onClick={() => setOpen((o) => ({ ...o, [c.id]: !gExpanded }))}
                              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors ${gActive ? "bg-white/[0.08] font-medium text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                                }`}
                            >
                              <c.icon className="h-4 w-4 shrink-0" />
                              <span className="flex-1 text-left">{c.label}</span>
                              {gExpanded ? (
                                <ChevronUp className="h-3 w-3 text-slate-500" />
                              ) : (
                                <ChevronDown className="h-3 w-3 text-slate-500" />
                              )}
                            </button>
                            {gExpanded && (
                              <div className="ml-[17px] border-l border-white/10 pl-1.5">
                                {c.children.map((leaf) => {
                                  const leafActive = leaf.href ? Boolean(leaf.match?.(pathname)) : false;
                                  const inner = (
                                    <span
                                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors ${leafActive
                                          ? "bg-blue-600 font-medium text-white shadow-[0_2px_8px_rgba(37,99,235,0.45)]"
                                          : leaf.href
                                            ? "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                                            : "text-slate-500"
                                        }`}
                                    >
                                      <leaf.icon className="h-4 w-4 shrink-0" />
                                      <span>{leaf.label}</span>
                                    </span>
                                  );
                                  return leaf.href ? (
                                    <Link key={leaf.id} href={leaf.href} className="block">
                                      {inner}
                                    </Link>
                                  ) : (
                                    <span key={leaf.id} className="block cursor-default" title="Available in a later phase">
                                      {inner}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }
                      // Leaf directly under a top-level node (e.g. Overview).
                      const cActive = c.href ? Boolean(c.match?.(pathname)) : false;
                      const inner = (
                        <span className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors ${cActive
                            ? "bg-blue-600 font-medium text-white shadow-[0_2px_8px_rgba(37,99,235,0.45)]"
                            : c.href
                              ? "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                              : "text-slate-500"
                          }`}>
                          <c.icon className="h-4 w-4 shrink-0" />
                          <span>{c.label}</span>
                        </span>
                      );
                      return c.href ? (
                        <Link key={c.id} href={c.href} className="block">
                          {inner}
                        </Link>
                      ) : (
                        <span key={c.id} className="block cursor-default" title="Available in a later phase">
                          {inner}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
          const inner = (
            <span
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${active
                  ? "bg-blue-600 font-medium text-white shadow-[0_2px_8px_rgba(37,99,235,0.45)]"
                  : n.href
                    ? "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    : "text-slate-500"
                }`}
            >
              <n.icon className="h-[17px] w-[17px] shrink-0" />
              {!collapsed && <span className="font-medium">{n.label}</span>}
            </span>
          );
          return n.href ? (
            <Link key={n.id} href={n.href} className="mt-0.5 block" title={collapsed ? n.label : undefined}>
              {inner}
            </Link>
          ) : (
            <span key={n.id} className="mt-0.5 block cursor-default" title={collapsed ? n.label : "Available in a later phase"}>
              {inner}
            </span>
          );
        })}
      </nav>

      <div className="border-t border-white/5 px-2.5 py-3">
        {!collapsed && (
          <button
            onClick={() => {
              resetMockDb();
              window.location.reload();
            }}
            title="Restore the demo data to its initial state"
            className="mb-1 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 focus:outline-none"
          >
            <RotateCcw className="h-[17px] w-[17px] shrink-0" />
            <span>Reset Demo Data</span>
          </button>
        )}
        <button
          onClick={onToggleCollapse}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 focus:outline-none"
        >
          {collapsed ? <ChevronRight className="h-[17px] w-[17px] shrink-0" /> : <ChevronLeft className="h-[17px] w-[17px] shrink-0" />}
          {!collapsed && <span>Collapse Menu</span>}
        </button>
      </div>
    </aside>
  );
}

export function AppSidebar({ collapsed, onToggleCollapse }: { collapsed: boolean; onToggleCollapse?: () => void }) {
  return (
    <div className="sticky top-0 h-screen shrink-0">
      <SidebarInner collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
    </div>
  );
}
