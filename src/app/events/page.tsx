"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ListChecks, ScrollText, Search } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { SectionCard } from "@/components/ui/cards";
import { Input, Select, StatusBadge } from "@/components/ui/primitives";
import { complexService, eventService } from "@/lib/services";
import { MOCK_NOW } from "@/lib/format";

export default function EventsPage() {
  return (
    <Suspense fallback={null}>
      <EventsContent />
    </Suspense>
  );
}

function EventsContent() {
  const [params] = useSearchParams();
  const complexes = complexService.list();
  const complexId = params.get("complex") ?? complexes[0].id;
  const complex = complexes.find((c) => c.id === complexId) ?? complexes[0];

  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<"all" | "success" | "warning" | "error" | "info">("all");

  const events = eventService.all().filter(
    (e) =>
      e.text.toLowerCase().includes(query.trim().toLowerCase()) &&
      (level === "all" ? true : e.level === level)
  );

  return (
    <AppShell complexId={complex.id}>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Events &amp; Logs</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">System events across the ecosystem • {MOCK_NOW.label}</p>
      </div>

      <SectionCard title="Event Log" icon={ScrollText} iconTone="slate">
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events…" className="pl-8.5" />
          </div>
          <Select
            value={level}
            onChange={(e) => setLevel(e.target.value as typeof level)}
            className="w-40"
            options={[
              { value: "all", label: "All levels" },
              { value: "success", label: "Success" },
              { value: "warning", label: "Warning" },
              { value: "error", label: "Error" },
              { value: "info", label: "Info" },
            ]}
          />
        </div>

        {events.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-400">
            No events match your search or filter.
          </p>
        ) : (
          <div className="space-y-3">
            {events.map((e) => (
              <div key={e.id} className="flex items-start gap-3 rounded-xl border border-[--color-line] bg-white px-3.5 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                  {e.level === "warning" ? (
                    <AlertTriangle className="h-4.5 w-4.5 text-amber-500" />
                  ) : e.level === "error" ? (
                    <AlertTriangle className="h-4.5 w-4.5 text-red-500" />
                  ) : (
                    <ListChecks className="h-4.5 w-4.5 text-emerald-500" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800">{e.text}</div>
                  <div className="text-xs text-slate-400">{e.time} • today</div>
                </div>
                <StatusBadge status={e.level === "success" ? "completed" : e.level === "warning" ? "warning" : e.level === "error" ? "failed" : "scheduled"} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}
