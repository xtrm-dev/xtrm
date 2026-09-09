import type { DatabaseSync } from "node:sqlite";
import { ISSUE_KINDS, type ResolvedIssue } from "../domain/issue.ts";
import { validateContractStructure } from "../domain/contract.ts";
import { EDGE_KINDS, wouldCreateCycle, type GraphLink } from "../domain/edge.ts";
import { mutateOnce, withTransaction } from "../store/transactions.ts";
import { IssueService, type StoredEdge } from "./issue-service.ts";

// Atomic planning (PRD §16): a PlanDraft validates everything up front
// (`check`) and commits all revisions, edges, aliases, and events in one
// transaction or none (`apply`). The draft is an input artifact; after apply
// the Substrate graph is authority.
//
// Idempotency: apply runs inside mutateOnce on the "plan" namespace keyed by
// planKey, so reapplying the same draft returns the recorded result without
// duplicating work (B14). A different draft must use a different planKey.

// -- draft shape ------------------------------------------------------------

export interface PlanIssueSpec {
  /** Draft-local key (`"api"`, `"worker"`); also the check-report handle. */
  key: string;
  projectId: string;
  title: string;
  kind: string;
  contract: unknown;
  scrutiny?: string;
  ownership?: unknown;
  contextRefs?: unknown[];
  /** Draft key or existing issue id. Creates a parent_child link on apply. */
  parentKey?: string;
  /** When set, this spec revises an existing issue instead of creating one. */
  updateIssueId?: string;
  expectedRevision?: number;
  aliases?: Array<{ alias: string; kind: string }>;
}

export interface PlanEdgeSpec {
  /** Draft keys or existing issue ids. */
  fromKey: string;
  toKey: string;
  kind: string;
}

export interface PlanDraft {
  /** Idempotency key: same key + same content reapplied is a no-op (B14). */
  planKey: string;
  issues: PlanIssueSpec[];
  edges?: PlanEdgeSpec[];
}

// -- check report ------------------------------------------------------------

export interface OwnershipOverlap {
  a: string;
  b: string;
  on: string[];
}

export interface PlanCheckReport {
  ok: boolean;
  errors: string[];
  createdKeys: string[];
  updatedIds: string[];
  /** Draft work that still needs a semantic attestation before dispatch. */
  missingAttestations: string[];
  /** Draft keys / issue ids that gain an incoming blocks edge from this plan. */
  blockedTargets: string[];
  parentCycles: string[];
  blockCycles: string[];
  aliasCollisions: string[];
  /** Advisory only: reported pre-apply, never blocks (B13). */
  ownershipOverlaps: OwnershipOverlap[];
  invalidRefs: string[];
}

export interface PlanApplyResult {
  applied: boolean;
  report: PlanCheckReport;
  issues: ResolvedIssue[];
  edges: StoredEdge[];
}

const OWNERSHIP_FIELDS = ["repositories", "paths", "services", "interfaces"] as const;

function ownershipValueSet(ownership: unknown): Set<string> {
  const out = new Set<string>();
  if (ownership === null || typeof ownership !== "object" || Array.isArray(ownership)) return out;
  for (const f of OWNERSHIP_FIELDS) {
    const v = (ownership as Record<string, unknown>)[f];
    if (Array.isArray(v)) for (const e of v) if (typeof e === "string" && e.trim() !== "") out.add(`${f}:${e}`);
  }
  return out;
}

export class PlanningService {
  private readonly db: DatabaseSync;
  private readonly issues: IssueService;
  constructor(db: DatabaseSync, issues: IssueService) {
    this.db = db;
    this.issues = issues;
  }

  // Read-only validation. Reports every problem class from PRD §16; commits
  // nothing. Ownership overlaps are advisory; everything else fails the plan.
  check(draft: PlanDraft): PlanCheckReport {
    const errors: string[] = [];
    const parentCycles: string[] = [];
    const blockCycles: string[] = [];
    const aliasCollisions: string[] = [];
    const invalidRefs: string[] = [];
    const createdKeys: string[] = [];
    const updatedIds: string[] = [];
    const missingAttestations: string[] = [];
    const blockedTargets: string[] = [];
    const ownershipOverlaps: OwnershipOverlap[] = [];

    if (!draft.planKey.trim()) errors.push("planKey must be a non-empty string");
    if (!Array.isArray(draft.issues) || draft.issues.length === 0) errors.push("plan has no issues");

    const byKey = new Map<string, PlanIssueSpec>();
    for (const spec of draft.issues ?? []) {
      if (!spec.key.trim()) {
        errors.push("every plan issue needs a non-empty key");
        continue;
      }
      if (byKey.has(spec.key)) errors.push(`duplicate plan key: ${spec.key}`);
      else byKey.set(spec.key, spec);
    }

    const seenAliases = new Map<string, string>();
    const ownershipByKey = new Map<string, Set<string>>();

    for (const spec of byKey.values()) {
      if (spec.updateIssueId) {
        let existing: ResolvedIssue;
        try {
          existing = this.issues.getIssue(spec.updateIssueId);
        } catch {
          invalidRefs.push(`${spec.key}: unknown update target ${spec.updateIssueId}`);
          continue;
        }
        updatedIds.push(existing.id);
        const rev = this.issues.getRevision(existing.id, existing.currentRevision);
        const findings = validateContractStructure({
          contract: spec.contract,
          scrutiny: spec.scrutiny ?? existing.scrutiny,
          ownership: spec.ownership ?? rev.ownership,
          contextRefs: spec.contextRefs ?? rev.contextRefs,
          lifecycleState: existing.lifecycleState,
        });
        for (const f of findings) errors.push(`${spec.key}: ${f.field}: ${f.message}`);
        ownershipByKey.set(spec.key, ownershipValueSet(spec.ownership ?? rev.ownership));
      } else {
        try {
          this.issues.getProject(spec.projectId);
        } catch {
          invalidRefs.push(`${spec.key}: unknown project ${spec.projectId}`);
          continue;
        }
        if (!spec.title.trim()) errors.push(`${spec.key}: title must be non-empty`);
        if (!(ISSUE_KINDS as readonly string[]).includes(spec.kind)) {
          errors.push(`${spec.key}: unknown kind: ${spec.kind}`);
        }
        const findings = validateContractStructure({
          contract: spec.contract,
          scrutiny: spec.scrutiny,
          ownership: spec.ownership,
          contextRefs: spec.contextRefs,
        });
        for (const f of findings) errors.push(`${spec.key}: ${f.field}: ${f.message}`);
        createdKeys.push(spec.key);
        ownershipByKey.set(spec.key, ownershipValueSet(spec.ownership));
      }
      missingAttestations.push(spec.key);
      for (const a of spec.aliases ?? []) {
        if (!a.alias.trim()) {
          errors.push(`${spec.key}: alias must be non-empty`);
          continue;
        }
        const first = seenAliases.get(a.alias);
        if (first !== undefined) {
          aliasCollisions.push(`alias ${a.alias} claimed by ${first} and ${spec.key}`);
          continue;
        }
        seenAliases.set(a.alias, spec.key);
        try {
          const hit = this.issues.resolveRef(a.alias);
          if (hit.id !== spec.updateIssueId) aliasCollisions.push(`alias ${a.alias} collides with ${hit.id}`);
        } catch {
          /* unresolvable alias is free to claim */
        }
      }
    }

    // Parent assignments: draft-internal cycles by key walk; updates against
    // the stored hierarchy via the shared cycle probe (child -> parent).
    const resolveParent = (spec: PlanIssueSpec): string | null => {
      if (!spec.parentKey) return null;
      if (byKey.has(spec.parentKey)) return `plan:${spec.parentKey}`;
      try {
        return this.issues.getIssue(spec.parentKey).id;
      } catch {
        invalidRefs.push(`${spec.key}: unknown parent ${spec.parentKey}`);
        return null;
      }
    };
    const draftParents = new Map<string, string>();
    for (const spec of byKey.values()) {
      const p = resolveParent(spec);
      if (p) {
        if (spec.updateIssueId && p === spec.updateIssueId) {
          parentCycles.push(`${spec.key}: issue cannot parent itself`);
          continue;
        }
        draftParents.set(spec.updateIssueId ?? `plan:${spec.key}`, p);
        if (!spec.updateIssueId) {
          const childProject = spec.projectId;
          const parentProject = byKey.has(spec.parentKey!)
            ? byKey.get(spec.parentKey!)!.projectId
            : (() => {
                try {
                  return this.issues.getIssue(spec.parentKey!).projectId;
                } catch {
                  return childProject;
                }
              })();
          if (parentProject !== childProject) errors.push(`${spec.key}: cross-project parenting is not supported in v0`);
        }
      }
    }
    const planKeys = new Set([...byKey.keys()].map((k) => `plan:${k}`));
    for (const [child, parent] of draftParents) {
      if (!child.startsWith("plan:") || !planKeys.has(parent)) continue;
      const seen = new Set<string>([child]);
      let cur = parent;
      for (;;) {
        if (cur === child) {
          parentCycles.push(`parent cycle through ${child.replace(/^plan:/, "")}`);
          break;
        }
        if (seen.has(cur)) break;
        seen.add(cur);
        const next = draftParents.get(cur);
        if (!next || !planKeys.has(next)) break;
        cur = next;
      }
    }
    const storedHierarchy: GraphLink[] = this.issues
      .listActiveEdges()
      .filter((e) => e.kind === "parent_child")
      .map((e) => ({ from: e.toIssue, to: e.fromIssue }));
    for (const [child, parent] of draftParents) {
      if (child.startsWith("plan:") || parent.startsWith("plan:")) continue;
      if (wouldCreateCycle(storedHierarchy, child, parent)) parentCycles.push(`parent cycle rejected: ${parent} is under ${child}`);
    }

    // Blocks + relation edges. parent_child must go through parentKey so the
    // single-parent invariant is checked in one place.
    const storedBlocks: GraphLink[] = this.issues
      .listActiveEdges()
      .filter((e) => e.kind === "blocks")
      .map((e) => ({ from: e.fromIssue, to: e.toIssue }));
    const combinedBlocks = [...storedBlocks];
    const resolveEndpoint = (key: string): string | null => {
      if (byKey.has(key)) return `plan:${key}`;
      try {
        return this.issues.getIssue(key).id;
      } catch {
        invalidRefs.push(`unknown edge endpoint ${key}`);
        return null;
      }
    };
    for (const edge of draft.edges ?? []) {
      if (!(EDGE_KINDS as readonly string[]).includes(edge.kind)) {
        errors.push(`unknown edge kind: ${edge.kind}`);
        continue;
      }
      if (edge.kind === "parent_child") {
        errors.push("parent_child edges must use parentKey, not edges[]");
        continue;
      }
      const from = resolveEndpoint(edge.fromKey);
      const to = resolveEndpoint(edge.toKey);
      if (!from || !to) continue;
      if (from === to) {
        errors.push(`self edge rejected: ${edge.fromKey} -> ${edge.toKey}`);
        continue;
      }
      if (edge.kind === "blocks") {
        if (wouldCreateCycle(combinedBlocks, from, to)) {
          blockCycles.push(`blocks cycle rejected: ${edge.fromKey} -> ${edge.toKey}`);
        } else {
          combinedBlocks.push({ from, to });
        }
        blockedTargets.push(edge.toKey);
      }
    }

    // Ownership overlap is advisory (B13): every pair sharing a value is
    // reported, but the plan still applies so owners can parallelize knowingly.
    const keys = [...ownershipByKey.keys()];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const shared = [...ownershipByKey.get(keys[i]!)!].filter((v) => ownershipByKey.get(keys[j]!)!.has(v));
        if (shared.length > 0) ownershipOverlaps.push({ a: keys[i]!, b: keys[j]!, on: shared.sort() });
      }
    }

    const ok =
      errors.length === 0 &&
      parentCycles.length === 0 &&
      blockCycles.length === 0 &&
      aliasCollisions.length === 0 &&
      invalidRefs.length === 0;
    return {
      ok,
      errors,
      createdKeys,
      updatedIds,
      missingAttestations,
      blockedTargets,
      parentCycles,
      blockCycles,
      aliasCollisions,
      ownershipOverlaps,
      invalidRefs,
    };
  }

  // Atomic apply: check inside the idempotency fence (a re-check after apply
  // would see the plan's own aliases and falsely collide), then execute all
  // mutations in one transaction. Any failure rolls back everything (B11/B12).
  // Reapplying the same planKey returns the recorded result (B14); a failed
  // check records nothing, so fixing the draft and retrying revalidates.
  apply(draft: PlanDraft): PlanApplyResult {
    if (!draft.planKey.trim()) throw new Error("planKey must be a non-empty string");
    return withTransaction(this.db, () =>
      mutateOnce(this.db, "plan", draft.planKey, () => {
        const report = this.check(draft);
        if (!report.ok) {
          throw new Error(
            `plan check failed: ${[...report.errors, ...report.parentCycles, ...report.blockCycles, ...report.aliasCollisions, ...report.invalidRefs].join("; ")}`,
          );
        }
        return this.execute(draft, report);
      }),
    );
  }

  private execute(draft: PlanDraft, report: PlanCheckReport): PlanApplyResult {
    const byKey = new Map((draft.issues ?? []).map((s) => [s.key, s]));
    const ids = new Map<string, string>();
    const issues: ResolvedIssue[] = [];
    const byAuthor = `plan:${draft.planKey}`;

    for (const spec of byKey.values()) {
      if (!spec.updateIssueId) continue;
      const before = this.issues.getIssue(spec.updateIssueId);
      const { issue } = this.issues.updateContract(spec.updateIssueId, spec.contract as never, byAuthor, {
        expectedRevision: spec.expectedRevision,
        ownership: spec.ownership,
        contextRefs: spec.contextRefs,
      });
      if (spec.scrutiny !== undefined && spec.scrutiny !== before.scrutiny) this.issues.setScrutiny(issue.id, spec.scrutiny);
      for (const a of spec.aliases ?? []) this.issues.addAlias(issue.id, a.alias, a.kind);
      ids.set(spec.key, issue.id);
      issues.push(this.issues.getIssue(issue.id));
    }
    for (const spec of byKey.values()) {
      if (spec.updateIssueId) continue;
      const created = this.issues.createIssue(
        {
          projectId: spec.projectId,
          title: spec.title,
          kind: spec.kind as never,
          contract: spec.contract as never,
          scrutiny: spec.scrutiny,
          ownership: spec.ownership,
          contextRefs: spec.contextRefs,
          aliases: spec.aliases,
          authoredBy: byAuthor,
        },
        { idempotencyKey: `${draft.planKey}:${spec.key}` },
      );
      ids.set(spec.key, created.id);
      issues.push(created);
    }
    for (const spec of byKey.values()) {
      if (!spec.parentKey) continue;
      const childId = ids.get(spec.key) ?? spec.updateIssueId!;
      const parentId = byKey.has(spec.parentKey) ? ids.get(spec.parentKey)! : spec.parentKey;
      this.issues.setParent(childId, parentId);
    }
    const edges: StoredEdge[] = [];
    for (const edge of draft.edges ?? []) {
      const from = byKey.has(edge.fromKey) ? ids.get(edge.fromKey)! : edge.fromKey;
      const to = byKey.has(edge.toKey) ? ids.get(edge.toKey)! : edge.toKey;
      edges.push(this.issues.addEdge(from, to, edge.kind as never));
    }
    void ids;
    void report;
    return { applied: true, report: appliedReport(this.issues, draft), issues, edges };
  }
}

// Post-apply snapshot for the recorded result: fresh work still needs
// attestation, and overlap/blocked-target info is re-derived without the
// collision checks that would now trip over the plan's own committed aliases.
function appliedReport(issues: IssueService, draft: PlanDraft): PlanCheckReport {
    const blockedTargets: string[] = [];
    for (const edge of draft.edges ?? []) if (edge.kind === "blocks") blockedTargets.push(edge.toKey);
    const ownershipByKey = new Map<string, Set<string>>();
    for (const spec of draft.issues ?? []) {
      let ownership = spec.ownership;
      if (ownership === undefined && spec.updateIssueId) {
        try {
          const rev = issues.getRevision(spec.updateIssueId, issues.getIssue(spec.updateIssueId).currentRevision);
          ownership = rev.ownership;
        } catch {
          ownership = undefined;
        }
      }
      ownershipByKey.set(spec.key, ownershipValueSet(ownership));
    }
    const ownershipOverlaps: OwnershipOverlap[] = [];
    const keys = [...ownershipByKey.keys()];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const shared = [...ownershipByKey.get(keys[i]!)!].filter((v) => ownershipByKey.get(keys[j]!)!.has(v));
        if (shared.length > 0) ownershipOverlaps.push({ a: keys[i]!, b: keys[j]!, on: shared.sort() });
      }
    }
    return {
      ok: true,
      errors: [],
      createdKeys: (draft.issues ?? []).filter((s) => !s.updateIssueId).map((s) => s.key),
      updatedIds: (draft.issues ?? []).filter((s) => s.updateIssueId).map((s) => s.updateIssueId!),
      missingAttestations: (draft.issues ?? []).map((s) => s.key),
      blockedTargets,
      parentCycles: [],
      blockCycles: [],
      aliasCollisions: [],
      ownershipOverlaps,
      invalidRefs: [],
    };
}
