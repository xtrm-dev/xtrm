#!/usr/bin/env node
// sb CLI vertical (Phase 4, bead xtrm-7wc.5). Thin consumer of the typed
// service: no SQL here, no business logic here. Readiness, claims, planning
// and identity resolution all live in IssueService / PlanningService; this
// process only parses argv, calls the service, and renders JSON or one-line
// human projections (hierarchical locator + durable reference; the opaque
// machine ID appears only in --json output).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  BEADS_TBD_MARKER,
  expectedProblemHead,
  extractSectionsDetailed,
  importBeads,
  unionEdgesDetailed,
  type BeadsEdgeRecord,
  type BeadsIssueRecord,
} from "../src/compatibility/beads/import.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { packageRoot } from "../src/package-root.ts";
import { assertSchemaHealthy } from "../src/store/migrations/runner.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { RepositoryService } from "../src/service/repository-service.ts";
import { discoverGitRoot, discoverRepository, type RepositoryDiscovery } from "../src/domain/repository-discovery.ts";
import { BOOLEAN_FLAGS, type FlagValue, type Flags, flag, flagList, parseArgs } from "../src/domain/argv.ts";
import { forwardCli, localStoreRequested } from "../src/remote/executor.ts";
import { serveStdio } from "../src/service/serve.ts";
import type { RemoteTransport } from "../src/remote/ssh.ts";
import { remoteDoctor, type RemoteDoctorReport } from "../src/remote/doctor.ts";
import { renderRemoteDoctor, renderRemoteSetup, renderRemoteStatus } from "../src/remote/render.ts";
import { remoteSetup } from "../src/remote/setup.ts";
import { clearRemoteConfig, remoteConfigPath } from "../src/remote/config.ts";
// Compat re-export (XTRM-337): discoverRepository/discoverGitRoot moved to the
// shared domain module; re-exported here so existing `../cli/sb.ts` importers
// keep working while new code imports the shared module directly.
export { discoverGitRoot, discoverRepository };
export type { RepositoryDiscovery };
import { PlanningService } from "../src/service/planning-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import type { JournalOperationalContext } from "../src/service/journal-service.ts";
import { ClosureService } from "../src/service/closure-service.ts";
import { CLOSURE_OUTCOMES, isClosureOutcome } from "../src/domain/closure.ts";
import { resolveClaimHolder } from "../src/domain/claim.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { IntegrationService } from "../src/service/integration-service.ts";
import { assertResultPayload, isJournalKind } from "../src/domain/journal.ts";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../src/recall/constants.ts";
import { buildRecallIndex } from "../src/recall/indexer.ts";
import { parseSince, recall } from "../src/recall/query.ts";
import type { RecallResult } from "../src/recall/types.ts";
import { renderProvenanceTrace } from "../src/presentation/terminal.ts";
import { assertContractShape, isValidScrutiny, SCRUTINY_LEVELS } from "../src/domain/contract.ts";
import { enrichExecutionContext } from "../src/domain/execution-context.ts";
import type { JournalEntry, JournalKind, ResultPayload } from "../src/domain/journal.ts";
import type { IssueKind, LifecycleState, ResolvedIssue } from "../src/domain/issue.ts";
import type { OperationalState } from "../src/domain/readiness.ts";

export const SCHEMA_VERSION = "substrate-cli/v1";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface Ctx {
  dbPath: string;
  json: boolean;
}

// -- PRD-45 compact projections (presentation of service data) ---------------

// Machine id rides inside the JSON projection only: human() picks named
// fields, so one-line output never shows the opaque id (display rules).
function issueSummary(i: IssueSummaryInput): Record<string, unknown> {
  return {
    id: i.id,
    locator: i.locator,
    humanRef: i.humanRef,
    title: i.title,
    kind: i.kind,
    lifecycleState: i.lifecycleState,
    revision: i.currentRevision,
  };
}

function readySummary(i: IssueSummaryInput, state: string, dispatchable: boolean): Record<string, unknown> {
  return { ...issueSummary(i), readinessState: state, dispatchable };
}

// Board-row adapter (XTRM-393): the projection carries every list/ready key
// the summaries read, so the N+1 reads retire while the 7-key shape below
// stays untouched. The input is a narrow structural type, never a fabricated
// ResolvedIssue: a zero-filled stand-in would silently answer future fields.
interface IssueSummaryInput {
  id: string;
  locator: string;
  humanRef: string;
  title: string;
  kind: IssueKind;
  lifecycleState: LifecycleState;
  currentRevision: number;
}

function boardRowSummaryInput(r: {
  id: string;
  locator: string;
  humanRef: string;
  title: string;
  kind: IssueKind;
  lifecycleState: LifecycleState;
  revision: number;
}): IssueSummaryInput {
  return {
    id: r.id,
    locator: r.locator,
    humanRef: r.humanRef,
    title: r.title,
    kind: r.kind,
    lifecycleState: r.lifecycleState,
    currentRevision: r.revision,
  };
}

// ProvenanceTraceSummary shape surfaced early: Phase 8 owns receipts and
// bundles; until then the trace is the event spine (count + last marker),
// never invented provenance.
function provenanceSummary(
  svc: IssueService,
  issueId: string,
): Record<string, unknown> {
  const events = svc.listEvents(issueId);
  const last = events[events.length - 1];
  return {
    issueId,
    eventCount: events.length,
    lastEventType: last?.type ?? null,
    lastEventAt: last?.createdAt ?? null,
  };
}

// Bounded closure summary for `issue show` (ADR §§50, 96). The Closure
// row is the authority when one exists (outcome, reason, actor, session
// and refs durable in the store, never only in git log); otherwise this
// derives a projection from live lifecycle state and the durable
// lifecycle events, and never invents a reason.
const TERMINAL_LIFECYCLE = new Set(["done", "cancelled", "archived"]);

function closureSummary(db: ReturnType<typeof openSubstrate>, svc: IssueService, issue: ResolvedIssue): Record<string, unknown> {
  try {
    const latest = new ClosureService(db, svc).getLatestClosure(issue.id);
    if (latest !== null) {
      return {
        lifecycleState: issue.lifecycleState,
        closed: true,
        closedAt: latest.closedAt,
        closureId: latest.closureId,
        outcome: latest.outcome,
        reason: latest.reason,
        actor: latest.actor,
        session: latest.executionContext?.xtrmSessionId ?? latest.executionContext?.host?.sessionId ?? null,
        revision: latest.issueRevision,
        contractHash: latest.contractHash,
        // The evidence refs are the point of the Closure row (ADR §96): they are
        // written by `issue close` and must be readable back, not only present in
        // the close response.
        validationRefs: latest.validationRefs,
        journalResultRefs: latest.journalResultRefs,
        receiptRefs: latest.receiptRefs,
        artifactRefs: latest.artifactRefs,
      };
    }
  } catch {
    /* pre-C1 database or read fault: fall through to the derived view */
  }
  let closedAt: number | null = null;
  for (const e of svc.listEvents(issue.id)) {
    if (e.type !== "issue.lifecycle") continue;
    const p = e.payload as { to?: unknown } | null;
    if (p && typeof p.to === "string" && TERMINAL_LIFECYCLE.has(p.to)) closedAt = e.createdAt;
  }
  return {
    lifecycleState: issue.lifecycleState,
    closed: TERMINAL_LIFECYCLE.has(issue.lifecycleState),
    closedAt,
    reason: null,
  };
}

// Bounded human projection: one line per kind at most (bounded vocabulary),
// plus counts. A large journal never enlarges this output.
function renderOperationalContext(ctx: JournalOperationalContext): string[] {
  const lines = ["", "OPERATIONAL CONTEXT", `journal: ${ctx.total} entries`];
  if (ctx.latestByKind.length > 0) {
    lines.push("latest by kind:");
    for (const e of ctx.latestByKind) {
      const bit = e.summary ? ` ${e.summary.slice(0, 200)}` : "";
      lines.push(`- seq${e.sequence} ${e.kind}:${bit}`);
    }
  } else {
    lines.push("(no journal entries)");
  }
  return lines;
}

function treeSummary(svc: IssueService, id: string): Record<string, unknown> {
  const issue = svc.getIssue(id);
  return {
    ...issueSummary(issue),
    children: svc.listChildren(id).map((c) => treeSummary(svc, c.id)),
  };
}

function human(summary: Record<string, unknown>): string {
  const state = (summary["readinessState"] as string | undefined) ?? (summary["lifecycleState"] as string);
  return `${summary["locator"]} · ${summary["humanRef"]} · ${summary["title"]} [${state} rev${summary["revision"]}]`;
}

// Contract sections for human show (bead xtrm-7wc.5.9): the contract is the
// work, so show prints it inline — no --full flag, documented in the bead.
// Canonical section order first, then any extra keys in insertion order.
function contractSections(contract: unknown): string[] {
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)) return [];
  const c = contract as Record<string, unknown>;
  const lines: string[] = [];
  const render = (key: string, value: unknown): void => {
    if (typeof value === "string") lines.push(`## ${key}`, value);
    else if (Array.isArray(value)) {
      lines.push(`## ${key}`);
      for (const item of value) lines.push(typeof item === "string" ? `- ${item}` : `- ${JSON.stringify(item)}`);
    } else lines.push(`## ${key}`, JSON.stringify(value));
  };
  for (const key of ["problem", "success", "scope", "nonGoals", "constraints", "validation", "output"]) {
    if (c[key] !== undefined) render(key, c[key]);
  }
  for (const [key, value] of Object.entries(c)) {
    if (!["problem", "success", "scope", "nonGoals", "constraints", "validation", "output"].includes(key)) render(key, value);
  }
  return lines;
}

// -- argv --------------------------------------------------------------------

// The parser is shared with the remote forwarder (src/domain/argv.ts), so the
// two cannot disagree about which token is a flag's value: that disagreement
// let `--project X export project --file out` look like an export of project X.

function readJsonArg(value: string): unknown {
  // Distinguish the two inputs the flag accepts. The single try/catch this
  // replaced reported a malformed FILE as "<path> is not valid JSON": the
  // parse error was swallowed and the path string was parsed instead.
  if (existsSync(value)) {
    const text = readFileSync(value, "utf8");
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`${value}: file is not valid JSON (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(`${value.slice(0, 40)}: not a readable file and not valid inline JSON (${err instanceof Error ? err.message : String(err)})`);
  }
}

function emit(ctx: Ctx, command: string, data: unknown): CliResult {
  if (ctx.json) {
    return { code: 0, stdout: JSON.stringify({ schema: SCHEMA_VERSION, command, ok: true, data }) + "\n", stderr: "" };
  }
  const lines: string[] = [];
  const push = (s: Record<string, unknown>): void => {
    lines.push(human(s));
  };
  const walk = (t: Record<string, unknown>, depth: number): void => {
    lines.push(`${"  ".repeat(depth)}${human(t)}`);
    for (const c of (t["children"] as Array<Record<string, unknown>>)) walk(c, depth + 1);
  };
  if (Array.isArray(data)) {
    // Empty issue-family output says so (xtrm-7wc.5.7): exit 0 with zero
    // bytes is indistinguishable from broken output. JSON untouched.
    if (data.length === 0) lines.push("(no issues)");
    for (const d of data as Array<Record<string, unknown>>) {
      if (Array.isArray(d["children"])) walk(d, 0);
      else if (typeof d["locator"] === "string") push(d);
      else lines.push(JSON.stringify(d));
    }
  } else if (data !== null && typeof data === "object" && Array.isArray((data as Record<string, unknown>)["children"])) {
    walk(data as Record<string, unknown>, 0);
  } else if (data !== null && typeof data === "object" && typeof (data as Record<string, unknown>)["locator"] === "string") {
    push(data as Record<string, unknown>);
  } else {
    lines.push(JSON.stringify(data));
  }
  return { code: 0, stdout: lines.join("\n") + "\n", stderr: "" };
}

function fail(ctx: Ctx, command: string, err: unknown): CliResult {
  const message = err instanceof Error ? err.message : String(err);
  if (ctx.json) {
    return { code: 1, stdout: JSON.stringify({ schema: SCHEMA_VERSION, command, ok: false, error: message }) + "\n", stderr: "" };
  }
  return { code: 1, stdout: "", stderr: `sb: ${command}: ${message}\n` };
}

// -- help / version / doctor (§28) --------------------------------------------
// Side-effect-free surface: help and version return before SQLite opens, so
// `HOME=/empty sb --help` exits 0 without creating a database. Doctor is the
// one diagnostic that opens state.db (to check it) and reports health.

let cachedVersion: string | null = null;

function cliVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(
      readFileSync(join(packageRoot(), "package.json"), "utf8"),
    ) as { version?: unknown };
    cachedVersion = typeof pkg.version === "string" ? pkg.version : "0.0.0-unknown";
  } catch {
    cachedVersion = "0.0.0-unknown";
  }
  return cachedVersion;
}

const HELP_TOP = `sb — Substrate work tracker CLI

usage:
  sb [--db PATH] [--json] <group> <verb> [args...]
  sb --help | sb help [group [verb]] [--json]
  sb --version
  sb init [--db PATH] [--json]
  sb doctor [--db PATH] [--json]
  sb remote setup ssh:<host> [--server-root PATH] [--refresh] [--json]
  sb remote disable [--json]
  sb recall "<terms>" [--source S] [--since D] [--limit N<=5] [--json]
  sb recall-build [--db PATH] [--index PATH] [--rebuild] [--load-gate N] [--json]

groups:
  init        initialize this repository (bind it to a Project; idempotent)
  issue       create|show|edit|note|validate|attest|list|ready|query|tree|children|relate|unrelate|claim|release|state|close|reopen|defer|cancel|archive|resume
  project     create|link|unlink|list|show|links|repair
  plan        check|apply
  journal     append|checkpoint|show|since|latest|timeline|render
  provenance  dispatch|allocate|bind|trace|commit|receipt|pr|session|activation|bundle
  remote      setup|status|disable
  import      beads
  export      project

memory:
  recall      search every project's journal through a local FTS5 index
              (built by a user systemd timer, read-only per call, fail-open)
  recall-build run the indexer once (the timer oneshot invokes this verb)

flags:
  --db PATH   state.db path (default $SUBSTRATE_DB or ~/.xtrm/state.db)
  --json      machine-readable envelope {schema, command, ok, data|error}

help and --version never open or create the database.
per-verb help: sb issue create --help  |  sb help issue create`;

const COMMAND_HELP: Record<string, string> = {
  top: HELP_TOP,
  remote: `usage: sb remote <setup|status|disable> [--json]

  setup ssh:<host> [--server-root PATH] [--refresh]
  status
  disable

remote mode runs every sb invocation on the server over ssh, with the same
argv, stdin, stdout and exit code (ADR-008): no listener and no daemon. The
client resolves its own repository key from Git and maps it to the server
checkout that reports the same key; a path that merely looks identical is
never used as evidence. --db and SUBSTRATE_DB name a local store, so those
invocations are not forwarded. help, version and doctor never open a store
and are answered here. Configuration lives in ~/.xtrm/config/substrate.json
(override the path with SUBSTRATE_REMOTE_CONFIG). Remote mode is opt-in:
without a remote setting every consumer runs locally and needs no ssh.
Disable with \`sb remote disable\`, or delete the file.`,
  "remote.setup": `usage: sb remote setup ssh:<host> [--server-root PATH] [--refresh] [--json]

verifies the connection, resolves sb on the server once through a login
shell, records the server version and round-trip latency, and maps this
repository to its server checkout by repository key. Fails when the server
has no checkout of this repository, or when several match and --server-root
does not choose one. --refresh re-verifies a cached mapping.`,
  "remote.disable": `usage: sb remote disable [--json]

removes the remote setting so every consumer runs locally again, and drops
the server sb path, version and checkout cache recorded from that server.
Nothing on the server is touched: the store there is untouched and stays
available to the next client that configures it.`,
  "remote.status": `usage: sb remote status [--json]

reports the mode (local or ssh), the resolved server sb path and version,
the round-trip latency, the mapped server checkout, and the capabilities the
server version actually supports — including the ones it does not, so a
0.2.2 server reports the missing holder environment and stdio service
instead of pretending they work.`,
  recall: `usage: sb recall "<terms>" [--source S] [--since D] [--limit N] [--json]

Searches the local Substrate memory index: every journal entry of every
project (decisions, findings, results, notes, handoffs, checkpoints) through
SQLite FTS5. Each hit is a cited pointer, not a transcript.

When to call it:
  - Before re-deriving a decision, a finding, or a handoff. A fact recorded
    once is cheaper to reuse than to rediscover.
  - When a previous turn mentioned an Issue ref, a date, or a decision and the
    current context no longer carries the detail.
  - When an operator ruling, a measured number, or a stated constraint is
    missing and it may already be written down.

What it returns:
  Up to --limit hits (default 3, maximum 5), highest fixed-rerank score first.
  Each hit is at most 240 characters and cites ref#seq, the date, the kind,
  the authority level (0 checkpoint .. 3 decision; 4 is reserved for an
  explicit operator ruling in R3), the project, and a superseded flag.
  Authority and recency are fixed weights, fixed before measurement; the
  current project (SUBSTRATE_PROJECT, when set) ranks higher.
  The reply always reports the index age and watermark age and sets
  index.stale when the timer has not refreshed the index for 15 minutes.

Limits:
  R1 indexes Substrate journals only. Jira comments, PRs, reviews, commits and
  transcripts are not indexed. There are no embeddings. A result body is
  capped at 4 KB before indexing, so a very long result is searchable only by
  its first 4 KB. A hit is a pointer: open the cited ref#seq for the full text.

Freshness and safety:
  A user systemd timer runs \`sb recall-build\` as a oneshot (nice, MemoryMax,
  load gate, single writer). There is no daemon. This verb opens the index
  read-only per call and never opens state.db. Raw journal text is scrubbed
  before it is stored; secrets never reach the index or the snippet.
  Fail-open: a missing, corrupt, incompatible or locked index returns no hits
  and exits 0, with a note. It never blocks the caller.

Index path: ~/.xtrm/recall/index.sqlite (override with SUBSTRATE_RECALL_INDEX
or --index). --source selects a source (journal; R2 adds more). --since takes
YYYY-MM-DD, an ISO timestamp, epoch milliseconds, or a window such as 7d/24h.
--json returns {query, hits[], index, note}.

Examples:
  sb recall "SCID sentinel doc error"
  sb recall "operator cost review rules" --since 2026-11-01 --limit 5
  sb recall "CORE-2595" --json`,
  "recall-build": `usage: sb recall-build [--db PATH] [--index PATH] [--rebuild] [--load-gate N] [--json]

Runs the recall indexer once. This is the command the user systemd timer
invokes (Type=oneshot, Nice=10, MemoryMax=150M); it is not a daemon. The
source state.db is opened read-only and the index is written by this single
writer under a lock file.

Incremental by watermark: rows with created_at at or after the stored
watermark are re-scrubbed and upserted. --rebuild writes a fresh index into a
temporary file and renames it into place, which is also what a schema or
scrub-rule change requires. --load-gate N sets an absolute load1 ceiling
(0 disables); when the host is above it the run reports deferred and exits 0
so the timer tries again. A second concurrent writer reports skipped.

--json data: {status, reason, docsIndexed, docsTotal, watermark, builtAt,
durationMs, indexBytes, peakRssBytes}.`,
  help: `usage: sb help [group [verb]] [--json]  |  sb <group> [<verb>] --help

prints this help without opening the database. With --json, emits the same
content as machine-readable data (capability detection for agents).`,
  version: `usage: sb --version [--json]

prints the CLI version (parseable semver, e.g. "sb 0.1.0") without opening
or creating the database.`,
  init: `usage: sb init [--db PATH] [--json]

initialize this Git repository for Substrate: discover the Git common root,
derive the repository identity, detect the base branch, create or adopt the
deterministic Project, bind the repository, and cache the local checkout
alias. Atomic and idempotent; a second run reports idempotent: true and
created: false. No project metadata is needed.

Methodology: one Git repository maps to exactly one Project; the derived
repository identity (remote plus local fingerprint) is the authority, and
the checkout alias is only a cache. A checkout link that names an existing,
unbound Project is adopted, so a repository resolves to the Project it
already names instead of a second empty one; sb init never overwrites a link
that names a different Project and fails closed when that link is an ancestor
checkout whose Project another repository already owns. Worktrees and clones
of the same repository share the binding — never create a second Project for
a worktree. An uninitialized checkout fails closed on every mutating verb:
run sb init once inside the repository to bind it.

--json data: {repository: {repositoryKey, canonicalRemote, local, gitRoot},
project: {id, prefix, name}, baseBranch, created, adopted, idempotent}.`,
  doctor: `usage: sb doctor [--db PATH] [--json]

exit 0 when state.db opens and the schema is healthy, 1 otherwise.
--json data: {dbPath, schemaHealthy, schemaError, projects, gitRoot,
repository: {repositoryKey, gitRoot, initialized, baseBranch, identityError},
project, projectError, effectiveOverride, link, linkError}.
repository.initialized is a repository_bindings fact (never a resolveProject
success and never true because of an override); link is the effective cwd ->
project mapping (informational; never flips health).`,
  issue: `usage: sb issue <verb> [args...]

  create --project <id> --title <t> --kind <epic|task|bug|decision|research|followup> --contract <file|json> [--parent <ref>] [--priority <n>] [--scrutiny <s>]
  show <ref>
  edit <ref> [--project <id>] [--contract <file|json>] [--title <t>] [--priority <n>] [--scrutiny <s>] [--ownership <file|json>] [--context-refs <file|json>] [--expected-revision <n>]
  note <ref> ["text"] [--project <id>] [--kind <note|finding|decision|blocker|milestone|handoff|result>] [--file <path|->]
  validate <ref>
  attest <ref> --outcome <ready|reject> --policy <p> --attested-by <who> [--project <id>] [--evidence-refs <a,b>] [--blocking-gaps <a,b>]
  list [--project <id>] | ready [--project <id>]
  query --project <id> [--limit <n>] [--cursor <c>] [--lifecycle <s,...>] [--kind <k,...>] [--readiness <r,...>] [--search <q>]
  tree [--project <id> | --root <ref>] | children <ref>
  relate --from <ref> --to <ref> --kind <blocks|relates_to|discovered_from|supersedes|duplicates> [--project <id>]
  unrelate --from <ref> --to <ref> --kind <blocks|relates_to|discovered_from|supersedes|duplicates> [--project <id>]
  claim <ref> --holder <who> [--ttl-ms <n>] [--activation <id>] [--project <id>]
  release <ref> --holder <who> [--activation <id>] [--project <id>]
  state <ref> <open|deferred|done|cancelled|archived> [--until <ms|clear>] [--project <id>]
  close <ref> --outcome <o> --reason <r> [--result/--receipt/--validation/--artifact <a,b>] (canonical first-class close; bare close|reopen|cancel stay legacy lifecycle aliases)
  reopen <ref> --reason <r> | cancel <ref> --reason <r> | archive <ref> [--project <id>]
  defer <ref> [--until <ms|clear>] [--project <id>]
  resume <ref>

<ref> is a machine ID, durable reference, locator, historical locator, or alias.
title/priority are metadata (no revision); contract/ownership/context-refs/scrutiny are
execution-relevant (new revision, readiness invalidated). notes are append-only journal
entries and never bump the revision. Mutating verbs resolve the effective project
context (--project > SUBSTRATE_PROJECT > repository binding > checkout link) and refuse
a ref from another Project unless that Project is selected deliberately; run \`sb init\`
once inside the repository to bind it.`,
  "issue.create": `usage: sb issue create --project <id> --title <t> --kind <epic|task|bug|decision|research|followup> --contract <file|json> [--parent <ref>] [--priority <n>] [--scrutiny <s>]

creates an issue; --contract takes a JSON file path or inline JSON. Scrutiny is required: --scrutiny wins when present, otherwise the contract file's own scrutiny applies; a missing or invalid value fails closed.`,
  "issue.show": `usage: sb issue show <ref>

prints the issue header plus the contract body (human) or full payload (with --json), followed by a bounded operational context: the most recent journal entries (summaries truncated), the newest entry per kind, per-kind counts, the closure view and the provenance summary. An issue with no journal entries prints an explicit empty state. The full journal is never dumped; use "sb journal show" for bodies.`,
  "issue.edit": `usage: sb issue edit <ref> [--project <id>] [--contract <file|json>] [--title <t>] [--priority <n>] [--scrutiny <s>] [--ownership <file|json>] [--context-refs <file|json>] [--expected-revision <n>]

--title/--priority are metadata (no revision, readiness retained); --contract/--ownership/
--context-refs/--scrutiny are execution-relevant (new revision, readiness invalidated).

Do not use this tool for progress, findings, decisions, handoffs or results.
Use the Journal for those (sb issue note, sb journal append, sb journal
checkpoint). Edit changes what the work IS; the Journal records what
HAPPENED. A revision-bearing edit invalidates prior readiness and
attestation: re-validate and re-attest before dispatch, and pass
--expected-revision when racing another writer.`,
  "issue.note": `usage: sb issue note <ref> ["text"] [--project <id>] [--kind <note|finding|decision|blocker|milestone|handoff|result>] [--file <path|->]

appends an append-only journal note (no revision bump). --file - reads stdin.
"result" is a bounded execution outcome: the text becomes result.summary and
an optional --result <file|json> supplies the structured payload.

Methodology: this is the fast path into the Journal — use it (never issue
edit) for annotations, discovered facts, chosen courses, blockers,
progress boundaries, continuation state and bounded outcomes. Notes carry
continuity, never execution authority: they never change the revision and
never go stale on readiness. A progress note or a contract edit must not be
used in place of a result: meaningful settlement needs the bounded result
payload that close cites.`,
  "issue.validate": `usage: sb issue validate <ref>

reports readiness state, structural validity, attestation currency, blockers.`,
  "issue.attest": `usage: sb issue attest <ref> --outcome <ready|reject> --policy <p> --attested-by <who> [--project <id>] [--evidence-refs <a,b>] [--blocking-gaps <a,b>]`,
  "issue.list": `usage: sb issue list [--project <id>]`,
  "issue.ready": `usage: sb issue ready [--project <id>]

lists dispatchable issues only.`,
  "issue.query": `usage: sb issue query --project <id> [--limit <n>] [--cursor <c>] [--lifecycle <s,...>] [--kind <k,...>] [--readiness <r,...>] [--search <q>]

emits one paged board page unchanged (rows/nextCursor/hasMore/scanned/truncated). Human mode renders the rows only; --json carries the full envelope.`,
  "issue.tree": `usage: sb issue tree [--project <id> | --root <ref>]`,
  "issue.children": `usage: sb issue children <ref>`,
  "issue.relate": `usage: sb issue relate --from <ref> --to <ref> --kind <blocks|relates_to|discovered_from|supersedes|duplicates> [--project <id>]

parent_child is structural and not exposed here.`,
  "issue.unrelate": `usage: sb issue unrelate --from <ref> --to <ref> --kind <blocks|relates_to|discovered_from|supersedes|duplicates> [--project <id>]

deactivates the active edge between the endpoints for the given kind.`,
  "issue.claim": `usage: sb issue claim <ref> [--holder <who>] [--ttl-ms <n>] [--activation <id>] [--project <id>]

--holder defaults to SUBSTRATE_HOLDER, the holder an xt session exports for
itself (xt pi|claude|codex <name> sets it). Pass --holder only to claim on
someone else's behalf. With neither --holder nor a non-empty SUBSTRATE_HOLDER
the claim fails closed; there is no implicit unix-user holder.`,
  "issue.release": `usage: sb issue release <ref> [--holder <who>] [--activation <id>] [--project <id>]

--holder defaults to SUBSTRATE_HOLDER, so a session releases its own claim
without restating the name. Releasing another holder's claim still requires
the explicit flag, and the same fail-closed rule applies when neither is set.`,
  "issue.close": `usage: sb issue close <ref> --outcome <completed|superseded|duplicate|wont_fix|invalid|cancelled|abandoned> --reason <r> [--actor <who>] [--participant <id>] [--run <id>] [--activation <id>] [--attempt <id>] [--result <a,b>] [--receipt <a,b>] [--validation <a,b>] [--artifact <a,b>] [--project <id>]

writes an immutable Closure row (outcome, reason, actor, session, revision/hash, refs) and rests on done (cancelled for the cancelled outcome). Bare \`sb issue close <ref>\` stays the legacy lifecycle alias (no Closure invented).

Methodology: close answers WHY the Issue became terminal. Pick the bounded
outcome honestly (completed, superseded, duplicate, wont_fix, invalid,
cancelled, abandoned); the reason lives in the Closure row, never only in
git log. Cite the settlement evidence: --result journal result refs for the
bounded outcome, --validation/--receipt/--artifact for the proof. Each
evidence flag accepts a comma-separated list and may be repeated; repeated
values accumulate in caller order, never silently drop a value. Closure
rows are immutable history -- a mistaken close reopens, it never rewrites.
Stopping one execution is NOT a close: release the claim instead.`,
  "issue.state": `usage: sb issue state <ref> <open|deferred|done|cancelled|archived> [--until <ms|clear>] [--project <id>]

sets the lifecycle state; every transition emits a durable issue.lifecycle event.
--until sets/clears the deferral timestamp (meaningful with deferred).`,
  "issue.reopen": `usage: sb issue reopen <ref> --reason <r> [--actor <who>] [--project <id>]

keeps every historical Closure row untouched, appends a reopen event, and restores lifecycle state to open. Bare \`sb issue reopen <ref>\` stays the legacy lifecycle alias (alias for: sb issue state <ref> open).`,
  "issue.defer": `usage: sb issue defer <ref> [--until <ms|clear>] [--project <id>]

alias for: sb issue state <ref> deferred [--until <ms|clear>].`,
  "issue.cancel": `usage: sb issue cancel <ref> --reason <r> [--actor <who>] [--result <a,b>] [--receipt <a,b>] [--validation <a,b>] [--artifact <a,b>] [--project <id>]

writes a terminal Closure with the cancelled outcome resting on the cancelled lifecycle state. Each evidence flag accepts a comma-separated list and may be repeated; repeated values accumulate in caller order. Stopping one execution is NOT this verb: release the claim (\`sb issue release\`) instead, which leaves lifecycle and Closure untouched. Bare \`sb issue cancel <ref>\` stays the legacy lifecycle alias (alias for: sb issue state <ref> cancelled).`,
  "issue.archive": `usage: sb issue archive <ref> [--project <id>]

alias for: sb issue state <ref> archived.`,
  "issue.resume": `usage: sb issue resume <ref>

builds the continuity capsule (derived, never a source of truth).`,
  project: `usage: sb project <verb>

  create --prefix <PREFIX> --name <name> [--id <id>]
  link --project <id>      link the cwd checkout to a project (explicit only)
  unlink                    remove the cwd checkout link
  list                      list all projects
  show [--project <id>]     show one project (defaults to the resolved project)
  links                     list local checkout aliases (inspection)
  repair                    re-establish the cwd checkout alias from the repository binding

Advanced/recovery surface only (ADR sbcloseout4 §18): not the normal onboarding
workflow. New repositories start with 'sb init'.`,
  "project.create": `usage: sb project create --prefix <PREFIX> --name <name> [--id <id>]

Advanced/recovery surface only (ADR sbcloseout4 §18): not the normal onboarding
workflow. New repositories start with 'sb init'.`,
  "project.link": `usage: sb project link --project <id>

links the cwd git checkout to a project (an administrative alias; normal work uses 'sb init').
--project is required: bare 'sb project link' never infers the Project, not even when
exactly one Project exists (ADR sbcloseout4 §18).

Advanced/recovery surface only: not the normal onboarding workflow. New
repositories start with 'sb init'.`,
  "project.unlink": `usage: sb project unlink

removes the cwd checkout link (the local alias; the repository binding is untouched).

Advanced/recovery surface only (ADR sbcloseout4 §18): not the normal onboarding
workflow. New repositories start with 'sb init'.`,
  "project.list": `usage: sb project list

lists every project in this database (id, prefix, name).

Advanced/recovery surface only (ADR sbcloseout4 §18): not the normal onboarding
workflow. New repositories start with 'sb init'.`,
  "project.show": `usage: sb project show [--project <id>]

shows one project: identity, the repository bindings pointing at it, and the
resolution source. Without --project (or SUBSTRATE_PROJECT) the project is the
one the corrected resolver selects for this checkout, and an uninitialized
checkout fails closed instead of guessing (ADR sbcloseout4 §§4-5).

Advanced/recovery surface only (ADR sbcloseout4 §18): not the normal onboarding
workflow. New repositories start with 'sb init'.`,
  "project.links": `usage: sb project links

lists the local checkout aliases (git root -> project) known to this database,
with the cwd checkout root for comparison. Aliases are a cache: the repository
binding is the authority (ADR sbcloseout4 §13).

Advanced/recovery surface only (ADR sbcloseout4 §18): not the normal onboarding
workflow. New repositories start with 'sb init'.`,
  "project.repair": `usage: sb project repair

recovery: re-establishes the cwd checkout alias from this repository's binding
(the authority), then verifies the checkout resolves to the bound project
through the corrected resolver. Repairs a missing or corrupted local alias;
never creates a binding, never adopts or renames a project, never touches
issues. Without a repository binding it fails closed: run 'sb init'.

Advanced/recovery surface only (ADR sbcloseout4 §18): not the normal onboarding
workflow. New repositories start with 'sb init'.`,
  plan: `usage: sb plan <check|apply> --file <plan.json>

check validates a plan draft; apply executes it.`,
  "plan.check": `usage: sb plan check --file <plan.json> [--project <id>]`,
  "plan.apply": `usage: sb plan apply --file <plan.json> [--project <id>]

validates the draft against the effective project context (ADR §5): every draft
target must belong to it unless --project / SUBSTRATE_PROJECT selects another
Project deliberately.`,
  journal: `usage: sb journal <verb> <ref> [flags]

  append <ref> --kind <checkpoint|handoff|milestone|decision|finding|blocker|result|compaction|note> [--mechanical <file|json>] [--semantic <file|json>] [--result <file|json>] [--refs <file|json>] [--run/--participant/--activation/--session <id>]
  checkpoint <ref> [same flags except --result, plus --workspace/--branch/--base-commit/--head-commit]
  show <ref> [--kind <k>] [--limit <n>]
  since <ref> <cursor>
  latest <ref> [--kind <k>]
  timeline <ref> [--kind <k>] [--limit <n>]
  render <ref> [--sequence <n>]

Methodology: the Journal is Issue-scoped continuity, never authority.
Entries record what happened; they never change the contract, the revision
or readiness. note annotates, finding records a discovered fact, decision
records a chosen course plus rationale, blocker an unresolved condition,
milestone a progress boundary, handoff bounded continuation state, result a
bounded outcome with a versioned payload, checkpoint a resumability
boundary, compaction a conversation checkpoint. Checkpoint and compaction
require a mechanical row; result requires the bounded payload and must not
be appended as a plain note. Reads are bounded: show for bodies, since for
the delta after a cursor, latest/timeline for windows.

Every verb runs over one JournalService; latest/timeline are bounded reads.`,
  "journal.append": `usage: sb journal append <ref> --kind <k> [--mechanical <file|json>] [--semantic <file|json>] [--result <file|json>] [--refs <file|json>] [--project <id>]

--kind result requires a bounded --result payload (summary required).

Methodology: append records continuity, never authority — the revision
never moves and readiness never goes stale. result carries a bounded
execution outcome with an optional result payload and is required for a
meaningful settlement: a progress note or a contract edit must not be used
in place of a result. checkpoint/compaction require the mechanical row;
query with show/since/latest/timeline, and resume from the capsule, not
from a full dump.`,
  "journal.checkpoint": `usage: sb journal checkpoint <ref> [--mechanical <file|json>] [--semantic <file|json>] [--workspace/--branch/--base-commit/--head-commit <v>] [--project <id>]`,
  "journal.show": `usage: sb journal show <ref> [--kind <k>] [--limit <n>]

returns full entry bodies (human prints semantic text; since stays compact).`,
  "journal.since": `usage: sb journal since <ref> <cursor>

cursor read: only entries after the sequence cursor (0 reads all).`,
  "journal.latest": `usage: sb journal latest <ref> [--kind <k>]

newest entry, or the newest entry of the given kind.`,
  "journal.timeline": `usage: sb journal timeline <ref> [--kind <k>] [--limit <n>]

bounded recent window in chronological order (default limit 50).`,
  "journal.render": `usage: sb journal render <ref> [--sequence <n>]

renders the latest (or selected) checkpoint as text.`,
  provenance: `usage: sb provenance <verb>

  dispatch <ref> [--workspace/--participant/--activation/--attempt/--session/--base-commit/--claim-id <v>]
  allocate <binding-id|ref> [--checkpoint <entry-id>]
  bind <receipt-id> <40-char-sha>
  trace <ref> | commit <sha> | receipt <id> | pr <ref>
  session <session-id> | activation <activation-id>
  bundle <ref> [--repo-root <dir>]

Methodology: provenance is the evidence spine, not narration. Dispatch
binds an execution to the Issue revision BEFORE work starts, so a later
contract edit binds anew instead of silently re-authorizing. allocate
creates the host-owned receipt for that binding (optionally pinned to the
journal checkpoint that settles it); bind links it to the commit carrying
the work, idempotently and never re-pointing. Trace reads
the spine (bindings, receipts with artifacts, attestation, claims,
closure); commit/receipt/pr walk it backwards from an external id; session
and activation answer what one session touched or one activation produced.
Record what happened in the Journal and close with cited refs; never edit
the contract to narrate history.`,
  "provenance.dispatch": `usage: sb provenance dispatch <ref> [--workspace <dir>] [--participant/--activation/--attempt/--session/--base-commit <v>] [--claim-id <n>] [--project <id>]`,
  "provenance.trace": `usage: sb provenance trace <ref>

reads the full lineage spine: execution bindings with their pinned
revisions, receipts with artifacts, attestation currency, claims and the
closure view. Human output names each binding's participant, activation and
session and truncates a long spine; --json carries the untruncated spine.
Read-model only: nothing is created, and the revision never moves.
Methodology: trace to verify before dispatch and to audit after close; the
spine shows evidence, the Journal tells the story.`,
  "provenance.commit": `usage: sb provenance commit <40-char-sha>`,
  "provenance.receipt": `usage: sb provenance receipt <id>`,
  "provenance.allocate": `usage: sb provenance allocate <binding-id|ref> [--checkpoint <entry-id>] [--project <id>]

creates the host-owned receipt for an execution binding: revision and
contract hash are copied from the binding row, never from caller input.
--checkpoint links the Journal checkpoint that settles this execution;
omitting it records an explicit null. A ref resolves to that Issue's
latest binding.`,
  "provenance.bind": `usage: sb provenance bind <receipt-id> <40-char-sha>

links the receipt to the commit carrying its work. Idempotent: re-running
with the same SHA is a no-op, and a receipt already bound to another SHA
fails closed instead of silently re-pointing (a deliberate move is
reconcileRewrite, driven by the post-rewrite adapter). The SHA comes from
the caller because only the caller has it; absence is never invented.`,
  "provenance.pr": `usage: sb provenance pr <provider-ref>`,
  "provenance.session": `usage: sb provenance session <session-id>

what did this session touch: issues, bindings, receipts, artifacts, result count.`,
  "provenance.activation": `usage: sb provenance activation <activation-id>

what did this activation produce: issues, bindings, receipts, artifacts.`,
  "provenance.bundle": `usage: sb provenance bundle <ref> [--repo-root <dir>] [--project <id>]`,
  import: `usage: sb import beads --file <export.jsonl> --project <id> [--edges-file <f>] [--create-project <PREFIX:Name>] [--dry-run]`,
  "import.beads": `usage: sb import beads --file <export.jsonl> --project <id> [--edges-file <f>] [--create-project <PREFIX:Name>] [--dry-run]

one-way Beads migration; --dry-run reports counts without mutating.`,
  serve: `usage: sb serve --stdio [--db PATH]

runs the typed service that in-process consumers (Pi, Claude Code, the specialists
service) call over one ssh connection per client process. It is not for people: it
reads newline-delimited JSON requests on stdin and writes one JSON response per
line on stdout, starting with a hello handshake that reports the protocol version,
the server package version and the operations this build supports.

A client on another machine reaches it through ssh, so the store stays on the
machine that owns it. Operations are named calls (issue.get, journal.append,
authority.record, ...); there is no SQL, path or expression operation, by design.`,
  "serve.stdio": `usage: sb serve --stdio [--db PATH]

the service loop: hello, then named operations, one JSON frame per line.
stdout is protocol only; diagnostics go to stderr.`,
  export: `usage: sb export [project] --project <id> [--file <path>]

writes the project snapshot (to --file when given) and prints it.`,
  "export.project": `usage: sb export project --project <id> [--file <path>]`,
};

const HELP_COMMANDS = Object.keys(COMMAND_HELP).filter((k) => k !== "top");

function renderHelp(ctx: Ctx, topic: string[]): CliResult {
  const key = topic.length === 0 ? "top" : topic.length <= 2 ? topic.join(".") : "";
  const text = COMMAND_HELP[key];
  if (!text) {
    return fail(ctx, "help", new Error(topic.length > 2 ? `too many help args: ${topic.join(" ")} (want [group [verb]])` : `unknown help topic: ${topic.join(" ")} (see sb --help)`));
  }
  if (ctx.json) return emit(ctx, "help", { version: cliVersion(), topic: topic.join(" ") || null, text, commands: HELP_COMMANDS });
  return { code: 0, stdout: text + "\n", stderr: "" };
}

function renderVersion(ctx: Ctx): CliResult {
  if (ctx.json) return emit(ctx, "version", { version: cliVersion() });
  return { code: 0, stdout: `sb ${cliVersion()}\n`, stderr: "" };
}

// `sb doctor` (ADR §17): repository identity/binding, the effective project
// and the explicit override are three separate facts. `repository.initialized`
// is a repository_bindings fact — never a successful resolveProject and never
// true because of an override or a checkout alias.
// In remote mode the local store is out of scope: doctor reports the
// connection, the mapping and the capabilities the server actually has, and
// opens nothing (ADR-008: remote mode never touches the stale local database).
function runRemoteDoctor(ctx: Ctx, report: RemoteDoctorReport): CliResult {
  const ok = report.error === null;
  if (ctx.json) {
    return {
      code: ok ? 0 : 1,
      stdout: JSON.stringify({ schema: SCHEMA_VERSION, command: "doctor", ok, ...(ok ? {} : { error: report.error }), data: { mode: "remote", remote: report } }) + "\n",
      stderr: "",
    };
  }
  // The heading states what actually happened, not what was configured: a
  // corrupt config is "remote configured, unusable", and a local override is
  // "local because <reason>". Saying "remote" for either hid the reason.
  const heading =
    report.mode === "ssh"
      ? report.error === null
        ? "sb doctor: remote (no local store is opened in remote mode)\n"
        : "sb doctor: remote configured, unusable (no local store was opened)\n"
      : report.note === null
        ? "sb doctor: local\n"
        : "sb doctor: local (" + report.note + ")\n";
  return {
    code: ok ? 0 : 1,
    stdout: heading + renderRemoteDoctor(report),
    stderr: ok ? "" : `sb: doctor: ${report.error}\n`,
  };
}

// `sb remote <setup|status>`: configuration, not work. Neither verb opens the
// local store; setup observes the server and writes the client config.
function runRemoteGroup(ctx: Ctx, verb: string | undefined, flags: Flags, rest: string[], deps: { env: NodeJS.ProcessEnv; transport?: RemoteTransport }): CliResult {
  if (verb === "disable") {
    if (rest.length > 0) throw new Error("usage: sb remote disable [--json]");
    const result = clearRemoteConfig(deps.env);
    // The environment variable outranks the file, so a disable must say so
    // instead of claiming a mode the next invocation will not use.
    const envOverride = (deps.env["SUBSTRATE_REMOTE"] ?? "").trim();
    const payload = {
      configPath: result.configPath,
      cleared: result.cleared,
      mode: envOverride === "" ? ("local" as const) : ("remote" as const),
      envOverride: envOverride === "" ? null : envOverride,
    };
    const note = envOverride === "" ? "" : `SUBSTRATE_REMOTE=${envOverride} overrides the file, so this process stays remote.`;
    if (ctx.json) return emit(ctx, "remote.disable", { ...payload, warning: note === "" ? null : note });
    return {
      code: 0,
      stdout:
        (result.cleared
          ? `sb remote: disabled (${result.configPath}). Every consumer runs locally again.\n`
          : `sb remote: already local (no remote setting in ${remoteConfigPath(deps.env)}).\n`) + (note === "" ? "" : `sb remote: ${note}\n`),
      stderr: "",
    };
  }
  if (verb === "status") {
    if (rest.length > 0) throw new Error("usage: sb remote status [--json]");
    const report = remoteDoctor({ clientVersion: cliVersion(), env: deps.env, transport: deps.transport });
    if (ctx.json && report.error !== null) return fail(ctx, "remote.status", new Error(report.error));
    if (ctx.json) return emit(ctx, "remote.status", report);
    return {
      code: report.error === null ? 0 : 1,
      stdout: renderRemoteStatus(report),
      stderr: report.error === null ? "" : `sb: remote status: ${report.error}\n`,
    };
  }
  if (verb === "setup") {
    const spec = rest[0];
    if (spec === undefined) throw new Error("usage: sb remote setup ssh:<host> [--server-root PATH] [--refresh] [--json]");
    if (rest.length > 1) throw new Error(`usage: sb remote setup ssh:<host> [--server-root PATH] [--refresh] [--json] (unexpected: ${rest.slice(1).join(" ")})`);
    const result = remoteSetup(spec, { serverRoot: flag(flags, "server-root") ?? null, refresh: flags.has("refresh"), env: deps.env, transport: deps.transport });
    if (ctx.json) return emit(ctx, "remote.setup", result);
    return { code: 0, stdout: renderRemoteSetup(result, result.configPath), stderr: "" };
  }
  throw new Error("usage: sb remote <setup|status> [--json]");
}

function runDoctor(ctx: Ctx): CliResult {
  const repo = discoverRepository();
  const effectiveOverride = (process.env["SUBSTRATE_PROJECT"] ?? "").trim() === "" ? null : process.env["SUBSTRATE_PROJECT"]!.trim();
  let schemaHealthy = false;
  let schemaError: string | null = null;
  let projectCount: number | null = null;
  let initialized = false;
  let baseBranch = repo.baseBranch;
  let project: { id: string; prefix: string; name: string } | null = null;
  let projectError: string | null = null;
  let link: Record<string, unknown> | null = null;
  let linkError: string | null = null;
  try {
    const db = openSubstrate(ctx.dbPath);
    try {
      assertSchemaHealthy(db);
      schemaHealthy = true;
      const count = db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
      projectCount = count.n;
      const svc = new IssueService(db);
      const binding = repo.identity === null ? null : new RepositoryService(db).getBinding(repo.identity.repositoryKey);
      initialized = binding !== null;
      if (binding !== null) {
        baseBranch = binding.baseBranch ?? repo.baseBranch;
        try {
          const bound = svc.getProject(binding.projectId);
          project = { id: bound.id, prefix: bound.prefix, name: bound.name };
        } catch (err) {
          projectError = err instanceof Error ? err.message : String(err);
        }
      }
      try {
        const r = svc.resolveProject({
          env: effectiveOverride ?? undefined,
          gitRoot: repo.gitRoot,
          repositoryKey: repo.identity?.repositoryKey ?? null,
        });
        link = { projectId: r.projectId, source: r.source, gitRoot: repo.gitRoot };
      } catch (err) {
        linkError = err instanceof Error ? err.message : String(err);
        projectError = projectError ?? linkError;
      }
    } finally {
      db.close();
    }
  } catch (err) {
    schemaError = err instanceof Error ? err.message : String(err);
    projectError = "unavailable: schema unhealthy";
    linkError = projectError;
  }
  const data = {
    dbPath: ctx.dbPath,
    schemaHealthy,
    schemaError,
    projects: projectCount,
    gitRoot: repo.gitRoot,
    repository: {
      repositoryKey: repo.identity?.repositoryKey ?? null,
      gitRoot: repo.gitRoot,
      initialized,
      baseBranch,
      identityError: repo.identityError,
    },
    project,
    projectError,
    effectiveOverride,
    link,
    linkError,
  };
  if (ctx.json) {
    return {
      code: schemaHealthy ? 0 : 1,
      stdout: JSON.stringify({ schema: SCHEMA_VERSION, command: "doctor", ok: schemaHealthy, ...(schemaHealthy ? {} : { error: schemaError }), data }) + "\n",
      stderr: "",
    };
  }
  const lines = [
    `sb doctor: ${schemaHealthy ? "healthy" : "UNHEALTHY"}`,
    `state.db: ${ctx.dbPath}`,
    `schema: ${schemaHealthy ? "healthy" : `unhealthy: ${schemaError}`}`,
    `projects: ${projectCount ?? "(unknown)"}`,
    `repository: ${repo.identity?.repositoryKey ?? "(unknown: not a Git checkout)"} (initialized: ${initialized}, base branch: ${baseBranch ?? "(unknown)"})`,
    project !== null
      ? `project: ${project.id} (${project.prefix})${link !== null ? ` [source: ${String(link["source"])}]` : ""}`
      : `project: (none: ${projectError ?? "not initialized"})`,
    effectiveOverride !== null
      ? `effectiveOverride: ${effectiveOverride} (effective context only; the repository stays uninitialized)`
      : "effectiveOverride: (none)",
  ];
  return { code: schemaHealthy ? 0 : 1, stdout: lines.join("\n") + "\n", stderr: schemaHealthy ? "" : `sb: doctor: ${schemaError}\n` };
}

// 'sb init' (ADR §§2, 6, 84): discover -> Git common root -> derive repository
// identity -> detect base branch -> derive/find Project -> bind repository ->
// register the local checkout alias -> verify. Binding, deterministic adoption,
// the collision policy and the alias cache live in
// RepositoryService.bindRepository — this is not CLI recursion into
// `project create` + `project link`, and it never invents identity (ADR §98).
function runInit(db: ReturnType<typeof openSubstrate>, svc: IssueService, ctx: Ctx): CliResult {
  const repo = discoverRepository();
  if (repo.gitRoot === null) throw new Error("not inside a Git repository: cd into the repository checkout and run 'sb init'");
  if (repo.identity === null) {
    throw new Error(
      `cannot derive a repository identity: ${repo.identityError ?? "no canonical remote and no Git common root"}. ` +
        "Configure a canonical 'origin' remote or initialize from inside the repository checkout",
    );
  }
  const repos = new RepositoryService(db);
  const result = repos.bindRepository({
    identity: repo.identity,
    commonRoot: repo.gitRoot,
    baseBranch: repo.baseBranch,
  });
  const binding = repos.getBinding(repo.identity.repositoryKey);
  if (binding === null) {
    throw new Error(`repository binding verification failed for ${repo.identity.repositoryKey}: re-run \`sb init\``);
  }
  // Verify the bound project resolves through the normal authority path.
  const resolved = svc.resolveProject({ gitRoot: repo.gitRoot, repositoryKey: repo.identity.repositoryKey });
  if (resolved.projectId !== binding.projectId) {
    throw new Error(
      `repository binding verification failed: ${repo.identity.repositoryKey} resolves to ${resolved.projectId}, not ${binding.projectId}`,
    );
  }
  const project = svc.getProject(binding.projectId);
  const data = {
    repository: {
      repositoryKey: repo.identity.repositoryKey,
      canonicalRemote: repo.identity.canonicalRemote,
      local: repo.identity.local,
      gitRoot: repo.gitRoot,
    },
    project: { id: project.id, prefix: project.prefix, name: project.name },
    baseBranch: binding.baseBranch,
    created: result.created,
    adopted: result.adopted,
    idempotent: result.idempotent,
  };
  if (ctx.json) return emit(ctx, "init", data);
  const lines = [
    `sb init: repository ${repo.identity.repositoryKey}`,
    `  git root: ${repo.gitRoot}`,
    `  project: ${project.id} (${project.prefix})`,
    `  base branch: ${binding.baseBranch ?? "(unknown)"}`,
    `  binding: created=${result.created} adopted=${result.adopted} idempotent=${result.idempotent}`,
  ];
  return { code: 0, stdout: lines.join("\n") + "\n", stderr: "" };
}

// -- entry -------------------------------------------------------------------

// Fail-closed flag validation (xtrm-7wc.5.4): parseArgs accepts any --flag
// shape, so each command declares its allowlist here. An unknown flag
// names the offender instead of silently dropping operator intent.
const GLOBAL_FLAGS = ["db", "json"];

const FLAG_ALLOWLIST: Record<string, string[]> = {
  "serve.stdio": ["stdio"],
  "issue.create": ["project", "title", "kind", "contract", "parent", "priority", "scrutiny"],
  "issue.show": [],
  "issue.edit": ["project", "contract", "title", "priority", "scrutiny", "ownership", "context-refs", "expected-revision"],
  "issue.note": ["project", "kind", "file", "result"],
  "issue.validate": [],
  "issue.attest": ["project", "outcome", "policy", "attested-by", "evidence-refs", "blocking-gaps"],
  "issue.list": ["project"],
  "issue.ready": ["project"],
  "issue.query": ["project", "limit", "cursor", "lifecycle", "kind", "readiness", "search"],
  "issue.tree": ["project", "root"],
  "issue.children": [],
  "issue.relate": ["project", "from", "to", "kind"],
  "issue.unrelate": ["project", "from", "to", "kind"],
  "issue.claim": ["project", "holder", "ttl-ms", "activation"],
  "issue.release": ["project", "holder", "activation"],
  "issue.close": ["project", "outcome", "reason", "actor", "participant", "run", "activation", "attempt", "result", "receipt", "validation", "artifact"],
  "issue.state": ["project", "until"],
  "issue.reopen": ["project", "reason", "actor", "participant", "run", "activation", "attempt"],
  "issue.defer": ["project", "until"],
  "issue.cancel": ["project", "outcome", "reason", "actor", "participant", "run", "activation", "attempt", "result", "receipt", "validation", "artifact"],
  "issue.archive": ["project"],
  "issue.resume": [],
  "project.create": ["prefix", "name", "id"],
  "project.link": ["project"],
  "project.unlink": [],
  "project.list": [],
  "project.show": ["project"],
  "project.links": [],
  "project.repair": [],
  "plan.check": ["project", "file"],
  "plan.apply": ["project", "file"],
  "journal.append": ["project", "kind", "run", "participant", "activation", "session", "mechanical", "semantic", "result", "refs"],
  "journal.checkpoint": ["project", "run", "participant", "activation", "session", "mechanical", "semantic", "refs", "workspace", "branch", "base-commit", "head-commit"],
  "journal.show": ["kind", "limit"],
  "journal.since": [],
  "journal.latest": ["kind"],
  "journal.timeline": ["kind", "limit"],
  "journal.render": ["sequence"],
  "provenance.dispatch": ["project", "claim-id", "workspace", "participant", "activation", "attempt", "session", "base-commit"],
  "provenance.allocate": ["project", "checkpoint"],
  "provenance.bind": [],
  "provenance.trace": [],
  "provenance.commit": [],
  "provenance.receipt": [],
  "provenance.pr": [],
  "provenance.session": [],
  "provenance.activation": [],
  "provenance.bundle": ["project", "repo-root"],
  "init.": [],
  "recall": ["source", "since", "limit", "index"],
  "recall-build": ["index", "rebuild", "load-gate"],
  "doctor": [],
  "remote.setup": ["server-root", "refresh"],
  "remote.disable": [],
  "remote.status": [],
  "import.beads": ["file", "project", "edges-file", "create-project", "dry-run"],
  "export.": ["project", "file"],
  "export.project": ["project", "file"],
};

const KNOWN_GROUPS = new Set(["init", "issue", "project", "plan", "journal", "provenance", "import", "export", "recall", "recall-build", "remote", "serve"]);

function assertKnownFlags(flags: Flags, command: string): void {
  const allowed = new Set([...GLOBAL_FLAGS, ...(FLAG_ALLOWLIST[command] ?? [])]);
  for (const name of flags.keys()) {
    if (!allowed.has(name)) throw new Error(`unknown flag --${name} for \`${command}\` (see usage)`);
  }
}

export function runCli(argv: string[], opts?: { dbPath?: string; env?: NodeJS.ProcessEnv; transport?: RemoteTransport; readStdin?: () => string }): CliResult {
  // env/transport are injection seams for tests and embedding; production
  // callers pass neither.
  const remoteDeps = { env: opts?.env ?? process.env, transport: opts?.transport };
  const { flags, positionals } = parseArgs(argv);
  const ctx: Ctx = {
    // The injected env is authoritative here, exactly as it is for the remote
    // decision: a caller that passes env expects that env's store.
    dbPath: flag(flags, "db") ?? opts?.dbPath ?? remoteDeps.env["SUBSTRATE_DB"] ?? join(homedir(), ".xtrm", "state.db"),
    json: flags.has("json"),
  };
  const [group, verb, ...rest] = positionals;
  const command = group && verb ? `${group}.${verb}` : (group ?? "");
  // Side-effect-free surface (§28): help/version never open SQLite.
  if (flags.has("help") || group === "help") return renderHelp(ctx, flags.has("help") ? positionals : positionals.slice(1));
  if (flags.has("version") || group === "version") return renderVersion(ctx);
  // Remote mode (ADR-008): the invocation runs on the server, and this is
  // decided before the local store is opened, so a stale local database can
  // never absorb a remote-mode write.
  // One decision for every remote consumer in this process: an explicit local
  // store (the caller's dbPath, --db, or SUBSTRATE_DB) outranks remote mode.
  const localStore = opts?.dbPath !== undefined ? "--db " + opts.dbPath + " (caller)" : localStoreRequested(argv, remoteDeps.env);
  const forwarded = forwardCli(argv, { ...remoteDeps, readStdin: opts?.readStdin, localStore });
  if (forwarded !== null) return forwarded;
  // Recall never opens state.db: the query path opens only the FTS file
  // read-only, and the indexer opens the store read-only itself.
  if (group === "recall" || group === "recall-build") {
    try {
      if (group === "recall") {
        return runRecall(ctx, flags, [verb, ...rest].filter((part): part is string => part !== undefined));
      }
      if (verb !== undefined) throw new Error("usage: sb recall-build [--db PATH] [--index PATH] [--rebuild] [--load-gate N] [--json]");
      assertKnownFlags(flags, "recall-build");
      return runRecallBuild(ctx, flags);
    } catch (err) {
      return fail(ctx, group, err);
    }
  }
  let db: ReturnType<typeof openSubstrate> | null = null;
  try {
    if (group === "doctor") {
      assertKnownFlags(flags, "doctor");
      if (verb !== undefined) throw new Error("usage: sb doctor [--db PATH] [--json] (doctor takes no verbs)");
      const remote = remoteDoctor({
        clientVersion: cliVersion(),
        env: remoteDeps.env,
        transport: remoteDeps.transport,
        localStore,
      });
      // A configured-but-corrupt remote is an error to report, not a silent
      // fallback to the local store.
      if (remote.mode === "ssh" || remote.error !== null) return runRemoteDoctor(ctx, remote);
      const local = runDoctor(ctx);
      // A deliberate local override still prints the local report, and says why
      // remote mode was not consulted. In --json mode the envelope is machine
      // output and the note goes to stderr instead of corrupting it.
      if (remote.note === null) return local;
      return ctx.json
        ? { ...local, stderr: local.stderr + `note: ${remote.note}\n` }
        : { ...local, stdout: local.stdout + `note: ${remote.note}\n` };
    }
    if (group === "remote") return runRemoteGroup(ctx, verb, flags, rest, remoteDeps);
    if (group === "serve") {
      // `--stdio` is a flag, `stdio` is the verb form: both name the same loop.
      const stdio = flags.has("stdio") || verb === "stdio";
      assertKnownFlags(flags, "serve.stdio");
      if (!stdio || (verb !== undefined && verb !== "stdio")) throw new Error("usage: sb serve --stdio [--db PATH]");
      // The service loop is async (an operation such as journal.checkpoint awaits
      // a summarizer), so the command returns at once and the loop owns the
      // process: it sets the exit code when it reaches EOF. No `process.exit`
      // here: that would cut an answer that is still being written.
      void serveStdio({ dbPath: ctx.dbPath, version: cliVersion() }).then(
        (code) => {
          process.exitCode = code;
        },
        (error: unknown) => {
          process.stderr.write(`sb serve: ${error instanceof Error ? error.message : String(error)}\n`);
          process.exitCode = 1;
        },
      );
      return { code: 0, stdout: "", stderr: "" };
    }
    if (!group || (!verb && group !== "export" && group !== "init")) throw new Error("usage: sb [--db PATH] [--json] <init|issue|project|plan|journal|provenance|import|export|remote|serve> <verb> [args...]");
    if (group && KNOWN_GROUPS.has(group)) assertKnownFlags(flags, `${group}.${verb ?? ""}`);
    db = openSubstrate(ctx.dbPath);
    const svc = new IssueService(db);
    if (group === "init") {
      if (verb !== undefined) throw new Error("usage: sb init [--db PATH] [--json] (init takes no verbs)");
      return runInit(db, svc, ctx);
    }
    if (group === "issue") return runIssue(db, svc, ctx, command, verb, flags, rest);
    if (group === "project") return runProject(db, svc, ctx, command, verb, flags);
    if (group === "plan") return runPlan(db, svc, ctx, command, verb, flags);
    if (group === "journal" || group === "provenance") {
      const result = group === "journal"
        ? runJournal(db, svc, ctx, command, verb, flags, rest)
        : runProvenance(db, svc, ctx, command, verb, flags, rest);
      const explicit = flag(flags, "session")?.trim();
      const ambient = process.env["XTRM_SESSION_ID"]?.trim();
      // XTRM-450: report successful explicit overrides without changing JSON stdout.
      if (result.code === 0 && explicit && ambient && explicit.toLowerCase() !== ambient.toLowerCase()) {
        result.stderr += `warning: --session ${JSON.stringify(explicit)} overrides XTRM_SESSION_ID ${JSON.stringify(ambient)}\n`;
      }
      return result;
    }
    if (group === "import") return runImport(db, svc, ctx, command, verb, flags);
    if (group === "export") return runExport(db, svc, ctx, command, verb, flags);
    throw new Error(`unknown group: ${group} (want issue|project|plan|journal|provenance|import|export|remote)`);
  } catch (err) {
    return fail(ctx, command, err);
  } finally {
    try {
      db?.close();
    } catch {
      /* close must not mask the result */
    }
  }
}

// Effective project context (ADR §4): explicit flag > SUBSTRATE_PROJECT >
// initialized repository identity > explicit checkout link > fail closed.
function projectOf(svc: IssueService, flags: Flags): string {
  const repo = discoverRepository();
  return svc.resolveProject({
    explicit: flag(flags, "project") ?? undefined,
    env: process.env["SUBSTRATE_PROJECT"],
    gitRoot: repo.gitRoot,
    repositoryKey: repo.identity?.repositoryKey ?? null,
  }).projectId;
}

// Ref-scoped mutation guard (ADR §5): the effective context must resolve and
// the ref must belong to it. `--project <other>` keeps deliberate
// cross-project work possible (ADR §16).
function refInContext(svc: IssueService, flags: Flags, ref: string): ResolvedIssue {
  return svc.resolveRefInProject(ref, projectOf(svc, flags));
}

function needRef(rest: string[]): string {
  if (!rest[0]) throw new Error("an issue ref is required (machine ID, durable reference, locator, historical locator, or alias)");
  return rest[0];
}

// --until parsing shared by `issue state` and `issue defer`: a millisecond
// timestamp sets the deferral, "clear" removes it, absence leaves it alone.
function applyDeferUntil(svc: IssueService, issueId: string, raw: string | undefined): void {
  if (raw === undefined) return;
  if (raw === "clear") {
    svc.setDeferral(issueId, null);
    return;
  }
  const ts = Number(raw);
  if (!Number.isInteger(ts) || ts < 0) throw new Error("--until must be a non-negative integer millisecond timestamp or \"clear\"");
  svc.setDeferral(issueId, ts);
}

// Closure flag helpers (C1, ADR §96): the canonical close/reopen/cancel
// surface. Any closure-scoped flag opts into the Closure path; bare verbs
// stay legacy lifecycle aliases.
const CLOSURE_FLAGS = ["outcome", "reason", "actor", "participant", "run", "activation", "attempt", "result", "receipt", "validation", "artifact"];

function hasClosureFlags(flags: Flags): boolean {
  return CLOSURE_FLAGS.some((f) => flags.has(f));
}

// Comma-separated ref lists (--result a,b --receipt c). Each occurrence is
// split on commas and every occurrence is kept in caller order, so
// `--artifact a --artifact b,c` yields [a, b, c] (XTRM-552). Absence stays
// absent (never invented).
function splitList(raw: string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const out = raw.flatMap((s) => s.split(",")).map((s) => s.trim()).filter((s) => s.length > 0);
  return out;
}

// Runtime-known identity binds automatically through the X1 envelope:
// explicit typed flags plus the R4 env session. --session is deliberately
// absent: session identity is runtime-known (XTRM_SESSION_ID), never a
// CLI-invented label (§98).
function closeEnvelope(flags: Flags): ReturnType<typeof enrichExecutionContext> {
  const activation = flag(flags, "activation");
  const attempt = flag(flags, "attempt");
  const actor = flag(flags, "actor");
  return enrichExecutionContext({
    actor: actor ? { type: "human", name: actor } : null,
    participantId: flag(flags, "participant") ?? null,
    runId: flag(flags, "run") ?? null,
    specialist: activation || attempt ? { activationId: activation ?? null, attemptId: attempt ?? null } : null,
  });
}

function closurePayload(c: {
  closureId: string; issueId: string; issueRevision: number; contractHash: string;
  terminalState: string; outcome: string; reason: string; actor: string;
  executionContext: unknown; validationRefs: string[]; journalResultRefs: string[];
  receiptRefs: string[]; artifactRefs: string[]; closedAt: number;
}): Record<string, unknown> {
  return {
    closureId: c.closureId,
    issueId: c.issueId,
    issueRevision: c.issueRevision,
    contractHash: c.contractHash,
    terminalState: c.terminalState,
    outcome: c.outcome,
    reason: c.reason,
    actor: c.actor,
    executionContext: c.executionContext,
    validationRefs: c.validationRefs,
    journalResultRefs: c.journalResultRefs,
    receiptRefs: c.receiptRefs,
    artifactRefs: c.artifactRefs,
    closedAt: c.closedAt,
  };
}

function runIssue(
  db: ReturnType<typeof openSubstrate>,
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string,
  flags: Flags,
  rest: string[],
): CliResult {
  switch (verb) {
    case "create": {
      const project = projectOf(svc, flags);
      const title = flag(flags, "title") ?? (() => { throw new Error("--title is required"); })();
      const kind = flag(flags, "kind") ?? (() => { throw new Error("--kind is required"); })();
      const contractRaw = flag(flags, "contract") ?? (() => { throw new Error("--contract <file|json> is required"); })();
      const parent = flag(flags, "parent");
      const parsedContract = readJsonArg(contractRaw) as unknown;
      // SCRUTINY precedence (fail closed, never a silently-broken draft): an
      // explicit --scrutiny wins; otherwise the contract file's own scrutiny
      // applies as the default. Read the key before the shape assertion so a
      // malformed contract still reports the contract error, not scrutiny.
      const contractScrutiny =
        typeof parsedContract === "object" && parsedContract !== null && !Array.isArray(parsedContract)
          ? (parsedContract as Record<string, unknown>)["scrutiny"]
          : undefined;
      assertContractShape(parsedContract);
      const flagScrutiny = flag(flags, "scrutiny");
      const scrutiny = flagScrutiny ?? (contractScrutiny === undefined ? undefined : contractScrutiny);
      if (!isValidScrutiny(scrutiny)) {
        throw new Error(
          scrutiny === undefined
            ? `scrutiny is required: pass --scrutiny <level> or carry scrutiny in the contract; must be one of ${SCRUTINY_LEVELS.join(", ")}`
            : `invalid scrutiny ${JSON.stringify(scrutiny)}: must be one of ${SCRUTINY_LEVELS.join(", ")}`,
        );
      }
      const issue = svc.createIssue({
        projectId: project,
        title,
        kind: kind as never,
        contract: parsedContract,
        priority: flag(flags, "priority") !== undefined ? Number(flag(flags, "priority")) : undefined,
        scrutiny,
        parentId: parent ? svc.resolveRefInProject(parent, project).id : undefined,
        authoredBy: "sb-cli",
      });
      return emit(ctx, command, issueSummary(svc.getIssue(issue.id)));
    }
    case "show": {
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const readiness = svc.getReadiness(resolved.id);
      const contract = svc.getRevision(resolved.id, resolved.currentRevision).contract;
      // Bounded operational context (ADR §50): every read is bounded, so a
      // large journal never enlarges the default show output.
      const operationalContext = new JournalService(db, svc).operationalContext(resolved.id);
      const payload = {
        ...issueSummary(resolved),
        contractHash: resolved.currentContractHash,
        contract,
        readinessState: readiness.state,
        dispatchable: readiness.dispatchable,
        reasons: readiness.reasons,
        attestation: svc.latestAttestation(resolved.id),
        claim: svc.getActiveClaim(resolved.id),
        provenance: provenanceSummary(svc, resolved.id),
        closure: closureSummary(db, svc, resolved),
        operationalContext,
      };
      if (ctx.json) return emit(ctx, command, payload);
      return {
        code: 0,
        stdout:
          [human(issueSummary(resolved)), ...contractSections(contract), ...renderOperationalContext(operationalContext)].join("\n") +
          "\n",
        stderr: "",
      };
    }
    case "edit": {
      // §24 classification: title/priority are metadata (no revision,
      // readiness retained); contract/ownership/context-refs/scrutiny are
      // execution-relevant (new revision, readiness invalidated). At least
      // one mutation flag is required.
      const ref = needRef(rest);
      const contractRaw = flag(flags, "contract");
      const title = flag(flags, "title");
      const priorityRaw = flag(flags, "priority");
      const scrutiny = flag(flags, "scrutiny");
      const ownershipRaw = flag(flags, "ownership");
      const contextRaw = flag(flags, "context-refs");
      if (
        contractRaw === undefined &&
        title === undefined &&
        priorityRaw === undefined &&
        scrutiny === undefined &&
        ownershipRaw === undefined &&
        contextRaw === undefined
      ) {
        throw new Error("nothing to edit: pass --contract, --title, --priority, --scrutiny, --ownership, or --context-refs");
      }
      const resolved = refInContext(svc, flags, ref);
      let id = resolved.id;
      let revisionCreated = false;
      if (title !== undefined) {
        id = svc.setTitle(id, title).id;
      }
      if (priorityRaw !== undefined) {
        const priority = Number(priorityRaw);
        if (!Number.isInteger(priority)) throw new Error("--priority must be an integer");
        id = svc.setPriority(id, priority).id;
      }
      const expected = flag(flags, "expected-revision");
      if (contractRaw !== undefined || ownershipRaw !== undefined || contextRaw !== undefined) {
        const base =
          contractRaw !== undefined
            ? (readJsonArg(contractRaw) as never)
            : (svc.getRevision(id, svc.getIssue(id).currentRevision).contract as never);
        const { issue, created } = svc.updateContract(id, base, "sb-cli", {
          expectedRevision: expected !== undefined ? Number(expected) : undefined,
          ownership: ownershipRaw !== undefined ? readJsonArg(ownershipRaw) : undefined,
          contextRefs: contextRaw !== undefined ? (readJsonArg(contextRaw) as unknown[]) : undefined,
        });
        id = issue.id;
        revisionCreated = revisionCreated || created;
      }
      if (scrutiny !== undefined) {
        const before = svc.getIssue(id).currentRevision;
        const next = svc.setScrutiny(id, scrutiny);
        revisionCreated = revisionCreated || next.currentRevision !== before;
        id = next.id;
      }
      return emit(ctx, command, { ...issueSummary(svc.getIssue(id)), revisionCreated });
    }
    case "note": {
      // §22 convenience over JournalService: append-only, no revision bump.
      // A Journal entry never becomes authority and never touches the contract.
      const ref = needRef(rest);
      const kindRaw = flag(flags, "kind") ?? "note";
      const NOTE_KINDS = ["note", "finding", "decision", "blocker", "milestone", "handoff", "result"] as const;
      if (!(NOTE_KINDS as readonly string[]).includes(kindRaw)) {
        throw new Error(`unknown note kind: ${kindRaw} (want ${NOTE_KINDS.join("|")})`);
      }
      const file = flag(flags, "file");
      const positionalText = rest.slice(1).join(" ");
      let text: string;
      if (file !== undefined) {
        if (positionalText.trim() !== "") throw new Error("pass text or --file, not both");
        text = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
      } else {
        text = positionalText;
      }
      if (text.trim() === "") throw new Error('a note text is required (positional "text" or --file <path|->)');
      const resolved = refInContext(svc, flags, ref);
      const journal = new JournalService(db, svc);
      const resultRaw = flag(flags, "result");
      let result: ResultPayload | undefined;
      if (resultRaw !== undefined) {
        const parsed = readJsonArg(resultRaw) as ResultPayload;
        assertResultPayload(parsed);
        result = parsed;
      } else if (kindRaw === "result") {
        // Text is the bounded result summary; structured fields stay optional.
        result = { summary: text };
      }
      if (kindRaw !== "result" && result !== undefined) {
        throw new Error("--result is only meaningful with --kind result");
      }
      const entry = journal.appendEntry(resolved.id, {
        kind: kindRaw as JournalKind,
        semantic: kindRaw === "result" ? undefined : { summary: text },
        result,
      });
      if (ctx.json) return emit(ctx, command, { ...journalSummary(entry), result: entry.result });
      return { code: 0, stdout: journalLine(svc, entry) + "\n", stderr: "" };
    }
    case "validate": {
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const r = svc.getReadiness(resolved.id);
      return emit(ctx, command, {
        issueId: r.issueId,
        revision: r.revision,
        state: r.state,
        dispatchable: r.dispatchable,
        reasons: r.reasons,
        structurallyValid: r.structurallyValid,
        attestationCurrent: r.attestationCurrent,
        unsatisfiedBlockers: r.unsatisfiedBlockers,
      });
    }
    case "attest": {
      const ref = needRef(rest);
      const outcome = flag(flags, "outcome") ?? (() => { throw new Error("--outcome <ready|reject> is required"); })();
      const policy = flag(flags, "policy") ?? (() => { throw new Error("--policy is required"); })();
      const attestedBy = flag(flags, "attested-by") ?? (() => { throw new Error("--attested-by is required"); })();
      const list = (name: string): string[] | undefined => {
        const raw = flag(flags, name);
        if (raw === undefined) return undefined;
        return String(raw).split(",").map((e) => e.trim()).filter((e) => e.length > 0);
      };
      const resolved = refInContext(svc, flags, ref);
      const attestation = svc.attestReadiness(resolved.id, {
        outcome: outcome as never,
        policy,
        attestedBy,
        evidenceRefs: list("evidence-refs"),
        blockingGaps: list("blocking-gaps"),
      });
      return emit(ctx, command, {
        id: attestation.id,
        issueId: attestation.issueId,
        issueRevision: attestation.issueRevision,
        outcome: attestation.outcome,
        policy: attestation.policy,
        attestedBy: attestation.attestedBy,
      });
    }
    case "list": {
      // Bounded board read (XTRM-393): queryAllIssues walks every page of
      // the board projection, so the output stays exhaustive while the
      // per-issue reads disappear. issueSummary below keeps the 7-key shape.
      const project = projectOf(svc, flags);
      return emit(ctx, command, svc.queryAllIssues({ project }).map((r) => issueSummary(boardRowSummaryInput(r))));
    }
    case "ready": {
      // deriveReadiness sets dispatchable = state === "ready", so selecting
      // readiness: ["ready"] rows is exactly what getReadiness(id).dispatchable
      // selects today. queryAllIssues keeps the walk exhaustive.
      const project = projectOf(svc, flags);
      return emit(
        ctx,
        command,
        // r.dispatchable, never a literal: the filter already selects ready rows, but
        // a literal would silently disagree if the derivation ever changed (XTRM-545 F2).
        svc
          .queryAllIssues({ project, readiness: ["ready"] })
          .map((r) => readySummary(boardRowSummaryInput(r), r.readinessState, r.dispatchable)),
      );
    }
    case "query": {
      // Paged board read (XTRM-393): emits the IssueBoardPage unchanged
      // (rows/nextCursor/hasMore/scanned/truncated). Human mode renders the
      // rows only; the full envelope is one --json flag away.
      const project = projectOf(svc, flags);
      const list = (name: string): string[] | undefined => {
        const raw = flag(flags, name);
        if (raw === undefined) return undefined;
        return String(raw).split(",").map((e) => e.trim()).filter((e) => e.length > 0);
      };
      const page = svc.queryIssues({
        project,
        limit: flag(flags, "limit") !== undefined ? Number(flag(flags, "limit")) : undefined,
        cursor: flag(flags, "cursor"),
        lifecycle: (list("lifecycle") ?? undefined) as LifecycleState[] | undefined,
        kind: (list("kind") ?? undefined) as IssueKind[] | undefined,
        readiness: (list("readiness") ?? undefined) as OperationalState[] | undefined,
        search: flag(flags, "search") ?? undefined,
      });
      if (ctx.json) return emit(ctx, command, page);
      return emit(ctx, command, page.rows.map((r) => readySummary(boardRowSummaryInput(r), r.readinessState, r.dispatchable)));
    }
    case "tree": {
      const root = flag(flags, "root");
      const project = root ? undefined : projectOf(svc, flags);
      if (root) return emit(ctx, command, treeSummary(svc, svc.resolveRef(root).id));
      if (!project) throw new Error("--project or --root is required");
      const roots = svc.listIssues(project).filter((i) => svc.getParent(i.id) === null);
      return emit(ctx, command, roots.map((r) => treeSummary(svc, r.id)));
    }
    case "children": {
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      return emit(ctx, command, svc.listChildren(resolved.id).map(issueSummary));
    }
    case "relate": {
      const from = flag(flags, "from") ?? (() => { throw new Error("--from <ref> is required"); })();
      const to = flag(flags, "to") ?? (() => { throw new Error("--to <ref> is required"); })();
      const kind = flag(flags, "kind") ?? (() => { throw new Error("--kind is required"); })();
      if (kind === "parent_child") throw new Error("parent_child is structural: reparenting is not exposed over relate in v0");
      const context = projectOf(svc, flags);
      const edge = svc.addEdge(svc.resolveRefInProject(from, context).id, svc.resolveRefInProject(to, context).id, kind as never);
      return emit(ctx, command, { id: edge.id, kind: edge.kind, from: edge.fromIssue, to: edge.toIssue });
    }
    case "unrelate": {
      const from = flag(flags, "from") ?? (() => { throw new Error("--from <ref> is required"); })();
      const to = flag(flags, "to") ?? (() => { throw new Error("--to <ref> is required"); })();
      const kind = flag(flags, "kind") ?? (() => { throw new Error("--kind is required"); })();
      if (kind === "parent_child") throw new Error("parent_child is structural: reparenting is not exposed over unrelate in v0");
      const context = projectOf(svc, flags);
      const removed = svc.removeEdgeByEndpoints(svc.resolveRefInProject(from, context).id, svc.resolveRefInProject(to, context).id, kind as never);
      return emit(ctx, command, { edge: removed.edge, kind: removed.kind });
    }
    case "claim": {
      const ref = needRef(rest);
      // The holder comes from --holder, else the ambient SUBSTRATE_HOLDER the
      // xt launcher exported for this session (XTRM-722); neither is a silent
      // default, so a session without identity still fails closed.
      const holder = resolveClaimHolder(flag(flags, "holder"));
      const ttl = flag(flags, "ttl-ms");
      const resolved = refInContext(svc, flags, ref);
      const claim = svc.claimIssue(resolved.id, holder.holder, {
        activationId: flag(flags, "activation"),
        ttlMs: ttl !== undefined ? Number(ttl) : undefined,
      });
      return emit(ctx, command, {
        issueId: claim.issueId,
        holder: claim.holder,
        holderSource: holder.source,
        expiresAt: claim.expiresAt,
        generation: claim.generation,
      });
    }
    case "release": {
      const ref = needRef(rest);
      // Same rule as claim: a session releases its own lease without restating
      // the name. Releasing another holder's claim still needs it, and the
      // service keeps today's checks either way.
      const holder = resolveClaimHolder(flag(flags, "holder"));
      const resolved = refInContext(svc, flags, ref);
      const released = svc.releaseClaim(resolved.id, holder.holder, { activationId: flag(flags, "activation") });
      return emit(ctx, command, { released: released !== null, holder: holder.holder, holderSource: holder.source });
    }
    case "state": {
      // §26 canonical lifecycle operation. --until sets/clears the
      // deferral timestamp alongside the state transition.
      const ref = needRef(rest);
      const to = (rest[1] ?? (() => { throw new Error("a lifecycle state is required: open|deferred|done|cancelled|archived"); })()).toLowerCase();
      const STATES = ["open", "deferred", "done", "cancelled", "archived"] as const;
      if (!(STATES as readonly string[]).includes(to)) {
        throw new Error(`unknown lifecycle state: ${rest[1]} (want open|deferred|done|cancelled|archived)`);
      }
      const resolved = refInContext(svc, flags, ref);
      const moved = svc.setLifecycleState(resolved.id, to as (typeof STATES)[number]);
      applyDeferUntil(svc, moved.id, flag(flags, "until"));
      return emit(ctx, command, issueSummary(svc.getIssue(moved.id)));
    }
    case "close": {
      // Canonical first-class close (C1, ADR §96): with --outcome/--reason
      // this writes an immutable Closure row (outcome, reason, actor,
      // session, revision/hash, refs) and rests on done (cancelled for
      // the cancelled outcome). Bare `close <ref>` stays the legacy
      // lifecycle alias (no Closure invented) so existing flows keep working.
      const ref = needRef(rest);
      const resolved = refInContext(svc, flags, ref);
      if (!hasClosureFlags(flags)) {
        const closed = svc.setLifecycleState(resolved.id, "done");
        return emit(ctx, command, issueSummary(closed));
      }
      const outcomeRaw = flag(flags, "outcome") ?? (() => { throw new Error(`--outcome is required (want ${CLOSURE_OUTCOMES.join("|")})`); })();
      if (!isClosureOutcome(outcomeRaw)) throw new Error(`unknown closure outcome: ${outcomeRaw} (want ${CLOSURE_OUTCOMES.join("|")})`);
      const reason = flag(flags, "reason") ?? (() => { throw new Error("--reason is required: the close reason lives in the Closure row, never only in git log (§43)"); })();
      const closures = new ClosureService(db, svc);
      const closure = closures.closeIssue(resolved.id, {
        outcome: outcomeRaw,
        reason,
        actor: flag(flags, "actor") ?? "sb-cli",
        executionContext: closeEnvelope(flags),
        validationRefs: splitList(flagList(flags, "validation")),
        journalResultRefs: splitList(flagList(flags, "result")),
        receiptRefs: splitList(flagList(flags, "receipt")),
        artifactRefs: splitList(flagList(flags, "artifact")),
      });
      return emit(ctx, command, { ...issueSummary(svc.getIssue(resolved.id)), closure: closurePayload(closure) });
    }
    case "reopen": {
      // Canonical reopen (C1, ADR §45): with --reason this keeps every
      // historical Closure row untouched, appends a reopen event, and
      // restores lifecycle state to open. Bare `reopen <ref>` stays the
      // legacy lifecycle alias.
      const ref = needRef(rest);
      const resolved = refInContext(svc, flags, ref);
      if (flag(flags, "reason") === undefined && !hasClosureFlags(flags)) {
        return emit(ctx, command, issueSummary(svc.setLifecycleState(resolved.id, "open")));
      }
      const reason = flag(flags, "reason") ?? (() => { throw new Error("--reason is required: reopening appends a durable reopen event"); })();
      const closures = new ClosureService(db, svc);
      const reopened = closures.reopenIssue(resolved.id, {
        reason,
        actor: flag(flags, "actor"),
        executionContext: closeEnvelope(flags),
      });
      return emit(ctx, command, { ...issueSummary(svc.getIssue(reopened.issueId)), reopened: reopened.lifecycleState });
    }
    case "defer": {
      const ref = needRef(rest);
      const resolved = refInContext(svc, flags, ref);
      const moved = svc.setLifecycleState(resolved.id, "deferred");
      applyDeferUntil(svc, moved.id, flag(flags, "until"));
      return emit(ctx, command, issueSummary(svc.getIssue(moved.id)));
    }
    case "cancel": {
      // Canonical issue cancellation (C1, ADR §§42, 46): with --reason
      // this writes a terminal Closure with the cancelled outcome resting
      // on the cancelled lifecycle state. Stopping one execution is NOT
      // this verb — release the claim (`sb issue release`) instead, which
      // leaves lifecycle and Closure untouched. Bare `cancel <ref>` stays
      // the legacy lifecycle alias.
      const ref = needRef(rest);
      const resolved = refInContext(svc, flags, ref);
      if (!hasClosureFlags(flags)) {
        return emit(ctx, command, issueSummary(svc.setLifecycleState(resolved.id, "cancelled")));
      }
      const outcomeRaw = flag(flags, "outcome");
      if (outcomeRaw !== undefined && outcomeRaw !== "cancelled") {
        throw new Error(`cancel carries the cancelled outcome, not ${outcomeRaw} (want cancelled)`);
      }
      const reason = flag(flags, "reason") ?? (() => { throw new Error("--reason is required: the cancellation reason lives in the Closure row, never only in git log (§43)"); })();
      const closures = new ClosureService(db, svc);
      const closure = closures.cancelIssue(resolved.id, {
        reason,
        actor: flag(flags, "actor") ?? "sb-cli",
        executionContext: closeEnvelope(flags),
        validationRefs: splitList(flagList(flags, "validation")),
        journalResultRefs: splitList(flagList(flags, "result")),
        receiptRefs: splitList(flagList(flags, "receipt")),
        artifactRefs: splitList(flagList(flags, "artifact")),
      });
      return emit(ctx, command, { ...issueSummary(svc.getIssue(resolved.id)), closure: closurePayload(closure) });
    }
    case "archive": {
      const ref = needRef(rest);
      const resolved = refInContext(svc, flags, ref);
      return emit(ctx, command, issueSummary(svc.setLifecycleState(resolved.id, "archived")));
    }
    case "resume": {
      // High-level continuity operation (§21): derived capsule, never a
      // mutable source of truth. Root epics aggregate children by
      // reference; transcripts stay out (§22).
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const journal = new JournalService(db, svc);
      const resume = new ResumeService(db, svc, journal, { external: new IntegrationService(db, svc) });
      const capsule = resume.buildCapsule(resolved.id);
      if (ctx.json) return emit(ctx, command, capsule);
      return { code: 0, stdout: resume.renderCapsule(capsule) + "\n", stderr: "" };
    }
    default:
      throw new Error(`unknown issue verb: ${verb}`);
  }
}

// -- recall (CORE-2595): journal memory search, no state.db open --------------

function relativeAge(ms: number | null): string {
  if (ms === null) return "unknown";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function recallIndexLine(result: RecallResult): string {
  const index = result.index;
  if (!index.exists) return "index: not built (run `sb recall-build`, or enable the user timer)";
  const docs = index.docCount === null ? "?" : String(index.docCount);
  const stale = index.stale ? " [STALE: results may miss recent entries]" : "";
  return `index: ${docs} docs · built ${relativeAge(index.ageMs)} ago · watermark ${relativeAge(index.watermarkAgeMs)} old${stale}`;
}

function renderRecall(result: RecallResult): string {
  const lines: string[] = [];
  if (result.hits.length === 0) {
    lines.push(`recall: no hits for ${JSON.stringify(result.query)}`);
  } else {
    for (const hit of result.hits) {
      const seq = hit.seq === null ? "" : `#${hit.seq}`;
      const project = hit.project ? ` · ${hit.project}` : "";
      const superseded = hit.superseded ? " · superseded" : "";
      lines.push(`${hit.ref}${seq} · ${hit.date} · ${hit.kind} · auth ${hit.authority}${project}${superseded}`);
      lines.push(`  ${hit.snippet}`);
    }
  }
  lines.push(recallIndexLine(result));
  return lines.join("\n");
}

function runRecall(ctx: Ctx, flags: Flags, terms: string[]): CliResult {
  assertKnownFlags(flags, "recall");
  const query = terms.join(" ").trim();
  if (query === "") throw new Error('usage: sb recall "<terms>" [--source S] [--since D] [--limit N<=5] [--json]');
  const limitRaw = flag(flags, "limit");
  const limit = limitRaw === undefined ? DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  const sinceRaw = flag(flags, "since");
  const since = sinceRaw === undefined ? undefined : parseSince(sinceRaw);
  const sourceRaw = flag(flags, "source");
  const source = sourceRaw === "journal" ? "substrate-journal" : sourceRaw;
  const result = recall({
    terms: query,
    source,
    since,
    limit,
    indexPath: flag(flags, "index"),
    env: process.env,
  });
  if (ctx.json) return emit(ctx, "recall", { ...result, note: result.note });
  const staleWarning = result.index.stale && result.index.exists
    ? `warning: recall index is stale (built ${relativeAge(result.index.ageMs)} ago); recent entries may be missing\n`
    : "";
  return {
    code: 0,
    stdout: renderRecall(result) + "\n",
    stderr: (result.note === null ? "" : `note: ${result.note}\n`) + staleWarning,
  };
}

function runRecallBuild(ctx: Ctx, flags: Flags): CliResult {
  const loadGateRaw = flag(flags, "load-gate");
  const loadGate = loadGateRaw === undefined ? undefined : Number(loadGateRaw);
  if (loadGate !== undefined && (!Number.isFinite(loadGate) || loadGate < 0)) {
    throw new Error("--load-gate must be a non-negative number (0 disables the gate)");
  }
  if (flags.has("rebuild") && flag(flags, "rebuild") !== undefined) {
    throw new Error("--rebuild is a boolean flag (pass --rebuild, not --rebuild <value>)");
  }
  const result = buildRecallIndex({
    storePath: ctx.dbPath,
    indexPath: flag(flags, "index"),
    rebuild: flags.has("rebuild"),
    loadGate,
  });
  if (ctx.json) return emit(ctx, "recall-build", result);
  const action = result.status === "built"
    ? `indexed ${result.docsIndexed} journal row(s)`
    : result.status === "deferred"
      ? `deferred (${result.reason ?? "load gate"})`
      : `skipped (${result.reason ?? "another writer"})`;
  return {
    code: 0,
    stdout: `recall-build: ${action} · ${result.docsTotal} docs · ${(result.indexBytes / 1_048_576).toFixed(1)} MB · ${result.durationMs} ms\n`,
    stderr: "",
  };
}

// -- journal verbs (Phase 5, bead xtrm-7wc.6) ----------------------------------
// Thin over JournalService/ResumeService: no SQL, no business logic here.
// Checkpoint ordering (§20.4) is enforced in the service; the CLI only
// carries argv/file bytes and renders the result.

function journalSummary(e: JournalEntry): Record<string, unknown> {
  return {
    id: e.id,
    sequence: e.sequence,
    kind: e.kind,
    issueRevision: e.issueRevision,
    hasMechanical: e.mechanical !== null,
    hasSemantic: e.semantic !== null,
    createdAt: e.createdAt,
    // Stored execution identity, projected additively (XTRM-410): the
    // journal is continuity, so reads must not drop who produced the row.
    // Null means none was recorded, never an empty string or an invention.
    participantId: e.participantId,
    activationId: e.activationId,
    sessionId: e.sessionId,
    runId: e.runId,
    executionContext: e.executionContext,
  };
}

function journalLine(svc: IssueService, e: JournalEntry): string {
  const issue = svc.getIssue(e.issueId);
  // XTRM-449: explicit absence, matching the journal-family convention in
  // journalIdentity — never a blank that is indistinguishable from a capture gap.
  const actor = e.participantId ? ` · by ${e.participantId}` : " · by (none recorded)";
  return `${issue.locator} · ${issue.humanRef} · seq${e.sequence} ${e.kind} rev${e.issueRevision}${e.semantic ? "" : " (mechanical-only)"}${actor}`;
}

// Stored execution identity for `journal show` (XTRM-410): names the actor
// for a row that carries one, and says so explicitly for a row that does
// not — never a blank that is indistinguishable from a capture gap, and
// never an invented actor.
function journalIdentity(e: JournalEntry): string {
  const facets: string[] = [];
  if (e.participantId) facets.push(e.participantId);
  if (e.sessionId) facets.push(`session ${e.sessionId}`);
  if (e.activationId) facets.push(`activation ${e.activationId}`);
  if (e.runId) facets.push(`run ${e.runId}`);
  return facets.length > 0 ? `  actor: ${facets.join(" · ")}` : "  actor: (none recorded)";
}

// Full-body human rendering for `journal show` (xtrm-7wc.6.2): the header
// line plus the entry-scoped semantic text. `since` stays compact by
// contract; mechanical payloads ride JSON only, presence-only here.
function journalBody(e: JournalEntry): string[] {
  const lines: string[] = [journalIdentity(e)];
  const sem = e.semantic;
  if (!sem) return lines;
  lines.push(`  summary: ${sem.summary}`);
  if (sem.current) lines.push(`  current: ${sem.current}`);
  for (const [label, values] of [
    ["completed", sem.completed],
    ["next", sem.next],
    ["blocked", sem.blocked],
    ["findings", sem.materialFindings],
  ] as const) {
    if (values && values.length > 0) lines.push(`  ${label}: ${values.join("; ")}`);
  }
  return lines;
}

// Host-supplied mechanical fragments omit identity: default it from the
// live issue so --mechanical stays a partial override, not a full restate.
function mechanicalArg(svc: IssueService, issueId: string, raw: string): Record<string, unknown> {
  const provided = readJsonArg(raw) as Record<string, unknown>;
  if (provided === null || typeof provided !== "object" || Array.isArray(provided)) return provided;
  if (provided["issueId"] !== undefined) return provided;
  const issue = svc.getIssue(issueId);
  return {
    issueId,
    issueRevision: issue.currentRevision,
    contractHash: issue.currentContractHash,
    collectedAt: Date.now(),
    ...provided,
  };
}

function runJournal(
  db: ReturnType<typeof openSubstrate>,
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string,
  flags: Flags,
  rest: string[],
): CliResult {
  const journal = new JournalService(db, svc);
  const contextFlags = {
    runId: flag(flags, "run"),
    participantId: flag(flags, "participant"),
    activationId: flag(flags, "activation"),
    sessionId: flag(flags, "session"),
  };
  // Identity (XTRM-417): the CLI passes NO execution envelope here on
  // purpose. JournalService.appendEntry derives identity ONCE from the
  // caller scalars above plus the ambient process context, so an entry
  // written inside a session carries participant/session/activation
  // without restating them. A pre-built envelope would be non-null
  // whenever XTRM_SESSION_ID is set and would shadow the fallback,
  // deriving the session while dropping participant and activation.
  switch (verb) {
    case "append": {
      const ref = needRef(rest);
      const kindRaw = flag(flags, "kind") ?? (() => { throw new Error("--kind is required"); })();
      if (!isJournalKind(kindRaw)) throw new Error(`unknown journal kind: ${kindRaw}`);
      const resolved = refInContext(svc, flags, ref);
      const mechRaw = flag(flags, "mechanical");
      const semRaw = flag(flags, "semantic");
      const resRaw = flag(flags, "result");
      const refsRaw = flag(flags, "refs");
      const entry = journal.appendEntry(resolved.id, {
        kind: kindRaw,
        ...contextFlags,
        mechanical: mechRaw !== undefined ? (mechanicalArg(svc, resolved.id, mechRaw) as never) : undefined,
        semantic: semRaw !== undefined ? (readJsonArg(semRaw) as never) : undefined,
        result: resRaw !== undefined ? (readJsonArg(resRaw) as ResultPayload) : undefined,
        refs: refsRaw !== undefined ? (readJsonArg(refsRaw) as never) : undefined,
        executionContext: undefined,
      });
      if (ctx.json) return emit(ctx, command, { ...journalSummary(entry), result: entry.result });
      return { code: 0, stdout: journalLine(svc, entry) + "\n", stderr: "" };
    }
    case "checkpoint": {
      // Mechanical-first (§20.4): the mechanical row commits before the
      // optional --semantic enrichment. Invalid semantic still leaves the
      // resumable mechanical entry and reports degraded (exit 0).
      const ref = needRef(rest);
      const resolved = refInContext(svc, flags, ref);
      const mechRaw = flag(flags, "mechanical");
      const semRaw = flag(flags, "semantic");
      const refsRaw = flag(flags, "refs");
      const hostMechanical =
        mechRaw !== undefined
          ? (mechanicalArg(svc, resolved.id, mechRaw) as never)
          : journal.collectMechanical(resolved.id, {
              ...contextFlags,
              workspace: flag(flags, "workspace"),
              branch: flag(flags, "branch"),
              baseCommit: flag(flags, "base-commit"),
              headCommit: flag(flags, "head-commit"),
            });
      const entry = journal.appendEntry(resolved.id, {
        kind: "checkpoint",
        ...contextFlags,
        mechanical: hostMechanical,
        refs: refsRaw !== undefined ? (readJsonArg(refsRaw) as never) : undefined,
        executionContext: undefined,
      });
      if (semRaw === undefined) {
        if (ctx.json) return emit(ctx, command, { ...journalSummary(entry), degraded: false });
        return { code: 0, stdout: journalLine(svc, entry) + "\n", stderr: "" };
      }
      try {
        const enriched = journal.enrichEntry(entry.id, readJsonArg(semRaw) as never);
        if (ctx.json) return emit(ctx, command, { ...journalSummary(enriched), degraded: false });
        return { code: 0, stdout: journalLine(svc, enriched) + "\n", stderr: "" };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        svc.appendEvent(resolved.id, "journal.checkpoint_degraded", { entry: entry.id, sequence: entry.sequence, reason });
        if (ctx.json) return emit(ctx, command, { ...journalSummary(entry), degraded: true, reason });
        return { code: 0, stdout: `${journalLine(svc, entry)} [degraded: ${reason}]\n`, stderr: "" };
      }
    }
    case "show": {
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const kindRaw = flag(flags, "kind");
      if (kindRaw !== undefined && !isJournalKind(kindRaw)) throw new Error(`unknown journal kind: ${kindRaw}`);
      const limitRaw = flag(flags, "limit");
      const entries = journal.listEntries(resolved.id, {
        kind: kindRaw as never,
        limit: limitRaw !== undefined ? Number(limitRaw) : undefined,
      });
      // show returns full entry bodies (semantic + mechanical payloads in
      // JSON; semantic text under the header line in human). since stays
      // compact: deltas carry journalSummary only.
      if (ctx.json) return emit(ctx, command, entries.map((e) => ({ ...journalSummary(e), semantic: e.semantic, mechanical: e.mechanical, result: e.result })));
      const lines = entries.flatMap((e) => [journalLine(svc, e), ...journalBody(e)]);
      return { code: 0, stdout: (lines.length > 0 ? lines.join("\n") : "(no journal entries)") + "\n", stderr: "" };
    }
    case "since": {
      // Cursor read (§20.5): only entries after the sequence cursor.
      const ref = needRef(rest);
      const cursorRaw = rest[1] ?? (() => { throw new Error("a sequence cursor is required (0 reads all entries)"); })();
      const cursor = Number(cursorRaw);
      if (!Number.isInteger(cursor) || cursor < 0) throw new Error("cursor must be a non-negative integer sequence");
      const resolved = svc.resolveRef(ref);
      const delta = journal.since(resolved.id, cursor);
      const data = {
        afterSequence: delta.afterSequence,
        nextCursor: delta.nextCursor,
        entries: delta.entries.map(journalSummary),
      };
      if (ctx.json) return emit(ctx, command, data);
      const lines = delta.entries.map((e) => journalLine(svc, e));
      return { code: 0, stdout: (lines.length > 0 ? lines.join("\n") : `(no entries since ${cursor})`) + "\n", stderr: "" };
    }
    case "latest": {
      // Bounded single-entry read over the same JournalService (§49).
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const kindRaw = flag(flags, "kind");
      if (kindRaw !== undefined && !isJournalKind(kindRaw)) throw new Error(`unknown journal kind: ${kindRaw}`);
      const entry = journal.latest(resolved.id, kindRaw !== undefined ? { kind: kindRaw } : undefined);
      if (!entry) {
        const label = kindRaw !== undefined ? ` (kind ${kindRaw})` : "";
        throw new Error(`no journal entry${label} for this issue`);
      }
      if (ctx.json) return emit(ctx, command, { ...journalSummary(entry), semantic: entry.semantic, result: entry.result });
      return { code: 0, stdout: journalLine(svc, entry) + "\n", stderr: "" };
    }
    case "timeline": {
      // Bounded recent window in chronological order (§49).
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const kindRaw = flag(flags, "kind");
      if (kindRaw !== undefined && !isJournalKind(kindRaw)) throw new Error(`unknown journal kind: ${kindRaw}`);
      const limitRaw = flag(flags, "limit");
      const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) throw new Error("--limit must be a positive integer");
      const entries = journal.timeline(resolved.id, {
        kind: kindRaw as JournalKind | undefined,
        limit,
      });
      if (ctx.json) {
        return emit(ctx, command, { count: entries.length, entries: entries.map(journalSummary) });
      }
      const lines = entries.map((e) => journalLine(svc, e));
      return { code: 0, stdout: (lines.length > 0 ? lines.join("\n") : "(no journal entries)") + "\n", stderr: "" };
    }
    case "render": {
      // Shared checkpoint/compaction rendering (§23.1): the journal
      // checkpoint and the host compaction summary render identically.
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const seqRaw = flag(flags, "sequence");
      let entry: JournalEntry;
      if (seqRaw !== undefined) {
        const seq = Number(seqRaw);
        if (!Number.isInteger(seq) || seq <= 0) throw new Error("--sequence must be a positive integer");
        const found = journal.listEntries(resolved.id).find((e) => e.sequence === seq);
        if (!found) throw new Error(`no journal entry at sequence ${seq}`);
        entry = found;
      } else {
        const latest = journal.latestCheckpoint(resolved.id);
        if (!latest) throw new Error("no checkpoint yet for this issue");
        entry = latest;
      }
      const text = journal.renderCheckpoint(entry);
      if (ctx.json) return emit(ctx, command, { entryId: entry.id, sequence: entry.sequence, text });
      return { code: 0, stdout: text + "\n", stderr: "" };
    }
    default:
      throw new Error(`unknown journal verb: ${verb} (want append|checkpoint|show|since|latest|timeline|render)`);
  }
}

// -- provenance verbs (Phase 8, bead xtrm-7wc.9) --------------------------------
// Thin over ProvenanceService: dispatch freezes the exact revision/hash,
// trace/commit/receipt/pr reconstruct lineage from host-owned rows.
// Receipt allocation and commit binding are host acts (XTRM-415/416): the
// CLI performs them on the operator's behalf — allocate copies revision and
// contract hash from the binding row, bind takes the SHA the caller has —
// and the hooks/service stay the automatic path. The revision never moves.

function bindingSummary(b: { id: string; issueId: string; issueRevision: number; contractHash: string }): Record<string, unknown> {
  return { bindingId: b.id, issueId: b.issueId, revision: b.issueRevision, contractHash: b.contractHash };
}

function runProvenance(
  db: ReturnType<typeof openSubstrate>,
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string,
  flags: Flags,
  rest: string[],
): CliResult {
  const journal = new JournalService(db, svc);
  const provenance = new ProvenanceService(db, svc, journal);
  switch (verb) {
    case "dispatch": {
      const ref = needRef(rest);
      const resolved = refInContext(svc, flags, ref);
      const claimRaw = flag(flags, "claim-id");
      const binding = provenance.dispatch(resolved.id, {
        workspace: flag(flags, "workspace") ?? process.cwd(),
        participantId: flag(flags, "participant"),
        activationId: flag(flags, "activation"),
        attemptId: flag(flags, "attempt"),
        sessionId: flag(flags, "session"),
        baseCommit: flag(flags, "base-commit"),
        claimId: claimRaw !== undefined ? Number(claimRaw) : undefined,
        executionContext: enrichExecutionContext({
          xtrmSessionId: flag(flags, "session") ?? null,
          participantId: flag(flags, "participant") ?? null,
          specialist: flag(flags, "activation") || flag(flags, "attempt")
            ? { activationId: flag(flags, "activation") ?? null, attemptId: flag(flags, "attempt") ?? null }
            : null,
        }),
      });
      return emit(ctx, command, bindingSummary(binding));
    }
    case "allocate": {
      const target = rest[0] ?? (() => { throw new Error("a binding id (exb_…) or issue ref is required"); })();
      const checkpointId = flag(flags, "checkpoint");
      if (checkpointId !== undefined) {
        let kind: JournalKind;
        try {
          kind = journal.getEntry(checkpointId).kind;
        } catch {
          throw new Error(`unknown journal checkpoint: ${checkpointId}`);
        }
        if (kind !== "checkpoint" && kind !== "compaction") {
          throw new Error(`journal entry ${checkpointId} is a ${kind}, not a checkpoint`);
        }
      }
      const binding = target.startsWith("exb_")
        ? provenance.getBinding(target)
        : (() => {
            const resolved = refInContext(svc, flags, target);
            const bindings = provenance.listBindings(resolved.id);
            if (bindings.length === 0) {
              throw new Error(`no execution binding for ${resolved.humanRef}: run \`sb provenance dispatch ${resolved.humanRef}\` first`);
            }
            return bindings[bindings.length - 1]!;
          })();
      const receipt = provenance.allocateReceipt(binding.id, { journalCheckpointId: checkpointId });
      return emit(ctx, command, { receipt });
    }
    case "bind": {
      const id = rest[0] ?? (() => { throw new Error("a receipt id is required"); })();
      const sha = rest[1] ?? (() => { throw new Error("a 40-char commit SHA is required (bind never guesses one)"); })();
      const receipt = provenance.bindCommit(id, sha);
      return emit(ctx, command, { receipt });
    }
    case "trace": {
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const t = provenance.trace(resolved.id);
      if (ctx.json) return emit(ctx, command, t);
      return { code: 0, stdout: renderProvenanceTrace(t, { color: false }), stderr: "" };
    }
    case "commit": {
      const sha = rest[0] ?? (() => { throw new Error("a 40-char commit SHA is required"); })();
      const hits = provenance.findByCommit(sha).map(({ receipt, binding }) => ({
        receipt: receipt.id,
        ...bindingSummary(binding),
        commitSha: receipt.commitSha,
      }));
      if (ctx.json) return emit(ctx, command, hits);
      return { code: 0, stdout: (hits.length > 0 ? hits.map((h) => JSON.stringify(h)).join("\n") : "(no binding for commit)") + "\n", stderr: "" };
    }
    case "receipt": {
      const id = rest[0] ?? (() => { throw new Error("a receipt id is required"); })();
      const receipt = provenance.getReceipt(id);
      const data = { receipt, binding: bindingSummary(provenance.getBinding(receipt.executionBindingId)), artifacts: provenance.listArtifacts(id) };
      if (ctx.json) return emit(ctx, command, data);
      return { code: 0, stdout: JSON.stringify(data) + "\n", stderr: "" };
    }
    case "pr": {
      const ref = rest[0] ?? (() => { throw new Error("a provider PR ref is required"); })();
      const hits = provenance.findByPr(ref).map(({ receipt, binding }) => ({
        receipt: receipt.id,
        ...bindingSummary(binding),
      }));
      if (ctx.json) return emit(ctx, command, hits);
      return { code: 0, stdout: (hits.length > 0 ? hits.map((h) => JSON.stringify(h)).join("\n") : "(no binding for pr)") + "\n", stderr: "" };
    }
    case "bundle": {
      const ref = needRef(rest);
      const resolved = refInContext(svc, flags, ref);
      const { bundle, path } = provenance.generateBundle(resolved.id, { repoRoot: flag(flags, "repo-root") ?? process.cwd() });
      return emit(ctx, command, {
        bundleId: bundle.bundleId,
        path,
        issueRevision: bundle.issueRevision,
        contractHash: bundle.contractHash,
        bindings: bundle.executionBindingIds.length,
        commits: bundle.commitShas.length,
      });
    }
    case "session": {
      const sessionId = rest[0] ?? (() => { throw new Error("a session id is required"); })();
      const detail = provenance.sessionDetail(sessionId);
      if (ctx.json) return emit(ctx, command, detail);
      const lines = [
        `session ${detail.sessionId}: issues ${detail.issueIds.length} bindings ${detail.bindingIds.length} receipts ${detail.receiptIds.length} results ${detail.resultCount}`,
        `issues: ${detail.issueIds.length > 0 ? detail.issueIds.join(",") : "(none)"}`,
        `artifacts: ${detail.artifacts.length > 0 ? detail.artifacts.map((a) => `${a.kind}:${a.value}`).join(",") : "(none)"}`,
      ];
      return { code: 0, stdout: lines.join("\n") + "\n", stderr: "" };
    }
    case "activation": {
      const activationId = rest[0] ?? (() => { throw new Error("an activation id is required"); })();
      const detail = provenance.activationDetail(activationId);
      if (ctx.json) return emit(ctx, command, detail);
      const lines = [
        `activation ${detail.activationId}: issues ${detail.issueIds.length} bindings ${detail.bindingIds.length} receipts ${detail.receiptIds.length}`,
        `issues: ${detail.issueIds.length > 0 ? detail.issueIds.join(",") : "(none)"}`,
        `artifacts: ${detail.artifacts.length > 0 ? detail.artifacts.map((a) => `${a.kind}:${a.value}`).join(",") : "(none)"}`,
      ];
      return { code: 0, stdout: lines.join("\n") + "\n", stderr: "" };
    }
    default:
      throw new Error(`unknown provenance verb: ${verb} (want dispatch|allocate|bind|trace|commit|receipt|pr|session|activation|bundle)`);
  }
}

// Low-level project administration (ADR sbcloseout4 §18): advanced/recovery
// surface only, never the normal onboarding workflow ('sb init'). Every verb
// that selects a project goes through the corrected resolver (fail-closed,
// no cardinality inference); `link` additionally requires --project so bare
// `sb project link` can never infer the sole Project.
function runProject(
  db: ReturnType<typeof openSubstrate>,
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string,
  flags: Flags,
): CliResult {
  if (verb === "link") {
    const root = discoverGitRoot();
    if (!root) throw new Error("not inside a git checkout: cd into the checkout to link with --project <id>");
    const only = flag(flags, "project");
    if (only === undefined) {
      throw new Error(
        "sb project link requires --project <id> explicitly: it never infers the Project, not even when exactly " +
          "one Project exists. This is an advanced/recovery surface; new repositories start with 'sb init'.",
      );
    }
    const linked = svc.linkCheckout(root, String(only));
    return emit(ctx, command, { gitRoot: linked.gitRoot, projectId: linked.projectId });
  }
  if (verb === "unlink") {
    const root = discoverGitRoot();
    if (!root) throw new Error("not inside a git checkout: nothing to unlink");
    return emit(ctx, command, { gitRoot: root, unlinked: svc.unlinkCheckout(root) });
  }
  if (verb === "list") {
    return emit(ctx, command, svc.listProjects());
  }
  if (verb === "show") {
    const repo = discoverRepository();
    const resolved = svc.resolveProject({
      explicit: flag(flags, "project") ?? undefined,
      env: process.env["SUBSTRATE_PROJECT"],
      gitRoot: repo.gitRoot,
      repositoryKey: repo.identity?.repositoryKey ?? null,
    });
    const project = svc.getProject(resolved.projectId);
    const bindings = new RepositoryService(db).bindingsForProject(project.id).map((b) => ({
      repositoryKey: b.repositoryKey,
      baseBranch: b.baseBranch,
      canonicalRemote: b.canonicalRemote,
    }));
    return emit(ctx, command, {
      id: project.id,
      prefix: project.prefix,
      name: project.name,
      createdAt: project.createdAt,
      source: resolved.source,
      bindings,
    });
  }
  if (verb === "links") {
    return emit(ctx, command, { gitRoot: discoverGitRoot(), links: svc.listLinks() });
  }
  if (verb === "repair") {
    return runProjectRepair(db, svc, ctx, command);
  }
  if (verb !== "create") throw new Error(`unknown project verb: ${verb} (want create|link|unlink|list|show|links|repair)`);
  const prefix = flag(flags, "prefix") ?? (() => { throw new Error("--prefix <PREFIX> is required"); })();
  const name = flag(flags, "name") ?? (() => { throw new Error("--name <name> is required"); })();
  const id = flag(flags, "id");
  const project = svc.createProject({ prefix, name, ...(id !== undefined ? { id: String(id) } : {}) });
  return emit(ctx, command, { id: project.id, prefix: project.prefix, name: project.name });
}

// `sb project repair` (ADR sbcloseout4 §18): recovery for a missing or
// corrupted local checkout alias. The repository binding is the authority:
// the alias is re-established from the bound project id (explicit, never
// inferred), then the checkout is verified through the corrected resolver.
// Repair never creates a binding, never adopts or renames a project, and
// never touches issues — without a binding it fails closed into 'sb init'.
function runProjectRepair(
  db: ReturnType<typeof openSubstrate>,
  svc: IssueService,
  ctx: Ctx,
  command: string,
): CliResult {
  const repo = discoverRepository();
  if (repo.gitRoot === null) throw new Error("not inside a git checkout: cd into the checkout to repair, or run 'sb init'");
  if (repo.identity === null) {
    throw new Error(
      `cannot derive a repository identity: ${repo.identityError ?? "no canonical remote and no Git common root"}. ` +
        "Run 'sb init' to bind this repository to a Project.",
    );
  }
  const repositoryKey = repo.identity.repositoryKey;
  const binding = new RepositoryService(db).getBinding(repositoryKey);
  if (binding === null) {
    throw new Error(
      `this repository has no binding for ${repositoryKey}: repair cannot invent one. ` +
        "Run 'sb init' to bind this repository to a Project.",
    );
  }
  let bound: { id: string; prefix: string; name: string };
  try {
    bound = svc.getProject(binding.projectId);
  } catch {
    throw new Error(
      `repository ${repositoryKey} is bound to missing project ${binding.projectId}: repair the repository binding ` +
        "(inspect repository_bindings) or re-run 'sb init'.",
    );
  }
  const previous = svc.listLinks().find((l) => l.gitRoot === repo.gitRoot)?.projectId ?? null;
  svc.linkCheckout(repo.gitRoot, bound.id);
  const resolved = svc.resolveProject({ gitRoot: repo.gitRoot, repositoryKey });
  if (resolved.projectId !== bound.id) {
    throw new Error(
      `repair verification failed: ${repositoryKey} resolves to ${resolved.projectId}, not the bound project ` +
        `${bound.id}. Run 'sb init' to re-bind this repository.`,
    );
  }
  return emit(ctx, command, {
    gitRoot: repo.gitRoot,
    repositoryKey,
    projectId: bound.id,
    previous,
    repaired: previous !== bound.id,
    source: resolved.source,
  });
}

// Fail closed when a PlanDraft targets a Project outside the effective
// repository context. Update specs are keyed by their stored Issue's Project
// (the draft's projectId is not authoritative on updates).
function requireDraftInContext(svc: IssueService, flags: Flags, draft: unknown): void {
  const issues = (draft as { issues?: unknown } | null | undefined)?.issues;
  if (!Array.isArray(issues)) return;
  const context = projectOf(svc, flags);
  for (const spec of issues as Array<{ key?: string; projectId?: string; updateIssueId?: string }>) {
    let target = spec.projectId;
    if (spec.updateIssueId !== undefined) {
      try {
        target = svc.getIssue(spec.updateIssueId).projectId;
      } catch {
        continue; // unknown update target is reported by planning.check
      }
    }
    if (target !== context) {
      throw new Error(
        `plan target ${spec.key ?? "?"} belongs to project ${target ?? "(none)"}, not the effective project ${context}: ` +
          `pass --project ${target} to plan against it deliberately`,
      );
    }
  }
}

function runPlan(
  db: ReturnType<typeof openSubstrate>,
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string,
  flags: Flags,
): CliResult {
  const file = flag(flags, "file") ?? (() => { throw new Error("--file <plan.json> is required"); })();
  const draft = readJsonArg(file) as never;
  // Repository-relative planning (ADR §5): every draft target must belong to
  // the effective project context. The draft carries explicit projectIds; this
  // guard keeps a plan file from mutating another repository's Issues unless
  // the operator selects that Project deliberately (--project / SUBSTRATE_PROJECT).
  requireDraftInContext(svc, flags, draft);
  // PlanningService owns check/apply; the CLI only carries the file bytes.
  const planning = new PlanningService(db, svc);
  if (verb === "check") return emit(ctx, command, planning.check(draft));
  if (verb === "apply") return emit(ctx, command, planning.apply(draft));
  throw new Error(`unknown plan verb: ${verb} (want check|apply)`);
}

function readJsonLines(value: string): unknown[] {
  let text: string;
  try {
    text = readFileSync(value, "utf8");
  } catch {
    throw new Error(`cannot read import file: ${value}`);
  }
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      throw new Error(`invalid JSONL in ${value}: ${t.slice(0, 80)}`);
    }
  }
  return out;
}

// A9 receipt v3 (bead xtrm-6qu.9.1): machine-readable import receipt with
// inline inputs census, deterministic counts, verifier checks, and verdict.
// Exit rule: 0 iff verdict PASS. FAIL returns ok:false WITH the full
// receipt in data (never bare), so consumers must not trust exit 0 alone
// on older binaries — validate the receipt body.
export const IMPORT_RECEIPT_SCHEMA = "substrate-import-receipt/v1";

interface VerifierCheck {
  check: string;
  expected: unknown;
  actual: unknown;
  ok: boolean;
}

function countEdgeRows(db: ReturnType<typeof openSubstrate>): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM issue_edges").get() as { n: number };
  return row.n;
}

function runImport(
  db: ReturnType<typeof openSubstrate>,
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string,
  flags: Flags,
): CliResult {
  if (verb !== "beads") throw new Error(`unknown import verb: ${verb} (want beads)`);
  const file = flag(flags, "file") ?? (() => { throw new Error("--file <beads-export.jsonl> is required"); })();
  const project = flag(flags, "project") ?? (() => { throw new Error("--project is required"); })();
  const edgesFile = flag(flags, "edges-file");
  const createProject = flag(flags, "create-project");
  const dryRun = flags.has("dry-run");
  const rawLines = readJsonLines(file);
  const memoriesSkipped = rawLines.filter((r) => (r as { _type?: unknown })._type === "memory").length;
  const records = rawLines.filter((r) => (r as { _type?: unknown })._type !== "memory") as BeadsIssueRecord[];
  const fileEdges = edgesFile ? (readJsonArg(edgesFile) as BeadsEdgeRecord[]) : [];
  const fileEdgeList = Array.isArray(fileEdges) ? fileEdges : [];
  // Inputs census: inline dependencies[] are authoritative; --edges-file is
  // an optional supplement (union dedupes, inline wins). Census first so
  // dry-run and apply report identical input shapes (receipt parity).
  const inlineByType: Record<string, number> = {};
  let inlineEdges = 0;
  let recordsWithDeps = 0;
  for (const r of records) {
    const deps = (r as { dependencies?: unknown }).dependencies;
    if (!Array.isArray(deps)) continue;
    recordsWithDeps += 1;
    for (const d of deps) {
      const t = (d as { type?: unknown } | null)?.type;
      if (typeof t === "string") {
        inlineEdges += 1;
        inlineByType[t] = (inlineByType[t] ?? 0) + 1;
      }
    }
  }
  const inputs = {
    records: rawLines.length,
    issues: records.length,
    memoriesSkipped,
    recordsWithDeps,
    inlineEdges,
    inlineByType,
    fileEdges: fileEdgeList.length,
  };
  if (dryRun) {
    return emit(ctx, command, {
      schema: IMPORT_RECEIPT_SCHEMA,
      dryRun: true,
      project,
      inputs,
      note: "no mutations performed; re-run without --dry-run to import",
    });
  }
  let create: { prefix: string; name: string } | undefined;
  if (createProject) {
    const i = createProject.indexOf(":");
    if (i < 0) throw new Error("--create-project wants PREFIX:Name");
    create = { prefix: createProject.slice(0, i), name: createProject.slice(i + 1) };
  }
  const edgeRowsBefore = countEdgeRows(db);
  const journal = new JournalService(db, svc);
  const closures = new ClosureService(db, svc);
  const result = importBeads(svc, project, records, fileEdgeList, { createProject: create, journal, closures });
  const edgeRowsAfter = countEdgeRows(db);

  // Verifier (deterministic, same field names as the Core-local gate):
  const checks: VerifierCheck[] = [];
  const check = (name: string, expected: unknown, actual: unknown): void => {
    checks.push({ check: name, expected, actual, ok: JSON.stringify(expected) === JSON.stringify(actual) });
  };
  // Legacy Beads ids can be shaped like durable refs (`core-076` parses as
  // CORE-76), and resolveRef prefers the ref parse. The verifier must inspect
  // the record that was actually imported, so it resolves by exact alias first.
  const importedIssueId = (beadsId: string): string => svc.issueIdForAlias(beadsId) ?? svc.resolveRef(beadsId).id;
  // (0b) inline traceability, census anchored (XTRM-405): the census is derived
  // from the RAW export shape (an entry counts when it carries a string `type`),
  // never from the parsed union. Before this, every check reconciled the parsed
  // union against lists derived from that same union, so a parse-blind export
  // shrank both sides equally and still reported PASS.
  const union = unionEdgesDetailed(records, fileEdgeList);
  const censusEdges = inputs.inlineEdges + inputs.fileEdges;
  const errorCount = result.edgeErrors.length + result.hierarchyErrors.length;
  const accountedEdges =
    result.edgesApplied.length +
    result.hierarchyApplied.length +
    result.hierarchySuperseded.length +
    result.hierarchyRefused.length +
    result.externalRefs.length +
    errorCount +
    result.unrepresentableEdges.length +
    union.collapsed;
  // Every census-visible entry must reach an applied edge, a declared
  // refusal/external, a declared unrepresentable kind, or a collapsed
  // duplicate. Entries that resolved to nothing are deliberately NOT accounted
  // here: they fail (0c) instead.
  check("0b-inline-traceability", censusEdges, accountedEdges);
  // (0c) resolution: a census-visible entry whose target cannot be resolved is
  // a parse-level failure. The check carries samples so it names the offending
  // entries rather than only counting them.
  check(
    "0c-unreconciled-inline-entries",
    { unresolved: 0, sample: [] },
    { unresolved: result.unresolvedEntries.length, sample: result.unresolvedEntries.slice(0, 5) },
  );
  // (1) exact ID-set reconciliation vs the export.
  const exportIds = [...new Set(records.filter((r) => r && typeof r.id === "string").map((r) => r.id))].sort();
  const receiptIds = [...new Set([...result.created, ...result.skippedPresent])].sort();
  check("1-id-set-equality", exportIds, receiptIds);
  // (2) edge multiset reconciliation by (from,to,type) over Beads IDs, on two
  // axes: key identity plus the census total, so the identity can no longer
  // hold trivially over an empty parse.
  const unionKeys = union.edges
    .map((e) => `${e.issue_id} ${e.depends_on_id} ${e.type}`)
    .sort();
  const appliedKeys = [
    ...result.edgesApplied.map((e) => {
      const orig = union.edges.find((u) => u.issue_id === e.from && u.depends_on_id === e.to) ?? union.edges.find((u) => u.issue_id === e.to && u.depends_on_id === e.from);
      return orig ? `${orig.issue_id} ${orig.depends_on_id} ${orig.type}` : `unmapped ${e.from} ${e.to} ${e.kind}`;
    }),
    ...result.hierarchyApplied.map((h) => `${h.child} ${h.parent} parent-child`),
    ...result.hierarchySuperseded.map((h) => `${h.child} ${h.parent} parent-child`),
    ...result.hierarchyRefused.map((h) => `${h.child} ${h.parent} parent-child`),
  ].sort();
  check(
    "2-edge-multiset",
    { census: censusEdges, keys: unionKeys.length },
    { census: accountedEdges, keys: appliedKeys.length + errorCount + result.externalRefs.length + result.unrepresentableEdges.length },
  );
  // (3) hierarchy resolves: every applied parent-child visible via children.
  let hierarchyUnresolved = 0;
  for (const h of result.hierarchyApplied) {
    try {
      const parentId = importedIssueId(h.parent);
      const childId = importedIssueId(h.child);
      const children = svc.listChildren(parentId).map((c) => c.id);
      if (!children.includes(childId)) hierarchyUnresolved += 1;
    } catch {
      hierarchyUnresolved += 1;
    }
  }
  check("3-hierarchy-resolves", 0, hierarchyUnresolved);
  // (4) fail-closed: every created row unready; leak list empty.
  const unreadyCoverage = result.created.filter((id) => result.unready.includes(id)).length;
  check("4-created-subset-unready", result.created.length, unreadyCoverage);
  // (5) provenance: every created id carries a beads.imported event.
  let provenanceMissing = 0;
  for (const beadsId of result.created) {
    try {
      const id = importedIssueId(beadsId);
      const has = svc.listEvents(id).some((e) => e.type === "beads.imported");
      if (!has) provenanceMissing += 1;
    } catch {
      provenanceMissing += 1;
    }
  }
  check("5-provenance-events", 0, provenanceMissing);
  // (6) notesPreserved sample: deterministic sorted first 5 created + one
  // done-status (by lifecycle) when present. Each asserts the contract
  // problem carries the source description head or the TBD filler.
  const byId = new Map(records.filter((r) => r && typeof r.id === "string").map((r) => [r.id as string, r]));
  const sample = [...result.created].sort().slice(0, 5);
  let notesUnpreserved = 0;
  let notesSampled = 0;
  for (const beadsId of sample) {
    const rec = byId.get(beadsId);
    if (!rec) {
      notesUnpreserved += 1;
      continue;
    }
    try {
      const id = importedIssueId(beadsId);
      const rev = svc.getRevision(id, svc.getIssue(id).currentRevision);
      const problem = String((rev.contract as { problem?: unknown } | null)?.problem ?? "");
      const expected = expectedProblemHead(rec.description);
      notesSampled += 1;
      // The filler marker is a legitimate expectation ONLY when the source
      // genuinely carries no recognizable section. For a source that does, the
      // marker is a symptom of section collapse, so it must fail here
      // (XTRM-405: this disjunct used to make a total collapse pass by
      // construction).
      const preserved = expected === BEADS_TBD_MARKER ? problem.trim() !== "" : problem.includes(expected);
      if (!preserved) notesUnpreserved += 1;
    } catch {
      notesUnpreserved += 1;
    }
  }
  check("6-notes-preserved-sample", { sampled: notesSampled, unpreserved: 0 }, { sampled: notesSampled, unpreserved: notesUnpreserved });
  // (6b) structurable coverage (XTRM-405 success 1): for every created record
  // whose source description carries a given contract section heading, the
  // stored revision must carry that section, non-empty and free of the filler.
  // Counted per (record, section) pair so a source that simply lacks SCOPE is
  // not penalised. This is the receipt-level form of the section-structuring
  // requirement, and it is what a sample of 5 could otherwise miss.
  let unstructuredSections = 0;
  const unstructuredSample: string[] = [];
  for (const beadsId of result.created) {
    const rec = byId.get(beadsId);
    if (!rec) continue;
    const recognized = new Set(extractSectionsDetailed(typeof rec.description === "string" ? rec.description : "").recognized);
    const wanted: Array<["SCOPE" | "VALIDATION" | "OUTPUT", keyof { scope: unknown; validation: unknown; output: unknown }]> = [
      ["SCOPE", "scope"],
      ["VALIDATION", "validation"],
      ["OUTPUT", "output"],
    ];
    for (const [section, field] of wanted) {
      if (!recognized.has(section)) continue;
      let bad = false;
      try {
        const id = importedIssueId(beadsId);
        const rev = svc.getRevision(id, svc.getIssue(id).currentRevision);
        const value = (rev.contract as Record<string, unknown> | null)?.[field];
        bad = !Array.isArray(value) || value.length === 0 || JSON.stringify(value).includes(BEADS_TBD_MARKER);
      } catch {
        bad = true;
      }
      if (bad) {
        unstructuredSections += 1;
        if (unstructuredSample.length < 5) unstructuredSample.push(`${beadsId}:${section}`);
      }
    }
  }
  check(
    "6b-structured-contract-coverage",
    { unstructured: 0, sample: [] },
    { unstructured: unstructuredSections, sample: unstructuredSample },
  );
  // (8) timestamp monotonicity (XTRM-406): source timelines are preserved, but
  // a contradictory source record must never be stored as-is. Any stored issue
  // whose updated_at precedes its created_at, or any Closure preceding its
  // issue's creation, fails this check.
  const badOrderIssues = (db.prepare("SELECT COUNT(*) AS n FROM issues WHERE updated_at < created_at").get() as { n: number }).n;
  const badOrderClosures = (
    db.prepare("SELECT COUNT(*) AS n FROM issue_closures c JOIN issues i ON i.id = c.issue_id WHERE c.closed_at < i.created_at").get() as { n: number }
  ).n;
  check(
    "8-timestamp-monotonicity",
    { issues: 0, closures: 0 },
    { issues: badOrderIssues, closures: badOrderClosures },
  );
  // (7) edge-row stability: no runaway growth (rerun delta must be 0 when
  // nothing was created; single-run delta bounded by applied rows).
  const rowDelta = edgeRowsAfter - edgeRowsBefore;
  const appliedRows = result.edgesApplied.length + result.hierarchyApplied.length;
  // Strict on rerun (nothing created -> zero row growth, the true G44
  // idempotency bar); bounded on first import (in-place updates stay under).
  check("7-edge-row-stability", true, result.created.length === 0 ? rowDelta === 0 : rowDelta <= appliedRows);
  const counts = {
    created: result.created.length,
    skipped: result.skippedPresent.length,
    edgesApplied: result.edgesApplied.length,
    edgeErrors: errorCount,
    hierarchyApplied: result.hierarchyApplied.length,
    hierarchySuperseded: result.hierarchySuperseded.length,
    hierarchyRefused: result.hierarchyRefused.length,
    externalRefs: result.externalRefs.length,
    unready: result.unready.length,
    notesApplied: result.notesApplied.length,
    commentsApplied: result.commentsApplied.length,
    closeReasonCarried: result.closeReasonCarried.length,
    // XTRM-405 fidelity counts (additive). `censusEdges` is the raw export
    // shape; `accountedEdges` is the reconciled outcome. On a board with no
    // unrepresentable or collapsed entries these are equal.
    censusEdges,
    accountedEdges,
    collapsedEdges: union.collapsed,
    unrepresentableEdges: result.unrepresentableEdges.length,
    downgradedEdges: result.downgradedEdges.length,
    unresolvedEntries: result.unresolvedEntries.length,
    unmappedSections: result.unmappedSections.length,
    sourceFieldsCaptured: {
      labels: result.sourceFields.labels.length,
      externalRefs: result.sourceFields.externalRefs.length,
      assignees: result.sourceFields.assignees.length,
      startedAt: result.sourceFields.startedAt.length,
      issueTypesRemapped: result.sourceFields.issueTypesRemapped.length,
    },
    // XTRM-406 timestamp provenance. `createdAtFromSource` counts records whose
    // stored created_at came from the export; `absent` counts records whose
    // source carried no usable value (counted, never silently substituted).
    timestampProvenance: {
      createdAtFromSource: result.timestampProvenance.filter((p) => p.createdAt === "source").length,
      createdAtAbsent: result.timestampProvenance.filter((p) => p.createdAt === "absent").length,
      updatedAtFromSource: result.timestampProvenance.filter((p) => p.updatedAt === "source").length,
      updatedAtAbsent: result.timestampProvenance.filter((p) => p.updatedAt === "absent").length,
      closedAtFromSource: result.timestampProvenance.filter((p) => p.closedAt === "source").length,
      closedAtAbsent: result.timestampProvenance.filter((p) => p.closedAt === "absent").length,
      terminalFromClosedAt: result.timestampProvenance.filter((p) => p.terminalAtFrom === "closed_at").length,
      terminalFromUpdatedAt: result.timestampProvenance.filter((p) => p.terminalAtFrom === "updated_at").length,
      terminalFromCreatedAt: result.timestampProvenance.filter((p) => p.terminalAtFrom === "created_at").length,
      terminalFromWallClock: result.timestampProvenance.filter((p) => p.terminalAtFrom === "wall-clock").length,
      normalized: result.timestampProvenance.filter((p) => p.normalized.length > 0).length,
      normalizedSample: result.timestampProvenance.filter((p) => p.normalized.length > 0).slice(0, 3),
    },
    edgeRowsBefore,
    edgeRowsAfter,
  };
  const verdict = checks.every((c) => c.ok) && errorCount === 0 && result.depFailures.length === 0 ? "PASS" : "FAIL";
  const receipt = {
    schema: IMPORT_RECEIPT_SCHEMA,
    dryRun: false,
    project,
    inputs,
    result,
    counts,
    verifier: { checks },
    verdict,
  };
  if (verdict === "PASS") return emit(ctx, command, receipt);
  const summary = `import verification FAIL: ${checks.filter((c) => !c.ok).map((c) => c.check).join(", ") || "error lists non-empty"} (see receipt)`;
  if (ctx.json) {
    return {
      code: 1,
      stdout: JSON.stringify({ schema: SCHEMA_VERSION, command, ok: false, error: summary, data: receipt }) + "\n",
      stderr: "",
    };
  }
  return { code: 1, stdout: `${JSON.stringify(receipt)}\n`, stderr: `sb: ${command}: ${summary}\n` };
}

function runExport(
  _db: ReturnType<typeof openSubstrate>,
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string,
  flags: Flags,
): CliResult {
  if (verb !== undefined && verb !== "project") throw new Error(`unknown export verb: ${verb} (want project)`);
  const project = flag(flags, "project") ?? (() => { throw new Error("--project is required"); })();
  const snapshot = svc.exportProject(project);
  const file = flag(flags, "file");
  if (file) writeFileSync(file, JSON.stringify(snapshot));
  return emit(ctx, command, snapshot);
}

// -- process main --------------------------------------------------------------

const invokedPath = process.argv[1] ?? "";
// Direct node invocation (argv ends with sb.ts) and the npm-linked bin
// (argv is the sb symlink) both enter main; anything else is a library import.
const invokedAsMain =
  invokedPath.endsWith("sb.ts") || invokedPath.endsWith("sb.js") || invokedPath.endsWith("/sb") || invokedPath === "sb";
if (invokedAsMain) {
  const result = runCli(process.argv.slice(2));
  // An early-closing reader (`sb ... | head`) makes stdout/stderr emit EPIPE.
  // That is a normal end of output, not a failure: without a handler it
  // surfaces as an unhandled 'error' event that replaces the real exit code.
  const ignoreBrokenPipe = (err: Error): void => {
    if ((err as NodeJS.ErrnoException).code !== "EPIPE") throw err;
  };
  process.stdout.on("error", ignoreBrokenPipe);
  process.stderr.on("error", ignoreBrokenPipe);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  // Exit by setting process.exitCode and letting the event loop drain rather
  // than calling process.exit(): writes to a pipe are asynchronous, so
  // process.exit() discards whatever has not flushed and silently truncated
  // piped output at the 64 KiB pipe buffer (XTRM-331). Every database handle is
  // closed inside runCli, so nothing else holds the process open, and Node/Bun
  // flush pending stdout/stderr before a natural exit. A large write reported
  // on stderr is delivered for the same reason; the exit code is unchanged.
  process.exitCode = result.code;
}
