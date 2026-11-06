// Which service operations may be retried after a lost connection.
//
// A read can be repeated safely: it changed nothing, so a second attempt observes
// the same store or a newer one. A mutation cannot — the protocol carries no
// idempotency key, and a connection that dropped after the frame was sent may
// already have committed. The default is therefore mutation: an operation nobody
// classified is never retried, because a repeated write is worse than a failed
// one. `tests/service-operations.test.ts` pins this set against the operation
// table, so a new read must be classified deliberately.

const READ_OPERATIONS: ReadonlySet<string> = new Set([
  "authority.list",
  "gate.check",
  "issue.get",
  "issue.getActiveClaim",
  "issue.getParent",
  "issue.getReadiness",
  "issue.getResolvedContext",
  "issue.getRevision",
  "issue.latestAttestation",
  "issue.listEvents",
  "issue.listLinks",
  "issue.queryAllIssues",
  "issue.resolveProject",
  "issue.resolveRef",
  "issue.resolveRefInProject",
  "issue.unsatisfiedBlockers",
  "journal.collectMechanical",
  "journal.getEntry",
  "journal.latest",
  "journal.latestCheckpoint",
  "journal.listEntries",
  "journal.renderCheckpoint",
  "journal.since",
  "journal.timeline",
  "provenance.activationDetail",
  "provenance.findByCommit",
  "provenance.findByPr",
  "provenance.listArtifacts",
  "provenance.listBindings",
  "provenance.listReceipts",
  "provenance.sessionDetail",
  "provenance.trace",
  "resume.buildCapsule",
  "resume.renderCapsule",
  "store.get",
]);

/** True only for operations this build has classified as safe to repeat. */
export function isReadOperation(op: string): boolean {
  return READ_OPERATIONS.has(op);
}

/** True when the failure means the connection is gone, not that the call was refused. */
export function isConnectionLost(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "connection_lost";
}

/** The classification, for the test that pins it against the operation table. */
export function readOperations(): string[] {
  return [...READ_OPERATIONS].sort();
}

/** The codes that mean the transport, not the operation, failed. */
const TRANSPORT_CODES: ReadonlySet<string> = new Set([
  "connection_lost",
  "not_installed",
  "protocol_mismatch",
  "peer_noise",
  "spawn_failed",
]);

/**
 * True when the failure came from reaching the store, not from the store's
 * answer. Such a failure happens only on a configured remote, which is what lets
 * the gate block on it while leaving local behaviour alone.
 */
export function isTransportFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && TRANSPORT_CODES.has(code);
}

/** The transport code of a failure, for a message an operator can act on. */
export function transportCode(error: unknown): string | null {
  if (!isTransportFailure(error)) return null;
  return (error as { code: string }).code;
}
