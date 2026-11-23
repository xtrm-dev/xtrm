import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CARD_FRAME, Card } from "./card.tsx";

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));

function tsxSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) tsxSources(path, found);
    else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) found.push(path);
  }
  return found;
}

/**
 * The three things a caller may not re-declare, expressed as axes rather than as a list of utility
 * names. Two classes on one axis write the same CSS property, and because `Card` composes with `cx`
 * (a plain join, not tailwind-merge) the winner is decided by the stylesheet's order, not by the
 * order the caller wrote them. That is the whole defect: `className="p-4 rounded-lg"` reads as an
 * intention and renders as a coin toss.
 *
 * `p-*` sits on both padding axes on purpose — it is the shorthand that overrides a gutter a caller
 * cannot see.
 */
const FRAME_AXES: Array<{ axis: "radius" | "horizontal" | "vertical"; claims: (klass: string) => boolean }> = [
  { axis: "radius", claims: (klass) => /^rounded(-|$)/.test(klass) },
  { axis: "horizontal", claims: (klass) => /^(p|px|pl|pr|ps|pe)-/.test(klass) },
  { axis: "vertical", claims: (klass) => /^(p|py|pt|pb)-/.test(klass) },
];

/**
 * Findings for one rendered element: an axis with more than one value on it is an override the
 * frame cannot win in a deterministic way. The input is `element.className`, the browser's string,
 * never the props the caller passed — a caller can hand `Card` a value that the component then
 * drops, and a check on the caller's props would bless a frame the element does not have.
 */
const frameFindings = (rendered: string): Array<{ axis: string; values: string[] }> =>
  FRAME_AXES.map(({ axis, claims }) => ({ axis, values: rendered.split(/\s+/).filter((klass) => claims(klass)) }))
    .filter(({ values }) => values.length > 1);

/** Render one card and read the className the DOM actually carries. */
function renderCardClass(className?: string): string {
  const id = `card-${Math.random().toString(36).slice(2)}`;
  render(<Card data-testid={id} className={className} />);
  const rendered = screen.getByTestId(id).className;
  cleanup();
  return rendered;
}

/**
 * Every `className` a `<Card>` call site can hand the component, read out of the sources.
 *
 * Three shapes are resolvable, and they are the only three: a double-quoted string attribute, the
 * same string as a braced expression, and `cx(...)` whose arguments are double-quoted literals or
 * conditionals and guards over them (`selected ? "a" : "b"`, `canWrite && "c"`). Everything else is
 * reported as **unresolved** rather than skipped, and the assertion below fails if any appears.
 *
 * The rule is stated as an allowlist because the denylist was measurably incomplete (h5iq, 6015407324):
 * a bare identifier kept the suite green in both spellings — `const FRAMEX = "rounded-lg p-4"` then
 * `<Card className={FRAMEX}>`, and `styles.card` — because the old scan looked for double-quoted
 * literals and a template, and an identifier carries neither. Single-quoted arguments were skipped by
 * the same regex. A check that enumerates the shapes it does *not* understand will always be one
 * spelling behind; a check that enumerates the three it *does* understand fails on the fourth.
 */
/**
 * Comments inside a braced attribute are prose, not code: the board's own `className` carries three
 * lines of comment naming `` `Card` `` and the states below it. Reading a backtick out of a comment
 * is the cheapest way to make a scan report a hole that does not exist, so the prose goes first.
 */
function stripComments(expression: string): string {
  return expression.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Split `call(...)` arguments on top-level commas, ignoring commas inside strings and nesting. */
function splitArguments(expression: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < expression.length; i += 1) {
    const ch = expression[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      args.push(expression.slice(start, i));
      start = i + 1;
    }
  }
  args.push(expression.slice(start));
  return args;
}

/**
 * The three resolvable shapes, decided by shape rather than by matching the failure I last saw.
 *
 * Returns the literals the site can hand `Card`, or `undefined` when the site cannot be resolved — in
 * which case the caller reports it and the assertion fails. Unresolvable is not the same as unsafe:
 * it means this scan cannot see the classes, which is exactly the state a reviewer must not mistake
 * for coverage.
 */
function resolveClassName(expression: string): string[] | undefined {
  const text = stripComments(expression).trim();
  // `{"bg-deep/40"}` — a plain double-quoted string.
  if (/^"(?:[^"\\]|\\.)*"$/.test(text)) return [text.slice(1, -1)];
  if (!text.startsWith("cx(")) return undefined;
  // The call must be the whole expression: `cx(...) + more` is not something this scan can read.
  let depth = 0;
  let close = -1;
  for (let i = text.indexOf("("); i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close !== text.length - 1) return undefined;
  const literals: string[] = [];
  // A trailing comma is ordinary formatting, not an argument: `cx(a, b,)` is the board's own shape.
  const args = splitArguments(text.slice(3, close)).map((raw) => raw.trim()).filter((arg, index, all) => arg !== "" || index !== all.length - 1);
  if (args.length === 0) return undefined;
  for (const arg of args) {
    if (arg === "") return undefined;
    // A template hides classes behind a spelling this scan cannot read. A single-quoted string needs
    // no separate guard: it carries no double-quoted literal, so the check below reports it. Testing
    // for the quote instead would refuse `cx("it's")`, where the apostrophe is class content.
    if (arg.includes("`")) return undefined;
    const quoted = [...arg.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1] ?? "");
    if (quoted.length === 0) {
      // No literal at all: a bare identifier or a member access (`FRAMEX`, `styles.card`) can carry a
      // whole frame, and this scan cannot see what it holds.
      return undefined;
    }
    literals.push(...quoted);
  }
  return literals;
}

function cardCallSites(): Array<{ file: string; literals: string[]; unresolved: string[] }> {
  const sites: Array<{ file: string; literals: string[]; unresolved: string[] }> = [];
  for (const file of tsxSources(SRC)) {
    if (file === join(SRC, "ui", "card.tsx")) continue;
    const source = readFileSync(file, "utf8");
    for (let at = source.indexOf("<Card"); at !== -1; at = source.indexOf("<Card", at + 5)) {
      let depth = 0;
      let end = at;
      for (let i = at; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
        else if (ch === ">" && depth === 0) {
          end = i;
          break;
        }
      }
      const tag = source.slice(at, end + 1);
      const attribute = tag.indexOf("className=");
      if (attribute === -1) continue;
      const value = tag.slice(attribute + "className=".length).replace(/^\s+/, "");
      if (value.startsWith('"')) {
        sites.push({ file: file.slice(SRC.length + 1), literals: [value.slice(1, value.indexOf('"', 1))], unresolved: [] });
        continue;
      }
      if (!value.startsWith("{")) continue;
      let braces = 0;
      let close = 0;
      for (let i = 0; i < value.length; i += 1) {
        if (value[i] === "{") braces += 1;
        else if (value[i] === "}") {
          braces -= 1;
          if (braces === 0) {
            close = i;
            break;
          }
        }
      }
      const expression = value.slice(1, close);
      const literals = resolveClassName(expression);
      const where = `${file.slice(SRC.length + 1)}: ${stripComments(expression).trim()}`;
      sites.push(
        literals === undefined
          ? { file: file.slice(SRC.length + 1), literals: [], unresolved: [where] }
          : { file: file.slice(SRC.length + 1), literals, unresolved: [] },
      );
    }
  }
  return sites;
}

/**
 * XTRM-989: one card. These assertions are about the frame being decided in one place, not about
 * the string reading well: a surface that re-declares a radius or a padding has to delete them.
 */
describe("Card", () => {
  it("draws the row radius, the hairline and the list gutter", () => {
    render(<Card data-testid="card">body</Card>);
    const card = screen.getByTestId("card");
    // The row's radius (--radius-md), never the panel's rounded-lg: a card is a record box, and the
    // panel frame belongs to `Section` (px-5 py-4).
    expect(card.className).toContain("rounded-md");
    expect(card.className).not.toContain("rounded-lg");
    expect(card.className).toContain("border-border-muted");
    // The gutter a list row and a list-inset SectionHeader use, so the card's text starts on the
    // same x as the rows above it; the stack rhythm is the card's, not the caller's.
    expect(card.className).toContain("px-3");
    expect(card.className).toContain("py-2.5");
    expect(card.className).toContain("gap-2");
    expect(card.className).toContain("flex-col");
  });

  it("keeps the frame when a caller adds the state the card cannot know", () => {
    render(<Card data-testid="card" className="bg-deep/40" aria-pressed="true" />);
    const card = screen.getByTestId("card");
    expect(card.className).toContain(CARD_FRAME);
    expect(card.className).toContain("bg-deep/40");
    expect(card.getAttribute("aria-pressed")).toBe("true");
  });

  it("decides radius, gutter and rhythm once, inside the constant", () => {
    // A second `rounded-*`, `px-*` or `py-*` in the frame is the drift the old call sites carried.
    expect(CARD_FRAME.match(/rounded-/g) ?? []).toHaveLength(1);
    expect(CARD_FRAME.match(/\bpx-/g) ?? []).toHaveLength(1);
    expect(CARD_FRAME.match(/\bpy-/g) ?? []).toHaveLength(1);
  });

  it("refuses a caller that re-declares the frame, per element", () => {
    // XTRM-998 (review of #502, em0u): `cx` is a plain join, so a caller's `p-4 rounded-lg` keeps
    // both declarations and the render decides the winner by stylesheet order. The check reads the
    // ELEMENT's className, not the caller's props, because the element is what a user sees.
    const allowed: Array<[string, string | undefined]> = [
      ["frame alone", undefined],
      ["the state a card cannot know", "bg-deep/40"],
      ["selection and focus", "group/card outline-none focus-visible:ring-2 border-accent/60"],
      ["a row action hook", "group horizontal"],
    ];
    for (const [label, className] of allowed) {
      expect(frameFindings(renderCardClass(className)), `${label}: the frame stays single-valued`).toEqual([]);
    }

    const refused: Array<[string, string, string]> = [
      ["a second radius", "rounded-lg", "radius"],
      ["a second gutter", "p-4", "horizontal"],
      ["the measured call site", "p-4 rounded-lg", "radius"],
      ["a one-sided override", "pl-6", "horizontal"],
    ];
    for (const [label, className, axis] of refused) {
      const findings = frameFindings(renderCardClass(className));
      expect(findings.map((finding) => finding.axis), `${label}: ${axis} carries two values`).toContain(axis);
    }

    // The shorthand is the interesting one: `p-4` writes both paddings, so it must be refused on
    // both axes rather than only where the caller thought they were writing.
    const shorthand = frameFindings(renderCardClass("p-4")).map((finding) => finding.axis);
    expect(shorthand.sort()).toEqual(["horizontal", "vertical"]);
  });

  it("resolves the three shapes it can read, and refuses the rest as unresolved", () => {
    // The mutation for each shape the reviewer measured as skipped (h5iq, 6015407324). These are
    // direct assertions rather than call-site mutations so the refusal survives a tree where no call
    // site happens to use the shape — the failure has to be a property of the scan, not of the code
    // under it. A `undefined` here means "reported unresolved", never "safe".
    const resolved: Array<[string, string[]]> = [
      ['"bg-deep/40"', ["bg-deep/40"]],
      ['cx("bg-deep/40")', ["bg-deep/40"]],
      ['cx("a", selected ? "b" : "c", canWrite && "d",)', ["a", "b", "c", "d"]],
      ['cx("it\'s-a-class")', ["it's-a-class"]],
    ];
    for (const [expression, literals] of resolved) {
      expect(resolveClassName(expression), `${expression} is one of the three resolvable shapes`).toEqual(literals);
    }

    const unresolved = [
      '`text-${tone} leading-snug`',
      "FRAMEX",
      "styles.card",
      "cx(`rounded-lg p-4`)",
      "cx(FRAMEX)",
      "cx('rounded-lg p-4')",
      "cx(styles.card)",
      'cx("a") + "b"',
      "clsx('a')",
      "cx()",
    ];
    for (const expression of unresolved) {
      expect(resolveClassName(expression), `${expression} cannot be read, so it must not be blessed`).toBeUndefined();
    }
  });

  it("holds every Card call site to the same frame", () => {
    // The check above is only as good as its coverage, so the call sites are read from the sources
    // and each one is rendered. A caller that passes a radius or a padding turns this red, which is
    // the mutation the finding asks for: add `rounded-lg p-4` to a call site and watch it fail.
    const sites = cardCallSites();
    expect(sites.length, "the scan must find the call sites it claims to hold").toBeGreaterThan(0);
    expect(
      sites.flatMap((site) => site.unresolved),
      "only a double-quoted literal and cx() of double-quoted literals resolve; anything else — a template, a single-quoted argument, a bare identifier, a member access — is unresolved and cannot be blessed",
    ).toEqual([]);

    const offenders: string[] = [];
    for (const site of sites) {
      for (const literal of site.literals) {
        if (literal.trim() === "") continue;
        for (const finding of frameFindings(renderCardClass(literal))) {
          offenders.push(`${site.file}: ${finding.axis} re-declared by "${literal}" (${finding.values.join(" ")})`);
        }
      }
    }
    expect(offenders, "a card call site adds state, never a second frame").toEqual([]);
  });

  it("is the only place a card frame is written: no surface re-declares it", () => {
    // Beside the component, `src/issues` held the same frame twice and the page used another one
    // (`rounded-lg border border-border-muted p-4`). Comments record that history, so the component
    // itself is out of the scan; every other source file must be free of both shapes.
    const offenders: string[] = [];
    for (const file of tsxSources(SRC)) {
      if (file === join(SRC, "ui", "card.tsx")) continue;
      const source = readFileSync(file, "utf8");
      for (const frame of ["rounded-md border border-border-muted px-3 py-2.5", "rounded-lg border border-border-muted"]) {
        if (source.includes(frame)) offenders.push(`${file.slice(SRC.length + 1)}: ${frame}`);
      }
    }
    expect(offenders, "a card is composed from src/ui/card.tsx, never re-drawn").toEqual([]);
  });
});
