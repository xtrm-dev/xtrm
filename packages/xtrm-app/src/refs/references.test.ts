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
    expect(formatReference({ kind: "pr", ref: "xtrm-dev/xtrm#206" })).toBe("@pr:xtrm-dev/xtrm#206");
    expect(parseReference("@pr:xtrm-dev/xtrm#206")).toEqual({ kind: "pr", ref: "xtrm-dev/xtrm#206" });
    expect(parseReference("@pr:not-a-pr")).toBeNull();
  });

  it("links explicit and bare issue keys inside text", () => {
    const t = run(tree([{ type: "text", value: "See @issue:XTRM-3 and XTRM-252.13.1." }]));
    const para = t.children![0]!.children!;
    expect(para.map((n) => n.type)).toEqual(["text", "link", "text", "link", "text"]);
    expect(para[1]!.url).toBe("xtrm-ref:issue:XTRM-3");
    expect(para[3]!.url).toBe("xtrm-ref:issue:XTRM-252.13.1");
  });

  it("links bare #N and canonical owner/repo#N pull requests inside text", () => {
    const t = run(tree([{ type: "text", value: "Fixes #1000, follow-up to xtrm-dev/xtrm#206." }]));
    const para = t.children![0]!.children!;
    expect(para.map((n) => n.type)).toEqual(["text", "link", "text", "link", "text"]);
    expect(para[1]!.url).toBe("xtrm-ref:pr:#1000");
    expect(para[3]!.url).toBe("xtrm-ref:pr:xtrm-dev/xtrm#206");
  });

  it("leaves path-like repos alone: . and .. segments are never chips", () => {
    const text = "traversal ../..#5 and ./x#1 and .owner/repo#2 stay prose";
    const out = run(tree([{ type: "text", value: text }]));
    expect(out.children?.[0]?.children).toEqual([{ type: "text", value: text }]);
  });

  it("leaves lookalikes alone: a bare number glued to a word, a single-segment repo ref", () => {
    const t = run(tree([{ type: "text", value: "not #1000abc and not repo#12." }]));
    expect(t.children![0]!.children!.map((n) => n.type)).toEqual(["text"]);
  });

  it("links explicit PR references inside text", () => {
    const t = run(tree([{ type: "text", value: "See @pr:xtrm-dev/xtrm#206 for context." }]));
    const para = t.children![0]!.children!;
    expect(para.map((n) => n.type)).toEqual(["text", "link", "text"]);
    expect(para[1]!.url).toBe("xtrm-ref:pr:xtrm-dev/xtrm#206");
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

