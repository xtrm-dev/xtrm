// XTRM-868: the project dispatch graph. A Console reads a project's dispatch
// tree in one bounded call instead of joining per-Issue traces, so this pins
// the durable edges (works_on, dispatched_by, delivers), the null an
// unrecorded dispatcher reads as, the bound and the filter.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { ARGS, CAPABILITIES, OPERATIONS, assertKnownArgs, createServices } from "../src/service/ops.ts";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract, tempDir } from "./helpers.ts";

function scratch() {
  const dir = tempDir("substrate-graph-");
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const journal = new JournalService(db, svc);
  const prov = new ProvenanceService(db, svc, journal);
  return { dir, dbPath, db, svc, journal, prov };
}

function readyIssue(svc: IssueService, title: string) {
  const issue = svc.createIssue({
    projectId: "prj_xtrm",
    title,
    kind: "task",
    contract: contract({ problem: `${title} problem`, success: `${title} success` }),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
  svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  return issue;
}

function linkPr(
  db: ReturnType<typeof scratch>["db"],
  issueId: string,
  repository: string,
  number: number,
  createdAt: number,
  opts: { relation?: "created_from" | "mentioned"; source?: string; supersededAt?: number | null } = {},
) {
  db.prepare(
    `INSERT INTO issue_pull_requests (issue_id, repository, number, relation, source, url, actor, created_at, superseded_at)
     VALUES (?, ?, ?, ?, ?, ?, 'w', ?, ?)`,
  ).run(
    issueId,
    repository,
    number,
    opts.relation ?? "created_from",
    opts.source ?? "explicit",
    `https://github.com/${repository}/pull/${number}`,
    createdAt,
    opts.supersededAt ?? null,
  );
}

const edgeKinds = (graph: { edges: Array<{ kind: string }> }) => graph.edges.map((e) => e.kind).sort();

describe("XTRM-868 project dispatch graph", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => {
    try {
      s.db.close();
    } catch {
      /* already closed */
    }
    rmSync(s.dir, { recursive: true, force: true });
  });

  it("reads a three-level dispatch chain as nodes and edges", () => {
    const parent = readyIssue(s.svc, "parent work");
    const child = readyIssue(s.svc, "child work");
    s.prov.dispatch(parent.id, {
      workspace: s.dir,
      participantId: "worker-a",
      activationId: "act_a",
      dispatcherParticipantId: "lead",
      dispatcherSessionId: "$1",
    });
    s.prov.dispatch(child.id, {
      workspace: s.dir,
      participantId: "worker-b",
      activationId: "act_b",
      dispatcherParticipantId: "worker-a",
      dispatcherSessionId: "$2",
    });
    linkPr(s.db, child.id, "xtrm-dev/xtrm", 7, 500);

    const graph = s.prov.dispatchGraph("prj_xtrm");

    assert.equal(graph.projectId, "prj_xtrm");
    assert.equal(graph.since, null);
    assert.equal(graph.limit, 200);
    assert.equal(graph.matchedBindings, 2);
    assert.equal(graph.omittedBindings, 0);
    assert.equal(graph.truncated, false);

    // Human refs are labels, machine ids are the durable node keys.
    const byLabel = new Map(graph.nodes.map((n) => [n.label, n]));
    assert.deepEqual(
      graph.nodes.map((n) => n.kind).sort(),
      ["activation", "activation", "issue", "issue", "participant", "participant", "pull_request"],
    );
    assert.equal(byLabel.get("XTRM-1")?.id, `issue:${parent.id}`);
    assert.equal(byLabel.get("XTRM-2")?.id, `issue:${child.id}`);
    assert.equal(byLabel.get("XTRM-2")?.kind, "issue");
    assert.equal(byLabel.get("lead")?.id, "participant:lead");
    assert.equal(byLabel.get("act_a")?.id, "activation:act_a");
    assert.equal(byLabel.get("lead")?.participantId, "lead");
    // An activation keeps its holder: a leaf worker is never anonymous.
    assert.equal(byLabel.get("act_a")?.participantId, "worker-a");
    assert.equal(byLabel.get("act_b")?.participantId, "worker-b");
    assert.equal(byLabel.get("XTRM-1")?.participantId, null);
    assert.equal(byLabel.get("xtrm-dev/xtrm#7")?.id, "pull_request:xtrm-dev/xtrm#7");
    assert.equal(byLabel.get("xtrm-dev/xtrm#7")?.participantId, null);

    // Lead dispatched worker-a, worker-a dispatched worker-b: two hops, no guess.
    const dispatches = graph.edges.filter((e) => e.kind === "dispatched_by");
    assert.equal(dispatches.length, 2);
    const toA = dispatches.find((e) => e.to === "activation:act_a");
    assert.equal(toA?.from, "participant:lead");
    assert.equal(toA?.dispatcherSessionId, "$1");
    const toB = dispatches.find((e) => e.to === "activation:act_b");
    assert.equal(toB?.from, "participant:worker-a");
    assert.equal(toB?.dispatcherSessionId, "$2");

    const worksOn = graph.edges.filter((e) => e.kind === "works_on");
    assert.equal(worksOn.length, 2);
    assert.ok(worksOn.some((e) => e.from === "activation:act_a" && e.to === `issue:${parent.id}`));

    const delivers = graph.edges.filter((e) => e.kind === "delivers");
    assert.equal(delivers.length, 1);
    assert.equal(delivers[0]!.from, `issue:${child.id}`);
    assert.equal(delivers[0]!.to, "pull_request:xtrm-dev/xtrm#7");
    assert.equal(delivers[0]!.bindingId, null);

    assert.deepEqual(edgeKinds(graph), ["delivers", "dispatched_by", "dispatched_by", "works_on", "works_on"]);
  });

  it("a binding without a dispatcher keeps its edge with a null source", () => {
    const issue = readyIssue(s.svc, "unattributed dispatch");
    s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "worker-c" });

    const graph = s.prov.dispatchGraph("prj_xtrm");
    const dispatched = graph.edges.filter((e) => e.kind === "dispatched_by");
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0]!.from, null);
    assert.equal(dispatched[0]!.to, "participant:worker-c");
    assert.equal(dispatched[0]!.dispatcherSessionId, null);
    // The executor still reaches the Issue: only the dispatcher is unknown.
    const worksOn = graph.edges.filter((e) => e.kind === "works_on");
    assert.equal(worksOn.length, 1);
    assert.equal(worksOn[0]!.from, "participant:worker-c");
    // No node is manufactured for an identity that was never recorded.
    assert.equal(graph.nodes.filter((n) => n.kind === "participant").length, 1);
  });

  it("a binding with no execution identity contributes no edge", () => {
    const issue = readyIssue(s.svc, "no executor");
    s.prov.dispatch(issue.id, { workspace: s.dir, dispatcherParticipantId: "lead" });

    const graph = s.prov.dispatchGraph("prj_xtrm");
    assert.equal(graph.matchedBindings, 1);
    assert.equal(graph.edges.length, 0);
    assert.equal(graph.nodes.length, 0);
  });

  // The live xt launch shape: the dispatcher and the session are recorded and
  // the holder is left to the claim, so the session is the executor.
  it("a binding with only a session falls back to a session executor", () => {
    const issue = readyIssue(s.svc, "session executor");
    s.prov.dispatch(issue.id, {
      workspace: s.dir,
      sessionId: "01a1eee0-4ded-72d6-adf2-a25093b735a1",
      dispatcherParticipantId: "lead",
      dispatcherSessionId: "$1",
    });

    const graph = s.prov.dispatchGraph("prj_xtrm");
    const session = graph.nodes.find((n) => n.kind === "session");
    assert.equal(session?.id, "session:01a1eee0-4ded-72d6-adf2-a25093b735a1");
    assert.equal(session?.label, "01a1eee0-4ded-72d6-adf2-a25093b735a1");
    assert.equal(session?.participantId, null);
    // Same binding time, so the tie-break is the edge kind: dispatched_by first.
    assert.deepEqual(graph.edges.map((e) => [e.kind, e.from, e.to]), [
      ["dispatched_by", "participant:lead", "session:01a1eee0-4ded-72d6-adf2-a25093b735a1"],
      ["works_on", "session:01a1eee0-4ded-72d6-adf2-a25093b735a1", `issue:${issue.id}`],
    ]);
  });

  // The delivers edge is delivery evidence only while the link is live and only
  // for a link that claims to have created the PR. Both predicates are pinned
  // here: removing either one turns the matching case red.
  it("a superseded PR link is not delivery evidence", () => {
    const issue = readyIssue(s.svc, "superseded link");
    s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "worker-a" });
    linkPr(s.db, issue.id, "xtrm-dev/xtrm", 31, 500, { supersededAt: 900 });

    const graph = s.prov.dispatchGraph("prj_xtrm");
    // The binding still contributes its own edges; only delivery is withdrawn.
    assert.deepEqual(edgeKinds(graph), ["dispatched_by", "works_on"]);
    assert.equal(graph.nodes.some((n) => n.kind === "pull_request"), false);
  });

  it("a mentioned PR link is not delivery evidence", () => {
    const issue = readyIssue(s.svc, "mentioned link");
    s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "worker-a" });
    linkPr(s.db, issue.id, "xtrm-dev/xtrm", 32, 500, { relation: "mentioned" });

    const graph = s.prov.dispatchGraph("prj_xtrm");
    assert.deepEqual(edgeKinds(graph), ["dispatched_by", "works_on"]);
    assert.equal(graph.nodes.some((n) => n.kind === "pull_request"), false);
  });

  // One link is stored once per evidence source, and the graph must not draw
  // the same delivery twice or move its time to the later row.
  it("one PR delivered from two sources is one edge at the earliest time", () => {
    const issue = readyIssue(s.svc, "two sources");
    s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "worker-a" });
    linkPr(s.db, issue.id, "xtrm-dev/xtrm", 33, 700, { source: "title" });
    linkPr(s.db, issue.id, "xtrm-dev/xtrm", 33, 500, { source: "explicit" });

    const graph = s.prov.dispatchGraph("prj_xtrm");
    const delivers = graph.edges.filter((e) => e.kind === "delivers");
    assert.equal(delivers.length, 1);
    assert.equal(delivers[0]?.to, "pull_request:xtrm-dev/xtrm#33");
    assert.equal(delivers[0]?.at, 500);
    assert.equal(graph.nodes.filter((n) => n.kind === "pull_request").length, 1);
  });

  // Symmetry with the executor fallback: a dispatcher session is a vertex, not
  // a scalar only the JSON reader can see.
  it("a dispatcher session without a participant is a session vertex", () => {
    const issue = readyIssue(s.svc, "session dispatcher");
    s.prov.dispatch(issue.id, {
      workspace: s.dir,
      participantId: "worker-a",
      dispatcherSessionId: "$9",
    });

    const graph = s.prov.dispatchGraph("prj_xtrm");
    const session = graph.nodes.find((n) => n.kind === "session");
    assert.equal(session?.id, "session:$9");
    const dispatched = graph.edges.find((e) => e.kind === "dispatched_by");
    assert.equal(dispatched?.from, "session:$9");
    assert.equal(dispatched?.dispatcherSessionId, "$9");
  });

  // since bounds dispatch activity, not delivery: a link older than the window
  // still delivers a binding made inside it.
  it("since bounds bindings, and delivers follows the Issue not the link time", () => {
    const issue = readyIssue(s.svc, "old link new binding");
    s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "worker-a" }, { now: 2000 });
    linkPr(s.db, issue.id, "xtrm-dev/xtrm", 34, 100);

    const graph = s.prov.dispatchGraph("prj_xtrm", { since: 1500 });
    assert.equal(graph.matchedBindings, 1);
    const delivers = graph.edges.find((e) => e.kind === "delivers");
    assert.equal(delivers?.to, "pull_request:xtrm-dev/xtrm#34");
    assert.equal(delivers?.at, 100);
  });

  // A binding is counted under the Issue's current project, because the graph is
  // a read of the Issue tree, not of the binding's origin.
  it("the count follows the Issue's current project", () => {
    const issue = readyIssue(s.svc, "moving issue");
    s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "worker-a" });
    s.svc.createProject({ id: "prj_other", prefix: "OTHER", name: "o" });
    s.db.prepare("UPDATE issues SET project_id = ? WHERE id = ?").run("prj_other", issue.id);

    assert.equal(s.prov.dispatchGraph("prj_xtrm").matchedBindings, 0);
    const moved = s.prov.dispatchGraph("prj_other");
    assert.equal(moved.matchedBindings, 1);
    assert.deepEqual(moved.nodes.filter((n) => n.kind === "issue").map((n) => n.label), ["OTHER-1"]);
  });

  it("truncation reports the bindings the bound left out", () => {
    const first = readyIssue(s.svc, "first");
    const second = readyIssue(s.svc, "second");
    const third = readyIssue(s.svc, "third");
    s.prov.dispatch(first.id, { workspace: s.dir, participantId: "w1" }, { now: 1_000 });
    s.prov.dispatch(second.id, { workspace: s.dir, participantId: "w2" }, { now: 2_000 });
    s.prov.dispatch(third.id, { workspace: s.dir, participantId: "w3" }, { now: 3_000 });

    const graph = s.prov.dispatchGraph("prj_xtrm", { limit: 2 });
    assert.equal(graph.limit, 2);
    assert.equal(graph.matchedBindings, 3);
    assert.equal(graph.omittedBindings, 1);
    assert.equal(graph.truncated, true);
    // The newest bindings are the ones read.
    const issueIds = new Set(graph.edges.map((e) => e.issueId));
    assert.ok(issueIds.has(third.id));
    assert.ok(issueIds.has(second.id));
    assert.equal(issueIds.has(first.id), false);
  });

  it("since bounds the window and the match count", () => {
    const first = readyIssue(s.svc, "old");
    const second = readyIssue(s.svc, "new");
    s.prov.dispatch(first.id, { workspace: s.dir, participantId: "w1" }, { now: 1_000 });
    s.prov.dispatch(second.id, { workspace: s.dir, participantId: "w2" }, { now: 3_000 });

    const graph = s.prov.dispatchGraph("prj_xtrm", { since: 2_000 });
    assert.equal(graph.since, 2_000);
    assert.equal(graph.matchedBindings, 1);
    assert.equal(graph.truncated, false);
    assert.deepEqual([...new Set(graph.edges.map((e) => e.issueId))], [second.id]);
  });

  it("fails closed on an unknown project and an out-of-range bound", () => {
    assert.throws(() => s.prov.dispatchGraph("prj_missing"), /unknown project/);
    const issue = readyIssue(s.svc, "bounded");
    s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "w" });
    assert.throws(() => s.prov.dispatchGraph("prj_xtrm", { limit: 0 }), /limit must be an integer between 1 and 1000/);
    assert.throws(() => s.prov.dispatchGraph("prj_xtrm", { limit: 1001 }), /limit must be an integer/);
    assert.throws(() => s.prov.dispatchGraph("prj_xtrm", { since: -1 }), /since must be a non-negative integer/);
  });

  it("the typed service exposes the same read", () => {
    const issue = readyIssue(s.svc, "via service");
    s.prov.dispatch(issue.id, { workspace: s.dir, participantId: "w", dispatcherParticipantId: "lead" });
    const services = createServices(s.db);
    const call = (args: Record<string, unknown>) => {
      assertKnownArgs("provenance.dispatchGraph", args);
      return OPERATIONS["provenance.dispatchGraph"]!(services, args) as {
        projectId: string;
        limit: number;
        edges: Array<{ kind: string; from: string | null }>;
      };
    };
    const graph = call({ projectId: "prj_xtrm", limit: 5 });
    assert.equal(graph.projectId, "prj_xtrm");
    assert.equal(graph.limit, 5);
    assert.deepEqual(graph.edges.map((e) => e.kind).sort(), ["dispatched_by", "works_on"]);
    assert.throws(() => call({ projectId: "prj_xtrm", limit: 5_000 }), /limit/);
    // The operation is advertised and its argument names are declared.
    assert.ok(CAPABILITIES.includes("provenance.dispatchGraph"));
    assert.deepEqual(ARGS["provenance.dispatchGraph"], ["projectId", "since", "limit"]);
  });

  it("CLI: --json carries the graph and the human view names the dispatcher", () => {
    const issue = readyIssue(s.svc, "cli");
    s.prov.dispatch(issue.id, {
      workspace: s.dir,
      participantId: "worker-a",
      dispatcherParticipantId: "lead",
      dispatcherSessionId: "$1",
    });
    linkPr(s.db, issue.id, "xtrm-dev/xtrm", 12, 500);

    const res = runCli(["--db", s.dbPath, "--json", "provenance", "graph", "--project", "prj_xtrm"]);
    assert.equal(res.code, 0, res.stderr);
    const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; data: Record<string, unknown> };
    assert.equal(env.schema, SCHEMA_VERSION);
    assert.equal(env.ok, true);
    assert.equal(env.data["projectId"], "prj_xtrm");
    assert.equal(env.data["truncated"], false);
    assert.equal((env.data["nodes"] as unknown[]).length, 4);
    assert.equal((env.data["edges"] as unknown[]).length, 3);

    const bounded = runCli(["--db", s.dbPath, "--json", "provenance", "graph", "--project", "prj_xtrm", "--limit", "1"]);
    const boundedEnv = JSON.parse(bounded.stdout) as { data: Record<string, unknown> };
    assert.equal(boundedEnv.data["truncated"], false, "one binding is the whole project");

    const text = runCli(["--db", s.dbPath, "provenance", "graph", "--project", "prj_xtrm"]);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /project prj_xtrm: 4 nodes, 3 edges, bindings 1\/1/);
    assert.match(text.stdout, /lead \(sess \$1\) dispatched worker-a on XTRM-1/);
    assert.match(text.stdout, /worker-a works on XTRM-1/);
    assert.match(text.stdout, /XTRM-1 delivers xtrm-dev\/xtrm#12/);

    const iso = runCli(["--db", s.dbPath, "--json", "provenance", "graph", "--project", "prj_xtrm", "--since", "1970-01-01T00:00:00Z"]);
    assert.equal(iso.code, 0, iso.stderr);
    const isoEnv = JSON.parse(iso.stdout) as { data: Record<string, unknown> };
    assert.equal(isoEnv.data["since"], 0);

    const bad = runCli(["--db", s.dbPath, "provenance", "graph", "--project", "prj_xtrm", "--limit", "0"]);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /--limit must be a positive integer/);
  });
});
