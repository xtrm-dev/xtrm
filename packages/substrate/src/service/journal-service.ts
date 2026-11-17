// Journal service (PRD §20): append-only Issue-scoped Work Journal with the
// mechanical-first checkpoint guarantee (§20.4). The mechanical checkpoint
// is committed before the optional semantic summarizer runs, so a
// summarizer failure — or a process killed mid-summarization — still leaves
// resumable mechanical state. Compaction is lossy conversation management,
// never durable work state (§5); this service is the durable side that
// Phases 6/7 (Pi/Claude seams) consume. No host wiring lives here.

import type { DatabaseSync, SQLInputValue } from "../store/database.ts";
import { withTransaction } from "../store/transactions.ts";
import { formatHumanRef } from "../domain/issue.ts";
import type { IssueService } from "./issue-service.ts";
import {
  assertResultPayload,
  assertSemanticCheckpoint,
  assessJournalEntry,
  isJournalKind,
  newJournalEntryId,
  previewText,
  unknownJournalKindMessage,
  validateEvidenceRefs,
  validateMechanicalCheckpoint,
  validateResultPayload,
  validateSemanticCheckpoint,
  JOURNAL_KINDS,
  RESULT_VERSION,
  type EvidenceRef,
  type JournalEntry,
  type JournalKind,
  type MechanicalCheckpoint,
  type ResultPayload,
  type SemanticCheckpoint,
} from "../domain/journal.ts";
import {
  ambientIdentityFallback,
  canonicalizeWriteIdentity,
  executionContextFromLegacy,
  normalizeExecutionContext,
  projectFlatIdentity,
  validateExecutionContext,
  type ExecutionContext,
} from "../domain/execution-context.ts";

interface Row {
  [key: string]: unknown;
}

// -- project-wide feed (XTRM-764) -------------------------------------------

/** Rows a feed page may carry. The bridge pages; a huge page defeats that. */
export const DEFAULT_FEED_LIMIT = 50;
export const MAX_FEED_LIMIT = 500;

/** `(created_at, id)`, opaque to callers: they pass it back, never parse it. */
export interface FeedCursor {
  time: number;
  id: string;
}

export interface JournalFeedEntry {
  /** The Issue's human ref (`XTRM-764`) — the feed is read across Issues. */
  issueRef: string;
  issueId: string;
  entry: JournalEntry;
}

export interface JournalFeedPage {
  projectId: string;
  entries: JournalFeedEntry[];
  /** Pass back with the same flag: `--before` after a page, `--since` after a poll. */
  nextCursor: string | null;
  limit: number;
}

export interface JournalFeedInput {
  projectId: string;
  limit?: number;
  kinds?: JournalKind[] | null;
  cursor?: FeedCursor;
  /** The flag the cursor came from: `before` pages downwards, `newer` polls. */
  direction?: "before" | "newer";
  /** A `--since` time bound (epoch ms), exclusive of nothing: `>=`. */
  sinceTime?: number | null;
}

interface FeedRow extends Row {
  issue_id: string;
  human_number: number;
  prefix: string;
  created_at: number;
  id: string;
}

/**
 * Cursor encoding: base64url of `{t, id}`. Opaque on purpose — a caller that
 * parses it would depend on the ordering key, which is the schema's business.
 */
export function encodeFeedCursor(row: { created_at: number; id: string }): string {
  return Buffer.from(JSON.stringify({ t: row.created_at, id: row.id }), "utf8").toString("base64url");
}

/** Fail closed on a malformed cursor: a wrong page is worse than a refusal. */
export function decodeFeedCursor(value: string): FeedCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid cursor: pass nextCursor from a previous feed page");
  }
  const record = parsed as { t?: unknown; id?: unknown };
  if (typeof record.t !== "number" || !Number.isInteger(record.t) || record.t < 0 || typeof record.id !== "string" || record.id === "") {
    throw new Error("invalid cursor: pass nextCursor from a previous feed page");
  }
  return { time: record.t, id: record.id };
}

function row<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function rows<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export interface AppendEntryInput {
  kind: JournalKind;
  runId?: string;
  participantId?: string;
  activationId?: string;
  sessionId?: string;
  mechanical?: MechanicalCheckpoint;
  semantic?: SemanticCheckpoint;
  result?: ResultPayload;
  refs?: EvidenceRef[];
  // Authoritative optional runtime input (ADR §57): replaces manual
  // --session/--activation/--attempt/--participant/--branch flags.
  executionContext?: ExecutionContext | null;
}

export interface CollectMechanicalInput {
  runId?: string;
  participantId?: string;
  activationId?: string;
  sessionId?: string;
  workspace?: string;
  branch?: string;
  baseCommit?: string;
  headCommit?: string;
  changedFiles?: string[];
  commitsSincePrevious?: string[];
  specialistRefs?: string[];
  pendingAsks?: string[];
  externalBindings?: Array<{ provider: string; scope: string; remoteId: string }>;
  mechanical?: Partial<MechanicalCheckpoint>;
  executionContext?: ExecutionContext | null;
}

export type Summarizer = (
  persisted: JournalEntry,
  mechanical: MechanicalCheckpoint,
) => SemanticCheckpoint | Promise<SemanticCheckpoint>;

export interface CheckpointOptions extends CollectMechanicalInput {
  kind?: "checkpoint" | "compaction";
  refs?: EvidenceRef[];
  summarizer?: Summarizer;
}

export interface CheckpointResult {
  entry: JournalEntry;
  degraded: boolean;
  reason?: string;
}

// Phase 6/7 seam (§§23-24): hosts call this, never checkpoint() directly
// when a fallback decision is needed. Mechanical-write failure must not
// block overflow-recovery compaction: the caller proceeds with the host
// default and reconciles later.
export interface CompactionCheckpointResult {
  entry: JournalEntry | null;
  degraded: boolean;
  reason?: string;
  fallbackToDefault: boolean;
}

export interface JournalDelta {
  issueId: string;
  afterSequence: number;
  entries: JournalEntry[];
  nextCursor: number;
}

// Bounded operational context for `sb issue show` (ADR §50): latest entry per
// kind plus a short recent window and per-kind counts. Never the whole journal.
// `summary`/`outcome` are the only text fields carried, so a large journal
// cannot enlarge the default show output without bound.
export interface JournalContextEntry {
  entryId: string;
  sequence: number;
  kind: JournalKind;
  issueRevision: number;
  createdAt: number;
  summary: string | null;
  outcome: string | null;
}

export interface JournalOperationalContext {
  recent: JournalContextEntry[];
  latestByKind: JournalContextEntry[];
  latestCheckpoint: { entryId: string; sequence: number } | null;
  countsByKind: Record<string, number>;
  total: number;
}

export const DEFAULT_CONTEXT_LIMIT = 10;
export const MAX_CONTEXT_LIMIT = 50;

// XTRM-678: rendered views cut long text with a marker, never silently.
function trunc(s: string, max = 2000): string {
  return previewText(s, max, "full text: sb journal show --json");
}

const CONTEXT_SUMMARY_MAX = 280;

function contextTrunc(s: string | null): string | null {
  return s === null ? null : previewText(s, CONTEXT_SUMMARY_MAX, "full text: sb journal show --json");
}

/**
 * Authority for the Issue-scoped Work Journal: the only writer of journal
 * rows, owning append-only durability in the WAL store (entries are never
 * updated, only superseded by newer entries). Side effects are one journal row
 * plus one journal.appended event per append, committed before any semantic
 * enrichment runs, so enrichment failure still leaves resumable mechanical
 * state. Appends never touch the Issue revision and never stale readiness:
 * the Journal carries continuity, never execution authority. Automatic
 * metadata: every entry pins issue revision, sequence, timestamp and the
 * shared versioned execution envelope. Appends are idempotent only when the
 * caller reuses an idempotency boundary (sequence allocation is
 * insert-once); unknown kinds, missing mechanical rows for checkpoint or
 * compaction, and result payloads on non-result kinds fail closed.
 */
export class JournalService {
  private readonly db: DatabaseSync;
  private readonly issues: IssueService;

  constructor(db: DatabaseSync, issues: IssueService) {
    this.db = db;
    this.issues = issues;
  }

  /** Single append-only write allocating the next sequence; continuity only, never execution authority. */
  appendEntry(issueId: string, input: AppendEntryInput): JournalEntry {
    if (!isJournalKind(input.kind)) throw new Error(unknownJournalKindMessage(input.kind));
    if (input.refs !== undefined) {
      const problems = validateEvidenceRefs(input.refs);
      if (problems.length > 0) throw new Error(`invalid journal refs: ${problems[0]}`);
    }
    const quality = assessJournalEntry(input);
    if (quality.errors.length > 0) throw new Error(quality.errors[0]);
    if (input.semantic !== undefined) assertSemanticCheckpoint(input.semantic);
    if (input.result !== undefined) assertResultPayload(input.result);
    if (input.mechanical !== undefined) {
      const problems = validateMechanicalCheckpoint(input.mechanical);
      if (problems.length > 0) throw new Error(`invalid mechanical checkpoint: ${problems[0]}`);
      if (input.mechanical.issueId !== issueId) {
        throw new Error("mechanical.issueId must match the appended issue");
      }
    }
    if ((input.kind === "checkpoint" || input.kind === "compaction") && input.mechanical === undefined) {
      throw new Error(`journal kind "${input.kind}" requires a mechanical checkpoint (§20.4)`);
    }
    // A result is a bounded execution outcome, never an unbounded body: the
    // kind is only legal with a validated ResultPayload (§§29, 39).
    if (input.kind === "result" && input.result === undefined) {
      throw new Error('journal kind "result" requires a bounded result payload (§29); pass --result \'{"summary":"…"}\'');
    }
    if (input.kind !== "result" && input.result !== undefined) {
      throw new Error(`journal kind "${input.kind}" does not carry a result payload`);
    }
    // Version envelope (XTRM-339): stamped at append time, never UPDATEd.
    // Unknown versions already failed closed in assertResultPayload above.
    const result = input.result !== undefined ? { resultVersion: RESULT_VERSION, ...input.result } : undefined;
    // Shared envelope (X1): normalized fail-closed, then projected to the
    // flat columns through the central projection: agreement is enforced
    // (conflicts throw fail-closed), with the documented flat-only
    // exception for provider-unknown legacy sessions.
    //
    // Identity resolution (XTRM-417): when the caller supplied no execution
    // context, derive it ONCE here from the current process context, so an
    // entry written inside a session carries participant/session/activation
    // without the caller restating them. No context means explicit absence:
    // nothing is inherited from a previous append and nothing is fabricated.
    // Identity values are canonicalised and validated at this write seam
    // (XTRM-412) before any row is written; a rejection throws and stores
    // nothing.
    const supplied = normalizeExecutionContext(
      input.executionContext ??
        ambientIdentityFallback({
          participantId: input.participantId ?? null,
          activationId: input.activationId ?? null,
          sessionId: input.sessionId ?? null,
          runId: input.runId ?? null,
        }),
    );
    const identity = canonicalizeWriteIdentity({
      executionContext: supplied,
      participantId: input.participantId ?? null,
      activationId: input.activationId ?? null,
      attemptId: null,
      sessionId: input.sessionId ?? null,
      runId: input.runId ?? null,
    });
    const ctx = identity.executionContext;
    const flat = projectFlatIdentity(ctx, {
      participantId: identity.participantId,
      activationId: identity.activationId,
      sessionId: identity.sessionId,
      runId: identity.runId,
    });
    return withTransaction(this.db, () => {
      const issue = this.issues.getIssue(issueId);
      const prev = row<{ m: number | null }>(
        this.db,
        "SELECT MAX(sequence) AS m FROM issue_journal WHERE issue_id = ?",
        issueId,
      );
      const sequence = (prev?.m ?? 0) + 1;
      const now = Date.now();
      const id = newJournalEntryId();
      this.db
        .prepare(
          `INSERT INTO issue_journal
             (id, issue_id, issue_revision, sequence, run_id, participant_id,
              activation_id, session_id, kind, mechanical_json, semantic_json,
              result_json, refs_json, execution_context_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          issueId,
          issue.currentRevision,
          sequence,
          flat.runId,
          flat.participantId,
          flat.activationId,
          flat.sessionId,
          input.kind,
          input.mechanical ? JSON.stringify(input.mechanical) : null,
          input.semantic ? JSON.stringify(input.semantic) : null,
          input.result ? JSON.stringify(result) : null,
          JSON.stringify(input.refs ?? []),
          ctx ? JSON.stringify(ctx) : null,
          now,
        );
      this.issues.appendEvent(issueId, "journal.appended", { entry: id, sequence, kind: input.kind });
      return this.requireEntry(id);
    });
  }

  /**
   * Append several entries as one unit (XTRM-678). A note longer than the
   * summary limit is stored as parts; a rerun must see either all parts or
   * none, never a prefix that the key-match then skips.
   */
  appendEntries(issueId: string, inputs: ReadonlyArray<AppendEntryInput>): JournalEntry[] {
    return withTransaction(this.db, () => inputs.map((input) => this.appendEntry(issueId, input)));
  }

  getEntry(id: string): JournalEntry {
    return this.requireEntry(id);
  }

  listEntries(issueId: string, opts?: { kind?: JournalKind; limit?: number; before?: number }): JournalEntry[] {
    this.issues.getIssue(issueId);
    let sql = "SELECT * FROM issue_journal WHERE issue_id = ?";
    const params: SQLInputValue[] = [issueId];
    if (opts?.kind !== undefined) {
      if (!isJournalKind(opts.kind)) throw new Error(unknownJournalKindMessage(opts.kind));
      sql += " AND kind = ?";
      params.push(opts.kind);
    }
    // Backwards cursor (§49 paging): the window that ENDS before `before`.
    // A forward LIMIT over a large journal drops the newest entries, so a
    // caller that needs bodies from the tail pages backwards from a sequence
    // it already holds. Desktop order is restored before returning.
    if (opts?.before !== undefined) {
      if (!Number.isInteger(opts.before) || opts.before <= 0) throw new Error("before must be a positive integer sequence");
      if (opts.limit === undefined) throw new Error("a limit is required with before");
      if (!Number.isInteger(opts.limit) || opts.limit <= 0) throw new Error("limit must be a positive integer");
      sql += " AND sequence < ? ORDER BY sequence DESC LIMIT ?";
      params.push(opts.before, opts.limit);
      return rows<Row>(this.db, sql, ...params)
        .map((r) => this.toEntry(r))
        .reverse();
    }
    sql += " ORDER BY sequence";
    if (opts?.limit !== undefined) {
      if (!Number.isInteger(opts.limit) || opts.limit <= 0) throw new Error("limit must be a positive integer");
      sql += " LIMIT ?";
      params.push(opts.limit);
    }
    return rows<Row>(this.db, sql, ...params).map((r) => this.toEntry(r));
  }

  // -- project-wide feed (XTRM-764) -----------------------------------------
  //
  // One page across every Issue of a project, newest first, ordered by
  // `(created_at, id)`. The cursor is that pair, opaque to the caller, so a
  // page can never shift an entry across the boundary: a new row is always
  // newer than the cursor, and pages walk downwards.
  //
  // No dedicated index: measured on 10k entries across 50 issues, the planner
  // drives from `issues(project_id)`, then probes `ix_journal_issue_seq` per
  // issue, then sorts that project's rows in a temp B-tree (1.7 ms for a
  // 50-entry page with or without a `(created_at, id)` index, which it never
  // chose). An index that the planner ignores is a write cost with no read win,
  // so the migration that added one was dropped before merge.
  feed(input: JournalFeedInput): JournalFeedPage {
    const project = this.issues.getProject(input.projectId);
    const limit = input.limit ?? DEFAULT_FEED_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_FEED_LIMIT) {
      throw new Error(`limit must be an integer between 1 and ${MAX_FEED_LIMIT}`);
    }
    const kinds = input.kinds ?? null;
    for (const kind of kinds ?? []) {
      if (!isJournalKind(kind)) throw new Error(unknownJournalKindMessage(kind));
    }
    // Order is fixed: newest first. `since` (a cursor) walks a poll forwards,
    // so its SELECT is ascending and only the presentation flips.
    const select = (where: string, params: SQLInputValue[], order: "DESC" | "ASC"): FeedRow[] =>
      rows<FeedRow>(
        this.db,
        `SELECT j.id, j.issue_id, j.issue_revision, j.sequence, j.run_id, j.participant_id,
                j.activation_id, j.session_id, j.kind, j.mechanical_json, j.semantic_json,
                j.result_json, j.refs_json, j.created_at, j.execution_context_json,
                i.human_number, p.prefix
           FROM issue_journal j
           JOIN issues i ON i.id = j.issue_id
           JOIN projects p ON p.id = i.project_id
          WHERE i.project_id = ?${where}
          ORDER BY j.created_at ${order}, j.id ${order}
          LIMIT ?`,
        input.projectId,
        ...params,
        limit,
      );

    const kindClause = (): string => (kinds === null || kinds.length === 0 ? "" : ` AND j.kind IN (${kinds.map(() => "?").join(",")})`);
    const kindParams = (): string[] => kinds ?? [];

    // A poll walks forward from a cursor; a time bound is a page bound, not a
    // cursor. Mixing them silently would drop one of the two, so refuse instead.
    if (input.direction === "newer" && input.sinceTime !== undefined && input.sinceTime !== null) {
      throw new Error("a cursor poll cannot also carry a time bound");
    }
    let page: FeedRow[];
    let nextCursor: string | null;
    if (input.cursor !== undefined && input.direction === "newer") {
      const { time, id } = input.cursor;
      // A poll takes the OLDEST n rows above the cursor, then presents them
      // newest first. Selecting the newest n instead would skip everything in
      // between when a burst is larger than one page.
      const forward = select(` AND (j.created_at, j.id) > (?, ?)${kindClause()}`, [time, id, ...kindParams()], "ASC");
      page = forward.reverse();
      // The newest row of this page is the cursor the next poll continues from;
      // no row means the caller already holds the newest entry.
      nextCursor = page.length === 0 ? null : encodeFeedCursor(page[0]!);
    } else {
      const bounds: SQLInputValue[] = [];
      let where = "";
      if (input.cursor !== undefined) {
        where += ` AND (j.created_at, j.id) < (?, ?)`;
        bounds.push(input.cursor.time ?? 0, input.cursor.id ?? "");
      }
      if (input.sinceTime !== undefined && input.sinceTime !== null) {
        where += ` AND j.created_at >= ?`;
        bounds.push(input.sinceTime);
      }
      where += kindClause();
      bounds.push(...kindParams());
      // Newest first: the SELECT already orders that way, so the page is the
      // result as read and the cursor is its OLDEST row (the last one) — the
      // row the next `--before` page must start below. `reverse()` here would
      // hand back the newest row and repeat a whole page.
      page = select(where, bounds, "DESC");
      // A short page is the end of the feed: emitting a cursor there would make
      // every drain loop issue one more empty request.
      nextCursor = page.length < limit ? null : encodeFeedCursor(page[page.length - 1]!);
    }

    const entries: JournalFeedEntry[] = page.map((r) => ({
      issueRef: formatHumanRef(project.prefix, r.human_number),
      issueId: r.issue_id,
      entry: this.toEntry(r),
    }));
    return { projectId: project.id, entries, nextCursor, limit };
  }

  // Cursor read (§20.5): only entries after the supplied sequence cursor.
  // A resumed agent reads the delta, never the whole journal.
  since(issueId: string, cursor: number): JournalDelta {
    if (!Number.isInteger(cursor) || cursor < 0) throw new Error("cursor must be a non-negative integer sequence");
    this.issues.getIssue(issueId);
    const entries = rows<Row>(
      this.db,
      "SELECT * FROM issue_journal WHERE issue_id = ? AND sequence > ? ORDER BY sequence",
      issueId,
      cursor,
    ).map((r) => this.toEntry(r));
    const top = row<{ m: number | null }>(this.db, "SELECT MAX(sequence) AS m FROM issue_journal WHERE issue_id = ?", issueId);
    return { issueId, afterSequence: cursor, entries, nextCursor: top?.m ?? cursor };
  }

  latestCheckpoint(issueId: string): JournalEntry | null {
    this.issues.getIssue(issueId);
    const r = row<Row>(
      this.db,
      "SELECT * FROM issue_journal WHERE issue_id = ? AND kind IN ('checkpoint', 'compaction') ORDER BY sequence DESC LIMIT 1",
      issueId,
    );
    return r ? this.toEntry(r) : null;
  }

  // Newest entry overall, or newest entry of one kind (ADR §49 `latest`).
  latest(issueId: string, opts?: { kind?: JournalKind }): JournalEntry | null {
    this.issues.getIssue(issueId);
    if (opts?.kind !== undefined && !isJournalKind(opts.kind)) {
      throw new Error(unknownJournalKindMessage(opts.kind));
    }
    const r =
      opts?.kind !== undefined
        ? row<Row>(
            this.db,
            "SELECT * FROM issue_journal WHERE issue_id = ? AND kind = ? ORDER BY sequence DESC LIMIT 1",
            issueId,
            opts.kind,
          )
        : row<Row>(this.db, "SELECT * FROM issue_journal WHERE issue_id = ? ORDER BY sequence DESC LIMIT 1", issueId);
    return r ? this.toEntry(r) : null;
  }

  // Bounded reverse-chronological window returned in chronological order
  // (ADR §49 `timeline`). Unlike listEntries (oldest-first with LIMIT), this
  // selects the newest `limit` entries and then orders them forwards.
  timeline(issueId: string, opts?: { kind?: JournalKind; limit?: number }): JournalEntry[] {
    this.issues.getIssue(issueId);
    if (opts?.kind !== undefined && !isJournalKind(opts.kind)) {
      throw new Error(unknownJournalKindMessage(opts.kind));
    }
    const limit = opts?.limit ?? 50;
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
    let sql = "SELECT * FROM issue_journal WHERE issue_id = ?";
    const params: SQLInputValue[] = [issueId];
    if (opts?.kind !== undefined) {
      sql += " AND kind = ?";
      params.push(opts.kind);
    }
    sql += " ORDER BY sequence DESC LIMIT ?";
    params.push(limit);
    return rows<Row>(this.db, sql, ...params)
      .map((r) => this.toEntry(r))
      .reverse();
  }

  // Bounded operational context for `sb issue show` (ADR §50). Every read
  // here is bounded; the whole journal is never materialized.
  operationalContext(issueId: string, opts?: { limit?: number }): JournalOperationalContext {
    this.issues.getIssue(issueId);
    const limit = opts?.limit ?? DEFAULT_CONTEXT_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
    const bounded = Math.min(limit, MAX_CONTEXT_LIMIT);
    const recent = rows<Row>(
      this.db,
      "SELECT * FROM issue_journal WHERE issue_id = ? ORDER BY sequence DESC LIMIT ?",
      issueId,
      bounded,
    )
      .map((r) => this.toContextEntry(this.toEntry(r)))
      .reverse();
    const latestByKind: JournalContextEntry[] = [];
    for (const kind of JOURNAL_KINDS) {
      const r = row<Row>(
        this.db,
        "SELECT * FROM issue_journal WHERE issue_id = ? AND kind = ? ORDER BY sequence DESC LIMIT 1",
        issueId,
        kind,
      );
      if (r) latestByKind.push(this.toContextEntry(this.toEntry(r)));
    }
    latestByKind.reverse();
    const countsByKind: Record<string, number> = {};
    let total = 0;
    for (const r of rows<{ kind: string; n: number }>(
      this.db,
      "SELECT kind, COUNT(*) AS n FROM issue_journal WHERE issue_id = ? GROUP BY kind",
      issueId,
    )) {
      countsByKind[r.kind] = r.n;
      total += r.n;
    }
    const cp = this.latestCheckpoint(issueId);
    return {
      recent,
      latestByKind,
      latestCheckpoint: cp ? { entryId: cp.id, sequence: cp.sequence } : null,
      countsByKind,
      total,
    };
  }

  private toContextEntry(e: JournalEntry): JournalContextEntry {
    return {
      entryId: e.id,
      sequence: e.sequence,
      kind: e.kind,
      issueRevision: e.issueRevision,
      createdAt: e.createdAt,
      // Truncated so a single huge entry (or 60 of them) cannot enlarge the
      // default show output without bound.
      summary: contextTrunc(e.semantic?.summary ?? e.result?.summary ?? null),
      outcome: e.result?.outcome ?? null,
    };
  }

  // Host-known state merged over service-derived state. Derived values win
  // for revision/hash/claim/blockers/children (durable truth); host values
  // win for execution context the service cannot see (workspace, commits).
  /** Gathers what the host already knows without model reasoning; the resumability floor every checkpoint commits first. */
  collectMechanical(issueId: string, input: CollectMechanicalInput = {}): MechanicalCheckpoint {
    const issue = this.issues.getIssue(issueId);
    const claim = this.issues.getActiveClaim(issueId);
    const pendingBlockers = this.issues.unsatisfiedBlockers(issueId);
    const childSummary = this.issues.listChildren(issueId).map((c) => {
      let checkpointRef: string | null = null;
      try {
        const latest = this.latestCheckpoint(c.id);
        checkpointRef = latest ? `${latest.id}#${latest.sequence}` : null;
      } catch {
        checkpointRef = null;
      }
      return {
        issueId: c.id,
        locator: c.locator,
        lifecycleState: c.lifecycleState,
        revision: c.currentRevision,
        checkpointRef,
        blockedBy: this.issues.unsatisfiedBlockers(c.id),
      };
    });
    const now = Date.now();
    const merged: MechanicalCheckpoint = {
      issueId,
      issueRevision: issue.currentRevision,
      contractHash: issue.currentContractHash,
      collectedAt: now,
      claimHolder: claim?.holder ?? null,
      claimActivationId: claim?.activationId ?? null,
      claimExpiresAt: claim?.expiresAt ?? null,
      participantId: input.participantId ?? null,
      activationId: input.activationId ?? null,
      sessionId: input.sessionId ?? null,
      runId: input.runId ?? null,
      workspace: input.workspace ?? null,
      branch: input.branch ?? null,
      baseCommit: input.baseCommit ?? null,
      headCommit: input.headCommit ?? null,
      changedFiles: input.changedFiles ?? [],
      commitsSincePrevious: input.commitsSincePrevious ?? [],
      pendingBlockers,
      childSummary,
      specialistRefs: input.specialistRefs ?? [],
      pendingAsks: input.pendingAsks ?? [],
      externalBindings: input.externalBindings ?? [],
      cursor: null,
      ...input.mechanical,
    };
    // Derived durable truth wins over host overrides for identity fields.
    merged.issueId = issueId;
    merged.issueRevision = issue.currentRevision;
    merged.contractHash = issue.currentContractHash;
    return merged;
  }

  /** Attaches the semantic summary after the mechanical row has committed; enrichment failure never loses resumability. */
  enrichEntry(entryId: string, semantic: SemanticCheckpoint): JournalEntry {
    assertSemanticCheckpoint(semantic);
    return withTransaction(this.db, () => {
      const current = this.requireEntry(entryId);
      if (current.kind !== "checkpoint" && current.kind !== "compaction") {
        throw new Error(
          `already inadmissible: journal entry ${entryId} is a ${current.kind}; only a checkpoint or compaction carries a semantic layer`,
        );
      }
      // The precondition is part of the write. A read-then-update let two callers
      // both see "no summary yet" and overwrite each other (60 of 60 racing trials),
      // losing the first summary with no copy anywhere.
      const updated = this.db
        .prepare(
          `UPDATE issue_journal SET semantic_json = ?
            WHERE id = ? AND semantic_json IS NULL AND kind IN ('checkpoint','compaction')`,
        )
        .run(JSON.stringify(semantic), entryId);
      if (Number(updated.changes) === 0) {
        throw new Error(
          `already enriched: journal entry ${entryId} carries a summary; the first summary stands and is never overwritten`,
        );
      }
      this.issues.appendEvent(current.issueId, "journal.checkpoint_enriched", { entry: entryId, sequence: current.sequence });
      return this.requireEntry(entryId);
    });
  }

  // Mechanical-first ordering (§20.4): the mechanical entry commits before
  // the summarizer starts, so the summarizer can observe it (D22) and its
  // failure still leaves resumable state (D23).
  async checkpoint(issueId: string, opts: CheckpointOptions = {}): Promise<CheckpointResult> {
    const kind = opts.kind ?? "checkpoint";
    const mechanical = this.collectMechanical(issueId, opts);
    const entry = this.appendEntry(issueId, {
      kind,
      runId: opts.runId,
      participantId: opts.participantId,
      activationId: opts.activationId,
      sessionId: opts.sessionId,
      mechanical,
      refs: opts.refs,
      executionContext: opts.executionContext ?? null,
    });
    // Stamp the occupied cursor onto the durable row (post-commit update:
    // the mechanical row itself was already durable before this runs).
    withTransaction(this.db, () => {
      const stored = this.requireEntry(entry.id);
      this.db
        .prepare("UPDATE issue_journal SET mechanical_json = ? WHERE id = ?")
        .run(JSON.stringify({ ...stored.mechanical, cursor: stored.sequence }), entry.id);
    });
    const persisted = this.requireEntry(entry.id);
    if (!opts.summarizer) return { entry: persisted, degraded: false };
    try {
      const semantic = await opts.summarizer(persisted, persisted.mechanical!);
      const enriched = this.enrichEntry(persisted.id, semantic);
      return { entry: enriched, degraded: false };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      try {
        this.issues.appendEvent(issueId, "journal.checkpoint_degraded", {
          entry: persisted.id,
          sequence: persisted.sequence,
          reason,
        });
      } catch {
        // The degraded marker is best-effort: the mechanical row is
        // already durable, which is the guarantee that matters.
      }
      return { entry: persisted, degraded: true, reason };
    }
  }

  async compactionCheckpoint(issueId: string, opts: CheckpointOptions = {}): Promise<CompactionCheckpointResult> {
    try {
      const result = await this.checkpoint(issueId, opts);
      return { ...result, fallbackToDefault: result.degraded };
    } catch (err) {
      // SQLite write failure (§§23.2/24.3): never block overflow-recovery
      // compaction. The host falls back to its default summary and a later
      // reconciliation reconstructs from retained evidence.
      const reason = err instanceof Error ? err.message : String(err);
      return { entry: null, degraded: true, reason, fallbackToDefault: true };
    }
  }

  // One shared rendering for the journal checkpoint and the host compaction
  // summary (§23.1): two independent summaries must never disagree.
  renderCheckpoint(entry: JournalEntry): string {
    const lines = [`CHECKPOINT ${entry.id} seq${entry.sequence} ${entry.kind} rev${entry.issueRevision}`];
    const m = entry.mechanical;
    if (m) {
      const bits = [`rev${m.issueRevision} ${m.contractHash.slice(0, 12)}`];
      if (m.claimHolder) bits.push(`claim ${m.claimHolder}`);
      if (m.pendingBlockers?.length) bits.push(`blockers ${m.pendingBlockers.join(",")}`);
      if (m.childSummary?.length) {
        bits.push(`children ${m.childSummary.map((c) => `${c.locator ?? c.issueId}:${c.lifecycleState ?? "?"}`).join(",")}`);
      }
      if (m.headCommit) bits.push(`head ${m.headCommit.slice(0, 12)}`);
      lines.push(`MECHANICAL: ${bits.join("; ")}`);
    }
    const s = entry.semantic;
    if (!s) {
      // Say only what the row holds. A result entry normally has no semantic
      // summary but does carry bounded evidence, so render that evidence rather
      // than claiming (or denying) a mechanical payload it may not have.
      const r = entry.result;
      if (r) {
        // A legacy row can hold an empty summary (the writer used to accept it).
        // Printing a bare "RESULT:" would look like content that failed to
        // render, so say the summary is missing instead of showing nothing.
        const summary = typeof r.summary === "string" ? r.summary.trim() : "";
        const outcome = r.outcome ? ` (${r.outcome})` : "";
        lines.push(summary ? `RESULT: ${trunc(summary)}${outcome}` : `RESULT: (no summary recorded)${outcome}`);
      } else {
        lines.push(
          m
            ? "SEMANTIC: (mechanical-only; summarizer pending or degraded)"
            : "SEMANTIC: (none; this entry carries no summary and no mechanical state)",
        );
      }
      return lines.join("\n");
    }
    lines.push(`SUMMARY: ${trunc(s.summary)}`);
    if (s.completed?.length) lines.push(`COMPLETED: ${s.completed.map((e) => trunc(e, 500)).join(" | ")}`);
    if (s.current) lines.push(`CURRENT: ${trunc(s.current, 500)}`);
    if (s.next?.length) lines.push(`NEXT: ${s.next.map((e) => trunc(e, 500)).join(" | ")}`);
    if (s.blocked?.length) lines.push(`BLOCKED: ${s.blocked.map((e) => trunc(e, 500)).join(" | ")}`);
    if (s.openQuestions?.length) lines.push(`OPEN QUESTIONS: ${s.openQuestions.map((e) => trunc(e, 500)).join(" | ")}`);
    if (s.keyDecisions?.length) lines.push(`DECISIONS: ${s.keyDecisions.map((e) => trunc(e, 500)).join(" | ")}`);
    if (s.materialFindings?.length) lines.push(`FINDINGS: ${s.materialFindings.map((e) => trunc(e, 500)).join(" | ")}`);
    return lines.join("\n");
  }

  private requireEntry(id: string): JournalEntry {
    const r = row<Row>(this.db, "SELECT * FROM issue_journal WHERE id = ?", id);
    if (!r) throw new Error(`unknown journal entry: ${id}`);
    return this.toEntry(r);
  }

  // Semantic is validated on read (§20.4 contract): a corrupt row fails
  // closed rather than resuming an agent from a malformed summary.
  private toEntry(r: Row): JournalEntry {
    const kind = r["kind"] as string;
    if (!isJournalKind(kind)) throw new Error(`fail-closed: corrupt journal kind on ${r["id"]}`);
    let semantic: SemanticCheckpoint | null = null;
    if (r["semantic_json"] != null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(r["semantic_json"] as string);
      } catch {
        throw new Error(`fail-closed: corrupt semantic checkpoint on ${r["id"]}`);
      }
      const problems = validateSemanticCheckpoint(parsed);
      if (problems.length > 0) throw new Error(`fail-closed: invalid semantic checkpoint on ${r["id"]}: ${problems[0]}`);
      semantic = parsed as SemanticCheckpoint;
    }
    let result: ResultPayload | null = null;
    if (r["result_json"] != null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(r["result_json"] as string);
      } catch {
        throw new Error(`fail-closed: corrupt result payload on ${r["id"]}`);
      }
      const problems = validateResultPayload(parsed);
      if (problems.length > 0) throw new Error(`fail-closed: invalid result payload on ${r["id"]}: ${problems[0]}`);
      // Pre-change rows carry no version: default to 1 so they stay readable.
      const raw = parsed as Record<string, unknown>;
      result = { resultVersion: RESULT_VERSION, ...raw } as ResultPayload;
    }
    let mechanical: MechanicalCheckpoint | null = null;
    if (r["mechanical_json"] != null) {
      try {
        mechanical = JSON.parse(r["mechanical_json"] as string) as MechanicalCheckpoint;
      } catch {
        throw new Error(`fail-closed: corrupt mechanical checkpoint on ${r["id"]}`);
      }
    }
    let refs: EvidenceRef[] = [];
    try {
      refs = JSON.parse((r["refs_json"] as string) ?? "[]") as EvidenceRef[];
    } catch {
      throw new Error(`fail-closed: corrupt journal refs on ${r["id"]}`);
    }
    // Stored envelope wins; legacy rows project flat columns to v1, or
    // absent when nothing is known (§98). Corrupt JSON fails closed.
    let executionContext: ExecutionContext | null = null;
    const rawCtx = r["execution_context_json"] as string | null | undefined;
    if (rawCtx !== null && rawCtx !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawCtx);
      } catch {
        throw new Error(`fail-closed: corrupt execution context on ${r["id"]}`);
      }
      const problems = validateExecutionContext(parsed);
      if (problems.length > 0) throw new Error(`fail-closed: invalid execution context on ${r["id"]}: ${problems[0]}`);
      executionContext = normalizeExecutionContext(parsed);
    } else {
      executionContext = executionContextFromLegacy({
        participantId: (r["participant_id"] as string | null) ?? null,
        activationId: (r["activation_id"] as string | null) ?? null,
        sessionId: (r["session_id"] as string | null) ?? null,
        runId: (r["run_id"] as string | null) ?? null,
      }, { timestamp: r["created_at"] as number });
    }
    return {
      id: r["id"] as string,
      issueId: r["issue_id"] as string,
      issueRevision: r["issue_revision"] as number,
      sequence: r["sequence"] as number,
      runId: (r["run_id"] as string | null) ?? null,
      participantId: (r["participant_id"] as string | null) ?? null,
      activationId: (r["activation_id"] as string | null) ?? null,
      sessionId: (r["session_id"] as string | null) ?? null,
      kind,
      mechanical,
      semantic,
      result,
      refs,
      createdAt: r["created_at"] as number,
      executionContext,
    };
  }
}
