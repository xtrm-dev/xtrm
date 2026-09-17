import { describe, expect, it } from "vitest";
import { SubstrateReadError, mapBoard, mapIssueDetail, mapProjects, unwrap, type WireExport, type WireIssue } from "./live.ts";

const wire = (id: string, extra: Partial<WireIssue> = {}): WireIssue => ({ id, humanRef: id.toUpperCase(), title: id, kind: "task", lifecycleState: "open", revision: 1, ...extra });
const meta = (id: string, priority: number) => ({ issue: { id, kind: "task", title: id, lifecycleState: "open", priority, scrutiny: "LOW", currentRevision: 1, createdAt: 1, updatedAt: 2 } });

describe("substrate envelope mapping", () => {
  it("rejects failed or foreign envelopes", () => {
    expect(() => unwrap({ schema: "substrate-cli/v1", command: "issue.list", ok: false, error: "boom" })).toThrow("boom");
    expect(() => unwrap({ schema: "other/v9", command: "x", ok: true, data: [] })).toThrow(SubstrateReadError);
  });

  it("joins project links", () => {
    const [p] = mapProjects([{ id: "prj_xtrm", prefix: "XTRM", name: "xtrm" }], { links: [{ gitRoot: "/r/xtrm", projectId: "prj_xtrm" }, { gitRoot: "/r/core", projectId: "prj_core" }] });
    expect(p?.gitRoots).toEqual(["/r/xtrm"]);
  });

  it("builds Jira rows from list + export + ready without per-issue reads", () => {
    const list = [wire("epic"), wire("a"), wire("b", { lifecycleState: "done" }), wire("c")];
    const exported: WireExport = {
      issues: [meta("epic", 1), meta("a", 0), meta("b", 2), meta("c", 3)],
      edges: [
        { fromIssue: "epic", toIssue: "a", kind: "parent_child", active: true },
        { fromIssue: "epic", toIssue: "b", kind: "parent_child", active: true },
        { fromIssue: "a", toIssue: "c", kind: "blocks", active: true },
        { fromIssue: "b", toIssue: "c", kind: "blocks", active: true },
        { fromIssue: "epic", toIssue: "c", kind: "blocks", active: false },
      ],
    };
    const rows = mapBoard(list, exported, [wire("a", { dispatchable: true })]);
    const byRef = Object.fromEntries(rows.map((r) => [r.ref, r]));
    expect(byRef.EPIC).toMatchObject({ childCount: 2, childrenDone: 1, priority: 1 });
    expect(byRef.A).toMatchObject({ parentRef: "EPIC", readiness: "ready", priority: 0 });
    // b is done, so only a still blocks c; inactive edges are ignored
    expect(byRef.C?.blockedBy).toEqual(["A"]);
  });

  it("degrades to list-only rows when export is unavailable", () => {
    const [row] = mapBoard([wire("a")], null, []);
    expect(row).toMatchObject({ priority: null, childCount: 0, readiness: "unknown" });
  });

  it("maps detail with lineage, journal order, and lossless contract", () => {
    const board = mapBoard([wire("epic"), wire("a")], { issues: [meta("epic", 1), meta("a", 2)], edges: [{ fromIssue: "epic", toIssue: "a", kind: "parent_child", active: true }] }, []);
    const d = mapIssueDetail(
      { ...wire("a"), readinessState: "draft", dispatchable: false, reasons: ["scope: empty"], contract: { problem: "p", success: "s", scope: [], nonGoals: [], constraints: [], validation: [{ check: "c1", extra: true }], output: [], scrutiny: "LOW" } },
      {
        projectId: "prj_x",
        board,
        resume: null,
        trace: { commits: [{ sha: "abc123" }], prs: ["#206"] },
        journal: [
          { id: "j1", sequence: 1, kind: "note", issueRevision: 1, createdAt: 1, semantic: { summary: "first" } },
          { id: "j2", sequence: 2, kind: "decision", issueRevision: 1, createdAt: 2, semantic: { summary: "second" } },
        ],
      },
    );
    expect(d.parent?.ref).toBe("EPIC");
    expect(d.priority).toBe(2);
    expect(d.journal.map((j) => j.summary)).toEqual(["second", "first"]);
    expect(d.contract.validation).toEqual([{ text: "c1", raw: { check: "c1", extra: true } }]);
    expect(d.contract.raw.scrutiny).toBe("LOW");
    expect(d.provenance).toMatchObject({ commits: ["abc123"], prs: ["#206"] });
  });
});

// Captured from `sb --json` (sb 0.2.0, 2026-09-17); long result summaries truncated, no secrets.
import sb404 from "./__fixtures__/sb-XTRM-404.json";
import sb421 from "./__fixtures__/sb-XTRM-421.json";
import { mapClosure, mapJournalEntry, mapTrace, type WireJournalEntry, type WireTrace } from "./live.ts";

describe("full Substrate journal, provenance, and closure mapping", () => {
  it("maps closure, attestation, and claims of a closed issue (XTRM-404)", () => {
    const closure = mapClosure(sb404.show.closure);
    expect(closure).toEqual({
      closed: true,
      closedAt: sb404.show.closure.closedAt,
      reason: sb404.show.closure.reason,
      closureId: sb404.show.closure.closureId,
      outcome: "completed",
      actor: "claude-code::xtrm-xt-claude-o8h2",
      session: null,
      revision: 1,
      contractHash: sb404.show.closure.contractHash,
    });
    const journal = (sb404.journal as WireJournalEntry[]).map(mapJournalEntry);
    const trace = mapTrace(sb404.trace as WireTrace, journal);
    expect(trace.attestation).toMatchObject({ outcome: "ready", policy: "default", attestedBy: "claude-code::xtrm-xt-claude-o8h2", revision: 1, evidenceRefs: [], blockingGaps: [] });
    expect(trace.attestation?.contractHash).toBe(sb404.trace.contractHash);
    expect(trace.claims).toEqual([{ holder: "pi/xtrm-404", activationId: null, acquiredAt: 1789594701718, expiresAt: 1789595601718, releasedAt: null, generation: 1, revision: 1 }]);
    expect(trace).toMatchObject({ bindings: [], receipts: [], checkpoints: [], commits: [], prs: [], externalBindings: [] });
    expect(journal).toHaveLength(sb404.journal.length);
  });

  it("maps journal identity, result, and execution context verbatim (XTRM-421)", () => {
    const journal = (sb421.journal as WireJournalEntry[]).map(mapJournalEntry);
    const result = journal.find((j) => j.kind === "result")!;
    expect(result.identity).toEqual({ participantId: "specialist::executor", activationId: "act:e305f40b-220", sessionId: "01a0af77-fb2e-719a-816a-22cb768f5ced", runId: null });
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.result).toMatchObject({ resultVersion: 1 });
    expect(result.executionContext).toMatchObject({ participantId: "specialist::executor" });
    const note = journal.find((j) => j.kind === "note")!;
    expect(note.result).toBeNull();
    expect(note.mechanical).toBeNull();
  });

  it("maps bindings with named actors and receipts with artifacts (XTRM-421)", () => {
    const trace = mapTrace(sb421.trace as WireTrace, []);
    expect(trace.bindings).toHaveLength(3);
    expect(trace.bindings[0]).toMatchObject({ participantId: "specialist::executor", activationId: "act:e305f40b-220", attemptId: "att:e305f40b-220:1", sessionId: "01a0af77-fb2e-719a-816a-22cb768f5ced" });
    expect(trace.receipts[0]).toMatchObject({ bindingId: trace.bindings[0]!.id, commitSha: null, checkpointId: null, checkpointSequence: null });
    expect(trace.receipts[0]!.artifacts[0]).toEqual({ kind: "artifact", value: "act:e305f40b-220/att:e305f40b-220:1.json", provider: null, superseded: false });
  });

  it("links a receipt to its commit and settling checkpoint, and keeps PR values (XTRM-415/416 shape)", () => {
    const journal = [mapJournalEntry({ id: "jrn_cp", sequence: 7, kind: "checkpoint", issueRevision: 2, createdAt: 1, semantic: { summary: "settled", next: ["merge"] } })];
    const trace = mapTrace(
      {
        receipts: [{ id: "rcp_1", executionBindingId: "exb_1", issueRevision: 2, commitSha: "0123456789abcdef", journalCheckpointId: "jrn_cp", validationRefs: [{ kind: "validation", value: "npm test", provider: null }], artifacts: [], createdAt: 1, finalizedAt: 2 }],
        prs: [{ value: "xtrm-dev/xtrm#211", provider: "github" }],
        externalBindings: [{ provider: "github", scope: "xtrm-dev/xtrm", remoteId: "211", url: null }],
      },
      journal,
    );
    expect(trace.receipts[0]).toMatchObject({ commitSha: "0123456789abcdef", checkpointId: "jrn_cp", checkpointSequence: 7 });
    expect(trace.prs).toEqual(["xtrm-dev/xtrm#211"]);
    expect(trace.externalBindings).toEqual([{ provider: "github", scope: "xtrm-dev/xtrm", remoteId: "211", url: null }]);
    expect(journal[0]).toMatchObject({ summary: "settled", semantic: { next: ["merge"] } });
  });

  it("maps missing trace, closure, and attestation to explicit empty values", () => {
    expect(mapTrace(null, [])).toEqual({ attestation: null, claims: [], bindings: [], receipts: [], checkpoints: [], commits: [], prs: [], externalBindings: [] });
    expect(mapClosure({ closed: true, closedAt: 5, reason: null })).toMatchObject({ closed: true, outcome: null, actor: null, revision: null, contractHash: null });
  });
});
