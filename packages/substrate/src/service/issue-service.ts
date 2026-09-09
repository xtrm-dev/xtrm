import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  ISSUE_KINDS,
  LIFECYCLE_STATES,
  formatHumanRef,
  newIssueId,
  parseHumanRef,
  type Issue,
  type IssueEvent,
  type IssueKind,
  type IssueRevision,
  type LifecycleState,
  type Project,
  type ResolvedIssue,
} from "../domain/issue.ts";
import {
  assertContractShape,
  hashContract,
  isValidScrutiny,
  validateContextRefs,
  validateOwnership,
  type WorkContract,
} from "../domain/contract.ts";
import {
  deriveReadiness,
  isBlockerSatisfied,
  resolveInheritedContext,
  scopeCovers,
  type ContextRef,
  type ReadinessAttestation,
  type ReadinessReport,
  type ResolvedContext,
} from "../domain/readiness.ts";
import { EDGE_KINDS, wouldCreateCycle, type EdgeKind } from "../domain/edge.ts";
import { mutateOnce, nextInNamespace, withTransaction } from "../store/transactions.ts";

// CRUD / revision / edge scope only (P1). Readiness, claims, journal,
// provenance, and projections belong to later phases.

export interface CreateIssueInput {
  projectId: string;
  title: string;
  kind: IssueKind;
  contract: WorkContract;
  priority?: number;
  scrutiny?: string;
  parentId?: string;
  aliases?: Array<{ alias: string; kind: string }>;
  authoredBy?: string;
  ownership?: unknown;
  contextRefs?: unknown[];
}

export interface StoredEdge {
  id: number;
  fromIssue: string;
  toIssue: string;
  kind: EdgeKind;
  childSlot: number | null;
  active: boolean;
  createdAt: number;
}

interface Row {
  [key: string]: unknown;
}

function row<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function rows<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export class IssueService {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // -- projects -----------------------------------------------------------

  createProject(input: { id?: string; prefix: string; name: string }): Project {
    const prefix = input.prefix.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]*$/.test(prefix)) throw new Error(`invalid project prefix: ${input.prefix}`);
    if (!input.name.trim()) throw new Error("project name must be non-empty");
    const project: Project = {
      id: input.id ?? `prj_${prefix.toLowerCase()}`,
      prefix,
      name: input.name,
      createdAt: Date.now(),
    };
    return withTransaction(this.db, () => {
      try {
        this.db
          .prepare("INSERT INTO projects (id, prefix, name, created_at) VALUES (?, ?, ?, ?)")
          .run(project.id, project.prefix, project.name, project.createdAt);
      } catch {
        throw new Error(`project already exists: ${project.id} / ${project.prefix}`);
      }
      return project;
    });
  }

  getProject(id: string): Project {
    const p = row<Row>(this.db, "SELECT id, prefix, name, created_at FROM projects WHERE id = ?", id);
    if (!p) throw new Error(`unknown project: ${id}`);
    return { id: p["id"] as string, prefix: p["prefix"] as string, name: p["name"] as string, createdAt: p["created_at"] as number };
  }

  // -- issues -------------------------------------------------------------

  createIssue(input: CreateIssueInput, opts?: { idempotencyKey?: string }): ResolvedIssue {
    assertContractShape(input.contract);
    if (!input.title.trim()) throw new Error("title must be non-empty");
    if (!(ISSUE_KINDS as readonly string[]).includes(input.kind)) throw new Error(`unknown kind: ${input.kind}`);
    const project = this.getProject(input.projectId);
    if (input.parentId) this.requireIssue(input.parentId);
    const key = opts?.idempotencyKey;
    return withTransaction(this.db, () =>
      key
        ? mutateOnce(this.db, "command", key, () => this.insertIssue(project, input))
        : this.insertIssue(project, input),
    );
  }

  private insertIssue(project: Project, input: CreateIssueInput): ResolvedIssue {
    const now = Date.now();
    const id = newIssueId();
    const humanNumber = nextInNamespace(this.db, "human_ref", project.id);
    const contractHash = hashContract(input.contract);
    const ownershipFindings = validateOwnership(input.ownership);
    if (ownershipFindings.length > 0) throw new Error(`invalid ownership: ${ownershipFindings[0]!.message}`);
    const contextFindings = validateContextRefs(input.contextRefs ?? []);
    if (contextFindings.length > 0) throw new Error(`invalid contextRefs: ${contextFindings[0]!.message}`);
    this.db
      .prepare(
        `INSERT INTO issues (id, project_id, human_number, kind, title, lifecycle_state,
          priority, scrutiny, current_revision, current_contract_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, 1, ?, ?, ?)`,
      )
      .run(id, project.id, humanNumber, input.kind, input.title, input.priority ?? 0, input.scrutiny ?? "", contractHash, now, now);
    this.db
      .prepare(
        `INSERT INTO issue_revisions (issue_id, revision, contract_hash, contract_json,
          context_refs_json, ownership_json, authored_by, source_json, created_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        id,
        contractHash,
        JSON.stringify(input.contract),
        JSON.stringify(input.contextRefs ?? []),
        input.ownership == null ? null : JSON.stringify(input.ownership),
        input.authoredBy ?? "unknown",
        now,
      );
    this.appendEvent(id, "issue.created", { humanRef: formatHumanRef(project.prefix, humanNumber) });
    for (const a of input.aliases ?? []) this.insertAlias(id, a.alias, a.kind, now);
    if (input.parentId) this.linkParent(id, input.parentId, now);
    return this.view(id);
  }

  // Revision-on-contract-change (PRD §10): identical contract is a no-op.
  // Revision metadata (ownership/contextRefs) carries forward unless the
  // caller overrides it; the new revision revalidates structurally at read.
  updateContract(
    issueId: string,
    contract: WorkContract,
    authoredBy: string,
    opts?: { expectedRevision?: number; idempotencyKey?: string; ownership?: unknown; contextRefs?: unknown[] },
  ): { issue: ResolvedIssue; created: boolean } {
    assertContractShape(contract);
    const key = opts?.idempotencyKey;
    return withTransaction(this.db, () =>
      key
        ? mutateOnce(this.db, "command", key, () =>
            this.revise(issueId, contract, authoredBy, opts?.expectedRevision, opts?.ownership, opts?.contextRefs),
          )
        : this.revise(issueId, contract, authoredBy, opts?.expectedRevision, opts?.ownership, opts?.contextRefs),
    );
  }

  private revise(
    issueId: string,
    contract: WorkContract,
    authoredBy: string,
    expectedRevision?: number,
    ownership?: unknown,
    contextRefs?: unknown[],
  ): { issue: ResolvedIssue; created: boolean } {
    const issue = this.requireIssue(issueId);
    if (expectedRevision !== undefined && issue.currentRevision !== expectedRevision) {
      throw new Error(`revision conflict on ${issueId}: expected ${expectedRevision}, current ${issue.currentRevision}`);
    }
    const hash = hashContract(contract);
    if (hash === issue.currentContractHash && ownership === undefined && contextRefs === undefined) {
      return { issue: this.view(issueId), created: false };
    }
    const current = this.getRevision(issueId, issue.currentRevision);
    const nextOwnership = ownership === undefined ? current.ownership : ownership;
    const nextContextRefs = contextRefs === undefined ? current.contextRefs : contextRefs;
    const ownershipFindings = validateOwnership(nextOwnership);
    if (ownershipFindings.length > 0) throw new Error(`invalid ownership: ${ownershipFindings[0]!.message}`);
    const contextFindings = validateContextRefs(nextContextRefs);
    if (contextFindings.length > 0) throw new Error(`invalid contextRefs: ${contextFindings[0]!.message}`);
    if (hash === issue.currentContractHash) {
      const now = Date.now();
      this.db
        .prepare("UPDATE issue_revisions SET ownership_json = ?, context_refs_json = ? WHERE issue_id = ? AND revision = ?")
        .run(
          nextOwnership == null ? null : JSON.stringify(nextOwnership),
          JSON.stringify(nextContextRefs),
          issueId,
          issue.currentRevision,
        );
      this.touch(issueId, now);
      this.appendEvent(issueId, "issue.metadata", { revision: issue.currentRevision });
      return { issue: this.view(issueId), created: false };
    }
    const now = Date.now();
    const revision = issue.currentRevision + 1;
    this.db
      .prepare(
        `INSERT INTO issue_revisions (issue_id, revision, contract_hash, contract_json,
          context_refs_json, ownership_json, authored_by, source_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        issueId,
        revision,
        hash,
        JSON.stringify(contract),
        JSON.stringify(nextContextRefs),
        nextOwnership == null ? null : JSON.stringify(nextOwnership),
        authoredBy,
        now,
      );
    this.db
      .prepare("UPDATE issues SET current_revision = ?, current_contract_hash = ?, updated_at = ? WHERE id = ?")
      .run(revision, hash, now, issueId);
    this.appendEvent(issueId, "issue.revised", { revision, contractHash: hash });
    return { issue: this.view(issueId), created: true };
  }

  // -- identity resolution (PRD §8.5) -------------------------------------

  // Accepts machine ID, durable human reference, current locator, historical
  // locator, or registered alias when unambiguous.
  resolveRef(ref: string): ResolvedIssue {
    const q = ref.trim();
    if (q.startsWith("iss_")) return this.view(q);
    const human = parseHumanRef(q);
    if (human) {
      const p = row<Row>(this.db, "SELECT id FROM projects WHERE prefix = ?", human.prefix);
      if (!p) throw new Error(`unresolvable ref: ${ref}`);
      const hit = row<Row>(this.db, "SELECT id FROM issues WHERE project_id = ? AND human_number = ?", p["id"] as string, human.number);
      if (!hit) throw new Error(`unresolvable ref: ${ref}`);
      return this.view(hit["id"] as string);
    }
    const alias = row<Row>(this.db, "SELECT issue_id FROM issue_aliases WHERE alias = ?", q);
    if (alias) return this.view(alias["issue_id"] as string);
    const hist = row<Row>(this.db, "SELECT issue_id FROM issue_locator_history WHERE locator = ?", q);
    if (hist) return this.view(hist["issue_id"] as string);
    const current = this.findByCurrentLocator(q);
    if (current) return current;
    throw new Error(`unresolvable ref: ${ref}`);
  }

  getIssue(id: string): ResolvedIssue {
    return this.view(id);
  }

  listIssues(projectId: string): ResolvedIssue[] {
    return rows<Row>(this.db, "SELECT id FROM issues WHERE project_id = ? ORDER BY human_number", projectId).map((r) =>
      this.view(r["id"] as string),
    );
  }

  getRevision(issueId: string, revision: number): IssueRevision {
    const r = row<Row>(this.db, "SELECT * FROM issue_revisions WHERE issue_id = ? AND revision = ?", issueId, revision);
    if (!r) throw new Error(`unknown revision ${issueId}#${revision}`);
    return this.toRevision(r);
  }

  listRevisions(issueId: string): IssueRevision[] {
    return rows<Row>(this.db, "SELECT * FROM issue_revisions WHERE issue_id = ? ORDER BY revision", issueId).map((r) =>
      this.toRevision(r),
    );
  }

  listEvents(issueId: string): IssueEvent[] {
    return rows<Row>(this.db, "SELECT * FROM issue_events WHERE issue_id = ? ORDER BY id", issueId).map((r) => ({
      id: r["id"] as number,
      issueId: r["issue_id"] as string,
      type: r["type"] as string,
      payload: JSON.parse(r["payload_json"] as string),
      createdAt: r["created_at"] as number,
    }));
  }

  // -- locators (PRD §8.3) --------------------------------------------------

  currentLocator(issueId: string): string {
    const issue = this.requireIssue(issueId);
    const project = this.getProject(issue.projectId);
    const slots: number[] = [];
    const seen = new Set<string>([issueId]);
    let cur = issueId;
    for (;;) {
      const edge = row<Row>(
        this.db,
        "SELECT from_issue, child_slot FROM issue_edges WHERE to_issue = ? AND kind = 'parent_child' AND active = 1",
        cur,
      );
      if (!edge) break;
      slots.unshift(edge["child_slot"] as number);
      cur = edge["from_issue"] as string;
      if (seen.has(cur)) throw new Error(`fail-closed: parent cycle detected at ${cur}`);
      seen.add(cur);
    }
    const root = this.requireIssue(cur);
    const rootProject = this.getProject(root.projectId);
    void project;
    const rootRef = formatHumanRef(rootProject.prefix, root.humanNumber);
    return slots.length === 0 ? rootRef : `${rootRef}.${slots.join(".")}`;
  }

  locatorHistory(issueId: string): string[] {
    return rows<Row>(this.db, "SELECT locator FROM issue_locator_history WHERE issue_id = ? ORDER BY created_at", issueId).map(
      (r) => r["locator"] as string,
    );
  }

  // -- edges (PRD §14) ------------------------------------------------------

  // Reparenting preserves machine ID + durable reference; only the current
  // locator changes, and the previous locator becomes a historical alias.
  setParent(childId: string, parentId: string | null, opts?: { idempotencyKey?: string }): ResolvedIssue {
    const key = opts?.idempotencyKey;
    return withTransaction(this.db, () =>
      key ? mutateOnce(this.db, "command", key, () => this.reparent(childId, parentId)) : this.reparent(childId, parentId),
    );
  }

  private reparent(childId: string, parentId: string | null): ResolvedIssue {
    const child = this.requireIssue(childId);
    const prev = row<Row>(
      this.db,
      "SELECT id, from_issue FROM issue_edges WHERE to_issue = ? AND kind = 'parent_child' AND active = 1",
      childId,
    );
    const prevParent = (prev?.["from_issue"] as string | undefined) ?? null;
    if (prevParent === parentId) return this.view(childId);
    if (parentId) {
      const parent = this.requireIssue(parentId);
      if (parent.projectId !== child.projectId) throw new Error("cross-project parenting is not supported in v0");
      const links = rows<Row>(this.db, "SELECT from_issue, to_issue FROM issue_edges WHERE kind = 'parent_child' AND active = 1").map(
        (r) => ({ from: r["to_issue"] as string, to: r["from_issue"] as string }),
      );
      if (wouldCreateCycle(links, childId, parentId)) throw new Error(`parent cycle rejected: ${parentId} is under ${childId}`);
    }
    const now = Date.now();
    const oldLocator = this.currentLocator(childId);
    if (prev) {
      this.db.prepare("UPDATE issue_edges SET active = 0 WHERE id = ?").run(prev["id"] as number);
      this.appendEvent(childId, "edge.removed", { kind: "parent_child", parent: prevParent });
    }
    this.db
      .prepare("INSERT INTO issue_locator_history (project_id, locator, issue_id, created_at) VALUES (?, ?, ?, ?)")
      .run(child.projectId, oldLocator, childId, now);
    if (parentId) this.linkParent(childId, parentId, now);
    else this.appendEvent(childId, "edge.removed", { kind: "parent_child", parent: prevParent, becameRoot: true });
    this.touch(childId, now);
    return this.view(childId);
  }

  private linkParent(childId: string, parentId: string, now: number): void {
    const slot = nextInNamespace(this.db, "child_slot", parentId);
    this.db
      .prepare(
        "INSERT INTO issue_edges (from_issue, to_issue, kind, child_slot, active, created_at) VALUES (?, ?, 'parent_child', ?, 1, ?)",
      )
      .run(parentId, childId, slot, now);
    this.appendEvent(childId, "edge.added", { kind: "parent_child", parent: parentId, childSlot: slot });
  }

  addEdge(fromId: string, toId: string, kind: EdgeKind, opts?: { idempotencyKey?: string }): StoredEdge {
    if (kind === "parent_child") throw new Error("use setParent for parent_child edges");
    if (fromId === toId) throw new Error("self edges are rejected");
    if (!(EDGE_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown edge kind: ${kind}`);
    this.requireIssue(fromId);
    this.requireIssue(toId);
    const key = opts?.idempotencyKey;
    return withTransaction(this.db, () =>
      key ? mutateOnce(this.db, "command", key, () => this.insertEdge(fromId, toId, kind)) : this.insertEdge(fromId, toId, kind),
    );
  }

  private insertEdge(fromId: string, toId: string, kind: EdgeKind): StoredEdge {
    if (kind === "blocks") {
      const links = rows<Row>(this.db, "SELECT from_issue, to_issue FROM issue_edges WHERE kind = 'blocks' AND active = 1").map((r) => ({
        from: r["from_issue"] as string,
        to: r["to_issue"] as string,
      }));
      if (wouldCreateCycle(links, fromId, toId)) throw new Error(`blocks cycle rejected: ${fromId} -> ${toId}`);
    }
    const now = Date.now();
    const id = Number(
      (
        this.db
          .prepare("INSERT INTO issue_edges (from_issue, to_issue, kind, child_slot, active, created_at) VALUES (?, ?, ?, NULL, 1, ?) RETURNING id")
          .get(fromId, toId, kind, now) as { id: number }
      ).id,
    );
    this.appendEvent(toId, "edge.added", { kind, from: fromId, edge: id });
    return { id, fromIssue: fromId, toIssue: toId, kind, childSlot: null, active: true, createdAt: now };
  }

  removeEdge(edgeId: number): void {
    withTransaction(this.db, () => {
      const e = row<Row>(this.db, "SELECT * FROM issue_edges WHERE id = ?", edgeId);
      if (!e) throw new Error(`unknown edge: ${edgeId}`);
      if (e["kind"] === "parent_child") throw new Error("use setParent for parent_child edges");
      if (e["active"] === 0) return;
      this.db.prepare("UPDATE issue_edges SET active = 0 WHERE id = ?").run(edgeId);
      this.appendEvent(e["to_issue"] as string, "edge.removed", { kind: e["kind"], edge: edgeId });
    });
  }

  getParent(childId: string): ResolvedIssue | null {
    const e = row<Row>(
      this.db,
      "SELECT from_issue FROM issue_edges WHERE to_issue = ? AND kind = 'parent_child' AND active = 1",
      childId,
    );
    return e ? this.view(e["from_issue"] as string) : null;
  }

  listChildren(parentId: string): ResolvedIssue[] {
    return rows<Row>(
      this.db,
      "SELECT to_issue AS id FROM issue_edges WHERE from_issue = ? AND kind = 'parent_child' AND active = 1 ORDER BY child_slot",
      parentId,
    ).map((r) => this.view(r["id"] as string));
  }

  listActiveEdges(): StoredEdge[] {
    return rows<Row>(this.db, "SELECT * FROM issue_edges WHERE active = 1 ORDER BY id").map((r) => this.toEdge(r));
  }

  // -- aliases (PRD §8.5) -----------------------------------------------------

  addAlias(issueId: string, alias: string, kind: string): void {
    const a = alias.trim();
    if (!a) throw new Error("alias must be non-empty");
    withTransaction(this.db, () => this.insertAlias(issueId, a, kind, Date.now()));
  }

  private insertAlias(issueId: string, alias: string, kind: string, now: number): void {
    this.requireIssue(issueId);
    try {
      this.db.prepare("INSERT INTO issue_aliases (alias, issue_id, kind, created_at) VALUES (?, ?, ?, ?)").run(alias, issueId, kind, now);
    } catch {
      throw new Error(`alias already registered: ${alias}`);
    }
  }

  listAliases(issueId: string): Array<{ alias: string; kind: string }> {
    return rows<Row>(this.db, "SELECT alias, kind FROM issue_aliases WHERE issue_id = ? ORDER BY alias", issueId).map((r) => ({
      alias: r["alias"] as string,
      kind: r["kind"] as string,
    }));
  }

  // -- events -----------------------------------------------------------------

  // Public so later phases and tests can record markers such as
  // `external.uncertain` (PRD §47: uncertain effects are recorded, never guessed).
  appendEvent(issueId: string, type: string, payload: unknown): number {
    const r = this.db
      .prepare("INSERT INTO issue_events (issue_id, type, payload_json, created_at) VALUES (?, ?, ?, ?) RETURNING id")
      .get(issueId, type, JSON.stringify(payload ?? {}), Date.now()) as { id: number };
    return Number(r.id);
  }

  // -- export / import (G47) ----------------------------------------------------

  exportProject(projectId: string): Record<string, unknown> {
    const project = this.getProject(projectId);
    const issues = rows<Row>(this.db, "SELECT id FROM issues WHERE project_id = ? ORDER BY human_number", projectId).map(
      (r) => r["id"] as string,
    );
    return {
      version: 1,
      project,
      issues: issues.map((id) => ({
        issue: this.requireIssue(id),
        revisions: this.listRevisions(id),
        aliases: this.listAliases(id),
        locatorHistory: this.locatorHistory(id),
      })),
      edges: rows<Row>(
        this.db,
        `SELECT e.* FROM issue_edges e JOIN issues i ON i.id = e.from_issue WHERE i.project_id = ? ORDER BY e.id`,
        projectId,
      ).map((r) => this.toEdge(r)),
      counters: {
        humanRefNext:
          (row<Row>(this.db, "SELECT next_val FROM seq_counters WHERE namespace = 'human_ref' AND name = ?", projectId)?.["next_val"] as number | undefined) ??
          1,
      },
    };
  }

  importProject(snapshot: Record<string, unknown>): void {
    const data = snapshot as {
      project: Project;
      issues: Array<{ issue: Issue; revisions: IssueRevision[]; aliases: Array<{ alias: string; kind: string }>; locatorHistory: string[] }>;
      edges: StoredEdge[];
    };
    withTransaction(this.db, () => {
      const now = Date.now();
      this.db.prepare("INSERT OR IGNORE INTO projects (id, prefix, name, created_at) VALUES (?, ?, ?, ?)").run(
        data.project.id,
        data.project.prefix,
        data.project.name,
        data.project.createdAt,
      );
      for (const entry of data.issues) {
        const i = entry.issue;
        this.db
          .prepare(
            `INSERT OR IGNORE INTO issues (id, project_id, human_number, kind, title, lifecycle_state,
              priority, scrutiny, current_revision, current_contract_hash, defer_until, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(i.id, i.projectId, i.humanNumber, i.kind, i.title, i.lifecycleState, i.priority, i.scrutiny, i.currentRevision,
            i.currentContractHash, i.deferUntil, i.createdAt, i.updatedAt);
        for (const rev of entry.revisions) {
          this.db
            .prepare(
              `INSERT OR IGNORE INTO issue_revisions (issue_id, revision, contract_hash, contract_json,
                context_refs_json, ownership_json, authored_by, source_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(rev.issueId, rev.revision, rev.contractHash, JSON.stringify(rev.contract), JSON.stringify(rev.contextRefs),
              rev.ownership == null ? null : JSON.stringify(rev.ownership), rev.authoredBy,
              rev.source == null ? null : JSON.stringify(rev.source), rev.createdAt);
        }
        for (const a of entry.aliases) {
          this.db.prepare("INSERT OR IGNORE INTO issue_aliases (alias, issue_id, kind, created_at) VALUES (?, ?, ?, ?)").run(
            a.alias, i.id, a.kind, now);
        }
        for (const loc of entry.locatorHistory) {
          this.db.prepare("INSERT OR IGNORE INTO issue_locator_history (project_id, locator, issue_id, created_at) VALUES (?, ?, ?, ?)")
            .run(i.projectId, loc, i.id, now);
        }
      }
      for (const e of data.edges) {
        this.db
          .prepare(
            "INSERT INTO issue_edges (from_issue, to_issue, kind, child_slot, active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(e.fromIssue, e.toIssue, e.kind, e.childSlot, e.active ? 1 : 0, e.createdAt);
      }
      const maxHuman = data.issues.reduce((m, e) => Math.max(m, e.issue.humanNumber), 0);
      this.db.prepare("INSERT OR IGNORE INTO seq_counters (namespace, name, next_val) VALUES ('human_ref', ?, ?)").run(
        data.project.id, maxHuman + 1);
      const maxSlot = new Map<string, number>();
      for (const e of data.edges) {
        if (e.kind === "parent_child" && e.childSlot != null) {
          maxSlot.set(e.fromIssue, Math.max(maxSlot.get(e.fromIssue) ?? 0, e.childSlot));
        }
      }
      for (const [parent, slot] of maxSlot) {
        this.db.prepare("INSERT OR IGNORE INTO seq_counters (namespace, name, next_val) VALUES ('child_slot', ?, ?)").run(parent, slot + 1);
      }
    });
  }

  // -- readiness (PRD §§12-13, 15, 39.1) ---------------------------------------
  // CLI and every integration share this service (PRD §5): no caller derives
  // readiness or dispatch authority anywhere else. Blocked/claimed are
  // derived projections, never stored flags. hasActiveClaim is always false
  // until Phase 3 lands the claims table; the seam is already in place.

  attestReadiness(
    issueId: string,
    input: {
      outcome: "ready" | "reject";
      policy: string;
      attestedBy: string;
      evidenceRefs?: string[];
      blockingGaps?: string[];
    },
  ): ReadinessAttestation {
    if (input.outcome !== "ready" && input.outcome !== "reject") throw new Error(`unknown attestation outcome: ${String(input.outcome)}`);
    if (!input.policy.trim()) throw new Error("attestation policy must be non-empty");
    if (!input.attestedBy.trim()) throw new Error("attestedBy must be non-empty");
    for (const [field, values] of [["evidenceRefs", input.evidenceRefs], ["blockingGaps", input.blockingGaps]] as const) {
      if (values !== undefined && (!Array.isArray(values) || values.some((e) => typeof e !== "string"))) {
        throw new Error(`${field} must be an array of strings when present`);
      }
    }
    return withTransaction(this.db, () => {
      const issue = this.requireIssue(issueId);
      const now = Date.now();
      const r = this.db
        .prepare(
          `INSERT INTO readiness_attestations
             (issue_id, issue_revision, contract_hash, outcome, policy, attested_by,
              evidence_refs_json, blocking_gaps_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(
          issueId,
          issue.currentRevision,
          issue.currentContractHash,
          input.outcome,
          input.policy,
          input.attestedBy,
          JSON.stringify(input.evidenceRefs ?? []),
          JSON.stringify(input.blockingGaps ?? []),
          now,
        ) as { id: number };
      this.appendEvent(issueId, "issue.attested", {
        outcome: input.outcome,
        revision: issue.currentRevision,
        contractHash: issue.currentContractHash,
      });
      return {
        id: Number(r.id),
        issueId,
        issueRevision: issue.currentRevision,
        contractHash: issue.currentContractHash,
        outcome: input.outcome,
        policy: input.policy,
        attestedBy: input.attestedBy,
        evidenceRefs: input.evidenceRefs ?? [],
        blockingGaps: input.blockingGaps ?? [],
        createdAt: now,
      };
    });
  }

  latestAttestation(issueId: string): ReadinessAttestation | null {
    this.requireIssue(issueId);
    const r = row<Row>(
      this.db,
      "SELECT * FROM readiness_attestations WHERE issue_id = ? ORDER BY id DESC LIMIT 1",
      issueId,
    );
    return r ? this.toAttestation(r) : null;
  }

  setDeferral(issueId: string, deferUntil: number | null): ResolvedIssue {
    if (deferUntil !== null && (!Number.isInteger(deferUntil) || deferUntil < 0)) {
      throw new Error("deferUntil must be a non-negative integer timestamp or null");
    }
    return withTransaction(this.db, () => {
      this.requireIssue(issueId);
      const now = Date.now();
      this.db.prepare("UPDATE issues SET defer_until = ?, updated_at = ? WHERE id = ?").run(deferUntil, now, issueId);
      this.appendEvent(issueId, "issue.deferred", { deferUntil });
      return this.view(issueId);
    });
  }

  // SCRUTINY is policy input: only a named level is accepted, and the policy
  // seam in readiness.ts enforces it at dispatch. Unknown levels fail here.
  setScrutiny(issueId: string, scrutiny: string): ResolvedIssue {
    if (!isValidScrutiny(scrutiny)) throw new Error(`invalid scrutiny level: ${scrutiny}`);
    return withTransaction(this.db, () => {
      this.requireIssue(issueId);
      const now = Date.now();
      this.db.prepare("UPDATE issues SET scrutiny = ?, updated_at = ? WHERE id = ?").run(scrutiny, now, issueId);
      this.appendEvent(issueId, "issue.metadata", { field: "scrutiny", scrutiny });
      return this.view(issueId);
    });
  }

  setOwnership(issueId: string, ownership: unknown): ResolvedIssue {
    const findings = validateOwnership(ownership);
    if (findings.length > 0) throw new Error(`invalid ownership: ${findings[0]!.message}`);
    return withTransaction(this.db, () => {
      const issue = this.requireIssue(issueId);
      const now = Date.now();
      this.db
        .prepare("UPDATE issue_revisions SET ownership_json = ? WHERE issue_id = ? AND revision = ?")
        .run(ownership == null ? null : JSON.stringify(ownership), issueId, issue.currentRevision);
      this.touch(issueId, now);
      this.appendEvent(issueId, "issue.metadata", { revision: issue.currentRevision, field: "ownership" });
      return this.view(issueId);
    });
  }

  // Journal/memory kinds are rejected: journal entries are continuity,
  // never planning authority (PRD §43). Fail-closed at write and at read.
  setContextRefs(issueId: string, refs: unknown[]): ResolvedIssue {
    const findings = validateContextRefs(refs);
    if (findings.length > 0) throw new Error(`invalid contextRefs: ${findings[0]!.message}`);
    return withTransaction(this.db, () => {
      const issue = this.requireIssue(issueId);
      const now = Date.now();
      this.db
        .prepare("UPDATE issue_revisions SET context_refs_json = ? WHERE issue_id = ? AND revision = ?")
        .run(JSON.stringify(refs), issueId, issue.currentRevision);
      this.touch(issueId, now);
      this.appendEvent(issueId, "issue.metadata", { revision: issue.currentRevision, field: "contextRefs" });
      return this.view(issueId);
    });
  }

  unsatisfiedBlockers(issueId: string): string[] {
    this.requireIssue(issueId);
    const blockers = rows<Row>(
      this.db,
      "SELECT from_issue FROM issue_edges WHERE to_issue = ? AND kind = 'blocks' AND active = 1 ORDER BY from_issue",
      issueId,
    ).map((r) => r["from_issue"] as string);
    return blockers.filter((b) => {
      try {
        return !isBlockerSatisfied(this.requireIssue(b).lifecycleState);
      } catch {
        return true;
      }
    });
  }

  // Single shared readiness projection (PRD §5). Pass `now` in tests to
  // control deferral without wall-clock coupling.
  getReadiness(issueId: string, opts?: { now?: number }): ReadinessReport {
    const issue = this.requireIssue(issueId);
    const rev = this.getRevision(issueId, issue.currentRevision);
    return deriveReadiness({
      issueId,
      revision: issue.currentRevision,
      contractHash: issue.currentContractHash,
      contract: rev.contract,
      scrutiny: issue.scrutiny,
      ownership: rev.ownership,
      contextRefs: rev.contextRefs,
      lifecycleState: issue.lifecycleState,
      deferUntil: issue.deferUntil,
      attestation: this.latestAttestation(issueId),
      unsatisfiedBlockers: this.unsatisfiedBlockers(issueId),
      now: opts?.now ?? Date.now(),
      hasActiveClaim: false,
    });
  }

  // Fail-closed dispatch gate (PRD §§12.3, 39.1): throws unless the issue is
  // derived ready. requestedScope may NARROW the authorized activation but
  // never expand it — a hidden prompt that widens SCOPE is rejected (A5).
  assertDispatchable(issueId: string, opts?: { now?: number; requestedScope?: string[] }): ReadinessReport {
    const report = this.getReadiness(issueId, opts);
    if (!report.dispatchable) {
      throw new Error(`not dispatchable: ${issueId} is ${report.state}: ${report.reasons.join("; ")}`);
    }
    if (opts?.requestedScope) {
      const rev = this.getRevision(issueId, report.revision);
      const contract = rev.contract as { scope?: unknown };
      const contractScope = Array.isArray(contract.scope) ? (contract.scope as string[]) : [];
      const { ok, expanded } = scopeCovers(contractScope, opts.requestedScope);
      if (!ok) throw new Error(`scope expansion rejected: ${expanded.join(", ")} outside contract SCOPE (§39.1)`);
    }
    return report;
  }

  // Deterministic context inheritance with source provenance (PRD §15).
  // Walks the parent chain root → leaf; the leaf wins per key and every
  // value records its source issue + revision. Throws fail-closed on
  // journal/memory authority claims and on parent cycles.
  getResolvedContext(issueId: string): ResolvedContext {
    const leaf = this.requireIssue(issueId);
    const lineage: string[] = [issueId];
    const seen = new Set<string>([issueId]);
    let cur: string | null = issueId;
    for (;;) {
      const parent = this.getParent(cur);
      if (!parent) break;
      if (seen.has(parent.id)) throw new Error(`fail-closed: parent cycle detected at ${parent.id}`);
      seen.add(parent.id);
      lineage.unshift(parent.id);
      cur = parent.id;
    }
    const chain = lineage.map((id) => {
      const issue = this.requireIssue(id);
      const rev = this.getRevision(id, issue.currentRevision);
      return { issueId: id, revision: issue.currentRevision, refs: (rev.contextRefs ?? []) as ContextRef[] };
    });
    const { entries, hash } = resolveInheritedContext(chain);
    return { issueId, revision: leaf.currentRevision, entries, hash };
  }

  private toAttestation(r: Row): ReadinessAttestation {
    return {
      id: r["id"] as number,
      issueId: r["issue_id"] as string,
      issueRevision: r["issue_revision"] as number,
      contractHash: r["contract_hash"] as string,
      outcome: r["outcome"] as "ready" | "reject",
      policy: r["policy"] as string,
      attestedBy: r["attested_by"] as string,
      evidenceRefs: JSON.parse((r["evidence_refs_json"] as string) ?? "[]"),
      blockingGaps: JSON.parse((r["blocking_gaps_json"] as string) ?? "[]"),
      createdAt: r["created_at"] as number,
    };
  }

  // -- internals ---------------------------------------------------------------

  private requireIssue(id: string): Issue {
    const r = row<Row>(this.db, "SELECT * FROM issues WHERE id = ?", id);
    if (!r) throw new Error(`unknown issue: ${id}`);
    return this.toIssue(r);
  }

  private view(id: string): ResolvedIssue {
    const issue = this.requireIssue(id);
    const project = this.getProject(issue.projectId);
    return { ...issue, humanRef: formatHumanRef(project.prefix, issue.humanNumber), locator: this.currentLocator(id) };
  }

  private findByCurrentLocator(locator: string): ResolvedIssue | null {
    const roots = rows<Row>(this.db, "SELECT id FROM issues");
    for (const r of roots) {
      const id = r["id"] as string;
      try {
        if (this.currentLocator(id) === locator) return this.view(id);
      } catch {
        continue;
      }
    }
    return null;
  }

  private toIssue(r: Row): Issue {
    return {
      id: r["id"] as string,
      projectId: r["project_id"] as string,
      humanNumber: r["human_number"] as number,
      kind: r["kind"] as IssueKind,
      title: r["title"] as string,
      lifecycleState: r["lifecycle_state"] as LifecycleState,
      priority: r["priority"] as number,
      scrutiny: r["scrutiny"] as string,
      currentRevision: r["current_revision"] as number,
      currentContractHash: r["current_contract_hash"] as string,
      deferUntil: (r["defer_until"] as number | null) ?? null,
      createdAt: r["created_at"] as number,
      updatedAt: r["updated_at"] as number,
    };
  }

  private toRevision(r: Row): IssueRevision {
    return {
      issueId: r["issue_id"] as string,
      revision: r["revision"] as number,
      contractHash: r["contract_hash"] as string,
      contract: JSON.parse(r["contract_json"] as string),
      contextRefs: JSON.parse((r["context_refs_json"] as string) ?? "[]"),
      ownership: r["ownership_json"] == null ? null : JSON.parse(r["ownership_json"] as string),
      authoredBy: r["authored_by"] as string,
      source: r["source_json"] == null ? null : JSON.parse(r["source_json"] as string),
      createdAt: r["created_at"] as number,
    };
  }

  private toEdge(r: Row): StoredEdge {
    return {
      id: r["id"] as number,
      fromIssue: r["from_issue"] as string,
      toIssue: r["to_issue"] as string,
      kind: r["kind"] as EdgeKind,
      childSlot: (r["child_slot"] as number | null) ?? null,
      active: (r["active"] as number) === 1,
      createdAt: r["created_at"] as number,
    };
  }

  private touch(issueId: string, now: number): void {
    this.db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?").run(now, issueId);
  }

  // Export-excluded: lifecycle transitions, readiness, claims, journal.
  // Those arrive with their owning phases; this service never invents them.
  setLifecycleState(issueId: string, state: LifecycleState): ResolvedIssue {
    if (!(LIFECYCLE_STATES as readonly string[]).includes(state)) throw new Error(`unknown lifecycle state: ${state}`);
    return withTransaction(this.db, () => {
      this.requireIssue(issueId);
      const now = Date.now();
      this.db.prepare("UPDATE issues SET lifecycle_state = ?, updated_at = ? WHERE id = ?").run(state, now, issueId);
      this.appendEvent(issueId, state === "done" ? "issue.done" : "issue.cancelled", { state });
      return this.view(issueId);
    });
  }
}
