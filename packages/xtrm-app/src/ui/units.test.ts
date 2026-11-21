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

/**
 * XTRM-934 (epic XTRM-933): px was never the only way off the scale. Moving off px produced a
 * second, quieter drift — 53 `text-[0.6…0.7rem]` literals across 17 files, each a private copy of a
 * step the scale already has (`text-2xs` 0.625 / `text-xs` 0.72). Two adjacent labels then differ by
 * 0.3px in CSS and by nothing at all in intent, and nobody can tell which one is canonical.
 *
 * The rules below close that hole and the px-indent hole beside it:
 * - a rem font size must BE a token (`text-[0.7rem]` is refused; 0.7 is not a step),
 * - a row indent must be derived, not a bare number (`paddingLeft: depth * 16` cannot follow root),
 * - the old px rules stay.
 *
 * Scope excludes `src/agent/**` and `src/components/reui/**`: the Agent half has its own redesign
 * epic and the reui copies are unused scaffolding (epic XTRM-933 non-goals). Everything else is the
 * console language and is in scope.
 */
const OUT_OF_SCOPE = [join("src", "agent"), join("src", "components", "reui")];

/**
 * Known debt, with the slice that pays it. An entry that no longer has an offender FAILS: the list
 * shrinks as the slices land and cannot be used as a permanent parking lot.
 */
const DEBT: Record<string, string> = {
  [join("src", "issues", "PullRequestsBlock.tsx")]: "XTRM-941",
  [join("src", "github", "identity.tsx")]: "XTRM-941",
  [join("src", "shell", "ContextSidebar.tsx")]: "XTRM-939",
  [join("src", "surfaces", "ActivitySurface.tsx")]: "XTRM-936",
  [join("src", "project", "workers", "WorkerRow.tsx")]: "XTRM-936",
  [join("src", "settings", "SettingsSurface.tsx")]: "XTRM-937",
};

/** Every rem value the type scale actually defines (styles.css §typography). */
const REM_TOKENS = ["0.625rem", "0.72rem", "0.8125rem", "0.875rem", "1.125rem", "1.25rem", "1.5rem", "2rem"];
const OFFSCALE_REM = new RegExp(`text-\\[(?!${REM_TOKENS.map((r) => r.replace(".", "\\.")).join("|")})[\\d.]+rem\\]`, "g");

const RULES = [
  { pattern: /text-\[\d*\.?\d+px\]/g, why: "px font size: name a text token (text-2xs, text-xs, text-sm)" },
  { pattern: OFFSCALE_REM, why: `off-scale rem font size: ${REM_TOKENS.join(" / ")} are the only steps` },
  { pattern: /size-\[\d*\.?\d+px\]/g, why: "px glyph size: use an ICON_CLASS step or a rem value" },
  { pattern: /\b(size|width|height)=\{\d+(?:\.\d+)?\}/g, why: "px glyph attribute: take an IconSize" },
  { pattern: /fontSize:\s*\d/g, why: "px font style: name a text token" },
  // A row indent in px does not follow the operator's root size: derive it from INDENT_REM.
  { pattern: /paddingLeft:\s*\d+(?:\.\d+)?\b/g, why: "px indent: derive it from INDENT_REM (src/issues/issue-table.ts)" },
  { pattern: /paddingLeft:\s*[\w.]+\s*\*\s*\d+(?:\.\d+)?\s*\}/g, why: "numeric indent multiplier: use INDENT_REM so the step follows root" },
  // The stylesheet and an inline style are the two forms a className cannot reach around.
  { pattern: /font-size:\s*\d*\.?\d+px/g, why: "px font-size in CSS: use var(--text-*)" },
  { pattern: /fontSize:\s*["'`]\d*\.?\d+px["'`]/g, why: "px font style: use var(--text-*)" },
];

const inScope = (file: string) => !OUT_OF_SCOPE.some((dir) => file.startsWith(dir + "/") || file.startsWith(dir + join("")));

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (!/\.(tsx?|css)$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return inScope(path) ? [path] : [];
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
  it("finds none in any in-scope source file under src", () => {
    const files = walk(ROOT);
    // A guard over an empty file list would pass by accident.
    expect(files.length).toBeGreaterThan(120);
    expect(files, "the stylesheet must be in the walk").toContain(join("src", "styles.css"));
    expect(files.filter((f) => f.startsWith(join("src", "agent"))), "agent is out of scope").toEqual([]);
    const parked = (file: string) => relative(process.cwd(), file) in DEBT;
    expect(files.filter((file) => !parked(file)).flatMap(offenders)).toEqual([]);
  });

  it("keeps the known debt list shrinking instead of permanent", () => {
    // Every parked file still has an offender (an entry that no longer offends must be deleted), and
    // every parked file is one a slice owns.
    const stale = Object.keys(DEBT).filter((file) => offenders(file).length === 0);
    expect(stale, "stale debt entries: the slice migrated the file, delete the entry").toEqual([]);
    expect(Object.values(DEBT).every((owner) => /^XTRM-\d+/.test(owner))).toBe(true);
  });

  it("is not vacuous: every rule catches the literal it was written for", () => {
    const sample = [
      'const a = "text-[11px]";',
      'const b = "size-[11px]";',
      "const c = <svg width={16} />;",
      "const d = <Icon size={13} />;",
      'const e = { fontSize: "11px" };',
      'const f = "text-[0.7rem]";',
      'const g = "text-[0.625rem]";',
      "const h = { paddingLeft: 16 };",
      "const i = { paddingLeft: depth * 16 };",
      "h1 { font-size: 11px; }",
    ].join("\n");
    const hits = RULES.flatMap((rule) => [...sample.matchAll(rule.pattern)].map((match) => match[0]));
    expect(hits).toEqual([
      "text-[11px]",
      "text-[0.7rem]",
      "size-[11px]",
      "width={16}",
      "size={13}",
      "paddingLeft: 16",
      "paddingLeft: depth * 16 }",
      "font-size: 11px",
      'fontSize: "11px"',
    ]);
  });
});
