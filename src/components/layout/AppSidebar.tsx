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
  Wrench,
} from "lucide-react";
import { complexService, greenhouseService } from "@/lib/services";

interface NavLeaf {
  id: string;
  label: string;
  href?: string; // when absent the item is not part of this prototype phase
  icon: React.ComponentType<{ className?: string }>;
  match?: (path: string) => boolean;
}

interface NavNode {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: NavLeaf[];
  href?: string;
}

function SidebarInner({ collapsed, onToggleCollapse }: { collapsed: boolean; onToggleCollapse?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const complexId = params.get("complex") ?? "complex-01";
  const [open, setOpen] = useState<Record<string, boolean>>({ Complex: true, Research: false });

  const complex = complexService.get(complexId) ?? complexService.list()[0];
  const ghs = greenhouseService.byComplex(complex.id);

  const activeGhId = pathname.startsWith("/greenhouse/") ? pathname.split("/")[2] : null;

  const ghChildren: NavLeaf[] = ghs.map((g) => ({
    id: g.id,
    label: g.code,
    href: `/greenhouse/${g.id}?complex=${complex.id}`,
    icon: Sprout,
    match: (p) => p === `/greenhouse/${g.id}`,
  }));

  const nodes: NavNode[] = [
    { id: "dashboard", label: "Dashboard", icon: Home, href: "/dashboard" },
    {
      id: "complex",
      label: "Complex",
      icon: Building2,
      children: [
        { id: "overview", label: "Overview", href: `/complex?complex=${complex.id}`, icon: ClipboardList, match: (p) => p === "/complex" },
        ...ghChildren,
      ],
    },
    { id: "schedule", label: "Schedule & Timer", icon: Clock, href: `/schedule?complex=${complex.id}` },
    { id: "fertigation", label: "Fertigation", icon: Droplets, href: `/fertigation?complex=${complex.id}` },
    { id: "calibration", label: "Calibration", icon: FlaskConical, href: `/calibration?complex=${complex.id}` },
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
    { id: "events", label: "Events & Logs", icon: ScrollText },
  ];

  const isActive = (n: NavNode) => n.href && (pathname === n.href.split("?")[0]);
  const childActive = (n: NavNode) => n.children?.some((c) => c.href && c.match?.(pathname)) ?? false;

  return (
    <aside
      className={`flex h-full flex-col bg-[#0b1220] text-slate-300 transition-all duration-200 ${
        collapsed ? "w-[68px]" : "w-[216px]"
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
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                    childActive(n) || expanded ? "text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                  title={collapsed ? n.label : undefined}
                >
                  <n.icon className="h-[17px] w-[17px] shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left font-medium">{n.label}</span>
                      {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                      )}
                    </>
                  )}
                </button>
                {expanded && !collapsed && (
                  <div className="ml-[18px] border-l border-white/10 pl-1.5">
                    {n.children.map((c) => {
                      const cActive = c.href ? Boolean(c.match?.(pathname)) : false;
                      const inner = (
                        <span className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors ${
                          cActive
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
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                active
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
