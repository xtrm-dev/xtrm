#!/usr/bin/env node
// sb CLI vertical (Phase 4, bead xtrm-7wc.5). Thin consumer of the typed
// service: no SQL here, no business logic here. Readiness, claims, planning
// and identity resolution all live in IssueService / PlanningService; this
// process only parses argv, calls the service, and renders JSON or one-line
// human projections (hierarchical locator + durable reference; the opaque
// machine ID appears only in --json output).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { BEADS_TBD_MARKER, expectedProblemHead, importBeads, unionEdges, type BeadsEdgeRecord, type BeadsIssueRecord } from "../src/compatibility/beads/import.ts";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSubstrate } from "../src/store/sqlite.ts";
import { assertSchemaHealthy } from "../src/store/migrations/runner.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { RepositoryService } from "../src/service/repository-service.ts";
import { deriveBaseBranch, deriveRepositoryIdentity, type RepositoryIdentity } from "../src/domain/repository.ts";
import { PlanningService } from "../src/service/planning-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { IntegrationService } from "../src/service/integration-service.ts";
import { isJournalKind } from "../src/domain/journal.ts";
import type { JournalEntry, JournalKind } from "../src/domain/journal.ts";
import type { ResolvedIssue } from "../src/domain/issue.ts";

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
function issueSummary(i: ResolvedIssue): Record<string, unknown> {
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

function readySummary(i: ResolvedIssue, state: string, dispatchable: boolean): Record<string, unknown> {
  return { ...issueSummary(i), readinessState: state, dispatchable };
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

const BOOLEAN_FLAGS = new Set(["json", "help", "version", "dry-run"]);

function parseArgs(argv: string[]): { flags: Map<string, string | true>; positionals: string[] } {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i += 2;
      } else {
        flags.set(key, true);
        i += 1;
      }
    } else {
      positionals.push(a);
      i += 1;
    }
  }
  return { flags, positionals };
}

function flag(flags: Map<string, string | true>, name: string): string | undefined {
  const v = flags.get(name);
  return typeof v === "string" ? v : undefined;
}

function readJsonArg(value: string): unknown {
  try {
    return JSON.parse(readFileSync(value, "utf8"));
  } catch {
    return JSON.parse(value);
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
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
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

groups:
  init        initialize this repository (bind it to a Project; idempotent)
  issue       create|show|edit|note|validate|attest|list|ready|tree|children|relate|unrelate|claim|release|state|close|reopen|defer|cancel|archive|resume
  project     create|link|unlink
  plan        check|apply
  journal     append|checkpoint|show|since|render
  provenance  dispatch|trace|commit|receipt|pr|bundle
  import      beads
  export      project

flags:
  --db PATH   state.db path (default $SUBSTRATE_DB or ~/.xtrm/state.db)
  --json      machine-readable envelope {schema, command, ok, data|error}

help and --version never open or create the database.
per-verb help: sb issue create --help  |  sb help issue create`;

const COMMAND_HELP: Record<string, string> = {
  top: HELP_TOP,
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
  note <ref> ["text"] [--project <id>] [--kind <note|finding|decision|blocker|milestone|handoff>] [--file <path|->]
  validate <ref>
  attest <ref> --outcome <ready|reject> --policy <p> --attested-by <who> [--project <id>] [--evidence-refs <a,b>] [--blocking-gaps <a,b>]
  list [--project <id>] | ready [--project <id>]
  tree [--project <id> | --root <ref>] | children <ref>
  relate --from <ref> --to <ref> --kind <blocks|relates_to|discovered_from|supersedes|duplicates> [--project <id>]
  unrelate --from <ref> --to <ref> --kind <blocks|relates_to|discovered_from|supersedes|duplicates> [--project <id>]
  claim <ref> --holder <who> [--ttl-ms <n>] [--activation <id>] [--project <id>]
  release <ref> --holder <who> [--activation <id>] [--project <id>]
  state <ref> <open|deferred|done|cancelled|archived> [--until <ms|clear>] [--project <id>]
  close|reopen|cancel|archive <ref> [--project <id>]
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

creates an issue; --contract takes a JSON file path or inline JSON.`,
  "issue.show": `usage: sb issue show <ref>

prints the issue header plus the contract body (human) or full payload (with --json).`,
  "issue.edit": `usage: sb issue edit <ref> [--project <id>] [--contract <file|json>] [--title <t>] [--priority <n>] [--scrutiny <s>] [--ownership <file|json>] [--context-refs <file|json>] [--expected-revision <n>]

--title/--priority are metadata (no revision, readiness retained); --contract/--ownership/
--context-refs/--scrutiny are execution-relevant (new revision, readiness invalidated).`,
  "issue.note": `usage: sb issue note <ref> ["text"] [--project <id>] [--kind <note|finding|decision|blocker|milestone|handoff>] [--file <path|->]

appends an append-only journal note (no revision bump). --file - reads stdin.`,
  "issue.validate": `usage: sb issue validate <ref>

reports readiness state, structural validity, attestation currency, blockers.`,
  "issue.attest": `usage: sb issue attest <ref> --outcome <ready|reject> --policy <p> --attested-by <who> [--project <id>] [--evidence-refs <a,b>] [--blocking-gaps <a,b>]`,
  "issue.list": `usage: sb issue list [--project <id>]`,
  "issue.ready": `usage: sb issue ready [--project <id>]

lists dispatchable issues only.`,
  "issue.tree": `usage: sb issue tree [--project <id> | --root <ref>]`,
  "issue.children": `usage: sb issue children <ref>`,
  "issue.relate": `usage: sb issue relate --from <ref> --to <ref> --kind <blocks|relates_to|discovered_from|supersedes|duplicates> [--project <id>]

parent_child is structural and not exposed here.`,
  "issue.unrelate": `usage: sb issue unrelate --from <ref> --to <ref> --kind <blocks|relates_to|discovered_from|supersedes|duplicates> [--project <id>]

deactivates the active edge between the endpoints for the given kind.`,
  "issue.claim": `usage: sb issue claim <ref> --holder <who> [--ttl-ms <n>] [--activation <id>] [--project <id>]`,
  "issue.release": `usage: sb issue release <ref> --holder <who> [--activation <id>] [--project <id>]`,
  "issue.close": `usage: sb issue close <ref> [--project <id>]

moves the issue to lifecycle state done (alias for: sb issue state <ref> done).`,
  "issue.state": `usage: sb issue state <ref> <open|deferred|done|cancelled|archived> [--until <ms|clear>] [--project <id>]

sets the lifecycle state; every transition emits a durable issue.lifecycle event.
--until sets/clears the deferral timestamp (meaningful with deferred).`,
  "issue.reopen": `usage: sb issue reopen <ref> [--project <id>]

alias for: sb issue state <ref> open.`,
  "issue.defer": `usage: sb issue defer <ref> [--until <ms|clear>] [--project <id>]

alias for: sb issue state <ref> deferred [--until <ms|clear>].`,
  "issue.cancel": `usage: sb issue cancel <ref> [--project <id>]

alias for: sb issue state <ref> cancelled.`,
  "issue.archive": `usage: sb issue archive <ref> [--project <id>]

alias for: sb issue state <ref> archived.`,
  "issue.resume": `usage: sb issue resume <ref>

builds the continuity capsule (derived, never a source of truth).`,
  project: `usage: sb project <verb>

  create --prefix <PREFIX> --name <name> [--id <id>]
  link [--project <id>]     link the cwd checkout to a project
  unlink                    remove the cwd checkout link`,
  "project.create": `usage: sb project create --prefix <PREFIX> --name <name> [--id <id>]`,
  "project.link": `usage: sb project link [--project <id>]

links the cwd git checkout to a project (an administrative alias; normal work uses 'sb init').`,
  "project.unlink": `usage: sb project unlink`,
  plan: `usage: sb plan <check|apply> --file <plan.json>

check validates a plan draft; apply executes it.`,
  "plan.check": `usage: sb plan check --file <plan.json> [--project <id>]`,
  "plan.apply": `usage: sb plan apply --file <plan.json> [--project <id>]

validates the draft against the effective project context (ADR §5): every draft
target must belong to it unless --project / SUBSTRATE_PROJECT selects another
Project deliberately.`,
  journal: `usage: sb journal <verb> <ref> [flags]

  append <ref> --kind <checkpoint|handoff|milestone|decision|finding|blocker|compaction> [--mechanical <file|json>] [--semantic <file|json>] [--refs <file|json>] [--run/--participant/--activation/--session <id>]
  checkpoint <ref> [same flags plus --workspace/--branch/--base-commit/--head-commit]
  show <ref> [--kind <k>] [--limit <n>]
  since <ref> <cursor>
  render <ref> [--sequence <n>]`,
  "journal.append": `usage: sb journal append <ref> --kind <k> [--mechanical <file|json>] [--semantic <file|json>] [--refs <file|json>] [--project <id>]`,
  "journal.checkpoint": `usage: sb journal checkpoint <ref> [--mechanical <file|json>] [--semantic <file|json>] [--workspace/--branch/--base-commit/--head-commit <v>] [--project <id>]`,
  "journal.show": `usage: sb journal show <ref> [--kind <k>] [--limit <n>]

returns full entry bodies (human prints semantic text; since stays compact).`,
  "journal.since": `usage: sb journal since <ref> <cursor>

cursor read: only entries after the sequence cursor (0 reads all).`,
  "journal.render": `usage: sb journal render <ref> [--sequence <n>]

renders the latest (or selected) checkpoint as text.`,
  provenance: `usage: sb provenance <verb>

  dispatch <ref> [--workspace/--participant/--activation/--attempt/--session/--base-commit/--claim-id <v>]
  trace <ref> | commit <sha> | receipt <id> | pr <ref>
  bundle <ref> [--repo-root <dir>]`,
  "provenance.dispatch": `usage: sb provenance dispatch <ref> [--workspace <dir>] [--participant/--activation/--attempt/--session/--base-commit <v>] [--claim-id <n>] [--project <id>]`,
  "provenance.trace": `usage: sb provenance trace <ref>`,
  "provenance.commit": `usage: sb provenance commit <40-char-sha>`,
  "provenance.receipt": `usage: sb provenance receipt <id>`,
  "provenance.pr": `usage: sb provenance pr <provider-ref>`,
  "provenance.bundle": `usage: sb provenance bundle <ref> [--repo-root <dir>] [--project <id>]`,
  import: `usage: sb import beads --file <export.jsonl> --project <id> [--edges-file <f>] [--create-project <PREFIX:Name>] [--dry-run]`,
  "import.beads": `usage: sb import beads --file <export.jsonl> --project <id> [--edges-file <f>] [--create-project <PREFIX:Name>] [--dry-run]

one-way Beads migration; --dry-run reports counts without mutating.`,
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

// `sb init` (ADR §§2, 6, 84): discover -> Git common root -> derive repository
// identity -> detect base branch -> derive/find Project -> bind repository ->
// register the local checkout alias -> verify. Binding, deterministic adoption,
// the collision policy and the alias cache live in
// RepositoryService.bindRepository — this is not CLI recursion into
// `project create` + `project link`, and it never invents identity (ADR §98).
function runInit(db: ReturnType<typeof openSubstrate>, svc: IssueService, ctx: Ctx): CliResult {
  const repo = discoverRepository();
  if (repo.gitRoot === null) throw new Error("not inside a Git repository: cd into the repository checkout and run `sb init`");
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
  "issue.create": ["project", "title", "kind", "contract", "parent", "priority", "scrutiny"],
  "issue.show": [],
  "issue.edit": ["project", "contract", "title", "priority", "scrutiny", "ownership", "context-refs", "expected-revision"],
  "issue.note": ["project", "kind", "file"],
  "issue.validate": [],
  "issue.attest": ["project", "outcome", "policy", "attested-by", "evidence-refs", "blocking-gaps"],
  "issue.list": ["project"],
  "issue.ready": ["project"],
  "issue.tree": ["project", "root"],
  "issue.children": [],
  "issue.relate": ["project", "from", "to", "kind"],
  "issue.unrelate": ["project", "from", "to", "kind"],
  "issue.claim": ["project", "holder", "ttl-ms", "activation"],
  "issue.release": ["project", "holder", "activation"],
  "issue.close": ["project"],
  "issue.state": ["project", "until"],
  "issue.reopen": ["project"],
  "issue.defer": ["project", "until"],
  "issue.cancel": ["project"],
  "issue.archive": ["project"],
  "issue.resume": [],
  "project.create": ["prefix", "name", "id"],
  "project.link": ["project"],
  "project.unlink": [],
  "plan.check": ["project", "file"],
  "plan.apply": ["project", "file"],
  "journal.append": ["project", "kind", "run", "participant", "activation", "session", "mechanical", "semantic", "refs"],
  "journal.checkpoint": ["project", "run", "participant", "activation", "session", "mechanical", "semantic", "refs", "workspace", "branch", "base-commit", "head-commit"],
  "journal.show": ["kind", "limit"],
  "journal.since": [],
  "journal.render": ["sequence"],
  "provenance.dispatch": ["project", "claim-id", "workspace", "participant", "activation", "attempt", "session", "base-commit"],
  "provenance.trace": [],
  "provenance.commit": [],
  "provenance.receipt": [],
  "provenance.pr": [],
  "provenance.bundle": ["project", "repo-root"],
  "init.": [],
  "doctor": [],
  "import.beads": ["file", "project", "edges-file", "create-project", "dry-run"],
  "export.": ["project", "file"],
  "export.project": ["project", "file"],
};

const KNOWN_GROUPS = new Set(["init", "issue", "project", "plan", "journal", "provenance", "import", "export"]);

function assertKnownFlags(flags: Map<string, string | true>, command: string): void {
  const allowed = new Set([...GLOBAL_FLAGS, ...(FLAG_ALLOWLIST[command] ?? [])]);
  for (const name of flags.keys()) {
    if (!allowed.has(name)) throw new Error(`unknown flag --${name} for \`${command}\` (see usage)`);
  }
}

export function runCli(argv: string[], opts?: { dbPath?: string }): CliResult {
  const { flags, positionals } = parseArgs(argv);
  const ctx: Ctx = {
    dbPath: flag(flags, "db") ?? opts?.dbPath ?? process.env["SUBSTRATE_DB"] ?? join(homedir(), ".xtrm", "state.db"),
    json: flags.has("json"),
  };
  const [group, verb, ...rest] = positionals;
  const command = group && verb ? `${group}.${verb}` : (group ?? "");
  // Side-effect-free surface (§28): help/version never open SQLite.
  if (flags.has("help") || group === "help") return renderHelp(ctx, flags.has("help") ? positionals : positionals.slice(1));
  if (flags.has("version") || group === "version") return renderVersion(ctx);
  let db: ReturnType<typeof openSubstrate> | null = null;
  try {
    if (group === "doctor") {
      assertKnownFlags(flags, "doctor");
      if (verb !== undefined) throw new Error("usage: sb doctor [--db PATH] [--json] (doctor takes no verbs)");
      return runDoctor(ctx);
    }
    if (!group || (!verb && group !== "export" && group !== "init")) throw new Error("usage: sb [--db PATH] [--json] <init|issue|project|plan|journal|provenance|import|export> <verb> [args...]");
    if (group && KNOWN_GROUPS.has(group)) assertKnownFlags(flags, `${group}.${verb ?? ""}`);
    db = openSubstrate(ctx.dbPath);
    const svc = new IssueService(db);
    if (group === "init") {
      if (verb !== undefined) throw new Error("usage: sb init [--db PATH] [--json] (init takes no verbs)");
      return runInit(db, svc, ctx);
    }
    if (group === "issue") return runIssue(db, svc, ctx, command, verb, flags, rest);
    if (group === "project") return runProject(svc, ctx, command, verb, flags);
    if (group === "plan") return runPlan(db, svc, ctx, command, verb, flags);
    if (group === "journal") return runJournal(db, svc, ctx, command, verb, flags, rest);
    if (group === "provenance") return runProvenance(db, svc, ctx, command, verb, flags, rest);
    if (group === "import") return runImport(db, svc, ctx, command, verb, flags);
    if (group === "export") return runExport(db, svc, ctx, command, verb, flags);
    throw new Error(`unknown group: ${group} (want issue|project|plan|journal|provenance|import|export)`);
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

// cwd-aware resolution (bead xtrm-7wc.5.6): the CLI discovers the git root
// (presentation edge); the git-root->project mapping read stays in the
// service so resolution is live every invocation. Non-git cwd yields null
// and the service falls through to the repository binding, then the checkout
// link, then fail closed with the `sb init` guidance (ADR sbcloseout4 §§4-5).
//
// Repository, not worktree (ADR sbcloseout4 §7): a git worktree has its own
// toplevel but shares the repository's git directory, so keying on
// --show-toplevel gives every worktree a different identity and misses the
// repository's link row. --git-common-dir is shared by all worktrees of a
// repository; its parent is the primary checkout root, so worktrees resolve
// to the same project as their repository. Falls back to --show-toplevel on
// git < 2.31 (no --path-format), which degrades to the previous behaviour.
function gitOut(args: string[]): string | null {
  try {
    const out = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const trimmed = out.trim();
    return trimmed === "" ? null : trimmed;
  } catch {
    return null;
  }
}

function discoverGitRoot(): string | null {
  const commonDir = gitOut(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (commonDir !== null) return dirname(commonDir);
  return gitOut(["rev-parse", "--show-toplevel"]);
}

interface RepositoryDiscovery {
  gitRoot: string | null;
  identity: RepositoryIdentity | null;
  identityError: string | null;
  baseBranch: string | null;
}

// `git remote -v` rows: "origin\t<url> (fetch)". Same name+url seen as both
// fetch and push is one remote.
function parseRemotes(text: string | null): Array<{ name: string; url: string }> {
  if (text === null) return [];
  const remotes: Array<{ name: string; url: string }> = [];
  for (const line of text.split("\n")) {
    const m = /^(\S+)\t(\S+)\s+\((?:fetch|push)\)$/.exec(line.trim());
    if (!m) continue;
    const remote = { name: m[1]!, url: m[2]! };
    if (!remotes.some((r) => r.name === remote.name && r.url === remote.url)) remotes.push(remote);
  }
  return remotes;
}

// Repository discovery (ADR §§6-10). discoverGitRoot stays the worktree-aware
// common-root read; this sibling adds the identity evidence (remotes ->
// deriveRepositoryIdentity) and the base-branch evidence. Every Git read fails
// soft: a non-repository cwd, absent remote HEAD or ambiguous remotes yield
// nulls and the caller fails closed rather than inventing identity (ADR §98).
// `git rev-parse --abbrev-ref HEAD` is read because ADR §10 names the current
// branch as evidence the operator can see; deriveBaseBranch deliberately never
// uses it as a base, so a feature branch / detached HEAD cannot become one.
export function discoverRepository(): RepositoryDiscovery {
  const gitRoot = discoverGitRoot();
  const remotes = parseRemotes(gitOut(["remote", "-v"]));
  let identity: RepositoryIdentity | null = null;
  let identityError: string | null = null;
  try {
    identity = deriveRepositoryIdentity({ commonRoot: gitRoot, remotes });
  } catch (err) {
    identityError = err instanceof Error ? err.message : String(err);
  }
  const branches = gitOut(["branch", "--format=%(refname:short)"]);
  return {
    gitRoot,
    identity,
    identityError,
    baseBranch: deriveBaseBranch({
      remoteHead: gitOut(["symbolic-ref", "refs/remotes/origin/HEAD"]),
      configuredDefault: gitOut(["config", "init.defaultBranch"]),
      currentBranch: gitOut(["rev-parse", "--abbrev-ref", "HEAD"]),
      localBranches: branches === null ? [] : branches.split("\n"),
    }),
  };
}

// Effective project context (ADR §4): explicit flag > SUBSTRATE_PROJECT >
// initialized repository identity > explicit checkout link > fail closed.
function projectOf(svc: IssueService, flags: Map<string, string | true>): string {
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
function refInContext(svc: IssueService, flags: Map<string, string | true>, ref: string): ResolvedIssue {
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

function runIssue(
  db: ReturnType<typeof openSubstrate>,
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string,
  flags: Map<string, string | true>,
  rest: string[],
): CliResult {
  switch (verb) {
    case "create": {
      const project = projectOf(svc, flags);
      const title = flag(flags, "title") ?? (() => { throw new Error("--title is required"); })();
      const kind = flag(flags, "kind") ?? (() => { throw new Error("--kind is required"); })();
      const contractRaw = flag(flags, "contract") ?? (() => { throw new Error("--contract <file|json> is required"); })();
      const parent = flag(flags, "parent");
      const issue = svc.createIssue({
        projectId: project,
        title,
        kind: kind as never,
        contract: readJsonArg(contractRaw) as never,
        priority: flag(flags, "priority") !== undefined ? Number(flag(flags, "priority")) : undefined,
        scrutiny: flag(flags, "scrutiny"),
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
      };
      if (ctx.json) return emit(ctx, command, payload);
      return { code: 0, stdout: [human(issueSummary(resolved)), ...contractSections(contract)].join("\n") + "\n", stderr: "" };
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
      const ref = needRef(rest);
      const kindRaw = flag(flags, "kind") ?? "note";
      const NOTE_KINDS = ["note", "finding", "decision", "blocker", "milestone", "handoff"] as const;
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
      const entry = journal.appendEntry(resolved.id, {
        kind: kindRaw as JournalKind,
        semantic: { summary: text },
      });
      if (ctx.json) return emit(ctx, command, journalSummary(entry));
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
      const project = projectOf(svc, flags);
      return emit(ctx, command, svc.listIssues(project).map(issueSummary));
    }
    case "ready": {
      const project = projectOf(svc, flags);
      const out = [];
      for (const i of svc.listIssues(project)) {
        const r = svc.getReadiness(i.id);
        if (r.dispatchable) out.push(readySummary(i, r.state, true));
      }
      return emit(ctx, command, out);
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
      const holder = flag(flags, "holder") ?? (() => { throw new Error("--holder is required"); })();
      const ttl = flag(flags, "ttl-ms");
      const resolved = refInContext(svc, flags, ref);
      const claim = svc.claimIssue(resolved.id, holder, {
        activationId: flag(flags, "activation"),
        ttlMs: ttl !== undefined ? Number(ttl) : undefined,
      });
      return emit(ctx, command, { issueId: claim.issueId, holder: claim.holder, expiresAt: claim.expiresAt, generation: claim.generation });
    }
    case "release": {
      const ref = needRef(rest);
      const holder = flag(flags, "holder") ?? (() => { throw new Error("--holder is required"); })();
      const resolved = refInContext(svc, flags, ref);
      const released = svc.releaseClaim(resolved.id, holder, { activationId: flag(flags, "activation") });
      return emit(ctx, command, { released: released !== null });
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
      const ref = needRef(rest);
      const resolved = refInContext(svc, flags, ref);
      const closed = svc.setLifecycleState(resolved.id, "done");
      return emit(ctx, command, issueSummary(closed));
    }
    case "reopen": {
      const ref = needRef(rest);
      const resolved = refInContext(svc, flags, ref);
      return emit(ctx, command, issueSummary(svc.setLifecycleState(resolved.id, "open")));
    }
    case "defer": {
      const ref = needRef(rest);
      const resolved = refInContext(svc, flags, ref);
      const moved = svc.setLifecycleState(resolved.id, "deferred");
      applyDeferUntil(svc, moved.id, flag(flags, "until"));
      return emit(ctx, command, issueSummary(svc.getIssue(moved.id)));
    }
    case "cancel": {
      const ref = needRef(rest);
      const resolved = refInContext(svc, flags, ref);
      return emit(ctx, command, issueSummary(svc.setLifecycleState(resolved.id, "cancelled")));
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
  };
}

function journalLine(svc: IssueService, e: JournalEntry): string {
  const issue = svc.getIssue(e.issueId);
  return `${issue.locator} · ${issue.humanRef} · seq${e.sequence} ${e.kind} rev${e.issueRevision}${e.semantic ? "" : " (mechanical-only)"}`;
}

// Full-body human rendering for `journal show` (xtrm-7wc.6.2): the header
// line plus the entry-scoped semantic text. `since` stays compact by
// contract; mechanical payloads ride JSON only, presence-only here.
function journalBody(e: JournalEntry): string[] {
  const lines: string[] = [];
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
  flags: Map<string, string | true>,
  rest: string[],
): CliResult {
  const journal = new JournalService(db, svc);
  const contextFlags = {
    runId: flag(flags, "run"),
    participantId: flag(flags, "participant"),
    activationId: flag(flags, "activation"),
    sessionId: flag(flags, "session"),
  };
  switch (verb) {
    case "append": {
      const ref = needRef(rest);
      const kindRaw = flag(flags, "kind") ?? (() => { throw new Error("--kind is required"); })();
      if (!isJournalKind(kindRaw)) throw new Error(`unknown journal kind: ${kindRaw}`);
      const resolved = refInContext(svc, flags, ref);
      const mechRaw = flag(flags, "mechanical");
      const semRaw = flag(flags, "semantic");
      const refsRaw = flag(flags, "refs");
      const entry = journal.appendEntry(resolved.id, {
        kind: kindRaw,
        ...contextFlags,
        mechanical: mechRaw !== undefined ? (mechanicalArg(svc, resolved.id, mechRaw) as never) : undefined,
        semantic: semRaw !== undefined ? (readJsonArg(semRaw) as never) : undefined,
        refs: refsRaw !== undefined ? (readJsonArg(refsRaw) as never) : undefined,
      });
      if (ctx.json) return emit(ctx, command, journalSummary(entry));
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
      if (ctx.json) return emit(ctx, command, entries.map((e) => ({ ...journalSummary(e), semantic: e.semantic, mechanical: e.mechanical })));
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
      throw new Error(`unknown journal verb: ${verb} (want append|checkpoint|show|since|render)`);
  }
}

// -- provenance verbs (Phase 8, bead xtrm-7wc.9) --------------------------------
// Thin over ProvenanceService: dispatch freezes the exact revision/hash,
// trace/commit/receipt/pr reconstruct lineage from host-owned rows.
// Receipt allocation and commit binding stay host-driven (hooks/service);
// the CLI exposes dispatch (host operator), bundle finalization, and the
// four PRD §30 read queries.

function bindingSummary(b: { id: string; issueId: string; issueRevision: number; contractHash: string }): Record<string, unknown> {
  return { bindingId: b.id, issueId: b.issueId, revision: b.issueRevision, contractHash: b.contractHash };
}

function runProvenance(
  db: ReturnType<typeof openSubstrate>,
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string,
  flags: Map<string, string | true>,
  rest: string[],
): CliResult {
  const provenance = new ProvenanceService(db, svc, new JournalService(db, svc));
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
      });
      return emit(ctx, command, bindingSummary(binding));
    }
    case "trace": {
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const t = provenance.trace(resolved.id);
      if (ctx.json) return emit(ctx, command, t);
      const lines = [
        `${t.humanRef} rev${t.revision} ${t.contractHash.slice(0, 12)} [${t.lifecycleState}]`,
        `bindings: ${t.bindings.length} receipts: ${t.receipts.length} checkpoints: ${t.checkpoints.length}`,
        `commits: ${t.commits.length > 0 ? t.commits.join(",") : "(none)"}`,
        `prs: ${t.prs.length > 0 ? t.prs.map((p) => p.value).join(",") : "(none)"}`,
      ];
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
    default:
      throw new Error(`unknown provenance verb: ${verb} (want dispatch|trace|commit|receipt|pr|bundle)`);
  }
}

function runProject(
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string,
  flags: Map<string, string | true>,
): CliResult {
  if (verb === "link") {
    const root = discoverGitRoot();
    if (!root) throw new Error("not inside a git checkout: cd into the checkout to link, or pass --project per command");
    const only = flag(flags, "project");
    const linked = svc.linkCheckout(root, only ?? undefined);
    return emit(ctx, command, { gitRoot: linked.gitRoot, projectId: linked.projectId });
  }
  if (verb === "unlink") {
    const root = discoverGitRoot();
    if (!root) throw new Error("not inside a git checkout: nothing to unlink");
    return emit(ctx, command, { gitRoot: root, unlinked: svc.unlinkCheckout(root) });
  }
  if (verb !== "create") throw new Error(`unknown project verb: ${verb} (want create|link|unlink)`);
  const prefix = flag(flags, "prefix") ?? (() => { throw new Error("--prefix <PREFIX> is required"); })();
  const name = flag(flags, "name") ?? (() => { throw new Error("--name <name> is required"); })();
  const id = flag(flags, "id");
  const project = svc.createProject({ prefix, name, ...(id !== undefined ? { id: String(id) } : {}) });
  return emit(ctx, command, { id: project.id, prefix: project.prefix, name: project.name });
}

// Fail closed when a PlanDraft targets a Project outside the effective
// repository context. Update specs are keyed by their stored Issue's Project
// (the draft's projectId is not authoritative on updates).
function requireDraftInContext(svc: IssueService, flags: Map<string, string | true>, draft: unknown): void {
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
  flags: Map<string, string | true>,
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
  flags: Map<string, string | true>,
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
  const result = importBeads(svc, project, records, fileEdgeList, { createProject: create, journal });
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
  // (0b) inline traceability: every union edge attempted (applied or listed).
  const union = unionEdges(records, fileEdgeList);
  const attempted =
    result.edgesApplied.length +
    result.hierarchyApplied.length +
    result.hierarchySuperseded.length +
    result.hierarchyRefused.length +
    result.externalRefs.length +
    result.edgeErrors.length +
    result.hierarchyErrors.length;
  check("0b-inline-traceability", union.length, attempted);
  // (1) exact ID-set reconciliation vs the export.
  const exportIds = [...new Set(records.filter((r) => r && typeof r.id === "string").map((r) => r.id))].sort();
  const receiptIds = [...new Set([...result.created, ...result.skippedPresent])].sort();
  check("1-id-set-equality", exportIds, receiptIds);
  // (2) edge multiset reconciliation by (from,to,type) over Beads IDs.
  const unionKeys = union
    .map((e) => `${e.issue_id} ${e.depends_on_id} ${e.type}`)
    .sort();
  const appliedKeys = [
    ...result.edgesApplied.map((e) => {
      const orig = union.find((u) => u.issue_id === e.from && u.depends_on_id === e.to) ?? union.find((u) => u.issue_id === e.to && u.depends_on_id === e.from);
      return orig ? `${orig.issue_id} ${orig.depends_on_id} ${orig.type}` : `unmapped ${e.from} ${e.to} ${e.kind}`;
    }),
    ...result.hierarchyApplied.map((h) => `${h.child} ${h.parent} parent-child`),
    ...result.hierarchySuperseded.map((h) => `${h.child} ${h.parent} parent-child`),
    ...result.hierarchyRefused.map((h) => `${h.child} ${h.parent} parent-child`),
  ].sort();
  const errorCount = result.edgeErrors.length + result.hierarchyErrors.length;
  check("2-edge-multiset", unionKeys.length, appliedKeys.length + errorCount + result.externalRefs.length);
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
      if (!(problem.includes(expected) || problem.includes(BEADS_TBD_MARKER))) notesUnpreserved += 1;
    } catch {
      notesUnpreserved += 1;
    }
  }
  check("6-notes-preserved-sample", { sampled: notesSampled, unpreserved: 0 }, { sampled: notesSampled, unpreserved: notesUnpreserved });
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
  flags: Map<string, string | true>,
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
const invokedAsMain = invokedPath.endsWith("sb.ts") || invokedPath.endsWith("/sb") || invokedPath === "sb";
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
