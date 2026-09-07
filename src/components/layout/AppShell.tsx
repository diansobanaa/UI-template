"use client";

import { useState } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";
import { complexService } from "@/lib/services";

/**
 * Page shell: fixed sidebar + header + scrollable content + status footer.
 * Complex context is derived from ?complex= query param (mock phase).
 */
export function AppShell({
  complexId,
  children,
}: {
  complexId: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const complex = complexService.get(complexId) ?? complexService.list()[0];

  return (
    <div className="flex min-h-screen bg-[--color-page]">
      <AppSidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main className="min-w-0 flex-1 px-6 pb-8 pt-6">{children}</main>
        <AppFooter complex={complex} />
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
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2.5">{children}</div>
    </div>
  );
}
