import * as crypto from "node:crypto";

export function shortId(prefix: string, len = 6): string {
  return `${prefix}-${crypto.randomBytes(len).toString("hex").slice(0, len)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function participantId(chainId: string, role: string): string {
  return `${chainId}::${role}`;
}

export function executionId(participantId: string, attempt: number): string {
  return `exec-${participantId.replace(/[^a-zA-Z0-9]+/g, "-")}-${attempt}`;
}

export function idempotencyKey(chainId: string, stepId: string, attempt: number, kind: string): string {
  return `${chainId}/step:${stepId}/attempt:${attempt}/${kind}`;
}
