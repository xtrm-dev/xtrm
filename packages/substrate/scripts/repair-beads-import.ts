#!/usr/bin/env node
// One-off repair for boards populated through the lossy Beads importer (XTRM-407).
//
// It reads the source Beads export for a project and repairs the rows already
// stored: contract structure, source timestamps, and Closure backfill. It is
// distinct from fixing the importer forward: it operates on live rows that
// already exist and has no fixture to fall back on, so the source export is the
// authority and a project without one is reported unrepairable rather than
// partially repaired.
//
//   node scripts/repair-beads-import.ts --db <state.db> --project prj_core \
//     --source <export.jsonl> [--alias-prefix core:xtrm] [--apply] [--json] \
//     [--report <file>]
//
// DRY RUN IS THE DEFAULT. Nothing is written unless --apply is passed.
//
// Every write goes through IssueService / ClosureService. This script issues no
// SQL against core tables: the one operation it needs that had no service method
// is `IssueService.applyImportedSourceTimes`, added for this repair rather than
// bypassing service authority.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { ClosureService } from "../src/service/closure-service.ts";
import { hashContract } from "../src/domain/contract.ts";
import { importedContract, mapStatus, parseSourceInstant } from "../src/compatibility/beads/import.ts";

interface Args {
  db: string;
  project: string;
  source: string;
  aliasPrefix: { from: string; to: string } | null;
  apply: boolean;
  json: boolean;
  report: string | null;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
  };
  const db = get("db");
  const project = get("project");
  const source = get("source");
  if (!db || !project || !source) {
    throw new Error("usage: repair-beads-import --db <state.db> --project <id> --source <export.jsonl> [--alias-prefix from:to] [--apply] [--json] [--limit N]");
  }
  if (!existsSync(source)) throw new Error(`source export not found: ${source}`);
  const ap = get("alias-prefix");
  let aliasPrefix: Args["aliasPrefix"] = null;
  if (ap) {
    const [from, to] = ap.split(":");
    if (!from || !to) throw new Error("--alias-prefix wants FROM:TO (e.g. core:xtrm)");
    aliasPrefix = { from, to };
  }
  const lim = get("limit");
  return {
    db,
    project,
    source,
    aliasPrefix,
    apply: argv.includes("--apply"),
    json: argv.includes("--json"),
    report: get("report"),
    limit: lim === null ? null : Number(lim),
  };
}

interface SourceRecord {
  [k: string]: unknown;
}

function loadSource(path: string): Map<string, SourceRecord> {
  const out = new Map<string, SourceRecord>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let r: unknown;
    try {
      r = JSON.parse(t);
    } catch {
      continue;
    }
    if (r && typeof r === "object" && typeof (r as SourceRecord)["id"] === "string") {
      out.set((r as SourceRecord)["id"] as string, r as SourceRecord);
    }
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

interface RowOutcome {
  beadsId: string;
  issueId: string;
  status: "repairable" | "already-structured" | "unrepairable";
  reason?: string;
  contractChanged: boolean;
  timestampsChanged: boolean;
  closureNeeded: boolean;
  closureReasonPresent: boolean;
  applied: { contract: boolean; timestamps: boolean; closure: boolean } | null;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const source = loadSource(args.source);
  const db = openSubstrate(args.db);
  const svc = new IssueService(db);
  const closures = new ClosureService(db, svc);

  const issues = svc.listIssues(args.project).slice(0, args.limit ?? undefined);
  const before = new Map<string, number>();
  for (const i of issues) before.set(i.id, i.createdAt);

  const rows: RowOutcome[] = [];
  const covered = new Set<string>();

  for (const issue of issues) {
    // Exact alias lookup, never resolveRef: a legacy id shaped like a durable
    // ref would otherwise match an unrelated issue.
    let beadsId: string | null = null;
    for (const alias of db.prepare("SELECT alias FROM issue_aliases WHERE issue_id = ? AND kind = 'beads'").all(issue.id) as Array<{ alias: string }>) {
      beadsId = alias.alias;
      break;
    }
    if (beadsId === null) continue; // not an imported row: never touched

    let rec = source.get(beadsId);
    if (!rec && args.aliasPrefix && beadsId.startsWith(`${args.aliasPrefix.from}-`)) {
      const rewritten = `${args.aliasPrefix.to}-${beadsId.slice(args.aliasPrefix.from.length + 1)}`;
      rec = source.get(rewritten);
    }
    if (!rec) {
      rows.push({ beadsId, issueId: issue.id, status: "unrepairable", reason: "no source record in the export for this alias", contractChanged: false, timestampsChanged: false, closureNeeded: false, closureReasonPresent: false, applied: null });
      continue;
    }
    covered.add(beadsId);

    const title = str(rec["title"]) ?? "(untitled beads import)";
    const description = str(rec["description"]) ?? "";
    const wanted = importedContract(description, title);
    const current = svc.getRevision(issue.id, issue.currentRevision);
    const contractChanged = current.contractHash !== hashContract(wanted);

    const createdAt = parseSourceInstant(rec["created_at"]);
    const updatedAtRaw = parseSourceInstant(rec["updated_at"]);
    const closedAtRaw = parseSourceInstant(rec["closed_at"]);
    // Monotonic by construction; a contradictory record is normalised.
    let updatedAt = updatedAtRaw;
    let closedAt = closedAtRaw;
    if (createdAt !== null && updatedAt !== null && updatedAt < createdAt) updatedAt = createdAt;
    if (createdAt !== null && closedAt !== null && closedAt < createdAt) closedAt = createdAt;
    // Compare against the values the repair will leave behind, not against the
    // source fields alone: `updateContract` and `setLifecycleState` both write
    // updated_at, so the target row state is what idempotency must key on.
    const targetCreatedAt = createdAt ?? issue.createdAt;
    const targetUpdatedAt = Math.max(targetCreatedAt, updatedAt ?? issue.updatedAt);
    const timestampsChanged = targetCreatedAt !== issue.createdAt || targetUpdatedAt !== issue.updatedAt;

    const target = mapStatus(rec["status"]);
    const existingClosure = closures.getLatestClosure(issue.id);
    // Only a terminal target gets a Closure. `deferred` is not terminal, so
    // `recordBeadsClosure` correctly returns null for it: counting it as needed
    // would report a repair that never happens and re-append an event every run.
    const closureNeeded = target === "done" && existingClosure === null;
    const reason = str(rec["close_reason"]) ?? "";

    const structured = !contractChanged && !timestampsChanged && !closureNeeded;
    const row: RowOutcome = {
      beadsId,
      issueId: issue.id,
      status: structured ? "already-structured" : "repairable",
      contractChanged,
      timestampsChanged,
      closureNeeded,
      closureReasonPresent: reason !== "",
      applied: null,
    };

    if (args.apply) {
      const applied = { contract: false, timestamps: false, closure: false };
      if (contractChanged) {
        svc.updateContract(issue.id, wanted, "beads-repair", { idempotencyKey: `beads-repair:contract:${beadsId}` });
        applied.contract = true;
      }
      if (closureNeeded) {
        // The terminal instant never falls back to wall-clock while the source
        // carries a usable value, so the Closure cannot contradict the row.
        const terminalAt = closedAt ?? updatedAt ?? createdAt;
        svc.setLifecycleState(issue.id, target, terminalAt ?? undefined);
        closures.recordBeadsClosure(issue.id, {
          reason,
          actor: str(rec["created_by"]) ?? "beads-repair",
          legacyState: str(rec["status"]) ?? "closed",
          closedAt: terminalAt ?? undefined,
        });
        applied.closure = true;
      }
      // Timestamps LAST: the source timeline is the authority for the row, so
      // neither the revision rewrite nor the lifecycle write may leave
      // updated_at at wall-clock. Applied whenever anything else changed, so
      // the row ends in exactly the state the predicate above compares against.
      if (contractChanged || closureNeeded || timestampsChanged) {
        const r = svc.applyImportedSourceTimes(issue.id, { createdAt, updatedAt });
        applied.timestamps = r.changed;
      }
      if (contractChanged || timestampsChanged || closureNeeded) {
        svc.appendEvent(issue.id, "beads.repaired", {
          beadsId,
          source: args.source,
          contractRewritten: contractChanged,
          timestampsRewritten: timestampsChanged,
          closureBackfilled: closureNeeded,
          sourceCreatedAt: createdAt === null ? null : new Date(createdAt).toISOString(),
          sourceUpdatedAt: updatedAt === null ? null : new Date(updatedAt).toISOString(),
          sourceClosedAt: closedAt === null ? null : new Date(closedAt).toISOString(),
          reasonPresent: reason !== "",
        });
      }
      row.applied = applied;
    }
    rows.push(row);
  }

  // Post-checks: these are asserted after apply and are the repair's own
  // falsifiable gates on a live board.
  const afterIssues = svc.listIssues(args.project);
  const distinctBefore = new Set([...before.values()].map((n) => Math.floor(n / 60000))).size;
  const distinctAfter = new Set(afterIssues.map((i) => Math.floor(i.createdAt / 60000))).size;
  let monotonicViolations = 0;
  let dispatchable = 0;
  const dispatchableIds: string[] = [];
  let fillerRevisions = 0;
  // G46 is a statement about IMPORTED rows: native issues in the same project
  // are legitimately dispatchable and must not be counted as a breach.
  const importedIds = new Set<string>();
  for (const r of db.prepare("SELECT DISTINCT issue_id FROM issue_aliases WHERE kind = 'beads'").all() as Array<{ issue_id: string }>) {
    importedIds.add(r.issue_id);
  }
  const FILLER = "TBD \u2014 imported from Beads; pending XTRM planning";
  for (const i of afterIssues) {
    if (i.updatedAt < i.createdAt) monotonicViolations += 1;
    if (!importedIds.has(i.id)) continue;
    if (svc.getReadiness(i.id).dispatchable) {
      dispatchable += 1;
      if (dispatchableIds.length < 5) dispatchableIds.push(i.id);
    }
    const rev = svc.getRevision(i.id, i.currentRevision);
    if (JSON.stringify(rev.contract).includes(FILLER)) fillerRevisions += 1;
  }
  let closuresBeads = 0;
  let reasonAbsent = 0;
  for (const i of afterIssues) {
    const c = closures.getLatestClosure(i.id);
    if (c) {
      if (c.source === "beads") closuresBeads += 1;
      if (c.reason === "") reasonAbsent += 1;
    }
  }

  const report = {
    dryRun: !args.apply,
    project: args.project,
    source: args.source,
    aliasPrefix: args.aliasPrefix,
    sourceRecords: source.size,
    rowsInspected: rows.length,
    rowsCoveredBySource: covered.size,
    repairable: rows.filter((r) => r.status === "repairable").length,
    alreadyStructured: rows.filter((r) => r.status === "already-structured").length,
    unrepairable: rows.filter((r) => r.status === "unrepairable").length,
    unrepairableSample: rows.filter((r) => r.status === "unrepairable").slice(0, 5),
    contractRewrites: rows.filter((r) => r.contractChanged).length,
    timestampRewrites: rows.filter((r) => r.timestampsChanged).length,
    closuresNeeded: rows.filter((r) => r.closureNeeded).length,
    closuresWithReason: rows.filter((r) => r.closureNeeded && r.closureReasonPresent).length,
    closuresReasonAbsent: rows.filter((r) => r.closureNeeded && !r.closureReasonPresent).length,
    distinctCreatedAtMinutes: { before: distinctBefore, after: distinctAfter },
    post: { monotonicityViolations: monotonicViolations, dispatchableRows: dispatchable, dispatchableSample: dispatchableIds, fillerCarryingRevisions: fillerRevisions, closuresFromBeads: closuresBeads, closuresWithEmptyReason: reasonAbsent },
    rows: rows.slice(0, 50),
  };
  if (args.report) writeFileSync(args.report, JSON.stringify({ ...report, rows }, null, 2));
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const p = (k: string, v: unknown): void => { process.stdout.write(`  ${k.padEnd(34)} ${String(v)}\n`); };
    process.stdout.write(`\n${args.apply ? "APPLY" : "DRY RUN"}  project=${args.project}  source=${args.source}\n`);
    p("source records", report.sourceRecords);
    p("rows inspected", report.rowsInspected);
    p("rows covered by source", report.rowsCoveredBySource);
    p("repairable", report.repairable);
    p("already structured", report.alreadyStructured);
    p("unrepairable", report.unrepairable);
    p("contract rewrites", report.contractRewrites);
    p("timestamp rewrites", report.timestampRewrites);
    p("closures needed", report.closuresNeeded);
    p("  with source reason", report.closuresWithReason);
    p("  reason absent in source", report.closuresReasonAbsent);
    p("distinct created_at minutes", `${report.distinctCreatedAtMinutes.before} -> ${report.distinctCreatedAtMinutes.after}`);
    p("monotonicity violations", report.post.monotonicityViolations);
    p("dispatchable rows (G46)", report.post.dispatchableRows);
    p("filler-carrying revisions", report.post.fillerCarryingRevisions);
    p("closures from beads", report.post.closuresFromBeads);
    if (report.unrepairable > 0) {
      process.stdout.write("\n  unrepairable sample:\n");
      for (const r of report.unrepairableSample) process.stdout.write(`    ${r.beadsId}: ${r.reason}\n`);
    }
    process.stdout.write("\n");
  }
  db.close();
  // A dry run always succeeds; an apply that left a G46 or monotonicity breach
  // fails loudly rather than reporting success.
  if (args.apply && (monotonicViolations > 0 || dispatchable > 0)) return 1;
  return 0;
}

process.exitCode = main();
