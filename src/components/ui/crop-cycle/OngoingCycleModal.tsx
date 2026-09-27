"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, History } from "lucide-react";
import { Modal } from "@/components/ui/overlay";
import { Button, Input, Label } from "@/components/ui/primitives";
import type { Greenhouse } from "@/lib/types";
import { calculateDaysBetween, formatIndoDate, getSystemDate, toIsoDateString, validateTanggalPolinasi, validateTanggalTanam } from "@/lib/cropCycleProcessor";

interface Props {
  gh: Greenhouse;
  startOngoingOpen: boolean;
  onCloseStartOngoing: () => void;
  onStartOngoingCycle: (tanggalTanam: string, options?: { variety?: string; plantCount?: number; tanggalPolinasi?: string; notes?: string }) => Promise<void>;
}

export function OngoingCycleModal({ gh, startOngoingOpen, onCloseStartOngoing, onStartOngoingCycle }: Props) {
  const todayStr = useMemo(() => toIsoDateString(getSystemDate()), []);
  const [tanamDate, setTanamDate] = useState(todayStr);
  const [hasPolinasi, setHasPolinasi] = useState(false);
  const [polinasiDate, setPolinasiDate] = useState(todayStr);
  const [variety, setVariety] = useState(gh.crop);
  const [plantCount, setPlantCount] = useState(gh.plants?.total || 120);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (startOngoingOpen) { setTanamDate(todayStr); setPolinasiDate(todayStr); setHasPolinasi(false); setVariety(gh.crop); setPlantCount(gh.plants?.total || 120); setNotes(""); setError(null); } }, [startOngoingOpen, todayStr, gh.crop, gh.plants?.total]);
  const validation = validateTanggalTanam(tanamDate);
  const hst = validation.valid ? calculateDaysBetween(tanamDate) : 0;
  const polValidation = hasPolinasi ? validateTanggalPolinasi(polinasiDate, tanamDate) : null;
  const hsp = hasPolinasi && polValidation?.valid ? calculateDaysBetween(polinasiDate) : null;
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!validation.valid) return setError(validation.error || "Tanggal tanam tidak valid"); if (hasPolinasi && !polValidation?.valid) return setError(polValidation?.error || "Tanggal polinasi tidak valid"); setSaving(true); setError(null); try { await onStartOngoingCycle(tanamDate, { variety: variety.trim() || gh.crop, plantCount: Number(plantCount) || 120, tanggalPolinasi: hasPolinasi ? polinasiDate : undefined, notes: notes.trim() || undefined }); onCloseStartOngoing(); } catch (error: unknown) { setError(error instanceof Error ? error.message : "Gagal menyimpan siklus berjalan"); } finally { setSaving(false); } };
  return <Modal open={startOngoingOpen} onClose={onCloseStartOngoing} title={<div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><History className="h-5 w-5" /></span><div><div className="text-base font-bold text-slate-900">Siklus Sudah Berjalan</div><div className="text-xs text-slate-500">Masukkan kondisi aktual tanaman</div></div></div>} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCloseStartOngoing} disabled={saving}>Batal</Button><Button onClick={submit} disabled={saving || !validation.valid} className="bg-blue-600 text-white hover:bg-blue-700">{saving ? "Menyimpan..." : "Gunakan Data Ini"}</Button></div>}>
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4"><div className="text-xs font-semibold uppercase tracking-wider text-blue-700">Tanggal aktual</div><div className="mt-1 text-sm text-blue-900">HST akan langsung mengikuti umur tanaman sebenarnya.</div></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><Label htmlFor="ongoing-date">Tanggal Tanam</Label><Input id="ongoing-date" type="date" max={todayStr} value={tanamDate} onChange={e => {setTanamDate(e.target.value);setError(null)}} className="mt-1.5 w-full" /></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[11px] text-slate-500">HST saat ini</div><div className="mt-1 text-2xl font-bold text-emerald-600">{hst}<span className="ml-1 text-xs">hari</span></div><div className="text-[11px] text-slate-500">{validation.valid ? formatIndoDate(tanamDate) : "Tanggal belum valid"}</div></div></div>
      <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="ongoing-variety">Varietas</Label><Input id="ongoing-variety" value={variety} onChange={e => setVariety(e.target.value)} className="mt-1.5 w-full" /></div><div><Label htmlFor="ongoing-count">Jumlah Tanaman</Label><Input id="ongoing-count" type="number" min={1} value={plantCount} onChange={e => setPlantCount(Number(e.target.value))} className="mt-1.5 w-full" /></div></div>
      <div className="rounded-2xl border border-slate-200 p-4"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={hasPolinasi} onChange={e => setHasPolinasi(e.target.checked)} className="h-4 w-4 rounded" /> Polinasi sudah terjadi</label>{hasPolinasi && <div className="mt-3 grid grid-cols-2 gap-3"><div><Label htmlFor="ongoing-polinasi">Tanggal Polinasi</Label><Input id="ongoing-polinasi" type="date" min={tanamDate || undefined} max={todayStr} value={polinasiDate} onChange={e => setPolinasiDate(e.target.value)} className="mt-1.5 w-full" /></div><div className="rounded-xl bg-violet-50 p-3"><div className="text-[11px] text-violet-600">HSP saat ini</div><div className="mt-1 text-2xl font-bold text-violet-700">{hsp ?? "–"}<span className="ml-1 text-xs">hari</span></div></div></div>}</div>
      <div><Label htmlFor="ongoing-notes">Catatan <span className="font-normal text-slate-400">(opsional)</span></Label><textarea id="ongoing-notes" value={notes} onChange={e => setNotes(e.target.value)} className="mt-1.5 min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm" /></div>
      {validation.warning && <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" />{validation.warning}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
    </form>
  </Modal>;
}
