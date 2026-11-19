import { describe, expect, it } from "vitest";
import { emptyDispatchGraph, parseDispatchGraph } from "./graph.ts";

describe("dispatch graph wire parsing", () => {
  it("keeps the vertices and edges it understands", () => {
    const graph = parseDispatchGraph({
      projectId: "prj_xtrm",
      since: null,
      limit: 200,
      matchedBindings: 2,
      omittedBindings: 0,
      truncated: false,
      nodes: [
        { id: "participant:e9rd", kind: "participant", label: "e9rd", participantId: "e9rd" },
        { id: "activation:act_1", kind: "activation", label: "act_1", participantId: "worker-a" },
        { id: "issue:iss_1", kind: "issue", label: "XTRM-857", participantId: null },
        { id: "pull_request:xtrm-dev/xtrm#441", kind: "pull_request", label: "xtrm-dev/xtrm#441", participantId: null },
      ],
      edges: [
        { kind: "works_on", from: "activation:act_1", to: "issue:iss_1", issueId: "iss_1", at: 10, bindingId: "exb_1", dispatcherSessionId: null },
        { kind: "dispatched_by", from: "participant:e9rd", to: "activation:act_1", issueId: "iss_1", at: 10, bindingId: "exb_1", dispatcherSessionId: "sess_1" },
        { kind: "delivers", from: "issue:iss_1", to: "pull_request:xtrm-dev/xtrm#441", issueId: "iss_1", at: 20, bindingId: null, dispatcherSessionId: null },
      ],
    });
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges.map((e) => e.kind)).toEqual(["works_on", "dispatched_by", "delivers"]);
    // The issue ref is resolved from the issue vertex, so a row never renders a bare uuid.
    expect(graph.edges[0]!.issueRef).toBe("XTRM-857");
    expect(graph.edges[1]!.dispatcherSessionId).toBe("sess_1");
    expect(graph.matchedBindings).toBe(2);
    expect(graph.truncated).toBe(false);
  });

  it("drops a vertex or edge whose kind the app does not model, and keeps a null dispatcher null", () => {
    const graph = parseDispatchGraph({
      nodes: [
        { id: "activation:act_1", kind: "activation", label: "act_1", participantId: null },
        { id: "mystery:m1", kind: "mystery", label: "m1" },
        { id: "issue:iss_1", kind: "issue", label: "XTRM-1" },
      ],
      edges: [
        { kind: "dispatched_by", from: null, to: "activation:act_1", issueId: "iss_1", at: 1, bindingId: "exb_1", dispatcherSessionId: null },
        { kind: "haunts", from: null, to: "issue:iss_1", issueId: "iss_1", at: 1 },
      ],
    });
    expect(graph.nodes.map((n) => n.id)).toEqual(["activation:act_1", "issue:iss_1"]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!.from).toBeNull();
  });

  it("answers an unreadable payload with the empty graph instead of throwing", () => {
    expect(parseDispatchGraph(null).nodes).toEqual([]);
    expect(parseDispatchGraph({ nodes: "nope", edges: 7 }).edges).toEqual([]);
    expect(emptyDispatchGraph("prj_x").truncated).toBe(false);
  });
});
