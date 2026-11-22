import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CSS_SCROLL,
  CSS_TREATMENT,
  HOLES,
  PARKS,
  ROOT,
  RULES,
  SCROLL_CONTAINER,
  SCROLL_TREATMENT,
  advice,
  cssBlocks,
  directories,
  gluedClassOffences,
  inScope,
  offenders,
  ownsSource,
  parkDrift,
  unpaidDirectories,
  walk,
} from "../../scripts/units-gate.ts";

/**
 * The gate itself lives in `../../scripts/units-gate.ts`: the rule set, the park map, and the walk.
 * This file is the assertion set — what the gate must refuse, what it must spare, and what it admits
 * it cannot prove.
 *
 * Moved in XTRM-958 so the park reconciler measures with the same code the gate runs. The docblock
 * that explains why the ladder exists moved with it.
 *
 * **A conflict in the park map is reconciled by `scripts/units-parks-reconcile.ts`, never by hand.**
 * A hand union of both sides re-adds entries a merged slice deleted — the slice paid the offence down
 * and deleted the entry, and the stale branch still carries it. A count-only rule is the same defect
 * one level down: it lets a resolver hit the number while re-adding the entry. The helper unions the
 * two sides as a `(rule, match)` multiset per file, measures every parked file with `offenders()`
 * from `units-gate.ts`, drops what the files no longer hold, and prints the map with the measured
 * count beside each offence. Run it, read the numbers, paste the map.
 *
 * It runs in the state it exists for. The gate holds the markers and the gate is what the helper
 * imports to measure, so it loads one complete side of the conflicted file as its reader while both
 * sides stay in the map it reconciles — a static import of a conflicted module dies at parse time
 * before a single park is read. `--file` names the source; `--project-root` moves both the read and
 * the walk together.
 */


describe("the console has no px font size or glyph size outside the ladder", () => {
  it("finds none in any in-scope source file under src", () => {
    const files = walk(ROOT);
    // A floor over the whole tree cannot see one directory quietly leaving the walk: measured, `src`
    // holds 134 files and `src/github` contributes 11, so dropping that directory still cleared a
    // `> 120` floor. Each in-scope directory therefore has to contribute, named when it does not.
    //
    // Every directory, not every top-level one: a nested directory can leave the walk while a sibling
    // keeps its parent contributing — `src/project/questions` (five files) does exactly that. The
    // enumeration mirrors the walk's own shape, so the directory the walk skips is the one reported.
    // Every directory, not every top-level one, and the same computation the falsifier below pins:
    // a nested directory can leave the walk while a sibling keeps its parent contributing.
    //
    // Two failures, two sentences: a top-level directory that contributes nothing means the walk's
    // filter skipped it, a nested one means the walk stopped recursing. One assertion could not say
    // which, and the next reader would take whichever they expected.
    const { topLevel, nested } = unpaidDirectories(ROOT, files);
    expect(
      topLevel,
      "a top-level directory owns a source file but contributes none to the walk: the walk's filter skipped it",
    ).toEqual([]);
    expect(
      nested,
      "the walk does not recurse: a nested directory owns a source file but contributes none",
    ).toEqual([]);
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
          const why = advice(offence.rule);
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

  it("asks a directory for a contribution only when it owns a file the walk should read", () => {
    // The filter that keeps `__fixtures__` quiet must stay a rule and not become a permission: one
    // real source file beside several tests is still a directory the walk owes a contribution from.
    const probe = mkdtempSync(join(tmpdir(), "units-owns-"));
    try {
      const mixed = join(probe, "one-source-beside-tests");
      const testsOnly = join(probe, "tests-only");
      mkdirSync(mixed, { recursive: true });
      mkdirSync(testsOnly, { recursive: true });
      writeFileSync(join(mixed, "row.tsx"), "export const row = 1;\n");
      writeFileSync(join(mixed, "row.test.tsx"), "it(\"x\", () => {});\n");
      writeFileSync(join(mixed, "row.stories.tsx"), "export const story = 1;\n");
      writeFileSync(join(testsOnly, "thing.test.ts"), "it(\"x\", () => {});\n");
      expect(ownsSource(mixed), "one source file beside tests still makes the directory owed").toBe(true);
      expect(ownsSource(testsOnly), "a directory of tests only has nothing the walk should read").toBe(false);
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });

  it("enumerates nested directories, and owes the walk a `.ts`-only directory", () => {
    // Two properties the coverage guard stands on, asserted on a tree this test owns because neither
    // can be falsified against `ROOT`: the enumeration recurses (a top-level-only list returns an
    // empty `missing`, so neither failure sentence can fire), and the predicate counts a `.ts` source
    // (ten directories here hold only `.ts`, and narrowing it to `(tsx|css)$` would silently stop
    // requiring all ten through `unpaidDirectories`).
    const tree = mkdtempSync(join(tmpdir(), "units-dirs-"));
    try {
      mkdirSync(join(tree, "a", "b"), { recursive: true });
      mkdirSync(join(tree, "ts-only"), { recursive: true });
      mkdirSync(join(tree, "beside-child", "child"), { recursive: true });
      writeFileSync(join(tree, "a", "b", "row.ts"), "export const row = 1;\n");
      writeFileSync(join(tree, "ts-only", "col.ts"), "export const col = 1;\n");
      writeFileSync(join(tree, "beside-child", "own.ts"), "export const own = 1;\n");
      writeFileSync(join(tree, "beside-child", "child", "deep.ts"), "export const deep = 1;\n");

      expect(
        directories(tree),
        "the directory walk must recurse: a nested directory is enumerated",
      ).toEqual(expect.arrayContaining([join(tree, "a"), join(tree, "a", "b")]));

      // An empty file list is the condition the guard exists for: the walk contributed nothing.
      // Both levels are named, which is what makes this a test of the predicate *in its use*.
      const unpaid = unpaidDirectories(tree, []);
      expect(
        unpaid.topLevel,
        "a directory owning a `.ts` source is owed a contribution, at the top level too",
      ).toEqual([join(tree, "beside-child"), join(tree, "ts-only")]);
      expect(unpaid.nested, "and at a nested level").toEqual([
        join(tree, "a", "b"),
        join(tree, "beside-child", "child"),
      ]);

      // A directory's own file beside a child that contributes. Asking "is any file under this
      // directory?" instead of "did this directory's own files get read?" leaves the parent
      // exempt while its own source vanishes from the walk — `src/project` has that shape today.
      // The file list here holds the child only, so the parent's own source was never read.
      // Both children contribute, so the only directory left owed is the parent whose own source
      // never entered the walk.
      const partial = unpaidDirectories(tree, [
        join(tree, "a", "b", "row.ts"),
        join(tree, "beside-child", "child", "deep.ts"),
      ]);
      expect(
        partial.topLevel,
        "a child that contributes does not discharge its parent's own unread source",
      ).toEqual([join(tree, "beside-child"), join(tree, "ts-only")]);
      expect(partial.nested, "the child did contribute, so it is not owed").toEqual([]);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
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
        if (!RULES.some((rule) => rule.id === offence.rule) && offence.rule !== "scroll-container" && offence.rule !== "glued-class") {
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
      "const m = { marginTop: -8 };",
      "const n = { paddingInline: -4 };",
      "const h4 = { marginLeft: depth * 14 };",
      "const i = { paddingLeft: depth * 16 };",
      "const j = { paddingLeft: depth * 16, };",
      "const l = { paddingInline: 12 };",
      "const m = { marginBlockStart: 8 };",
      'const n = "ps-[2px]";',
      "const o = { fontSize: 11 };",
      'const p = <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3">;',
      'const p2 = <div className="grid grid-cols-[6rem_auto]" />;',
      'const p3 = <div className="grid grid-cols-[minmax(6rem,8rem)_1fr]" />;',
      'const p4 = <div className="grid grid-cols-[minmax(4rem,auto)_minmax(0,1fr)]" />;',
      'const p5 = <dl style={{ gridTemplateColumns: "6rem 1fr" }} />;',
      'const q = <Fields labelWidth="10rem" rows={rows} />;',
      'const q1 = <Fields labelWidth={"10rem"} rows={rows} />;',
      "const q2 = <Fields labelWidth={'10rem'} rows={rows} />;",
      'const q3 = <Fields labelWidth={`10rem`} rows={rows} />;',
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
      ["label-grid-class", "grid-cols-[6.5rem_minmax(0,1fr)]"],
      // The spellings CORE's label-column sweep walked past (XTRM-971 review round 2): a fitted
      // first track with a plain second one, a two-value minmax, and the content-sized shape whose
      // floor is a literal. Each is the same decision written differently.
      ["label-grid-class", "grid-cols-[6rem_auto]"],
      ["label-grid-class", "grid-cols-[minmax(6rem,8rem)_1fr]"],
      ["label-grid-class", "grid-cols-[minmax(4rem,auto)_minmax(0,1fr)]"],
      ["label-grid-style-literal", 'gridTemplateColumns: "6rem 1fr"'],
      ["label-width-literal", 'labelWidth="10rem"'],
      ["label-width-literal", 'labelWidth={"10rem"}'],
      ["label-width-literal", "labelWidth={'10rem'}"],
      ["label-width-literal", "labelWidth={`10rem`}"],
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
      // A table's column template is not a label column: it only looks like one when it starts with
      // a rem step. XTRM-971's contract names these three as legal and they must stay legal.
      "grid grid-cols-[7.5rem_minmax(0,1fr)_7rem_7rem_6.5rem_7rem_1.25rem] items-center gap-3",
      "grid shrink-0 grid-cols-[6.5rem_7rem_3.5rem_2.5rem_6rem] items-center gap-2",
      "gridTemplateColumns: `${LABEL_COLUMN} 1fr auto`",
      // A content-sized label column and a page column take their step the same way; only the
      // shape differs, so a step interpolated into either template passes.
      "gridTemplateColumns: `minmax(${PART_LABEL_COLUMN}, auto) minmax(0, 1fr)`",
      'labelWidth={PAGE_LABEL_COLUMN}', 
    ]) {
      const caught = RULES.flatMap((rule) => [...legal.matchAll(rule.pattern)].map((match) => match[0]));
      expect(caught, `legal shape refused: ${legal}`).toEqual([]);
    }
    // A CSS scroll container without a treatment is caught, a treated one is spared, and a block that
    // only nests other blocks is not mistaken for a declaration block.
    const css = [
      ".bare {",
      "  overflow-x: auto;",
      "}",
      ".treated {",
      "  overflow-y: auto;",
      "  scrollbar-width: thin;",
      "}",
      ".nesting {",
      "  overflow-x: auto;",
      "  .child {",
      "    color: red;",
      "  }",
      "}",
      "@layer utilities {",
      "  .wrap {",
      "    display: flex;",
      "  }",
      "}",
    ].join("\n");
    // A rule that declares and also nests is a container: it used to be dropped whole because the
    // parent was flagged the moment its child closed.
    expect(
      cssBlocks(css)
        .filter((block) => CSS_SCROLL.test(block.body) && !CSS_TREATMENT.test(block.body))
        .map((block) => block.selector),
      "a container that nests another rule must still be scanned",
    ).toEqual([".bare", ".nesting"]);

    // An at-rule is skipped as a block, but its body is not: `@media` holds ordinary rules, and a px
    // length declared inside one must be found. Skipping at-rule bodies wholesale would be the same
    // defect as dropping a nesting block, one level up.
    const mediaRoot = mkdtempSync(join(tmpdir(), "units-css-"));
    const mediaFile = join(mediaRoot, "media.css");
    writeFileSync(
      mediaFile,
      "@media (min-width: 40rem) {\n  .media-probe {\n    overflow-x: auto;\n    padding-inline: 8px;\n  }\n}\n",
    );
    try {
      expect(
        offenders(mediaFile).map((offence) => `${offence.rule} ${offence.match}`),
        "a rule inside an at-rule must be scanned like one outside it: the container and the px length are both reported",
      ).toEqual(expect.arrayContaining(["css-scroll-container .media-probe", "css-px-spacing padding-inline: 8px"]));
    } finally {
      rmSync(mediaRoot, { recursive: true, force: true });
    }
    expect(cssBlocks(css).map((block) => block.selector)).not.toContain("@layer utilities");
  });

  it("refuses a planted hand-rolled label grid and spares the comment that records the drift", () => {
    // XTRM-971: the gate has to fail on the shape the sweep removed, in the form a future author
    // would actually write it (a `<dl>` with the class), and it has to stay quiet on the two
    // comments that quote that same shape as evidence of what was fixed.
    const root = mkdtempSync(join(tmpdir(), "units-label-"));
    const file = join(root, "planted.tsx");
    writeFileSync(
      file,
      [
        'const planted = () => (',
        '  <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">',
        "    <dt>State</dt>",
        "  </dl>",
        ");",
        "// The 8rem column this replaced kept `grid-cols-[8rem_1fr]` on both templates.",
        " * and a doc comment quoting `grid-cols-[8rem_1fr_auto]` is prose, not code.",
        'const ok = <Fields rows={rows} labelWidth={PART_LABEL_COLUMN} />;',
        "",
      ].join("\n"),
    );
    try {
      const found = offenders(file);
      expect(found.map((offence) => offence.rule), "the planted grid is the only offence").toEqual(["label-grid-class"]);
      expect(found[0]?.line, "and it names the line it is on").toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads a class cut out of a template, and spares a whole interpolated value", () => {
    // XTRM-949: a class cut out of a template, and the shapes that must stay legal. The rule is about
    // the boundary between literal text and an interpolation, so every spare below is a case where
    // that boundary is a space (a whole value) and every catch is a case where it is not.
    const classTemplates = [
      // caught: glued on both sides
      '<li className={`text-${tone === "ink-muted" ? "ink-muted" : "ink"} leading-snug`} />',
      // caught: glued on the prefix side only
      '<div className={`px-${step} pt-1`} />',
      // caught: glued through a helper, so a wrapper is not a hiding place
      "<div className={cx(`text-${tone} p-1`)} />",
      // spared: the interpolation IS the whole value (NewIssueDialog's `input`), and the literal
      // after it starts at a space; judging it would mean resolving a constant across the module
      "<input className={`${input} resize-y`} />",
      // spared: whole values, space separated (IntegrationSurface)
      '<div className={`min-w-0 break-words ${mono ? "font-mono" : ""} ${unverified ? "text-ink-muted" : "text-ink"}`} />',
      // spared: a map lookup is not a template at all — the call site fix for this issue
      '<li className={`${TONE_CLASS[tone]} leading-snug`} />',
      // spared: no template, no verdict
      '<div className="text-sm" />',
    ].join("\n");
    expect(
      gluedClassOffences(classTemplates).map((offence) => offence.line),
      "a class cut out of a template is caught, and a whole interpolated value is spared",
    ).toEqual([1, 2, 3]);
    expect(
      gluedClassOffences('const a = `text-${tone} p-1`;').length,
      "glue outside a className or a cx()/cn() call is not a class and must not be judged",
    ).toBe(0);
    // The same defect one level down. A template nested inside an interpolation builds a class out of
    // a fragment exactly as a top-level one does, and a scan that stopped at the outer template's own
    // parts reported zero offences for it — silence that reads as coverage.
    const nested = [
      // caught: the inner template is glued, the outer one is not
      '<div className={`${on ? `text-${tone}` : ""} leading-snug`} />',
      // caught: two levels down
      '<div className={`${a ? `${b ? `px-${c}` : ""}` : ""} p-1`} />',
      // spared: the inner template interpolates a whole value
      '<div className={`${on ? `${TONE_CLASS[tone]} p-1` : ""} leading-snug`} />',
      // spared: a backtick inside a string inside the interpolation is not a template
      '<div className={`${on ? "a `b` c" : ""} leading-snug`} />',
    ].join("\n");
    expect(
      gluedClassOffences(nested).map((offence) => offence.line),
      "a template nested in an interpolation is read, and a backtick in a string is not a template",
    ).toEqual([1, 2]);
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
