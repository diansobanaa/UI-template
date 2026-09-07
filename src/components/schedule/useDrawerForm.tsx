"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/errors";

/**
 * Shared drawer-form behavior (spec #24/#25/#27): pending state during the
 * service call (button disabled — no duplicate submission), an error banner
 * that keeps the drawer open on failure, and an unsaved-changes guard when
 * closing with dirty form data.
 */
export function useDrawerForm({
  open,
  onClose,
  dirty,
}: {
  open: boolean;
  onClose: () => void;
  dirty: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const requestClose = () => {
    if (saving) return; // don't close mid-request
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const submit = async (fn: () => Promise<void>) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const errorBanner = error ? (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] font-medium leading-relaxed text-red-600">
      {error}
    </div>
  ) : null;

  return { saving, error, errorBanner, requestClose, submit, confirmDiscard, dismissDiscard: () => setConfirmDiscard(false) };
}
