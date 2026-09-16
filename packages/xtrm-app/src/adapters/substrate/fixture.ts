import type { IssueDetail, IssueSummary, SubstrateAdapter } from "../types.ts";

// Development fixture. Shapes follow `substrate-cli/v1`; content is illustrative.

const TITLES: Array<[string, string, string]> = [
  ["epic", "open", "Console v2 executable shell"],
  ["task", "open", "Global rail destinations and keyboard model"],
  ["task", "open", "Contextual sidebar reopen rail (B1)"],
  ["task", "in_review", "Inspector Drawer state machine and URL restore"],
  ["task", "open", "Substrate batched issue listing with readiness"],
  ["task", "open", "Root-export readiness types from @jaggerxtrm/substrate"],
  ["bug", "open", "Console v1 24h event counts presented as open totals"],
  ["task", "done", "Canonical Console v2 documentation baseline"],
  ["task", "open", "Program typed references to executable work"],
  ["chore", "open", "Retire Console v1 RightSidebar after cutover"],
  ["task", "deferred", "Agent/Frames runtime tranche contract"],
  ["task", "open", "Activity surface virtualization budget"],
  ["bug", "open", "Bead inspector no-ops outside the feed view"],
  ["task", "done", "Supernova and PiChamber audits"],
  ["task", "open", "Command palette authority filtering"],
];

export const fixtureIssues: IssueSummary[] = Array.from({ length: 120 }, (_, i) => {
  const [kind, lifecycle, title] = TITLES[i % TITLES.length]!;
  const n = 300 + i;
  return {
    id: `iss_fixture-${n}`,
    ref: `XTRM-${n}`,
    title: i < TITLES.length ? title : `${title} (${Math.floor(i / TITLES.length) + 1})`,
    kind,
    lifecycle,
    revision: 1 + (i % 4),
    readiness: lifecycle === "open" && i % 3 === 1 ? "ready" : "unknown",
  };
});

function detail(summary: IssueSummary): IssueDetail {
  const ready = summary.readiness === "ready";
  const terminal = summary.lifecycle === "done";
  return {
    ...summary,
    readiness: ready ? "ready" : "not_ready",
    readinessState: terminal ? "terminal" : ready ? "ready" : "draft",
    dispatchable: ready,
    reasons: ready || terminal ? (terminal ? ["lifecycle is terminal (done)"] : []) : ["constraints: constraints must be a non-empty array of non-empty strings"],
    contract: {
      problem: `${summary.title}. The current shell cannot express this without a feature-local workaround.`,
      success: "Behaviour is covered by automated tests and visible in the executable shell.",
      scope: ["packages/xtrm-app shell and adapters"],
      nonGoals: ["Agent/Frames runtime"],
      constraints: ready ? ["No direct SQLite access", "Shared primitives only"] : [],
      validation: ["npm test in packages/xtrm-app"],
      output: ["Pull request with screenshots and a live/fixture surface list"],
    },
    claim: summary.lifecycle === "in_review" ? { holder: "claude-il2a", expiresAt: Date.now() + 3_600_000 } : null,
    closure: { closed: terminal, closedAt: terminal ? Date.now() - 86_400_000 : null, reason: terminal ? "done" : null },
    provenance: { eventCount: 3 + summary.revision, lastEventType: "contract.updated", lastEventAt: Date.now() - 7_200_000 },
  };
}

export const fixtureSubstrate: SubstrateAdapter = {
  source: "fixture",
  async listProjects() {
    return [{ id: "prj_xtrm", prefix: "XTRM", name: "xtrm", gitRoots: ["/home/dev/xtrm"] }];
  },
  async listIssues() {
    return fixtureIssues;
  },
  async getIssue(ref) {
    const found = fixtureIssues.find((i) => i.ref === ref);
    if (!found) throw new Error(`unknown issue ${ref}`);
    return detail(found);
  },
};
