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
 *
 * The scrollbar is part of that language. `styles.css` ships two treatments — `.thin-scrollbar`
 * (the sidebar and inspector default) and `.no-scrollbar` (chrome that must not show a gutter) — and
 * a bare `overflow-auto` silently gets the platform bar instead: a different width, a different
 * colour, and a ~6px shift in row geometry between two views that should line up. The rule below
 * requires every scroll container to name its treatment, so the Activity view cannot drift again.
 */
const OUT_OF_SCOPE = [join("src", "agent"), join("src", "components", "reui")];

/**
 * Known debt, parked as a COUNT per file, with the slice that pays it down.
 *
 * Parking a whole file was the wrong instrument: it exempted every offender inside it, including
 * the ones a rule was written for. `src/project/workers/WorkerRow.tsx` was parked for one
 * `paddingLeft: 16`, and the parking then hid a `paddingLeft: depth * 14` twelve lines away — the
 * gate passed while the drift it names was live. A count is the same promise without the blind
 * spot: the parked file may hold exactly this many offenders, a new one fails, and a slice that
 * pays one down must lower the number in the same commit that fixes it.
 */
const DEBT: Record<string, { allowed: number; owner: string }> = {
  [join("src", "issues", "PullRequestsBlock.tsx")]: { allowed: 2, owner: "XTRM-941" },
  [join("src", "github", "identity.tsx")]: { allowed: 2, owner: "XTRM-941" },
  [join("src", "shell", "ContextSidebar.tsx")]: { allowed: 3, owner: "XTRM-939" },
  [join("src", "surfaces", "ActivitySurface.tsx")]: { allowed: 4, owner: "XTRM-936" },
  [join("src", "project", "workers", "WorkerRow.tsx")]: { allowed: 1, owner: "XTRM-936" },
  [join("src", "settings", "SettingsSurface.tsx")]: { allowed: 1, owner: "XTRM-937" },
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
  { pattern: /paddingLeft:\s*[\w.]+\s*\*\s*\d+(?:\.\d+)?/g, why: "numeric indent multiplier: use INDENT_REM so the step follows root" },
  // The stylesheet and an inline style are the two forms a className cannot reach around.
  { pattern: /font-size:\s*\d*\.?\d+px/g, why: "px font-size in CSS: use var(--text-*)" },
  { pattern: /fontSize:\s*["'`]\d*\.?\d+px["'`]/g, why: "px font style: use var(--text-*)" },
];

/** A scroll container must name `.thin-scrollbar` or `.no-scrollbar` on the same element. */
const SCROLL_CONTAINER = /\boverflow(?:-[xy])?-(?:auto|scroll)\b/;
const SCROLL_TREATMENT = /\b(?:thin|no)-scrollbar\b/;

const inScope = (file: string) => !OUT_OF_SCOPE.some((dir) => file.startsWith(dir + "/") || file.startsWith(dir + join("")));

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (!/\.(tsx?|css)$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return inScope(path) ? [path] : [];
  });

const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

const offenders = (file: string) => {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  // A className is written on one line in every call site here; a scroll container that splits its
  // className across lines still fails, and the fix is to keep the treatment beside the overflow.
  // Both regexes are non-global on purpose: a `g` regex used with `.test()` advances `lastIndex`,
  // so alternating lines silently skipped the check.
  const untreatmented = lines.flatMap((text, i) =>
    SCROLL_CONTAINER.test(text) && !SCROLL_TREATMENT.test(text)
      ? [`${relative(process.cwd(), file)}:${i + 1} ${text.trim()} — scroll container: add thin-scrollbar or no-scrollbar`]
      : [],
  );
  return [
    ...RULES.flatMap((rule) =>
      [...source.matchAll(rule.pattern)].map((match) => `${relative(process.cwd(), file)}:${lineOf(source, match.index ?? 0)} ${match[0]} — ${rule.why}`),
    ),
    ...untreatmented,
  ];
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

  it("keeps every parked count honest, in both directions", () => {
    // A parked count is a receipt: more offenders means new drift in a file nobody is watching, fewer
    // means the slice paid it and the number must come down. A count of zero is not parking at all.
    const drift = Object.entries(DEBT).flatMap(([file, { allowed, owner }]) => {
      const found = offenders(file).length;
      if (!/^XTRM-\d+/.test(owner)) return [`${file}: parked by "${owner}", which is not an issue ref`];
      if (allowed === 0) return [`${file}: parked at 0, so delete the entry instead of parking nothing`];
      if (found === allowed) return [];
      return [
        found > allowed
          ? `${file}: parked ${allowed}, found ${found} — new drift in a parked file`
          : `${file}: parked ${allowed}, found ${found} — the slice paid it down, lower the count`,
      ];
    });
    expect(drift).toEqual([]);
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
      "const j = { paddingLeft: depth * 16, };",
      "h1 { font-size: 11px; }",
    ].join("\n");
    expect(
      ['<div className="overflow-y-auto" />', '<div className="thin-scrollbar overflow-y-auto" />', '<div className="no-scrollbar overflow-x-auto" />'].filter(
        (line) => SCROLL_CONTAINER.test(line) && !SCROLL_TREATMENT.test(line),
      ),
      "the scroll rule must catch the bare container and spare both treatments",
    ).toEqual(['<div className="overflow-y-auto" />']);
    // Two offenders on one line pair must both be caught: with a `g` regex the second was skipped.
    expect(
      ['<div className="overflow-y-auto" />', '<div className="overflow-x-auto" />'].filter(
        (line) => SCROLL_CONTAINER.test(line) && !SCROLL_TREATMENT.test(line),
      ),
    ).toHaveLength(2);
    const hits = RULES.flatMap((rule) => [...sample.matchAll(rule.pattern)].map((match) => match[0]));
    expect(hits).toEqual([
      "text-[11px]",
      "text-[0.7rem]",
      "size-[11px]",
      "width={16}",
      "size={13}",
      "paddingLeft: 16",
      "paddingLeft: depth * 16",
      "paddingLeft: depth * 16",
      "font-size: 11px",
      'fontSize: "11px"',
    ]);
  });
});
