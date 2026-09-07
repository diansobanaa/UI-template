"use client";

import { useSyncExternalStore } from "react";
import { getDbVersion, subscribeDb } from "./store";

/**
 * Re-render the calling component whenever the mock database changes.
 * With the real backend this is replaced by react-query invalidation or
 * polling — the call sites stay the same.
 */
export function useDbVersion(): number {
  return useSyncExternalStore(subscribeDb, getDbVersion, () => 0);
}
