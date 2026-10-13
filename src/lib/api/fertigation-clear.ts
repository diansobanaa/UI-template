/**
 * Manual-clear untuk penanda READY_TO_FERTIGATE / READY_TO_SEND.
 *
 * SATU-SATUNYA titik panggil endpoint clear-ready di Web UI. Kalau kontrak
 * firmware berubah (path / bentuk body), cukup sesuaikan fungsi
 * `clearReadyMarker` di file ini — pemanggil tidak perlu diubah.
 *
 * Asumsi kontrak firmware (disiapkan paralel oleh tim firmware):
 *   POST /api/v1/fertigation/clear-ready
 *   body: { occurrenceId?: string; batchId?: string; source?: string }
 *   -> 200 dengan { ok: true } saat penanda berhasil dihapus.
 * Clear bersifat manual & idempoten: hanya menghapus penanda READY untuk
 * item/batch yang dipilih, TIDAK menghapus occurrence/history dan TIDAK
 * membuat batch/queue baru.
 */
import { apiPost, defaultConfig } from "./backend-client";

export interface ClearReadyTarget {
  /** ID occurrence yang berstatus READY (mis. occ-fert-...). Salah satu dari occurrenceId / batchId wajib diisi. */
  occurrenceId?: string;
  /** ID batch yang berstatus READY (mis. batch-gh-...). Salah satu dari occurrenceId / batchId wajib diisi. */
  batchId?: string;
}

export interface ClearReadyResult {
  ok: boolean;
  clearedOccurrenceId?: string;
  clearedBatchId?: string;
  message?: string;
  [key: string]: unknown;
}

export async function clearReadyMarker(target: ClearReadyTarget): Promise<ClearReadyResult> {
  const { occurrenceId, batchId } = target;
  if (!occurrenceId && !batchId) {
    throw new Error("clearReadyMarker: occurrenceId atau batchId wajib diisi.");
  }
  const body: Record<string, unknown> = { source: "WEB_UI" };
  if (occurrenceId) body.occurrenceId = occurrenceId;
  if (batchId) body.batchId = batchId;
  try {
    return await apiPost<ClearReadyResult>("/api/v1/fertigation/clear-ready", body, defaultConfig);
  } catch (err: any) {
    const msg = String(err?.message || "");
    // Endpoint belum ada di firmware (404): beri panduan yang jelas, bukan error samar.
    if (/404|not found|not_found/i.test(msg)) {
      throw new Error(
        "Endpoint clear-ready belum tersedia di firmware. " +
        "Slot READY yang macet hanya tersimpan di RAM — reboot ESP32 (tombol RESET) untuk membersihkannya, " +
        "lalu coba lagi."
      );
    }
    throw err;
  }
}
