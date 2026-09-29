"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { HardDrive, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { AppShell, PageTitleBlock } from "@/components/layout/AppShell";
import { SectionCard } from "@/components/ui/cards";
import { Button } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { esp32Client } from "@/lib/api/esp32-client";

type StorageStatus = {
  detected: boolean;
  mounted: boolean;
  formatInProgress: boolean;
  capacityMb: number;
  capacityGb: number;
  cardName: string | null;
  status: "NOT_DETECTED" | "DETECTED_NOT_MOUNTED" | "READY" | "FORMATTING";
};

export default function StoragePage() {
  return (
    <Suspense fallback={null}>
      <StorageContent />
    </Suspense>
  );
}

function StorageContent() {
  const toast = useToast();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [formatResult, setFormatResult] = useState<"SUCCESS" | "FAILED" | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await esp32Client.getStorageStatus();
      setStatus(data);
      if (data.formatInProgress) {
        setFormatting(true);
      }
    } catch (e: any) {
      setError(e?.message || "Cannot reach ESP32");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll during format
  useEffect(() => {
    if (!formatting) return;

    pollRef.current = setInterval(async () => {
      try {
        const result = await esp32Client.getFormatResult();
        if (!result.formatInProgress) {
          setFormatting(false);
          if (result.result === "SUCCESS") {
            setFormatResult("SUCCESS");
            toast("Kartu MicroSD berhasil diformat (FAT32).", "success");
          } else if (result.result === "FAILED") {
            setFormatResult("FAILED");
            setFormatError(result.errorCode || "Unknown error");
            toast("Format MicroSD gagal: " + (result.errorCode || "unknown"), "error");
          }
          // Refresh status
          fetchStatus(true);
        }
      } catch { /* swallow poll errors */ }
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [formatting, fetchStatus, toast]);

  const handleFormat = async () => {
    setFormatResult(null);
    setFormatError(null);
    setFormatting(true);
    try {
      await esp32Client.formatMicroSdCard();
      toast("Format MicroSD dimulai. Mohon tunggu...", "info");
    } catch (e: any) {
      setFormatting(false);
      const msg = e?.message || "Gagal memulai format";
      toast(msg, "error");
      setFormatError(msg);
    }
  };

  const statusColor = (s: StorageStatus["status"]) => {
    switch (s) {
      case "READY": return "text-emerald-400";
      case "FORMATTING": return "text-amber-400";
      case "NOT_DETECTED": return "text-red-400";
      case "DETECTED_NOT_MOUNTED": return "text-amber-400";
      default: return "text-slate-400";
    }
  };

  const statusLabel = (s: StorageStatus["status"]) => {
    switch (s) {
      case "READY": return "Kartu MicroSD Siap Digunakan";
      case "FORMATTING": return "Format MicroSD Sedang Berlangsung";
      case "NOT_DETECTED": return "Kartu MicroSD Tidak Terdeteksi";
      case "DETECTED_NOT_MOUNTED": return "MicroSD Terdeteksi, Belum Ter-mount";
      default: return s;
    }
  };

  const StatusIcon = ({ s }: { s: StorageStatus["status"] }) => {
    switch (s) {
      case "READY": return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
      case "FORMATTING": return <Loader2 className="h-5 w-5 animate-spin text-amber-400" />;
      case "NOT_DETECTED": return <XCircle className="h-5 w-5 text-red-400" />;
      case "DETECTED_NOT_MOUNTED": return <AlertTriangle className="h-5 w-5 text-amber-400" />;
      default: return null;
    }
  };

  return (
    <AppShell>
      <PageTitleBlock
        title="Penyimpanan MicroSD"
        subtitle="Kelola dan format kartu MicroSD pada ESP32"
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fetchStatus()}
          disabled={loading}
          className="!bg-white/[0.06] !border-white/10 !text-slate-300 hover:!bg-white/[0.1]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </PageTitleBlock>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}

      {/* Format result banner */}
      {formatResult === "SUCCESS" && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-300">
          <CheckCircle2 className="mr-2 inline h-4 w-4" />
          Format berhasil! Kartu MicroSD telah diformat sebagai FAT32 dan siap digunakan.
        </div>
      )}
      {formatResult === "FAILED" && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
          <XCircle className="mr-2 inline h-4 w-4" />
          Format gagal{formatError ? `: ${formatError}` : ""}. Periksa kartu dan coba lagi.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Status Card */}
        <div className="rounded-xl border border-white/[0.08] bg-[#0a1c28] p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 ring-1 ring-blue-500/20">
              <HardDrive className="h-5 w-5 text-blue-400" />
            </span>
            <div>
              <h3 className="text-[15px] font-bold text-white">Status MicroSD</h3>
              <p className="text-xs text-slate-500">Informasi modul MicroSD Card</p>
            </div>
          </div>

          {loading && !status ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
            </div>
          ) : status ? (
            <div className="space-y-3">
              {/* Status indicator */}
              <div className="flex items-center gap-2.5 rounded-lg bg-white/[0.04] px-3.5 py-2.5">
                <StatusIcon s={formatting ? "FORMATTING" : status.status} />
                <span className={`text-[13px] font-semibold ${statusColor(formatting ? "FORMATTING" : status.status)}`}>
                  {statusLabel(formatting ? "FORMATTING" : status.status)}
                </span>
              </div>

              {/* Detail rows */}
              <div className="space-y-1.5 text-[13px]">
                <Row label="Kartu" value={status.cardName || "—"} />
                <Row label="Kapasitas" value={status.detected ? `${status.capacityMb.toLocaleString()} MB (${status.capacityGb} GB)` : "—"} />
                <Row label="Terdeteksi" value={status.detected ? "Ya" : "Tidak"} valueColor={status.detected ? "text-emerald-400" : "text-red-400"} />
                <Row label="Ter-mount" value={status.mounted ? "Ya" : "Tidak"} valueColor={status.mounted ? "text-emerald-400" : "text-red-400"} />
              </div>
            </div>
          ) : null}
        </div>

        {/* Format Card */}
        <div className="rounded-xl border border-white/[0.08] bg-[#0a1c28] p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-red-500/20 ring-1 ring-amber-500/20">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            </span>
            <div>
              <h3 className="text-[15px] font-bold text-white">Format MicroSD</h3>
              <p className="text-xs text-slate-500">Format kartu ke FAT32</p>
            </div>
          </div>

          <p className="mb-4 text-[13px] leading-relaxed text-slate-400">
            Format akan <strong className="text-red-400">menghapus seluruh data</strong> pada
            kartu MicroSD dan membuat filesystem FAT32 baru. Setelah format, penyimpanan telemetri
            akan aktif kembali tanpa perlu reboot.
          </p>

          {formatting && (
            <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3.5 py-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
              <span className="text-[13px] text-amber-300">
                Format sedang berlangsung — jangan cabut kartu...
              </span>
            </div>
          )}

          <Button
            variant="danger"
            size="md"
            disabled={!status?.detected || formatting}
            onClick={() => setConfirmOpen(true)}
            className="w-full"
          >
            {formatting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Memformat...
              </>
            ) : (
              <>
                <HardDrive className="h-4 w-4" />
                Format MicroSD
              </>
            )}
          </Button>

          {!status?.detected && status && (
            <p className="mt-2 text-center text-xs text-red-400">
              Masukkan kartu MicroSD terlebih dahulu
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleFormat}
        title="Format MicroSD?"
        message={
          <>
            Tindakan ini akan <strong>menghapus seluruh data</strong> pada kartu MicroSD
            {status?.cardName ? ` (${status.cardName}, ${status.capacityGb} GB)` : ""} dan
            memformat ulang ke FAT32.
            <br /><br />
            Data telemetri, histori crop cycle, dan file ekspor yang tersimpan akan hilang permanen.
            Proses ini tidak dapat dibatalkan.
          </>
        }
        confirmLabel="Ya, Format Sekarang"
        danger
      />
    </AppShell>
  );
}

function Row({
  label,
  value,
  valueColor = "text-slate-200",
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium ${valueColor}`}>{value}</span>
    </div>
  );
}
