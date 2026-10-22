// The one model-facing tool surface (XTRM-674). The Claude MCP server and the
// Pi extension both register exactly these tools with exactly these parameter
// keys and this text. Each adapter keeps its own schema library (zod for MCP,
// TypeBox for Pi) and reads docs from here, so wording cannot drift.
//
// Descriptions stay short on purpose: the journal kind glossary lives in
// `sb help kinds`, and the full methodology in the using-substrate skill.

import { JOURNAL_KINDS } from "../src/domain/journal.ts";
import { ISSUE_KINDS } from "../src/domain/issue.ts";
import { CLOSURE_OUTCOMES } from "../src/domain/closure.ts";

export const TOOL_NAMES = [
  "issue_get",
  "issue_list",
  "issue_claim",
  "issue_update",
  "issue_close",
  "journal_append",
  "journal_read",
  "resume_capsule",
  "provenance",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const PI_TOOL_PREFIX = "substrate_";
export const piToolName = (name: ToolName): string => `${PI_TOOL_PREFIX}${name}`;

export const ISSUE_LIST_STATUSES = ["ready", "open", "in_progress", "blocked", "draft", "deferred", "done", "cancelled"] as const;
export const CLAIM_OPS = ["claim", "renew", "release"] as const;
export const JOURNAL_READ_MODES = ["latest", "since", "timeline", "show"] as const;
/** Kinds an agent may append; compaction rows are written by the host only. */
export const WRITABLE_JOURNAL_KINDS = JOURNAL_KINDS.filter((k) => k !== "compaction");
export { ISSUE_KINDS, CLOSURE_OUTCOMES };

export interface ParamSpec {
  doc: string;
  required: boolean;
}

export interface ToolSpec {
  name: ToolName;
  description: string;
  params: Record<string, ParamSpec>;
}

const req = (doc: string): ParamSpec => ({ doc, required: true });
const opt = (doc: string): ParamSpec => ({ doc, required: false });

const REF = req("Issue ref: humanRef, locator or id");
const HOLDER_DEFAULT = "default: SUBSTRATE_HOLDER, else the xt worktree name";

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "issue_get",
    description: "Read one issue: contract, readiness, claim, attestation.",
    params: { ref: REF },
  },
  {
    name: "issue_list",
    description: "List issues of a project. status ready lists dispatchable work.",
    params: {
      project: opt("Project id (default: this repository's)"),
      status: opt(`One of ${ISSUE_LIST_STATUSES.join("|")}`),
      query: opt("Substring of title or ref"),
      kind: opt(`One of ${ISSUE_KINDS.join("|")}`),
      limit: opt("Max rows (default 100)"),
      claimedBy: opt("Holder or me: list the issues that holder has claimed, with latest handoff; other filters ignored"),
    },
  },
  {
    name: "issue_claim",
    description: "Take, renew or release the issue lease. Claim before editing; renew before it expires.",
    params: {
      ref: REF,
      op: opt(`${CLAIM_OPS.join("|")} (default claim)`),
      holder: opt(`Lease holder (${HOLDER_DEFAULT})`),
      ttlMs: opt("Lease length in ms"),
      activationId: opt("Specialist activation id"),
    },
  },
  {
    name: "issue_update",
    description: "Change title, priority or contract. A contract change makes a new revision that needs re-attestation.",
    params: {
      ref: REF,
      title: opt("New title"),
      priority: opt("New priority (integer)"),
      contract: opt("Full seven-field contract object"),
    },
  },
  {
    name: "issue_close",
    description: "Close an issue with an outcome and reason. A completed close should cite result or validation refs.",
    params: {
      ref: REF,
      outcome: req(CLOSURE_OUTCOMES.join("|")),
      reason: req("Why it is closed; stored in the closure row"),
      journalResultRefs: opt("Journal result entry ids"),
      validationRefs: opt("Validation evidence refs"),
      receiptRefs: opt("Work receipt refs"),
      artifactRefs: opt("Artifact refs"),
      participant: opt(`Who closes (${HOLDER_DEFAULT})`),
    },
  },
  {
    name: "journal_append",
    description: "Append a Journal entry (kinds: `sb help kinds`). Record findings, decisions and outcomes here, not in the contract.",
    params: {
      ref: REF,
      kind: req(WRITABLE_JOURNAL_KINDS.join("|")),
      summary: opt("What changed / evidence / next step. Max 16000 chars (longer fails). Required except for checkpoint and result"),
      summaryFile: opt("Local file whose text is the summary (instead of summary)"),
      next: opt("Next steps"),
      details: opt("Extra semantic fields: completed, current, blocked, openQuestions, keyDecisions, materialFindings"),
      result: opt("Bounded outcome object {summary, attempted, outcome, completed[], validation[]}. Required for kind result"),
    },
  },
  {
    name: "journal_read",
    description: "Read the Journal with full bodies. latest: newest entry; since: after cursor; timeline: recent window; show: all, oldest first.",
    params: {
      ref: REF,
      mode: req(JOURNAL_READ_MODES.join("|")),
      kind: opt("Only this journal kind"),
      cursor: opt("Sequence cursor; required for since (0 reads all)"),
      limit: opt("Max entries"),
    },
  },
  {
    name: "resume_capsule",
    description: "Build the resume capsule: contract, latest checkpoint, delta, blockers, claim.",
    params: { ref: REF },
  },
  {
    name: "provenance",
    description: "Evidence spine (bindings, receipts, claims, closure). Pass exactly one selector.",
    params: {
      ref: opt("Issue ref"),
      sessionId: opt("XTRM session id"),
      activationId: opt("Specialist activation id"),
    },
  },
];

export const TOOL_SPEC_BY_NAME: Readonly<Record<ToolName, ToolSpec>> = Object.fromEntries(
  TOOL_SPECS.map((s) => [s.name, s]),
) as Record<ToolName, ToolSpec>;

export function paramDoc(tool: ToolName, key: string): string {
  const p = TOOL_SPEC_BY_NAME[tool].params[key];
  if (!p) throw new Error(`tool-surface: ${tool} has no parameter ${key}`);
  return p.doc;
}

/** Characters of model-facing text: every description plus every parameter doc. */
export function surfaceTextLength(specs: readonly ToolSpec[] = TOOL_SPECS): number {
  return specs.reduce(
    (sum, s) => sum + s.description.length + Object.values(s.params).reduce((n, p) => n + p.doc.length, 0),
    0,
  );
}
