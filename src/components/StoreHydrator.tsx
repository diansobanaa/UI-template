"use client";

import { useEffect } from "react";
import { restorePersistedDb } from "@/lib/store";

/**
 * Restores persisted client cache from localStorage AFTER hydration.
 */
export function StoreHydrator() {
    useEffect(() => {
        restorePersistedDb();
    }, []);
    return null;
}
