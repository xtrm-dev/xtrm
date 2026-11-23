#!/usr/bin/env node
// sb CLI vertical (Phase 4, bead xtrm-7wc.5). Thin consumer of the typed
// service: no SQL here, no business logic here. Readiness, claims, planning
// and identity resolution all live in IssueService / PlanningService; this
// process only parses argv, calls the service, and renders JSON or one-line
// human projections (hierarchical locator + durable reference; the opaque
// machine ID appears only in --json output).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
import { JournalService, decodeFeedCursor } from "../src/service/journal-service.ts";
import type { JournalOperationalContext } from "../src/service/journal-service.ts";
import { ClosureService } from "../src/service/closure-service.ts";
import { CLOSURE_OUTCOMES, isClosureOutcome } from "../src/domain/closure.ts";
import { isoTime, resolveClaimHolder } from "../src/domain/claim.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { PullRequestService } from "../src/service/pull-request-service.ts";
import { LinkGateService, gateModeFromEnv } from "../src/service/link-gate-service.ts";
import { GhCliPullRequestSource, PullRequestSyncService, syncReportText } from "../src/service/pull-request-sync-service.ts";
import { canonicalPullReference, pullUrl, type IssuePullRequestView } from "../src/domain/pull-request.ts";
import { parseAllTrailers, subjectIssueRefs } from "../src/domain/provenance.ts";
import { IntegrationService } from "../src/service/integration-service.ts";
import { RESULT_FIELDS, assessJournalEntry, assertResultPayload, isJournalKind } from "../src/domain/journal.ts";
import { renderDispatchers, renderProvenanceTrace } from "../src/presentation/terminal.ts";
import { assertContractShape, contractShapeHints, isValidScrutiny, normaliseContract, SCRUTINY_LEVELS, type ContractRepair } from "../src/domain/contract.ts";
import { enrichExecutionContext } from "../src/domain/execution-context.ts";
import type { JournalEntry, JournalKind, ResultPayload } from "../src/domain/journal.ts";
import type { IssueKind, LifecycleState, ResolvedIssue } from "../src/domain/issue.ts";
import type { OperationalState } from "../src/domain/readiness.ts";
import { DEFAULT_SCRUTINY_POLICY_REF, scrutinyPolicyRefs } from "../src/domain/readiness.ts";

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
        // XTRM-959: a forced close stays visible in the bounded show summary,
        // so a reader cannot mistake it for an ordered close. null = not forced.
        blockerOverride: latest.blockerOverride,
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
      const bit = e.summary ? ` ${e.summary}` : ""; // already a marked preview (XTRM-678)
      lines.push(`- seq${e.sequence} ${e.kind}:${bit}`);
    }
  } else {
    lines.push("(no journal entries)");
  }
  return lines;
}

function renderPullRequests(views: IssuePullRequestView[]): string[] {
  if (views.length === 0) return [];
  const MAX = 20;
  const lines = ["", "PULL REQUESTS"];
  for (const v of views.slice(0, MAX)) {
    // XTRM-754: state, merge date and title come from the pull_requests row the
    // host writes at PR open and the reconciler refreshes. An absent row is
    // "state unknown", never a guess.
    const head = [`${v.relation} ${v.repository}#${v.number}`];
    if (v.state === null) {
      head.push("state unknown");
    } else if (v.state === "merged" && v.mergedAt !== null) {
      head.push(`merged ${new Date(v.mergedAt).toISOString().slice(0, 10)}`);
    } else {
      // 'assumed' is the opener's row, written before any GitHub read: say so
      // rather than presenting it as an observation (XTRM-754 review).
      head.push(v.stateSource === "assumed" ? `${v.state} (assumed)` : v.state);
    }
    if (v.title !== null) head.push(v.title);
    const bits = [head.join(" ")];
    bits.push(`sources: ${v.sources.join(",")}`);
    if (v.commits.length > 0) bits.push(`${v.commits.length} commit(s)`);
    if (v.alsoMentioned) bits.push("also mentioned");
    lines.push(`- ${bits.join(" · ")}`);
  }
  if (views.length > MAX) lines.push(`(+${views.length - MAX} more)`);
  return lines;
}

function treeSummary(svc: IssueService, id: string): Record<string, unknown> {
  const issue = svc.getIssue(id);
  return {
    ...issueSummary(issue),
    children: svc.listChildren(id).map((c) => treeSummary(svc, c.id)),
  };
}

// "locator · ref" (PRD §8.4); one value when they coincide (root issues).
function idPair(locator: unknown, humanRef: unknown): string {
  return locator === humanRef ? String(humanRef) : `${String(locator)} · ${String(humanRef)}`;
}

function human(summary: Record<string, unknown>): string {
  const state = (summary["readinessState"] as string | undefined) ?? (summary["lifecycleState"] as string);
  return `${idPair(summary["locator"], summary["humanRef"])} · ${summary["title"]} [${state} rev${summary["revision"]}]`;
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

// --summary-file (XTRM-678): the summary text comes from a file or stdin, and
// the other --semantic fields still apply. Long text is supplied this way
// because an over-limit summary is refused, never cut.
function semanticArg(semRaw: string | undefined, summaryFile: string | undefined): unknown {
  const semantic = semRaw !== undefined ? (readJsonArg(semRaw) as Record<string, unknown>) : undefined;
  if (summaryFile === undefined) return semantic;
  if (summaryFile !== "-" && !existsSync(summaryFile)) throw new Error(`--summary-file not found: ${summaryFile}`);
  const text = readFileSync(summaryFile === "-" ? 0 : summaryFile, "utf8");
  if (text.trim() === "") throw new Error(`--summary-file is empty: ${summaryFile}`);
  return { ...(semantic ?? {}), summary: text };
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

groups:
  init        initialize this repository (bind it to a Project; idempotent)
  issue       create|show|edit|note|validate|attest|list|ready|query|tree|children|relate|unrelate|claim|release|state|close|reopen|defer|cancel|archive|resume
  project     create|link|unlink|list|show|links|repair
  plan        check|apply
  journal     append|checkpoint|show|since|latest|timeline|render
  provenance  dispatch|allocate|bind|trace|graph|commit|receipt|pr|session|activation|bundle
  links       check|sync
  external    bind|list
  remote      setup|status|disable
  import      beads
  export      project

flags:
  --db PATH   state.db path (default $SUBSTRATE_DB or ~/.xtrm/state.db)
  --json      machine-readable envelope {schema, command, ok, data|error}

help and --version never open or create the database.
per-verb help: sb issue create --help  |  sb help issue create`;

const COMMAND_HELP: Record<string, string> = {
  top: HELP_TOP,
  "links.sync": `usage: sb links sync [<pr>] [--project <id>] [--repo <owner/name>] [--limit <n>] [--since <ISO>] [--dry-run] [--holder <name>]

  One-shot reconciler: conditional gh reads, pull_requests state, trailer-first links (727 writers), title/branch/body mentions. --since records source=backfill. Writes nothing with --dry-run. --holder defaults to SUBSTRATE_HOLDER and is the actor recorded on what the run changes.`,
  "issue.link": `usage: sb issue link pr <ref> --repo <owner/name> --number <n> [--url <url>] [--commit <sha>]... [--commits-range <base>..<head>] [--holder <name>]

  Writes a persisted mention (source=explicit) or, with --commit/--commits-range, the T2 evidence from the commits' XTRM-Issue trailers. Never deletes; never claims created_from without a valid receipt.`,
  "issue.unlink": `usage: sb issue unlink pr <ref> --repo <owner/name> --number <n> [--relation <created_from|mentioned>] [--actor <name>]

  Sets superseded_at on the matching live row(s). The evidence row stays.`,
  external: `usage: sb external <bind|list> [options]

  bind <ref> --provider jira --scope <site:KEY> --id <n> --key <KEY-123> --url <browse-url> [--state pending|in_sync]
  list [--provider <p>] [--scope <s>] [--limit <n>] [--project <id>]

  Durable Jira identity of an Issue, stored in external_bindings. Neither verb contacts Jira.`,
  "external.bind": `usage: sb external bind <ref> --provider jira --scope <site:KEY> --id <n> --key <KEY-123> --url <browse-url> [--state pending|in_sync] [--project <id>] [--holder <name>]

  Records that an existing Issue is known in Jira by one key (mode=mirror_read). Intent and identity only: no Jira call is made and no remote read is claimed. --scope is <site>:<projectKey>, --id the numeric Jira issue id, --key KEY-123 in that project, --url the browse URL ending /browse/<key>. --state defaults to pending (in_sync on request; a re-bind that omits it keeps the row's state). Binding the same identity again changes nothing (status noop); a changed --url or --state updates the row (status updated); a key or id bound to another Issue is refused naming that Issue, and nothing is written. --holder defaults to SUBSTRATE_HOLDER and is the actor recorded on the event.`,
  "external.list": `usage: sb external list [--provider <github|jira>] [--scope <remote-scope>] [--limit <n>] [--project <id>]

  Bounded read of the external bindings of one Project, ordered by provider, scope and remote id, each row with the owning Issue's durable ref. --limit defaults to 100 (maximum 500); truncated=true says more rows matched. Opens no network connection.`,
  "provenance.attach": `usage: sb provenance attach <ref> pr <github:org/repo#n|org/repo#n|url|#n> [--receipt <id>] [--holder <name>]

  T1: the PR is the outcome of the issue's work. Resolves the receipt b1 --receipt, b2 the holder's live claim, b3 the latest receipt, then attaches the artifact and the created_from row in one transaction.`,
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
  contract: `usage: sb help contract

the work contract JSON (sb issue create --contract <file|json>):

    {
      "problem":     "why this work exists (non-empty string)",
      "success":     "observable end state (non-empty string)",
      "scope":       ["paths/surfaces the work may touch"],
      "nonGoals":    ["what must NOT change"],
      "constraints": ["rules the work must respect"],
      "validation":  [{"check": "how success is proven"}],
      "output":      [{"artifact": "what the work delivers"}],
      "scrutiny":    "LOW|MEDIUM|HIGH|CRITICAL"
    }

- Pass the object itself; do not nest it under a "contract" key.
- validation and output hold objects: {"check": "…"}, {"artifact": "…"}. A plain
  string entry is repaired to that shape on create/edit and reported in one line
  ("validation: 1 entry normalised to {check}"); an entry that cannot be repaired
  unambiguously is refused, naming the field, the entry and the expected shape.
- scope, nonGoals and constraints are non-empty arrays of non-empty strings.
- TBD/TODO/XXX/FIXME anywhere keeps the issue draft ("unresolved marker").
- scrutiny is the contract key or --scrutiny; the flag wins.
- A valid contract is still draft until attested:
    sb issue validate <ref>
    sb issue attest <ref> --outcome ready --policy default --attested-by <you>
- Changing the contract creates a new revision and invalidates the attestation.`,
  kinds: `usage: sb help kinds

journal kinds (sb journal append <ref> --kind <kind> ...):

note        progress that is not a finding or decision
finding     something learned that others need (evidence, not opinion)
decision    a choice made and why; alternatives rejected
blocker     work cannot proceed; name what unblocks it
milestone   a meaningful step completed
handoff     state for the next worker: done, open, next step
result      the settled outcome; requires --result; cite it when closing
checkpoint  mechanical-first snapshot (sb journal checkpoint); requires --mechanical
compaction  host-written record of a context compaction; requires --mechanical

--semantic '{"summary":"what changed / evidence / next step", "next":["…"]}'
  summary is required; optional completed, current, next, blocked, openQuestions,
  keyDecisions, materialFindings (string arrays; current is a string).
--result '{"summary":"…"}'
  optional attempted, outcome (strings); completed, validation, findings,
  artifactRefs, receiptRefs, provenanceRefs (string arrays). No other keys.

- Text after the ref is rejected: put prose in --semantic.
- An entry with no payload is rejected for note, finding, decision, blocker, milestone, handoff.
- A summary under 8 words, or done/wip/ok/todo/tbd/.../-, is accepted with a warning.
- Summary text is limited to 20,000 characters on the CLI and on the Pi tool; a longer one
  fails and nothing is written (it is never cut). The Claude MCP append path still cuts at
  2,000 characters. Long text: --summary-file <path|->, or split it.
- Text views cut long summaries with a "… (+N chars, …)" marker; --json always has the full text.
- Close with evidence: sb issue close <ref> --outcome completed --reason … --result <entry id>
- Reads: journal latest/since print headers; journal show or --json print bodies.`,
  identity: `usage: sb help identity

holder, SUBSTRATE_HOLDER and participant:

--holder        who owns a claim lease (sb issue claim|renew|release). Required unless
                SUBSTRATE_HOLDER is set.
SUBSTRATE_HOLDER  environment default for the acting name. Export it once per session:
                  export SUBSTRATE_HOLDER=<name>
                It defaults --holder, and fills the participant on journal entries and closures.
--participant   who authored one journal entry or closure; overrides SUBSTRATE_HOLDER.
                With neither, the entry records "(none recorded)" and the CLI warns.
--attested-by   who attested readiness (sb issue attest); independent of the claim holder.
--policy        scrutiny policy an attestation is made under (sb issue attest). Valid: default.
                The set is defined by DEFAULT_SCRUTINY_POLICY_REF in src/domain/readiness.ts.
--actor         closure actor label (sb issue close); defaults to sb-cli.

- A claim says who owns the work; it does not narrate progress and is not readiness.
- The edit gate allows edits only for the live holder: SUBSTRATE_HOLDER must equal the
  claim holder.
- Session identity is runtime-known (XTRM_SESSION_ID); the CLI never invents it.
- xt claude|pi|codex <name> exports SUBSTRATE_HOLDER, which is why an xt session claims
  without restating its name. resolveClaimHolder (XTRM-722) is the only holder source:
  the flag wins, then the variable, then the command fails closed.
- XTRM_SESSION_NAME is shared by every pane of a tmux session and is never an identity.
- The holder is never derived from a worktree path, a branch, or the unix user.`,
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

creates an issue; --contract takes a JSON file path or inline JSON. Scrutiny is required: --scrutiny wins when present, otherwise the contract file's own scrutiny applies; a missing or invalid value fails closed. A prose validation/output entry is normalised to {check}/{artifact} and reported, never rejected.`,
  "issue.show": `usage: sb issue show <ref>

prints the issue header plus the contract body (human) or full payload (with --json), followed by a bounded operational context: the most recent journal entries (summaries truncated), the newest entry per kind, per-kind counts, the closure view and the provenance summary. An issue with no journal entries prints an explicit empty state. The full journal is never dumped; use "sb journal show" for bodies.`,
  "issue.edit": `usage: sb issue edit <ref> [--project <id>] [--contract <file|json>] [--title <t>] [--priority <n>] [--scrutiny <s>] [--ownership <file|json>] [--context-refs <file|json>] [--expected-revision <n>]

--title/--priority are metadata (no revision, readiness retained); --contract/--ownership/
--context-refs/--scrutiny are execution-relevant (new revision, readiness invalidated).
A prose validation/output entry in --contract is normalised to {check}/{artifact}
and reported, the same way creation normalises it. --ownership and --context-refs
carry the stored contract forward untouched: they never repair it.

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
  "issue.attest": `usage: sb issue attest <ref> --outcome <ready|reject> --policy <p> --attested-by <who> [--project <id>] [--evidence-refs <a,b>] [--blocking-gaps <a,b>]

--policy <p>  the scrutiny policy the attestation is made under. Valid values: default.
              The set is defined by DEFAULT_SCRUTINY_POLICY_REF in src/domain/readiness.ts
              (SCRUTINY_POLICIES holds the registered refs). An unknown value is refused
              with the valid values listed.
example:      sb issue attest <ref> --outcome ready --policy default --attested-by <you>`,
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
  "issue.renew": `usage: sb issue renew <ref> [--holder <who>] [--ttl-ms <n>] [--activation <id>] [--project <id>]

--holder defaults to SUBSTRATE_HOLDER, exactly as for claim and release. The
lease keeps its generation; only its expiry moves.`,
  "issue.release": `usage: sb issue release <ref> [--holder <who>] [--activation <id>] [--project <id>]

--holder defaults to SUBSTRATE_HOLDER, so a session releases its own claim
without restating the name. Releasing another holder's claim still requires
the explicit flag, and the same fail-closed rule applies when neither is set.`,
  "issue.close": `usage: sb issue close <ref> --outcome <completed|superseded|duplicate|wont_fix|invalid|cancelled|abandoned> --reason <r> [--actor <who>] [--participant <id>] [--run <id>] [--activation <id>] [--attempt <id>] [--result <a,b>] [--receipt <a,b>] [--validation <a,b>] [--artifact <a,b>] [--force-close-with-open-blocker <why>] [--project <id>]

writes an immutable Closure row (outcome, reason, actor, session, revision/hash, refs) and rests on done (cancelled for the cancelled outcome). Bare \`sb issue close <ref>\` stays the legacy lifecycle alias (no Closure invented).

Blockers: a close is refused while a declared blocking dependency is still open,
because a terminal issue whose own dependency is unresolved cannot be told apart
from an ordered close. A blocker is satisfied only when it is itself terminal
(done or archived): an open PR is not evidence, and neither is a merged one,
because this guard reads the blocker's lifecycle state and not its PRs. The
refusal names each open blocker by ref. To close
anyway, state why the dependency no longer binds with
--force-close-with-open-blocker <why>; that reason is recorded on the Closure
row. superseded|duplicate closes are exempt (they point at another issue rather
than claiming delivery), and the legacy bare close can only refuse: it writes no
Closure row, so it has nowhere to record an override.

Methodology: close answers WHY the Issue became terminal. Pick the bounded
outcome honestly (completed, superseded, duplicate, wont_fix, invalid,
cancelled, abandoned); the reason lives in the Closure row, never only in
git log. Cite the settlement evidence: --result journal result refs for the
bounded outcome, --validation/--receipt/--artifact for the proof. Each
evidence flag accepts a comma-separated list and may be repeated; repeated
values accumulate in caller order, never silently drop a value. Closure
rows are immutable history -- a mistaken close reopens, it never rewrites.
Stopping one execution is NOT a close: release the claim instead.`,
  "issue.state": `usage: sb issue state <ref> <open|deferred|done|cancelled|archived> [--until <ms|clear>] [--project <id>] [--link-gate warn|enforce|off] [--gate-override <reason>]

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
  feed --project <id> [--since <time|cursor>] [--before <cursor>] [--kind <k,...>] [--limit <n>]
  show <ref> [--kind <k>] [--limit <n> | --before <seq> --limit <n> | --tail <n>]
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
the delta after a cursor, latest/timeline for windows, feed for one page
across every Issue of a project.

Every verb runs over one JournalService; latest/timeline are bounded reads.`,
  "journal.append": `usage: sb journal append <ref> --kind <k> [--mechanical <file|json>] [--semantic <file|json>] [--summary-file <path|->] [--result <file|json>] [--refs <file|json>] [--project <id>]

--summary-file reads the summary text from a file (- = stdin); other --semantic
fields still apply. The file is read on this machine: in remote mode its bytes are
uploaded, so an absolute path, a relative path and - all work, and a path that
does not exist here is refused here. Summary text is limited to 20,000 characters:
a longer one fails and writes nothing (it is never cut). Put longer material in a
file and cite the path.

--kind result requires a bounded --result payload (summary required).

Methodology: append records continuity, never authority — the revision
never moves and readiness never goes stale. result carries a bounded
execution outcome with an optional result payload and is required for a
meaningful settlement: a progress note or a contract edit must not be used
in place of a result. checkpoint/compaction require the mechanical row;
query with show/since/latest/timeline, and resume from the capsule, not
from a full dump.`,
  "journal.checkpoint": `usage: sb journal checkpoint <ref> [--mechanical <file|json>] [--semantic <file|json>] [--workspace/--branch/--base-commit/--head-commit <v>] [--project <id>]`,
  "journal.show": `usage: sb journal show <ref> [--kind <k>] [--limit <n> | --before <seq> --limit <n> | --tail <n>]

returns full entry bodies (human prints semantic text; since stays compact).`,
  "journal.feed": `usage: sb journal feed --project <id> [--since <time|cursor>] [--before <cursor>] [--kind <k,...>] [--limit <n>]

Project-wide, newest first, one page per call: every journal entry of every
Issue of the project, each carrying its Issue ref. --limit is 1..500 (default
50). The response carries nextCursor: pass it back with --before to read older
entries, or with --since to poll for newer ones. --since also accepts an ISO
timestamp or an epoch-millisecond value; --before and --since cannot be
combined. --kind takes a comma-separated list of journal kinds.`,
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
           [--dispatcher-participant <holder>] [--dispatcher-session <id>]
  allocate <binding-id|ref> [--checkpoint <entry-id>]
  bind <receipt-id> <40-char-sha>
  trace <ref> | graph --project <id> | commit <sha> | receipt <id> | pr <ref>
  session <session-id> | activation <activation-id>
  bundle <ref> [--repo-root <dir>]

Methodology: provenance is the evidence spine, not narration. Dispatch
binds an execution to the Issue revision BEFORE work starts, so a later
contract edit binds anew instead of silently re-authorizing. allocate
creates the host-owned receipt for that binding (optionally pinned to the
journal checkpoint that settles it); bind links it to the commit carrying
the work, idempotently and never re-pointing. Trace reads
the spine (bindings, receipts with artifacts, attestation, claims,
closure); graph reads a whole project's dispatch tree in one bounded
call; commit/receipt/pr walk it backwards from an external id; session
and activation answer what one session touched or one activation produced.
Record what happened in the Journal and close with cited refs; never edit
the contract to narrate history.`,
  "provenance.dispatch": `usage: sb provenance dispatch <ref> [--workspace <dir>] [--participant/--activation/--attempt/--session/--base-commit <v>] [--claim-id <n>] [--dispatcher-participant <holder>] [--dispatcher-session <id>] [--project <id>]

--participant/--activation/--attempt/--session name the execution being
bound. --dispatcher-participant and --dispatcher-session name who dispatched
it and from which xtrm session; they are stored on the binding as observed
labels and printed by trace, session and activation. Both are optional and
independent: an omitted flag stores nothing, and a binding written without
them (or before migration 017) reads as absent, never as a placeholder. They are
never defaulted from the environment. --dispatcher-participant is a
shell-safe label; --dispatcher-session is a lowercase UUID or a tmux
session id ($N). A malformed value fails closed and writes no binding.`,
  "links": `usage: sb links <check|sync> [args...]\n\ncheck lists T2 candidates (PR commits that name an Issue in an XTRM-Issue trailer or an '(XTRM-nnn)' subject suffix); sync runs the one-shot reconciler.`,
  "links.check": `usage: sb links check [--issue <ref>] [--project <id>] [--repo owner/name] [--limit <n>] [--link-gate warn|enforce|off] [--dry-run]

Read-only. Without --issue, lists T2 candidates: PR commits whose XTRM-Issue
trailer names an Issue in this project. The scan uses --repo, or the current gh
repository when --repo is absent. With --issue, prints
the manual and auto gate verdicts and their codes, and exits 1 only when the
mode is enforce and the manual verdict is not pass. --dry-run is accepted and
writes nothing.`,
  "provenance.trace": `usage: sb provenance trace <ref>

reads the full lineage spine: execution bindings with their pinned
revisions, receipts with artifacts, attestation currency, claims and the
closure view. Human output names each binding's participant, activation,
session and dispatcher (participant and session, "dispatched by …") and
truncates a long spine; --json carries the untruncated spine, with
dispatcherParticipantId and dispatcherSessionId null where none was recorded.
Read-model only: nothing is created, and the revision never moves.
Methodology: trace to verify before dispatch and to audit after close; the
spine shows evidence, the Journal tells the story.`,
  "provenance.graph": `usage: sb provenance graph [--project <id>] [--since <ms|iso>] [--limit <n>]

the dispatch tree of one project as a bounded graph: nodes are
participants, activations, sessions, Issues (human refs) and pull requests;
edges are works_on (an execution binding's executor -> Issue), dispatched_by
(the binding's recorded dispatcher -> executor) and delivers (Issue -> PR,
live created_from links only). The executor is the binding's activation, else
its participant, else its session. A binding with no recorded dispatcher keeps its
edge with a null source, so a binding written before migration 017 reads as
unknown rather than as a guess. The default bound is 200 bindings
(max 1000), newest first; truncated is true exactly when omittedBindings is
above zero. --project resolves from --project, then SUBSTRATE_PROJECT, then
the checkout's binding. Read-model only: nothing is created, no revision
moves and no identity is defaulted from the environment.`,
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

what did this session touch: issues, bindings, receipts, artifacts, result
count, and who dispatched each binding (dispatchers).`,
  "provenance.activation": `usage: sb provenance activation <activation-id>

what did this activation produce: issues, bindings, receipts, artifacts, and
who dispatched each binding (dispatchers).`,
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

interface GhPrListRow { number: number; title: string; url: string }
interface GhPrCommit { oid: string; messageHeadline: string; messageBody?: string | null }
interface GhPrView { url: string; commits: GhPrCommit[] }

function ghJson<T>(args: string[]): T {
  const res = spawnSync("gh", args, { encoding: "utf8" });
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || "").trim();
    throw new Error(`gh ${args.join(" ")} failed: ${detail || `exit ${res.status}`}`);
  }
  try {
    return JSON.parse(res.stdout) as T;
  } catch {
    throw new Error(`gh ${args.join(" ")} returned invalid JSON`);
  }
}

function linkEventsFor(db: ReturnType<typeof openSubstrate>, issueId: string): Array<Record<string, unknown>> {
  const rows = db
    .prepare(
      `SELECT id, type, payload_json, created_at FROM issue_events
        WHERE issue_id = ? AND type GLOB 'provenance.link_*'
        ORDER BY id DESC LIMIT 20`,
    )
    .all(issueId) as unknown as Array<{ id: number; type: string; payload_json: string; created_at: number }>;
  return rows
    .reverse()
    .map((row) => ({ eventId: row.id, type: row.type, payload: JSON.parse(row.payload_json), createdAt: row.created_at }));
}

// XTRM-767: publish the same PR field set here as the reconciler-backed view
// (IssuePullRequestView). `state` alone made a freshly opened PR look anonymous
// in every payload that reads the link through this projection. `stateSource`
// is what keeps it honest: 'assumed' means the opener wrote it, 'observed'
// means a reconciler read refreshed it, and a field the row cannot carry
// (title, mergedAt before any read) stays null rather than being invented.
function primaryPrFor(db: ReturnType<typeof openSubstrate>, issueId: string): Record<string, unknown> | null {
  const link = db
    .prepare(
      `SELECT repository, number, relation, url FROM issue_pull_requests
        WHERE issue_id = ? AND superseded_at IS NULL
        ORDER BY CASE relation WHEN 'created_from' THEN 0 ELSE 1 END, created_at, rowid LIMIT 1`,
    )
    .get(issueId) as { repository: string; number: number; relation: string; url: string | null } | undefined;
  if (link === undefined) return null;
  const pr = db
    .prepare("SELECT state, state_source, title, merged_at FROM pull_requests WHERE repository = ? AND number = ?")
    .get(link.repository, link.number) as
    | { state: string; state_source: string | null; title: string | null; merged_at: number | null }
    | undefined;
  return {
    repository: link.repository,
    number: link.number,
    relation: link.relation,
    url: link.url,
    state: pr?.state ?? null,
    stateSource: pr?.state_source ?? null,
    title: pr?.title ?? null,
    mergedAt: pr?.merged_at ?? null,
  };
}

// Jira identity of an Issue (XTRM-814). Both verbs read and write
// external_bindings only; neither opens a network connection.
function runExternal(
  db: ReturnType<typeof openSubstrate>,
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string | undefined,
  flags: Flags,
  rest: string[],
): CliResult {
  const integration = new IntegrationService(db, svc);
  if (verb === "bind") {
    const ref = needRef(rest);
    const provider = flag(flags, "provider");
    if (provider !== "jira") throw new Error("usage: sb external bind <ref> --provider jira --scope <site:KEY> --id <n> --key <KEY-123> --url <browse-url> (only jira can be bound)");
    const need = (name: string): string => flag(flags, name) ?? (() => { throw new Error(`--${name} is required (sb external bind --help)`); })();
    const state = flag(flags, "state");
    if (state !== undefined && state !== "pending" && state !== "in_sync") throw new Error(`--state must be pending or in_sync (got ${state})`);
    const resolved = refInContext(svc, flags, ref);
    const result = integration.bindExternalKey(resolved.id, {
      provider: "jira",
      remoteScope: need("scope"),
      remoteId: need("id"),
      remoteKey: need("key"),
      url: need("url"),
      syncState: state,
      actor: tryHolder(flags) ?? "sb-cli",
    });
    const b = result.binding;
    return emit(ctx, command, {
      status: result.status,
      issue: result.issueRef,
      provider: b.provider,
      remoteScope: b.remoteScope,
      remoteId: b.remoteId,
      remoteKey: b.remoteKey,
      url: b.url,
      mode: b.mode,
      syncState: b.syncState,
    });
  }
  if (verb === "list") {
    const provider = flag(flags, "provider");
    if (provider !== undefined && provider !== "github" && provider !== "jira") throw new Error(`--provider must be github or jira (got ${provider})`);
    const limitRaw = flag(flags, "limit");
    const page = integration.listProjectBindings({
      projectId: projectOf(svc, flags),
      provider,
      remoteScope: flag(flags, "scope"),
      limit: limitRaw !== undefined ? Number(limitRaw) : undefined,
    });
    return emit(ctx, command, {
      bindings: page.bindings.map((b) => ({
        issue: b.issueRef,
        provider: b.provider,
        remoteScope: b.remoteScope,
        remoteId: b.remoteId,
        remoteKey: b.remoteKey,
        url: b.url,
        mode: b.mode,
        syncState: b.syncState,
      })),
      limit: page.limit,
      truncated: page.truncated,
    });
  }
  throw new Error("usage: sb external <bind|list> [options]");
}

function runLinks(
  db: ReturnType<typeof openSubstrate>,
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string | undefined,
  flags: Flags,
  rest: string[],
): CliResult {
  if (verb !== "check" && verb !== "sync") {
    throw new Error("usage: sb links <check|sync> [options]");
  }
  const dryRun = flags.has("dry-run");
  const repoDisc = discoverRepository();
  const resolved = svc.resolveProject({
    explicit: flag(flags, "project") ?? undefined,
    env: process.env["SUBSTRATE_PROJECT"],
    gitRoot: repoDisc.gitRoot,
    repositoryKey: repoDisc.identity?.repositoryKey ?? null,
  });
  let repo = flag(flags, "repo");
  if (repo === undefined && verb !== "sync" && flag(flags, "issue") === undefined) {
    const view = spawnSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { encoding: "utf8" });
    if (view.status !== 0) throw new Error("sb links check: pass --repo owner/name (gh repo view failed)");
    repo = view.stdout.trim();
  }
  const limit = Number(flag(flags, "limit") ?? 30);
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer");

  if (verb === "sync") {
    const since = flag(flags, "since") ?? null;
    if (since !== null && Number.isNaN(Date.parse(since))) throw new Error("--since must be an ISO timestamp");
    const repositoryRows = db
      .prepare("SELECT DISTINCT canonical_remote FROM repository_bindings WHERE project_id = ? AND canonical_remote LIKE 'github.com/%'")
      .all(resolved.projectId) as Array<{ canonical_remote: string }>;
    let repositories = repo !== undefined ? [repo] : repositoryRows.map((r) => r.canonical_remote.slice("github.com/".length));
    let onlyPr: { repository: string; number: number } | null = null;
    if (rest[0] !== undefined) {
      const canonical = canonicalPullReference(rest[0], ambientRepository(db, resolved.projectId));
      if (canonical === null) throw new Error(`invalid pull reference: ${rest[0]}`);
      onlyPr = { repository: canonical.repository, number: canonical.number };
      repositories = [canonical.repository];
    }
    if (repositories.length === 0) throw new Error("sb links sync: no github repository binding for this project; pass --repo owner/name");
    const report = new PullRequestSyncService(db, svc, prLinkService(db, svc), new GhCliPullRequestSource()).sync({
      projectId: resolved.projectId,
      repositories,
      limit,
      since,
      dryRun: flags.has("dry-run"),
      actor: tryHolder(flags) ?? "sb-cli",
      onlyPr,
    });
    if (ctx.json) return emit(ctx, command, report);
    const text = syncReportText(report);
    const lines = [text.summary, text.detail];
    return { code: report.failures > 0 && report.repositories === report.failures ? 1 : 0, stdout: lines.join("\n") + "\n", stderr: "" };
  }

  const gate = new LinkGateService(db, svc);
  const gateMode = gateModeFromEnv(flag(flags, "link-gate"));
  const issueFlag = flag(flags, "issue");
  const issuesWithLinks = issueFlag !== undefined
    ? [svc.resolveRef(issueFlag)]
    : (db
        .prepare(
          `SELECT DISTINCT i.id FROM issue_pull_requests l JOIN issues i ON i.id = l.issue_id
            WHERE i.project_id = ? AND l.superseded_at IS NULL LIMIT ?`,
        )
        .all(resolved.projectId, limit) as unknown as Array<{ id: string }>).map((r) => ({ id: r.id, humanRef: svc.getIssue(r.id).humanRef }));
  const verdicts = issuesWithLinks.map((issue) => ({
    issue: issue.humanRef,
    manual: gate.evaluate(issue.id, { mode: "manual" }),
    auto: gate.evaluate(issue.id, { mode: "auto" }),
  }));
  if (issueFlag !== undefined) {
    const v = verdicts[0]!;
    // XTRM-749: the exit status is the whole point of `--link-gate enforce`, so
    // it is computed before the output branch. emit() hard-codes code 0 for the
    // JSON envelope, which used to swallow the failure and let an enforcing
    // pipeline pass on a refusing verdict.
    const code = gateMode === "enforce" && v.manual.verdict !== "pass" ? 1 : 0;
    const payload = { issue: v, gateMode };
    if (ctx.json) return { ...emit(ctx, command, payload), code };
    return {
      code,
      stdout: [
        `LINKS CHECK — ${v.issue}`,
        `manual: ${v.manual.verdict}${v.manual.codes.length ? " " + v.manual.codes.join(", ") : ""}`,
        `auto:   ${v.auto.verdict}${v.auto.codes.length ? " " + v.auto.codes.join(", ") : ""}`,
      ].join("\n") + "\n",
      stderr: "",
    };
  }

  if (repo === undefined) throw new Error("--repo <owner/name> is required");
  const prs = ghJson<GhPrListRow[]>([
    "pr", "list", "--repo", repo, "--state", "all", "--limit", String(limit), "--json", "number,title,url",
  ]);
  const candidates: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const pr of prs) {
    const detail = ghJson<GhPrView>(["pr", "view", String(pr.number), "--repo", repo, "--json", "url,commits"]);
    for (const commit of detail.commits ?? []) {
      const message = `${commit.messageHeadline}\n${commit.messageBody ?? ""}`;
      // A branch written by `xt` names its issue in the `(XTRM-938)` subject
      // suffix, not in a trailer (XTRM-953). Reading only trailers reported a
      // branch with no linkable commits when every commit named one.
      const messageRefs = [
        ...new Set([
          ...parseAllTrailers(message).issues.map((i) => i.issueId),
          ...subjectIssueRefs(commit.messageHeadline),
        ]),
      ];
      for (const ref of messageRefs) {
        let issue;
        try {
          issue = svc.resolveRefInProject(ref, resolved.projectId);
        } catch {
          continue;
        }
        const key = `${issue.id}|${repo}#${pr.number}|${commit.oid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          issue: issue.humanRef,
          title: pr.title,
          repository: repo,
          number: pr.number,
          url: detail.url,
          sha: commit.oid,
        });
      }
    }
  }
  const findings = new PullRequestService(db).listFindings(resolved.projectId, 10);
  const payload = {
    dryRun,
    readOnly: true,
    project: resolved.projectId,
    repository: repo,
    scanned: prs.length,
    candidates,
    findings,
    gateMode,
    verdicts: verdicts.map((v) => ({ issue: v.issue, manual: v.manual.verdict, manualCodes: v.manual.codes, auto: v.auto.verdict, autoCodes: v.auto.codes })),
  };
  if (ctx.json) return emit(ctx, command, payload);
  const lines = [`LINKS CHECK — ${repo} · ${prs.length} PR(s) scanned · ${dryRun ? "dry run" : "read-only"}`];
  if (candidates.length === 0) lines.push("(no candidate: no commit names an Issue in an XTRM-Issue trailer or a (XTRM-nnn) subject suffix)");
  else {
    for (const c of candidates) {
      lines.push(`- ${String(c["issue"])}  ${String(c["repository"])}#${String(c["number"])}  ${String(c["sha"]).slice(0, 12)}  ${String(c["url"])}`);
    }
  }
  if (findings.length > 0) {
    lines.push("", "findings (provenance.link_finding):");
    for (const f of findings) lines.push(`- ${f.code}  ${f.repository ?? ""}#${f.number ?? ""}  ${(f.sha ?? "").slice(0, 12)}  ${f.detail ?? ""}`);
  }
  for (const v of verdicts) {
    lines.push(`- ${v.issue}  manual=${v.manual.verdict}${v.manual.codes.length ? "(" + v.manual.codes.join(",") + ")" : ""}  auto=${v.auto.verdict}${v.auto.codes.length ? "(" + v.auto.codes.join(",") + ")" : ""}`);
  }
  lines.push("read-only: no rows written");
  const refused = verdicts.some((v) => v.manual.verdict !== "pass");
  return { code: gateMode === "enforce" && refused ? 1 : 0, stdout: lines.join("\n") + "\n", stderr: "" };
}

// -- entry -------------------------------------------------------------------

// Fail-closed flag validation (xtrm-7wc.5.4): parseArgs accepts any --flag
// shape, so each command declares its allowlist here. An unknown flag
// names the offender instead of silently dropping operator intent.
const GLOBAL_FLAGS = ["db", "json"];

export const FLAG_ALLOWLIST: Record<string, string[]> = {
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
  "issue.link": ["project", "repo", "number", "url", "commit", "commits-range", "holder"],
  "issue.unlink": ["project", "repo", "number", "relation", "actor"],
  "issue.relate": ["project", "from", "to", "kind"],
  "issue.unrelate": ["project", "from", "to", "kind"],
  "issue.claim": ["project", "holder", "ttl-ms", "activation"],
  "issue.renew": ["project", "holder", "ttl-ms", "activation"],
  "issue.release": ["project", "holder", "activation"],
  "issue.close": ["project", "outcome", "reason", "actor", "participant", "run", "activation", "attempt", "result", "receipt", "validation", "artifact", "link-gate", "gate-override", "force-close-with-open-blocker"],
  "issue.state": ["project", "until", "actor", "link-gate", "gate-override"],
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
  "journal.append": ["project", "kind", "run", "participant", "activation", "session", "mechanical", "semantic", "summary-file", "result", "refs"],
  "journal.checkpoint": ["project", "run", "participant", "activation", "session", "mechanical", "semantic", "refs", "workspace", "branch", "base-commit", "head-commit"],
  "journal.show": ["kind", "limit", "before", "tail"],
  "journal.feed": ["project", "since", "before", "limit", "kind"],
  "journal.since": [],
  "journal.latest": ["kind"],
  "journal.timeline": ["kind", "limit"],
  "journal.render": ["sequence"],
  "provenance.attach": ["project", "receipt", "holder"],
  "external.bind": ["project", "provider", "scope", "id", "key", "url", "state", "holder"],
  "external.list": ["project", "provider", "scope", "limit"],
  "provenance.dispatch": ["project", "claim-id", "workspace", "participant", "activation", "attempt", "session", "base-commit", "dispatcher-participant", "dispatcher-session"],
  "provenance.allocate": ["project", "checkpoint"],
  "provenance.bind": [],
  "provenance.trace": [],
  "links.check": ["project", "repo", "limit", "dry-run", "issue", "link-gate"],
  "links.sync": ["project", "repo", "limit", "since", "dry-run", "holder"],
  "provenance.commit": [],
  "provenance.receipt": [],
  "provenance.pr": [],
  "provenance.session": [],
  "provenance.activation": [],
  "provenance.bundle": ["project", "repo-root"],
  "provenance.graph": ["project", "since", "limit"],
  "init.": [],
  "doctor": [],
  "remote.setup": ["server-root", "refresh"],
  "remote.disable": [],
  "remote.status": [],
  "import.beads": ["file", "project", "edges-file", "create-project", "dry-run"],
  "export.": ["project", "file"],
  "export.project": ["project", "file"],
};

const KNOWN_GROUPS = new Set(["init", "issue", "project", "plan", "journal", "provenance", "links", "external", "import", "export", "remote", "serve"]);

function assertKnownFlags(flags: Flags, command: string): void {
  const allowed = new Set([...GLOBAL_FLAGS, ...(FLAG_ALLOWLIST[command] ?? [])]);
  for (const name of flags.keys()) {
    if (allowed.has(name)) continue;
    // A flag and its value glued into one argv token ("--parent XTRM-1").
    const merged = /^(\S+)\s+(.+)$/.exec(name);
    const hint = merged ? `; flag and value must be separate arguments (--${merged[1]} ${JSON.stringify(merged[2])})` : "";
    throw new Error(`unknown flag --${name} for \`${command}\` (see usage)${hint}`);
  }
  assertFlagValues(flags, command);
}

// Flags that are presence-only for one command but not globally (the shared
// parser must not treat them as boolean everywhere: `--stdio` only exists for
// `serve`, and the remote forwarder decides value tokens by the global set).
const PRESENCE_FLAGS: Record<string, string[]> = { "serve.stdio": ["stdio"] };

// A value flag with no value used to become `true` and read back as absent,
// silently dropping operator intent.
function assertFlagValues(flags: Flags, command: string): void {
  const presenceOnly = new Set(PRESENCE_FLAGS[command] ?? []);
  for (const [name, value] of flags) {
    if (value !== true) continue;
    if (BOOLEAN_FLAGS.has(name) || presenceOnly.has(name)) continue;
    throw new Error(`--${name} requires a value`);
  }
}

// Verbs take one ref. Extra positional text used to be dropped silently, so a
// wrong invocation looked like a success.
const MAX_POSITIONALS: Record<string, number> = {
  "issue.state": 2,
  "issue.link": 3,
  "issue.unlink": 3,
  "journal.since": 2,
  "external.list": 0,
  "provenance.attach": 3,
  "provenance.bind": 2,
  "provenance.graph": 0,
  "remote.setup": 2,
};

function assertArity(command: string, rest: string[]): void {
  if (command === "issue.note") return; // positional text is the note body
  const max = MAX_POSITIONALS[command] ?? 1;
  if (rest.length <= max) return;
  const extra = rest.slice(max).join(" ");
  const hint = command === "journal.append" ? `; put the text in --semantic '{"summary":"…"}'` : "";
  throw new Error(
    `unexpected extra argument${rest.length - max === 1 ? "" : "s"}: ${JSON.stringify(extra)} (${command} takes ${max === 1 ? "one ref" : `${max} arguments`})${hint}`,
  );
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
    if (!group || (!verb && group !== "export" && group !== "init")) throw new Error("usage: sb [--db PATH] [--json] <init|issue|project|plan|journal|provenance|links|external|import|export|remote|serve> <verb> [args...]");
    if (group && KNOWN_GROUPS.has(group)) {
      const declared = `${group}.${verb ?? ""}`;
      assertKnownFlags(flags, declared);
      assertArity(declared, rest);
    }
    db = openSubstrate(ctx.dbPath);
    const svc = new IssueService(db);
    if (group === "init") {
      if (verb !== undefined) throw new Error("usage: sb init [--db PATH] [--json] (init takes no verbs)");
      return runInit(db, svc, ctx);
    }
    if (group === "issue") return runIssue(db, svc, ctx, command, verb, flags, rest);
    if (group === "project") return runProject(db, svc, ctx, command, verb, flags);
    if (group === "plan") return runPlan(db, svc, ctx, command, verb, flags);
    if (group === "links") return runLinks(db, svc, ctx, command, verb, flags, rest);
    if (group === "external") return runExternal(db, svc, ctx, command, verb, flags, rest);
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
    throw new Error(`unknown group: ${group} (want issue|project|plan|journal|provenance|links|external|import|export|remote)`);
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

// Claim/renew payload: ids stay for compatibility; the human ref and the ISO
// expiry are added so a confirmation never prints epoch milliseconds.
function claimData(
  humanRef: string,
  claim: { issueId: string; holder: string; expiresAt: number; generation: number },
  alreadyHeld: boolean,
  holderSource: string,
): Record<string, unknown> {
  return {
    issueId: claim.issueId,
    humanRef,
    holder: claim.holder,
    holderSource,
    expiresAt: claim.expiresAt,
    expiresAtIso: isoTime(claim.expiresAt),
    expiresInMinutes: Math.max(0, Math.round((claim.expiresAt - Date.now()) / 60000)),
    generation: claim.generation,
    alreadyHeld,
  };
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
// `force-close-with-open-blocker` is on this list for the reason the list
// exists: a caller who supplies it has opted into the Closure path, and leaving
// it off sent `--force-close-with-open-blocker "<why>"` without `--outcome`
// down the legacy branch, which discarded the sentence and refused the close
// (XTRM-959 review finding 6). The flag then fails loudly on --outcome instead.
const CLOSURE_FLAGS = ["outcome", "reason", "actor", "participant", "run", "activation", "attempt", "result", "receipt", "validation", "artifact", "force-close-with-open-blocker"];

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
  blockerOverride?: { reason: string; refs: string[] } | null;
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
    // XTRM-959: null means the close was not forced past an open blocker.
    blockerOverride: c.blockerOverride ?? null,
  };
}

function tryHolder(flags: Flags): string | null {
  try {
    return resolveClaimHolder(flag(flags, "holder") ?? undefined).holder;
  } catch {
    return null;
  }
}

/** Bare `#N` scope: the Issue's Project repository binding first, then the
 * checkout's github remote. Null means "no ambient repository". */
function ambientRepository(db: ReturnType<typeof openSubstrate>, projectId: string): string | null {
  // The issue's repository (its Project's single binding) wins over whatever
  // checkout the command happens to run in.
  const rows = db
    .prepare("SELECT DISTINCT canonical_remote FROM repository_bindings WHERE project_id = ? AND canonical_remote LIKE 'github.com/%'")
    .all(projectId) as Array<{ canonical_remote: string }>;
  if (rows.length === 1) return rows[0]!.canonical_remote.slice("github.com/".length);
  const disc = discoverRepository();
  const key = disc.identity?.repositoryKey ?? null;
  if (key !== null && key.startsWith("github.com/")) return key.slice("github.com/".length);
  return null;
}

// The git commands below run on whichever host executes this CLI: in remote
// mode `forwardCli` has already re-executed them on the registry host with the
// verified server checkout as cwd, so `process.cwd()` IS the object store the
// evidence must come from.
function readCommitEvidence(flags: Flags): Array<{ sha: string; message: string }> {
  const repoRoot = process.cwd();
  const out: Array<{ sha: string; message: string }> = [];
  // The object store lives on the registry checkout over `substrate.remote`,
  // not in the caller's cwd, so an unresolvable SHA is named with the
  // directory `<sha> was looked for in` (XTRM-953): "unknown revision" and
  // "bad object" for the same SHA are two different lies, and a caller cannot
  // tell a missing object from an unreachable checkout. Every git invocation
  // here is `git -C <repoRoot>` for the same reason.
  const git = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
    const res = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  };
  const range = flag(flags, "commits-range");
  if (range !== undefined) {
    if (!/^[0-9A-Za-z^~.]+\.\.[0-9A-Za-z^~.]+$/.test(range)) throw new Error("--commits-range must be <base>..<head>");
    const res = git(["log", "--format=%H%x1f%B%x1e", range]);
    if (res.status !== 0) {
      throw new Error(`git log ${range} failed in ${repoRoot}: ${res.stderr.trim()}`);
    }
    for (const record of res.stdout.split("\u001e")) {
      const text = record.trim();
      const cut = text.indexOf("\u001f");
      if (text === "" || cut < 0) continue;
      out.push({ sha: text.slice(0, cut).trim(), message: text.slice(cut + 1) });
    }
  }
  for (const sha of flagList(flags, "commit") ?? []) {
    if (!/^[0-9a-fA-F]{7,40}$/.test(sha)) throw new Error(`--commit is not a SHA: ${sha}`);
    const res = git(["show", "-s", "--format=%B", sha]);
    if (res.status !== 0) {
      throw new Error(
        `--commit ${sha}: git show failed in ${repoRoot} (${res.stderr.trim()}); ` +
          "the commit must be in that repository's object store - a commit that exists only in a local worktree is not visible here",
      );
    }
    out.push({ sha, message: res.stdout });
  }
  return out;
}

function prLinkService(db: ReturnType<typeof openSubstrate>, svc: IssueService): PullRequestService {
  return new PullRequestService(db, svc, new ProvenanceService(db, svc, new JournalService(db, svc)));
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
    case "link": {
      if (rest[0] !== "pr") throw new Error("usage: sb issue link pr <ref> --repo <owner/name> --number <n> [--url <url>] [--commit <sha>] [--commits-range <base>..<head>]");
      const ref = rest[1];
      if (ref === undefined) throw new Error("usage: sb issue link pr <ref> --repo <owner/name> --number <n>");
      const resolved = refInContext(svc, flags, ref);
      const repo = flag(flags, "repo");
      const number = Number(flag(flags, "number"));
      if (repo === undefined || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("--repo <owner/name> is required");
      if (!Number.isSafeInteger(number) || number < 1) throw new Error("--number <n> is required");
      const actor = tryHolder(flags) ?? "sb-cli";
      const service = prLinkService(db, svc);
      const commits = readCommitEvidence(flags);
      const result = commits.length > 0
        ? service.linkCommits({ issueId: resolved.id, repository: repo, number, commits, actor })
        : service.linkMention({ issueId: resolved.id, repository: repo, number, url: flag(flags, "url") ?? pullUrl(repo, number), actor });
      return emit(ctx, command, result);
    }
    case "unlink": {
      if (rest[0] !== "pr") throw new Error("usage: sb issue unlink pr <ref> --repo <owner/name> --number <n> [--relation <created_from|mentioned>] [--actor <name>]");
      const ref = rest[1];
      if (ref === undefined) throw new Error("usage: sb issue unlink pr <ref> --repo <owner/name> --number <n>");
      const resolved = refInContext(svc, flags, ref);
      const repo = flag(flags, "repo");
      const number = Number(flag(flags, "number"));
      if (repo === undefined) throw new Error("--repo <owner/name> is required");
      if (!Number.isSafeInteger(number) || number < 1) throw new Error("--number <n> is required");
      const relation = flag(flags, "relation");
      if (relation !== undefined && relation !== "created_from" && relation !== "mentioned") {
        throw new Error("--relation must be created_from or mentioned");
      }
      const actor = flag(flags, "actor") ?? tryHolder(flags) ?? "sb-cli";
      const removed = prLinkService(db, svc).unlink({ issueId: resolved.id, repository: repo, number, relation: relation as never, actor });
      return emit(ctx, command, { superseded: removed });
    }
    case "create": {
      const project = projectOf(svc, flags);
      const title = flag(flags, "title") ?? (() => { throw new Error("--title is required"); })();
      const kind = flag(flags, "kind") ?? (() => { throw new Error("--kind is required"); })();
      const contractRaw = flag(flags, "contract") ?? (() => { throw new Error("--contract <file|json> is required"); })();
      const parent = flag(flags, "parent");
      const parsedContract = readJsonArg(contractRaw) as unknown;
      // Slight shape errors are repaired, not rejected (XTRM-786): prose
      // validation/output entries become {check}/{artifact} before the shape
      // assertion, and the command reports what it repaired. An entry that
      // cannot be repaired unambiguously throws here, naming the field, the
      // entry and the expected shape.
      const { contract, repairs } = normaliseContract(parsedContract);
      // SCRUTINY precedence (fail closed, never a silently-broken draft): an
      // explicit --scrutiny wins; otherwise the contract file's own scrutiny
      // applies as the default. Read the key before the shape assertion so a
      // malformed contract still reports the contract error, not scrutiny.
      const contractScrutiny =
        typeof parsedContract === "object" && parsedContract !== null && !Array.isArray(parsedContract)
          ? (parsedContract as Record<string, unknown>)["scrutiny"]
          : undefined;
      assertContractShape(contract);
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
        contract,
        priority: flag(flags, "priority") !== undefined ? Number(flag(flags, "priority")) : undefined,
        scrutiny,
        parentId: parent ? svc.resolveRefInProject(parent, project).id : undefined,
        authoredBy: "sb-cli",
      });
      return emit(ctx, command, {
        ...issueSummary(svc.getIssue(issue.id)),
        ...(repairs.length > 0 ? { contractNormalised: repairs } : {}),
      });
    }
    case "show": {
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const readiness = svc.getReadiness(resolved.id);
      const contract = svc.getRevision(resolved.id, resolved.currentRevision).contract;
      // Bounded operational context (ADR §50): every read is bounded, so a
      // large journal never enlarges the default show output.
      const operationalContext = new JournalService(db, svc).operationalContext(resolved.id);
      const pullRequests = new PullRequestService(db).listForIssue(resolved.id);
      const gateEvaluation = new LinkGateService(db, svc).evaluate(resolved.id, { mode: "manual" });
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
        pullRequests,
        primaryPr: primaryPrFor(db, resolved.id),
        linkEvents: linkEventsFor(db, resolved.id),
        linkGate: { mode: "manual", manual: { verdict: gateEvaluation.verdict, codes: gateEvaluation.codes } },
      };
      if (ctx.json) return emit(ctx, command, payload);
      return {
        code: 0,
        stdout:
          [
            human(issueSummary(resolved)),
            ...contractSections(contract),
            ...renderPullRequests(pullRequests),
            ...renderOperationalContext(operationalContext),
          ].join("\n") +
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
      let repairs: ContractRepair[] = [];
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
        const supplied = contractRaw !== undefined;
        const base =
          supplied
            ? (readJsonArg(contractRaw) as never)
            : (svc.getRevision(id, svc.getIssue(id).currentRevision).contract as never);
        // The service repairs a contract the caller SUPPLIED and reports what it
        // repaired (XTRM-786). A metadata-only edit carries the stored contract
        // forward unrepaired, so a contract pinned before this change is never
        // rewritten by an ownership/context edit.
        const { issue, created, repairs: normalised } = svc.updateContract(id, base, "sb-cli", {
          expectedRevision: expected !== undefined ? Number(expected) : undefined,
          ownership: ownershipRaw !== undefined ? readJsonArg(ownershipRaw) : undefined,
          contextRefs: contextRaw !== undefined ? (readJsonArg(contextRaw) as unknown[]) : undefined,
          repair: supplied,
        });
        repairs = normalised;
        id = issue.id;
        revisionCreated = revisionCreated || created;
      }
      if (scrutiny !== undefined) {
        const before = svc.getIssue(id).currentRevision;
        const next = svc.setScrutiny(id, scrutiny);
        revisionCreated = revisionCreated || next.currentRevision !== before;
        id = next.id;
      }
      return emit(ctx, command, {
        ...issueSummary(svc.getIssue(id)),
        revisionCreated,
        ...(repairs.length > 0 ? { contractNormalised: repairs } : {}),
      });
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
      let interpretedEnvelope = false;
      if (resultRaw !== undefined) {
        const parsed = readJsonArg(resultRaw) as ResultPayload;
        assertResultPayload(parsed);
        result = parsed;
      } else if (kindRaw === "result") {
        // Text is the bounded result summary; structured fields stay optional. A file holding
        // the envelope is stored as structure, not as escaped JSON in the summary (XTRM-835).
        const envelope = resultEnvelopeFromText(text);
        if (envelope) {
          result = envelope;
          interpretedEnvelope = true;
        } else {
          result = { summary: text };
        }
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
      // Say what the text was taken to be: a file that holds the envelope is structure, and
      // the caller should learn that rather than discover it in `journal show` (XTRM-835).
      const note =
        interpretedEnvelope
          ? `note: stored the result envelope as structured fields (summary, ${RESULT_FIELDS.filter((f) => f !== "summary").join("|")} when present)\n`
          : "";
      return { code: 0, stdout: journalLine(svc, entry) + "\n", stderr: note };
    }
    case "validate": {
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const r = svc.getReadiness(resolved.id);
      // Shape hints sit beside the structural verdict: a validation entry written
      // as a plain string is the most common reason a contract stays draft, and
      // naming the expected shape saves a round trip.
      const revision = svc.getRevision(resolved.id, r.revision);
      const hints = contractShapeHints(revision.contract);
      return emit(ctx, command, {
        issueId: r.issueId,
        revision: r.revision,
        state: r.state,
        dispatchable: r.dispatchable,
        reasons: r.reasons,
        structurallyValid: r.structurallyValid,
        attestationCurrent: r.attestationCurrent,
        unsatisfiedBlockers: r.unsatisfiedBlockers,
        ...(hints.length > 0 ? { shapeHints: hints } : {}),
      });
    }
    case "attest": {
      const ref = needRef(rest);
      const outcome = flag(flags, "outcome") ?? (() => { throw new Error("--outcome <ready|reject> is required"); })();
      const policy = flag(flags, "policy") ?? (() => { throw new Error("--policy is required"); })();
      const validPolicies = scrutinyPolicyRefs();
      if (!validPolicies.includes(policy)) {
        throw new Error(
          `unknown --policy "${policy}"; valid values: ${validPolicies.join(", ")} (defined by DEFAULT_SCRUTINY_POLICY_REF in src/domain/readiness.ts; the default is "${DEFAULT_SCRUTINY_POLICY_REF}")`,
        );
      }
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
      const enriched = {
        ...page,
        rows: page.rows.map((row) => ({ ...row, primaryPr: primaryPrFor(db, row.id) })),
      };
      if (ctx.json) return emit(ctx, command, enriched);
      return emit(ctx, command, enriched.rows.map((r) => readySummary(boardRowSummaryInput(r), r.readinessState, r.dispatchable)));
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
      const prior = svc.getActiveClaim(resolved.id);
      const claim = svc.claimIssue(resolved.id, holder.holder, {
        activationId: flag(flags, "activation"),
        ttlMs: ttl !== undefined ? Number(ttl) : undefined,
      });
      // alreadyHeld: the caller already owned the live lease, so nothing was
      // stolen and the confirmation should say so.
      return emit(ctx, command, claimData(resolved.humanRef, claim, prior?.id === claim.id, holder.source));
    }
    case "renew": {
      const ref = needRef(rest);
      // Same holder rule as claim: --holder, else the ambient SUBSTRATE_HOLDER,
      // else fail closed. Renewing keeps the generation and moves the expiry.
      const holder = resolveClaimHolder(flag(flags, "holder"));
      const ttl = flag(flags, "ttl-ms");
      const resolved = refInContext(svc, flags, ref);
      const claim = svc.renewClaim(resolved.id, holder.holder, {
        activationId: flag(flags, "activation"),
        ttlMs: ttl !== undefined ? Number(ttl) : undefined,
      });
      // A renewal always finds the caller already holding the lease; that is what
      // renewing means, and the flag says so instead of implying a fresh claim.
      return emit(ctx, command, claimData(resolved.humanRef, claim, true, holder.source));
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
      const moved = svc.setLifecycleState(resolved.id, to as (typeof STATES)[number], undefined, {
        actor: flag(flags, "actor") ?? "sb-cli",
        linkGate: (flag(flags, "link-gate") as never) ?? undefined,
        gateOverride: flag(flags, "gate-override") ?? undefined,
      });
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
        // XTRM-959: the legacy alias writes no Closure row, so it has nowhere
        // to record an override and can only refuse. Deliberate closes go
        // through --outcome with --force-close-with-open-blocker.
        new ClosureService(db, svc).assertNoOpenBlockers(resolved.id);
        const closed = svc.setLifecycleState(resolved.id, "done", undefined, {
          actor: flag(flags, "actor") ?? "sb-cli",
          linkGate: (flag(flags, "link-gate") as never) ?? undefined,
          gateOverride: flag(flags, "gate-override") ?? undefined,
        });
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
        linkGate: (flag(flags, "link-gate") as never) ?? undefined,
        gateOverride: flag(flags, "gate-override") ?? undefined,
        blockerOverrideReason: flag(flags, "force-close-with-open-blocker") ?? null,
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
    // ADR-009: present on a degraded row, null on a clean one. The marker is
    // the whole rendering: it is never collapsed into a summary field.
    unreadable: (e as JournalEntry & { unreadable?: string }).unreadable ?? null,
  };
}

// ADR-009 count line: a read that degraded must not look clean.
function degradedLine(n: number): string {
  return `degraded: ${n} unreadable journal ${n === 1 ? "entry" : "entries"}`;
}

function journalLine(svc: IssueService, e: JournalEntry): string {
  const marker = (e as JournalEntry & { unreadable?: string }).unreadable;
  if (marker) return marker;
  const issue = svc.getIssue(e.issueId);
  // XTRM-449: explicit absence, matching the journal-family convention in
  // journalIdentity — never a blank that is indistinguishable from a capture gap.
  const actor = e.participantId ? ` · by ${e.participantId}` : " · by (none recorded)";
  // XTRM-420: "(mechanical-only)" is a claim about stored evidence. Say it only
  // when a mechanical payload exists; a row with neither payload is evidence-less.
  const payload = e.semantic
    ? ""
    : e.result
      ? ` (result ${e.result.outcome ?? "recorded"})`
      : e.mechanical
        ? " (mechanical-only)"
        : " (no payload)";
  return `${issue.locator} · ${issue.humanRef} · seq${e.sequence} ${e.kind} rev${e.issueRevision}${payload}${actor}`;
}

// Stored execution identity for `journal show` (XTRM-410): names the actor
// for a row that carries one, and says so explicitly for a row that does
// not — never a blank that is indistinguishable from a capture gap, and
// never an invented actor.
/**
 * A result payload that arrived as file text (`issue note --kind result --file`) rather
 * than through `--result`. Callers write the structured envelope to a file, and storing
 * it verbatim made `result.summary` escaped JSON, which human `journal show` then
 * rendered as a brace-and-quote blob (XTRM-835). Accept the envelope as structure;
 * anything that is not one stays prose, so a summary that merely starts with `{` is safe.
 */
function resultEnvelopeFromText(text: string): ResultPayload | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, "summary")) return null;
  for (const key of Object.keys(record)) {
    if (key === "resultVersion") continue;
    if (!(RESULT_FIELDS as readonly string[]).includes(key)) return null;
  }
  const summary = record.summary;
  if (typeof summary !== "string" || summary.trim() === "") return null;
  assertResultPayload(record);
  return record as unknown as ResultPayload;
}

function journalIdentity(e: JournalEntry): string {
  const facets: string[] = [];
  if (e.participantId) facets.push(e.participantId);
  if (e.sessionId) facets.push(`session ${e.sessionId}`);
  if (e.activationId) facets.push(`activation ${e.activationId}`);
  if (e.runId) facets.push(`run ${e.runId}`);
  return facets.length > 0 ? `  actor: ${facets.join(" · ")}` : "  actor: (none recorded)";
}

// Full-body human rendering for `journal show` (xtrm-7wc.6.2): the header
// line plus the entry-scoped semantic text, or the bounded result evidence a
// result row carries instead of a semantic summary (XTRM-832). `since` stays
// compact by contract; mechanical payloads ride JSON only, presence-only here.
function journalBody(e: JournalEntry): string[] {
  // A marker stands alone: the row has no payload to describe.
  if ((e as JournalEntry & { unreadable?: string }).unreadable) return [];
  const lines: string[] = [journalIdentity(e)];
  const sem = e.semantic;
  if (!sem) {
    // A result row has no semantic summary; the header only names the outcome,
    // so the evidence must be rendered here or human show hides it.
    const r = e.result;
    if (!r) return lines;
    // A legacy row can hold an empty summary (the writer used to accept it).
    const summary = typeof r.summary === "string" ? r.summary.trim() : "";
    const outcome = r.outcome ? ` (${r.outcome})` : "";
    lines.push(summary ? `  result: ${summary}${outcome}` : `  result: (no summary recorded)${outcome}`);
    for (const [label, values] of [
      ["completed", r.completed],
      ["findings", r.findings],
    ] as const) {
      if (values && values.length > 0) lines.push(`  ${label}: ${values.join("; ")}`);
    }
    return lines;
  }
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
      const input = {
        kind: kindRaw,
        ...contextFlags,
        mechanical: mechRaw !== undefined ? (mechanicalArg(svc, resolved.id, mechRaw) as never) : undefined,
        semantic: semanticArg(semRaw, flag(flags, "summary-file")) as never,
        result: resRaw !== undefined ? (readJsonArg(resRaw) as ResultPayload) : undefined,
        refs: refsRaw !== undefined ? (readJsonArg(refsRaw) as never) : undefined,
        executionContext: undefined,
      };
      // The seam owns the rule and refuses an empty entry; the CLI only reports
      // the warnings it accepts the entry with, so a weak summary is visible
      // instead of silently occupying a sequence number.
      const warnings = assessJournalEntry(input).warnings;
      const entry = journal.appendEntry(resolved.id, input);
      const stderr = warnings.map((w) => `warning: ${w}\n`).join("");
      if (ctx.json) return emit(ctx, command, { ...journalSummary(entry), result: entry.result, warnings });
      return { code: 0, stdout: journalLine(svc, entry) + "\n", stderr };
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
      const beforeRaw = flag(flags, "before");
      const tailRaw = flag(flags, "tail");
      if (tailRaw !== undefined && (beforeRaw !== undefined || limitRaw !== undefined)) {
        throw new Error("--tail cannot be combined with --before or --limit");
      }
      const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) throw new Error("--limit must be a positive integer");
      const before = beforeRaw !== undefined ? Number(beforeRaw) : undefined;
      if (before !== undefined && (!Number.isInteger(before) || before <= 0)) {
        throw new Error("--before must be a positive integer sequence");
      }
      const tail = tailRaw !== undefined ? Number(tailRaw) : undefined;
      if (tail !== undefined && (!Number.isInteger(tail) || tail <= 0)) throw new Error("--tail must be a positive integer");
      // --tail is the newest window (paging starts at the end); --before is the
      // backwards cursor for older pages. --limit alone keeps its oldest-first
      // meaning so existing callers are unaffected.
      const entries =
        tail !== undefined
          ? journal.timeline(resolved.id, { kind: kindRaw as never, limit: tail })
          : journal.listEntries(resolved.id, { kind: kindRaw as never, limit, before });
      // show returns full entry bodies (semantic + mechanical payloads in
      // JSON; semantic text under the header line in human). since stays
      // compact: deltas carry journalSummary only.
      if (ctx.json) return emit(ctx, command, entries.map((e) => ({ ...journalSummary(e), semantic: e.semantic, mechanical: e.mechanical, result: e.result })));
      const lines = entries.flatMap((e) => [journalLine(svc, e), ...journalBody(e)]);
      if (entries.degraded > 0) lines.push(degradedLine(entries.degraded));
      return { code: 0, stdout: (lines.length > 0 ? lines.join("\n") : "(no journal entries)") + "\n", stderr: "" };
    }
    case "feed": {
      // Project-wide page, newest first (XTRM-764). The cursor is opaque: the
      // caller passes nextCursor back with the same flag it came from.
      const sinceRaw = flag(flags, "since");
      const beforeRaw = flag(flags, "before");
      if (sinceRaw !== undefined && beforeRaw !== undefined) {
        throw new Error("--since and --before cannot be combined");
      }
      const limitRaw = flag(flags, "limit");
      const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) throw new Error("--limit must be a positive integer");
      const kindRaw = flag(flags, "kind");
      const kinds = kindRaw === undefined ? null : kindRaw.split(",").map((k) => k.trim()).filter((k) => k !== "");
      for (const kind of kinds ?? []) {
        if (!isJournalKind(kind)) throw new Error(`unknown journal kind: ${kind}`);
      }
      const repoDisc = discoverRepository();
      const resolvedProject = svc.resolveProject({
        explicit: flag(flags, "project") ?? undefined,
        env: process.env["SUBSTRATE_PROJECT"],
        gitRoot: repoDisc.gitRoot,
        repositoryKey: repoDisc.identity?.repositoryKey ?? null,
      });
      let cursor: { time: number; id: string } | undefined;
      let direction: "before" | "newer" | undefined;
      let sinceTime: number | null = null;
      if (beforeRaw !== undefined) {
        cursor = decodeFeedCursor(beforeRaw);
        direction = "before";
      } else if (sinceRaw !== undefined) {
        // A cursor or a time: a cursor polls forwards, a time bounds the page.
        let parsedCursor: { time: number; id: string } | null = null;
        try {
          parsedCursor = decodeFeedCursor(sinceRaw);
        } catch {
          parsedCursor = null;
        }
        if (parsedCursor !== null) {
          cursor = parsedCursor;
          direction = "newer";
        } else {
          const asNumber = Number(sinceRaw);
          const ms = Number.isFinite(asNumber) && Number.isInteger(asNumber) ? asNumber : Date.parse(sinceRaw);
          if (!Number.isFinite(ms)) throw new Error("--since must be an ISO timestamp, an epoch-millisecond value or a feed cursor");
          sinceTime = ms;
        }
      }
      const page = journal.feed({ projectId: resolvedProject.projectId, limit, kinds: kinds as never, cursor, direction, sinceTime });
      const data = {
        projectId: page.projectId,
        limit: page.limit,
        nextCursor: page.nextCursor,
        degraded: page.degraded,
        entries: page.entries.map((e) => ({ issueRef: e.issueRef, issueId: e.issueId, ...journalSummary(e.entry), semantic: e.entry.semantic, result: e.entry.result })),
      };
      if (ctx.json) return emit(ctx, command, data);
      // One line per entry plus its short text: the feed is read as a stream, so
      // the summary is the payload that makes a page useful without a follow-up
      // `journal show` per row.
      const lines = page.entries.flatMap((e) => {
        // journalLine already starts with the Issue label, which is unique per
        // project, so the ref is not repeated here.
        const head = journalLine(svc, e.entry);
        const summary = e.entry.semantic?.summary ?? e.entry.result?.summary ?? null;
        return summary === null ? [head] : [head, `    ${summary.split("\n")[0]!.slice(0, 200)}`];
      });
      const degraded = page.degraded > 0 ? `\n${degradedLine(page.degraded)}` : "";
      const tail = page.nextCursor === null ? "" : `\nnext: sb journal feed --project ${page.projectId} --before ${page.nextCursor}`;
      return { code: 0, stdout: (lines.length > 0 ? lines.join("\n") : "(no journal entries in this project)") + degraded + tail + "\n", stderr: "" };
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
        degraded: delta.degraded,
        entries: delta.entries.map(journalSummary),
      };
      if (ctx.json) return emit(ctx, command, data);
      const lines = delta.entries.map((e) => journalLine(svc, e));
      if (delta.degraded > 0) lines.push(degradedLine(delta.degraded));
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
        return emit(ctx, command, { count: entries.length, degraded: entries.degraded, entries: entries.map(journalSummary) });
      }
      const lines = entries.map((e) => journalLine(svc, e));
      if (entries.degraded > 0) lines.push(degradedLine(entries.degraded));
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
      throw new Error(`unknown journal verb: ${verb} (want append|checkpoint|feed|show|since|latest|timeline|render)`);
  }
}

// -- provenance verbs (Phase 8, bead xtrm-7wc.9) --------------------------------
// Thin over ProvenanceService: dispatch freezes the exact revision/hash,
// trace/commit/receipt/pr reconstruct lineage from host-owned rows.
// Receipt allocation and commit binding are host acts (XTRM-415/416): the
// CLI performs them on the operator's behalf — allocate copies revision and
// contract hash from the binding row, bind takes the SHA the caller has —
// and the hooks/service stay the automatic path. The revision never moves.

function bindingSummary(b: {
  id: string;
  issueId: string;
  issueRevision: number;
  contractHash: string;
  dispatcherParticipantId: string | null;
  dispatcherSessionId: string | null;
}): Record<string, unknown> {
  return {
    bindingId: b.id,
    issueId: b.issueId,
    revision: b.issueRevision,
    contractHash: b.contractHash,
    dispatcherParticipantId: b.dispatcherParticipantId,
    dispatcherSessionId: b.dispatcherSessionId,
  };
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
    case "attach": {
      const ref = needRef(rest);
      if (rest[1] !== "pr") throw new Error("usage: sb provenance attach <ref> pr <github:org/repo#n|org/repo#n|url|#n> [--receipt <id>]");
      const value = rest[2];
      if (value === undefined) throw new Error("usage: sb provenance attach <ref> pr <value> [--receipt <id>]");
      const resolved = refInContext(svc, flags, ref);
      const ambient = ambientRepository(db, resolved.projectId);
      const canonical = canonicalPullReference(value, ambient);
      if (canonical === null) {
        throw new Error(
          ambient === null
            ? `cannot resolve a bare ${value}: no ambient repository; use github:org/repo#n`
            : `invalid pull reference: ${value}`,
        );
      }
      const holder = tryHolder(flags);
      const view = new PullRequestService(db, svc, provenance).attachCreatedFrom({
        issueId: resolved.id,
        ambientRepo: ambient,
        actor: holder ?? "sb-cli",
        receiptId: flag(flags, "receipt"),
        holder: holder ?? undefined,
      }, canonical);
      return emit(ctx, command, { link: view });
    }
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
        dispatcherParticipantId: flag(flags, "dispatcher-participant"),
        dispatcherSessionId: flag(flags, "dispatcher-session"),
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
    case "graph": {
      const sinceRaw = flag(flags, "since");
      let since: number | null = null;
      if (sinceRaw !== undefined) {
        const raw = sinceRaw.trim();
        const asNumber = Number(raw);
        const ms = raw !== "" && Number.isInteger(asNumber) ? asNumber : Date.parse(raw);
        if (!Number.isFinite(ms) || ms < 0) throw new Error("--since must be an epoch-millisecond timestamp or an ISO timestamp");
        since = ms;
      }
      const limitRaw = flag(flags, "limit");
      let limit: number | undefined;
      if (limitRaw !== undefined) {
        limit = Number(limitRaw);
        if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer");
      }
      const graph = provenance.dispatchGraph(projectOf(svc, flags), { since, limit });
      if (ctx.json) return emit(ctx, command, graph);
      const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
      const name = (id: string | null): string => (id === null ? "(unknown)" : (label.get(id) ?? id));
      const lines = [
        `project ${graph.projectId}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, bindings ${graph.matchedBindings - graph.omittedBindings}/${graph.matchedBindings}${graph.truncated ? " (truncated)" : ""}`,
      ];
      if (graph.edges.length === 0) {
        lines.push("(no execution bindings in this project)");
      }
      for (const e of graph.edges) {
        if (e.kind === "dispatched_by") {
          const session = e.dispatcherSessionId === null ? "" : ` (sess ${e.dispatcherSessionId})`;
          lines.push(`${name(e.from)}${session} dispatched ${name(e.to)} on ${label.get(`issue:${e.issueId}`) ?? e.issueId}`);
        } else if (e.kind === "delivers") {
          lines.push(`${name(e.from)} delivers ${name(e.to)}`);
        } else {
          lines.push(`${name(e.from)} works on ${name(e.to)}`);
        }
      }
      if (graph.truncated) {
        lines.push(`omitted ${graph.omittedBindings} older binding(s): raise --limit or narrow --since`);
      }
      return { code: 0, stdout: lines.join("\n") + "\n", stderr: "" };
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
        ...renderDispatchers(detail.dispatchers),
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
        ...renderDispatchers(detail.dispatchers),
      ];
      return { code: 0, stdout: lines.join("\n") + "\n", stderr: "" };
    }
    default:
      throw new Error(`unknown provenance verb: ${verb} (want dispatch|allocate|bind|trace|graph|commit|receipt|pr|session|activation|bundle)`);
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
