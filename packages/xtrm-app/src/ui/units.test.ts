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
 * scale. This test enumerates the primitives, so a new px literal fails the gate instead of the
 * operator's eye (docs/design/console-ui-system.md §3.2 "Unit rule").
 */

const ROOTS = ["src/ui", "src/shell"];
/** The stylesheet owns the tokens; a px `font-size` here would bypass every component. */
const EXTRA = ["src/styles.css"];

const RULES = [
  { pattern: /text-\[\d*\.?\d+px\]/g, why: "px font size: name a text token (text-xs, text-sm)" },
  { pattern: /size-\[\d*\.?\d+px\]/g, why: "px glyph size: use an ICON_CLASS step" },
  { pattern: /\b(size|width|height)=\{\d+(?:\.\d+)?\}/g, why: "px glyph attribute: take an IconSize" },
  { pattern: /fontSize:\s*\d/g, why: "px font style: name a text token" },
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
  it("finds none in src/ui, src/shell or the stylesheet", () => {
    const files = [...ROOTS.flatMap(walk), ...EXTRA];
    // A guard over an empty file list would pass by accident.
    expect(files.length).toBeGreaterThan(30);
    expect(files.flatMap(offenders)).toEqual([]);
  });

  it("is not vacuous: the rule set catches the literal it was written for", () => {
    const sample = ['const a = "text-[11px]";', "const b = <svg width={16} />;", "const c = <Icon size={13} />;"].join("\n");
    const hits = RULES.flatMap((rule) => [...sample.matchAll(rule.pattern)].map((match) => match[0]));
    expect(hits).toEqual(["text-[11px]", "width={16}", "size={13}"]);
  });
});
