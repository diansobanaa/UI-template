"use client";

import { useEffect, useState } from "react";
import type { Greenhouse } from "@/lib/types";
import { StartCycleModal } from "./StartCycleModal";
import { OngoingCycleModal } from "./OngoingCycleModal";
import { PollinationModal } from "./PollinationModal";
import { CycleManageModal } from "./CycleManageModal";
import { HarvestModal } from "./HarvestModal";
import { CycleHistoryModal } from "./CycleHistoryModal";

export interface CropCycleModalManagerProps {
  gh: Greenhouse;
  startNormalOpen: boolean;
  onCloseStartNormal: () => void;
  startOngoingOpen: boolean;
  onCloseStartOngoing: () => void;
  polinasiOpen: boolean;
  onClosePolinasi: () => void;
  manageOpen: boolean;
  onCloseManage: () => void;
  harvestOpen: boolean;
  onCloseHarvest: () => void;
  historyOpen: boolean;
  onCloseHistory: () => void;
  onStartCycle: (tanggalTanam: string, options?: { variety?: string; plantCount?: number; notes?: string }) => Promise<void>;
  onStartOngoingCycle: (tanggalTanam: string, options?: { variety?: string; plantCount?: number; tanggalPolinasi?: string; notes?: string }) => Promise<void>;
  onRecordPolinasi: (tanggalPolinasi: string, options?: { pollinationMethod?: "natural" | "bee" | "manual"; notes?: string }) => Promise<void>;
  onUpdateTanggalTanam: (newTanggalTanam: string) => Promise<void>;
  onUpdateTanggalPolinasi: (newTanggalPolinasi: string, options?: { pollinationMethod?: "natural" | "bee" | "manual" }) => Promise<void>;
  onUpdateMetadata?: (updates: { variety?: string; plantCount?: number; notes?: string }) => Promise<void>;
  onDeleteTanggalPolinasi: () => Promise<void>;
  onResetCycle?: () => Promise<void>;
  onHarvest: (options?: { harvestDate?: string; yieldKg?: number; grade?: string; notes?: string }) => Promise<void>;
}

/**
 * Orchestrates modal visibility only.
 * Form state, validation and submit lifecycle live inside the individual modal.
 */
export function CropCycleModalManager({ gh, manageOpen, onCloseManage, ...props }: CropCycleModalManagerProps) {
  const [internalManageOpen, setInternalManageOpen] = useState(manageOpen);

  useEffect(() => setInternalManageOpen(manageOpen), [manageOpen]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ ghId?: string }>).detail;
      if (!detail?.ghId || detail.ghId === gh.id) setInternalManageOpen(true);
    };
    window.addEventListener("crop-cycle-open-manage", handler);
    return () => window.removeEventListener("crop-cycle-open-manage", handler);
  }, [gh.id]);

  const closeManage = () => {
    setInternalManageOpen(false);
    onCloseManage();
  };

  return (
    <>
      <StartCycleModal gh={gh} startNormalOpen={props.startNormalOpen} onCloseStartNormal={props.onCloseStartNormal} onStartCycle={props.onStartCycle} />
      <OngoingCycleModal gh={gh} startOngoingOpen={props.startOngoingOpen} onCloseStartOngoing={props.onCloseStartOngoing} onStartOngoingCycle={props.onStartOngoingCycle} />
      <PollinationModal gh={gh} cycle={gh.cropCycle} polinasiOpen={props.polinasiOpen} onClosePolinasi={props.onClosePolinasi} onRecordPolinasi={props.onRecordPolinasi} />
      <CycleManageModal gh={gh} cycle={gh.cropCycle} open={internalManageOpen} onClose={closeManage} onUpdateTanggalTanam={props.onUpdateTanggalTanam} onUpdateTanggalPolinasi={props.onUpdateTanggalPolinasi} onUpdateMetadata={props.onUpdateMetadata} onDeleteTanggalPolinasi={props.onDeleteTanggalPolinasi} onResetCycle={props.onResetCycle} />
      <HarvestModal gh={gh} cycle={gh.cropCycle} harvestOpen={props.harvestOpen} onCloseHarvest={props.onCloseHarvest} onHarvest={props.onHarvest} />
      <CycleHistoryModal gh={gh} cycle={gh.cropCycle} historyOpen={props.historyOpen} onCloseHistory={props.onCloseHistory} />
    </>
  );
}
