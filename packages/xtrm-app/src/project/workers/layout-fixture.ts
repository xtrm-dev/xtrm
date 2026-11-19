import type { DispatchGraphEdge, DispatchGraphNode, ProjectDispatchGraph } from "../../adapters/substrate/graph.ts";

/**
 * A dispatch graph in the shape the live page renders (XTRM-912), for the layout test and the
 * browser probe. It is a fixture, not production data: one worker that delivered five PRs, one
 * session whose only name is its session UUID, and a collapsed "unknown dispatcher" group holding
 * two more UUID sessions and one activation that recorded no dispatcher.
 *
 * The issue refs are seeded fixture issues (`XTRM-301`…`XTRM-304`), so the row can borrow their
 * real titles through the issue index exactly as the live page does (5444 live issues, XTRM-912).
 */
const AT = Date.parse("2026-11-19T09:00:00Z");

const SESSION_UUID = "01a1d9f5-9bb7-77d7-92a7-b5041c46717b";
const UNKNOWN_SESSION_A = "01a1db81-4a5c-7df1-9c0e-1a9f6b2f9e31";
const UNKNOWN_SESSION_B = "01a1df42-c1d3-7c0a-8f21-77b1c0a2d4e5";

const ISSUE = { lead: "iss_layout_301", session: "iss_layout_302", unknown: "iss_layout_303", unattached: "iss_layout_304" };

/** A participant name as long as the live ones: the row must truncate it, not grow for it. */
const LONG_LEAD = "MMD-5007-stable-hotfixes-and-retention-release-lane-lead";

const PRS: Array<{ repo: string; number: number }> = [
  { repo: "mercuryintelligence/infra", number: 637 },
  { repo: "mercuryintelligence/market-data", number: 1542 },
  { repo: "mercuryintelligence/market-data", number: 1562 },
  { repo: "mercuryintelligence/market-data", number: 1565 },
  { repo: "mercuryintelligence/market-data", number: 1604 },
];

function nodes(): DispatchGraphNode[] {
  const list: DispatchGraphNode[] = [
    { id: "participant:console-lead", kind: "participant", label: "console-lead", participantId: "console-lead" },
    { id: `participant:${LONG_LEAD}`, kind: "participant", label: LONG_LEAD, participantId: LONG_LEAD },
    { id: "activation:act_layout_worker", kind: "activation", label: "act_layout_worker", participantId: "layout-worker" },
    { id: `session:${SESSION_UUID}`, kind: "session", label: SESSION_UUID, participantId: null },
    { id: "activation:act_unattached", kind: "activation", label: "act_unattached", participantId: "layout-unattached-worker" },
    { id: `session:${UNKNOWN_SESSION_A}`, kind: "session", label: UNKNOWN_SESSION_A, participantId: null },
    { id: `session:${UNKNOWN_SESSION_B}`, kind: "session", label: UNKNOWN_SESSION_B, participantId: null },
    { id: `issue:${ISSUE.lead}`, kind: "issue", label: "XTRM-301", participantId: null },
    { id: `issue:${ISSUE.session}`, kind: "issue", label: "XTRM-302", participantId: null },
    { id: `issue:${ISSUE.unknown}`, kind: "issue", label: "XTRM-303", participantId: null },
    { id: `issue:${ISSUE.unattached}`, kind: "issue", label: "XTRM-304", participantId: null },
  ];
  for (const pr of PRS) {
    list.push({ id: `pull_request:${pr.repo}#${pr.number}`, kind: "pull_request", label: `${pr.repo}#${pr.number}`, participantId: null });
  }
  return list;
}

function edges(): DispatchGraphEdge[] {
  const list: DispatchGraphEdge[] = [];
  const dispatchedBy = (from: string | null, to: string, issueId: string, at: number): DispatchGraphEdge => ({
    kind: "dispatched_by",
    from,
    to,
    issueId,
    issueRef: null,
    at,
    bindingId: null,
    dispatcherSessionId: null,
  });
  const worksOn = (from: string, issueId: string, at: number): DispatchGraphEdge => ({
    kind: "works_on",
    from,
    to: `issue:${issueId}`,
    issueId,
    issueRef: null,
    at,
    bindingId: null,
    dispatcherSessionId: null,
  });

  list.push(dispatchedBy("participant:console-lead", "activation:act_layout_worker", ISSUE.lead, AT));
  list.push(worksOn("activation:act_layout_worker", ISSUE.lead, AT));
  list.push(dispatchedBy("participant:console-lead", `session:${SESSION_UUID}`, ISSUE.session, AT + 1_000));
  list.push(worksOn(`session:${SESSION_UUID}`, ISSUE.session, AT + 1_000));
  list.push(dispatchedBy(`participant:${LONG_LEAD}`, "activation:act_unattached", ISSUE.unattached, AT + 1_500));
  list.push(dispatchedBy(null, `session:${UNKNOWN_SESSION_B}`, ISSUE.unknown, AT + 2_000));
  list.push(worksOn("activation:act_unattached", ISSUE.unattached, AT + 2_000));
  list.push(dispatchedBy(null, `session:${UNKNOWN_SESSION_A}`, ISSUE.unknown, AT + 3_000));
  list.push(worksOn(`session:${UNKNOWN_SESSION_A}`, ISSUE.unknown, AT + 3_000));
  // A second nameless session on the same issue: two unknown rows, no human name on either.
  list.push(worksOn(`session:${UNKNOWN_SESSION_B}`, ISSUE.unknown, AT + 4_000));
  PRS.forEach((pr, i) =>
    list.push({
      kind: "delivers",
      from: `issue:${ISSUE.lead}`,
      to: `pull_request:${pr.repo}#${pr.number}`,
      issueId: ISSUE.lead,
      issueRef: null,
      at: AT + 5_000 + i,
      bindingId: null,
      dispatcherSessionId: null,
    }),
  );
  return list;
}

/** Bounded like the live read: the header must say in plain words what the cap left out. */
export const WORKERS_LAYOUT_GRAPH: ProjectDispatchGraph = {
  projectId: "prj_xtrm",
  since: null,
  limit: 500,
  nodes: nodes(),
  edges: edges(),
  matchedBindings: 7,
  omittedBindings: 1289,
  truncated: true,
};

export const LAYOUT_SESSION_UUID = SESSION_UUID;
