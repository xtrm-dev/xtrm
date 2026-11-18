import type { DatabaseSync, SQLInputValue } from "../store/database.ts";
import { IssueService } from "./issue-service.ts";
import { JournalService } from "./journal-service.ts";
import { clipWithMarker, JOURNAL_SUMMARY_MAX, type JournalEntry } from "../domain/journal.ts";
import { formatHumanRef } from "../domain/issue.ts";
import { mutateOnce, withTransaction } from "../store/transactions.ts";
import { hashMappedContent } from "../projections/types.ts";
import {
  isProjectableEventType,
  isUntrustedRef,
  shouldProjectClosure,
  shouldProjectJournalEntry,
} from "../projections/policy.ts";
import {
  BINDING_MODES,
  PROVIDERS,
  backoffMs,
  type BindingMode,
  type ExternalBinding,
  type InboxEntry,
  type OutboxEntry,
  type Provider,
  type SyncState,
} from "../projections/types.ts";

// External sync engine (PRD §§31-34). Local authority first: GitHub/Jira are
// intake/projection surfaces. Every inbox event is idempotent; protected
// remote edits become drift proposals, never silent overwrites; uncertain
// external effects are recorded, never guessed (PRD §47).

export interface BindExternalInput {
  provider: Provider;
  remoteScope: string;
  remoteId: string;
  remoteKey?: string;
  url?: string;
  mode: BindingMode;
}

/** Sync states a Jira bind may record. Bind states intent; `drift` and `uncertain` come only from reads and sends. */
export const JIRA_BIND_SYNC_STATES = ["pending", "in_sync"] as const;

export const PROJECT_BINDINGS_DEFAULT_LIMIT = 100;
export const PROJECT_BINDINGS_MAX_LIMIT = 500;

export interface BindExternalKeyInput {
  provider: "jira";
  /** `<site>:<projectKey>`, e.g. `mercury.atlassian.net:MMD`. */
  remoteScope: string;
  /** Numeric Jira issue id. */
  remoteId: string;
  /** Jira key, `KEY-123`; its project key must equal the scope's. */
  remoteKey: string;
  /** Browse URL, ending `/browse/<key>`. */
  url: string;
  /** Defaults to `pending` for a new row and to the row's current state on a re-bind. */
  syncState?: (typeof JIRA_BIND_SYNC_STATES)[number];
  actor?: string;
}

export interface BindExternalKeyResult {
  status: "created" | "noop" | "updated";
  binding: ExternalBinding;
  issueRef: string;
}

export interface ListProjectBindingsInput {
  projectId: string;
  provider?: Provider;
  remoteScope?: string;
  limit?: number;
}

export interface ProjectBinding extends ExternalBinding {
  /** Durable human reference of the owning Issue, e.g. `XTRM-814`. */
  issueRef: string;
}

export interface ProjectBindingPage {
  bindings: ProjectBinding[];
  limit: number;
  /** True when more rows matched than `limit` returned. */
  truncated: boolean;
}

/** A Jira identity that another Issue already owns, or that this Issue records differently. */
export class ExternalBindingConflictError extends Error {
  readonly ownerRef: string;
  readonly ownerIssueId: string;

  constructor(message: string, ownerRef: string, ownerIssueId: string) {
    super(message);
    this.name = "ExternalBindingConflictError";
    this.ownerRef = ownerRef;
    this.ownerIssueId = ownerIssueId;
  }
}

const JIRA_SCOPE = /^(\S+):([A-Z][A-Z0-9_]*)$/;
const JIRA_KEY = /^([A-Z][A-Z0-9_]*)-[1-9][0-9]*$/;
const JIRA_ID = /^[1-9][0-9]*$/;

function validateJiraIdentity(input: BindExternalKeyInput): { remoteScope: string; remoteId: string; remoteKey: string; url: string } {
  if (input.provider !== "jira") throw new Error(`bindExternalKey binds jira only (got ${String(input.provider)})`);
  const remoteScope = input.remoteScope.trim();
  const remoteId = input.remoteId.trim();
  const remoteKey = input.remoteKey.trim();
  const url = input.url.trim();
  const scope = JIRA_SCOPE.exec(remoteScope);
  if (!scope) throw new Error(`remoteScope must be <site>:<projectKey> (got ${JSON.stringify(remoteScope)})`);
  if (!JIRA_ID.test(remoteId)) throw new Error(`remoteId must be the numeric Jira issue id (got ${JSON.stringify(remoteId)})`);
  const key = JIRA_KEY.exec(remoteKey);
  if (!key) throw new Error(`remoteKey must look like KEY-123 (got ${JSON.stringify(remoteKey)})`);
  if (key[1] !== scope[2]) throw new Error(`remoteKey ${remoteKey} is not in project ${scope[2]} of scope ${remoteScope}`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`url must be the Jira browse URL (got ${JSON.stringify(url)})`);
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.pathname.endsWith(`/browse/${remoteKey}`)) {
    throw new Error(`url must be an http(s) browse URL ending /browse/${remoteKey} (got ${JSON.stringify(url)})`);
  }
  return { remoteScope, remoteId, remoteKey, url };
}

export interface EnqueueInput {
  provider: Provider;
  remoteScope: string;
  operation: string;
  payload: unknown;
  contentHash: string;
}

export interface OutboxSendOp {
  outboxId: number;
  provider: Provider;
  remoteScope: string;
  operation: string;
  payload: unknown;
}

export type SendResult =
  | { ok: true }
  | { ok: false; retryable: boolean; error: string }
  | { ok: "uncertain"; error: string };

export interface ProjectionSender {
  send(op: OutboxSendOp): Promise<SendResult>;
}

export type InboundEventKind = "issue-intake" | "remote-edit";

interface Row {
  [key: string]: unknown;
}

function row<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function rows<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function reqString(r: Record<string, unknown>, field: string): string {
  const v = r[field];
  if (typeof v !== "string" || v.trim() === "") throw new Error(`invalid provider payload: ${field} must be a non-empty string`);
  return v;
}

function optString(r: Record<string, unknown>, field: string): string | undefined {
  const v = r[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`invalid provider payload: ${field} must be a string`);
  return v;
}

// PRD-46: every inbound adapter payload is validated before any mutation.
export interface GitHubIntake {
  remoteId: string;
  title: string;
  body: string;
  url: string | undefined;
}

export function validateGitHubIntake(payload: unknown): GitHubIntake {
  if (!isRecord(payload) || !isRecord(payload["issue"])) throw new Error("invalid provider payload: missing issue object");
  const issue = payload["issue"];
  const id = issue["id"];
  if (typeof id !== "string" && typeof id !== "number") throw new Error("invalid provider payload: issue.id must be a string or number");
  return { remoteId: String(id), title: reqString(issue, "title"), body: optString(issue, "body") ?? "", url: optString(issue, "html_url") };
}

export interface JiraIntake {
  remoteId: string;
  remoteKey: string;
  summary: string;
  description: string;
}

export function validateJiraIntake(payload: unknown): JiraIntake {
  if (!isRecord(payload) || !isRecord(payload["issue"])) throw new Error("invalid provider payload: missing issue object");
  const issue = payload["issue"];
  if (!isRecord(issue["fields"])) throw new Error("invalid provider payload: missing issue.fields object");
  return {
    remoteId: reqString(issue, "id"),
    remoteKey: reqString(issue, "key"),
    summary: reqString(issue["fields"], "summary"),
    description: optString(issue["fields"], "description") ?? "",
  };
}

export interface RemoteEdit {
  remoteScope: string;
  remoteId: string;
  remoteVersion: string;
  mapped: { title?: string; body?: string };
}

// Inbound external comment (ADR §61, P1 stretch): untrusted coordination
// input from a provider surface (GitHub/Jira comment). Every field is
// required so the trust boundary is explicit at the ingestion edge.
export interface ExternalComment {
  remoteScope: string;
  remoteId: string;
  remoteAuthor: string;
  remoteTimestamp: number;
  body: string;
}

export function validateExternalComment(payload: unknown): ExternalComment {
  if (!isRecord(payload)) throw new Error("invalid external comment: must be an object");
  const remoteTimestamp = payload["remoteTimestamp"];
  if (typeof remoteTimestamp !== "number" || !Number.isFinite(remoteTimestamp) || remoteTimestamp <= 0) {
    throw new Error("invalid external comment: remoteTimestamp must be a positive epoch ms number");
  }
  const body = payload["body"];
  if (typeof body !== "string" || body.trim() === "") throw new Error("invalid external comment: body must be a non-empty string");
  return {
    remoteScope: reqString(payload, "remoteScope"),
    remoteId: reqString(payload, "remoteId"),
    remoteAuthor: reqString(payload, "remoteAuthor"),
    remoteTimestamp,
    body,
  };
}

export function validateRemoteEdit(payload: unknown): RemoteEdit {
  if (!isRecord(payload)) throw new Error("invalid provider payload: must be an object");
  const mapped = payload["mapped"];
  if (!isRecord(mapped)) throw new Error("invalid provider payload: missing mapped object");
  const out: RemoteEdit = { remoteScope: reqString(payload, "remoteScope"), remoteId: reqString(payload, "remoteId"), remoteVersion: reqString(payload, "remoteVersion"), mapped: {} };
  const title = optString(mapped, "title");
  const body = optString(mapped, "body");
  if (title !== undefined) out.mapped.title = title;
  if (body !== undefined) out.mapped.body = body;
  return out;
}

const DRAFT_MARKER = "TBD — pending XTRM planning";

export class IntegrationService {
  private readonly db: DatabaseSync;
  private readonly issues: IssueService;

  constructor(db: DatabaseSync, issues: IssueService) {
    this.db = db;
    this.issues = issues;
  }

  // -- external bindings (PRD §31) ------------------------------------------

  bindExternal(issueId: string, input: BindExternalInput, opts?: { idempotencyKey?: string }): ExternalBinding {
    if (!(PROVIDERS as readonly string[]).includes(input.provider)) throw new Error(`unknown provider: ${input.provider}`);
    if (!(BINDING_MODES as readonly string[]).includes(input.mode)) throw new Error(`unknown binding mode: ${input.mode}`);
    if (!input.remoteScope.trim() || !input.remoteId.trim()) throw new Error("remoteScope and remoteId must be non-empty");
    const key = opts?.idempotencyKey ?? `bind:${input.provider}:${input.remoteScope}:${input.remoteId}`;
    return withTransaction(this.db, () => mutateOnce(this.db, "command", key, () => this.insertBinding(issueId, input)));
  }

  private insertBinding(issueId: string, input: BindExternalInput): ExternalBinding {
    this.issues.getIssue(issueId);
    const now = Date.now();
    const existing = row<Row>(
      this.db,
      "SELECT * FROM external_bindings WHERE issue_id = ? AND provider = ? AND remote_scope = ? AND remote_id = ?",
      issueId, input.provider, input.remoteScope, input.remoteId,
    );
    if (existing) return this.toBinding(existing);
    this.db
      .prepare(
        `INSERT INTO external_bindings (issue_id, provider, remote_scope, remote_id, remote_key, url, mode,
          last_pushed_revision, last_seen_remote_version, mapped_content_hash, sync_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'in_sync', ?, ?)`,
      )
      .run(issueId, input.provider, input.remoteScope, input.remoteId, input.remoteKey ?? null, input.url ?? null, input.mode, now, now);
    this.issues.appendEvent(issueId, "external_binding.created", { provider: input.provider, scope: input.remoteScope, remote: input.remoteId, mode: input.mode });
    return this.requireBinding(issueId, input.provider, input.remoteScope, input.remoteId);
  }

  getBinding(issueId: string, provider: Provider, remoteScope: string, remoteId: string): ExternalBinding | null {
    const r = row<Row>(
      this.db, "SELECT * FROM external_bindings WHERE issue_id = ? AND provider = ? AND remote_scope = ? AND remote_id = ?",
      issueId, provider, remoteScope, remoteId,
    );
    return r ? this.toBinding(r) : null;
  }

  listBindings(issueId: string): ExternalBinding[] {
    return rows<Row>(this.db, "SELECT * FROM external_bindings WHERE issue_id = ? ORDER BY provider, remote_scope, remote_id", issueId).map((r) =>
      this.toBinding(r),
    );
  }

  findBindingByRemote(provider: Provider, remoteScope: string, remoteId: string): ExternalBinding | null {
    const r = row<Row>(
      this.db, "SELECT * FROM external_bindings WHERE provider = ? AND remote_scope = ? AND remote_id = ? LIMIT 1",
      provider, remoteScope, remoteId,
    );
    return r ? this.toBinding(r) : null;
  }

  // -- Jira identity: bounded read and key bind (XTRM-814) ---------------------
  //
  // Both operations touch `external_bindings` only. They make no network call,
  // enqueue nothing and read no inbox: the bind records which remote key an
  // Issue is known by, and never that a remote read succeeded.

  /**
   * Bounded read of the bindings of one Project, optionally narrowed by provider
   * and remote scope. The scope of a binding is its Issue's Project: a binding of
   * another Project never appears here, whatever its provider or scope.
   */
  listProjectBindings(input: ListProjectBindingsInput): ProjectBindingPage {
    const limit = input.limit ?? PROJECT_BINDINGS_DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > PROJECT_BINDINGS_MAX_LIMIT) {
      throw new Error(`limit must be an integer from 1 to ${PROJECT_BINDINGS_MAX_LIMIT}`);
    }
    if (input.provider !== undefined && !(PROVIDERS as readonly string[]).includes(input.provider)) {
      throw new Error(`unknown provider: ${input.provider}`);
    }
    if (input.remoteScope !== undefined && !input.remoteScope.trim()) throw new Error("remoteScope must be non-empty when given");
    const where = ["i.project_id = ?"];
    const params: SQLInputValue[] = [input.projectId];
    if (input.provider !== undefined) {
      where.push("b.provider = ?");
      params.push(input.provider);
    }
    if (input.remoteScope !== undefined) {
      where.push("b.remote_scope = ?");
      params.push(input.remoteScope);
    }
    // One extra row tells the caller the page was cut without a second count query.
    const found = rows<Row>(
      this.db,
      `SELECT b.*, i.human_number AS human_number, p.prefix AS prefix
         FROM external_bindings b
         JOIN issues i ON i.id = b.issue_id
         JOIN projects p ON p.id = i.project_id
        WHERE ${where.join(" AND ")}
        ORDER BY b.provider, b.remote_scope, b.remote_id, b.issue_id
        LIMIT ?`,
      ...params,
      limit + 1,
    );
    const page = found.slice(0, limit).map((r) => ({
      ...this.toBinding(r),
      issueRef: formatHumanRef(r["prefix"] as string, r["human_number"] as number),
    }));
    return { bindings: page, limit, truncated: found.length > limit };
  }

  /**
   * Record that an existing Issue is known in Jira by a remote key. Mode is always
   * `mirror_read`. The same identity bound again to the same Issue changes nothing
   * (`noop`); a different URL or sync state on that identity updates the row
   * (`updated`); an identity bound to another Issue is refused naming that Issue.
   */
  bindExternalKey(issueId: string, input: BindExternalKeyInput): BindExternalKeyResult {
    const fields = validateJiraIdentity(input);
    const syncState: SyncState = input.syncState ?? "pending";
    if (!(JIRA_BIND_SYNC_STATES as readonly string[]).includes(syncState)) {
      throw new Error(`syncState must be one of ${JIRA_BIND_SYNC_STATES.join("|")} (got ${syncState})`);
    }
    return withTransaction(this.db, () => {
      const issue = this.issues.getIssue(issueId);
      // The same remote issue is identified by its numeric id and by its key. Either
      // match on another Issue is a conflict; a match on this Issue must agree on both.
      const clashes = rows<Row>(
        this.db,
        `SELECT b.*, i.human_number AS human_number, p.prefix AS prefix
           FROM external_bindings b
           JOIN issues i ON i.id = b.issue_id
           JOIN projects p ON p.id = i.project_id
          WHERE b.provider = 'jira' AND b.remote_scope = ? AND (b.remote_id = ? OR b.remote_key = ?)
          ORDER BY b.issue_id`,
        fields.remoteScope, fields.remoteId, fields.remoteKey,
      );
      const foreign = clashes.find((r) => (r["issue_id"] as string) !== issue.id);
      if (foreign) {
        const ownerRef = formatHumanRef(foreign["prefix"] as string, foreign["human_number"] as number);
        throw new ExternalBindingConflictError(
          `Jira ${fields.remoteKey} (${fields.remoteScope}, id ${fields.remoteId}) is already bound to ${ownerRef}; ${issue.humanRef} was not bound and nothing was written`,
          ownerRef,
          foreign["issue_id"] as string,
        );
      }
      const own = clashes.find((r) => (r["remote_id"] as string) === fields.remoteId && (r["remote_key"] as string | null) === fields.remoteKey);
      const mismatch = clashes.find((r) => r !== own);
      if (mismatch) {
        throw new ExternalBindingConflictError(
          `${issue.humanRef} already records Jira id ${mismatch["remote_id"] as string} as ${(mismatch["remote_key"] as string | null) ?? "(no key)"} in ${fields.remoteScope}; it is not ${fields.remoteKey} (id ${fields.remoteId})`,
          issue.humanRef,
          issue.id,
        );
      }
      const now = Date.now();
      if (!own) {
        this.db
          .prepare(
            `INSERT INTO external_bindings (issue_id, provider, remote_scope, remote_id, remote_key, url, mode,
              last_pushed_revision, last_seen_remote_version, mapped_content_hash, sync_state, created_at, updated_at)
             VALUES (?, 'jira', ?, ?, ?, ?, 'mirror_read', NULL, NULL, NULL, ?, ?, ?)`,
          )
          .run(issue.id, fields.remoteScope, fields.remoteId, fields.remoteKey, fields.url, syncState, now, now);
        this.issues.appendEvent(issue.id, "external_binding.created", {
          provider: "jira", scope: fields.remoteScope, remote: fields.remoteId, key: fields.remoteKey, mode: "mirror_read", syncState, actor: input.actor ?? null,
        });
        return { status: "created", binding: this.requireBinding(issue.id, "jira", fields.remoteScope, fields.remoteId), issueRef: issue.humanRef };
      }
      // A re-bind that names no state keeps the row's: it must not reset `drift` to `pending`.
      const nextState = input.syncState ?? (own["sync_state"] as SyncState);
      if ((own["url"] as string | null) === fields.url && (own["sync_state"] as string) === nextState) {
        return { status: "noop", binding: this.toBinding(own), issueRef: issue.humanRef };
      }
      this.db
        .prepare("UPDATE external_bindings SET url = ?, sync_state = ?, updated_at = ? WHERE issue_id = ? AND provider = 'jira' AND remote_scope = ? AND remote_id = ?")
        .run(fields.url, nextState, now, issue.id, fields.remoteScope, fields.remoteId);
      this.issues.appendEvent(issue.id, "external_binding.updated", {
        provider: "jira", scope: fields.remoteScope, remote: fields.remoteId, key: fields.remoteKey, syncState: nextState, actor: input.actor ?? null,
      });
      return { status: "updated", binding: this.requireBinding(issue.id, "jira", fields.remoteScope, fields.remoteId), issueRef: issue.humanRef };
    });
  }

  // -- projection outbox (PRD §§32-34) ----------------------------------------

  enqueueProjection(issueId: string, input: EnqueueInput, opts?: { now?: number }): { entry: OutboxEntry | null; enqueued: boolean; reason: string } {
    if (!(PROVIDERS as readonly string[]).includes(input.provider)) throw new Error(`unknown provider: ${input.provider}`);
    const now = opts?.now ?? Date.now();
    return withTransaction(this.db, () => {
      this.issues.getIssue(issueId);
      const binding = rows<Row>(this.db, "SELECT * FROM external_bindings WHERE issue_id = ? AND provider = ? AND remote_scope = ?", issueId, input.provider, input.remoteScope)[0];
      if (binding && (binding["mapped_content_hash"] as string | null) === input.contentHash) {
        return { entry: null, enqueued: false, reason: "unchanged" };
      }
      const key = `${input.provider}:${input.remoteScope}:${input.operation}:${input.contentHash}`;
      const dup = row<Row>(this.db, "SELECT * FROM projection_outbox WHERE idempotency_key = ?", key);
      if (dup) return { entry: this.toOutbox(dup), enqueued: false, reason: "duplicate" };
      const id = Number(
        (
          this.db
            .prepare(
              `INSERT INTO projection_outbox (issue_id, provider, remote_scope, operation, payload_json,
                mapped_content_hash, idempotency_key, status, attempts, next_retry_at, last_error, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, ?) RETURNING id`,
            )
            .get(issueId, input.provider, input.remoteScope, input.operation, JSON.stringify(input.payload), input.contentHash, key, now, now) as { id: number }
        ).id,
      );
      if (binding) {
        this.db.prepare("UPDATE external_bindings SET sync_state = 'pending', updated_at = ? WHERE issue_id = ? AND provider = ? AND remote_scope = ? AND remote_id = ?")
          .run(now, issueId, input.provider, input.remoteScope, binding["remote_id"] as string);
      }
      this.issues.appendEvent(issueId, "projection.enqueued", { provider: input.provider, operation: input.operation, outbox: id });
      const entry = this.toOutbox(row<Row>(this.db, "SELECT * FROM projection_outbox WHERE id = ?", id) as Row);
      return { entry, enqueued: true, reason: "enqueued" };
    });
  }

  listOutbox(status?: string): OutboxEntry[] {
    const rs = status
      ? rows<Row>(this.db, "SELECT * FROM projection_outbox WHERE status = ? ORDER BY id", status)
      : rows<Row>(this.db, "SELECT * FROM projection_outbox ORDER BY id");
    return rs.map((r) => this.toOutbox(r));
  }

  // Safe retry: sends happen outside transactions; every outcome updates state.
  // Uncertain effects are recorded, never replayed blindly (PRD §47).
  async drainOutbox(sender: ProjectionSender, opts?: { now?: number; maxAttempts?: number; limit?: number }): Promise<{ sent: number; failed: number; uncertain: number }> {
    const now = opts?.now ?? Date.now();
    const maxAttempts = opts?.maxAttempts ?? 5;
    const limit = opts?.limit ?? 100;
    const due = rows<Row>(
      this.db, "SELECT * FROM projection_outbox WHERE status = 'pending' AND next_retry_at <= ? ORDER BY id LIMIT ?", now, limit,
    );
    let sent = 0;
    let failed = 0;
    let uncertain = 0;
    for (const r of due) {
      const entry = this.toOutbox(r);
      let result: SendResult;
      try {
        result = await sender.send({ outboxId: entry.id, provider: entry.provider, remoteScope: entry.remoteScope, operation: entry.operation, payload: entry.payload });
      } catch (err) {
        result = { ok: false, retryable: true, error: err instanceof Error ? err.message : String(err) };
      }
      withTransaction(this.db, () => {
        if (result.ok === true) {
          const stamp = Date.now();
          this.db.prepare("UPDATE projection_outbox SET status = 'sent', attempts = ?, last_error = NULL WHERE id = ?").run(entry.attempts + 1, entry.id);
          const issue = this.issues.getIssue(entry.issueId);
          this.db.prepare(
            `UPDATE external_bindings SET mapped_content_hash = ?, last_pushed_revision = ?, sync_state = 'in_sync', updated_at = ?
             WHERE issue_id = ? AND provider = ? AND remote_scope = ?`,
          ).run(entry.mappedContentHash, issue.currentRevision, stamp, entry.issueId, entry.provider, entry.remoteScope);
          this.issues.appendEvent(entry.issueId, "projection.pushed", { provider: entry.provider, operation: entry.operation, outbox: entry.id });
          sent += 1;
        } else if (result.ok === "uncertain") {
          this.db.prepare("UPDATE projection_outbox SET status = 'uncertain', attempts = ?, last_error = ? WHERE id = ?").run(entry.attempts + 1, result.error, entry.id);
          this.db.prepare("UPDATE external_bindings SET sync_state = 'uncertain', updated_at = ? WHERE issue_id = ? AND provider = ? AND remote_scope = ?")
            .run(Date.now(), entry.issueId, entry.provider, entry.remoteScope);
          this.issues.appendEvent(entry.issueId, "external.uncertain", { provider: entry.provider, operation: entry.operation, outbox: entry.id, error: result.error });
          uncertain += 1;
        } else {
          const attempts = entry.attempts + 1;
          if (result.retryable && attempts < maxAttempts) {
            this.db.prepare("UPDATE projection_outbox SET attempts = ?, next_retry_at = ?, last_error = ? WHERE id = ?")
              .run(attempts, now + backoffMs(attempts), result.error, entry.id);
          } else {
            this.db.prepare("UPDATE projection_outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?").run(attempts, result.error, entry.id);
            failed += 1;
          }
        }
      });
    }
    return { sent, failed, uncertain };
  }

  // -- integration inbox (PRD §34) --------------------------------------------

  // Every inbox event is idempotent on (provider, idempotencyKey): retries
  // bump seen_count and replay the recorded outcome without re-mutating.
  receiveInbound(
    provider: Provider,
    eventKind: InboundEventKind,
    idempotencyKey: string,
    payload: unknown,
    opts?: { projectId?: string; now?: number },
  ): { duplicate: boolean; status: string; issueId: string | null } {
    if (!(PROVIDERS as readonly string[]).includes(provider)) throw new Error(`unknown provider: ${provider}`);
    if (!idempotencyKey.trim()) throw new Error("idempotencyKey must be non-empty");
    if (eventKind !== "issue-intake" && eventKind !== "remote-edit") throw new Error(`unknown inbound event kind: ${eventKind}`);
    // Validate before any mutation (PRD-46).
    if (eventKind === "issue-intake") {
      if (provider === "github") validateGitHubIntake(payload);
      else validateJiraIntake(payload);
    } else {
      validateRemoteEdit(payload);
    }
    const now = opts?.now ?? Date.now();
    // No outer transaction: processing calls IssueService methods that own
    // their transactions (SQLite has no nesting). Reserve first, process,
    // then finalize; a crash between reserve and finalize leaves 'received',
    // which a retry re-processes idempotently.
    const reserved = withTransaction(this.db, () => {
      const existing = row<Row>(this.db, "SELECT * FROM integration_inbox WHERE provider = ? AND idempotency_key = ?", provider, idempotencyKey);
      if (existing) {
        this.db.prepare("UPDATE integration_inbox SET seen_count = seen_count + 1 WHERE provider = ? AND idempotency_key = ?").run(provider, idempotencyKey);
        const done = row<Row>(this.db, "SELECT * FROM integration_inbox WHERE provider = ? AND idempotency_key = ?", provider, idempotencyKey) as Row;
        return { duplicate: true as const, status: done["status"] as string, row: done };
      }
      this.db
        .prepare(
          `INSERT INTO integration_inbox (provider, event_kind, idempotency_key, payload_json, status, seen_count, created_at, processed_at)
           VALUES (?, ?, ?, ?, 'received', 1, ?, NULL)`,
        )
        .run(provider, eventKind, idempotencyKey, JSON.stringify(payload), now);
      return { duplicate: false as const, status: "received", row: null };
    });
    if (reserved.duplicate && reserved.status !== "received") {
      return { duplicate: true, status: reserved.status, issueId: this.inboxIssue(reserved.row as Row) };
    }
    const wasDuplicate = reserved.duplicate;
    const outcome =
      eventKind === "issue-intake"
        ? this.processIntake(provider, payload, opts?.projectId ?? "prj_xtrm", now)
        : this.processRemoteEdit(provider, payload, now);
    withTransaction(this.db, () => {
      this.db.prepare("UPDATE integration_inbox SET status = ?, processed_at = ? WHERE provider = ? AND idempotency_key = ?")
        .run(outcome.status, now, provider, idempotencyKey);
    });
    return { duplicate: wasDuplicate, ...outcome };
  }

  listInbox(provider?: Provider): InboxEntry[] {
    const rs = provider
      ? rows<Row>(this.db, "SELECT * FROM integration_inbox WHERE provider = ? ORDER BY id", provider)
      : rows<Row>(this.db, "SELECT * FROM integration_inbox ORDER BY id");
    return rs.map((r) => this.toInbox(r));
  }

  // Remote intake becomes an unready draft: shape-valid so the transaction
  // rule holds, TBD-marked so planning/readiness cannot mistake it for ready
  // work (F41). It becomes dispatchable only after XTRM planning grounds it.
  private processIntake(provider: Provider, payload: unknown, projectId: string, now: number): { status: string; issueId: string | null } {
    const meta =
      provider === "github"
        ? (() => { const v = validateGitHubIntake(payload); return { remoteId: v.remoteId, remoteKey: undefined as string | undefined, title: v.title, body: v.body, url: v.url }; })()
        : (() => { const v = validateJiraIntake(payload); return { remoteId: v.remoteId, remoteKey: v.remoteKey, title: v.summary, body: v.description, url: undefined as string | undefined }; })();
    const scope = provider === "github" ? "intake" : "intake";
    if (this.findBindingByRemote(provider, scope, meta.remoteId)) {
      return { status: "bound", issueId: this.findBindingByRemote(provider, scope, meta.remoteId)?.issueId ?? null };
    }
    const issue = this.issues.createIssue(
      {
        projectId,
        title: meta.title,
        kind: "task",
        contract: {
          problem: meta.body ? `${meta.title}\n\nRemote body:\n${meta.body}` : meta.title,
          success: DRAFT_MARKER,
          scope: [],
          nonGoals: [],
          constraints: [],
          validation: [{ check: DRAFT_MARKER }],
          output: [{ artifact: DRAFT_MARKER }],
        },
        authoredBy: `intake:${provider}`,
        aliases: [{ alias: `${provider}:${scope}#${meta.remoteId}`, kind: "external" }],
      },
      { idempotencyKey: `intake:${provider}:${meta.remoteId}` },
    );
    this.insertBinding(issue.id, { provider, remoteScope: scope, remoteId: meta.remoteId, remoteKey: meta.remoteKey, url: meta.url, mode: "intake" });
    void now;
    return { status: "intake-draft", issueId: issue.id };
  }

  // Protected remote edits never silently overwrite local authority (F43, §34):
  // divergence records explicit drift; v0 performs no local mutation from
  // remote content (mutation arrives via planning as a new revision).
  private processRemoteEdit(provider: Provider, payload: unknown, now: number): { status: string; issueId: string | null } {
    const edit = validateRemoteEdit(payload);
    const binding = this.findBindingByRemote(provider, edit.remoteScope, edit.remoteId);
    if (!binding) return { status: "unbound", issueId: null };
    if (binding.lastSeenRemoteVersion === edit.remoteVersion) return { status: "noop", issueId: binding.issueId };
    void now;
    return this.recordRemoteEdit(provider, binding, edit);
  }

  private recordRemoteEdit(provider: Provider, binding: ExternalBinding, edit: RemoteEdit): { status: string; issueId: string | null } {
    // Binding update + drift event commit atomically (single-level: the
    // caller holds no transaction, so this nesting is safe).
    return withTransaction(this.db, () => {
      // One shared definition of "same mapped content" (see hashMappedContent).
      if (binding.mappedContentHash !== null && binding.mappedContentHash === hashMappedContent(edit.mapped)) {
        this.db.prepare("UPDATE external_bindings SET last_seen_remote_version = ?, updated_at = ? WHERE issue_id = ? AND provider = ? AND remote_scope = ? AND remote_id = ?")
          .run(edit.remoteVersion, Date.now(), binding.issueId, provider, edit.remoteScope, edit.remoteId);
        return { status: "noop", issueId: binding.issueId };
      }
      this.db.prepare("UPDATE external_bindings SET last_seen_remote_version = ?, sync_state = 'drift', updated_at = ? WHERE issue_id = ? AND provider = ? AND remote_scope = ? AND remote_id = ?")
        .run(edit.remoteVersion, Date.now(), binding.issueId, provider, edit.remoteScope, edit.remoteId);
      this.issues.appendEvent(binding.issueId, "projection.drift", {
        provider, scope: edit.remoteScope, remote: edit.remoteId, remoteVersion: edit.remoteVersion, fields: Object.keys(edit.mapped),
      });
      return { status: "drift", issueId: binding.issueId };
    });
  }

  // -- selective outbound projection (ADR §60, P1) ----------------------------
  // Allowlist enforcement in front of the outbox: important findings,
  // decisions, results, closures and high-value notes project; mechanical
  // checkpoints, compaction checkpoints and low-level runtime events do
  // not. Returns projected:false with a reason instead of enqueuing.

  classifyForProjection(entry: JournalEntry): { project: boolean; reason: string } {
    // Untrusted refs are counted here so the policy can refuse them before any
    // allowlist widening admits inbound external content (ADR §61).
    const untrustedRefCount = entry.refs.filter((ref) => isUntrustedRef(ref as { value?: unknown })).length;
    return shouldProjectJournalEntry({ kind: entry.kind, refCount: entry.refs.length, untrustedRefCount });
  }

  enqueueJournalProjection(
    issueId: string,
    entryId: string,
    input: { provider: Provider; remoteScope: string; operation: string },
    opts?: { now?: number },
  ): { entry: OutboxEntry | null; enqueued: boolean; reason: string } {
    const journal = new JournalService(this.db, this.issues);
    const entry = journal.getEntry(entryId);
    if (entry.issueId !== issueId) throw new Error(`journal entry ${entryId} does not belong to ${issueId}`);
    const verdict = this.classifyForProjection(entry);
    if (!verdict.project) return { entry: null, enqueued: false, reason: verdict.reason };
    const payload = {
      kind: entry.kind,
      entryId: entry.id,
      sequence: entry.sequence,
      issueRevision: entry.issueRevision,
      summary: entry.semantic?.summary ?? entry.result?.summary ?? null,
      outcome: entry.result?.outcome ?? null,
      refs: entry.refs,
    };
    return this.enqueueProjection(issueId, {
      provider: input.provider,
      remoteScope: input.remoteScope,
      operation: input.operation,
      payload,
      contentHash: hashMappedContent(payload),
    }, opts);
  }

  /** Closure projection verdict: closures always project (ADR §60). */
  classifyClosureForProjection(): { project: boolean; reason: string } {
    return shouldProjectClosure();
  }

  /** Runtime/transport event gate: low-level events never project (ADR §60). */
  isProjectableEvent(type: string): boolean {
    return isProjectableEventType(type);
  }

  // -- inbound external comments (ADR §61, P1 stretch) ------------------------
  // An external comment enters as an Issue-local journal note carrying the
  // provider, remote id, remote author and remote timestamp as evidence
  // refs, plus an `external.comment_received` event marked untrusted. The
  // Issue contract is never touched: no new revision, no readiness change,
  // no executable authority. Callers must route follow-ups through XTRM
  // planning, never by promoting the comment text.

  receiveComment(
    issueId: string,
    provider: Provider,
    payload: unknown,
    opts?: { now?: number },
  ): { entry: JournalEntry; revision: number } {
    if (!(PROVIDERS as readonly string[]).includes(provider)) throw new Error(`unknown provider: ${provider}`);
    const comment = validateExternalComment(payload);
    const journal = new JournalService(this.db, this.issues);
    return withTransaction(this.db, () => {
      const before = this.issues.getIssue(issueId);
      const entry = journal.appendEntry(issueId, {
        kind: "note",
        semantic: { summary: clipWithMarker(comment.body, JOURNAL_SUMMARY_MAX, "comment") },
        refs: [{
          kind: "external-comment",
          key: `${provider}:${comment.remoteScope}#${comment.remoteId}`,
          value: {
            provider,
            remoteScope: comment.remoteScope,
            remoteId: comment.remoteId,
            remoteAuthor: comment.remoteAuthor,
            remoteTimestamp: comment.remoteTimestamp,
            untrusted: true,
          },
        }],
      });
      this.issues.appendEvent(issueId, "external.comment_received", {
        provider,
        remoteScope: comment.remoteScope,
        remoteId: comment.remoteId,
        remoteAuthor: comment.remoteAuthor,
        remoteTimestamp: comment.remoteTimestamp,
        entry: entry.id,
        untrusted: true,
        note: "coordination data only; never executable authority (ADR §61)",
      });
      const after = this.issues.getIssue(issueId);
      if (after.currentRevision !== before.currentRevision) {
        throw new Error("fail-closed: inbound comment changed the Issue revision");
      }
      return { entry, revision: after.currentRevision };
    });
  }

  // -- row mapping ---------------------------------------------------------------

  private requireBinding(issueId: string, provider: Provider, remoteScope: string, remoteId: string): ExternalBinding {
    const b = this.getBinding(issueId, provider, remoteScope, remoteId);
    if (!b) throw new Error(`unknown external binding: ${provider}/${remoteScope}/${remoteId}`);
    return b;
  }

  private toBinding(r: Row): ExternalBinding {
    return {
      issueId: r["issue_id"] as string,
      provider: r["provider"] as Provider,
      remoteScope: r["remote_scope"] as string,
      remoteId: r["remote_id"] as string,
      remoteKey: (r["remote_key"] as string | null) ?? null,
      url: (r["url"] as string | null) ?? null,
      mode: r["mode"] as BindingMode,
      lastPushedRevision: (r["last_pushed_revision"] as number | null) ?? null,
      lastSeenRemoteVersion: (r["last_seen_remote_version"] as string | null) ?? null,
      mappedContentHash: (r["mapped_content_hash"] as string | null) ?? null,
      syncState: r["sync_state"] as SyncState,
      createdAt: r["created_at"] as number,
      updatedAt: r["updated_at"] as number,
    };
  }

  private toOutbox(r: Row): OutboxEntry {
    return {
      id: r["id"] as number,
      issueId: r["issue_id"] as string,
      provider: r["provider"] as Provider,
      remoteScope: r["remote_scope"] as string,
      operation: r["operation"] as string,
      payload: JSON.parse(r["payload_json"] as string),
      mappedContentHash: r["mapped_content_hash"] as string,
      idempotencyKey: r["idempotency_key"] as string,
      status: r["status"] as OutboxEntry["status"],
      attempts: r["attempts"] as number,
      nextRetryAt: r["next_retry_at"] as number,
      lastError: (r["last_error"] as string | null) ?? null,
      createdAt: r["created_at"] as number,
    };
  }

  private toInbox(r: Row): InboxEntry {
    return {
      id: r["id"] as number,
      provider: r["provider"] as Provider,
      eventKind: r["event_kind"] as string,
      idempotencyKey: r["idempotency_key"] as string,
      payload: JSON.parse(r["payload_json"] as string),
      status: r["status"] as string,
      seenCount: r["seen_count"] as number,
      createdAt: r["created_at"] as number,
      processedAt: (r["processed_at"] as number | null) ?? null,
    };
  }

  private inboxIssue(r: Row): string | null {
    const payload = JSON.parse(r["payload_json"] as string) as unknown;
    if (!isRecord(payload)) return null;
    if (r["event_kind"] === "remote-edit" && isRecord(payload)) {
      const scope = typeof payload["remoteScope"] === "string" ? payload["remoteScope"] : "";
      const remote = typeof payload["remoteId"] === "string" ? payload["remoteId"] : "";
      return this.findBindingByRemote(r["provider"] as Provider, scope, remote)?.issueId ?? null;
    }
    return null;
  }
}
