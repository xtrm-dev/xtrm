import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ProjectDispatchGraph } from "../../adapters/substrate/graph.ts";
import { buildWorkersTree } from "./model.ts";
import { WorkersTree } from "./WorkersTree.tsx";

/** A graph whose two workers dispatch each other, plus one that dispatches itself. */
function cycleGraph(edges: Array<{ from: string; to: string }>): ProjectDispatchGraph {
  const ids = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  return {
    projectId: "prj_cycle",
    since: null,
    limit: null,
    nodes: ids.map((id) => ({
      id,
      kind: "activation" as const,
      label: id,
      participantId: id.replace(/^activation:/, ""),
    })),
    edges: edges.map((e) => ({
      kind: "dispatched_by" as const,
      from: e.from,
      to: e.to,
      issueId: "iss_1",
      issueRef: null,
      at: "2026-11-18T10:00:00Z",
      bindingId: null,
      dispatcherSessionId: null,
    })),
    matchedBindings: edges.length,
    omittedBindings: 0,
    truncated: false,
  };
}

const now = Date.parse("2026-11-18T12:00:00Z");

describe("Workers tree dispatch cycles", () => {
  it("renders both workers of a two-node cycle instead of dropping them", () => {
    const graph = cycleGraph([
      { from: "activation:act_a", to: "activation:act_b" },
      { from: "activation:act_b", to: "activation:act_a" },
    ]);
    const model = buildWorkersTree(graph, []);
    // Neither worker is a root and neither is a dispatcher-less vertex, so the cycle is the only
    // place they can appear; before the sweep both vanished with roots=0 and unknown=0.
    expect(model.roots).toHaveLength(0);
    expect(model.cycles.map((n) => n.id).sort()).toEqual(["activation:act_a", "activation:act_b"]);

    render(<WorkersTree model={model} now={now} />);
    const rows = screen.getAllByTestId("worker-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByTestId("workers-cycles").textContent).toContain("dispatch cycle");
  });

  it("renders a worker that dispatches itself", () => {
    const graph = cycleGraph([{ from: "activation:act_self", to: "activation:act_self" }]);
    const model = buildWorkersTree(graph, []);
    expect(model.roots).toHaveLength(0);
    expect(model.unknown).toHaveLength(0);
    expect(model.cycles.map((n) => n.id)).toEqual(["activation:act_self"]);

    render(<WorkersTree model={model} now={now} />);
    expect(screen.getAllByTestId("worker-row")).toHaveLength(1);
  });

  it("keeps a vertex that merely hangs off a cycle out of the cycle group", () => {
    // a -> b -> a is the cycle; c is dispatched by a but is not itself on it.
    const graph = cycleGraph([
      { from: "activation:act_a", to: "activation:act_b" },
      { from: "activation:act_b", to: "activation:act_a" },
      { from: "activation:act_a", to: "activation:act_c" },
    ]);
    const model = buildWorkersTree(graph, []);
    const inCycle = model.cycles.map((n) => n.id);
    const inUnknown = model.unknown.map((n) => n.id);
    for (const id of ["activation:act_a", "activation:act_b", "activation:act_c"]) {
      expect([...inCycle, ...inUnknown]).toContain(id);
    }
  });
});
