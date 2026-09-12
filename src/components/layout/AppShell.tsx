"use client";

import { useState } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";
import { complexService } from "@/lib/services";

/**
 * Global application shell.
 * The shell is intentionally dark across every route so navigation, header,
 * content background and footer share one consistent visual system.
 */
export function AppShell({
  complexId,
  children,
}: {
  complexId: string;
  children: React.ReactNode;
}) {
  // Desktop: sidebar is visible and can be collapsed.
  // Mobile: sidebar is a drawer and starts closed by default.
  const [collapsed, setCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const complex = complexService.get(complexId) ?? complexService.list()[0];

  return (
    <div className="min-h-screen bg-[#06131b] text-slate-100">
      <div className="flex min-h-screen">
        <AppSidebar
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col bg-[#06131b]">
          <AppHeader
            onToggleSidebar={() => setMobileSidebarOpen((value) => !value)}
          />

          <main className="min-w-0 flex-1 bg-[#06131b] px-3 pb-10 pt-3 sm:px-4 lg:px-5">
            {children}
          </main>

          <AppFooter complex={complex} />
        </div>
      </div>
    </div>
  );
}

export function PageTitleBlock({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-slate-400">{subtitle}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2.5">{children}</div>
    </div>
  );
}
