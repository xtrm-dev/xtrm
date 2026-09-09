#!/usr/bin/env node
// sb CLI vertical (Phase 4, bead xtrm-7wc.5). Thin consumer of the typed
// service: no SQL here, no business logic here. Readiness, claims, planning
// and identity resolution all live in IssueService / PlanningService; this
// process only parses argv, calls the service, and renders JSON or one-line
// human projections (hierarchical locator + durable reference; the opaque
// machine ID appears only in --json output).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { PlanningService } from "../src/service/planning-service.ts";
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

function issueSummary(i: ResolvedIssue): Record<string, unknown> {
  return {
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

// -- argv --------------------------------------------------------------------

const BOOLEAN_FLAGS = new Set(["json"]);

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
  if (Array.isArray(data)) {
    for (const d of data as Array<Record<string, unknown>>) {
      if (typeof d["locator"] === "string") push(d);
      else lines.push(JSON.stringify(d));
    }
  } else if (data !== null && typeof data === "object" && typeof (data as Record<string, unknown>)["locator"] === "string") {
    push(data as Record<string, unknown>);
  } else if (data !== null && typeof data === "object" && Array.isArray((data as Record<string, unknown>)["children"])) {
    const walk = (t: Record<string, unknown>, depth: number): void => {
      lines.push(`${"  ".repeat(depth)}${human(t)}`);
      for (const c of (t["children"] as Array<Record<string, unknown>>)) walk(c, depth + 1);
    };
    walk(data as Record<string, unknown>, 0);
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

// -- entry -------------------------------------------------------------------

export function runCli(argv: string[], opts?: { dbPath?: string }): CliResult {
  const { flags, positionals } = parseArgs(argv);
  const ctx: Ctx = {
    dbPath: flag(flags, "db") ?? opts?.dbPath ?? process.env["SUBSTRATE_DB"] ?? join(homedir(), ".xtrm", "state.db"),
    json: flags.has("json"),
  };
  const [group, verb, ...rest] = positionals;
  const command = group && verb ? `${group}.${verb}` : (group ?? "");
  let db: ReturnType<typeof openSubstrate> | null = null;
  try {
    if (!group || !verb) throw new Error("usage: sb [--db PATH] [--json] <issue|plan> <verb> [args...]");
    db = openSubstrate(ctx.dbPath);
    const svc = new IssueService(db);
    if (group === "issue") return runIssue(svc, ctx, command, verb, flags, rest);
    if (group === "plan") return runPlan(db, svc, ctx, command, verb, flags);
    throw new Error(`unknown group: ${group} (want issue|plan)`);
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

function needRef(rest: string[]): string {
  if (!rest[0]) throw new Error("an issue ref is required (machine ID, durable reference, locator, historical locator, or alias)");
  return rest[0];
}

function runIssue(
  svc: IssueService,
  ctx: Ctx,
  command: string,
  verb: string,
  flags: Map<string, string | true>,
  rest: string[],
): CliResult {
  switch (verb) {
    case "create": {
      const project = flag(flags, "project") ?? (() => { throw new Error("--project is required"); })();
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
        parentId: parent ? svc.resolveRef(parent).id : undefined,
        authoredBy: "sb-cli",
      });
      return emit(ctx, command, issueSummary(svc.getIssue(issue.id)));
    }
    case "show": {
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const readiness = svc.getReadiness(resolved.id);
      return emit(ctx, command, {
        ...issueSummary(resolved),
        contractHash: resolved.currentContractHash,
        readinessState: readiness.state,
        dispatchable: readiness.dispatchable,
        reasons: readiness.reasons,
        attestation: svc.latestAttestation(resolved.id),
        claim: svc.getActiveClaim(resolved.id),
        provenance: provenanceSummary(svc, resolved.id),
      });
    }
    case "edit": {
      const ref = needRef(rest);
      const contractRaw = flag(flags, "contract") ?? (() => { throw new Error("--contract <file|json> is required"); })();
      const resolved = svc.resolveRef(ref);
      const expected = flag(flags, "expected-revision");
      const { issue, created } = svc.updateContract(resolved.id, readJsonArg(contractRaw) as never, "sb-cli", {
        expectedRevision: expected !== undefined ? Number(expected) : undefined,
      });
      return emit(ctx, command, { ...issueSummary(svc.getIssue(issue.id)), revisionCreated: created });
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
    case "list": {
      const project = flag(flags, "project") ?? (() => { throw new Error("--project is required"); })();
      return emit(ctx, command, svc.listIssues(project).map(issueSummary));
    }
    case "ready": {
      const project = flag(flags, "project") ?? (() => { throw new Error("--project is required"); })();
      const out = [];
      for (const i of svc.listIssues(project)) {
        const r = svc.getReadiness(i.id);
        if (r.dispatchable) out.push(readySummary(i, r.state, true));
      }
      return emit(ctx, command, out);
    }
    case "tree": {
      const project = flag(flags, "project");
      const root = flag(flags, "root");
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
      const edge = svc.addEdge(svc.resolveRef(from).id, svc.resolveRef(to).id, kind as never);
      return emit(ctx, command, { id: edge.id, kind: edge.kind, from: edge.fromIssue, to: edge.toIssue });
    }
    case "claim": {
      const ref = needRef(rest);
      const holder = flag(flags, "holder") ?? (() => { throw new Error("--holder is required"); })();
      const ttl = flag(flags, "ttl-ms");
      const resolved = svc.resolveRef(ref);
      const claim = svc.claimIssue(resolved.id, holder, {
        activationId: flag(flags, "activation"),
        ttlMs: ttl !== undefined ? Number(ttl) : undefined,
      });
      return emit(ctx, command, { issueId: claim.issueId, holder: claim.holder, expiresAt: claim.expiresAt, generation: claim.generation });
    }
    case "release": {
      const ref = needRef(rest);
      const holder = flag(flags, "holder") ?? (() => { throw new Error("--holder is required"); })();
      const resolved = svc.resolveRef(ref);
      const released = svc.releaseClaim(resolved.id, holder, { activationId: flag(flags, "activation") });
      return emit(ctx, command, { released: released !== null });
    }
    case "close": {
      const ref = needRef(rest);
      const resolved = svc.resolveRef(ref);
      const closed = svc.setLifecycleState(resolved.id, "done");
      return emit(ctx, command, issueSummary(closed));
    }
    default:
      throw new Error(`unknown issue verb: ${verb}`);
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
  // PlanningService owns check/apply; the CLI only carries the file bytes.
  const planning = new PlanningService(db, svc);
  if (verb === "check") return emit(ctx, command, planning.check(draft));
  if (verb === "apply") return emit(ctx, command, planning.apply(draft));
  throw new Error(`unknown plan verb: ${verb} (want check|apply)`);
}

// -- process main --------------------------------------------------------------

const invokedAsMain = process.argv[1]?.endsWith("sb.ts") ?? false;
if (invokedAsMain) {
  const result = runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.code);
}
