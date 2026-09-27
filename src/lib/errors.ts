/**
 * Standardized service error — mirrors the backend error envelope
 * ({ success: false, error: { code, message } }) so the frontend can preserve
 * the code and show a readable message no matter where the failure comes from.
 */
export type ServiceErrorCode =
  | "VALIDATION_FAILED"
  | "DUPLICATE_ID"
  | "NOT_FOUND"
  | "INVALID_RELATIONSHIP"
  | "CONFLICT"
  | "DEVICE_OFFLINE"
  | "NOT_CONNECTED"
  | "UNKNOWN";

export class ServiceError extends Error {
  code: ServiceErrorCode;
  field?: string;

  constructor(code: ServiceErrorCode, message: string, field?: string) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.field = field;
  }
}

export function isServiceError(e: unknown): e is ServiceError {
  return e instanceof ServiceError;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "An unexpected error occurred.";
}
