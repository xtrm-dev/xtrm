// Shared fixtures for the recall tests: a minimal state.db-shaped store and
// helpers that build the index without touching the real ~/.xtrm/state.db.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FixtureEntry {
  ref: string;
  project?: "core" | "mmd" | "xtrm";
  seq?: number;
  kind?: string;
  ts?: number;
  semantic?: unknown;
  result?: unknown;
  mechanical?: unknown;
  refs?: unknown;
  title?: string;
  participant?: string | null;
}

export interface FixtureStore {
  dir: string;
  storePath: string;
  indexPath: string;
  cleanup(): void;
}

const PROJECTS = {
  core: { id: "prj_core", name: "core", prefix: "CORE" },
  mmd: { id: "prj_mmd", name: "mmd", prefix: "MMD" },
  xtrm: { id: "prj_xtrm", name: "xtrm", prefix: "XTRM" },
} as const;

export const BASE_TS = Date.UTC(2026, 10, 1, 12, 0, 0);

export function createFixtureStore(entries: FixtureEntry[]): FixtureStore {
  const dir = mkdtempSync(join(tmpdir(), "recall-fixture-"));
  const storePath = join(dir, "state.db");
  const indexPath = join(dir, "index.sqlite");
  const db = new DatabaseSync(storePath);
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL);
    CREATE TABLE issues (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, human_number INTEGER NOT NULL,
      title TEXT, current_revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE issue_journal (
      id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, issue_revision INTEGER NOT NULL DEFAULT 1,
      sequence INTEGER NOT NULL, run_id TEXT, participant_id TEXT, activation_id TEXT,
      session_id TEXT, kind TEXT NOT NULL, mechanical_json TEXT, semantic_json TEXT,
      refs_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, result_json TEXT,
      execution_context_json TEXT, UNIQUE(issue_id, sequence)
    );
  `);
  for (const project of Object.values(PROJECTS)) {
    db.prepare("INSERT INTO projects (id, name, prefix) VALUES (?, ?, ?)").run(project.id, project.name, project.prefix);
  }
  const issueIds = new Set<string>();
  const seenSeq = new Map<string, number>();
  entries.forEach((entry, index) => {
    const [refPrefix, numberText] = entry.ref.split("-");
    const inferred = (Object.keys(PROJECTS) as Array<keyof typeof PROJECTS>).find((key) => PROJECTS[key].prefix === refPrefix);
    const project = PROJECTS[entry.project ?? inferred ?? "core"];
    const prefix = project.prefix;
    if (prefix !== project.prefix) throw new Error(`fixture ref ${entry.ref} does not match project ${project.name}`);
    const humanNumber = Number(numberText);
    const issueId = `iss_${project.id}_${humanNumber}`;
    if (!issueIds.has(issueId)) {
      db.prepare("INSERT INTO issues (id, project_id, human_number, title) VALUES (?, ?, ?, ?)").run(
        issueId,
        project.id,
        humanNumber,
        entry.title ?? `${entry.ref} title`,
      );
      issueIds.add(issueId);
    }
    const seq = entry.seq ?? (seenSeq.get(issueId) ?? 0) + 1;
    seenSeq.set(issueId, seq);
    db.prepare(
      `INSERT INTO issue_journal (id, issue_id, sequence, participant_id, kind, mechanical_json, semantic_json, refs_json, created_at, result_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `jrn_${index}`,
      issueId,
      seq,
      entry.participant ?? null,
      entry.kind ?? "note",
      entry.mechanical === undefined ? null : JSON.stringify(entry.mechanical),
      entry.semantic === undefined ? null : JSON.stringify(entry.semantic),
      JSON.stringify(entry.refs ?? []),
      entry.ts ?? BASE_TS + index * 60_000,
      entry.result === undefined ? null : JSON.stringify(entry.result),
    );
  });
  db.close();
  return {
    dir,
    storePath,
    indexPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** A deterministic, clearly fake secret for fixture text. */
export function fakeSecret(kind: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  let state = [...kind].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 1_000_003, 7);
  for (let i = 0; i < 32; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += alphabet[state % alphabet.length];
  }
  return out;
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

/** Add one journal row to an existing fixture store (incremental-index tests). */
export function appendFixtureEntry(store: FixtureStore, entry: FixtureEntry): void {
  const db = new DatabaseSync(store.storePath);
  try {
    const [refPrefix, numberText] = entry.ref.split("-");
    const inferred = (Object.keys(PROJECTS) as Array<keyof typeof PROJECTS>).find((key) => PROJECTS[key].prefix === refPrefix);
    const project = PROJECTS[entry.project ?? inferred ?? "core"];
    const issueId = `iss_${project.id}_${Number(numberText)}`;
    const existing = db.prepare("SELECT id FROM issues WHERE id = ?").get(issueId);
    if (!existing) {
      db.prepare("INSERT INTO issues (id, project_id, human_number, title) VALUES (?, ?, ?, ?)").run(
        issueId,
        project.id,
        Number(numberText),
        entry.title ?? `${entry.ref} title`,
      );
    }
    const seq = entry.seq ?? Number(db.prepare("SELECT COALESCE(MAX(sequence), 0) AS m FROM issue_journal WHERE issue_id = ?").get(issueId)?.["m"] ?? 0) + 1;
    db.prepare(
      `INSERT INTO issue_journal (id, issue_id, sequence, participant_id, kind, mechanical_json, semantic_json, refs_json, created_at, result_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `jrn_app_${String(Date.now())}_${Math.random().toString(36).slice(2, 8)}`,
      issueId,
      seq,
      entry.participant ?? null,
      entry.kind ?? "note",
      entry.mechanical === undefined ? null : JSON.stringify(entry.mechanical),
      entry.semantic === undefined ? null : JSON.stringify(entry.semantic),
      JSON.stringify(entry.refs ?? []),
      entry.ts ?? BASE_TS + 86_400_000,
      entry.result === undefined ? null : JSON.stringify(entry.result),
    );
  } finally {
    db.close();
  }
}
