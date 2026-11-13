// Real `sb` payload shapes, not the fixture: the adapter claims `primaryPr`
// on board rows and `pullRequests`/`linkEvents`/`linkGate` on the detail.
import { describe, expect, it } from "vitest";
import { mapBoard, mapIssueCore } from "./live.ts";

describe("live link mapping", () => {
  it("mapBoard carries primaryPr from the projection row", () => {
    const row = {
      id: "iss_1", humanRef: "XTRM-1", locator: "XTRM-1", title: "t", kind: "task", lifecycleState: "open",
      priority: 1, scrutiny: "LOW", revision: 1, readinessState: "ready", dispatchable: true,
      claimState: "none", parentRef: null, parentLocator: null, childCount: 0, childrenTerminal: 0,
      blockedBy: [], createdAt: 1, updatedAt: 1, eventCount: 0, pointerCount: 0,
      attestation: "current", contractComplete: true,
      primaryPr: { repository: "o/r", number: 7, relation: "created_from", url: null, state: "merged" },
    };
    const [summary] = mapBoard([row as never]);
    expect(summary!.primaryPr).toEqual({ repository: "o/r", number: 7, relation: "created_from", url: null, state: "merged" });
  });

  it("mapIssueCore carries pullRequests, linkEvents and linkGate", () => {
    const detail = {
      id: "iss_1", humanRef: "XTRM-1", locator: "XTRM-1", title: "t", kind: "task", lifecycleState: "open",
      revision: 1, readinessState: "ready", dispatchable: true, reasons: [], contract: {}, claim: null,
      closure: null, operationalContext: { total: 0, recent: [], latestByKind: [], latestCheckpoint: null, countsByKind: {} },
      pullRequests: [{ id: 1, repository: "o/r", number: 7, relation: "created_from", sources: ["provenance"], alsoMentioned: false, url: null, actor: "w", createdAt: 1, commits: [], state: "merged", stateSource: "observed", title: "live title", merged_at: 12345 }],
      linkEvents: [{ eventId: 1, type: "provenance.link_created", payload: { number: 7 }, createdAt: 1 }],
      linkGate: { mode: "manual", manual: { verdict: "pass", codes: [] } },
    };
    const mapped = mapIssueCore(detail as never, { projectId: "prj", resume: null, trace: null, journal: [] });
    expect(mapped.pullRequests[0]!.number).toBe(7);
    expect(mapped.linkEvents[0]!.type).toBe("provenance.link_created");
    expect(mapped.linkGate.manual.verdict).toBe("pass");
  });

  it("mapIssueCore maps pull_requests state, title and mergedAt", () => {
    const detail = {
      id: "iss_1", humanRef: "XTRM-1", locator: "XTRM-1", title: "t", kind: "task", lifecycleState: "open",
      revision: 1, readinessState: "ready", dispatchable: true, reasons: [], contract: {}, claim: null,
      closure: null, operationalContext: { total: 0, recent: [], latestByKind: [], latestCheckpoint: null, countsByKind: {} },
      pullRequests: [{ id: 1, repository: "o/r", number: 7, relation: "created_from", sources: ["provenance"], alsoMentioned: false, url: null, actor: "w", createdAt: 1, commits: [], state: "merged", stateSource: "observed", title: "live title", merged_at: 12345 }],
      linkEvents: [], linkGate: { mode: "manual", manual: { verdict: "pass", codes: [] } },
    };
    const mapped = mapIssueCore(detail as never, { projectId: "prj", resume: null, trace: null, journal: [] });
    expect(mapped.pullRequests[0]!.state).toBe("merged");
    expect(mapped.pullRequests[0]!.title).toBe("live title");
    expect(mapped.pullRequests[0]!.mergedAt).toBe(12345);
    expect(mapped.pullRequests[0]!.stateSource).toBe("observed");
  });
});
