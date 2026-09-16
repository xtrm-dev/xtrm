// Shared human/agent operation feedback contract for Substrate surfaces.
// Presentation-only: this module never mutates Issue/Journal/Provenance state.

export type OperationFeedbackLevel = "success" | "noop" | "warning" | "error";

export interface OperationFeedback {
  level: OperationFeedbackLevel;
  code: string;
  message: string;
  detail?: string;
  hint?: string;
  retryable?: boolean;
}

export function successFeedback(code: string, message: string, detail?: string, hint?: string): OperationFeedback {
  return {
    level: "success",
    code,
    message,
    ...(detail ? { detail } : {}),
    ...(hint ? { hint } : {}),
  };
}

export function noopFeedback(code: string, message: string, detail?: string, hint?: string): OperationFeedback {
  return {
    level: "noop",
    code,
    message,
    ...(detail ? { detail } : {}),
    ...(hint ? { hint } : {}),
  };
}

export function warningFeedback(code: string, message: string, detail?: string, hint?: string): OperationFeedback {
  return {
    level: "warning",
    code,
    message,
    ...(detail ? { detail } : {}),
    ...(hint ? { hint } : {}),
  };
}

export function errorFeedback(
  code: string,
  message: string,
  detail?: string,
  hint?: string,
  retryable = false,
): OperationFeedback {
  return {
    level: "error",
    code,
    message,
    retryable,
    ...(detail ? { detail } : {}),
    ...(hint ? { hint } : {}),
  };
}

export function withFeedback<T>(data: T, feedback: OperationFeedback): T & { feedback: OperationFeedback } {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>), feedback } as T & { feedback: OperationFeedback };
  }
  return { value: data, feedback } as T & { feedback: OperationFeedback };
}
