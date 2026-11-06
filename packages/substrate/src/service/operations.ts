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
