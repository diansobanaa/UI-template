"use client";

import { useSyncExternalStore } from "react";
import { getOperationalStateVersion, subscribeOperationalState } from "./operational-state";

/**
 * Compatibility hook kept so existing pages continue to re-render, but the
 * source is now the Python-owned operational state cache.
 */
export function useDbVersion(): number {
  return useSyncExternalStore(subscribeOperationalState, getOperationalStateVersion, () => 0);
}
