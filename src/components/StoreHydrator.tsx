"use client";

import { useEffect } from "react";
import { restorePersistedDb } from "@/lib/store";

/**
 * Restores persisted mock-db state from localStorage AFTER hydration.
 *
 * Server HTML and the first client render both use the seed data, so React
 * hydration always matches (no "server rendered text didn't match" error).
 * Persisted CRUD changes are applied immediately after mount via notify(),
 * which re-renders every page subscribed through useDbVersion().
 */
export function StoreHydrator() {
    useEffect(() => {
        restorePersistedDb();
    }, []);
    return null;
}
