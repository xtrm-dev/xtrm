import { describe, expect, it } from "vitest";
import { WORKERS_LAYOUT_GRAPH } from "./layout-fixture.ts";
import { buildWorkersTree } from "./model.ts";
import { missingTitleRefs, TITLE_READ_LIMIT } from "./titles.ts";

/**
 * XTRM-918: the board index covered far fewer issues than the graph names, so a nameless vertex whose
 * issue was outside that window had no title to borrow. These are the refs the surface must read.
 */
const model = () => buildWorkersTree(WORKERS_LAYOUT_GRAPH, []);
const index = (...refs: string[]) => new Map(refs.map((ref) => [ref, { ref }]));

describe("Workers title reads", () => {
  it("asks for every issue a nameless row prints, deduplicated", () => {
    // The layout graph's nameless vertices are its sessions: one under the lead on XTRM-302 and two
    // in the unknown-dispatcher group, both on XTRM-303. An activation whose participant is a human
    // name prints that name, so its issue is not asked for.
    expect(missingTitleRefs(model(), index())).toEqual(["XTRM-302", "XTRM-303"]);
  });

  it("asks for nothing the board index already carries, and nothing without a model", () => {
    expect(missingTitleRefs(model(), index("XTRM-301", "XTRM-302", "XTRM-303", "XTRM-304"))).toEqual([]);
    expect(missingTitleRefs(model(), index("XTRM-302"))).toEqual(["XTRM-303"]);
    expect(missingTitleRefs(null, index())).toEqual([]);
  });

  it("caps the read at the stated bound", () => {
    expect(missingTitleRefs(model(), index())).toHaveLength(2);
    expect(missingTitleRefs(model(), index(), 1)).toEqual(["XTRM-302"]);
    expect(TITLE_READ_LIMIT).toBe(50);
  });
});
