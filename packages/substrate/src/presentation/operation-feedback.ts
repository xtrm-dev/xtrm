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
  return { value: data, feedback } as unknown as T & { feedback: OperationFeedback };
}

// Provider-neutral inference for mutation responses that already have a
// distinctive typed result shape. Reads pass through unchanged. This keeps
// Claude/Pi/CLI confirmation semantics aligned without moving feedback into
// the durable services or changing their return types.
export function attachMutationFeedback(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const data = value as Record<string, unknown>;
  if (data.feedback !== undefined) return value;

  if ((data.op === "claim" || data.op === "release") && typeof data.issueId === "string") {
    if (data.op === "claim") {
      return withFeedback(data, successFeedback("issue_claimed", `Claimed ${data.issueId}`));
    }
    return data.claim == null
      ? withFeedback(data, noopFeedback("claim_absent", `No live claim was released for ${data.issueId}`))
      : withFeedback(data, successFeedback("issue_released", `Released ${data.issueId}`));
  }

  if (typeof data.revisionCreated === "boolean" && (typeof data.humanRef === "string" || typeof data.locator === "string")) {
    const ref = String(data.humanRef ?? data.locator);
    return data.revisionCreated
      ? withFeedback(data, successFeedback("issue_updated", `Updated ${ref}`, "new revision created; readiness must be revalidated"))
      : withFeedback(data, noopFeedback("issue_unchanged", `${ref} already has this execution-authoritative state`, "no new revision created"));
  }

  if (typeof data.closureId === "string" && typeof data.issueId === "string") {
    return withFeedback(
      data,
      successFeedback("issue_closed", `Closed ${data.issueId}`, data.outcome ? `outcome ${String(data.outcome)}` : undefined),
    );
  }

  if (typeof data.entryId === "string" && typeof data.sequence === "number") {
    return data.degraded === true
      ? withFeedback(data, warningFeedback("journal_degraded", "Checkpoint persisted with degraded semantic enrichment", String(data.reason ?? "mechanical checkpoint is durable")))
      : withFeedback(data, successFeedback("journal_written", "Journal entry persisted", `seq ${data.sequence}`));
  }

  return value;
}
