/**
 * Framework-free form validation helpers.
 *
 * Each validator returns an error message string, or null when the value is
 * valid. Forms collect results into a FieldErrors record keyed by field name
 * and render them next to the offending field (<FieldError> in primitives).
 */
import { ServiceError } from "./errors";

export type FieldErrors = Record<string, string | null>;

export function required(value: string | null | undefined, label = "This field"): string | null {
  if (!value || !value.trim()) return `${label} is required.`;
  return null;
}

export function number(
  value: string | number | null | undefined,
  opts: { label?: string; min?: number; max?: number; positive?: boolean; integer?: boolean } = {}
): string | null {
  const label = opts.label ?? "This field";
  if (value === null || value === undefined || String(value).trim() === "") return `${label} is required.`;
  const num = Number(value);
  if (Number.isNaN(num)) return `${label} must be a number.`;
  if (opts.integer && !Number.isInteger(num)) return `${label} must be a whole number.`;
  if (opts.positive && num <= 0) return `${label} must be greater than zero.`;
  if (opts.min !== undefined && num < opts.min) return `${label} must be at least ${opts.min}.`;
  if (opts.max !== undefined && num > opts.max) return `${label} must be at most ${opts.max}.`;
  return null;
}

export function time(value: string | null | undefined, label = "Time"): string | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return `${label} must be a valid time (HH:MM).`;
  return null;
}

export function date(value: string | null | undefined, label = "Date"): string | null {
  if (!value || Number.isNaN(new Date(value).getTime())) return `${label} must be a valid date.`;
  return null;
}

/** Throws a ServiceError when any field has an error message. */
export function assertValid(errors: FieldErrors): void {
  const first = Object.entries(errors).find(([, msg]) => msg !== null && msg !== undefined);
  if (first) {
    throw new ServiceError("VALIDATION_FAILED", first[1] as string, first[0]);
  }
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some((msg) => msg !== null && msg !== undefined);
}
