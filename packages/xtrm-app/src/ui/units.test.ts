import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
 *
 * XTRM-951 (review of #466): this gate claimed more than it checked in five places, and each fix
 * below is paired with the mutation that shows the gate now fails on the shape it used to miss.
 * The claims the gate still cannot make are listed in `HOLES`, with an owner, because an unstated
 * limit is read as coverage — "no mutation exercises this" once told a reviewer not to look.
 *
 * An offence is read from this file's own report, not from a source grep. The grep this finding
 * replaced returned five fixture hits, so a human had to know the fixture list before deciding
 * anything; `GATE_REPORT=1 npx vitest run src/ui/units.test.ts --silent=false --reporter=verbose`
 * prints every offence it sees, parked or not, with its rule id, and a failing run names the same
 * lines in its assertion message. The report is the gate's own instrument: the counts it prints for
 * each park are the numbers that park holds, not a second script's reading of them.
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
 * - the old px rules stay,
 * - logical properties (`paddingInline`, `marginBlockStart`) are covered by the same rules as their
 *   physical twins: `paddingInline` was a shipped way past a rule that only spoke `paddingLeft`.
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

type Offence = { rule: string; match: string; line: number };

/**
 * Known debt, parked as THE OFFENCE, not a count per file.
 *
 * Parking a whole file exempted every offender inside it. Parking a count was the next instrument,
 * and it still let an offence be swapped for a different one: the file kept two offenders and the
 * gate stayed green while the rule it was written for was violated (probe on the shipped tree:
 * replace `gap-[2px]` at src/issues/meta.tsx:31 with `text-[0.7rem]`). A park now names the rule and
 * the literal, keyed without a line number so code can move, with a multiset comparison so a
 * duplicate counts: the file may hold exactly these offences, the slice that pays one down must
 * delete it from the park in the same commit, and a substitution fails.
 */
type Park = { owner: string; offences: Array<{ rule: string; match: string }> };

const PARKS: Record<string, Park> = {
  [join("src", "issues", "PullRequestsBlock.tsx")]: {
    owner: "XTRM-941",
    offences: [
      { rule: "offscale-rem-font", match: "text-[0.68rem]" },
      { rule: "offscale-rem-font", match: "text-[0.68rem]" },
    ],
  },
  [join("src", "shell", "ContextSidebar.tsx")]: {
    owner: "XTRM-939",
    offences: [
      { rule: "offscale-rem-font", match: "text-[0.65rem]" },
      { rule: "offscale-rem-font", match: "text-[0.68rem]" },
      { rule: "offscale-rem-font", match: "text-[0.68rem]" },
    ],
  },
  [join("src", "issues", "meta.tsx")]: { owner: "XTRM-943", offences: [{ rule: "arbitrary-px-spacing", match: "gap-[2px]" }] },
};

/**
 * Claims this gate does NOT make, each with an owner and the place the claim is actually discharged.
 *
 * XTRM-951: a gate that stays quiet about its own limits is read as coverage. Findings (6) and (8)
 * of the #466 review are not closable by a source scan, so they are named here and proved elsewhere;
 * the PR that added this list carries the mutation matrix that shows which assertion catches what.
 */
const HOLES = [
  {
    id: "prop-path",
    owner: "XTRM-951",
    why: "a rendered assertion cannot tell 'the prop was honoured' from 'the prop happened to render the same thing' (measured on #473: Fields ignoring `size` toward `xs` passes). The gate proves values at rendered states; which states are distinguished is a property of the mutation set, exercised in the spec that asserts the class and the measurement, not here.",
  },
  {
    id: "structural-suppression",
    owner: "XTRM-951",
    why: "a wrapper whose single child is always first element silently defeats `border-t`/`first:border-t-0`, and no source scan sees the rendered sibling relation. It is asserted where it renders (the settings/e2e geometry assertions), never here.",
  },
] as const;

/** Every rem value the type scale actually defines (styles.css §typography). */
const REM_TOKENS = ["0.625rem", "0.72rem", "0.8125rem", "0.875rem", "1.125rem", "1.25rem", "1.5rem", "2rem"];
const OFFSCALE_REM = new RegExp(`text-\\[(?!${REM_TOKENS.map((r) => r.replace(".", "\\.")).join("|")})[\\d.]+rem\\]`, "g");

/**
 * `id` is the park key and the report label: it names the rule, so a park can never be satisfied by
 * a different rule's literal. The spacing patterns cover the logical properties as well as the
 * physical ones, in every form the review found (numeric, multiplier, quoted, and the Tailwind
 * `ps-`/`me-` classes beside `pl-`/`mr-`).
 */
const RULES: Array<{ id: string; pattern: RegExp; why: string }> = [
  { id: "px-font", pattern: /text-\[\d*\.?\d+px\]/g, why: "px font size: name a text token (text-2xs, text-xs, text-sm)" },
  { id: "offscale-rem-font", pattern: OFFSCALE_REM, why: `off-scale rem font size: ${REM_TOKENS.join(" / ")} are the only steps` },
  { id: "px-glyph", pattern: /size-\[\d*\.?\d+px\]/g, why: "px glyph size: use an ICON_CLASS step or a rem value" },
  { id: "px-glyph-attr", pattern: /\b(size|width|height)=\{\d+(?:\.\d+)?\}/g, why: "px glyph attribute: take an IconSize" },
  { id: "px-font-style", pattern: /fontSize:\s*\d/g, why: "px font style: name a text token" },
  // A row indent in px does not follow the operator's root size: derive it from INDENT_REM. The rule
  // covers every side, not only the left one, in the numeric, multiplier and quoted forms: a
  // `paddingTop: "6px"`, a `padding: "0 8px"` and a `marginLeft: depth * 14` are the same drift as an
  // unquoted `paddingLeft: 16`, and each was a shape an earlier version of this rule walked past.
  // The `(?!rem|px|em|%)` guard keeps a CSS shorthand such as `margin: 1.1rem 0 0.4rem` out of it:
  // a unit is not px.
  {
    id: "px-spacing",
    pattern: /(?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?:\s*(?:[1-9]\d*(?:\.\d+)?|0?\.\d+)(?![\d.])(?!\s*(?:rem|px|em|%))/g,
    why: "unitless spacing value in px: derive it from INDENT_REM (src/issues/issue-table.ts) or use a spacing step",
  },
  {
    id: "spacing-multiplier",
    pattern: /(?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?:\s*[\w.]+\s*\*\s*\d+(?:\.\d+)?/g,
    why: "numeric spacing multiplier: use INDENT_REM so the step follows root",
  },
  {
    id: "quoted-px-spacing",
    pattern: /(?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?:\s*["'`][^"'`]*\d*\.?\d+px["'`]?/g,
    why: "quoted px spacing: name a spacing step or derive it from INDENT_REM",
  },
  // A style prop is not the only place a number hides: an arbitrary Tailwind spacing class carries
  // the same px value with no reader able to see the scale, and `gap-[2px]` sits in the issue board
  // today. Spacing classes name a scale step; only an arbitrary px is refused.
  {
    id: "arbitrary-px-spacing",
    pattern: /\b(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|space-x|space-y)-\[\d*\.?\d+px\]/g,
    why: "arbitrary px spacing class: use a scale step (2, 4, 6 cells) or a token",
  },
  // The stylesheet takes units, so its shorthand is only a problem when the unit IS px.
  {
    id: "css-px-spacing",
    pattern: /\b(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?:\s*[^;{}\n"'`]*\d*\.?\d+px/g,
    why: "px spacing in CSS: use a token or a rem value",
  },
  // The stylesheet and an inline style are the two forms a className cannot reach around.
  { id: "css-px-font-size", pattern: /font-size:\s*\d*\.?\d+px/g, why: "px font-size in CSS: use var(--text-*)" },
  { id: "px-font-style-string", pattern: /fontSize:\s*["'`]\d*\.?\d+px["'`]/g, why: "px font style: use var(--text-*)" },
];

/** A scroll container must name `.thin-scrollbar` or `.no-scrollbar` on the same element. */
const SCROLL_CONTAINER = /\boverflow(?:-[xy])?-(?:auto|scroll)\b/;
const SCROLL_TREATMENT = /\b(?:thin|no)-scrollbar\b/;

/**
 * XTRM-951, finding (2): the scroll rule above reads JSX, so a CSS-declared container was invisible
 * while `.xtrm-prose pre { overflow-x: auto }` sat in the shipped stylesheet. A CSS rule is a
 * container of its own, and its treatment is the same language expressed where that container can
 * carry it: `scrollbar-width` in the same declaration block (the utilities cannot reach a `pre` the
 * markdown renderer emits). A block with neither is an offence.
 */
const CSS_SCROLL = /overflow(?:-[xy])?:\s*(?:auto|scroll)\b/;

/**
 * The scroll treatments this codebase has, and where each one reaches. The list is closed on
 * purpose: a rule that accepts any `scrollbar-*` declaration teaches the next author nothing, and
 * the next author then copies whichever form happened to pass. A value outside this list is its own
 * offence (`css-scrollbar-value`), so `auto`, an unseen hex or an unseen `var()` is red rather than
 * silently accepted as a treatment.
 */
const SCROLLBAR_TREATMENTS: ReadonlyArray<{ property: string; value: string; reaches: string }> = [
  {
    property: "scrollbar-width",
    value: "thin",
    reaches: ".thin-scrollbar on a rendered element, and .xtrm-prose pre where the markdown renderer's <pre> cannot carry a class",
  },
  {
    property: "scrollbar-width",
    value: "none",
    reaches: ".no-scrollbar, where the bar is hidden and the wheel or keyboard still scrolls the pane",
  },
  {
    property: "scrollbar-color",
    value: "var(--color-border-strong) transparent",
    reaches: "the same two containers: the tread and the thumb .thin-scrollbar sets",
  },
];

const CSS_TREATMENT = /scrollbar-width\s*:\s*thin\s*[;}]/;
const CSS_SCROLLBAR_DECLARATION = /(scrollbar-(?:width|color))\s*:\s*([^;{}]+)/g;

/** Every `scrollbar-*` declaration in a block, with the pair that has to be on the closed list. */
const scrollbarDeclarations = (body: string) =>
  [...body.matchAll(CSS_SCROLLBAR_DECLARATION)].map((match) => ({
    property: (match[1] ?? "").trim(),
    value: (match[2] ?? "").trim(),
    literal: match[0].trim(),
  }));

const isKnownScrollbarTreatment = (declaration: { property: string; value: string }) =>
  SCROLLBAR_TREATMENTS.some((known) => known.property === declaration.property && known.value === declaration.value);

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

/** Declaration blocks of a stylesheet, skipping the ones that only nest other blocks. */
const cssBlocks = (source: string): Array<{ selector: string; body: string; offset: number }> => {
  const blocks: Array<{ selector: string; body: string; offset: number }> = [];
  const open: Array<{ selector: string; bodyStart: number; nested: boolean }> = [];
  let boundary = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "{") {
      open.push({ selector: source.slice(boundary, i).trim(), bodyStart: i + 1, nested: false });
      boundary = i + 1;
    } else if (source[i] === "}") {
      const block = open.pop();
      if (block && !block.nested) blocks.push({ selector: block.selector, body: source.slice(block.bodyStart, i), offset: block.bodyStart });
      const parent = open[open.length - 1];
      if (parent) parent.nested = true;
      boundary = i + 1;
    }
  }
  return blocks;
};

const offenders = (file: string): Offence[] => {
  const source = readFileSync(file, "utf8");
  const id = relative(process.cwd(), file);
  const found: Offence[] = [];

  if (file.endsWith(".css")) {
    for (const block of cssBlocks(source)) {
      for (const declaration of scrollbarDeclarations(block.body)) {
        if (isKnownScrollbarTreatment(declaration)) continue;
        found.push({ rule: "css-scrollbar-value", match: declaration.literal, line: lineOf(source, block.offset) });
      }
      if (!CSS_SCROLL.test(block.body) || CSS_TREATMENT.test(block.body)) continue;
      if (SCROLL_TREATMENT.test(block.selector)) continue;
      found.push({ rule: "css-scroll-container", match: block.selector, line: lineOf(source, block.offset) });
    }
  } else {
    // A className is written on one line in every call site here; a scroll container that splits its
    // className across lines still fails, and the fix is to keep the treatment beside the overflow.
    // Both regexes are non-global on purpose: a `g` regex used with `.test()` advances `lastIndex`,
    // so alternating lines silently skipped the check.
    source.split("\n").forEach((text, i) => {
      if (!SCROLL_CONTAINER.test(text) || SCROLL_TREATMENT.test(text)) return;
      found.push({ rule: "scroll-container", match: text.trim(), line: i + 1 });
    });
  }

  for (const rule of RULES) {
    for (const match of source.matchAll(rule.pattern)) {
      found.push({ rule: rule.id, match: match[0], line: lineOf(source, match.index ?? 0) });
    }
  }
  return found;
};

/**
 * The park comparison is a multiset match of `rule + literal`, so it survives code moving, refuses a
 * substituted offence, and refuses a duplicate of a parked one. Both directions are reported: a new
 * offence in a parked file, and a parked offence that is gone (the slice paid it and left the park).
 */
const parkDrift = (file: string, found: Offence[]): string[] => {
  const park = PARKS[file] ?? { owner: "", offences: [] };
  const key = (offence: { rule: string; match: string }) => `${offence.rule} ${offence.match}`;
  const parked = new Map<string, number>();
  for (const offence of park.offences) parked.set(key(offence), (parked.get(key(offence)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const lines: string[] = [];
  for (const offence of found) {
    const k = key(offence);
    const count = (seen.get(k) ?? 0) + 1;
    seen.set(k, count);
    if (count > (parked.get(k) ?? 0)) {
      lines.push(`${file}: new offence in a parked file — ${k} (line ${offence.line})${park.owner ? `; owner ${park.owner} did not park it` : ""}`);
    }
  }
  for (const [k, allowed] of parked) {
    const got = seen.get(k) ?? 0;
    if (got < allowed) {
      lines.push(`${file}: parked offence is gone — ${k} (${allowed - got} fewer than parked): the slice paid it down, delete it from the park`);
    }
  }
  if (lines.length === 0 && parked.size === 0 && found.length > 0) {
    lines.push(`${file}: parked no offences while ${found.length} were found — name them in the park`);
  }
  return lines;
};

describe("the console has no px font size or glyph size outside the ladder", () => {
  it("finds none in any in-scope source file under src", () => {
    const files = walk(ROOT);
    // A guard over an empty file list would pass by accident.
    expect(files.length).toBeGreaterThan(120);
    expect(files, "the stylesheet must be in the walk").toContain(join("src", "styles.css"));
    expect(files.filter((f) => f.startsWith(join("src", "agent"))), "agent is out of scope").toEqual([]);

    const drifted: string[] = [];
    for (const file of files) {
      const found = offenders(file);
      const parked = PARKS[file];
      if (!parked) {
        for (const offence of found) {
          const why = RULES.find((rule) => rule.id === offence.rule)?.why ?? "scroll container: add thin-scrollbar or no-scrollbar";
          drifted.push(`${file}:${offence.line} ${offence.match} — ${why} [${offence.rule}]`);
        }
        continue;
      }
      drifted.push(...parkDrift(file, found));
    }
    if (process.env.GATE_REPORT === "1") {
      for (const file of files) {
        const found = offenders(file);
        if (found.length === 0) continue;
        console.log(`${file}: ${found.length} offender(s), ${PARKS[file] ? "parked" : "unparked"}`);
        for (const offence of found) console.log(`  :${offence.line} ${offence.match} [${offence.rule}]`);
      }
    }
    expect(drifted, "no px or off-scale literal may stand outside the ladder").toEqual([]);
  });

  it("keeps every park honest, in both directions, by naming the offence", () => {
    // A park is a receipt: it names a rule and a literal, so swapping one offence for another in the
    // same file fails, and a slice that pays one down must delete the entry in the same commit.
    expect(Object.keys(PARKS).length, "a park list that shrank to nothing no longer holds the debt it names").toBeGreaterThan(0);
    const findings = Object.entries(PARKS).flatMap(([file, park]) => {
      const lines: string[] = [];
      if (!/^XTRM-\d+$/.test(park.owner)) lines.push(`${file}: parked by "${park.owner}", which is not an issue ref`);
      if (park.offences.length === 0 && offenders(file).length > 0) lines.push(`${file}: parked with no offences while ${offenders(file).length} were found`);
      for (const offence of park.offences) {
        if (!RULES.some((rule) => rule.id === offence.rule) && offence.rule !== "scroll-container") {
          lines.push(`${file}: park names rule "${offence.rule}", which no rule id declares`);
        }
      }
      return [...lines, ...parkDrift(file, offenders(file))];
    });
    expect(findings, "each park names its owner and its offence").toEqual([]);
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
      'const h2 = { paddingTop: "6px" };',
      'const h3 = { padding: "0 8px" };',
      'const k = "gap-[2px]";',
      "const h4 = { marginLeft: depth * 14 };",
      "const i = { paddingLeft: depth * 16 };",
      "const j = { paddingLeft: depth * 16, };",
      "const l = { paddingInline: 12 };",
      "const m = { marginBlockStart: 8 };",
      'const n = "ps-[2px]";',
      "const o = { fontSize: 11 };",
      "h1 { font-size: 11px; }",
      ".a { padding-inline: 8px; }",
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
    const hit = (id: string, source: string) => [...source.matchAll(RULES.find((rule) => rule.id === id)!.pattern)].map((match) => match[0]);
    for (const [id, literal] of [
      ["px-font", "text-[11px]"],
      ["offscale-rem-font", "text-[0.7rem]"],
      ["px-glyph", "size-[11px]"],
      ["px-glyph-attr", "width={16}"],
      ["px-font-style", "fontSize: 1"],  // the rule matches the leading digit of any numeric value
      ["px-spacing", "paddingLeft: 16"],
      ["spacing-multiplier", "marginLeft: depth * 14"],
      ["quoted-px-spacing", 'paddingTop: "6px"'],
      ["arbitrary-px-spacing", "gap-[2px]"],
      ["css-px-font-size", "font-size: 11px"],
      ["px-font-style-string", 'fontSize: "11px"'],
    ] as const) {
      expect(hit(id, sample), `rule ${id} must catch ${literal}`).toContain(literal);
    }
    // The logical twins are the shape the previous rule set walked past.
    expect(hit("px-spacing", sample)).toEqual(expect.arrayContaining(["paddingInline: 12", "marginBlockStart: 8"]));
    expect(hit("arbitrary-px-spacing", sample)).toContain("ps-[2px]");
    expect(hit("css-px-spacing", sample)).toContain("padding-inline: 8px");
    // And the legal shapes the epic declared stay legal.
    for (const legal of [
      "padding: 0",
      'paddingLeft: "var(--row-indent)"',
      'paddingInline: "var(--row-indent)"',
      "paddingRight: gutter",
      "margin: 1.1rem 0 0.4rem",
      "padding: 0.05rem 0.3rem",
      "paddingLeft: depth * INDENT_REM",
    ]) {
      const caught = RULES.flatMap((rule) => [...legal.matchAll(rule.pattern)].map((match) => match[0]));
      expect(caught, `legal shape refused: ${legal}`).toEqual([]);
    }
    // A CSS scroll container without a treatment is caught, a treated one is spared, and a block that
    // only nests other blocks is not mistaken for a declaration block.
    const css = [".bare {", "  overflow-x: auto;", "}", ".treated {", "  overflow-y: auto;", "  scrollbar-width: thin;", "}", "@layer utilities {", "  .wrap {", "    display: flex;", "  }", "}"].join("\n");
    expect(cssBlocks(css).filter((block) => CSS_SCROLL.test(block.body) && !CSS_TREATMENT.test(block.body)).map((block) => block.selector)).toEqual([".bare"]);
    expect(cssBlocks(css).map((block) => block.selector)).not.toContain("@layer utilities");
  });

  it("tells a missing model from an empty one: the walk must evaluate what it is given", () => {
    // Finding (7): #467 shipped a commit in which this file did not parse, so the park model never
    // ran and "zero offenders" was reported by a gate that had not looked. A missing map and an empty
    // map print the same reassuring sentence, so the gate carries its own sentinel — a miniature tree
    // holding one real offence — and requires the walk to enumerate it, the rules to report it, and a
    // park naming no offence to disagree with it. Only then does "no drift" mean the gate looked.
    //
    // The tree lives in the OS temp directory, not in `src`: a killed process skips `finally`, and a
    // gate that can leave a stray file in the tree it polices is a worse defect than the one it
    // closes. Pointing the walk at a temp root also proves the walk is root-agnostic, which walking
    // `src` could never show.
    const sentinelRoot = mkdtempSync(join(tmpdir(), "units-gate-"));
    const sentinel = join(sentinelRoot, "nested", "probe.tsx");
    const cssSentinel = join(sentinelRoot, "probe.css");
    mkdirSync(join(sentinelRoot, "nested"), { recursive: true });
    writeFileSync(sentinel, 'export const planted = "gap-[2px]";\n');
    writeFileSync(cssSentinel, ".probe-block {\n  overflow-x: auto;\n  scrollbar-width: auto;\n}\n");
    try {
      expect(
        walk(sentinelRoot),
        "a missing model and an empty model must fail differently: the walk must enumerate the sentinel it was given",
      ).toContain(sentinel);
      expect(
        offenders(sentinel).map((offence) => offence.rule),
        "the sentinel must be reported by the same rules the gate applies",
      ).toContain("arbitrary-px-spacing");
      // A park that names the wrong offence must fail: otherwise the park model could be empty and
      // still agree with itself.
      expect(
        parkDrift(sentinel, offenders(sentinel)),
        "a park naming no offence must not agree with a file that has one",
      ).not.toEqual([]);
      // The scrollbar accept-list is closed: a form the two known treatments do not name is red, and
      // a container left without a known treatment is red beside it.
      const cssRules = offenders(cssSentinel).map((offence) => offence.rule);
      expect(cssRules, "an unknown scrollbar value must not count as a treatment").toContain("css-scrollbar-value");
      expect(cssRules, "a container with no known treatment must still be reported").toContain("css-scroll-container");
    } finally {
      rmSync(sentinelRoot, { recursive: true, force: true });
    }
    // The declarations this test depends on must be present and non-empty, or the sentinel above
    // would pass through an empty rule list and prove nothing.
    expect(RULES.length).toBeGreaterThan(10);
    const parkedMeta = PARKS[join("src", "issues", "meta.tsx")];
    expect(parkedMeta?.offences.length ?? 0, "the debt the gate parks must be named, not counted").toBeGreaterThan(0);
    expect(PARKS[join("src", "issues", "meta.tsx")]?.offences.map((offence) => offence.match), "a park must name the literal it holds").toContain("gap-[2px]");
  });

  it("keeps every named hole owned", () => {
    for (const hole of HOLES) {
      expect(hole.owner, `hole ${hole.id} has no owner`).toMatch(/^XTRM-\d+$/);
      expect(hole.why.length, `hole ${hole.id} does not say what it cannot prove`).toBeGreaterThan(80);
    }
  });
});
