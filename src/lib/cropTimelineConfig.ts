import type { Greenhouse } from "./types";

export type CropTimelineConfig = NonNullable<Greenhouse["cropTimelineConfig"]>;

/** Read crop timeline configuration that is owned by the operational backend. */
export function getCropTimelineConfig(gh: Greenhouse): CropTimelineConfig | null {
  return gh.cropTimelineConfig ?? null;
}
