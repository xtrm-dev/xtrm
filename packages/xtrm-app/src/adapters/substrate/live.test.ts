import { describe, expect, it, vi } from "vitest";
import { SubstrateReadError, liveSubstrate, mapBoard, mapIssueDetail, mapProjects, unwrap, type WireProjectionRow } from "./live.ts";

const row = (id: string, extra: Partial<WireProjectionRow> = {}): WireProjectionRow => ({
  id,
  humanRef: id.toUpperCase(),
  locator: id.toUpperCase(),
  title: id,
  kind: "task",
  lifecycleState: "open",
  priority: 1,
  scrutiny: "LOW",
  revision: 1,
  readinessState: "draft",
  dispatchable: false,
  claimState: "none",
  parentRef: null,
  parentLocator: null,
  childCount: 0,
  childrenTerminal: 0,
  blockedBy: [],
  createdAt: 1,
  updatedAt: 2,
  ...extra,
});

describe("substrate envelope mapping", () => {
  it("rejects failed or foreign envelopes", () => {
    expect(() => unwrap({ schema: "substrate-cli/v1", command: "issue.list", ok: false, error: "boom" })).toThrow("boom");
    expect(() => unwrap({ schema: "other/v9", command: "x", ok: true, data: [] })).toThrow(SubstrateReadError);
  });

  it("joins project links", () => {
    const [p] = mapProjects([{ id: "prj_xtrm", prefix: "XTRM", name: "xtrm" }], { links: [{ gitRoot: "/r/xtrm", projectId: "prj_xtrm" }, { gitRoot: "/r/core", projectId: "prj_core" }] });
    expect(p?.gitRoots).toEqual(["/r/xtrm"]);
  });

  it("maps projection rows to Jira rows, reading readiness from the row", () => {
    const rows = mapBoard([
      row("epic", { priority: 1, childCount: 2, childrenTerminal: 1 }),
      row("a", { priority: 0, readinessState: "ready", dispatchable: true, parentRef: "EPIC", parentLocator: "EPIC" }),
      row("b", { lifecycleState: "done", readinessState: "terminal", priority: 2 }),
      row("c", { priority: 3, blockedBy: ["A"] }),
    ]);
    const byRef = Object.fromEntries(rows.map((r) => [r.ref, r]));
    expect(byRef.EPIC).toMatchObject({ childCount: 2, childrenDone: 1, priority: 1 });
    expect(byRef.A).toMatchObject({ parentRef: "EPIC", readiness: "ready", priority: 0 });
    // b is done, so only a still blocks c; the projection's blockedBy is authoritative
    expect(byRef.C?.blockedBy).toEqual(["A"]);
    expect(byRef.B?.readiness).toBe("terminal");
  });

  it("performs exactly one substrate read kind per project (no /export, no /ready)", async () => {
    const calls: string[] = [];
    const pages = [
      { rows: [row("a", { readinessState: "ready", dispatchable: true })], nextCursor: "c1", hasMore: true, scanned: 1, truncated: false },
      { rows: [row("b", { readinessState: "blocked", blockedBy: ["A"] })], nextCursor: null, hasMore: false, scanned: 1, truncated: false },
    ];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      const page = pages[n++] ?? pages[pages.length - 1]!;
      return { status: 200, json: async () => ({ schema: "substrate-cli/v1", command: "issue.query", ok: true, data: page }) } as unknown as Response;
    }));
    try {
      const rows = await liveSubstrate.listIssues("prj_xtrm");
      expect(calls).toHaveLength(2);
      expect(calls.every((u) => u.startsWith("/xtrm-api/substrate/query?"))).toBe(true);
      expect(calls.some((u) => u.includes("/export") || u.includes("/ready") || u.includes("/issues?"))).toBe(false);
      expect(calls[1]).toContain("cursor=c1");
      const byRef = Object.fromEntries(rows.map((r) => [r.ref, r]));
      expect(rows).toHaveLength(2);
      expect(byRef.A?.readiness).toBe("ready");
      expect(byRef.B?.readiness).toBe("blocked");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps detail with lineage, journal order, and lossless contract", () => {
    const board = mapBoard([
      row("epic", { priority: 1 }),
      row("a", { priority: 2, parentRef: "EPIC", parentLocator: "EPIC" }),
    ]);
    const d = mapIssueDetail(
      { ...row("a"), readinessState: "draft", dispatchable: false, reasons: ["scope: empty"], contract: { problem: "p", success: "s", scope: [], nonGoals: [], constraints: [], validation: [{ check: "c1", extra: true }], output: [], scrutiny: "LOW" } },
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

  it("carries an ADR-009 unreadable marker through mapping without inventing a summary", () => {
    const marker = "unreadable: jrn_bad: result.summary must be a non-empty string";
    const mapped = mapJournalEntry({ id: "jrn_bad", sequence: 4, kind: "result", issueRevision: 2, createdAt: 1, unreadable: marker });
    expect(mapped.unreadable).toBe(marker);
    expect(mapped.summary).toBe("");
    expect(mapped.result).toBeNull();
    expect(mapped.semantic).toBeNull();
  });

  it("maps missing trace, closure, and attestation to explicit empty values", () => {
    expect(mapTrace(null, [])).toEqual({ attestation: null, claims: [], bindings: [], receipts: [], checkpoints: [], commits: [], prs: [], externalBindings: [] });
    expect(mapClosure({ closed: true, closedAt: 5, reason: null })).toMatchObject({ closed: true, outcome: null, actor: null, revision: null, contractHash: null });
  });
});
