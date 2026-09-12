import type { DatabaseSync, SQLInputValue } from "../store/database.ts";
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
import {
  DEFAULT_CLAIM_TTL_MS,
  DEFAULT_LEASE_TTL_MS,
  isLiveClaim,
  isLiveLease,
  normalizeWorkspace,
  sameHolder,
  type IssueClaim,
  type WorkspaceIdentity,
  type WorkspaceLease,
} from "../domain/claim.ts";
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

export interface AttestReadinessInput {
  outcome: "ready" | "reject";
  policy: string;
  attestedBy: string;
  evidenceRefs?: string[];
  blockingGaps?: string[];
}

export interface ClaimOptions {
  activationId?: string;
  ttlMs?: number;
  now?: number;
  expectedRevision?: number;
  idempotencyKey?: string;
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

  // -- checkout links (cwd-aware project resolution, bead xtrm-7wc.5.6) --
  // DB-side mapping only: git root -> project id, zero repo writes.
  // Only link/unlink write here; resolution reads live every call.

  linkCheckout(gitRoot: string, projectId?: string): { gitRoot: string; projectId: string } {
    const root = gitRoot.trim();
    if (!root) throw new Error("not inside a git checkout: cd into a checkout, or pass --project");
    let target = projectId;
    if (target === undefined) {
      const all = rows<Row>(this.db, "SELECT id FROM projects ORDER BY id");
      if (all.length === 0) throw new Error("no projects exist yet: create one first (sb project create), then link it");
      if (all.length > 1) throw new Error("several projects exist: pass --project <id> to link this checkout explicitly");
      target = all[0]?.["id"] as string;
    }
    this.getProject(target);
    return withTransaction(this.db, () => {
      this.db
        .prepare("INSERT INTO checkout_links (git_root, project_id, linked_at) VALUES (?, ?, ?) ON CONFLICT(git_root) DO UPDATE SET project_id = excluded.project_id, linked_at = excluded.linked_at")
        .run(root, target, Date.now());
      return { gitRoot: root, projectId: target };
    });
  }

  unlinkCheckout(gitRoot: string): boolean {
    const root = gitRoot.trim();
    if (!root) throw new Error("not inside a git checkout: cd into a checkout, or pass --project");
    return withTransaction(this.db, () => {
      const res = this.db.prepare("DELETE FROM checkout_links WHERE git_root = ?").run(root);
      return (res.changes as number) > 0;
    });
  }

  listLinks(): Array<{ gitRoot: string; projectId: string; linkedAt: number }> {
    return rows<Row>(this.db, "SELECT git_root, project_id, linked_at FROM checkout_links ORDER BY git_root").map((r) => ({
      gitRoot: r["git_root"] as string,
      projectId: r["project_id"] as string,
      linkedAt: r["linked_at"] as number,
    }));
  }

  // Project precedence: explicit flag > SUBSTRATE_PROJECT env > linked
  // checkout (git root of cwd) > single-project default > fail closed.
  // Never guesses across candidates: ambiguity lists ids + prefixes with
  // link instructions. The caller discovers the git root (presentation
  // edge); the mapping read stays here so resolution is always live.
  resolveProject(input: { explicit?: string; env?: string; gitRoot?: string | null }): { projectId: string; source: "flag" | "env" | "link" | "single" } {
    if (input.explicit !== undefined) return { projectId: this.getProject(input.explicit).id, source: "flag" };
    if (input.env !== undefined && input.env.trim() !== "") return { projectId: this.getProject(input.env.trim()).id, source: "env" };
    if (input.gitRoot) {
      const linked = this.matchLinkedCheckout(input.gitRoot);
      if (linked) {
        try {
          return { projectId: this.getProject(linked).id, source: "link" };
        } catch {
          throw new Error(`linked project ${linked} no longer exists: re-link this checkout (sb project link --project <id>)`);
        }
      }
    }
    const all = rows<Row>(this.db, "SELECT id, prefix FROM projects ORDER BY id");
    if (all.length === 1) return { projectId: all[0]?.["id"] as string, source: "single" };
    if (all.length === 0) throw new Error("no project selected and no projects exist: create one (sb project create) or pass --project");
    const names = all.map((r) => `${r["id"]} (${r["prefix"]})`).join(", ");
    throw new Error(`no project selected among several: ${names}. Pass --project <id>, set SUBSTRATE_PROJECT, or link this checkout (sb project link --project <id>)`);
  }

  // A checkout is not always handed in as the repository root. The CLI
  // canonicalizes with `git rev-parse --git-common-dir`, but in-process
  // consumers pass process.cwd(), which in a worktree is a path inside the
  // repository (Specialists' work-item store creates inline issues this way).
  // The longest linked ancestor wins, so every worktree of a repository keys
  // to that repository's project, while a checkout that links itself still
  // overrides an enclosing checkout.
  // ponytail: path containment, not `git rev-parse` — the service stays pure
  // and the caller owns git discovery. Ceiling: an unlinked checkout nested
  // inside a linked one inherits the outer project; link the inner checkout
  // explicitly to override it.
  private matchLinkedCheckout(gitRoot: string): string | null {
    const target = gitRoot.replace(/\/+$/, "") || "/";
    let bestRoot = "";
    let bestProject: string | null = null;
    for (const r of rows<Row>(this.db, "SELECT git_root, project_id FROM checkout_links")) {
      const root = (r["git_root"] as string).replace(/\/+$/, "") || "/";
      if (target !== root && !target.startsWith(root === "/" ? "/" : `${root}/`)) continue;
      if (root.length > bestRoot.length) {
        bestRoot = root;
        bestProject = r["project_id"] as string;
      }
    }
    return bestProject;
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
      // Execution-bearing metadata change with an identical contract (§24):
      // still opens a new revision so the prior readiness attestation
      // (bound to revision + hash) is invalidated. Compare first so a
      // restated identical value stays a no-op.
      const sameOwnership =
        ownership === undefined || JSON.stringify(nextOwnership ?? null) === JSON.stringify(current.ownership ?? null);
      const sameContext =
        contextRefs === undefined || JSON.stringify(nextContextRefs) === JSON.stringify(current.contextRefs);
      if (sameOwnership && sameContext) {
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
    // A human-shaped ref that matches no project/row falls through to alias
    // and locator lookup: Beads IDs such as xtrm-401 parse as PREFIX-NUMBER
    // but live on as aliases after import (G45). Found live by the P11 pilot.
    const human = parseHumanRef(q);
    if (human) {
      const p = row<Row>(this.db, "SELECT id FROM projects WHERE prefix = ?", human.prefix);
      const hit = p
        ? row<Row>(this.db, "SELECT id FROM issues WHERE project_id = ? AND human_number = ?", p["id"] as string, human.number)
        : undefined;
      if (hit) return this.view(hit["id"] as string);
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

  // Typed unrelate (§27): deactivates the single active edge between the
  // endpoints for the given kind. parent_child stays structural (setParent).
  removeEdgeByEndpoints(fromId: string, toId: string, kind: EdgeKind): { edge: number; kind: EdgeKind } {
    if (kind === "parent_child") throw new Error("use setParent for parent_child edges");
    if (!(EDGE_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown edge kind: ${kind}`);
    this.requireIssue(fromId);
    this.requireIssue(toId);
    return withTransaction(this.db, () => {
      const e = row<Row>(
        this.db,
        "SELECT id FROM issue_edges WHERE from_issue = ? AND to_issue = ? AND kind = ? AND active = 1 ORDER BY id LIMIT 1",
        fromId,
        toId,
        kind,
      );
      if (!e) throw new Error(`no active ${kind} edge from ${fromId} to ${toId}`);
      const edgeId = e["id"] as number;
      this.db.prepare("UPDATE issue_edges SET active = 0 WHERE id = ?").run(edgeId);
      this.appendEvent(toId, "edge.removed", { kind, edge: edgeId });
      return { edge: edgeId, kind };
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

  // Exact alias lookup, no ref parsing. Importers must use this as their
  // "already imported" probe instead of resolveRef: a legacy Beads id can be
  // shaped like a durable ref (id `core-076` parses as CORE-76), resolveRef
  // prefers the ref parse, and a present-but-unrelated issue would then be
  // mistaken for the imported record — silently dropping it and re-pointing
  // its edges at the wrong issue.
  issueIdForAlias(alias: string): string | null {
    const a = alias.trim();
    if (!a) return null;
    const hit = row<Row>(this.db, "SELECT issue_id FROM issue_aliases WHERE alias = ?", a);
    return hit ? (hit["issue_id"] as string) : null;
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
        // Bulk history surface (A9 receipt v3): migrated Beads notes/
        // comments land as journal kind "note"; export carries them so
        // verifiers can confirm history survival without per-issue reads.
        // Additive: importProject ignores this key (snapshot consumers
        // must not treat it as authority for re-import).
        journal: rows<Row>(this.db, "SELECT sequence, kind, semantic_json, refs_json FROM issue_journal WHERE issue_id = ? ORDER BY sequence", id).map(
          (r) => {
            let summary: string | null = null;
            let refs: unknown = [];
            try {
              const sem = JSON.parse((r["semantic_json"] as string | null) ?? "null") as { summary?: unknown } | null;
              if (sem && typeof sem["summary"] === "string") summary = sem["summary"] as string;
            } catch {
              summary = null;
            }
            try {
              refs = JSON.parse((r["refs_json"] as string | null) ?? "[]");
            } catch {
              refs = [];
            }
            return { sequence: r["sequence"], kind: r["kind"], summary, refs };
          },
        ),
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
  // derived projections, never stored flags; `claimed` comes from the live
  // claim row via hasActiveClaim (Phase 3).

  attestReadiness(issueId: string, input: AttestReadinessInput): ReadinessAttestation {
    this.assertAttestInput(input);
    return withTransaction(this.db, () => this.insertAttestationTx(issueId, input, Date.now()));
  }

  private assertAttestInput(input: AttestReadinessInput): void {
    if (input.outcome !== "ready" && input.outcome !== "reject") throw new Error(`unknown attestation outcome: ${String(input.outcome)}`);
    if (!input.policy.trim()) throw new Error("attestation policy must be non-empty");
    if (!input.attestedBy.trim()) throw new Error("attestedBy must be non-empty");
    for (const [field, values] of [["evidenceRefs", input.evidenceRefs], ["blockingGaps", input.blockingGaps]] as const) {
      if (values !== undefined && (!Array.isArray(values) || values.some((e) => typeof e !== "string"))) {
        throw new Error(`${field} must be an array of strings when present`);
      }
    }
  }

  // Tx-scoped: the caller must already hold the transaction. Lets claimReady
  // attest and claim atomically without nesting transactions.
  private insertAttestationTx(issueId: string, input: AttestReadinessInput, now: number): ReadinessAttestation {
    const issue = this.requireIssue(issueId);
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

  // SCRUTINY is execution-relevant (§24): the change opens a new revision
  // (same contract, new revision number) so the prior attestation — bound
  // to revision + hash — is invalidated. Only a named level is accepted.
  setScrutiny(issueId: string, scrutiny: string, authoredBy = "sb-cli"): ResolvedIssue {
    if (!isValidScrutiny(scrutiny)) throw new Error(`invalid scrutiny level: ${scrutiny}`);
    return withTransaction(this.db, () => {
      const issue = this.requireIssue(issueId);
      if (issue.scrutiny === scrutiny) return this.view(issueId);
      const current = this.getRevision(issueId, issue.currentRevision);
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
          issue.currentContractHash,
          JSON.stringify(current.contract),
          JSON.stringify(current.contextRefs),
          current.ownership == null ? null : JSON.stringify(current.ownership),
          authoredBy,
          now,
        );
      this.db
        .prepare("UPDATE issues SET scrutiny = ?, current_revision = ?, updated_at = ? WHERE id = ?")
        .run(scrutiny, revision, now, issueId);
      this.appendEvent(issueId, "issue.revised", { revision, contractHash: issue.currentContractHash, field: "scrutiny", scrutiny });
      return this.view(issueId);
    });
  }

  // Ownership is execution-relevant (§24): routes through revise so a
  // changed value opens a new revision and invalidates readiness. A
  // restated identical value stays a no-op.
  setOwnership(issueId: string, ownership: unknown, authoredBy = "sb-cli"): ResolvedIssue {
    const findings = validateOwnership(ownership);
    if (findings.length > 0) throw new Error(`invalid ownership: ${findings[0]!.message}`);
    const issue = this.requireIssue(issueId);
    const current = this.getRevision(issueId, issue.currentRevision);
    if (JSON.stringify(ownership ?? null) === JSON.stringify(current.ownership ?? null)) return this.view(issueId);
    const { issue: next } = this.updateContract(issueId, current.contract as WorkContract, authoredBy, { ownership });
    return next;
  }

  // Journal/memory kinds are rejected: journal entries are continuity,
  // never planning authority (PRD §43). Fail-closed at write and at read.
  // Execution-relevant (§24): a changed value opens a new revision via
  // revise; a restated identical value stays a no-op.
  setContextRefs(issueId: string, refs: unknown[], authoredBy = "sb-cli"): ResolvedIssue {
    const findings = validateContextRefs(refs);
    if (findings.length > 0) throw new Error(`invalid contextRefs: ${findings[0]!.message}`);
    const issue = this.requireIssue(issueId);
    const current = this.getRevision(issueId, issue.currentRevision);
    if (JSON.stringify(refs) === JSON.stringify(current.contextRefs)) return this.view(issueId);
    const { issue: next } = this.updateContract(issueId, current.contract as WorkContract, authoredBy, { contextRefs: refs });
    return next;
  }

  // Metadata-only mutations (§24): title / priority emit an issue.metadata
  // event and never touch the contract revision, so readiness is retained.
  setTitle(issueId: string, title: string): ResolvedIssue {
    if (!title.trim()) throw new Error("title must be non-empty");
    return withTransaction(this.db, () => {
      this.requireIssue(issueId);
      const now = Date.now();
      this.db.prepare("UPDATE issues SET title = ?, updated_at = ? WHERE id = ?").run(title, now, issueId);
      this.appendEvent(issueId, "issue.metadata", { field: "title", title });
      return this.view(issueId);
    });
  }

  setPriority(issueId: string, priority: number): ResolvedIssue {
    if (!Number.isInteger(priority)) throw new Error("priority must be an integer");
    return withTransaction(this.db, () => {
      this.requireIssue(issueId);
      const now = Date.now();
      this.db.prepare("UPDATE issues SET priority = ?, updated_at = ? WHERE id = ?").run(priority, now, issueId);
      this.appendEvent(issueId, "issue.metadata", { field: "priority", priority });
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
    const now = opts?.now ?? Date.now();
    return this.readinessReport(issueId, now, this.openClaim(issueId, now) !== null);
  }

  private readinessReport(issueId: string, now: number, hasActiveClaim: boolean): ReadinessReport {
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
      now,
      hasActiveClaim,
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

  // -- claims (PRD §17) --------------------------------------------------------
  // Atomic, lease-backed work ownership. Exactly one live claim per issue:
  // serialized check-then-insert inside one transaction, backed by the
  // partial unique index on open rows. `claimed` state is derived in
  // getReadiness from the live row, never stored on the issue.
  // Tx-scoped helpers (claimTx) assume the caller holds the transaction so
  // claimReady stays a single transaction without nesting.

  claimIssue(issueId: string, holder: string, opts?: ClaimOptions): IssueClaim {
    this.assertHolder(holder);
    const key = opts?.idempotencyKey;
    return withTransaction(this.db, () =>
      key
        ? mutateOnce(this.db, "command", key, () =>
            this.claimTx(issueId, holder, opts?.activationId, opts?.ttlMs, opts?.now ?? Date.now(), opts?.expectedRevision),
          )
        : this.claimTx(issueId, holder, opts?.activationId, opts?.ttlMs, opts?.now ?? Date.now(), opts?.expectedRevision),
    );
  }

  // Attest + claim in one transaction: the claim binds the freshly attested
  // revision, so no edit can slip between attestation and ownership.
  claimReady(
    issueId: string,
    holder: string,
    attestation: AttestReadinessInput,
    opts?: ClaimOptions,
  ): { attestation: ReadinessAttestation; claim: IssueClaim } {
    this.assertHolder(holder);
    this.assertAttestInput(attestation);
    return withTransaction(this.db, () => {
      const now = opts?.now ?? Date.now();
      const att = this.insertAttestationTx(issueId, attestation, now);
      const claim = this.claimTx(issueId, holder, opts?.activationId, opts?.ttlMs, now, opts?.expectedRevision);
      return { attestation: att, claim };
    });
  }

  private claimTx(
    issueId: string,
    holder: string,
    activationId: string | undefined,
    ttlMs: number | undefined,
    now: number,
    expectedRevision: number | undefined,
  ): IssueClaim {
    const issue = this.requireIssue(issueId);
    if (expectedRevision !== undefined && issue.currentRevision !== expectedRevision) {
      throw new Error(`revision conflict on ${issueId}: expected ${expectedRevision}, current ${issue.currentRevision}`);
    }
    const open = this.openClaim(issueId, now);
    const unclosed = open ?? this.unclosedClaim(issueId);
    if (unclosed) {
      if (isLiveClaim(unclosed, now)) {
        // Idempotent same-holder retry (C16); anything else is steal (C17).
        if (sameHolder(unclosed, holder, activationId ?? null)) return unclosed;
        throw new Error(
          `claim-held: ${issueId} is live-held by ${unclosed.holder} until ${unclosed.expiresAt} (anti-steal)`,
        );
      }
      // Expired: reclaim per policy (C18) — close the old generation first
      // so the open-row slot is never double-held.
      this.closeClaimRow(unclosed.id, now);
      this.appendEvent(issueId, "claim.expired", {
        claim: unclosed.id,
        generation: unclosed.generation,
        holder: unclosed.holder,
      });
    }
    // Claimable-state check in the same transaction: drafts and ambiguous
    // work cannot be claimed (§5, A1). hasActiveClaim is false here — the
    // live row would have thrown above, the expired row is just closed.
    const report = this.readinessReport(issueId, now, false);
    if (!report.dispatchable) {
      throw new Error(`not-claimable: ${issueId} is ${report.state}: ${report.reasons.join("; ")}`);
    }
    const ttl = ttlMs ?? DEFAULT_CLAIM_TTL_MS;
    if (!Number.isInteger(ttl) || ttl <= 0) throw new Error("claim ttlMs must be a positive integer");
    const prev = row<{ g: number }>(this.db, "SELECT MAX(generation) AS g FROM issue_claims WHERE issue_id = ?", issueId);
    const generation = (prev?.g ?? 0) + 1;
    const acquiredAt = now;
    const r = this.db
      .prepare(
        `INSERT INTO issue_claims
           (issue_id, issue_revision, contract_hash, holder, activation_id,
            acquired_at, expires_at, released_at, generation)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?) RETURNING id`,
      )
      .get(
        issueId,
        issue.currentRevision,
        issue.currentContractHash,
        holder,
        activationId ?? null,
        acquiredAt,
        acquiredAt + ttl,
        generation,
      ) as { id: number };
    this.appendEvent(issueId, "claim.acquired", { claim: Number(r.id), generation, holder });
    return {
      id: Number(r.id),
      issueId,
      issueRevision: issue.currentRevision,
      contractHash: issue.currentContractHash,
      holder,
      activationId: activationId ?? null,
      acquiredAt,
      expiresAt: acquiredAt + ttl,
      releasedAt: null,
      generation,
    };
  }

  renewClaim(issueId: string, holder: string, opts?: { activationId?: string; ttlMs?: number; now?: number }): IssueClaim {
    this.assertHolder(holder);
    return withTransaction(this.db, () => {
      const now = opts?.now ?? Date.now();
      const open = this.unclosedClaim(issueId);
      if (!open) throw new Error(`no-claim: ${issueId} has no open claim to renew`);
      if (!isLiveClaim(open, now)) throw new Error(`claim-expired: ${issueId} generation ${open.generation} expired; reclaim with claimIssue`);
      if (!sameHolder(open, holder, opts?.activationId ?? null)) {
        throw new Error(`claim-held: ${issueId} is live-held by ${open.holder} (anti-steal)`);
      }
      const ttl = opts?.ttlMs ?? DEFAULT_CLAIM_TTL_MS;
      if (!Number.isInteger(ttl) || ttl <= 0) throw new Error("claim ttlMs must be a positive integer");
      const expiresAt = now + ttl;
      this.db.prepare("UPDATE issue_claims SET expires_at = ? WHERE id = ?").run(expiresAt, open.id);
      this.appendEvent(issueId, "claim.renewed", { claim: open.id, generation: open.generation, expiresAt });
      return { ...open, expiresAt };
    });
  }

  // Holder-only release. No open row is an idempotent no-op (returns null).
  releaseClaim(issueId: string, holder: string, opts?: { activationId?: string; now?: number }): IssueClaim | null {
    this.assertHolder(holder);
    return withTransaction(this.db, () => {
      const now = opts?.now ?? Date.now();
      const open = this.unclosedClaim(issueId);
      if (!open) return null;
      if (!sameHolder(open, holder, opts?.activationId ?? null)) {
        throw new Error(`claim-held: ${issueId} is held by ${open.holder}; only the holder releases (anti-steal)`);
      }
      this.closeClaimRow(open.id, now);
      this.appendEvent(issueId, "claim.released", { claim: open.id, generation: open.generation });
      return { ...open, releasedAt: now };
    });
  }

  getActiveClaim(issueId: string, opts?: { now?: number }): IssueClaim | null {
    this.requireIssue(issueId);
    return this.openClaim(issueId, opts?.now ?? Date.now());
  }

  listClaims(issueId: string): IssueClaim[] {
    this.requireIssue(issueId);
    return rows<Row>(this.db, "SELECT * FROM issue_claims WHERE issue_id = ? ORDER BY id", issueId).map((r) =>
      this.toClaim(r),
    );
  }

  // -- workspace writer leases (PRD §18) ---------------------------------------
  // Distinct from issue claims (§5): at most one live writer per workspace,
  // readers coexist without leases. Coordinator/parent mutation tools call
  // assertCanWrite first and are fenced while a child writer owns the
  // workspace (C21). Lease rows are the audit trail (no per-issue events:
  // leases are workspace-scoped, not issue-scoped).

  acquireWriterLease(
    workspace: string | WorkspaceIdentity,
    holder: string,
    opts?: {
      activationId?: string;
      repositoryRoot?: string;
      branch?: string;
      ttlMs?: number;
      now?: number;
      idempotencyKey?: string;
    },
  ): WorkspaceLease {
    this.assertHolder(holder);
    const key = opts?.idempotencyKey;
    return withTransaction(this.db, () =>
      key
        ? mutateOnce(this.db, "command", key, () =>
            this.acquireLeaseTx(workspace, holder, opts?.activationId, opts?.repositoryRoot, opts?.branch, opts?.ttlMs, opts?.now ?? Date.now()),
          )
        : this.acquireLeaseTx(workspace, holder, opts?.activationId, opts?.repositoryRoot, opts?.branch, opts?.ttlMs, opts?.now ?? Date.now()),
    );
  }

  private acquireLeaseTx(
    workspace: string | WorkspaceIdentity,
    holder: string,
    activationId: string | undefined,
    repositoryRoot: string | undefined,
    branch: string | undefined,
    ttlMs: number | undefined,
    now: number,
  ): WorkspaceLease {
    const key = normalizeWorkspace(workspace);
    if (typeof workspace === "object") {
      repositoryRoot ??= workspace.repositoryRoot;
      branch ??= workspace.branch;
    }
    const open = this.unclosedLease(key);
    if (open) {
      if (isLiveLease(open, now)) {
        if (sameHolder(open, holder, activationId ?? null)) return open;
        throw new Error(`lease-held: workspace ${key} is write-held by ${open.holder} until ${open.expiresAt} (anti-steal)`);
      }
      this.db.prepare("UPDATE workspace_leases SET released_at = ? WHERE id = ?").run(now, open.id);
    }
    const ttl = ttlMs ?? DEFAULT_LEASE_TTL_MS;
    if (!Number.isInteger(ttl) || ttl <= 0) throw new Error("lease ttlMs must be a positive integer");
    const prev = row<{ g: number }>(this.db, "SELECT MAX(generation) AS g FROM workspace_leases WHERE workspace = ?", key);
    const generation = (prev?.g ?? 0) + 1;
    const r = this.db
      .prepare(
        `INSERT INTO workspace_leases
           (workspace, repository_root, branch, holder, activation_id,
            acquired_at, expires_at, released_at, generation)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?) RETURNING id`,
      )
      .get(key, repositoryRoot ?? null, branch ?? null, holder, activationId ?? null, now, now + ttl, generation) as {
      id: number;
    };
    return {
      id: Number(r.id),
      workspace: key,
      repositoryRoot: repositoryRoot ?? null,
      branch: branch ?? null,
      holder,
      activationId: activationId ?? null,
      acquiredAt: now,
      expiresAt: now + ttl,
      releasedAt: null,
      generation,
    };
  }

  renewWriterLease(
    workspace: string | WorkspaceIdentity,
    holder: string,
    opts?: { activationId?: string; ttlMs?: number; now?: number },
  ): WorkspaceLease {
    this.assertHolder(holder);
    return withTransaction(this.db, () => {
      const key = normalizeWorkspace(workspace);
      const now = opts?.now ?? Date.now();
      const open = this.unclosedLease(key);
      if (!open) throw new Error(`no-lease: workspace ${key} has no open writer lease to renew`);
      if (!isLiveLease(open, now)) throw new Error(`lease-expired: workspace ${key} generation ${open.generation} expired; re-acquire`);
      if (!sameHolder(open, holder, opts?.activationId ?? null)) {
        throw new Error(`lease-held: workspace ${key} is write-held by ${open.holder} (anti-steal)`);
      }
      const ttl = opts?.ttlMs ?? DEFAULT_LEASE_TTL_MS;
      if (!Number.isInteger(ttl) || ttl <= 0) throw new Error("lease ttlMs must be a positive integer");
      const expiresAt = now + ttl;
      this.db.prepare("UPDATE workspace_leases SET expires_at = ? WHERE id = ?").run(expiresAt, open.id);
      return { ...open, expiresAt };
    });
  }

  // Holder-only release. No open lease is an idempotent no-op (returns null).
  releaseWriterLease(
    workspace: string | WorkspaceIdentity,
    holder: string,
    opts?: { activationId?: string; now?: number },
  ): WorkspaceLease | null {
    this.assertHolder(holder);
    return withTransaction(this.db, () => {
      const key = normalizeWorkspace(workspace);
      const now = opts?.now ?? Date.now();
      const open = this.unclosedLease(key);
      if (!open) return null;
      if (!sameHolder(open, holder, opts?.activationId ?? null)) {
        throw new Error(`lease-held: workspace ${key} is held by ${open.holder}; only the holder releases (anti-steal)`);
      }
      this.db.prepare("UPDATE workspace_leases SET released_at = ? WHERE id = ?").run(now, open.id);
      return { ...open, releasedAt: now };
    });
  }

  getWriterLease(workspace: string | WorkspaceIdentity, opts?: { now?: number }): WorkspaceLease | null {
    const key = normalizeWorkspace(workspace);
    const open = this.unclosedLease(key);
    const now = opts?.now ?? Date.now();
    return open && isLiveLease(open, now) ? open : null;
  }

  listWorkspaceLeases(workspace?: string | WorkspaceIdentity): WorkspaceLease[] {
    const rs = workspace === undefined
      ? rows<Row>(this.db, "SELECT * FROM workspace_leases ORDER BY id")
      : rows<Row>(this.db, "SELECT * FROM workspace_leases WHERE workspace = ? ORDER BY id", normalizeWorkspace(workspace));
    return rs.map((r) => this.toLease(r));
  }

  // -- read/write authority helpers (PRD §§5, 18) -------------------------------
  // Readers coexist without leases; writers are exclusive. Mutation-capable
  // tools (coordinator included) must pass assertCanWrite before mutating.

  holdsWriterLease(
    workspace: string | WorkspaceIdentity,
    holder: string,
    opts?: { activationId?: string; now?: number },
  ): boolean {
    const live = this.getWriterLease(workspace, opts);
    return live !== null && sameHolder(live, holder, opts?.activationId ?? null);
  }

  assertCanWrite(
    workspace: string | WorkspaceIdentity,
    holder: string,
    opts?: { activationId?: string; now?: number },
  ): void {
    const key = normalizeWorkspace(workspace);
    const live = this.getWriterLease(key, opts);
    if (!live) throw new Error(`lease-fenced: workspace ${key} has no live writer lease held by ${holder}`);
    if (!sameHolder(live, holder, opts?.activationId ?? null)) {
      throw new Error(`lease-fenced: workspace ${key} is write-held by ${live.holder}; ${holder} is fenced (C21)`);
    }
  }

  // Read authority is unconditional: N readers coexist with the writer (C20).
  canReadWorkspace(): boolean {
    return true;
  }

  private assertHolder(holder: string): void {
    if (!holder.trim()) throw new Error("claim/lease holder must be non-empty");
  }

  // Latest unreleased row, regardless of expiry. Liveness is derived by the
  // caller via isLiveClaim/isLiveLease — never a stored flag.
  private unclosedClaim(issueId: string): IssueClaim | null {
    const r = row<Row>(this.db, "SELECT * FROM issue_claims WHERE issue_id = ? AND released_at IS NULL ORDER BY id DESC LIMIT 1", issueId);
    return r ? this.toClaim(r) : null;
  }

  private openClaim(issueId: string, now: number): IssueClaim | null {
    const c = this.unclosedClaim(issueId);
    return c && isLiveClaim(c, now) ? c : null;
  }

  private closeClaimRow(id: number, now: number): void {
    this.db.prepare("UPDATE issue_claims SET released_at = ? WHERE id = ? AND released_at IS NULL").run(now, id);
  }

  private unclosedLease(workspace: string): WorkspaceLease | null {
    const r = row<Row>(
      this.db,
      "SELECT * FROM workspace_leases WHERE workspace = ? AND released_at IS NULL ORDER BY id DESC LIMIT 1",
      workspace,
    );
    return r ? this.toLease(r) : null;
  }

  private toClaim(r: Row): IssueClaim {
    return {
      id: r["id"] as number,
      issueId: r["issue_id"] as string,
      issueRevision: r["issue_revision"] as number,
      contractHash: r["contract_hash"] as string,
      holder: r["holder"] as string,
      activationId: (r["activation_id"] as string | null) ?? null,
      acquiredAt: r["acquired_at"] as number,
      expiresAt: r["expires_at"] as number,
      releasedAt: (r["released_at"] as number | null) ?? null,
      generation: r["generation"] as number,
    };
  }

  private toLease(r: Row): WorkspaceLease {
    return {
      id: r["id"] as number,
      workspace: r["workspace"] as string,
      repositoryRoot: (r["repository_root"] as string | null) ?? null,
      branch: (r["branch"] as string | null) ?? null,
      holder: r["holder"] as string,
      activationId: (r["activation_id"] as string | null) ?? null,
      acquiredAt: r["acquired_at"] as number,
      expiresAt: r["expires_at"] as number,
      releasedAt: (r["released_at"] as number | null) ?? null,
      generation: r["generation"] as number,
    };
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
  // Every transition emits a durable issue.lifecycle event (§26) carrying
  // the from/to pair so lineage is explicit for all five states.
  setLifecycleState(issueId: string, state: LifecycleState): ResolvedIssue {
    if (!(LIFECYCLE_STATES as readonly string[]).includes(state)) throw new Error(`unknown lifecycle state: ${state}`);
    return withTransaction(this.db, () => {
      const before = this.requireIssue(issueId);
      const now = Date.now();
      this.db.prepare("UPDATE issues SET lifecycle_state = ?, updated_at = ? WHERE id = ?").run(state, now, issueId);
      this.appendEvent(issueId, "issue.lifecycle", { from: before.lifecycleState, to: state });
      return this.view(issueId);
    });
  }
}
