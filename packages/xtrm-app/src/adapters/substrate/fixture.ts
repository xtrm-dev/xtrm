import type { IssueDetail, IssueSummary, JournalEntry, SubstrateAdapter } from "../types.ts";
import { parseContract } from "./contract.ts";
import { mapClosure, mapJournalEntry, mapTrace } from "./live.ts";

// Development fixture with in-memory mutations. Shapes follow `substrate-cli/v1`; content is illustrative.

const TITLES: Array<[string, string, string]> = [
  ["epic", "open", "Console v2 executable shell"],
  ["task", "open", "Global rail destinations and keyboard model"],
  ["task", "open", "Contextual sidebar reopen rail (B1)"],
  ["task", "open", "Inspector Drawer state machine and URL restore"],
  ["task", "open", "Substrate batched issue listing with readiness"],
  ["task", "open", "Root-export readiness types from @jaggerxtrm/substrate"],
  ["bug", "open", "Console v1 24h event counts presented as open totals"],
  ["task", "done", "Canonical Console v2 documentation baseline"],
  ["task", "open", "Governance typed references to executable work"],
  ["task", "open", "Retire Console v1 RightSidebar after cutover"],
  ["task", "deferred", "Agent/Frames runtime tranche contract"],
  ["task", "open", "Activity surface virtualization budget"],
  ["bug", "open", "Bead inspector no-ops outside the feed view"],
  ["task", "done", "Supernova and PiChamber audits"],
  ["task", "open", "Command palette authority filtering"],
];

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-16T17:00:00Z");

interface Record_ {
  summary: IssueSummary;
  contract: Record<string, unknown>;
  journal: JournalEntry[];
}

function seed(): Map<string, Record_> {
  const rows = new Map<string, Record_>();
  for (let i = 0; i < 60; i++) {
    const [kind, lifecycle, title] = TITLES[i % TITLES.length]!;
    const n = 300 + i;
    const ref = `XTRM-${n}`;
    const imported = i === 2;
    rows.set(ref, {
      summary: {
        id: `iss_fixture-${n}`,
        ref,
        locator: i > 0 && i < 8 ? `XTRM-300.${i}` : ref,
        title: i < TITLES.length ? title : `${title} (${Math.floor(i / TITLES.length) + 1})`,
        kind,
        lifecycle,
        revision: 1 + (i % 3),
        priority: i % 5,
        scrutiny: ["LOW", "MEDIUM", "HIGH"][i % 3]!,
        createdAt: NOW - (60 - i) * DAY,
        updatedAt: NOW - (i % 9) * 3_600_000,
        lastActivityAt: NOW - (i % 9) * 1_800_000,
        eventCount: (i * 7) % 23,
        pointerCount: (i * 3) % 11,
        primaryPr: i === 1 ? { repository: "Jaggerxtrm/console", number: 211, relation: "created_from", url: "https://github.com/Jaggerxtrm/console/pull/211", state: "merged" } : null,
        attestation: lifecycle === "open" && i % 3 === 1 ? "current" : (["none", "stale", "rejected"] as const)[i % 3]!,
        contractComplete: i % 5 !== 0,
        dispatchable: lifecycle === "open" && i % 3 === 1 && i % 7 !== 0,
        parentRef: i > 0 && i < 8 ? "XTRM-300" : null,
        parentLocator: i > 0 && i < 8 ? "XTRM-300" : null,
        childCount: i === 0 ? 7 : 0,
        childrenDone: i === 0 ? 1 : 0,
        blockedBy: i === 4 ? ["XTRM-305"] : [],
        readiness: lifecycle === "open" && i % 3 === 1 ? "ready" : "draft",
      },
      contract: imported
        ? {
            problem: "Imported from Beads.\n\n## PROBLEM\nThe contextual sidebar disappears when collapsed.\n\n## SCOPE\n- reserved 44px rail\n- restore last width\n\n## NON_GOALS\n- global rail changes\n\n## VALIDATION\n1. collapse/restore round-trips\n2. Mod+B toggles",
            success: "TBD — imported from Beads; pending XTRM planning",
            scope: [],
            nonGoals: [],
            constraints: [],
            validation: [{ check: "TBD — imported from Beads; pending XTRM planning" }],
            output: [{ artifact: "TBD — imported from Beads; pending XTRM planning" }],
          }
        : {
            problem: `**${title}.** The current shell cannot express this without a feature-local workaround.\n\nSee \`console-v2-shell-architecture.md\` for the contract.${i === 1 ? " Coordinate with XTRM-305; UTF-8 is not a reference." : ""}`,
            success: "Behaviour is covered by automated tests and visible in the executable shell.",
            scope: ["packages/xtrm-app shell and adapters"],
            nonGoals: ["Agent/Frames runtime"],
            constraints: i % 3 === 1 ? ["No direct SQLite access", "Shared primitives only"] : [],
            validation: [{ check: "npm test in packages/xtrm-app" }],
            output: [{ artifact: "Pull request with screenshots" }],
            references: ["packages/xtrm-app/docs/console-v2-shell-architecture.md"],
          },
      journal: [
        mapJournalEntry({ id: `jrn-${n}-1`, sequence: 1, kind: "decision", issueRevision: 1, createdAt: NOW - 3 * DAY, participantId: "claude-code::xtrm-xt-claude-o8h2", sessionId: "$12", semantic: { summary: "Scope agreed: **shell first**, runtime later." } }),
        mapJournalEntry({ id: `jrn-${n}-2`, sequence: 2, kind: "note", issueRevision: 1, createdAt: NOW - 2 * DAY, semantic: { summary: "Fixture review note with `code` and a list:\n\n- one\n- two" } }),
        ...(i === 1
          ? [
              mapJournalEntry({ id: `jrn-${n}-3`, sequence: 3, kind: "result", issueRevision: 1, createdAt: NOW - DAY, participantId: "specialist::executor", activationId: "act:e305f40b-220", sessionId: "01a0af77-fb2e-719a-816a-22cb768f5ced", result: { resultVersion: 1, summary: "Implemented the rail and **keyboard model**.", outcome: "completed", completed: ["rail", "Mod+B"], validation: ["npm test"] } }),
              mapJournalEntry({ id: `jrn-${n}-4`, sequence: 4, kind: "checkpoint", issueRevision: 1, createdAt: NOW - DAY / 2, participantId: "specialist::executor", activationId: "act:e305f40b-220", semantic: { summary: "Settled after review.", next: ["merge"] }, mechanical: { issueId: `iss-${n}`, issueRevision: 1, contractHash: "3b8d12f7", collectedAt: NOW - DAY / 2, branch: "xt/o8h2", headCommit: "abc1234567890def" } }),
            ]
          : []),
      ],
    });
  }
  return rows;
}

export function createFixtureSubstrate(): SubstrateAdapter {
  const rows = seed();
  const get = (ref: string) => {
    const r = rows.get(ref);
    if (!r) throw new Error(`unknown issue ${ref}`);
    return r;
  };
  const touch = (r: Record_) => void (r.summary = { ...r.summary, updatedAt: Date.now(), lastActivityAt: Date.now() });

  return {
    source: "fixture",
    /** Canned project-wide journal page: every kind the feed can render, newest first. */
    async journalFeed(_projectId, opts) {
      const base = Date.parse("2026-11-12T11:00:00Z");
      const kinds = ["note", "finding", "decision", "blocker", "milestone", "handoff", "result", "checkpoint", "compaction", "cancel"];
      const entries = kinds.map((kind, i) => ({
        id: `jrn_fixture_${i}`,
        issueRef: `XTRM-${100 + i}`,
        issueId: `iss_fixture_${i}`,
        sequence: i + 1,
        kind,
        issueRevision: 1,
        createdAt: base - i * 60_000,
        participantId: "fixture-holder",
        semantic: { summary: `fixture ${kind} entry` },
      }));
      const limit = opts?.limit ?? 50;
      return { entries: entries.slice(0, limit), nextCursor: null };
    },
    async canWrite() {
      return true;
    },
    /** Fixtures have no transport; the footer omits the board line instead of inventing one. */
    async connection() {
      return null;
    },
    async listProjects() {
      // market-data is a second bound checkout of the same project so a repository can show both the
      // project surfaces and an issue page in one place (XTRM-820 test data). One project per
      // checkout: the Workers tree joins the board and the dispatch graph through this binding.
      return [{ id: "prj_xtrm", prefix: "XTRM", name: "xtrm", gitRoots: ["/home/dev/xtrm", "/home/dev/market-data"] }];
    },
    async listIssues() {
      return [...rows.values()].map((r) => r.summary);
    },
    async getIssue(ref) {
      const r = get(ref);
      const s = r.summary;
      const children = [...rows.values()].filter((x) => x.summary.parentRef === ref).map((x) => ({ id: x.summary.id, ref: x.summary.ref, locator: x.summary.locator, title: x.summary.title, lifecycle: x.summary.lifecycle, kind: x.summary.kind }));
      const parent = s.parentRef ? get(s.parentRef).summary : null;
      const terminal = ["done", "cancelled", "archived"].includes(s.lifecycle);
      const demoLinks: IssueDetail["pullRequests"] = ref === "XTRM-301"
        ? [
            { id: 1, repository: "Jaggerxtrm/console", number: 211, relation: "created_from", sources: ["provenance"], alsoMentioned: false, url: "https://github.com/Jaggerxtrm/console/pull/211", actor: "t0a7", createdAt: NOW, commits: [{ sha: "abc123", landedSha: null }], state: "merged", stateSource: "observed", title: "Add console feature", mergedAt: NOW },
            { id: 2, repository: "Jaggerxtrm/console", number: 213, relation: "mentioned", sources: ["title"], alsoMentioned: false, url: "https://github.com/Jaggerxtrm/console/pull/213", actor: null, createdAt: NOW, commits: [], state: null, stateSource: null, title: null, mergedAt: null },
          ]
        : [];
      const detail: IssueDetail = {
        ...s,
        pullRequests: demoLinks,
        linkEvents: ref === "XTRM-301"
          ? [
              { eventId: 1, type: "provenance.link_created", payload: { repository: "Jaggerxtrm/console", number: 211, relation: "created_from" }, createdAt: NOW },
              { eventId: 2, type: "provenance.link_finding", payload: { code: "trailer_issue_unknown", sha: "f".repeat(40) }, createdAt: NOW },
              { eventId: 3, type: "provenance.link_gate_warned", payload: { codes: ["gate_mentioned_only"] }, createdAt: NOW },
            ]
          : [],
        linkGate: ref === "XTRM-301"
          ? { mode: "manual", manual: { verdict: "refuse", codes: ["gate_mentioned_only"] } }
          : { mode: "manual", manual: { verdict: "pass", codes: [] } },
        readiness: s.readiness === "ready" ? "ready" : "not_ready",
        projectId: "prj_xtrm",
        readinessState: terminal ? "terminal" : s.readiness === "ready" ? "ready" : "draft",
        dispatchable: s.readiness === "ready",
        reasons: s.readiness === "ready" || terminal ? [] : ["constraints: constraints must be a non-empty array of non-empty strings"],
        contract: parseContract(r.contract),
        claim: null,
        closure: mapClosure(terminal ? { closed: true, closedAt: NOW - DAY, reason: "Shipped with tests", outcome: "completed", actor: "claude-code::xtrm-xt-claude-o8h2", session: null, revision: 1, contractHash: "04e5cf01f4e67301db6b58b00a6831f2ac8a5477", closureId: `clo-${s.ref}` } : null),
        parent: parent ? { id: parent.id, ref: parent.ref, locator: parent.locator, title: parent.title, lifecycle: parent.lifecycle, kind: parent.kind } : null,
        children,
        blockers: s.blockedBy.map((b) => get(b).summary).map((b) => ({ id: b.id, ref: b.ref, locator: b.locator, title: b.title, lifecycle: b.lifecycle, kind: b.kind })),
        release: children.length ? { childrenDone: children.filter((c) => c.lifecycle === "done").length, childrenTotal: children.length } : null,
        journal: [...r.journal].sort((a, b) => b.sequence - a.sequence),
        journalTotal: r.journal.length,
        provenance: mapTrace(
          s.ref === "XTRM-301"
            ? {
                attestation: { outcome: "ready", policy: "default", attestedBy: "claude-code::xtrm-xt-claude-o8h2", createdAt: NOW - 4 * DAY, issueRevision: 1, contractHash: "3b8d12f7a45e66a2", evidenceRefs: [], blockingGaps: [] },
                claims: [{ holder: "specialist::executor", activationId: "act:e305f40b-220", acquiredAt: NOW - 2 * DAY, expiresAt: NOW - DAY, releasedAt: NOW - DAY, generation: 1, issueRevision: 1 }],
                bindings: [{ id: "exb-301", participantId: "specialist::executor", activationId: "act:e305f40b-220", attemptId: "att:e305f40b-220:1", sessionId: "01a0af77-fb2e-719a-816a-22cb768f5ced", workspace: "/home/dev/xtrm", baseCommit: null, issueRevision: 1, createdAt: NOW - 2 * DAY }],
                receipts: [
                  { id: "rcp-301-a", executionBindingId: "exb-301", issueRevision: 1, commitSha: "abc1234567890def", journalCheckpointId: "jrn-301-4", validationRefs: [{ kind: "validation", value: "npm test" }], artifacts: [{ kind: "commit", value: "abc1234567890def", provider: "git", supersededAt: null }], createdAt: NOW - DAY, finalizedAt: NOW - DAY },
                  { id: "rcp-301-b", executionBindingId: "exb-301", issueRevision: 1, commitSha: null, journalCheckpointId: null, validationRefs: [], artifacts: [], createdAt: NOW - DAY / 2, finalizedAt: null },
                ],
                checkpoints: [{ entryId: "jrn-301-4", sequence: 4, kind: "checkpoint", issueRevision: 1, summary: "Settled after review." }],
                commits: ["abc1234567890def"],
                prs: [{ value: "xtrm-dev/xtrm#212", provider: "github" }, "https://github.com/xtrm-dev/xtrm/pull/211"],
                externalBindings: [{ provider: "github", scope: "xtrm-dev/xtrm", remoteId: "212", url: "https://github.com/xtrm-dev/xtrm/pull/212" }],
              }
            : null,
          r.journal,
        ),
      };
      return structuredClone(detail);
    },
    async readJournal(ref, opts) {
      const r = get(ref);
      const all = [...r.journal].sort((a, b) => b.sequence - a.sequence);
      if (opts?.tail !== undefined) return structuredClone(all.slice(0, opts.tail));
      const limit = opts?.limit ?? 200;
      const window = opts?.before !== undefined ? all.filter((e) => e.sequence < opts.before!) : all;
      return structuredClone(window.slice(0, limit));
    },
    async dispatchGraph(projectId, opts) {
      // A three-level chain (lead -> worker -> activation), one binding that
      // predates the dispatcher write path (core #963) and therefore has no
      // dispatcher, and one PR delivery. Bounded like the real read.
      const base = Date.parse("2026-11-18T09:00:00Z");
      const limit = opts?.limit ?? 200;
      const bindings = [
        // The lead is a dispatcher with no binding of its own: the graph attests who
        // dispatched whom, and the board names the worker. Chain root, no issue trail.
        { binding: "exb_fx_worker", activation: "act_fx_board_worker", participant: "board-worker", dispatcher: "console-lead", dispatcherSession: "session-console-lead", issueId: "iss_fixture_817", ref: "XTRM-817", at: base },
        { binding: "exb_fx_engineer", activation: "act_fx_test_engineer", participant: "test-engineer", dispatcher: "board-worker", dispatcherSession: "session-board-worker", issueId: "iss_fixture_813", ref: "XTRM-813", at: base + 60_000 },
        { binding: "exb_fx_quant", activation: "act_fx_quant_reviewer", participant: "quant-reviewer", dispatcher: "console-lead", dispatcherSession: "session-console-lead", issueId: "iss_fixture_820", ref: "XTRM-820", at: base + 120_000 },
        // A launch that predates the dispatcher write path (core #963): no dispatcher.
        { binding: "exb_fx_reviewer", activation: "act_fx_pr_reviewer", participant: "pr-reviewer", dispatcher: null, dispatcherSession: null, issueId: "iss_fixture_816", ref: "XTRM-816", at: base + 180_000 },
      ].filter((b) => opts?.since === undefined || b.at >= opts.since);
      const shown = bindings.slice(0, limit);
      const nodes = new Map<string, { id: string; kind: "participant" | "activation" | "issue" | "pull_request"; label: string; participantId: string | null }>();
      const edges: Array<{ kind: "works_on" | "dispatched_by" | "delivers"; from: string | null; to: string; issueId: string; issueRef: string | null; at: number; bindingId: string | null; dispatcherSessionId: string | null }> = [];
      for (const b of shown) {
        const executor = `activation:${b.activation}`;
        nodes.set(executor, { id: executor, kind: "activation", label: b.activation, participantId: b.participant });
        const issueNode = `issue:${b.issueId}`;
        nodes.set(issueNode, { id: issueNode, kind: "issue", label: b.ref, participantId: null });
        edges.push({ kind: "works_on", from: executor, to: issueNode, issueId: b.issueId, issueRef: b.ref, at: b.at, bindingId: b.binding, dispatcherSessionId: null });
        if (b.dispatcher) {
          const participant = `participant:${b.dispatcher}`;
          nodes.set(participant, { id: participant, kind: "participant", label: b.dispatcher, participantId: b.dispatcher });
        }
        // The dispatcher may be absent: the edge keeps `from: null` so the UI
        // groups the executor under "unknown dispatcher" instead of guessing.
        edges.push({
          kind: "dispatched_by",
          from: b.dispatcher ? `participant:${b.dispatcher}` : null,
          to: executor,
          issueId: b.issueId,
          issueRef: b.ref,
          at: b.at,
          bindingId: b.binding,
          dispatcherSessionId: b.dispatcherSession,
        });
      }
      const pr = { issueId: "iss_fixture_816", repo: "mercury/market-data", number: 912, at: base + 240_000 };
      if (shown.some((b) => b.issueId === pr.issueId) && (opts?.since === undefined || pr.at >= opts.since)) {
        const node = `pull_request:${pr.repo}#${pr.number}`;
        nodes.set(node, { id: node, kind: "pull_request", label: `${pr.repo}#${pr.number}`, participantId: null });
        edges.push({ kind: "delivers", from: `issue:${pr.issueId}`, to: node, issueId: pr.issueId, issueRef: "XTRM-816", at: pr.at, bindingId: null, dispatcherSessionId: null });
      }
      return {
        projectId,
        since: opts?.since ?? null,
        limit,
        nodes: [...nodes.values()].sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind))),
        edges: edges.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind)),
        matchedBindings: bindings.length,
        omittedBindings: bindings.length - shown.length,
        truncated: bindings.length > shown.length,
      };
    },
    async editIssue(_project, ref, expectedRevision, edit) {
      const r = get(ref);
      if (edit.title !== undefined) r.summary = { ...r.summary, title: edit.title };
      if (edit.priority !== undefined) r.summary = { ...r.summary, priority: edit.priority };
      if (edit.scrutiny !== undefined) r.summary = { ...r.summary, scrutiny: edit.scrutiny, revision: r.summary.revision + 1 };
      if (edit.contract !== undefined) {
        if (expectedRevision !== r.summary.revision) throw new Error(`revision conflict: expected ${expectedRevision}, current ${r.summary.revision}`);
        r.contract = structuredClone(edit.contract);
        r.summary = { ...r.summary, revision: r.summary.revision + 1 };
      }
      touch(r);
    },
    async setLifecycle(_project, ref, state) {
      const r = get(ref);
      r.summary = { ...r.summary, lifecycle: state };
      touch(r);
    },
    async addNote(_project, ref, text, kind) {
      const r = get(ref);
      const sequence = r.journal.length + 1;
      r.journal.push(mapJournalEntry({ id: `jrn-${ref}-${sequence}`, sequence, kind, issueRevision: r.summary.revision, createdAt: Date.now(), semantic: { summary: text } }));
    },
    async createIssue(_project, input) {
      const n = 300 + rows.size;
      const ref = `XTRM-${n}`;
      rows.set(ref, {
        summary: {
          id: `iss_fixture-${n}`,
          ref,
          locator: ref,
          lastActivityAt: null,
          eventCount: 0,
            pointerCount: 0,
            primaryPr: null,
          attestation: "none",
          contractComplete: false,
          dispatchable: false,
          title: input.title,
          kind: input.kind,
          lifecycle: "open",
          revision: 1,
          priority: input.priority,
          scrutiny: input.scrutiny,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          parentRef: input.parent ?? null,
          parentLocator: input.parent ? (rows.get(input.parent)?.summary.locator ?? input.parent) : null,
          childCount: 0,
          childrenDone: 0,
          blockedBy: [],
          readiness: "draft",
        },
        contract: input.contract,
        journal: [],
      });
      return ref;
    },
  };
}

export const fixtureSubstrate = createFixtureSubstrate();
