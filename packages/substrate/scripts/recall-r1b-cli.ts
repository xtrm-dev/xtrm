#!/usr/bin/env node
// CORE-2603 R1b command surface: index build, seeded sampler, case-file assembly,
// overlap proof, the single two-arm measurement, arm J fail-open tests and the
// post-run scans.
//
// Every threshold and rule in this file is pre-registered in the CORE-2603
// freeze Journal entry, hashed before the sampler runs. Nothing here retunes a
// weight or filters on a measurement result.

import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { buildRecallIndex } from "../src/recall/indexer.ts";
import { CANDIDATE_LIMIT, rankingWeights, weightsHash } from "../src/recall/constants.ts";
import { recall, queryTokens } from "../src/recall/query.ts";
import { readIndexStatus } from "../src/recall/schema.ts";
import { scanSecrets } from "../src/recall/scrub.ts";
import { wilson95 } from "../src/recall/eval.ts";
import type { RecallHit } from "../src/recall/types.ts";
import {
  ACCEPT_P,
  CASE_COUNT,
  DAY_MS,
  DEFAULT_INDEX,
  EXCLUDED_KINDS,
  EXCLUDED_REFS,
  MAX_AGE_DAYS,
  MAX_COPIES,
  MAX_PER_REF,
  MAX_PROJECT_SHARE,
  MIN_AGE_DAYS,
  MIN_TARGET_CHARS,
  MIN_TOKEN_DF,
  PASS_HIT10,
  PASS_HIT5,
  WORK_DIR,
  copiesOf,
  docKey,
  documentFrequency,
  loadDocs,
  mean,
  normalise,
  openIndex,
  questionTokenDf,
  seededKey,
  sha256,
  usedCaseKeys,
  type IndexDoc,
} from "./recall-r1b-lib.ts";
import { jevAsk, mapConcurrent, percentile, type JevOptions, type JevOutcome } from "./recall-r1b-jev.ts";

/**
 * The two property questions, byte-identical to the case-author workflow's
 * CaseCheck schema descriptions. `check` fails when the workflow drifts from
 * these strings, because the calibration and the arm J reranker must judge the
 * same properties the gate judges.
 */
export const ANSWERS_QUESTION =
  "The question is a search a coding agent typed to find a recorded fact. The entry is one journal entry from the project's work log. Does this entry itself state the fact the question asks for, so that an agent who found this entry would have its answer without reading anything else?";
export const STANDALONE_QUESTION =
  "Could a coding agent who has never read this entry, but works on the same project, plausibly type this question? Answer no if the question depends on wording, identifiers or details that only someone who had already read the entry would know.";

/** FROZEN arm J prompt: one Noul per (question, candidate text) pair. */
export const ARM_J_INSTRUCTIONS = ANSWERS_QUESTION;
export const ARM_J_QUESTION_ID = "answers";
export const JEV_MODEL_REQUEST = "jev-latest";
export const JEV_TIMEOUT_MS = 4000;
export const JEV_CONCURRENCY = 4;

// -- arguments ---------------------------------------------------------------

interface Args {
  command: string;
  flags: Map<string, string>;
  positional: string[];
}

function parseArgs(argv: readonly string[]): Args {
  const command = argv[0] ?? "";
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(name, "true");
      continue;
    }
    flags.set(name, next);
    index += 1;
  }
  return { command, flags, positional };
}

function flagString(args: Args, name: string, fallback?: string): string {
  const value = args.flags.get(name);
  if (value === undefined || value === "true") {
    if (fallback !== undefined) return fallback;
    throw new Error(`--${name} is required`);
  }
  return value;
}

function flagNumber(args: Args, name: string, fallback?: number): number {
  const raw = args.flags.get(name);
  if (raw === undefined || raw === "true") {
    if (fallback !== undefined) return fallback;
    throw new Error(`--${name} is required`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(WORK_DIR, { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function isoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function ensureWorkDir(): void {
  mkdirSync(WORK_DIR, { recursive: true });
}

// -- build -------------------------------------------------------------------

function commandBuild(args: Args): void {
  const result = buildRecallIndex({
    storePath: flagString(args, "db"),
    indexPath: flagString(args, "index", DEFAULT_INDEX),
    rebuild: args.flags.get("rebuild") !== undefined,
    loadGate: 0,
  });
  console.log(JSON.stringify(result, null, 2));
}

// -- targets -----------------------------------------------------------------

export interface Target {
  ref: string;
  seq: number;
  project: string;
  projectId: string;
  date: string;
  text: string;
  docId: number;
  ageDays: number;
  orderKey: string;
}

function commandSample(args: Args): void {
  ensureWorkDir();
  const freezeAt = flagNumber(args, "freeze-at");
  const seed = flagString(args, "seed");
  const pool = flagNumber(args, "pool");
  const out = flagString(args, "out", join(WORK_DIR, "targets.json"));
  if (!/^[0-9a-f]{64}$/.test(seed)) throw new Error("--seed must be a sha256 hex digest");
  const db = openIndex(flagString(args, "index", DEFAULT_INDEX));
  const docs = loadDocs(db);
  const used = usedCaseKeys();
  const from = freezeAt - MAX_AGE_DAYS * DAY_MS;
  const to = freezeAt - MIN_AGE_DAYS * DAY_MS;
  const eligible = docs.filter((doc) => {
    if (doc.ts < from || doc.ts > to) return false;
    if (EXCLUDED_KINDS.includes(doc.kind)) return false;
    if (EXCLUDED_REFS.includes(doc.ref)) return false;
    if (used.has(docKey(doc.ref, doc.seq))) return false;
    return normalise(doc.body).length >= MIN_TARGET_CHARS;
  });
  const ordered = eligible
    .map((doc) => ({ doc, orderKey: seededKey(seed, doc.ref, doc.seq) }))
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));

  // Pre-registered caps. The project cap is stricter than the case-file rule
  // (40% of the pool against the contract's 50% of the cases) so the authored
  // set cannot drift past the contract through acceptance-rate variance.
  const perRef = new Map<string, number>();
  const perProject = new Map<string, number>();
  const projectCap = Math.floor(pool * 0.4);
  const targets: Target[] = [];
  for (const entry of ordered) {
    if (targets.length >= pool) break;
    const doc = entry.doc;
    const refCount = perRef.get(doc.ref) ?? 0;
    if (refCount >= MAX_PER_REF) continue;
    const projectCount = perProject.get(doc.projectId) ?? 0;
    if (projectCount >= projectCap) continue;
    perRef.set(doc.ref, refCount + 1);
    perProject.set(doc.projectId, projectCount + 1);
    targets.push({
      ref: doc.ref,
      seq: doc.seq,
      project: doc.projectName,
      projectId: doc.projectId,
      date: isoDay(doc.ts),
      text: doc.body,
      docId: doc.docId,
      ageDays: Math.round(((freezeAt - doc.ts) / DAY_MS) * 10) / 10,
      orderKey: entry.orderKey,
    });
  }
  const byProject = Object.fromEntries(
    [...perProject.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => [id, count]),
  );
  const perRefTop = [...perRef.values()].sort((a, b) => b - a)[0] ?? 0;
  writeJson(out, {
    generatedAt: Date.now(),
    freezeAt,
    seed,
    poolRequested: pool,
    poolSize: targets.length,
    eligibleRows: eligible.length,
    docCount: docs.length,
    projectCap,
    maxPerRef: perRefTop,
    byProject,
    targets,
  });
  console.log(
    `sample: ${targets.length} targets from ${eligible.length} eligible rows (index ${docs.length} docs), ${Object.keys(byProject).length} projects, project cap ${projectCap}`,
  );
}

function commandDryRunTargets(args: Args): void {
  ensureWorkDir();
  const out = flagString(args, "out", join(WORK_DIR, "dryrun-targets.json"));
  const count = flagNumber(args, "count", 10);
  const seed = flagString(args, "seed", "recall-r1b-dryrun");
  const db = openIndex(flagString(args, "index", DEFAULT_INDEX));
  const used = usedCaseKeys();
  const byKey = new Map<string, IndexDoc>();
  for (const doc of loadDocs(db)) byKey.set(docKey(doc.ref, doc.seq), doc);
  const candidates = [...used]
    .filter((key) => byKey.has(key))
    .map((key) => ({ key, order: sha256(`${seed}\n${key}`) }))
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  const targets: Target[] = [];
  for (const entry of candidates) {
    if (targets.length >= count) break;
    const doc = byKey.get(entry.key)!;
    targets.push({
      ref: doc.ref,
      seq: doc.seq,
      project: doc.projectName,
      projectId: doc.projectId,
      date: isoDay(doc.ts),
      text: doc.body,
      docId: doc.docId,
      ageDays: Math.round(((Date.now() - doc.ts) / DAY_MS) * 10) / 10,
      orderKey: entry.order,
    });
  }
  writeJson(out, { generatedAt: Date.now(), seed, usedCases: used.size, targets });
  console.log(`dryrun-targets: ${targets.length} used-case targets → ${out}: ${targets.map((t) => docKey(t.ref, t.seq)).join(", ")}`);
}

// -- case file ---------------------------------------------------------------

interface AuthoredCase {
  ref: string;
  seq: number;
  question: string;
  copied_trigrams: number;
  answers_p: number | null;
  standalone_p: number | null;
  accepted: boolean;
}

interface CasefileCase {
  id: number;
  name: string;
  ref: string;
  seq: number;
  project: string;
  projectId: string;
  date: string;
  query: string;
  answers_p: number | null;
  standalone_p: number | null;
  copied_trigrams: number;
  token_df: Array<{ token: string; df: number }>;
  min_df: number;
  copies: Array<{ ref: string; seq: number; project: string; date: string }>;
  expected: Array<{ ref: string; seq: number; copy: boolean }>;
}

function authoredCases(paths: readonly string[]): AuthoredCase[] {
  const out: AuthoredCase[] = [];
  for (const path of paths) {
    const payload = readJson<{ cases?: AuthoredCase[] } | AuthoredCase[]>(path);
    const list = Array.isArray(payload) ? payload : (payload.cases ?? []);
    out.push(...list);
  }
  return out;
}

function commandCasefile(args: Args): void {
  ensureWorkDir();
  const targetsPath = flagString(args, "targets");
  const select = flagNumber(args, "select", CASE_COUNT);
  const out = flagString(args, "out", join(WORK_DIR, "casefile.json"));
  const index = flagString(args, "index", DEFAULT_INDEX);
  const authored = authoredCases(args.positional.length > 0 ? args.positional : [flagString(args, "authored")]);
  const bundle = readJson<{ targets: Target[]; freezeAt?: number; seed?: string }>(targetsPath);
  const byKey = new Map<string, Target>();
  for (const target of bundle.targets) byKey.set(docKey(target.ref, target.seq), target);

  const db = openIndex(index);
  const docs = loadDocs(db);
  const byDocKey = new Map<string, IndexDoc>();
  for (const doc of docs) byDocKey.set(docKey(doc.ref, doc.seq), doc);

  // Rev 4 (CORE-2603 seq 6): acceptance is the mechanical rule plus coordinator
  // hand review. Jev probabilities are shadow data and reject nothing unless
  // the caller asks for the pre-ruling rule with --accept-rule jev.
  const requireJev = flagString(args, "accept-rule", "mechanical") === "jev";
  const stats = { authored: authored.length, unknownTarget: 0, copied: 0, lowProbability: 0, lowDf: 0, templated: 0, accepted: 0, nullProbability: 0, rejectedForProbability: 0 };
  const accepted: CasefileCase[] = [];
  const seen = new Set<string>();
  for (const testCase of authored) {
    const key = docKey(testCase.ref, testCase.seq);
    if (seen.has(key)) continue;
    seen.add(key);
    const target = byKey.get(key);
    const doc = byDocKey.get(key);
    if (!target || !doc) {
      stats.unknownTarget += 1;
      continue;
    }
    const tokenDf = questionTokenDf(db, testCase.question);
    const minDf = tokenDf.length === 0 ? 0 : Math.min(...tokenDf.map((entry) => entry.df));
    const answersP = typeof testCase.answers_p === "number" ? testCase.answers_p : null;
    const standaloneP = typeof testCase.standalone_p === "number" ? testCase.standalone_p : null;
    const copies = copiesOf(docs, doc);
    let reason: string | null = null;
    if (answersP === null || standaloneP === null) stats.nullProbability += 1;
    if (answersP !== null && standaloneP !== null && (answersP < ACCEPT_P || standaloneP < ACCEPT_P)) stats.lowProbability += 1;
    if (requireJev && (answersP === null || standaloneP === null)) {
      stats.rejectedForProbability += 1;
      reason = "no_probability";
    } else if (testCase.copied_trigrams > 0) {
      stats.copied += 1;
      reason = "copied_trigrams";
    } else if (requireJev && answersP !== null && standaloneP !== null && (answersP < ACCEPT_P || standaloneP < ACCEPT_P)) {
      stats.rejectedForProbability += 1;
      reason = "low_probability";
    } else if (tokenDf.length === 0 || minDf <= MIN_TOKEN_DF) {
      stats.lowDf += 1;
      reason = "rare_token";
    } else if (copies.length > MAX_COPIES) {
      stats.templated += 1;
      reason = "templated";
    }
    if (reason !== null) continue;
    stats.accepted += 1;
    accepted.push({
      id: accepted.length + 1,
      name: docKey(doc.ref, doc.seq),
      ref: doc.ref,
      seq: doc.seq,
      project: doc.projectName,
      projectId: doc.projectId,
      date: isoDay(doc.ts),
      query: testCase.question,
      answers_p: answersP,
      standalone_p: standaloneP,
      copied_trigrams: testCase.copied_trigrams,
      token_df: tokenDf,
      min_df: minDf,
      copies: copies.map((copy) => ({ ref: copy.ref, seq: copy.seq, project: copy.projectName, date: isoDay(copy.ts) })),
      expected: [
        { ref: doc.ref, seq: doc.seq, copy: false },
        ...copies.map((copy) => ({ ref: copy.ref, seq: copy.seq, copy: true })),
      ],
    });
  }

  // The first `select` accepted cases in seeded (authored) order, with the
  // contract's 50% project-share cap applied to the selected set.
  const shareCap = Math.floor(select * MAX_PROJECT_SHARE);
  const perProject = new Map<string, number>();
  const selected: CasefileCase[] = [];
  for (const testCase of accepted) {
    if (selected.length >= select) break;
    const count = perProject.get(testCase.projectId) ?? 0;
    if (count >= shareCap) continue;
    perProject.set(testCase.projectId, count + 1);
    selected.push(testCase);
  }
  selected.forEach((testCase, index) => {
    testCase.id = index + 1;
  });
  writeJson(out, {
    version: 1,
    generatedAt: Date.now(),
    index,
    indexStatus: readIndexStatus(index),
    weights: rankingWeights(),
    weightsHash: weightsHash(),
    select,
    shareCap,
    acceptRule: requireJev ? "jev" : "mechanical",
    stats,
    byProject: Object.fromEntries(perProject),
    cases: selected,
  });
  console.log(
    `casefile: authored ${stats.authored}, accepted ${stats.accepted}, selected ${selected.length}/${select} ` +
      `(copy-trigrams ${stats.copied}, rare-token ${stats.lowDf}, templated ${stats.templated}, unknown ${stats.unknownTarget}; shadow: null-probability ${stats.nullProbability}, low-probability ${stats.lowProbability})`,
  );
  if (select > 0 && selected.length < select) process.exitCode = 2;
}

// -- overlap proof -----------------------------------------------------------

function commandOverlap(args: Args): void {
  const casefile = readJson<{ cases: CasefileCase[]; freezeAt?: number }>(flagString(args, "casefile"));
  const freezeAt = flagNumber(args, "freeze-at");
  const used = usedCaseKeys();
  const problems: string[] = [];
  const db = openIndex(flagString(args, "index", DEFAULT_INDEX));
  const byKey = new Map<string, IndexDoc>();
  for (const doc of loadDocs(db)) byKey.set(docKey(doc.ref, doc.seq), doc);
  const projectCounts = new Map<string, number>();
  let copyOverlap = 0;
  for (const testCase of casefile.cases) {
    const key = docKey(testCase.ref, testCase.seq);
    if (used.has(key)) problems.push(`target ${key} is one of the 60 used cases`);
    const doc = byKey.get(key);
    if (!doc) {
      problems.push(`target ${key} is not in the index`);
      continue;
    }
    const ageDays = (freezeAt - doc.ts) / DAY_MS;
    if (ageDays < MIN_AGE_DAYS || ageDays > MAX_AGE_DAYS) problems.push(`target ${key} is aged ${ageDays.toFixed(1)} days`);
    if (EXCLUDED_REFS.includes(doc.ref)) problems.push(`target ${key} is in an excluded ref`);
    if (EXCLUDED_KINDS.includes(doc.kind)) problems.push(`target ${key} has excluded kind ${doc.kind}`);
    if (normalise(doc.body).length < MIN_TARGET_CHARS) problems.push(`target ${key} has too little text`);
    for (const copy of testCase.copies) if (used.has(docKey(copy.ref, copy.seq))) copyOverlap += 1;
    projectCounts.set(doc.projectId, (projectCounts.get(doc.projectId) ?? 0) + 1);
  }
  const total = casefile.cases.length;
  const share = [...projectCounts.values()].sort((a, b) => b - a)[0] ?? 0;
  if (total > 0 && share / total > MAX_PROJECT_SHARE) problems.push(`project share ${share}/${total} exceeds 50%`);
  const refCounts = new Map<string, number>();
  for (const testCase of casefile.cases) refCounts.set(testCase.ref, (refCounts.get(testCase.ref) ?? 0) + 1);
  for (const [ref, count] of refCounts) if (count > MAX_PER_REF) problems.push(`ref ${ref} contributes ${count} cases`);
  const report = {
    cases: total,
    usedCases: used.size,
    overlapsWithUsedCases: problems.filter((problem) => problem.includes("used cases")).length,
    copyRowsThatAreUsedCases: copyOverlap,
    projectShare: { max: share, of: total, cap: MAX_PROJECT_SHARE },
    byProject: Object.fromEntries([...projectCounts.entries()].sort((a, b) => b[1] - a[1])),
    problems,
    ok: problems.length === 0 && total === CASE_COUNT,
  };
  const out = flagString(args, "out", join(WORK_DIR, "overlap.json"));
  writeJson(out, report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

// -- measurement -------------------------------------------------------------

interface RankedCase {
  rank: number | null;
  matchedCopy: boolean;
}

interface ArmMetrics {
  cases: number;
  hitAt1: number;
  hitAt5: number;
  hitAt10: number;
  hitAt50: number;
  hit5Count: number;
  hit10Count: number;
  misses: number;
  mrr: number;
  hitAt5Interval: { low: number; high: number };
  hitAt10Interval: { low: number; high: number };
}

function armMetrics(ranked: readonly RankedCase[]): ArmMetrics {
  const n = ranked.length;
  const count = (k: number): number => ranked.filter((entry) => entry.rank !== null && entry.rank <= k).length;
  const mrr = n === 0 ? 0 : ranked.reduce((sum, entry) => sum + (entry.rank === null ? 0 : 1 / entry.rank), 0) / n;
  return {
    cases: n,
    hitAt1: n === 0 ? 0 : count(1) / n,
    hitAt5: n === 0 ? 0 : count(5) / n,
    hitAt10: n === 0 ? 0 : count(10) / n,
    hitAt50: n === 0 ? 0 : count(50) / n,
    hit5Count: count(5),
    hit10Count: count(10),
    misses: ranked.filter((entry) => entry.rank === null).length,
    mrr,
    hitAt5Interval: wilson95(count(5), n),
    hitAt10Interval: wilson95(count(10), n),
  };
}

function expectedMatch(expected: readonly { ref: string; seq: number; copy: boolean }[], hit: RecallHit): { copy: boolean } | null {
  for (const want of expected) if (want.ref === hit.ref && want.seq === hit.seq) return { copy: want.copy };
  return null;
}

function rankIn(expected: readonly { ref: string; seq: number; copy: boolean }[], hits: readonly RecallHit[]): RankedCase {
  for (let index = 0; index < hits.length; index += 1) {
    const match = expectedMatch(expected, hits[index]!);
    if (match !== null) return { rank: index + 1, matchedCopy: match.copy };
  }
  return { rank: null, matchedCopy: false };
}

function candidateBody(statement: { get(...params: unknown[]): Record<string, unknown> | undefined }, hit: RecallHit): string {
  const row = statement.get(hit.ref, hit.seq ?? -1);
  return row === undefined ? "" : String(row["body"] ?? "");
}

interface JevRunEntry {
  case: number;
  ref: string;
  seq: number;
  question: string;
  entry: string;
}

async function armJOrder(
  hits: readonly RecallHit[],
  query: string,
  bodyOf: (hit: RecallHit) => string,
  jevOptions: JevOptions,
  logPath: string | null,
  caseId: number,
): Promise<{ order: RecallHit[]; failOpen: boolean; failure: string | null; latencies: number[]; queryMs: number }> {
  const startedAt = Date.now();
  const bodies = hits.map((hit) => bodyOf(hit));
  const log = (index: number): void => {
    if (logPath === null) return;
    const entry: JevRunEntry = { case: caseId, ref: hits[index]!.ref, seq: hits[index]!.seq ?? -1, question: query, entry: bodies[index]! };
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  };
  const outcomes: JevOutcome[] = await mapConcurrent(hits.map((_, index) => index), JEV_CONCURRENCY, async (index) => {
    log(index);
    return jevAsk(
      { question: query, entry: bodies[index]! },
      { [ARM_J_QUESTION_ID]: { type: "noul", instructions: ARM_J_INSTRUCTIONS } },
      jevOptions,
    );
  });
  const latencies = outcomes.map((outcome) => outcome.latencyMs);
  const failure = outcomes.find((outcome) => !outcome.ok)?.failure ?? null;
  if (failure !== null) {
    return { order: [...hits], failOpen: true, failure, latencies, queryMs: Date.now() - startedAt };
  }
  const scored = hits.map((hit, index) => ({ hit, index, noul: outcomes[index]!.nouls[ARM_J_QUESTION_ID] ?? 0 }));
  scored.sort((a, b) => (b.noul !== a.noul ? b.noul - a.noul : a.index - b.index));
  return { order: scored.map((entry) => entry.hit), failOpen: false, failure: null, latencies, queryMs: Date.now() - startedAt };
}

async function commandMeasure(args: Args): Promise<void> {
  const casefilePath = flagString(args, "casefile");
  const now = flagNumber(args, "now");
  const index = flagString(args, "index", DEFAULT_INDEX);
  const casefile = readJson<{ cases: CasefileCase[]; freezeAt?: number; weightsHash?: string }>(casefilePath);
  const expectCases = flagNumber(args, "expect-cases", CASE_COUNT);
  if (casefile.cases.length !== expectCases) throw new Error(`case file holds ${casefile.cases.length} cases; the expected count is ${expectCases}`);
  if (casefile.weightsHash !== undefined && casefile.weightsHash !== weightsHash()) {
    throw new Error(`case file weights ${casefile.weightsHash} differ from code ${weightsHash()}`);
  }
  const requestLog = flagString(args, "request-log", join(WORK_DIR, "jev-requests.jsonl"));
  writeFileSync(requestLog, "");
  const db = openIndex(index);
  const bodyStatement = db.prepare("SELECT d.body AS body FROM meta m JOIN docs d ON d.rowid = m.doc_id WHERE m.ref = ? AND m.seq = ?");
  const bodyOf = (hit: RecallHit): string => candidateBody(bodyStatement, hit);

  const armLRanked: RankedCase[] = [];
  const armJRanked: RankedCase[] = [];
  const perCase: Array<Record<string, unknown>> = [];
  const queryLatencies: number[] = [];
  const callLatencies: number[] = [];
  const minDfs: number[] = [];
  let failOpens = 0;

  for (const testCase of casefile.cases) {
    const outcome = recall({
      terms: testCase.query,
      indexPath: index,
      limit: CANDIDATE_LIMIT,
      now,
      // The query is issued in the project the case comes from: the same boost an
      // agent inside that project would get, and no single project is favoured.
      projectId: testCase.projectId,
    });
    const hits = outcome.hits;
    const armL = rankIn(testCase.expected, hits);
    armLRanked.push(armL);
    const jev = await armJOrder(hits, testCase.query, bodyOf, { timeoutMs: JEV_TIMEOUT_MS, model: JEV_MODEL_REQUEST }, requestLog, testCase.id);
    const armJ = rankIn(testCase.expected, jev.order);
    armJRanked.push(armJ);
    if (jev.failOpen) failOpens += 1;
    queryLatencies.push(jev.queryMs);
    callLatencies.push(...jev.latencies);
    minDfs.push(testCase.min_df);
    perCase.push({
      id: testCase.id,
      name: testCase.name,
      project: testCase.project,
      query: testCase.query,
      expected: testCase.expected,
      candidates: hits.length,
      min_df: testCase.min_df,
      armL: { rank: armL.rank, matched_copy: armL.matchedCopy },
      armJ: { rank: armJ.rank, matched_copy: armJ.matchedCopy, fail_open: jev.failOpen, failure: jev.failure, query_ms: jev.queryMs },
      top10: hits.slice(0, 10).map((hit, position) => ({ rank: position + 1, ref: hit.ref, seq: hit.seq, kind: hit.kind, project: hit.project, date: hit.date })),
    });
  }

  const armL = armMetrics(armLRanked);
  const armJ = armMetrics(armJRanked);
  const report = {
    version: 1,
    generatedAt: Date.now(),
    now,
    index,
    indexStatus: readIndexStatus(index, now),
    weights: rankingWeights(),
    weightsHash: weightsHash(),
    casefile: casefilePath,
    jev: {
      modelRequested: JEV_MODEL_REQUEST,
      instructions: ARM_J_INSTRUCTIONS,
      questionId: ARM_J_QUESTION_ID,
      timeoutMs: JEV_TIMEOUT_MS,
      concurrency: JEV_CONCURRENCY,
    },
    armL,
    armJ,
    hitsViaCopy: { armL: armLRanked.filter((entry) => entry.matchedCopy).length, armJ: armJRanked.filter((entry) => entry.matchedCopy).length },
    armJFailOpens: failOpens,
    armJLatency: {
      queryP50: percentile(queryLatencies, 0.5),
      queryP95: percentile(queryLatencies, 0.95),
      callP50: percentile(callLatencies, 0.5),
      callP95: percentile(callLatencies, 0.95),
      calls: callLatencies.length,
    },
    meanLowestDfToken: mean(minDfs),
    pass: {
      armL: { hit5: armL.hit5Count >= PASS_HIT5, hit10: armL.hit10Count >= PASS_HIT10 },
      armJ: { hit5: armJ.hit5Count >= PASS_HIT5, hit10: armJ.hit10Count >= PASS_HIT10 },
    },
    cases: perCase,
  };
  const out = flagString(args, "out", join(WORK_DIR, "measurement.json"));
  writeJson(out, report);
  console.log(JSON.stringify({
    armL: { hit1: armL.hitAt1, hit5: armL.hitAt5, hit10: armL.hitAt10, hit50: armL.hitAt50, mrr: armL.mrr, miss: armL.misses },
    armJ: { hit1: armJ.hitAt1, hit5: armJ.hitAt5, hit10: armJ.hitAt10, hit50: armJ.hitAt50, mrr: armJ.mrr, miss: armJ.misses },
    hitsViaCopy: report.hitsViaCopy,
    armJFailOpens: failOpens,
    armJLatency: report.armJLatency,
    meanLowestDfToken: report.meanLowestDfToken,
    pass: report.pass,
  }, null, 2));
}

// -- arm J fail-open ---------------------------------------------------------

function assertOrderEqual(label: string, left: readonly RecallHit[], right: readonly RecallHit[]): boolean {
  const a = left.map((hit) => docKey(hit.ref, hit.seq)).join("|");
  const b = right.map((hit) => docKey(hit.ref, hit.seq)).join("|");
  const ok = a === b;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: arm J order ${ok ? "equals" : "differs from"} arm L order`);
  return ok;
}

async function commandFailopen(args: Args): Promise<void> {
  const casefile = readJson<{ cases: CasefileCase[] }>(flagString(args, "casefile"));
  const now = flagNumber(args, "now");
  const index = flagString(args, "index", DEFAULT_INDEX);
  const testCase = casefile.cases[0]!;
  const db = openIndex(index);
  const bodyStatement = db.prepare("SELECT d.body AS body FROM meta m JOIN docs d ON d.rowid = m.doc_id WHERE m.ref = ? AND m.seq = ?");
  const hits = recall({ terms: testCase.query, indexPath: index, limit: CANDIDATE_LIMIT, now, projectId: testCase.projectId }).hits;
  if (hits.length === 0) throw new Error("fail-open test needs a non-empty candidate pool");

  const results: Array<{ test: string; ok: boolean; failure: string | null }> = [];
  const run = async (test: string, options: JevOptions): Promise<void> => {
    const outcome = await armJOrder(hits, testCase.query, (hit) => candidateBody(bodyStatement, hit), options, null, testCase.id);
    const orderOk = assertOrderEqual(`${test} (failure=${outcome.failure})`, hits, outcome.order);
    results.push({ test, ok: outcome.failOpen && orderOk, failure: outcome.failure });
  };

  // 1. No key at all: neither the environment nor the key file.
  await run("no-key", { apiKey: "", noKeyFile: true, timeoutMs: JEV_TIMEOUT_MS });
  // 2. 402 from the provider.
  const server402 = createServer((_request, response) => {
    response.writeHead(402, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "payment required" }));
  });
  await new Promise<void>((done) => server402.listen(0, "127.0.0.1", done));
  const port402 = (server402.address() as { port: number }).port;
  await run("http-402", { endpoint: `http://127.0.0.1:${port402}/v1/systemone`, timeoutMs: JEV_TIMEOUT_MS });
  await new Promise<void>((done) => server402.close(() => done()));
  // 3. Timeout: the provider answers after the per-call bound.
  const serverSlow = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ answers: { [ARM_J_QUESTION_ID]: { type: "noul", noul: 0.9 } } }));
    }, 600);
  });
  await new Promise<void>((done) => serverSlow.listen(0, "127.0.0.1", done));
  const portSlow = (serverSlow.address() as { port: number }).port;
  await run("timeout", { endpoint: `http://127.0.0.1:${portSlow}/v1/systemone`, timeoutMs: 150 });
  await new Promise<void>((done) => serverSlow.close(() => done()));
  // 4. Network down: nothing listens on the port.
  const serverDead = createServer(() => undefined);
  await new Promise<void>((done) => serverDead.listen(0, "127.0.0.1", done));
  const portDead = (serverDead.address() as { port: number }).port;
  await new Promise<void>((done) => serverDead.close(() => done()));
  await run("network-down", { endpoint: `http://127.0.0.1:${portDead}/v1/systemone`, timeoutMs: 500 });

  const ok = results.every((entry) => entry.ok);
  const out = flagString(args, "out", join(WORK_DIR, "failopen.json"));
  writeJson(out, { generatedAt: Date.now(), case: testCase.name, candidates: hits.length, ok, results });
  console.log(JSON.stringify({ ok, results }, null, 2));
  if (!ok) process.exitCode = 1;
}

// -- scans -------------------------------------------------------------------

function commandScan(args: Args): void {
  const index = flagString(args, "index", DEFAULT_INDEX);
  const db = openIndex(index);
  const rows = db.prepare("SELECT m.doc_id, m.ref, m.seq, d.body, d.title, d.head FROM meta m JOIN docs d ON d.rowid = m.doc_id").all() as Array<
    Record<string, unknown>
  >;
  let indexFindings = 0;
  const examples: Array<{ ref: string; seq: number; rules: string[] }> = [];
  for (const row of rows) {
    const findings = scanSecrets(`${String(row["body"])}\n${String(row["title"])}\n${String(row["head"])}`);
    if (findings.length === 0) continue;
    indexFindings += findings.length;
    if (examples.length < 5) examples.push({ ref: String(row["ref"]), seq: Number(row["seq"]), rules: [...new Set(findings.map((finding) => finding.rule))] });
  }

  let requestFindings = 0;
  let requestRows = 0;
  let notFromIndex = 0;
  const requestLog = args.flags.get("request-log");
  if (requestLog !== undefined && requestLog !== "true" && existsSync(requestLog)) {
    const bodies = new Map<string, string>();
    for (const row of rows) bodies.set(docKey(String(row["ref"]), Number(row["seq"])), String(row["body"]));
    for (const line of readFileSync(requestLog, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      requestRows += 1;
      const entry = JSON.parse(line) as { ref: string; seq: number; entry: string };
      requestFindings += scanSecrets(entry.entry).length;
      const indexed = bodies.get(docKey(entry.ref, entry.seq)) ?? "";
      if (indexed === "" || !indexed.includes(entry.entry)) notFromIndex += 1;
    }
  }
  const report = {
    generatedAt: Date.now(),
    index,
    docsScanned: rows.length,
    indexFindings,
    indexExamples: examples,
    requestLog: requestLog === undefined || requestLog === "true" ? null : requestLog,
    requestRows,
    requestFindings,
    requestsNotFromIndex: notFromIndex,
    ok: indexFindings === 0 && requestFindings === 0 && notFromIndex === 0,
  };
  const out = flagString(args, "out", join(WORK_DIR, "scan.json"));
  writeJson(out, report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

// -- calibration and workflow check ------------------------------------------

interface CalibPair {
  id: number;
  ref: string;
  seq: number;
  project: string;
  question: string;
  entry: string;
}

interface CalibLabel {
  id: number;
  answers: boolean;
  standalone: boolean;
}

function propertyAgreement(
  pairs: readonly CalibPair[],
  p: Record<number, { answers: number; standalone: number }>,
  labels: readonly CalibLabel[],
  property: "answers" | "standalone",
  threshold: number,
): { property: string; threshold: number; agree: number; of: number; falseAccepts: number; badPairs: number; misses: number[] } {
  let agree = 0;
  let falseAccepts = 0;
  let badPairs = 0;
  const misses: number[] = [];
  for (const label of labels) {
    const probability = p[label.id]?.[property];
    if (probability === undefined) throw new Error(`no Jev answer for pair ${label.id}`);
    const verdict = probability >= threshold;
    const truth = label[property];
    if (verdict === truth) agree += 1;
    else misses.push(label.id);
    if (!truth) {
      badPairs += 1;
      if (verdict) falseAccepts += 1;
    }
  }
  void pairs;
  return { property, threshold, agree, of: labels.length, falseAccepts, badPairs, misses };
}

async function commandCalib(args: Args): Promise<void> {
  const pairsFile = readJson<{ pairs: CalibPair[] }>(flagString(args, "pairs"));
  const labelsFile = flagString(args, "labels");
  const labelsPayload = readJson<{ labels?: CalibLabel[] | Record<string, Omit<CalibLabel, "id">> } | CalibLabel[]>(labelsFile);
  const normalize = (value: CalibLabel[] | Record<string, Omit<CalibLabel, "id">>): CalibLabel[] =>
    Array.isArray(value)
      ? value
      : Object.entries(value).map(([id, label]) => ({ id: Number(id), answers: label.answers === true, standalone: label.standalone === true }));
  const labels = Array.isArray(labelsPayload)
    ? labelsPayload
    : labelsPayload.labels === undefined
      ? []
      : normalize(labelsPayload.labels);
  if (labels.length !== pairsFile.pairs.length) throw new Error(`labels ${labels.length} do not cover all ${pairsFile.pairs.length} pairs`);
  const probabilities: Record<number, { answers: number; standalone: number }> = {};
  const outcomes = await mapConcurrent(pairsFile.pairs, JEV_CONCURRENCY, async (pair) => {
    const outcome = await jevAsk(
      { question: pair.question, entry: pair.entry },
      {
        answers: { type: "noul", instructions: ANSWERS_QUESTION },
        standalone: { type: "noul", instructions: STANDALONE_QUESTION },
      },
      { timeoutMs: JEV_TIMEOUT_MS, model: JEV_MODEL_REQUEST },
    );
    return { id: pair.id, outcome };
  });
  for (const entry of outcomes) {
    if (!entry.outcome.ok) throw new Error(`Jev failed on pair ${entry.id}: ${entry.outcome.failure}`);
    probabilities[entry.id] = { answers: entry.outcome.nouls["answers"] ?? 0, standalone: entry.outcome.nouls["standalone"] ?? 0 };
  }
  const primary = { answers: propertyAgreement(pairsFile.pairs, probabilities, labels, "answers", ACCEPT_P), standalone: propertyAgreement(pairsFile.pairs, probabilities, labels, "standalone", ACCEPT_P) };
  const atHalf = { answers: propertyAgreement(pairsFile.pairs, probabilities, labels, "answers", 0.5), standalone: propertyAgreement(pairsFile.pairs, probabilities, labels, "standalone", 0.5) };
  const pass = (entry: { agree: number; of: number; falseAccepts: number }): boolean => entry.agree >= 18 && entry.falseAccepts <= 1;
  const report = {
    generatedAt: Date.now(),
    pairsFile: flagString(args, "pairs"),
    labelsFile,
    jev: { modelRequested: JEV_MODEL_REQUEST, timeoutMs: JEV_TIMEOUT_MS },
    primary,
    atHalf,
    pass: { answers: pass(primary.answers), standalone: pass(primary.standalone), both: pass(primary.answers) && pass(primary.standalone) },
    probabilities,
  };
  const out = flagString(args, "out", join(WORK_DIR, "calibration.json"));
  writeJson(out, report);
  console.log(JSON.stringify({ primary, hes: "at 0.5", atHalf, pass: report.pass }, null, 2));
  if (!report.pass.both) process.exitCode = 1;
}

function commandCheck(args: Args): void {
  const workflowPath = flagString(args, "workflow", join(process.cwd(), "eval/recall-case-author.workflow.json"));
  const workflow = readJson<Record<string, any>>(workflowPath);
  const caseCheck = workflow["schemas"]["CaseCheck"]["properties"];
  const problems: string[] = [];
  if (caseCheck["answers"]["description"] !== ANSWERS_QUESTION) problems.push("workflow CaseCheck.answers description differs from ANSWERS_QUESTION");
  if (caseCheck["standalone"]["description"] !== STANDALONE_QUESTION) problems.push("workflow CaseCheck.standalone description differs from STANDALONE_QUESTION");
  const rootSteps = workflow["root"]["steps"] as Array<Record<string, any>>;
  const mapNode = rootSteps.find((step) => step["node"] === "map");
  if (mapNode === undefined) problems.push("workflow has no map node");
  if (mapNode !== undefined && mapNode["maxConcurrency"] > JEV_CONCURRENCY) problems.push("map concurrency exceeds 4");
  const body = (mapNode?.["body"]?.["steps"] ?? []) as Array<Record<string, any>>;
  const gate = body.find((step) => step["label"] === "gate-case");
  if (gate === undefined) problems.push("workflow has no gate-case code node");
  else if (!String(gate["code"]).includes("$answers") || !String(gate["code"]).includes("noul")) {
    problems.push("gate-case does not read the judge sidecar's noul probability");
  }
  const hashes = {
    workflow: sha256(readFileSync(workflowPath)),
    cli: sha256(readFileSync(new URL("./recall-r1b-cli.ts", import.meta.url))),
    lib: sha256(readFileSync(new URL("./recall-r1b-lib.ts", import.meta.url))),
    jev: sha256(readFileSync(new URL("./recall-r1b-jev.ts", import.meta.url))),
    armJInstructions: sha256(ARM_J_INSTRUCTIONS),
    answersQuestion: sha256(ANSWERS_QUESTION),
    standaloneQuestion: sha256(STANDALONE_QUESTION),
    rankingWeights: weightsHash(),
  };
  const report = { ok: problems.length === 0, problems, hashes };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

// -- entry point -------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "build":
      commandBuild(args);
      return;
    case "sample":
      commandSample(args);
      return;
    case "dryrun-targets":
      commandDryRunTargets(args);
      return;
    case "casefile":
      commandCasefile(args);
      return;
    case "overlap":
      commandOverlap(args);
      return;
    case "measure":
      await commandMeasure(args);
      return;
    case "failopen":
      await commandFailopen(args);
      return;
    case "scan":
      commandScan(args);
      return;
    case "calib":
      await commandCalib(args);
      return;
    case "check":
      commandCheck(args);
      return;
    default:
      throw new Error(
        "usage: recall-r1b-cli.ts <build|sample|dryrun-targets|casefile|overlap|measure|failopen|scan|calib|check> [--flag value] [positional...]",
      );
  }
}

await main();
