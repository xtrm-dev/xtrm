import type { DatabaseSync, SQLInputValue } from "../store/database.ts";
import { LinkGateService, type GateExemption, type GateMode } from "./link-gate-service.ts";
import { openBlockerRefusal } from "./open-blocker-refusal.ts";
import {
  ISSUE_KINDS,
  LIFECYCLE_STATES,
  TERMINAL_STATES,
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
  normaliseContract,
  validateContextRefs,
  validateOwnership,
  type ContractRepair,
  type WorkContract,
} from "../domain/contract.ts";
import {
  TERMINAL_LIFECYCLE,
  deriveReadiness,
  isBlockerSatisfied,
  resolveInheritedContext,
  scopeCovers,
  type ContextRef,
  type ReadinessAttestation,
  type ReadinessReport,
  type ResolvedContext,
} from "../domain/readiness.ts";
import {
  CURSOR_VERSION,
  MAX_DERIVED_SCAN,
  MAX_PAGE_LIMIT,
  SCAN_CHUNK,
  clampPageLimit,
  decodeCursor,
  encodeCursor,
  queryFilterFingerprint,
  type BoardOrderKey,
  type IssueBoardPage,
  type IssueBoardRow,
  type IssueQuery,
} from "../domain/board.ts";
import { EDGE_KINDS, wouldCreateCycle, type EdgeKind } from "../domain/edge.ts";
import { DEFAULT_CLAIM_TTL_MS, isLiveClaim, sameHolder, type IssueClaim,
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

function ph(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * Authority for Issue rows, revisions, claims, attestations and edges: every
 * durable Issue mutation lands here against the WAL store, which is the single
 * durable authority shared by sb, MCP, Pi and hooks. Side effects are
 * transactional SQLite writes plus one issue.* event row per mutation.
 * Title/priority writes are metadata (no revision, readiness retained);
 * contract, ownership, context-refs and scrutiny writes mint a new revision
 * and invalidate prior readiness and attestation. Reads derive readiness live,
 * so readiness never goes stale on a read. Automatic metadata: revision rows
 * stamp author, contract hash and timestamp; claims stamp holder, activation,
 * generation and expiry. Mutations are idempotent under idempotency keys and
 * same-holder reclaim; cross-holder steal, revision conflicts and unknown refs
 * fail closed with errors, never partial writes.
 */
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

  // Low-level administration read (ADR sbcloseout4 §18): every project row
  // for `sb project list`. Read-only; resolution policy lives in
  // resolveProject, not here.
  listProjects(): Project[] {
    return rows<Row>(this.db, "SELECT id, prefix, name, created_at FROM projects ORDER BY id").map((p) => ({
      id: p["id"] as string,
      prefix: p["prefix"] as string,
      name: p["name"] as string,
      createdAt: p["created_at"] as number,
    }));
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

  // Project precedence (ADR sbcloseout4 §4): explicit flag > SUBSTRATE_PROJECT
  // env > initialized repository identity (repository_bindings by derived
  // repositoryKey) > explicit checkout link (local alias/cache) > fail closed.
  // Global database cardinality is never evidence (ADR §5): there is no
  // `projects.length === 1` shortcut, so an unrelated uninitialized repository
  // can never read or mutate another Project's Issues by accident. The caller
  // discovers the Git common root and derives the repository key (presentation
  // edge); the mapping reads stay here so resolution is always live.
  resolveProject(input: {
    explicit?: string;
    env?: string;
    gitRoot?: string | null;
    repositoryKey?: string | null;
  }): { projectId: string; source: "flag" | "env" | "binding" | "link" } {
    if (input.explicit !== undefined) return { projectId: this.getProject(input.explicit).id, source: "flag" };
    if (input.env !== undefined && input.env.trim() !== "") return { projectId: this.getProject(input.env.trim()).id, source: "env" };
    const repositoryKey = (input.repositoryKey ?? "").trim();
    if (repositoryKey !== "") {
      const bound = this.matchRepositoryBinding(repositoryKey);
      if (bound !== null) {
        try {
          return { projectId: this.getProject(bound).id, source: "binding" };
        } catch {
          throw new Error(
            `repository ${repositoryKey} is bound to missing project ${bound}: repair the repository binding or re-run \`sb init\``,
          );
        }
      }
    }
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
    // Fail closed with the reason and the repair action (ADR §§5, 85).
    const override = "or pass --project <id> / set SUBSTRATE_PROJECT for a deliberate cross-project override";
    if (repositoryKey !== "") {
      throw new Error(
        `this repository is not initialized for Substrate: no repository binding for ${repositoryKey}. ` +
          `Run \`sb init\` to bind this repository to a Project, ${override}`,
      );
    }
    if (input.gitRoot) {
      throw new Error(
        `this checkout is not initialized for Substrate: no repository binding or checkout link for ${input.gitRoot}. ` +
          `Run \`sb init\` from inside the repository to bind it to a Project, ${override}`,
      );
    }
    throw new Error(
      "no project selected and the working directory is not inside a Git checkout: Run `sb init` from inside the repository, " +
        override,
    );
  }

  // Repository binding read (migration 008): the canonical authority for
  // repository -> Project (ADR §13). The caller derives the repository key;
  // this read stays live so a re-init or repair is visible immediately.
  private matchRepositoryBinding(repositoryKey: string): string | null {
    const r = row<Row>(this.db, "SELECT project_id FROM repository_bindings WHERE repository_key = ?", repositoryKey);
    return r ? (r["project_id"] as string) : null;
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

  /** Pins the seven-field contract at write time as revision 1; identical retry under one idempotency key returns the first row. */
  createIssue(input: CreateIssueInput, opts?: { idempotencyKey?: string }): ResolvedIssue {
    return this.createIssueAt(input, {}, opts);
  }

  /**
   * Import-shaped creation (XTRM-406): pins SOURCE time on the issue row, its
   * first revision, its creation event, its alias and its parent link, so an
   * imported board reports the history it actually has instead of the import
   * instant.
   *
   * Deliberately NOT a parameter on `createIssue`. A backdating primitive on
   * the ordinary creation path would hand every caller the ability to forge
   * history; the seam is named for its only legitimate caller, the Beads
   * compatibility layer, and follows the `BeadsClosureInput.closedAt`
   * precedent.
   *
   * `createdAt` absent means now. `updatedAt` is clamped up to the effective
   * `createdAt` so a contradictory source record cannot store a row whose
   * updated_at precedes its created_at.
   */
  createIssueFromImport(
    input: CreateIssueInput,
    source: { createdAt?: number | null; updatedAt?: number | null },
    opts?: { idempotencyKey?: string },
  ): ResolvedIssue {
    return this.createIssueAt(input, source, opts);
  }

  private createIssueAt(
    input: CreateIssueInput,
    source: { createdAt?: number | null; updatedAt?: number | null },
    opts?: { idempotencyKey?: string },
  ): ResolvedIssue {
    // A prose validation/output entry is repaired here, once, below every
    // caller (CLI, MCP, Pi, Beads import): the stored contract is the
    // normalised one, so a contract that creates also passes readiness
    // (XTRM-786). An entry that cannot be repaired unambiguously is refused
    // with the field, the entry and the expected shape named.
    const contract = normaliseContract(input.contract).contract;
    assertContractShape(contract);
    if (!input.title.trim()) throw new Error("title must be non-empty");
    if (!(ISSUE_KINDS as readonly string[]).includes(input.kind)) throw new Error(`unknown kind: ${input.kind}`);
    const project = this.getProject(input.projectId);
    if (input.parentId) this.requireIssue(input.parentId);
    const normalised = { ...input, contract };
    const key = opts?.idempotencyKey;
    return withTransaction(this.db, () =>
      key
        ? mutateOnce(this.db, "command", key, () => this.insertIssue(project, normalised, source))
        : this.insertIssue(project, normalised, source),
    );
  }

  private insertIssue(
    project: Project,
    input: CreateIssueInput,
    source: { createdAt?: number | null; updatedAt?: number | null } = {},
  ): ResolvedIssue {
    const now = Date.now();
    // Source time when the caller supplies it (import path), wall-clock
    // otherwise. updated_at never precedes created_at.
    const createdAt = source.createdAt ?? now;
    const updatedAt = Math.max(createdAt, source.updatedAt ?? createdAt);
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
      .run(id, project.id, humanNumber, input.kind, input.title, input.priority ?? 0, input.scrutiny ?? "", contractHash, createdAt, updatedAt);
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
        createdAt,
      );
    this.appendEvent(id, "issue.created", { humanRef: formatHumanRef(project.prefix, humanNumber) }, createdAt);
    for (const a of input.aliases ?? []) this.insertAlias(id, a.alias, a.kind, createdAt);
    if (input.parentId) this.linkParent(id, input.parentId, createdAt);
    return this.view(id);
  }

  // Revision-on-contract-change (PRD §10): identical contract is a no-op.
  // Revision metadata (ownership/contextRefs) carries forward unless the
  // caller overrides it; the new revision revalidates structurally at read.
  /**
   * Revision-bearing write: changed contracts mint a new revision and invalidate
   * readiness; byte-identical contracts are a no-op.
   *
   * `opts.repair` defaults to true and is what XTRM-786 added: a contract the
   * caller SUPPLIED is normalised before it is stored. A metadata-only edit —
   * ownership or contextRefs — carries the STORED contract forward and passes
   * `repair: false`: repairing there would silently rewrite a contract pinned
   * before XTRM-786 (or newly refuse one whose entries were already empty), which
   * is neither the caller's intent nor the Issue's scope. `repairs` carries what
   * was normalised so no caller has to do it silently.
   */
  updateContract(
    issueId: string,
    contract: WorkContract,
    authoredBy: string,
    opts?: { expectedRevision?: number; idempotencyKey?: string; ownership?: unknown; contextRefs?: unknown[]; repair?: boolean },
  ): { issue: ResolvedIssue; created: boolean; repairs: ContractRepair[] } {
    const { contract: stored, repairs } = opts?.repair === false ? { contract, repairs: [] as ContractRepair[] } : normaliseContract(contract);
    assertContractShape(stored);
    const key = opts?.idempotencyKey;
    const written = withTransaction(this.db, () =>
      key
        ? mutateOnce(this.db, "command", key, () =>
            this.revise(issueId, stored, authoredBy, opts?.expectedRevision, opts?.ownership, opts?.contextRefs),
          )
        : this.revise(issueId, stored, authoredBy, opts?.expectedRevision, opts?.ownership, opts?.contextRefs),
    );
    return { ...written, repairs };
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

  // Ref-scoped mutation guard (ADR §5): the resolved Issue must belong to the
  // effective project context. An explicit ref is not a context override — a
  // ref from another Project is refused unless the caller selected that
  // Project deliberately (--project / SUBSTRATE_PROJECT).
  resolveRefInProject(ref: string, projectId: string): ResolvedIssue {
    const issue = this.resolveRef(ref);
    if (issue.projectId !== projectId) {
      throw new Error(
        `ref ${ref} belongs to project ${issue.projectId}, not the effective project ${projectId}: ` +
          `pass --project ${issue.projectId} to act on it deliberately`,
      );
    }
    return issue;
  }

  getIssue(id: string): ResolvedIssue {
    return this.view(id);
  }

  listIssues(projectId: string): ResolvedIssue[] {
    return rows<Row>(this.db, "SELECT id FROM issues WHERE project_id = ? ORDER BY human_number", projectId).map((r) =>
      this.view(r["id"] as string),
    );
  }

  // -- bounded board read model (XTRM-393) ----------------------------------
  //
  // One page costs a bounded number of statements regardless of how many
  // issues the project holds: the page rows, their current revisions, latest
  // attestations, active blockers, open claims, children, and a level-by-level
  // ancestor walk for locators. Readiness is derived by the same pure
  // `deriveReadiness` the per-issue path calls, so batched and per-issue
  // values cannot drift; only the loading changed.
  /** Bounded, paged board projection: board fields plus derived readiness, no full hydration. */
  queryIssues(query: IssueQuery, opts?: { now?: number }): IssueBoardPage {
    const now = opts?.now ?? Date.now();
    const limit = clampPageLimit(query.limit);
    const filter = queryFilterFingerprint(query);
    const project = this.getProject(query.project);
    const readinessFilter = query.readiness?.length ? new Set<string>(query.readiness) : null;
    // A derived predicate cannot be pushed into SQL, so it scans in chunks;
    // the query without it fetches the page plus ONE lookahead row, so
    // `hasMore` is exact rather than a guess (XTRM-540 defect).
    const fetchSize = readinessFilter ? SCAN_CHUNK : limit + 1;

    let after: BoardOrderKey | null = query.cursor
      ? decodeCursor(query.cursor, { project: query.project, filter }).key
      : null;
    const out: IssueBoardRow[] = [];
    let scanned = 0;
    let truncated = false;
    let hasMore = false;
    let lastKey: BoardOrderKey | null = null;
    let scanKey: BoardOrderKey | null = null;

    const matchesFilter = (row: IssueBoardRow): boolean => !readinessFilter || readinessFilter.has(row.readinessState);
    for (;;) {
      const candidates = this.boardCandidates(query, after, fetchSize);
      if (candidates.length === 0) break;
      scanned += candidates.length;
      const staged = this.boardRows(candidates, project.prefix, now);
      let lastEmitted = -1;
      for (let i = 0; i < staged.length; i += 1) {
        const row = staged[i]!;
        if (!matchesFilter(row)) continue;
        out.push(row);
        lastEmitted = i;
        lastKey = [candidates[i]!["human_number"] as number, row.id];
        if (out.length === limit) break;
      }
      const tail = candidates[candidates.length - 1]!;
      after = [tail["human_number"] as number, tail["id"] as string];
      scanKey = after;
      if (out.length === limit) {
        // `hasMore` must mean "another row can be emitted", not "the page is
        // full". The unfiltered path fetched one row past the page, so a
        // surviving row there is direct evidence; a full batch also leaves
        // rows unexamined, which is the conservative answer for a derived
        // predicate whose remaining candidates have not been derived yet.
        hasMore = staged.slice(lastEmitted + 1).some(matchesFilter) || candidates.length === fetchSize;
        break;
      }
      if (candidates.length < fetchSize) break;
      if (readinessFilter && scanned >= MAX_DERIVED_SCAN) {
        truncated = true;
        hasMore = true;
        break;
      }
    }

    // A truncated derived scan advances from the last SCANNED candidate, not
    // the last emitted row: every scanned-but-rejected candidate was already
    // derived, so skipping it is correct, and it is the only way a page that
    // emitted nothing can still hand the caller a resumable cursor.
    const resumeKey = truncated ? scanKey : lastKey;
    return {
      rows: out,
      nextCursor:
        hasMore && resumeKey
          ? encodeCursor({ v: CURSOR_VERSION, project: query.project, filter, key: [resumeKey[0], resumeKey[1]] })
          : null,
      hasMore,
      scanned,
      truncated,
    };
  }

  /** Walk every page of a board query. Board consumers that must stay
   * exhaustive (the CLI's `issue list`/`issue ready`, MCP's list/ready, the Pi
   * search) use this instead of a single page, so their output is unchanged
   * while the per-issue reads disappear. `maxRows` fails closed rather than
   * looping forever on a store that keeps growing under the cursor. */
  queryAllIssues(query: IssueQuery, opts?: { now?: number; maxRows?: number }): IssueBoardRow[] {
    const maxRows = opts?.maxRows ?? 500_000;
    const out: IssueBoardRow[] = [];
    let cursor: string | null = query.cursor ?? null;
    for (;;) {
      const page = this.queryIssues({ ...query, cursor, limit: MAX_PAGE_LIMIT }, opts);
      out.push(...page.rows);
      if (out.length > maxRows) throw new Error(`board query exceeded maxRows (${maxRows})`);
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
      if (page.rows.length === 0 && page.truncated) continue;
      if (page.rows.length === 0) break;
    }
    return out;
  }

  private boardCandidates(query: IssueQuery, after: BoardOrderKey | null, size: number): Row[] {
    const where: string[] = ["i.project_id = ?"];
    const params: SQLInputValue[] = [query.project];
    if (query.lifecycle?.length) {
      where.push(`i.lifecycle_state IN (${ph(query.lifecycle.length)})`);
      params.push(...query.lifecycle);
    }
    if (query.kind?.length) {
      where.push(`i.kind IN (${ph(query.kind.length)})`);
      params.push(...query.kind);
    }
    const search = (query.search ?? "").trim();
    if (search) {
      where.push("instr(lower(i.title), lower(?)) > 0");
      params.push(search);
    }
    if (query.parent === null) {
      where.push(
        "NOT EXISTS (SELECT 1 FROM issue_edges e WHERE e.to_issue = i.id AND e.kind = 'parent_child' AND e.active = 1)",
      );
    } else if (query.parent !== undefined) {
      where.push(
        "EXISTS (SELECT 1 FROM issue_edges e WHERE e.to_issue = i.id AND e.kind = 'parent_child' AND e.active = 1 AND e.from_issue = ?)",
      );
      params.push(query.parent);
    }
    if (after) {
      // Keyset pagination over the FULL ordering tuple: the tiebreaker keeps
      // equal sort keys from skipping or repeating rows.
      where.push("(i.human_number > ? OR (i.human_number = ? AND i.id > ?))");
      params.push(after[0], after[0], after[1]);
    }
    params.push(size);
    return rows<Row>(
      this.db,
      `SELECT i.* FROM issues i WHERE ${where.join(" AND ")} ORDER BY i.human_number, i.id LIMIT ?`,
      ...params,
    );
  }

  private boardRows(issueRows: Row[], prefix: string, now: number): IssueBoardRow[] {
    const ids = issueRows.map((r) => r["id"] as string);
    const revisions = this.batchCurrentRevisions(ids);
    const attestations = this.batchLatestAttestations(ids);
    const blockers = this.batchBlockers(ids);
    const claimed = this.batchOpenClaims(ids, now);
    const locators = this.batchLocators(ids);
    const children = this.batchChildren(ids);
    const journal = this.batchJournalActivity(ids);

    return issueRows.map((r) => {
      const id = r["id"] as string;
      const revision = r["current_revision"] as number;
      const rev = revisions.get(id);
      // The per-issue path throws on a missing revision; fail the same way
      // rather than deriving readiness from a partial row.
      if (!rev) throw new Error(`unknown revision ${id}#${revision}`);
      const own = (blockers.get(id) ?? []).filter((b) => b.lifecycle === null || !isBlockerSatisfied(b.lifecycle));
      const report = deriveReadiness({
        issueId: id,
        revision,
        contractHash: r["current_contract_hash"] as string,
        contract: rev.contract,
        scrutiny: r["scrutiny"] as string,
        ownership: rev.ownership,
        contextRefs: rev.contextRefs,
        lifecycleState: r["lifecycle_state"] as string,
        deferUntil: (r["defer_until"] as number | null) ?? null,
        attestation: attestations.get(id) ?? null,
        unsatisfiedBlockers: own.map((b) => b.id),
        now,
        hasActiveClaim: claimed.has(id),
      });
      const locator = locators.get(id);
      const humanRef = formatHumanRef(prefix, r["human_number"] as number);
      const activity = journal.get(id);
      const attestation = attestations.get(id) ?? null;
      const updatedAt = r["updated_at"] as number;
      return {
        id,
        humanRef,
        locator: locator?.locator ?? humanRef,
        title: r["title"] as string,
        kind: r["kind"] as IssueKind,
        lifecycleState: r["lifecycle_state"] as LifecycleState,
        priority: r["priority"] as number,
        scrutiny: r["scrutiny"] as string,
        revision,
        readinessState: report.state,
        dispatchable: report.dispatchable,
        claimState: claimed.has(id) ? "claimed" : "none",
        parentRef: locator?.parentRef ?? null,
        parentLocator: locator?.parentLocator ?? null,
        childCount: children.get(id)?.count ?? 0,
        childrenTerminal: children.get(id)?.terminal ?? 0,
        blockedBy: own.map((b) => b.ref),
        createdAt: r["created_at"] as number,
        updatedAt,
        journalCount: activity?.count ?? 0,
        pointerCount: activity?.pointers ?? 0,
        lastActivityAt: Math.max(updatedAt, activity?.lastAt ?? 0),
        attestationState: !attestation
          ? "none"
          : report.attestationCurrent
            ? "current"
            : attestation.outcome === "reject" && attestation.issueRevision === revision
              ? "rejected"
              : "stale",
        structurallyValid: report.structurallyValid,
      };
    });
  }

  // Journal aggregates per issue, in one statement. A journal write never
  // touches `issues.updated_at`, so the board reads activity from here.
  private batchJournalActivity(ids: string[]): Map<string, { count: number; pointers: number; lastAt: number }> {
    const out = new Map<string, { count: number; pointers: number; lastAt: number }>();
    if (ids.length === 0) return out;
    for (const r of rows<Row>(
      this.db,
      `SELECT issue_id, COUNT(*) AS n, MAX(created_at) AS last_at,
              SUM(CASE WHEN json_valid(refs_json) THEN json_array_length(refs_json) ELSE 0 END) AS pointers
         FROM issue_journal WHERE issue_id IN (${ph(ids.length)}) GROUP BY issue_id`,
      ...ids,
    )) {
      out.set(r["issue_id"] as string, { count: r["n"] as number, pointers: r["pointers"] as number, lastAt: r["last_at"] as number });
    }
    return out;
  }

  // Latest attestation per issue, in one statement (the per-issue path takes
  // ORDER BY id DESC LIMIT 1, which is the same row).
  private batchLatestAttestations(ids: string[]): Map<string, ReadinessAttestation> {
    const out = new Map<string, ReadinessAttestation>();
    if (ids.length === 0) return out;
    for (const r of rows<Row>(
      this.db,
      `SELECT a.* FROM readiness_attestations a
         JOIN (SELECT issue_id, MAX(id) AS max_id FROM readiness_attestations
                WHERE issue_id IN (${ph(ids.length)}) GROUP BY issue_id) latest
           ON latest.issue_id = a.issue_id AND latest.max_id = a.id`,
      ...ids,
    )) {
      out.set(r["issue_id"] as string, this.toAttestation(r));
    }
    return out;
  }

  // Current revision per issue, joined on the issue's own revision pointer.
  private batchCurrentRevisions(
    ids: string[],
  ): Map<string, { contract: unknown; ownership: unknown; contextRefs: unknown[] }> {
    const out = new Map<string, { contract: unknown; ownership: unknown; contextRefs: unknown[] }>();
    if (ids.length === 0) return out;
    for (const r of rows<Row>(
      this.db,
      `SELECT r.issue_id, r.contract_json, r.ownership_json, r.context_refs_json
         FROM issue_revisions r
         JOIN issues i ON i.id = r.issue_id AND i.current_revision = r.revision
        WHERE r.issue_id IN (${ph(ids.length)})`,
      ...ids,
    )) {
      out.set(r["issue_id"] as string, {
        contract: JSON.parse(r["contract_json"] as string),
        ownership: r["ownership_json"] == null ? null : JSON.parse(r["ownership_json"] as string),
        contextRefs: JSON.parse((r["context_refs_json"] as string) ?? "[]"),
      });
    }
    return out;
  }

  // Active blockers with their current lifecycle, ordered by blocker id: the
  // same order and the same satisfaction rule as unsatisfiedBlockers. A LEFT
  // JOIN keeps a dangling blocker visible as unsatisfied instead of dropping
  // it (the per-issue path treats an unreadable blocker as unsatisfied).
  private batchBlockers(ids: string[]): Map<string, Array<{ id: string; ref: string; lifecycle: string | null }>> {
    const out = new Map<string, Array<{ id: string; ref: string; lifecycle: string | null }>>();
    if (ids.length === 0) return out;
    for (const r of rows<Row>(
      this.db,
      `SELECT e.to_issue, e.from_issue, b.lifecycle_state, b.human_number, b.project_id, p.prefix
         FROM issue_edges e
         LEFT JOIN issues b ON b.id = e.from_issue
         LEFT JOIN projects p ON p.id = b.project_id
        WHERE e.kind = 'blocks' AND e.active = 1 AND e.to_issue IN (${ph(ids.length)})
        ORDER BY e.to_issue, e.from_issue`,
      ...ids,
    )) {
      const target = r["to_issue"] as string;
      const blockerId = r["from_issue"] as string;
      const number = r["human_number"] as number | null;
      const ref = number === null ? blockerId : formatHumanRef(r["prefix"] as string, number);
      out.set(target, [...(out.get(target) ?? []), { id: blockerId, ref, lifecycle: (r["lifecycle_state"] as string | null) ?? null }]);
    }
    return out;
  }

  // Latest unclosed claim per issue, then the liveness check: identical to
  // unclosedClaim + isLiveClaim, evaluated in memory.
  private batchOpenClaims(ids: string[], now: number): Set<string> {
    const out = new Set<string>();
    if (ids.length === 0) return out;
    const seen = new Set<string>();
    for (const r of rows<Row>(
      this.db,
      `SELECT * FROM issue_claims WHERE issue_id IN (${ph(ids.length)}) AND released_at IS NULL ORDER BY issue_id, id DESC`,
      ...ids,
    )) {
      const claim = this.toClaim(r);
      if (seen.has(claim.issueId)) continue;
      seen.add(claim.issueId);
      if (isLiveClaim(claim, now)) out.add(claim.issueId);
    }
    return out;
  }

  // Children counts per issue, with terminal children counted the same way the
  // board counted them (done/cancelled/archived).
  private batchChildren(ids: string[]): Map<string, { count: number; terminal: number }> {
    const out = new Map<string, { count: number; terminal: number }>();
    if (ids.length === 0) return out;
    for (const r of rows<Row>(
      this.db,
      `SELECT e.from_issue, b.lifecycle_state
         FROM issue_edges e
         JOIN issues b ON b.id = e.to_issue
        WHERE e.kind = 'parent_child' AND e.active = 1 AND e.from_issue IN (${ph(ids.length)})`,
      ...ids,
    )) {
      const parent = r["from_issue"] as string;
      const cur = out.get(parent) ?? { count: 0, terminal: 0 };
      cur.count += 1;
      if ((TERMINAL_LIFECYCLE as readonly string[]).includes(r["lifecycle_state"] as string)) cur.terminal += 1;
      out.set(parent, cur);
    }
    return out;
  }

  // Locators for a page, resolved a level at a time: the ancestor walk costs
  // one statement per level, never one per issue (currentLocator walks the
  // parent chain per issue, which is the same N+1 in a different shape).
  private batchLocators(
    ids: string[],
  ): Map<string, { locator: string; parentRef: string | null; parentLocator: string | null }> {
    const out = new Map<string, { locator: string; parentRef: string | null; parentLocator: string | null }>();
    if (ids.length === 0) return out;
    const parentOf = new Map<string, { from: string; slot: number }>();
    let frontier = [...ids];
    while (frontier.length > 0) {
      const found = rows<Row>(
        this.db,
        `SELECT to_issue, from_issue, child_slot FROM issue_edges
          WHERE kind = 'parent_child' AND active = 1 AND to_issue IN (${ph(frontier.length)})`,
        ...frontier,
      );
      const next: string[] = [];
      for (const r of found) {
        const child = r["to_issue"] as string;
        if (parentOf.has(child)) continue;
        const from = r["from_issue"] as string;
        parentOf.set(child, { from, slot: r["child_slot"] as number });
        next.push(from);
      }
      frontier = next;
    }

    const needed = new Set<string>(ids);
    for (const [child, parent] of parentOf) {
      needed.add(child);
      needed.add(parent.from);
    }
    const meta = new Map<string, { number: number; projectId: string }>();
    for (const r of rows<Row>(
      this.db,
      `SELECT id, human_number, project_id FROM issues WHERE id IN (${ph(needed.size)})`,
      ...needed,
    )) {
      meta.set(r["id"] as string, { number: r["human_number"] as number, projectId: r["project_id"] as string });
    }
    const projectIds = [...new Set([...meta.values()].map((m) => m.projectId))];
    const prefixes = new Map<string, string>();
    if (projectIds.length > 0) {
      for (const r of rows<Row>(
        this.db,
        `SELECT id, prefix FROM projects WHERE id IN (${ph(projectIds.length)})`,
        ...projectIds,
      )) {
        prefixes.set(r["id"] as string, r["prefix"] as string);
      }
    }
    const refOf = (id: string): string => {
      const m = meta.get(id);
      return m ? formatHumanRef(prefixes.get(m.projectId) ?? "", m.number) : id;
    };
    const locatorOf = (id: string): string => {
      const slots: number[] = [];
      const seen = new Set<string>([id]);
      let cur = id;
      for (;;) {
        const edge = parentOf.get(cur);
        if (!edge) break;
        slots.unshift(edge.slot);
        cur = edge.from;
        if (seen.has(cur)) throw new Error(`fail-closed: parent cycle detected at ${cur}`);
        seen.add(cur);
      }
      const rootRef = refOf(cur);
      return slots.length === 0 ? rootRef : `${rootRef}.${slots.join(".")}`;
    };
    for (const id of ids) {
      const parent = parentOf.get(id);
      out.set(id, {
        locator: locatorOf(id),
        parentRef: parent ? refOf(parent.from) : null,
        parentLocator: parent ? locatorOf(parent.from) : null,
      });
    }
    return out;
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
  appendEvent(issueId: string, type: string, payload: unknown, at?: number): number {
    // `at` lets the import path cite source time; every other caller keeps
    // wall-clock, so the ordinary event spine is unchanged (XTRM-406).
    const r = this.db
      .prepare("INSERT INTO issue_events (issue_id, type, payload_json, created_at) VALUES (?, ?, ?, ?) RETURNING id")
      .get(issueId, type, JSON.stringify(payload ?? {}), at ?? Date.now()) as { id: number };
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
      // First-class Closure carry-over (C1): immutable closure rows plus
      // the durable attempt history travel with the snapshot so verifiers
      // can confirm closure survival without per-issue reads. Additive:
      // importProject ignores unknown keys, and old snapshots without
      // these keys import cleanly (missing reads as empty).
      closures: this.exportClosures(projectId),
      closureAttempts: this.exportClosureAttempts(projectId),
      counters: {
        humanRefNext:
          (row<Row>(this.db, "SELECT next_val FROM seq_counters WHERE namespace = 'human_ref' AND name = ?", projectId)?.["next_val"] as number | undefined) ??
          1,
      },
    };
  }

  // Closure snapshot reads (C1): raw rows cross verbatim; the
  // ClosureService re-validates on read. Missing tables (a snapshot path
  // that predates migration 011) read as empty rather than failing the
  // whole export.
  private exportClosures(projectId: string): unknown[] {
    try {
      return rows<Row>(
        this.db,
        `SELECT c.* FROM issue_closures c JOIN issues i ON i.id = c.issue_id WHERE i.project_id = ? ORDER BY c.closed_at, c.closure_id`,
        projectId,
      );
    } catch {
      return [];
    }
  }

  private exportClosureAttempts(projectId: string): unknown[] {
    try {
      return rows<Row>(
        this.db,
        `SELECT a.* FROM closure_attempts a JOIN issues i ON i.id = a.issue_id WHERE i.project_id = ? ORDER BY a.id`,
        projectId,
      );
    } catch {
      return [];
    }
  }

  importProject(snapshot: Record<string, unknown>): void {
    const data = snapshot as {
      project: Project;
      issues: Array<{ issue: Issue; revisions: IssueRevision[]; aliases: Array<{ alias: string; kind: string }>; locatorHistory: string[] }>;
      edges: StoredEdge[];
      closures?: Array<Record<string, unknown>>;
      closureAttempts?: Array<Record<string, unknown>>;
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
      // Closure restore (C1): rows cross verbatim, INSERT OR IGNORE so a
      // re-import never duplicates history. Attempts reference closures by
      // id, so closures restore first.
      for (const c of data.closures ?? []) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO issue_closures
               (closure_id, issue_id, issue_revision, contract_hash, terminal_state, outcome,
                reason, actor, execution_context_json, validation_refs_json,
                journal_result_refs_json, receipt_refs_json, artifact_refs_json,
                source, legacy_state, closed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            c["closure_id"] as SQLInputValue,
            c["issue_id"] as SQLInputValue,
            c["issue_revision"] as SQLInputValue,
            c["contract_hash"] as SQLInputValue,
            c["terminal_state"] as SQLInputValue,
            c["outcome"] as SQLInputValue,
            c["reason"] as SQLInputValue,
            c["actor"] as SQLInputValue,
            c["execution_context_json"] as SQLInputValue,
            c["validation_refs_json"] as SQLInputValue,
            c["journal_result_refs_json"] as SQLInputValue,
            c["receipt_refs_json"] as SQLInputValue,
            c["artifact_refs_json"] as SQLInputValue,
            c["source"] as SQLInputValue,
            c["legacy_state"] as SQLInputValue,
            c["closed_at"] as SQLInputValue,
          );
      }
      for (const a of data.closureAttempts ?? []) {
        this.db
          .prepare(
            `INSERT INTO closure_attempts (issue_id, kind, status, outcome, reason, error, closure_id, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM closure_attempts WHERE issue_id = ? AND kind = ? AND status = ? AND created_at = ?)`,
          )
          .run(
            a["issue_id"] as SQLInputValue,
            a["kind"] as SQLInputValue,
            a["status"] as SQLInputValue,
            a["outcome"] as SQLInputValue,
            a["reason"] as SQLInputValue,
            a["error"] as SQLInputValue,
            a["closure_id"] as SQLInputValue,
            a["created_at"] as SQLInputValue,
            a["issue_id"] as SQLInputValue,
            a["kind"] as SQLInputValue,
            a["status"] as SQLInputValue,
            a["created_at"] as SQLInputValue,
          );
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
    // The stored contract is carried forward, not supplied (XTRM-786 review):
    // an ownership edit must not rewrite or newly refuse it.
    const { issue: next } = this.updateContract(issueId, current.contract as WorkContract, authoredBy, { ownership, repair: false });
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
    // Stored contract carried forward, not supplied: no repair (XTRM-786 review).
    const { issue: next } = this.updateContract(issueId, current.contract as WorkContract, authoredBy, { contextRefs: refs, repair: false });
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

  /**
   * Human refs of this issue's unsatisfied blockers, for a refusal a caller can
   * act on. Falls back to the raw id when a blocker row cannot be read, which is
   * the fail-closed direction: an unreadable blocker is not a satisfied one.
   */
  private openBlockerLocators(issueId: string): string[] {
    return this.unsatisfiedBlockers(issueId).map((id) => {
      try {
        return this.currentLocator(id);
      } catch {
        return id;
      }
    });
  }

  // Single shared readiness projection (PRD §5). Pass `now` in tests to
  // control deferral without wall-clock coupling.
  /** Derived dispatchability from state, structure, attestation currency and blockers; computed live, never stored. */
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

  /** Atomic lease with exactly one live holder; same-holder reclaim returns the live row, steal and expired generations fail closed. */
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
    // XTRM-983 (d): terminal is one rule with one sentence on every claim route.
    // Checked before the row walk, so a refused claim on a terminal issue writes
    // nothing — the transition that ended the issue owns the release.
    this.assertClaimNotStranded(issue, "claim");
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
    this.assertClaimNotStranded(this.requireIssue(issueId), "renew");
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
  /** Surrenders the live lease; lifecycle and Closure stay untouched (stopping work is not closing it). */
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
      this.appendEvent(issueId, "claim.released", {
        claim: open.id,
        generation: open.generation,
        holder: open.holder,
        // XTRM-983 (f): one payload shape for every claim.released. `releasedBy`
        // names the route that ended the row — "holder" here; the closure verb
        // ("close"/"cancel") or the lifecycle state ("done"/"archived") on the
        // transition path, which also carries `closure`.
        releasedBy: "holder",
      });
      return { ...open, releasedAt: now };
    });
  }

  getActiveClaim(issueId: string, opts?: { now?: number }): IssueClaim | null {
    this.requireIssue(issueId);
    return this.openClaim(issueId, opts?.now ?? Date.now());
  }

  // XTRM-976: the unreleased row whether or not its lease is still live, so a
  // lapsed claim can be reported as lapsed instead of vanishing from every
  // surface. Liveness stays derived by the caller via isLiveClaim.
  getUnreleasedClaim(issueId: string): IssueClaim | null {
    this.requireIssue(issueId);
    return this.unclosedClaim(issueId);
  }

  // XTRM-976: a claim cannot outlive the issue it was taken on. A terminal
  // transition closes every unreleased row — live or lapsed — inside its own
  // transaction, and the journal names the transition, never a holder who did
  // not act. One write path, no compensating sweep that can fail later.
  releaseClaimsForTransition(
    issueId: string,
    opts: { transition: "close" | "cancel" | LifecycleState; closureId?: string | null; now: number },
  ): IssueClaim[] {
    const unreleased = rows<Row>(
      this.db,
      "SELECT * FROM issue_claims WHERE issue_id = ? AND released_at IS NULL ORDER BY id",
      issueId,
    ).map((r) => this.toClaim(r));
    const released: IssueClaim[] = [];
    for (const claim of unreleased) {
      this.closeClaimRow(claim.id, opts.now);
      this.appendEvent(
        issueId,
        "claim.released",
        {
          claim: claim.id,
          generation: claim.generation,
          holder: claim.holder,
          releasedBy: opts.transition,
          ...(opts.closureId ? { closure: opts.closureId } : {}),
        },
        opts.now,
      );
      released.push({ ...claim, releasedAt: opts.now });
    }
    return released;
  }

  // XTRM-976: the claim routes that can only fail on a terminal issue say why in
  // the same words. `release` is deliberately not one of them: the transition
  // already released the row, so releasing again is the same idempotent no-op it
  // is on an open issue, and `sb issue close … && sb issue release …` keeps
  // working (measured: tests/skill-migration-gate.test.ts drives that sequence).
  // XTRM-983 (d): one rule, one sentence, every route. `claim` and `renew` refuse
  // a terminal issue in the same words and under the route-neutral
  // `not-claimable:` prefix, so the reader does not need to know which route the
  // refusal came through.
  private assertClaimNotStranded(issue: Issue, verb: "claim" | "renew"): void {
    if ((TERMINAL_STATES as readonly string[]).includes(issue.lifecycleState)) {
      throw new Error(
        `not-claimable: ${issue.id} is terminal (${issue.lifecycleState}); a claim ends with the issue it was taken on, so there is nothing to ${verb}`,
      );
    }
  }

  listClaims(issueId: string): IssueClaim[] {
    this.requireIssue(issueId);
    return rows<Row>(this.db, "SELECT * FROM issue_claims WHERE issue_id = ? ORDER BY id", issueId).map((r) =>
      this.toClaim(r),
    );
  }

  private assertHolder(holder: string): void {
    if (!holder.trim()) throw new Error("claim holder must be non-empty");
  }

  // Latest unreleased row, regardless of expiry. Liveness is derived by the
  // caller via isLiveClaim — never a stored flag.
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
  /**
   * Repair-shaped source-time rewrite (XTRM-407). Rewrites the stored source
   * timeline on a row that was ALREADY imported under the lossy importer.
   * That is a different operation from pinning source time at creation
   * (`createIssueFromImport`): this mutates existing history rather than
   * establishing it, so it lives behind its own name and only the one-off
   * repair entry point calls it.
   *
   * Append-only event rows are deliberately NOT rewritten. Existing
   * `issue.created` / `issue.lifecycle` events keep their original stamps and
   * the repair appends its own provenance event, because rewriting the spine
   * would be history falsification rather than repair. Revision 1's
   * `created_at` is kept consistent with the issue row, since that row is the
   * record's stated origin.
   */
  applyImportedSourceTimes(
    issueId: string,
    source: { createdAt?: number | null; updatedAt?: number | null },
  ): { changed: boolean; createdAt: number; updatedAt: number } {
    return withTransaction(this.db, () => {
      const issue = this.requireIssue(issueId);
      // Monotonic by construction: a contradictory source record can never
      // store updated_at earlier than created_at.
      const createdAt = source.createdAt ?? issue.createdAt;
      const updatedAt = Math.max(createdAt, source.updatedAt ?? issue.updatedAt);
      const changed = createdAt !== issue.createdAt || updatedAt !== issue.updatedAt;
      if (changed) {
        this.db.prepare("UPDATE issues SET created_at = ?, updated_at = ? WHERE id = ?").run(createdAt, updatedAt, issueId);
        this.db.prepare("UPDATE issue_revisions SET created_at = ? WHERE issue_id = ? AND revision = 1").run(createdAt, issueId);
        this.db.prepare("UPDATE issue_aliases SET created_at = ? WHERE issue_id = ?").run(createdAt, issueId);
      }
      return { changed, createdAt, updatedAt };
    });
  }

  setLifecycleState(
    issueId: string,
    state: LifecycleState,
    at?: number,
    gate?: { actor?: string; linkGate?: GateMode; gateOverride?: string; exemption?: GateExemption },
  ): ResolvedIssue {
    if (!(LIFECYCLE_STATES as readonly string[]).includes(state)) throw new Error(`unknown lifecycle state: ${state}`);
    return withTransaction(this.db, () => {
      const before = this.requireIssue(issueId);
      // The done transition is gated here, so every path (ClosureService's
      // direct update excepted and gated there) is covered exactly once.
      // Migration/import paths pass a named exemption.
      if (state === "done" && before.lifecycleState !== "done" && gate?.exemption === undefined) {
        new LinkGateService(this.db, this).enforce(issueId, {
          actor: gate?.actor ?? "sb-cli",
          mode: gate?.linkGate,
          override: gate?.gateOverride ?? null,
          now: at,
        });
      }
      // XTRM-967: the same reason the link gate lives here applies to the
      // blocker rule. `ClosureService` writes the lifecycle row directly and
      // decides blockers itself (it exempts superseded|duplicate|cancelled and
      // records the override on the Closure row), so a rule placed here covers
      // exactly the paths that bypass it: `sb issue state|archive`,
      // `sb issue cancel`'s alias, MCP and the integrations. Those paths have
      // nowhere to record a reason, so like the legacy bare close they can only
      // refuse — the remedy is a close with an outcome, or closing the blocker.
      //
      // `cancelled` is exempt for the reason XTRM-959 exempts it: a cancel does
      // not claim the work was delivered. `archived` is NOT exempt, because a
      // blocker becomes satisfied by an archived blocker (`isBlockerSatisfied`),
      // so archiving would otherwise be the quiet way past the rule.
      if (
        (state === "done" || state === "archived") &&
        before.lifecycleState !== state &&
        gate?.exemption === undefined
      ) {
        const blockers = this.openBlockerLocators(issueId);
        if (blockers.length > 0) {
          // XTRM-980: the same builder as the close path, so a caller learns one
          // vocabulary. The remedy differs by construction, not by copy: this
          // path has no Closure row, so it cannot offer the override flag and
          // points at a close, which can.
          throw new Error(
            openBlockerRefusal({
              mode: "transition",
              action: `mark ${this.currentLocator(issueId)} ${state}`,
              blockers,
              locator: this.currentLocator(issueId),
            }).message,
          );
        }
      }
      // `at` lets the import path land a terminal transition on source time, so
      // the lifecycle event agrees with the Closure row rather than
      // contradicting it (XTRM-406). All other callers keep wall-clock.
      const now = at ?? Date.now();
      this.db.prepare("UPDATE issues SET lifecycle_state = ?, updated_at = ? WHERE id = ?").run(state, now, issueId);
      this.appendEvent(issueId, "issue.lifecycle", { from: before.lifecycleState, to: state }, now);
      // XTRM-976: every terminal transition releases what it strands, not only
      // the Closure path — `issue state <ref> archived` had no other route out.
      if ((TERMINAL_STATES as readonly string[]).includes(state) && before.lifecycleState !== state) {
        this.releaseClaimsForTransition(issueId, { transition: state, now });
      }
      return this.view(issueId);
    });
  }
}
