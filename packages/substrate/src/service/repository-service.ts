// Repository binding service (ADR sbcloseout4 §§13-15; bead XTRM-252.1).
//
// `checkout_links` (migration 007) remains a local alias/cache: a git root may
// move, and a repository may have many worktrees and clones. The canonical
// authority is `repository_bindings` (migration 008): one unique
// `repository_key` per repository, carrying the Project it represents, the
// detected base branch and the normalized remote.
//
// This service owns binding, deterministic adoption and fail-closed conflict
// behavior. It never renames an established Project, never generates a random
// id, and never invents an unknown value (ADR §§11-12, 14-15, 98). Resolution
// order and CLI surfaces belong to R2; low-level administration belongs to R3.

import type { DatabaseSync } from "../store/database.ts";
import { withTransaction } from "../store/transactions.ts";
import {
  deriveProjectCandidates,
  type ProjectIdentity,
  type RepositoryBinding,
  type RepositoryIdentity,
} from "../domain/repository.ts";
import { IssueService } from "./issue-service.ts";

/**
 * Contradictory durable evidence (ADR §15). Carries the three facts the ADR
 * requires the failure to report: repository identity, the conflicting Project,
 * and the repair action.
 */
export class RepositoryBindingConflictError extends Error {
  readonly repositoryKey: string;
  readonly conflictingProjectId: string;
  readonly repairAction: string;

  constructor(input: {
    repositoryKey: string;
    conflictingProjectId: string;
    detail: string;
    repairAction: string;
  }) {
    super(
      `repository binding conflict (fail-closed): repository ${input.repositoryKey} conflicts with project ` +
        `${input.conflictingProjectId}: ${input.detail}. Repair: ${input.repairAction}`,
    );
    this.name = "RepositoryBindingConflictError";
    this.repositoryKey = input.repositoryKey;
    this.conflictingProjectId = input.conflictingProjectId;
    this.repairAction = input.repairAction;
  }
}

export interface BindRepositoryInput {
  identity: RepositoryIdentity;
  // Git common root of the checkout that triggered the binding. When present,
  // the checkout is registered in `checkout_links` as a local cache alias.
  commonRoot?: string | null;
  // Detected base branch (ADR §10 via `deriveBaseBranch`), or null when
  // detection was inconclusive. Unknown stays absent (ADR §98).
  baseBranch?: string | null;
  now?: number;
}

export interface BindRepositoryResult {
  binding: RepositoryBinding;
  projectId: string;
  // True when this call created the Projects row.
  created: boolean;
  // True when this call attached to a pre-existing Projects row (the live
  // `prj_xtrm` store, or a Beads-imported Project). Adoption never rewrites the
  // Project id, prefix, name or any Issue reference (ADR §14).
  adopted: boolean;
  // True when this repository_key was already bound; the Project is reused.
  idempotent: boolean;
}

const REPAIR_ACTION =
  "inspect repository_bindings (repository_key, project_id) and remove or repoint the row that contradicts " +
  "durable evidence, then re-run repository initialization";

interface Row {
  [key: string]: unknown;
}

function bindingFromRow(r: Row): RepositoryBinding {
  return {
    repositoryKey: r["repository_key"] as string,
    projectId: r["project_id"] as string,
    baseBranch: (r["base_branch"] as string | null) ?? null,
    canonicalRemote: (r["canonical_remote"] as string | null) ?? null,
    createdAt: r["created_at"] as number,
    updatedAt: r["updated_at"] as number,
  };
}

export class RepositoryService {
  private readonly db: DatabaseSync;
  private readonly issues: IssueService;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.issues = new IssueService(db);
  }

  getBinding(repositoryKey: string): RepositoryBinding | null {
    const row = this.db
      .prepare("SELECT repository_key, project_id, base_branch, canonical_remote, created_at, updated_at FROM repository_bindings WHERE repository_key = ?")
      .get(repositoryKey) as Row | undefined;
    return row ? bindingFromRow(row) : null;
  }

  listBindings(): RepositoryBinding[] {
    return (
      this.db
        .prepare("SELECT repository_key, project_id, base_branch, canonical_remote, created_at, updated_at FROM repository_bindings ORDER BY repository_key")
        .all() as Row[]
    ).map(bindingFromRow);
  }

  bindingsForProject(projectId: string): RepositoryBinding[] {
    return (
      this.db
        .prepare("SELECT repository_key, project_id, base_branch, canonical_remote, created_at, updated_at FROM repository_bindings WHERE project_id = ? ORDER BY repository_key")
        .all(projectId) as Row[]
    ).map(bindingFromRow);
  }

  /**
   * Projects bound to more than one repository. This is the shape of ADR §15
   * contradictory evidence: one Project claiming two unrelated repositories.
   * Uniqueness on `repository_key` does not prevent it, so it is detected
   * explicitly and never repaired silently.
   */
  findContradictions(): Array<{ projectId: string; repositoryKeys: string[] }> {
    const rows = this.db
      .prepare(
        "SELECT project_id, repository_key FROM repository_bindings ORDER BY project_id, repository_key",
      )
      .all() as Row[];
    const byProject = new Map<string, string[]>();
    for (const r of rows) {
      const projectId = r["project_id"] as string;
      const keys = byProject.get(projectId) ?? [];
      keys.push(r["repository_key"] as string);
      byProject.set(projectId, keys);
    }
    return [...byProject.entries()]
      .filter(([, keys]) => keys.length > 1)
      .map(([projectId, repositoryKeys]) => ({ projectId, repositoryKeys }));
  }

  /** Fail closed when durable binding evidence contradicts itself (ADR §15). */
  assertConsistent(): void {
    const [first] = this.findContradictions();
    if (first) {
      throw new RepositoryBindingConflictError({
        repositoryKey: first.repositoryKeys[0]!,
        conflictingProjectId: first.projectId,
        detail: `project is bound to multiple repositories: ${first.repositoryKeys.join(", ")}`,
        repairAction: REPAIR_ACTION,
      });
    }
  }

  /**
   * Bind a repository to a Project, atomically and idempotently (ADR §13).
   *
   * 1. An existing binding for the same repository_key wins; the Project is
   *    reused and its identity is never rewritten.
   * 2. Otherwise the deterministic candidates from
   *    `deriveProjectCandidates` are tried in order. A candidate whose Project
   *    is bound to a different repository, or whose prefix is held by an
   *    established Project, is skipped (ADR §12 collision policy) — never
   *    renamed. A candidate with an existing, unbound Projects row is adopted
   *    (ADR §14).
   * 3. If every candidate is taken, the bind fails closed with the repository
   *    key, the conflicting Project and a repair action (ADR §15).
   * 4. When a Git common root is supplied, it is registered in `checkout_links`
   *    as a local cache alias for the bound Project.
   *
   * The whole operation runs in one transaction, and the binding is derived
   * only from the supplied identity: nothing is invented from labels or prose
   * (ADR §98).
   */
  bindRepository(input: BindRepositoryInput): BindRepositoryResult {
    const { identity } = input;
    const repositoryKey = identity.repositoryKey;
    const commonRoot = (input.commonRoot ?? "").trim();
    const baseBranch = (input.baseBranch ?? "").trim() === "" ? null : input.baseBranch!.trim();

    return withTransaction(this.db, () => {
      const now = input.now ?? Date.now();
      const existing = this.getBinding(repositoryKey);
      if (existing) {
        return this.rebindExisting(existing, identity, baseBranch, commonRoot, now);
      }

      const candidates = deriveProjectCandidates(identity);
      const conflicts: string[] = [];
      let chosen: ProjectIdentity | null = null;
      let created = false;
      let adopted = false;

      for (const candidate of candidates) {
        const boundTo = this.bindingsForProject(candidate.id)
          .map((b) => b.repositoryKey)
          .filter((k) => k !== repositoryKey);
        if (boundTo.length > 0) {
          // Expected basename collision: this Project belongs to another
          // repository. Advance to the next deterministic candidate.
          conflicts.push(candidate.id);
          continue;
        }
        const project = this.projectRow(candidate.id);
        if (!project) {
          const prefixOwner = this.projectIdByPrefix(candidate.prefix);
          if (prefixOwner !== null) {
            // The Projects prefix is held by an established Project. Renaming
            // it is forbidden (ADR §12/§14): take the next candidate instead.
            conflicts.push(prefixOwner);
            continue;
          }
          this.issues.createProject({ id: candidate.id, prefix: candidate.prefix, name: candidate.name });
          chosen = candidate;
          created = true;
          break;
        }
        // Pre-existing, unbound Project: adopt it exactly as it stands.
        chosen = candidate;
        adopted = true;
        break;
      }

      if (!chosen) {
        throw new RepositoryBindingConflictError({
          repositoryKey,
          conflictingProjectId: conflicts[0] ?? "(none)",
          detail: `every deterministic Project identity is taken (${candidates.map((c) => c.id).join(", ")})`,
          repairAction: REPAIR_ACTION,
        });
      }

      this.db
        .prepare(
          "INSERT INTO repository_bindings (repository_key, project_id, base_branch, canonical_remote, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(repositoryKey, chosen.id, baseBranch, identity.canonicalRemote, now, now);
      this.cacheCheckoutAlias(commonRoot, chosen.id);
      const binding = this.getBinding(repositoryKey)!;
      return { binding, projectId: chosen.id, created, adopted, idempotent: false };
    });
  }

  // Re-binding is a read plus, at most, a refresh of the derived facts. The
  // Project binding is never changed here: an existing binding that points at a
  // Project owned by another repository is contradictory evidence and fails
  // closed (ADR §15).
  private rebindExisting(
    existing: RepositoryBinding,
    identity: RepositoryIdentity,
    baseBranch: string | null,
    commonRoot: string,
    now: number,
  ): BindRepositoryResult {
    this.assertProjectBoundOnlyTo(existing.repositoryKey, existing.projectId);
    if (!this.projectRow(existing.projectId)) {
      throw new RepositoryBindingConflictError({
        repositoryKey: identity.repositoryKey,
        conflictingProjectId: existing.projectId,
        detail: "the bound Project no longer exists",
        repairAction: REPAIR_ACTION,
      });
    }
    const nextRemote = identity.canonicalRemote ?? existing.canonicalRemote;
    if (baseBranch !== existing.baseBranch || nextRemote !== existing.canonicalRemote) {
      this.db
        .prepare("UPDATE repository_bindings SET base_branch = ?, canonical_remote = ?, updated_at = ? WHERE repository_key = ?")
        .run(baseBranch ?? existing.baseBranch, nextRemote, now, existing.repositoryKey);
    }
    this.cacheCheckoutAlias(commonRoot, existing.projectId);
    return {
      binding: this.getBinding(existing.repositoryKey)!,
      projectId: existing.projectId,
      created: false,
      adopted: false,
      idempotent: true,
    };
  }

  private assertProjectBoundOnlyTo(repositoryKey: string, projectId: string): void {
    const others = this.bindingsForProject(projectId).filter((b) => b.repositoryKey !== repositoryKey);
    if (others.length > 0) {
      throw new RepositoryBindingConflictError({
        repositoryKey,
        conflictingProjectId: projectId,
        detail: `project is already authoritatively bound to unrelated repositories: ${others
          .map((b) => b.repositoryKey)
          .join(", ")}`,
        repairAction: REPAIR_ACTION,
      });
    }
  }

  // checkout_links is the local cache alias, not the authority (ADR §13).
  private cacheCheckoutAlias(commonRoot: string, projectId: string): void {
    if (commonRoot === "") return;
    this.issues.linkCheckout(commonRoot, projectId);
  }

  private projectRow(id: string): { id: string; prefix: string } | null {
    const row = this.db.prepare("SELECT id, prefix FROM projects WHERE id = ?").get(id) as Row | undefined;
    return row ? { id: row["id"] as string, prefix: row["prefix"] as string } : null;
  }

  private projectIdByPrefix(prefix: string): string | null {
    const row = this.db.prepare("SELECT id FROM projects WHERE prefix = ?").get(prefix) as Row | undefined;
    return row ? (row["id"] as string) : null;
  }
}
