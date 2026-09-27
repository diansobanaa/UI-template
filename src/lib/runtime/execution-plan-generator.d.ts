export interface ExecutionPlanResult {
  valid: boolean;
  status: "READY" | "BLOCKED";
  executionPlan: Record<string, unknown> | null;
  blockedReasons: Array<{ code: string; message: string; [key: string]: unknown }>;
}

export function generateFertigationExecutionPlan(
  configuration: any,
  intentOrRequest: any,
  calibrations?: any
): ExecutionPlanResult;
