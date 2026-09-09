// Shared Claude-integration runtime: DB resolution + issue discovery.
// Follows the sb CLI precedence (PRD epic shared requirement: structured
// JSON + concise projections) without importing the CLI: --db flag value,
// SUBSTRATE_DB env, then ~/.xtrm/state.db. Issue discovery never assumes
// .xtrm/hooks scripts exist (P0 census): env, then .substrate-issue file.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../../src/store/sqlite.ts";
import { IssueService } from "../../src/service/issue-service.ts";
import { JournalService } from "../../src/service/journal-service.ts";
import { ResumeService } from "../../src/service/resume-service.ts";
import { IntegrationService } from "../../src/service/integration-service.ts";

export interface SubstrateHandles {
  dbPath: string;
  db: ReturnType<typeof openSubstrate>;
  svc: IssueService;
  journal: JournalService;
  resume: ResumeService;
}

export function resolveDbPath(explicit?: string): string {
  return explicit ?? process.env["SUBSTRATE_DB"] ?? join(homedir(), ".xtrm", "state.db");
}

export function openHandles(dbPath?: string): SubstrateHandles {
  const resolved = resolveDbPath(dbPath);
  const db = openSubstrate(resolved);
  const svc = new IssueService(db);
  const journal = new JournalService(db, svc);
  const resume = new ResumeService(db, svc, journal, { external: new IntegrationService(db, svc) });
  return { dbPath: resolved, db, svc, journal, resume };
}

// SUBSTRATE_ISSUE_REF wins (hook env); otherwise <cwd>/.substrate-issue.
export function discoverIssueRef(cwd?: string): string | null {
  const env = process.env["SUBSTRATE_ISSUE_REF"]?.trim();
  if (env) return env;
  if (cwd) {
    const p = join(cwd, ".substrate-issue");
    if (existsSync(p)) {
      try {
        const v = readFileSync(p, "utf8").trim().split("\n")[0]?.trim();
        if (v) return v;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function resolveIssueId(svc: IssueService, ref: string): string {
  return svc.resolveRef(ref).id;
}
