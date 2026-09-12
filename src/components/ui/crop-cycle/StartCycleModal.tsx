"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Info, Sprout } from "lucide-react";
import { Modal } from "@/components/ui/overlay";
import { Button, Input, Label } from "@/components/ui/primitives";
import type { Greenhouse } from "@/lib/types";
import { getSystemDate, toIsoDateString, validateTanggalTanam } from "@/lib/cropCycleProcessor";

interface Props {
  gh: Greenhouse;
  startNormalOpen: boolean;
  onCloseStartNormal: () => void;
  onStartCycle: (tanggalTanam: string, options?: { variety?: string; plantCount?: number; notes?: string }) => Promise<void>;
}

export function StartCycleModal({ gh, startNormalOpen, onCloseStartNormal, onStartCycle }: Props) {
  const todayStr = useMemo(() => toIsoDateString(getSystemDate()), []);
  const [date, setDate] = useState(todayStr);
  const [variety, setVariety] = useState(gh.crop);
  const [plantCount, setPlantCount] = useState(gh.plants?.total || 120);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!startNormalOpen) return;
    setDate(todayStr);
    setVariety(gh.crop);
    setPlantCount(gh.plants?.total || 120);
    setNotes("");
    setError(null);
  }, [startNormalOpen, todayStr, gh.crop, gh.plants?.total]);

  const validation = validateTanggalTanam(date);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validation.valid) return setError(validation.error || "Tanggal tanam tidak valid");
    setSaving(true); setError(null);
    try {
      await onStartCycle(date, { variety: variety.trim() || gh.crop, plantCount: Number(plantCount) || 120, notes: notes.trim() || undefined });
      onCloseStartNormal();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Gagal memulai siklus");
    } finally { setSaving(false); }
  };

  return (
    <Modal open={startNormalOpen} onClose={onCloseStartNormal} title={<div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Sprout className="h-5 w-5" /></span><div><div className="text-base font-bold text-slate-900">Mulai Siklus Baru</div><div className="text-xs text-slate-500">{gh.code} • {gh.crop}</div></div></div>} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCloseStartNormal} disabled={saving}>Batal</Button><Button onClick={submit} disabled={saving || !validation.valid} className="bg-emerald-600 text-white hover:bg-emerald-700">{saving ? "Menyimpan ke ESP32..." : "Simpan & Mulai Siklus"}</Button></div>}>
      <form onSubmit={submit} className="space-y-4">
        <div><Label htmlFor="start-date">Tanggal Tanam</Label><Input id="start-date" type="date" max={todayStr} value={date} onChange={e => { setDate(e.target.value); setError(null); }} className="mt-1.5 w-full" /></div>
        <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="start-variety">Varietas</Label><Input id="start-variety" value={variety} onChange={e => setVariety(e.target.value)} className="mt-1.5 w-full" /></div><div><Label htmlFor="start-count">Jumlah Tanaman</Label><Input id="start-count" type="number" min={1} value={plantCount} onChange={e => setPlantCount(Number(e.target.value))} className="mt-1.5 w-full" /></div></div>
        <div><Label htmlFor="start-notes">Catatan <span className="font-normal text-slate-400">(opsional)</span></Label><textarea id="start-notes" value={notes} onChange={e => setNotes(e.target.value)} className="mt-1.5 min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-emerald-400" /></div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-800"><div className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" /><span>HST akan dihitung otomatis berdasarkan tanggal tanam. Siklus baru dimulai dari hari tanam.</span></div></div>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      </form>
    </Modal>
  );
}
