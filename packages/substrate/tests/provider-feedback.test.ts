import assert from "node:assert/strict";
import test from "node:test";

import { attachMutationFeedback } from "../src/presentation/operation-feedback.ts";

function feedbackOf(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>).feedback as Record<string, unknown> | undefined;
}

test("read payloads remain unchanged", () => {
  const read = { humanRef: "XTRM-1", title: "Read only", lifecycleState: "open" };
  assert.equal(attachMutationFeedback(read), read);
  assert.equal(feedbackOf(read), undefined);
});

test("claim/release payloads receive structured confirmation", () => {
  const claimed = attachMutationFeedback({ op: "claim", issueId: "iss_1", claim: { holder: "worker" } });
  assert.equal(feedbackOf(claimed)?.code, "issue_claimed");
  assert.equal(feedbackOf(claimed)?.level, "success");

  const released = attachMutationFeedback({ op: "release", issueId: "iss_1", claim: null });
  assert.equal(feedbackOf(released)?.code, "claim_absent");
  assert.equal(feedbackOf(released)?.level, "noop");
});

test("issue updates distinguish revision from idempotent no-op", () => {
  const changed = attachMutationFeedback({ humanRef: "XTRM-9", revisionCreated: true });
  assert.equal(feedbackOf(changed)?.code, "issue_updated");
  assert.match(String(feedbackOf(changed)?.detail), /readiness/);

  const same = attachMutationFeedback({ humanRef: "XTRM-9", revisionCreated: false });
  assert.equal(feedbackOf(same)?.code, "issue_unchanged");
  assert.equal(feedbackOf(same)?.level, "noop");
});

test("journal and closure payloads receive bounded feedback", () => {
  const journal = attachMutationFeedback({ entryId: "jrn_1", sequence: 7 });
  assert.equal(feedbackOf(journal)?.code, "journal_written");

  const degraded = attachMutationFeedback({ entryId: "jrn_2", sequence: 8, degraded: true, reason: "semantic model unavailable" });
  assert.equal(feedbackOf(degraded)?.level, "warning");

  const closure = attachMutationFeedback({ closureId: "clo_1", issueId: "iss_1", outcome: "completed" });
  assert.equal(feedbackOf(closure)?.code, "issue_closed");
});
