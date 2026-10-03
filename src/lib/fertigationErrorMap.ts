/**
 * Canonical Fertigation & Mixing Error Code Dictionary
 * 
 * Maps machine-readable error codes sent by ESP32 into clear, human-friendly
 * operational diagnostic explanations with actionable resolutions for operators.
 */

export type FertigationActionType =
  | "CALIBRATE_PUMP"
  | "CALIBRATE_FLOW"
  | "CHECK_WATER"
  | "CHECK_EQUIPMENT"
  | "CHECK_VALVE"
  | "SYNC_SCHEDULE"
  | "GENERAL";

export interface FertigationErrorInfo {
  code: string;
  title: string;
  description: string;
  actionType: FertigationActionType;
  actionLabel?: string;
  componentId?: string;
  severity: "error" | "warning" | "info";
}

interface ErrorDefinition {
  title: string;
  description: (comp?: string) => string;
  actionType: FertigationActionType;
  actionLabel?: string;
  severity: "error" | "warning" | "info";
}

const ERROR_DEFINITIONS: Record<string, ErrorDefinition> = {
  DOSING_PUMP_NOT_CALIBRATED: {
    title: "Pompa Dosing Belum Dikalibrasi",
    description: (comp) =>
      `Pompa nutrisi (${comp || "Dosing A/B"}) belum memiliki catatan kalibrasi aktif di memori ESP32. Kalibrasi diperlukan agar takaran ml akurat.`,
    actionType: "CALIBRATE_PUMP",
    actionLabel: "Kalibrasi Pompa Sekarang",
    severity: "error",
  },
  DOSING_RATE_INVALID: {
    title: "Laju Alir Pompa Tidak Valid",
    description: (comp) =>
      `Nilai laju alir kalibrasi untuk pompa ${comp || "dosing"} bernilai 0 atau tidak cocok dengan toleransi aktif kontroler.`,
    actionType: "CALIBRATE_PUMP",
    actionLabel: "Perbaiki Kalibrasi",
    severity: "error",
  },
  FLOW_SENSOR_NOT_CALIBRATED: {
    title: "Sensor Alir Belum Dikalibrasi",
    description: (comp) =>
      `Sensor alir (${comp || "flow meter"}) belum memiliki faktor kalibrasi pulsa per liter di ESP32.`,
    actionType: "CALIBRATE_FLOW",
    actionLabel: "Kalibrasi Sensor Alir",
    severity: "error",
  },
  EQUIPMENT_NOT_READY: {
    title: "Peralatan Belum Siap / Non-aktif",
    description: (comp) =>
      `Peralatan wajib (${comp || "tangki/pompa"}) dalam status non-aktif (Disabled) atau belum di-commissioning.`,
    actionType: "CHECK_EQUIPMENT",
    actionLabel: "Periksa Konfigurasi Alat",
    severity: "warning",
  },
  CONFIG_HASH_MISMATCH: {
    title: "Konfigurasi Jadwal Tidak Sinkron",
    description: () =>
      "Jadwal peracikan dibuat menggunakan hash konfigurasi lama yang tidak cocok dengan konfigurasi aktif kontroler.",
    actionType: "SYNC_SCHEDULE",
    actionLabel: "Sinkronkan Jadwal",
    severity: "warning",
  },
  INVALID_RECIPE_PARAMETERS: {
    title: "Parameter Resep Tidak Lengkap",
    description: () =>
      "Jadwal tidak memiliki parameter volume air atau dosis nutrisi (ml) yang valid untuk dieksekusi.",
    actionType: "SYNC_SCHEDULE",
    actionLabel: "Perbaiki Resep",
    severity: "error",
  },
  RAW_WATER_NO_FLOW: {
    title: "Aliran Air Baku Tidak Mengalir",
    description: () =>
      "Pompa pengisi air baku aktif namun sensor alir membaca 0 L/menit. Pastikan toren air baku terisi dan kran terbuka.",
    actionType: "CHECK_WATER",
    actionLabel: "Periksa Sumber Air Baku",
    severity: "error",
  },
  RAW_WATER_FILL_TIMEOUT: {
    title: "Waktu Pengisian Air Baku Habis",
    description: () =>
      "Pengisian air baku ke tangki mixing memakan waktu lebih lama dari batas toleransi keamanan.",
    actionType: "CHECK_WATER",
    actionLabel: "Periksa Debit Air & Pipa",
    severity: "error",
  },
  DOSING_RUNTIME_EXCEEDED: {
    title: "Batas Waktu Injeksi Nutrisi Terlampaui",
    description: (comp) =>
      `Pompa ${comp || "dosing"} melebihi batas waktu aman injeksi tanpa konfirmasi volume tuntas.`,
    actionType: "CHECK_EQUIPMENT",
    actionLabel: "Periksa Selang & Pompa",
    severity: "error",
  },
  TANK_OVERFLOW_TRIPPED: {
    title: "Pelampung Atas Tangki Terpicu",
    description: () =>
      "Sensor pelampung atas (high level) mendeteksi tangki penuh sebelum seluruh air dan nutrisi selesai dimasukkan.",
    actionType: "GENERAL",
    actionLabel: "Periksa Level Tangki",
    severity: "error",
  },
  MIXING_PUMP_FAULT: {
    title: "Pompa Pengaduk (Mixer) Bermasalah",
    description: () =>
      "Pompa sirkulasi/mixer homogenisasi 220V AC tidak merespons atau gagal diaktifkan.",
    actionType: "CHECK_EQUIPMENT",
    actionLabel: "Periksa Relay Mixer",
    severity: "error",
  },
  DELIVERY_NO_FLOW: {
    title: "Aliran Penyaluran Tidak Terdeteksi",
    description: (comp) =>
      `Pompa distribusi (${comp || "GH"}) menyala namun tidak ada air mengalir ke tanaman.`,
    actionType: "CHECK_EQUIPMENT",
    actionLabel: "Periksa Pompa Distribusi",
    severity: "error",
  },
  DELIVERY_TIMEOUT: {
    title: "Waktu Penyaluran Pupuk Habis",
    description: () =>
      "Penyaluran larutan ke tanaman melebihi batas waktu yang ditentukan sebelum target volume tercapai.",
    actionType: "GENERAL",
    actionLabel: "Periksa Jaringan Irigasi",
    severity: "error",
  },
  ROUTING_VALVE_FAULT: {
    title: "Katup Distribusi Gagal Dibuka",
    description: (comp) =>
      `Katup selector pipa (${comp || "valve"}) gagal terbuka ke greenhouse tujuan.`,
    actionType: "CHECK_VALVE",
    actionLabel: "Periksa Katup Valve",
    severity: "error",
  },
  TANK_EMPTY_EARLY: {
    title: "Air Tangki Habis Lebih Awal",
    description: () =>
      "Pelampung bawah tangki mendeteksi air sudah habis saat penyaluran masih berlangsung.",
    actionType: "GENERAL",
    actionLabel: "Periksa Kapasitas Tangki",
    severity: "warning",
  },
  EMERGENCY_STOP_ACTIVE: {
    title: "Tombol Darurat (E-Stop) Aktif",
    description: () =>
      "Sistem berada dalam status penguncian darurat (E-Stop). Seluruh aktuator dinonaktifkan.",
    actionType: "GENERAL",
    actionLabel: "Lepas Tombol Darurat",
    severity: "error",
  },
  RECOVERY_HOLD_REQUIRED: {
    title: "Pemeriksaan Pasca Listrik Padam",
    description: () =>
      "Kontroler sempat restart di tengah proses peracikan. Diperlukan kuras/reset manual agar takaran pupuk tidak berlebih.",
    actionType: "GENERAL",
    actionLabel: "Kuras Tangki & Reset",
    severity: "warning",
  },
  SCHEDULE_MISSED_STALE: {
    title: "Jadwal Terlewat (Kadaluarsa)",
    description: () =>
      "Waktu pelaksanaan jadwal ini sudah terlewat dari jam operasional yang ditentukan.",
    actionType: "GENERAL",
    actionLabel: "Abaikan Jadwal Ini",
    severity: "info",
  },
  WATCHDOG_TIMEOUT: {
    title: "Watchdog Mulai Fisik Timeout",
    description: () =>
      "Kontroler tidak memulai peracikan fisik dalam 15 detik setelah antrean di-dispatch.",
    actionType: "GENERAL",
    actionLabel: "Coba Lagi",
    severity: "error",
  },
  DISPATCH_REJECTED: {
    title: "Perintah Ditolak Kontroler",
    description: () =>
      "Kontroler menolak eksekusi batch peracikan karena kondisi hardware atau status sistem belum siap.",
    actionType: "GENERAL",
    actionLabel: "Sinkronkan Antrean",
    severity: "error",
  },
};

/**
 * Resolves a machine error code into a structured, operator-friendly diagnostic object.
 */
export function resolveFertigationError(
  errorCode?: string | null,
  componentId?: string | null,
  fallbackMessage?: string | null
): FertigationErrorInfo {
  const code = (errorCode || "").trim().toUpperCase();
  const def = ERROR_DEFINITIONS[code];

  if (def) {
    return {
      code,
      title: def.title,
      description: def.description(componentId || undefined),
      actionType: def.actionType,
      actionLabel: def.actionLabel,
      componentId: componentId || undefined,
      severity: def.severity,
    };
  }

  // Fallback for custom or unknown codes
  return {
    code: code || "UNKNOWN_ERROR",
    title: code ? `Kendala Sistem (${code})` : "Kendala Operasi Peracikan",
    description:
      fallbackMessage ||
      (componentId
        ? `Terjadi kendala pada komponen ${componentId}. Pemeriksaan diperlukan sebelum operasi dapat dilanjutkan.`
        : "Operasi peracikan nutrisi tidak dapat dilanjutkan oleh kontroler ESP32."),
    actionType: "GENERAL",
    actionLabel: "Periksa Kontroler",
    componentId: componentId || undefined,
    severity: "error",
  };
}
