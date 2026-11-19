import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * XTRM-907, review of XTRM-897: the console has ONE type scale and ONE glyph scale, both in rem
 * (`body` takes `--text-sm` = 0.8125rem). A component that names its own px value renders 1.33x too
 * large at the operator's 12px root: `text-[11px]` section headers became the largest text in the
 * sidebar, and a `size={16}` octocat mark stayed put while the text beside it shrank.
 *
 * Rem is not a style preference here, it is the invariant that keeps every surface on the same
 * scale. This test enumerates every source file under `src`, so a new px literal anywhere in the
 * console fails the gate instead of the operator's eye (docs/design/console-ui-system.md §3.2
 * "Unit rule").
 *
 * The rule set covered `src/ui` + `src/shell` first; the review of #454 found the same literals in
 * `src/project`, `src/github` and `src/issues`, so the walk now covers all of `src`.
 */

const ROOT = "src";

const RULES = [
  { pattern: /text-\[\d*\.?\d+px\]/g, why: "px font size: name a text token (text-2xs, text-xs, text-sm)" },
  { pattern: /size-\[\d*\.?\d+px\]/g, why: "px glyph size: use an ICON_CLASS step or a rem value" },
  { pattern: /\b(size|width|height)=\{\d+(?:\.\d+)?\}/g, why: "px glyph attribute: take an IconSize" },
  { pattern: /fontSize:\s*\d/g, why: "px font style: name a text token" },
  // The stylesheet and an inline style are the two forms a className cannot reach around.
  { pattern: /font-size:\s*\d*\.?\d+px/g, why: "px font-size in CSS: use var(--text-*)" },
  { pattern: /fontSize:\s*["'`]\d*\.?\d+px["'`]/g, why: "px font style: use var(--text-*)" },
];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (!/\.(tsx?|css)$/.test(entry.name)) return [];
    return /\.test\.tsx?$/.test(entry.name) ? [] : [path];
  });

const offenders = (file: string) => {
  const source = readFileSync(file, "utf8");
  return RULES.flatMap((rule) =>
    [...source.matchAll(rule.pattern)].map((match) => {
      const line = source.slice(0, match.index).split("\n").length;
      return `${relative(process.cwd(), file)}:${line} ${match[0]} — ${rule.why}`;
    }),
  );
};

describe("the console has no px font size or glyph size outside the ladder", () => {
  it("finds none in any source file under src", () => {
    const files = walk(ROOT);
    // A guard over an empty file list would pass by accident.
    expect(files.length).toBeGreaterThan(120);
    expect(files, "the stylesheet must be in the walk").toContain(join("src", "styles.css"));
    expect(files.flatMap(offenders)).toEqual([]);
  });

  it("is not vacuous: every rule catches the literal it was written for", () => {
    const sample = [
      'const a = "text-[11px]";',
      'const b = "size-[11px]";',
      "const c = <svg width={16} />;",
      "const d = <Icon size={13} />;",
      'const e = { fontSize: "11px" };',
      "h1 { font-size: 11px; }",
    ].join("\n");
    const hits = RULES.flatMap((rule) => [...sample.matchAll(rule.pattern)].map((match) => match[0]));
    expect(hits).toEqual(["text-[11px]", "size-[11px]", "width={16}", "size={13}", "font-size: 11px", 'fontSize: "11px"']);
  });
});
