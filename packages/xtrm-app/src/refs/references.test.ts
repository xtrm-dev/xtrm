import { describe, expect, it } from "vitest";
import { formatReference, parseReference, remarkReferences } from "./references.tsx";

type Node = { type: string; value?: string; url?: string; children?: Node[] };
const tree = (children: Node[]): Node => ({ type: "root", children: [{ type: "paragraph", children }] });
const run = (t: Node) => (remarkReferences()(t as never), t);

describe("context references", () => {
  it("round-trips the serialized @kind:ref form", () => {
    expect(formatReference({ kind: "issue", ref: "XTRM-3" })).toBe("@issue:XTRM-3");
    expect(parseReference("@issue:XTRM-252.13.1")).toEqual({ kind: "issue", ref: "XTRM-252.13.1" });
    expect(parseReference("XTRM-3")).toBeNull();
  });

  it("links explicit and bare issue keys inside text", () => {
    const t = run(tree([{ type: "text", value: "See @issue:XTRM-3 and XTRM-252.13.1." }]));
    const para = t.children![0]!.children!;
    expect(para.map((n) => n.type)).toEqual(["text", "link", "text", "link", "text"]);
    expect(para[1]!.url).toBe("xtrm-ref:issue:XTRM-3");
    expect(para[3]!.url).toBe("xtrm-ref:issue:XTRM-252.13.1");
  });

  it("leaves inline code and existing links alone", () => {
    const t = run(tree([
      { type: "inlineCode", value: "XTRM-3" },
      { type: "link", url: "https://x", children: [{ type: "text", value: "XTRM-4" }] },
    ]));
    expect(t.children![0]!.children!.map((n) => n.type)).toEqual(["inlineCode", "link"]);
    expect(t.children![0]!.children![1]!.url).toBe("https://x");
  });
});

