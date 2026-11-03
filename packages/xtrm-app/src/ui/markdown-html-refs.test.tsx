import { describe, expect, it } from "vitest";
import rehypeSanitize from "rehype-sanitize";
import { githubHtmlSchema } from "./markdown.tsx";

describe("issue ref survives sanitization in html mode", () => {
  it("keeps the xtrm-ref href on the anchor", () => {
    const tree = {
      type: "root",
      children: [{ type: "element", tagName: "a", properties: { href: "xtrm-ref:issue:XTRM-694" }, children: [{ type: "text", value: "XTRM-694" }] }],
    };
    const out = (rehypeSanitize as any)(githubHtmlSchema)(tree);
    expect(out.children[0].properties.href).toBe("xtrm-ref:issue:XTRM-694");
  });

  it("still strips javascript: hrefs", () => {
    const tree = {
      type: "root",
      children: [{ type: "element", tagName: "a", properties: { href: "javascript:alert(1)" }, children: [{ type: "text", value: "x" }] }],
    };
    const out = (rehypeSanitize as any)(githubHtmlSchema)(tree);
    expect(out.children[0].properties.href).toBeUndefined();
  });
});
