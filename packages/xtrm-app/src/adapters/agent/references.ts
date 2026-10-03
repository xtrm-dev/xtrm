// Typed @ references at submit (PRD §36.6, §36.12 item 2; XTRM-598).
//
// - @issue / @epic resolve through adapters/substrate (revision = the issue revision), @gh-issue / @pr
//   through adapters/github (revision = the item's updatedAt); the agent host resolves @file,
//   @commit, @session, @agent and @frame (AgentAdapter.resolveReferences).
// - Budgets are UTF-8 bytes of rendered content. Above a kind's budget a reference carries an excerpt
//   and a pointer; above the total per submit, or with any unresolved reference, submit is blocked.
// - The host forwards only the command to the session, so the resolved context reaches the agent as
//   a block appended to the message: an index (one JSON object per reference) and then each
//   reference's content. The Frame projection strips the block again and keeps the index as the
//   Frame's references with their revisions.
import type { GithubAdapter, GithubIssueSummary, IssueDetail, PullRequestDetail, SubstrateAdapter } from "../types.ts";
import type { AgentAdapter, AgentRef, ContextReference, RefKind } from "./types.ts";

const KB = 1024;
/** PRD §36.12 item 2, app-resolved kinds; the host applies the budgets of the kinds it resolves. */
export const REFERENCE_BUDGET_BYTES = { issue: 16 * KB, epic: 16 * KB, "gh-issue": 8 * KB, pr: 8 * KB } as const;
/** PRD §36.12 item 2: total per submit; above it submit is blocked. */
export const SUBMIT_BUDGET_BYTES = 96 * KB;

export const formatRef = (r: Pick<AgentRef, "kind" | "ref">) => `@${r.kind}:${r.ref}`;

const encoder = new TextEncoder();
export const byteLength = (text: string) => encoder.encode(text).length;

/** At most `maxBytes` UTF-8 bytes of `text`, never splitting a character. */
export function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  let end = Math.max(0, maxBytes);
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

export function unresolved(ref: AgentRef, error: string): ContextReference {
  return { kind: ref.kind, raw: formatRef(ref), status: "unresolved", error };
}

/** Whole sections in order while they fit, then a pointer (§36.12 item 2 for @issue / @epic). */
function sectioned(ref: AgentRef, title: string, revision: string, sections: string[], budget: number, pointer: string): ContextReference {
  let content = "";
  let truncated = false;
  for (const section of sections) {
    const next = content ? `${content}\n\n${section}` : section;
    if (byteLength(next) <= budget) {
      content = next;
      continue;
    }
    // The first section is always present, cut to the budget if it alone is too long.
    if (!content) content = truncateUtf8(section, budget);
    truncated = true;
    break;
  }
  return {
    kind: ref.kind,
    raw: formatRef(ref),
    status: "resolved",
    title,
    revision,
    content,
    bytes: byteLength(content),
    budgetBytes: budget,
    truncated,
    ...(truncated ? { pointer } : {}),
  };
}

const list = (label: string, items: string[]) => (items.length ? `${label}\n${items.map((i) => `- ${i}`).join("\n")}` : "");

/** @issue / @epic from a Substrate issue read: contract, state, readiness, claim (§36.6); an epic adds its children. */
export function issueReference(ref: AgentRef, issue: IssueDetail): ContextReference {
  const c = issue.contract;
  const head = [
    `${issue.ref} · ${issue.title}`,
    `kind ${issue.kind} · lifecycle ${issue.lifecycle} · readiness ${issue.readiness} · revision ${issue.revision}`,
    issue.claim ? `claimed by ${issue.claim.holder}` : "unclaimed",
    ...(issue.parent ? [`parent ${issue.parent.ref} · ${issue.parent.title}`] : []),
  ].join("\n");
  const sections = [
    head,
    c.problem && `PROBLEM\n${c.problem}`,
    c.success && `SUCCESS\n${c.success}`,
    list("SCOPE", c.scope),
    list("NON-GOALS", c.nonGoals),
    list("CONSTRAINTS", c.constraints),
    list("VALIDATION", c.validation.map((v) => v.text)),
    list("OUTPUT", c.output.map((o) => o.text)),
    list("REFERENCES", c.references),
    ref.kind === "epic" ? list("CHILDREN", issue.children.map((ch) => `${ch.ref} · ${ch.lifecycle} · ${ch.title}`)) : "",
  ].filter(Boolean);
  return sectioned(ref, `${issue.ref} · ${issue.title}`, `rev:${issue.revision}`, sections, REFERENCE_BUDGET_BYTES[ref.kind as "issue" | "epic"], `sb issue show ${issue.ref}`);
}

/** `owner/name#n`; null when the ref is not in that form. */
export function parseGithubRef(ref: string): { repo: string; number: number } | null {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(ref);
  return m ? { repo: m[1]!, number: Number(m[2]) } : null;
}

/** @gh-issue: body and metadata (§36.12 item 2). */
export function githubIssueReference(ref: AgentRef, issue: GithubIssueSummary): ContextReference {
  const head = [
    `${ref.ref} · ${issue.title}`,
    `state ${issue.state} · author ${issue.author}${issue.labels.length ? ` · labels ${issue.labels.join(", ")}` : ""} · ${issue.comments} comments`,
    issue.url,
  ].join("\n");
  return sectioned(ref, issue.title, `updated:${issue.updatedAt}`, [head, issue.body ? `BODY\n${issue.body}` : ""].filter(Boolean), REFERENCE_BUDGET_BYTES["gh-issue"], issue.url);
}

/** @pr: body, state and checks; the diff is always by pointer (§36.12 item 2). */
export function pullReference(ref: AgentRef, pull: PullRequestDetail): ContextReference {
  const gh = parseGithubRef(ref.ref)!;
  const pointer = `gh pr diff ${gh.number} --repo ${gh.repo}`;
  const head = [
    `${ref.ref} · ${pull.title}`,
    `state ${pull.state}${pull.draft ? " (draft)" : ""} · ${pull.headBranch} → ${pull.baseBranch} · author ${pull.author}`,
    `checks ${pull.checks} · review ${pull.review} · ${pull.changedFiles} files +${pull.additions} −${pull.deletions}`,
    pull.url,
    `diff: ${pointer}`,
  ].join("\n");
  const files = list("FILES", pull.files.map((f) => `${f.filename} (${f.status} +${f.additions} −${f.deletions})`));
  const r = sectioned(ref, pull.title, `updated:${pull.updatedAt}`, [head, pull.body ? `BODY\n${pull.body}` : "", files].filter(Boolean), REFERENCE_BUDGET_BYTES.pr, pointer);
  return { ...r, pointer };
}

export interface SubmitCheck {
  references: ContextReference[];
  totalBytes: number;
  unresolved: ContextReference[];
  overBudget: boolean;
}

export function checkReferences(references: ContextReference[]): SubmitCheck {
  const totalBytes = references.reduce((sum, r) => sum + (r.status === "resolved" ? (r.bytes ?? 0) : 0), 0);
  return { references, totalBytes, unresolved: references.filter((r) => r.status !== "resolved"), overBudget: totalBytes > SUBMIT_BUDGET_BYTES };
}

/** The operator's reason for a blocked submit, or null when it may go. */
export function blockReason(check: SubmitCheck): string | null {
  if (check.unresolved.length) {
    const what = check.unresolved.map((r) => `${r.raw} (${(r.error ?? "unresolved").replace(/_/g, " ")})`).join(", ");
    return `Unresolved reference ${what}. Fix or remove it before sending.`;
  }
  if (check.overBudget) {
    return `References total ${Math.ceil(check.totalBytes / KB)} KB, above the ${SUBMIT_BUDGET_BYTES / KB} KB budget per submit. Remove references before sending.`;
  }
  return null;
}

// --- the message the agent receives ------------------------------------------------------------

const OPEN = "<xtrm-references>";
const CLOSE = "</xtrm-references>";
const SEPARATOR = `\n\n${OPEN}\n`;

const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The operator's text, then the index of resolved references, then each reference's content. */
export function composeMessage(text: string, references: ContextReference[]): string {
  if (!references.length) return text;
  const index = references.map((r) =>
    JSON.stringify({ raw: r.raw, kind: r.kind, title: r.title, revision: r.revision, bytes: r.bytes, truncated: r.truncated || undefined, pointer: r.pointer }),
  );
  const bodies = references.map((r) => {
    const note = r.truncated ? `\n[excerpt: ${r.bytes ?? 0} of the content within the ${r.budgetBytes ?? 0} byte budget; full content: ${r.pointer ?? "not available"}]` : r.pointer ? `\n[more: ${r.pointer}]` : "";
    return `<reference raw="${attr(r.raw)}" revision="${attr(r.revision ?? "")}">\n${r.content ?? ""}${note}\n</reference>`;
  });
  return `${text}${SEPARATOR}Context the operator attached, resolved at submit (one JSON line per reference):\n${index.join("\n")}\n${CLOSE}\n\n${bodies.join("\n\n")}`;
}

const KINDS: readonly RefKind[] = ["issue", "epic", "gh-issue", "pr", "commit", "file", "session", "agent", "frame"];

/** Splits a submitted message back into the operator's text and the references it carried. */
export function splitMessage(message: string): { text: string; refs: AgentRef[] } {
  const at = message.indexOf(SEPARATOR);
  if (at < 0) return { text: message, refs: [] };
  const refs: AgentRef[] = [];
  for (const line of message.slice(at + SEPARATOR.length).split("\n")) {
    if (line === CLOSE) break;
    if (!line.startsWith("{")) continue;
    try {
      const v = JSON.parse(line) as { raw?: unknown; kind?: unknown; revision?: unknown; pointer?: unknown; truncated?: unknown };
      const kind = v.kind as RefKind;
      if (typeof v.raw !== "string" || !KINDS.includes(kind) || !v.raw.startsWith(`@${kind}:`)) continue;
      refs.push({
        kind,
        ref: v.raw.slice(kind.length + 2),
        ...(typeof v.revision === "string" ? { revision: v.revision } : {}),
        ...(v.truncated === true && typeof v.pointer === "string" ? { pointer: v.pointer } : {}),
      });
    } catch {
      // a line the index did not write
    }
  }
  return { text: message.slice(0, at), refs };
}

// --- resolution at submit ----------------------------------------------------------------------

export interface ReferenceSources {
  agent: Pick<AgentAdapter, "resolveReferences">;
  substrate: Pick<SubstrateAdapter, "getIssue">;
  github: Pick<GithubAdapter, "getIssue" | "getPull">;
}

/** Resolves every reference through its adapter (§36.6), in the given order, and checks the budgets. */
export async function resolveForSubmit(sources: ReferenceSources, sessionId: string, refs: AgentRef[]): Promise<SubmitCheck> {
  const out: ContextReference[] = refs.map((r) => unresolved(r, "unresolved"));
  const host: number[] = [];
  await Promise.all(
    refs.map(async (ref, i) => {
      if (ref.kind === "issue" || ref.kind === "epic") {
        out[i] = await sources.substrate.getIssue(ref.ref).then(
          (issue) => issueReference(ref, issue),
          () => unresolved(ref, "issue_not_found"),
        );
      } else if (ref.kind === "gh-issue" || ref.kind === "pr") {
        const gh = parseGithubRef(ref.ref);
        if (!gh) out[i] = unresolved(ref, "invalid_reference");
        else if (ref.kind === "pr") out[i] = await sources.github.getPull(gh.repo, gh.number).then((p) => pullReference(ref, p), () => unresolved(ref, "pull_request_not_found"));
        else out[i] = await sources.github.getIssue(gh.repo, gh.number).then((x) => githubIssueReference(ref, x), () => unresolved(ref, "github_issue_not_found"));
      } else host.push(i);
    }),
  );
  if (host.length) {
    const resolved = await sources.agent.resolveReferences(sessionId, host.map((i) => refs[i]!)).catch(() => null);
    host.forEach((i, k) => (out[i] = resolved?.[k] ?? unresolved(refs[i]!, "agent_host_unreachable")));
  }
  return checkReferences(out);
}
