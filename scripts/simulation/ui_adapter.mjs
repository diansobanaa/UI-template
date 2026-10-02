/**
 * UI State Adapter for Fertigation & Mixing Simulation
 * Bridges the backend/firmware state to the exact UI presentation layers
 * (FertigationQueueDashboard, GreenhouseMixingTanks, DosingQueueSection, ComplexFertigationOverview).
 */

export function computeUIState(engine) {
  const currentMinutes = engine.clock.currentMinutes;

  // 1. Compute Active Job for DosingQueueSection
  let activeJob = null;
  if (engine.activeBatch) {
    const b = engine.activeBatch;
    activeJob = {
      id: b.queueEntry.jobId,
      ghId: b.ghId,
      ghCode: b.ghId,
      ghName: `Greenhouse ${b.ghId.replace("GH-", "")}`,
      jobTitle: `${b.queueEntry.recipeName} (${b.queueEntry.targetWaterL} L)`,
      recipeName: b.queueEntry.recipeName,
      targetWaterL: b.queueEntry.targetWaterL,
      targetWaterMl: b.queueEntry.targetWaterMl,
      dosingAml: b.queueEntry.dosingA_ml,
      dosingBml: b.queueEntry.dosingB_ml,
      mixingDurationSec: b.queueEntry.mixingDurationSec,
      scheduledTimeStr: b.queueEntry.timeStr,
      queuePosition: 0,
      status: "ACTIVE",
      statusLabel: "Sedang Dosing Central",
      steps: b.queueEntry.steps,
    };
  }

  // 2. Compute Queued Jobs for FIFO Queue
  const queuedJobs = engine.dosingQueue
    .filter((q) => q.state === "PENDING")
    .map((q, idx) => ({
      id: q.jobId,
      queueId: q.queueId,
      ghId: q.ghId,
      ghCode: q.ghId,
      ghName: `Greenhouse ${q.ghId.replace("GH-", "")}`,
      jobTitle: `${q.recipeName} (${q.targetWaterL} L)`,
      recipeName: q.recipeName,
      targetWaterL: q.targetWaterL,
      targetWaterMl: q.targetWaterMl,
      dosingAml: q.dosingA_ml,
      dosingBml: q.dosingB_ml,
      mixingDurationSec: q.mixingDurationSec,
      scheduledTimeStr: q.timeStr,
      queuePosition: idx + 1,
      status: "PENDING_FIFO",
      statusLabel: `Urutan #${idx + 1} di Central`,
      steps: q.steps,
    }));

  // 3. Compute Next Scheduled Operation (Section 5 Spec)
  // Filters out past schedules, finds earliest upcoming
  const upcomingSchedules = engine.schedules
    .filter((s) => s.enabled)
    .map((s) => {
      const [h, m] = s.time.split(":").map(Number);
      return { sched: s, minutes: h * 60 + m };
    })
    .filter((item) => item.minutes >= currentMinutes)
    .sort((a, b) => a.minutes - b.minutes);

  let nextScheduledOp = null;
  if (upcomingSchedules.length > 0) {
    const s = upcomingSchedules[0].sched;
    nextScheduledOp = {
      ghCode: s.ghId,
      ghName: `Greenhouse ${s.ghId.replace("GH-", "")}`,
      time: s.time,
      jobTitle: `${s.recipeName} (${s.targetWaterL} L)`,
    };
  }

  // 4. Compute Mixing Tank Cards (Section 7 Spec)
  const ghList = ["GH-01", "GH-02", "GH-03"];
  const mixingTanks = ghList.map((ghId) => {
    const tank = engine.tanks[ghId];
    const ghScheds = engine.schedules.filter((s) => s.ghId === ghId);
    const ghUpcoming = upcomingSchedules.find((item) => item.sched.ghId === ghId)?.sched;
    const isTargetActive = engine.activeBatch?.ghId === ghId;
    const queueItem = engine.dosingQueue.find((q) => q.ghId === ghId && q.state === "PENDING");
    const queuePosition = engine.dosingQueue.filter((q) => q.state === "PENDING").findIndex((q) => q.ghId === ghId) + 1;
    const sensor = engine.sensors[`level${ghId.replace("-", "")}`];

    let status = "Standby";
    let statusTone = "slate";
    let statusDesc = "Siaga — belum ada jadwal";
    let timingLabel = "Status";
    let timingValue = "Siaga";
    let canDeliverNow = false;
    let canPreMixNow = false;

    if (tank.state === "DELIVERING") {
      status = "Fertigation in progress";
      statusTone = "purple";
      statusDesc = "Pompa distribusi sedang menyiram ke tanaman";
      timingLabel = "Penyiraman";
      timingValue = "Pompa Aktif Menyiram";
      canPreMixNow = false;
    } else if (tank.state === "READY") {
      status = "Ready for fertigation";
      statusTone = "emerald";
      statusDesc = "Larutan homogen & siap dialirkan ke dripper";
      timingLabel = "Kesiapan Larutan";
      timingValue = "Siap Dialirkan Sekarang";
      canDeliverNow = true;
      canPreMixNow = false;
    } else if (tank.state === "FAILED") {
      status = "Failed";
      statusTone = "rose";
      statusDesc = "Peracikan batch gagal atau mengalami kendala";
      timingLabel = "Kendala Operasi";
      timingValue = "Gagal";
      canPreMixNow = false;
    } else if (tank.state === "INTERRUPTED") {
      status = "Interrupted";
      statusTone = "rose";
      statusDesc = "Operasi terhenti oleh reboot/daya putus";
      timingLabel = "Status Operasi";
      timingValue = "Terputus";
      canPreMixNow = false;
    } else if (isTargetActive) {
      if (engine.activeBatch.state === "FILLING" || engine.activeBatch.state === "PRECHECK") {
        status = "Preparing water";
        statusTone = "blue";
        statusDesc = "Mengisi air baku ke tangki batch";
      } else if (engine.activeBatch.state === "DOSING") {
        status = "Dosing nutrients";
        statusTone = "cyan";
        statusDesc = "Injeksi nutrisi A & B di central unit";
      } else if (engine.activeBatch.state === "FINAL_MIXING") {
        status = "Mixing";
        statusTone = "cyan";
        statusDesc = "Pengadukan & homogenisasi larutan di tangki";
      }
      timingLabel = "Status Operasi";
      timingValue = "Sedang Berjalan";
      canPreMixNow = false;
    } else if (queueItem) {
      status = "Waiting in queue";
      statusTone = "amber";
      statusDesc = `Menunggu giliran di Unit Dosing Sentral (Urutan #${queuePosition})`;
      timingLabel = "Posisi Antrean";
      timingValue = `Urutan #${queuePosition} di Central`;
      canPreMixNow = false;
    } else if (ghUpcoming) {
      status = "Waiting for schedule";
      statusTone = "slate";
      statusDesc = `Standby menunggu jadwal berikutnya (Pukul ${ghUpcoming.time})`;
      timingLabel = "Jadwal Mulai";
      timingValue = `Pukul ${ghUpcoming.time}`;
      // In fail-safe mode, manual enqueue button is suppressed when waiting for automated schedule!
      canPreMixNow = false;
    }

    // Volume calculation & sensor labeling (Fail-Safe Volumetric)
    const isSensorAvailable = sensor && !sensor.faults.notInstalled && !sensor.faults.disconnected;
    const capacityL = tank.capacityL;
    const targetWaterL = ghUpcoming?.targetWaterL || ghScheds[0]?.targetWaterL || 50;

    let volumeDisplayLabel = "Volume Tangki Batch (Fail-Safe)";
    let volumeDisplayValue = `0 / ${capacityL} L (0%) · Target: ${targetWaterL} L (Volumetrik Fail-Safe)`;
    let levelPct = 0;

    if (isSensorAvailable && !sensor.faults.invalidFeedback) {
      const measuredVolumeL = sensor.getVolumeReading(tank.currentVolumeL, capacityL);
      levelPct = capacityL > 0 ? (measuredVolumeL / capacityL) * 100 : 0;
      volumeDisplayLabel = "Volume Aktual Terukur";
      volumeDisplayValue = `${measuredVolumeL} / ${capacityL} L (${levelPct.toFixed(0)}%)`;
    } else if (status === "Ready for fertigation") {
      levelPct = Math.min(100, (targetWaterL / capacityL) * 100);
      volumeDisplayLabel = "Volume Larutan Siap";
      volumeDisplayValue = `${targetWaterL} L (Siap Disiram · Pelampung Aman)`;
    } else if (isTargetActive) {
      const actualWaterL = Math.round(tank.waterVolumeMl / 1000);
      levelPct = Math.min(100, (actualWaterL / capacityL) * 100);
      volumeDisplayLabel = "Volume Terisi (Flow Meter ZJ-B1)";
      volumeDisplayValue = `${actualWaterL} / ${targetWaterL} L (Pengisian Volumetrik)`;
    } else {
      levelPct = 0;
      volumeDisplayLabel = "Volume Tangki Batch (Fail-Safe)";
      volumeDisplayValue = `0 / ${capacityL} L (0%) · Target: ${targetWaterL} L (Volumetrik Fail-Safe)`;
    }

    return {
      ghId,
      displayName: ghId,
      tankName: `Tangki Pencampur ${ghId}`,
      status,
      statusTone,
      statusDescription: statusDesc,
      capacityL,
      targetWaterL,
      levelPct,
      volumeDisplayLabel,
      volumeDisplayValue,
      timingLabel,
      timingValue,
      canPreMixNow,
      canDeliverNow,
      isSensorAvailable,
    };
  });

  // 5. Complex Overview Aggregation Counters
  const readyCount = mixingTanks.filter((t) => t.status === "Ready for fertigation").length;
  const runningCount = mixingTanks.filter(
    (t) => t.status === "Preparing water" || t.status === "Dosing nutrients" || t.status === "Mixing" || t.status === "Fertigation in progress"
  ).length;
  const queuedCount = mixingTanks.filter((t) => t.status === "Waiting in queue").length;
  const waitingCount = mixingTanks.filter((t) => t.status === "Waiting for schedule").length;
  const errorCount = mixingTanks.filter((t) => t.status === "Failed" || t.status === "Interrupted").length;

  return {
    centralUnit: {
      status: activeJob ? "Dosing" : "Standby",
      activeJob,
    },
    dosingQueue: {
      queuedJobs,
      nextScheduledOp,
      isEmpty: queuedJobs.length === 0,
    },
    mixingTanks,
    complexOverview: {
      readyCount,
      runningCount,
      queuedCount,
      waitingCount,
      errorCount,
    },
  };
}
