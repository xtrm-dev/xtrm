// The measurement engine behind `src/ui/units.test.ts`, extracted so a second reader can measure with
// the gate's own code instead of an approximation of it.
//
// It lives under `scripts/` rather than `src/` on purpose: this module names every banned literal as
// data — the rule set's examples and the parks' offences are the list of what is illegal. The walk
// covers `src/`, so a module that *states* the ban cannot be the thing it bans. Moving the ban list
// back into `src/` would either fail the gate or force an exclusion, and an exclusion in the scanner
// is exactly the shape of the defect this file exists to prevent.
//
// XTRM-958 exists because a conflict in the park map was resolved by hand, and a plain union of the
// two sides re-adds entries a merged slice had deleted. Reconciling that by hand from a *count* is
// the same defect one level down, so the reconciler measures with `offenders()` and `parkDrift()`
// below, and prints the numbers this module reports. Two instruments reading the same files are not
// evidence of each other; one instrument read twice is.
//
// XTRM-986: the content-sized grids are the one place the label sweep moved a visible pixel without a
// named failing case. `src/issues/IssueJournal.tsx:86` floors on `PART_LABEL_COLUMN` and
// `src/agent/Activity.tsx:124` on `SIDEBAR_LABEL_COLUMN`; those floors rose 6rem → 6.5rem and
// 4rem → 4.5rem, which is +0.5rem per grid (+8px at a 16px root, +6px at the operator's 12px root),
// and it is visible only when every key in a block is shorter
// than the floor (measured during XTRM-971). It is recorded here because a merged PR body is not a
// place a later reader of this file looks. The limit those grids carry is the `label-width-constant`
// hole below: the gate proves a step is a constant, not that the constant is wide enough.
//
// XTRM-979: seven instruments stated a limit that nothing checked. Each is either enforced here or
// deleted, and the disposition is written beside the thing it protects rather than in a PR body:
//
//   enforced  `advice()` threw `?? "unnamed rule"` for an id it did not know, so a rule added without
//             a remedy passed in silence. It now throws, and `syntheticRuleIds` lets a test prove every
//             id `offenders()` can emit — including the four that carry no `RULES` entry — answers.
//   enforced  `GATE_REPORT=1` labelled a file `parked` or `unparked`, so a NEW offence inside a parked
//             file printed exactly like a parked one. `parkSplit()` divides the same offences into
//             owed and parked, and the report prints that division per offence.
//   enforced  CSS citations pointed at the line the BLOCK opens on, so every declaration inside a
//             multi-line block cited its selector. `scrollbarDeclarations` carries an absolute offset
//             and `css-scroll-container` cites the `overflow` declaration itself.
//   deleted   "`ownsSource()` is advertised but never called by `walk()`" — measured false: the walk
//             does not call it because `unpaidDirectories()` does, and the directory tests exercise
//             that path. A claim about unreachable code on a function that is reached is noise in a
//             file whose job is to be trusted, so the claim is gone rather than answered.
//   measured  "the walk excludes `host/` and `server/`" — they hold 4 and 7 files and **0 offences**
//             between them, so widening `ROOT` today would change what the gate refuses by nothing.
//             The walk stays on `src`; what it covers is stated, not implied.
//   measured  "the reference table's cite names the file but not the table" — the one such comment is
//             `src/project/jira/JiraRow.tsx`, which names `src/issues/IssuesSurface.tsx` for its own
//             reason (row-size text) and cites no rule; there is nothing here to enforce.
//   absent    `truthManifest` does not exist at any head in this repository, so there was nothing to
//             delete: a finding cannot be closed by removing a symbol that was never added.
//
// The rule those seven produce, and the reason this block is here instead of in the PR body: a stated
// limit is only worth the check attached to it, and a check that cannot be pointed at is a comment.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

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

export const ROOT = "src";

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
export const OUT_OF_SCOPE = [join("src", "agent"), join("src", "components", "reui")];

export type Offence = { rule: string; match: string; line: number };

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
export type Park = { owner: string; offences: Array<{ rule: string; match: string }> };

export const PARKS: Record<string, Park> = {
  [join("src", "issues", "meta.tsx")]: { owner: "XTRM-943", offences: [{ rule: "arbitrary-px-spacing", match: "gap-[2px]" }] },
};

/**
 * Claims this gate does NOT make, each with an owner and the place the claim is actually discharged.
 *
 * XTRM-951: a gate that stays quiet about its own limits is read as coverage. Findings (6) and (8)
 * of the #466 review are not closable by a source scan, so they are named here and proved elsewhere;
 * the PR that added this list carries the mutation matrix that shows which assertion catches what.
 */
export type Hole = {
  id: string;
  owner: string;
  /** One sentence naming what the gate cannot see, falsifiable by the next reader. */
  why: string;
  /**
   * How the limit fails, in the two shapes this gate can have.
   *
   * `unjudged-form` — no rule matches the example, so the gate reads the line and passes it.
   * `outside-walk` — the example is a genuine offence that no rule ever reads, because `walk` never
   * reaches its file. Both are asserted in `units.test.ts`, so neither shape rests on prose.
   */
  kind: "unjudged-form" | "outside-walk";
  /** One line of source the gate would have to judge and does not. */
  example: string;
  /** For `outside-walk`, where the example lives today, so a reader can check the tree. */
  examplePath?: string;
};

export const HOLES: readonly Hole[] = [
  {
    id: "prop-path",
    owner: "XTRM-951",
    kind: "unjudged-form",
    example: 'expect(value.className).toBe("text-xs"); // passes whether the step was honoured or the default matched it',
    why: "a rendered assertion cannot tell 'the prop was honoured' from 'the prop happened to render the same thing' (measured on #473: Fields ignoring `size` toward `xs` passes). The gate proves values at rendered states; which states are distinguished is a property of the mutation set, exercised in the spec that asserts the class and the measurement, not here.",
  },
  {
    id: "structural-suppression",
    owner: "XTRM-951",
    kind: "unjudged-form",
    example: 'const Card = ({ children }: { children: ReactNode }) => <section className="border-t">{children}</section>;',
    why: "a wrapper whose single child is always first element silently defeats `border-t`/`first:border-t-0`, and no source scan sees the rendered sibling relation. It is asserted where it renders (the settings/e2e geometry assertions), never here.",
  },
  {
    id: "constant-indirection",
    owner: "XTRM-949",
    kind: "unjudged-form",
    example: '<textarea className={`${input} resize-y`} />',
    why: "`${input} resize-y` is a whole interpolated value as written, so the glued-class rule spares it; whether `input` expands to a fragment of a class is not visible at the call site (`src/issues/NewIssueDialog.tsx:64`, where `input` is a module-level class string). Resolving a constant's initializer across a module is a different instrument and is not attempted here, so a class assembled through a named constant is unclosed by this gate and belongs to review instead.",
  },
  {
    id: "agent-outside-the-walk",
    owner: "XTRM-620",
    kind: "outside-walk",
    examplePath: join("src", "agent", "AgentSidebar.tsx"),
    example:
      '<span className="min-w-0 truncate font-mono text-[0.68rem] text-ink-faint" title={state.settings.target}>{state.settings.target}</span>',
    why: "`src/agent` is in `OUT_OF_SCOPE`, so the rem ladder is not enforced there: 38 offences stand in that tree today, in 6 distinct values (`text-[0.6rem]`, `text-[0.65rem]`, `text-[0.68rem]`, `text-[0.7rem]`, `text-[0.92rem]`, `text-[0.95rem]`) across 8 files (Activity, AgentSidebar, AgentSurface, Composer, DrawerPanels, HostConnection, NewSession, RefChip), and the operator's 12px root renders every one of them too large. The exclusion has an owner (the Agent epic) and a cost that is now measured rather than assumed; moving the tree inside the walk is that epic's change, not a rule's.",
  },
  {
    id: "label-width-constant",
    owner: "XTRM-940",
    kind: "unjudged-form",
    example: '<Fields rows={rows} labelWidth={PAGE_LABEL_COLUMN} />',
    why: "`labelWidth={PAGE_LABEL_COLUMN}` is the intended form and passes by design: a step is fitted by measurement — the widest label plus a gutter at the surface's minimum width — and a regex cannot hold an arithmetic result. What the gate proves is that the constant exists and is not restated as a literal; what it cannot prove is that the constant is wide enough for the labels it now holds, which XTRM-940 records as the ladder.",
  },
];

/** Every rem value the type scale actually defines (styles.css §typography). */
export const REM_TOKENS = ["0.625rem", "0.72rem", "0.8125rem", "0.875rem", "1.125rem", "1.25rem", "1.5rem", "2rem"];
export const OFFSCALE_REM = new RegExp(`text-\\[(?!${REM_TOKENS.map((r) => r.replace(".", "\\.")).join("|")})[\\d.]+rem\\]`, "g");

/**
 * `id` is the park key and the report label: it names the rule, so a park can never be satisfied by
 * a different rule's literal. The spacing patterns cover the logical properties as well as the
 * physical ones, in every form the review found (numeric, multiplier, quoted, and the Tailwind
 * `ps-`/`me-` classes beside `pl-`/`mr-`).
 */
export const RULES: Array<{ id: string; pattern: RegExp; why: string; prose?: boolean }> = [
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
    pattern: /(?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?:\s*-?(?:[1-9]\d*(?:\.\d+)?|0?\.\d+)(?![\d.])(?!\s*(?:rem|px|em|%))/g,
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
  // XTRM-971: five surface classes each hand-picked their label column and two of them wrote the
  // grid themselves, so "where a value starts" was a per-file decision. The steps now live in
  // `src/ui/drawer.tsx` and a call site names one; both rules below are what keeps that set closed.
  // The class form is the wider hole: a hand-rolled `<dl>` never touches `labelWidth`, so a rule on
  // the prop alone would have sat green over the four grids the sweep had to convert by hand.
  // `prose: true` spares a comment that quotes the shape it refuses — the two comments recording
  // this drift (`src/surfaces/research-format.tsx`) name `grid-cols-[8rem_1fr]` on purpose.
  {
    id: "label-grid-class",
    prose: true,
    // Two tracks, the second one value-shaped, and a numeric rem/ch in the first — the fitted shape
    // (`6.5rem_minmax(0,1fr)`, `6rem_auto`) and the content-sized one (`minmax(6rem,auto)…`). A table
    // template has more than two tracks and its second track is not `1fr`/`auto`, so it does not match.
    pattern:
      /grid-cols-\[(?:(?:minmax\(\s*)?[\d.]+(?:rem|ch)\s*(?:,[^)]*)?\)?)_(?:minmax\(0,\s*1fr\)|1fr|auto)\]/g,
    why: "hand-rolled label grid: a two-track label/value grid names its column instead of the ladder — use Fields, or a step from src/ui/drawer.tsx (a content-sized column keeps its floor on a step too)",
  },
  {
    id: "label-grid-style-literal",
    prose: true,
    // The style-prop spelling of the same decision: a numeric rem written into gridTemplateColumns.
    // A template literal interpolating a step (`${LABEL_COLUMN} 1fr`) has no numeric rem and passes.
    pattern: /gridTemplateColumns:\s*[`"'][^`"'\n]*[\d.]+(?:rem|ch)[^`"'\n]*[`"']/g,
    why: "literal column template: a gridTemplateColumns string that hardcodes rem names its column instead of the ladder — interpolate a step from src/ui/drawer.tsx",
  },
  {
    id: "label-width-literal",
    prose: true,
    // Every spelling of the same literal: `labelWidth="10rem"`, `labelWidth={'10rem'}`, single quotes,
    // a template literal. A constant (`labelWidth={PAGE_LABEL_COLUMN}`) is the intended form and passes;
    // its value is fitted by measurement, which a regex cannot hold (XTRM-940 seq 33).
    pattern: /labelWidth=\{?[`"'][\d.]+(?:rem|ch)[`"']\}?/g,
    why: "literal label column: import the step (DENSE/SIDEBAR/PART/DRAWER/PAGE_LABEL_COLUMN) so the column is a decision, not a number",
  },
];

/**
 * XTRM-949: a class built from a template fragment.
 *
 * `className={`text-${tone === "ink-muted" ? "ink-muted" : "ink"} leading-snug`}` is not a class the
 * ladder can see: `text-ink` and `text-ink-muted` are never written whole, so a scan for either
 * literal finds nothing, and the class renders only because another element emits the same utilities.
 * The rule is shaped around **interpolation gluing**, not around utility prefixes: the offence is a
 * template in class position whose interpolation touches literal text with no whitespace between
 * them, because that boundary is the only place a fragment can be cut out of a complete value.
 *
 * What it spares, and why the boundary test is the right one rather than a prefix list:
 * - `${input} resize-y` (src/issues/NewIssueDialog.tsx) — the interpolation IS the whole value and
 *   the literal text starts after whitespace. Judging it would ask the gate to resolve `input`'s
 *   initializer across the module; that limit is stated in `HOLES` instead of guessed at.
 * - `${mono ? "font-mono" : ""} ${unverified ? … }` (src/project/settings/IntegrationSurface.tsx) —
 *   whole values, space separated.
 * - a map lookup (`TONE_CLASS[tone]`) is not a template at all, which is why the call site fix is a
 *   literal map and not a ternary: a ternary is scanner-visible only by coincidence.
 *
 * Two adjacent interpolations (`${a}${b}`) are not judged: there is no literal text at that boundary
 * to read. `cx(` and `cn(` are read beside `className=`, so wrapping a template in a helper does not
 * hide it.
 *
 * What this rule still cannot see, so that nobody reads silence as coverage. Each is spared today by
 * measurement, not by argument — `gluedClassOffences` returns `[]` for every line below:
 * - `className={"text-" + tone}` — a concatenation, not a template. The gate reads templates.
 * - `cx("a", `p-${step}`)` — only the FIRST argument of a literal `cx(`/`cn(` is read, so a glued
 *   template in second position is invisible. Every current `cx`/`cn` site passes a whole class
 *   first (`src/ui/nav-rail.tsx:46` is the live one), so this is latent, not live.
 * - `clsx(` / `classNames(` — other helper spellings; only `cx` and `cn` are named.
 * - `className={x ? `text-${a}` : `bg-${b}`}` — a template inside a wider expression, where the
 *   backtick is not the first token after `{`. A clause **inside** an interpolation
 *   (`className={`${on ? `text-${tone}` : ""} leading-snug`}`) IS read: `gluedClassOffences` recurses
 *   into nested templates, because the defect is the same one level down and a scan that stopped at
 *   the outer template's parts reported zero offences for it.
 * The fix for the remaining three is to scan the argument list rather than the first backtick; it is
 * not in this change because the gate's charter is the shapes that exist, and an unstated limit is what
 * this paragraph removes.
 */
const CLASS_TEMPLATE = /\bclassName\s*=\s*\{\s*`|(?:\bcx|\bcn)\(\s*`/g;

type TemplatePart = { kind: "text"; text: string } | { kind: "expression"; offset: number };

const skipQuoted = (source: string, index: number): number => {
  const quote = source[index];
  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return cursor;
};

const skipComment = (source: string, index: number): number => {
  if (source[index + 1] === "/") {
    const end = source.indexOf("\n", index);
    return end === -1 ? source.length : end + 1;
  }
  const end = source.indexOf("*/", index + 2);
  return end === -1 ? source.length : end + 2;
};

/** Index just past the `}` that closes the `{` at `index`. Strings, comments and nested templates are skipped. */
const skipExpression = (source: string, index: number): number => {
  let depth = 0;
  let cursor = index;
  while (cursor < source.length) {
    const character = source[cursor]!;
    if (character === '"' || character === "'") {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (character === "`") {
      cursor = readTemplate(source, cursor).end;
      continue;
    }
    if (character === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) {
      cursor = skipComment(source, cursor);
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
    cursor += 1;
  }
  return cursor;
};

/** Split the template literal starting at `index` (a backtick) into its literal text and interpolations. */
const readTemplate = (source: string, index: number): { end: number; parts: TemplatePart[] } => {
  const parts: TemplatePart[] = [];
  let textStart = index + 1;
  let cursor = index + 1;
  while (cursor < source.length) {
    const character = source[cursor]!;
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    if (character === "`") {
      parts.push({ kind: "text", text: source.slice(textStart, cursor) });
      return { end: cursor + 1, parts };
    }
    if (character === "$" && source[cursor + 1] === "{") {
      parts.push({ kind: "text", text: source.slice(textStart, cursor) });
      const end = skipExpression(source, cursor + 1);
      parts.push({ kind: "expression", offset: cursor });
      cursor = end;
      textStart = end;
      continue;
    }
    cursor += 1;
  }
  parts.push({ kind: "text", text: source.slice(textStart) });
  return { end: cursor, parts };
};

const trailingToken = (text: string) => text.split(/\s+/).filter(Boolean).at(-1) ?? "";
const leadingToken = (text: string) => text.split(/\s+/).filter(Boolean)[0] ?? "";

/** Every class-position template in `source` whose interpolation is glued to literal text beside it. */
export const gluedClassOffences = (source: string): Array<{ rule: string; match: string; line: number }> => {
  const found: Array<{ rule: string; match: string; line: number }> = [];

  /**
   * Analyse one template and every template nested inside its interpolations.
   *
   * The nested case is the same defect one level down: `${on ? `text-${tone}` : ""}` builds a class
   * out of a fragment exactly as `text-${tone}` does, and a scan that stopped at the outer template's
   * parts reported zero offences for it. Recursing here is what keeps "a class is built from pieces"
   * true of the shape rather than of the indentation it was written at.
   */
  const analyse = (backtick: number): void => {
    const { parts } = readTemplate(source, backtick);
    parts.forEach((part, index) => {
      if (part.kind !== "expression") return;
      const before = parts[index - 1];
      const after = parts[index + 1];
      const prefix = before?.kind === "text" ? before.text : "";
      const suffix = after?.kind === "text" ? after.text : "";
      const gluedPrefix = prefix !== "" && !/\s$/.test(prefix);
      const gluedSuffix = suffix !== "" && !/^\s/.test(suffix);
      if (gluedPrefix || gluedSuffix) {
        found.push({
          rule: "glued-class",
          match: `${trailingToken(prefix)}\${…}${leadingToken(suffix)}`,
          line: lineOf(source, part.offset),
        });
      }
      // Walk the expression's own span for templates inside it, skipping strings and comments so a
      // backtick in a message is not mistaken for one.
      const end = skipExpression(source, part.offset + 1);
      let cursor = part.offset + 2;
      while (cursor < end) {
        const character = source[cursor];
        if (character === '"' || character === "'") {
          cursor = skipQuoted(source, cursor);
          continue;
        }
        if (character === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) {
          cursor = skipComment(source, cursor);
          continue;
        }
        if (character === "`") {
          const nested = readTemplate(source, cursor);
          analyse(cursor);
          cursor = nested.end;
          continue;
        }
        cursor += 1;
      }
    });
  };

  for (const call of source.matchAll(CLASS_TEMPLATE)) {
    analyse((call.index ?? 0) + call[0].length - 1);
  }
  return found;
};

/** A scroll container must name `.thin-scrollbar` or `.no-scrollbar` on the same element. */
export const SCROLL_CONTAINER = /\boverflow(?:-[xy])?-(?:auto|scroll)\b/;
export const SCROLL_TREATMENT = /\b(?:thin|no)-scrollbar\b/;

/**
 * XTRM-951, finding (2): the scroll rule above reads JSX, so a CSS-declared container was invisible
 * while `.xtrm-prose pre { overflow-x: auto }` sat in the shipped stylesheet. A CSS rule is a
 * container of its own, and its treatment is the same language expressed where that container can
 * carry it: `scrollbar-width` in the same declaration block (the utilities cannot reach a `pre` the
 * markdown renderer emits). A block with neither is an offence.
 */
export const CSS_SCROLL = /overflow(?:-[xy])?:\s*(?:auto|scroll)\b/;

/**
 * The scroll treatments this codebase has, and where each one reaches. The list is closed on
 * purpose: a rule that accepts any `scrollbar-*` declaration teaches the next author nothing, and
 * the next author then copies whichever form happened to pass. A value outside this list is its own
 * offence (`css-scrollbar-value`), so `auto`, an unseen hex or an unseen `var()` is red rather than
 * silently accepted as a treatment.
 */
export const SCROLLBAR_TREATMENTS: ReadonlyArray<{ property: string; value: string; reaches: string }> = [
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

export const CSS_TREATMENT = /scrollbar-width\s*:\s*thin\s*[;}]/;
export const CSS_SCROLLBAR_DECLARATION = /(scrollbar-(?:width|color))\s*:\s*([^;{}]+)/g;

/** Every `scrollbar-*` declaration in a block, with the pair that has to be on the closed list. */
export const scrollbarDeclarations = (body: string, bodyOffset = 0) =>
  [...body.matchAll(CSS_SCROLLBAR_DECLARATION)].map((match) => ({
    property: (match[1] ?? "").trim(),
    value: (match[2] ?? "").trim(),
    literal: match[0].trim(),
    /** Absolute offset in the file, so a citation lands on the declaration and not on its block. */
    offset: bodyOffset + (match.index ?? 0),
  }));

export const isKnownScrollbarTreatment = (declaration: { property: string; value: string }) =>
  SCROLLBAR_TREATMENTS.some((known) => known.property === declaration.property && known.value === declaration.value);

export const inScope = (file: string) => !OUT_OF_SCOPE.some((dir) => file.startsWith(dir + "/") || file.startsWith(dir + join("")));

export const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (!/\.(tsx?|css)$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return inScope(path) ? [path] : [];
  });

/** A directory the walk owes a contribution from: it holds a file the walk should read. */
export const ownsSource = (dir: string): boolean =>
  readdirSync(dir, { withFileTypes: true }).some(
    (entry) => entry.isFile() && /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name),
  );

export const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

/**
 * A comment line. A rule that describes a shape it refuses has to spare the prose that names that
 * shape, or the gate starts demanding edits to evidence — this repo keeps its drift records in
 * comments on purpose (XTRM-971 spent a paragraph on `grid-cols-[8rem_1fr]`).
 *
 * XTRM-971 shipped this inside `units.test.ts`; it moved here with the rules it serves when the gate
 * left the walked tree (XTRM-949/XTRM-958). A rule that cannot be spared in prose is the rule that
 * forced the move, so the two have to travel together.
 */
export const isProseLine = (text: string) => /^\s*(?:\/\/|\*|\/\*|\{\/\*)/.test(text);

/** Every directory under `dir`, in the walk's own shape, so the directory the walk skipped is the one reported. */
export const directories = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? [join(dir, entry.name), ...directories(join(dir, entry.name))] : [],
  );

/**
 * The directories that owe the walk a file and contribute none, split by the two failures they mean:
 * a top-level directory the filter skipped, a nested one the recursion never reached.
 *
 * Takes its root and its file list as arguments so both can be asserted against a tree a test owns —
 * a guard over `ROOT` alone can only be falsified by editing the repository. The world a test
 * supplies must exercise the predicate it thinks it is testing, or it agrees with the bug: one of
 * its directories holds an own source beside a contributing child, which separates the two.
 */
export function unpaidDirectories(root: string, files: string[]): { topLevel: string[]; nested: string[] } {
  const depth = (dir: string) => dir.split("/").length;
  const unpaid = directories(root)
    .filter((dir) => inScope(join(dir, "x")))
    .filter((dir) => ownsSource(dir))
    // "Did this directory's own files get read?", not "is any file under it?". The prefix test let a
    // parent whose child contributes report nothing while the parent's own sources never entered the
    // walk — `src/project` holds exactly two own sources beside seven subdirectories, so the shape
    // exists today. `dirname` is imported from node:path.
    .filter((dir) => !files.some((file) => dirname(file) === dir));
  return {
    topLevel: unpaid.filter((dir) => depth(dir) === depth(root) + 1),
    nested: unpaid.filter((dir) => depth(dir) > depth(root) + 1),
  };
}

/**
 * What an offence asks for, by the kind of file it was found in. A stylesheet block cannot carry a
 * class, so telling it to "add thin-scrollbar" would be advice it cannot follow: the in-block
 * treatment exists because a rendered `pre` has no class to hold one.
 */
export const advice = (rule: string): string => {
  if (rule === "css-scroll-container") {
    return "a stylesheet container declares its treatment in the block: `scrollbar-width: thin` (visible, themed) or `scrollbar-width: none` (hidden)";
  }
  if (rule === "css-scrollbar-value") {
    return `scroll treatment is a closed list: ${SCROLLBAR_TREATMENTS.map((known) => `${known.property}: ${known.value}`).join(" | ")}`;
  }
  if (rule === "scroll-container") return "scroll container: add thin-scrollbar or no-scrollbar";
  if (rule === "glued-class") {
    return "class built from a template fragment: interpolate a complete class (`TONE_CLASS[tone]`) or a whole value, never a piece of one";
  }
  const known = RULES.find((candidate) => candidate.id === rule);
  // XTRM-979: the `?? "unnamed rule"` that used to stand here meant a rule added without a remedy
  // reported "unnamed rule" and passed — the reader learned nothing and the gate learned less. An
  // unknown id is now a crash at the point of offence, which is the only place the missing remedy can
  // be seen. `syntheticRuleIds` below names the ids that are not in `RULES` so a test can prove every
  // one of them answers, and that this throw is reachable rather than decorative.
  if (!known) {
    throw new Error(
      `no advice for rule "${rule}": every rule id an offence can carry needs a remedy, because a refusal that cannot say what to do is a refusal an operator routes around`,
    );
  }
  return known.why;
};

/** Rule ids that `offenders` can emit without a `RULES` entry, so an exhaustiveness test can see them. */
export const syntheticRuleIds = ["scroll-container", "glued-class", "css-scroll-container", "css-scrollbar-value"] as const;

/**
 * The offences in `found` that a park covers (work already accounted for) against the ones it does
 * not (work owed). XTRM-979: the report printed one line per file labelled by whether a park existed,
 * so a new offence inside a parked file — the only kind that is actually work owed — read exactly like
 * a parked one.
 *
 * The arithmetic takes the park as an argument instead of reading `PARKS`, so a test can state a park
 * of its own: a fixture that reads the live map breaks the day a slice pays its last park down, and a
 * gate test that fails for that reason teaches the next reader to edit the fixture rather than the
 * gate. `parkSplit` is the production entry point and adds nothing but the lookup.
 */
export type ParkLike = { offences: Array<{ rule: string; match: string }> };
export type ParkSplit = { parked: Offence[]; owed: Offence[] };

export const splitByPark = (park: ParkLike, found: Offence[]): ParkSplit => {
  const remaining = new Map<string, number>();
  for (const offence of park.offences) {
    const key = `${offence.rule} ${offence.match}`;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const parked: Offence[] = [];
  const owed: Offence[] = [];
  for (const offence of found) {
    const key = `${offence.rule} ${offence.match}`;
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      parked.push(offence);
    } else {
      owed.push(offence);
    }
  }
  return { parked, owed };
};

export const parkSplit = (file: string, found: Offence[]): ParkSplit => splitByPark(PARKS[file] ?? { offences: [] }, found);

/**
 * The lines `GATE_REPORT=1` prints for one file: a header with the two counts, then one line per
 * offence carrying the label that matters — `owed` for an offence no park covers, `parked` for one it
 * does. The label lives here rather than in the report block so a test can read the same string the
 * operator reads; a constant label leaves every count right and every line wrong.
 */
export const reportLines = (file: string, found: Offence[], park: ParkLike = PARKS[file] ?? { offences: [] }): string[] => {
  const { parked, owed } = splitByPark(park, found);
  const accounted = new Set(parked);
  const lines = [`${file}: ${owed.length} owed, ${parked.length} parked`];
  for (const offence of found) {
    const label = accounted.has(offence) ? "parked" : "owed";
    lines.push(`  :${offence.line} ${offence.match} [${offence.rule}] ${label}`);
  }
  return lines;
};

/**
 * Declaration blocks of a stylesheet. At-rules (`@layer`, `@media`) are skipped because their bodies
 * hold no declarations of their own; a **style rule** is kept even when it nests another rule, since
 * `.a { overflow-x: auto; .b { … } }` declares as well as nests and used to be dropped whole.
 */
export const cssBlocks = (source: string): Array<{ selector: string; body: string; offset: number }> => {
  const blocks: Array<{ selector: string; body: string; offset: number }> = [];
  const open: Array<{ selector: string; bodyStart: number }> = [];
  let boundary = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "{") {
      open.push({ selector: source.slice(boundary, i).trim(), bodyStart: i + 1 });
      boundary = i + 1;
    } else if (source[i] === "}") {
      const block = open.pop();
      if (block && !block.selector.startsWith("@")) {
        blocks.push({ selector: block.selector, body: source.slice(block.bodyStart, i), offset: block.bodyStart });
      }
      boundary = i + 1;
    }
  }
  return blocks;
};

export const offenders = (file: string): Offence[] => {
  const source = readFileSync(file, "utf8");
  const found: Offence[] = [];

  if (file.endsWith(".css")) {
    for (const block of cssBlocks(source)) {
      for (const declaration of scrollbarDeclarations(block.body, block.offset)) {
        if (isKnownScrollbarTreatment(declaration)) continue;
        // XTRM-979: `block.offset` is the line the BLOCK opens on, so a multi-line block cited its
        // selector for every declaration inside it. The declaration carries its own offset now.
        found.push({ rule: "css-scrollbar-value", match: declaration.literal, line: lineOf(source, declaration.offset) });
      }
      if (!CSS_SCROLL.test(block.body) || CSS_TREATMENT.test(block.body)) continue;
      if (SCROLL_TREATMENT.test(block.selector)) continue;
      const scrollDeclaration = CSS_SCROLL.exec(block.body);
      found.push({
        rule: "css-scroll-container",
        match: block.selector,
        line: lineOf(source, scrollDeclaration ? block.offset + scrollDeclaration.index : block.offset),
      });
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

  const lines = source.split("\n");
  for (const rule of RULES) {
    for (const match of source.matchAll(rule.pattern)) {
      const line = lineOf(source, match.index ?? 0);
      if (rule.prose && isProseLine(lines[line - 1] ?? "")) continue;
      found.push({ rule: rule.id, match: match[0], line });
    }
  }
  if (!file.endsWith(".css")) found.push(...gluedClassOffences(source));
  return found;
};

/**
 * The park comparison is a multiset match of `rule + literal`, so it survives code moving, refuses a
 * substituted offence, and refuses a duplicate of a parked one. Both directions are reported: a new
 * offence in a parked file, and a parked offence that is gone (the slice paid it and left the park).
 */
export const parkDrift = (file: string, found: Offence[]): string[] => {
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
