import { useEffect, useState } from "react";
import { apiGet, defaultConfig } from "@/lib/api/backend-client";
import { DailyFertigationList, type DailyFertigationItem } from "./DailyFertigationList";
import { MixingQueuePanel, type MixingQueueItem, type TankStatus } from "./MixingQueuePanel";

/**
 * Section tab Fertigasi: mengambil daftar fertigasi harian dan status tong
 * dari firmware (endpoint baru), lalu memberi makan DailyFertigationList
 * dan MixingQueuePanel. Refresh otomatis tiap 30 detik.
 */
export function FertigationDailySection() {
  const [items, setItems] = useState<DailyFertigationItem[]>([]);
  const [tanks, setTanks] = useState<TankStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [daily, tankData] = await Promise.all([
          apiGet<DailyFertigationItem[]>("/api/v1/fertigation/daily", defaultConfig),
          apiGet<TankStatus[]>("/api/v1/fertigation/tanks", defaultConfig),
        ]);
        if (!cancelled) {
          setItems(Array.isArray(daily) ? daily : []);
          setTanks(Array.isArray(tankData) ? tankData : []);
        }
      } catch {
        /* Biarkan kosong; panel menampilkan empty state. */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  /* Queue mixing diturunkan dari daily items yang menunggu diracik. */
  const queue: MixingQueueItem[] = items
    .filter((it) => it.status === "menunggu-mixing")
    .map((it, idx, arr) => ({
      id: it.id,
      ghId: it.ghId,
      ghCode: it.ghCode,
      recipeName: it.recipeName,
      targetWaterL: it.targetWaterL,
      position: idx + 1,
      isActive:
        idx === 0 &&
        items.some((x) => x.ghId === it.ghId && x.status === "mixing"),
    }));

  if (loading) {
    return null;
  }

  return (
    <>
      <div className="mb-4">
        <DailyFertigationList items={items} dateLabel="Hasil fetch 00:00" />
      </div>
      <div className="mb-4">
        <MixingQueuePanel queue={queue} tanks={tanks} />
      </div>
    </>
  );
}
