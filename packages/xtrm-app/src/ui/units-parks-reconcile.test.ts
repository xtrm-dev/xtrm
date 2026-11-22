import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { type ParkedOffence, multiset, oneSide, parkLiteral, parseParks, printParks, reconcile, unionConflict } from "../../scripts/units-parks-reconcile.ts";

/**
 * XTRM-958. The reconciler is judged by replaying the conflict shapes that actually happened, because
 * each one defeated a different hand resolution: a union resurrects a deleted park, a count lets a
 * resolver hit the number while re-adding an entry, and a substitution keeps the total while the
 * park names an offence the file no longer has.
 *
 * `measure` is injected, so a shape is a map from file to what that file holds — no temp trees, and
 * the case is readable beside the answer.
 */
const parkMap = (entries: Array<[string, string, ParkedOffence[]]>) => {
  const body = entries
    .map(([file, owner, offences]) => {
      const path = file.split("/").map((part) => `"${part}"`).join(", ");
      const list = offences.map((offence) => `      { rule: "${offence.rule}", match: "${offence.match}" },`).join("\n");
      return `  [join(${path})]: {\n    owner: "${owner}",\n    offences: [\n${list}\n    ],\n  },`;
    })
    .join("\n");
  return `import { join } from "node:path";\n\nexport const PARKS: Record<string, Park> = {\n${body}\n};\n`;
};

/** One side of a conflict: the same map, wrapped in the markers git writes. */
const conflicted = (...sides: string[]) =>
  sides
    .map((side, index) => `${index === 0 ? "<<<<<<< HEAD" : "======="}\n${side}`)
    .join("") + ">>>>>>> stale/base\n";

const offscale = (match: string): ParkedOffence => ({ rule: "offscale-rem-font", match });
const spacing = (match: string): ParkedOffence => ({ rule: "arbitrary-px-spacing", match });

type Measure = (file: string) => ParkedOffence[];

const shape = (mine: ReturnType<typeof parkMap>, theirs: ReturnType<typeof parkMap>, measure: Measure) =>
  reconcile(conflicted(mine, theirs), measure);

describe("the park reconciler", () => {
  it("shape 1: a stale base does not resurrect a park the merged tree paid to zero", () => {
    // The two files slice C paid down: the merged main deletes them, the stale side still parks them.
    const merged = parkMap([["src/shell/ContextSidebar.tsx", "XTRM-939", [offscale("text-[0.68rem]")]]]);
    const stale = parkMap([
      ["src/surfaces/ActivitySurface.tsx", "XTRM-936", [offscale("text-[0.68rem]"), offscale("text-[0.68rem]")]],
      ["src/project/workers/WorkerRow.tsx", "XTRM-936", [offscale("text-[0.68rem]")]],
      ["src/shell/ContextSidebar.tsx", "XTRM-939", [offscale("text-[0.68rem]")]],
    ]);
    const result = shape(merged, stale, (file) =>
      file.endsWith("ContextSidebar.tsx") ? [offscale("text-[0.68rem]")] : [],
    );
    expect(result.parks.map((park) => park.owner)).toEqual(["XTRM-939"]);
    expect(result.dropped.join("\n")).toContain("src/surfaces/ActivitySurface.tsx: measures zero");
    expect(result.dropped.join("\n")).toContain("src/project/workers/WorkerRow.tsx: measures zero");
    expect(result.drift).toEqual([]);
  });

  it("shape 2: a slice that paid its own park to zero loses only that entry", () => {
    // ContextSidebar holds three offences; the merged side paid one of them down and deleted one entry.
    const merged = parkMap([["src/shell/ContextSidebar.tsx", "XTRM-939", [offscale("text-[0.65rem]"), offscale("text-[0.68rem]")]]]);
    const result = shape(merged, merged, () => [offscale("text-[0.65rem]"), offscale("text-[0.68rem]")]);
    expect(result.parks[0]?.offences).toEqual([offscale("text-[0.65rem]"), offscale("text-[0.68rem]")]);
    expect(result.dropped).toEqual([]);
  });

  it("shape 3: two slices deleting different siblings both survive as deletions", () => {
    // One file gone from both sides (paid to zero), one kept: a union would keep both, and the gate
    // would then refuse the paid-down file forever.
    const mine = parkMap([["src/issues/PullRequestsBlock.tsx", "XTRM-941", [offscale("text-[0.68rem]"), offscale("text-[0.68rem]" )]]]);
    const theirs = parkMap([["src/issues/meta.tsx", "XTRM-943", [spacing("gap-[2px]")]]]);
    const result = shape(mine, theirs, (file) => (file.endsWith("PullRequestsBlock.tsx") ? [offscale("text-[0.68rem]"), offscale("text-[0.68rem]")] : []));
    expect(result.parks.map((park) => park.owner)).toEqual(["XTRM-941"]);
    expect(result.parks[0]?.offences).toHaveLength(2);
    expect(result.dropped.join("\n")).toContain("src/issues/meta.tsx: measures zero");
  });

  it("shape 4: a slice adding a new park keeps it, with the measured count", () => {
    const mine = parkMap([["src/issues/meta.tsx", "XTRM-943", [spacing("gap-[2px]")]]]);
    const theirs = parkMap([["src/issues/meta.tsx", "XTRM-943", [spacing("gap-[2px]"), spacing("gap-[2px]")]]]);
    const result = shape(mine, theirs, () => [spacing("gap-[2px]"), spacing("gap-[2px]")]);
    expect(result.parks[0]?.offences).toEqual([spacing("gap-[2px]"), spacing("gap-[2px]")]);
    expect(result.drift).toEqual([]);
  });

  it("shape 5: a substituted offence is refused, not absorbed by the count", () => {
    // The file keeps one offence, but not the one the park names — the shape a count cannot see.
    const mine = parkMap([["src/issues/meta.tsx", "XTRM-943", [spacing("gap-[2px]")]]]);
    const result = shape(mine, mine, () => [offscale("text-[0.7rem]")]);
    expect(result.parks[0]?.offences).toEqual([]);
    expect(result.dropped.join("\n")).toContain("arbitrary-px-spacing gap-[2px] is no longer found");
    expect(result.drift.join("\n")).toContain("measured 1 of offscale-rem-font text-[0.7rem], which no park names");
  });

  it("reports the map it produced, one line per offence with its measured count", () => {
    const mine = parkMap([["src/issues/meta.tsx", "XTRM-943", [spacing("gap-[2px]"), spacing("gap-[2px]")]]]);
    const printed = printParks(shape(mine, mine, () => [spacing("gap-[2px]"), spacing("gap-[2px]")]));
    expect(printed).toContain("src/issues/meta.tsx -> XTRM-943 (2 parked)");
    expect(printed).toContain("arbitrary-px-spacing gap-[2px] x2 (measured 2)");
  });

  it("reads the park literal it was given, and says nothing when there is no map", () => {
    expect(parkLiteral("export const OTHER = {};")).toBeUndefined();
    const one = parkMap([["src/issues/meta.tsx", "XTRM-943", [spacing("gap-[2px]")]]]);
    expect(parkLiteral(one)).toContain("XTRM-943");
    expect(parseParks(parkLiteral(one)!)).toEqual([{ file: "src/issues/meta.tsx", owner: "XTRM-943", offences: [spacing("gap-[2px]")] }]);
  });

  it("reads a park whose match carries a quote of its own", () => {
    // A scroll-container offence's `match` is the trimmed source line, and a class line contains
    // double quotes, so the park literal holds an escaped quote. The first parser matched `[^"]*`,
    // read the whole entry as zero offences, and silently dropped a park the file still held — the
    // one failure this tool exists to prevent. Both spellings below are parks on the closed list.
    const quoted = [
      '{ rule: "scroll-container", match: "className=\\"overflow-y-auto p-2\\"" }',
      '{ rule: "quoted-px-spacing", match: "content-\\"x\\"" }',
    ];
    const source = [
      'export const PARKS: Record<string, Park> = {',
      '  [join("src", "surfaces", "ActivitySurface.tsx")]: {',
      '    owner: "XTRM-947",',
      `    offences: [${quoted[0]}, ${quoted[1]}],`,
      "  },",
      "};",
    ].join("\n");
    expect(parseParks(source)).toEqual([
      {
        file: "src/surfaces/ActivitySurface.tsx",
        owner: "XTRM-947",
        offences: [
          { rule: "scroll-container", match: 'className="overflow-y-auto p-2"' },
          { rule: "quoted-px-spacing", match: 'content-"x"' },
        ],
      },
    ]);
    // And through the whole reconciliation, not just the parser: a quoted park that measures must be
    // kept and printed with its value intact.
    const measured = [
      { rule: "scroll-container", match: 'className="overflow-y-auto p-2"' },
      { rule: "quoted-px-spacing", match: 'content-"x"' },
    ];
    const result = reconcile(unionConflict(source), () => measured);
    expect(result.dropped).toEqual([]);
    expect(result.parks.flatMap((park) => park.offences)).toHaveLength(2);
    expect(printParks(result)).toContain('content-"x"');
  });

  it("unions both sides of a conflict without touching what is outside it", () => {
    const before = 'const kept = "before";\n';
    const after = 'const keptAfter = "after";\n';
    const unioned = unionConflict(`${before}<<<<<<< HEAD\n${after}=======\nconst theirs = 1;\n>>>>>>> base\n`);
    expect(unioned).toContain('const kept = "before";');
    expect(unioned).toContain("const keptAfter");
    expect(unioned).toContain("const theirs = 1;");
    expect(unioned).not.toMatch(/^<{7}|^={7}$|^>{7}/m);
  });

  // The diff3 base section's *content* is kept, only its markers dropped. Pinned because it looks like
  // a leftover: a resolver reading the output will see three copies of a park, and the reason that is
  // safe is the multiset union below, not luck.
  it("keeps the diff3 base section's content, and the multiset union absorbs the duplicate", () => {
    const side = parkMap([["src/issues/meta.tsx", "XTRM-943", [spacing("gap-[2px]")]]]);
    const diff3 = ["<<<<<<< HEAD", side, "||||||| merged common ancestors", side, "=======", side, ">>>>>>> theirs"].join("\n");
    const unioned = unionConflict(diff3);
    expect(unioned).toContain("XTRM-943");
    expect(unioned.split("XTRM-943")).toHaveLength(4);
    const result = reconcile(unioned, () => [spacing("gap-[2px]")]);
    expect(result.parks.flatMap((park) => park.offences)).toHaveLength(1);
    expect(result.pruned).toEqual([]);
  });

  // The two directions a park-only view cannot see. Both were holes in the first version of this
  // helper and both were found by running it, not by reading it: `reconcile` only ever iterated the
  // parks the file already carried, so a deleted park was invisible and an unconflicted stale park
  // was reported as "unchanged".
  it("names an offence no park covers, when the whole park was deleted", () => {
    // Neither side names meta.tsx: one side deleted the entry, the other never carried it, so the
    // union has nothing to iterate for that file — the case that was invisible.
    const theirs = parkMap([["src/shell/ContextSidebar.tsx", "XTRM-939", [offscale("text-[0.65rem]")]]]);
    const mine = parkMap([["src/issues/PullRequestsBlock.tsx", "XTRM-941", [offscale("text-[0.68rem]")]]]);
    const measured = { "src/issues/PullRequestsBlock.tsx": [offscale("text-[0.68rem]")], "src/issues/meta.tsx": [spacing("gap-[2px]")] };
    const result = reconcile(conflicted(mine, theirs), (file) => measured[file as keyof typeof measured] ?? [], () =>
      Object.entries(measured).map(([file, offences]) => ({ file, offences })),
    );
    expect(result.unparked).toEqual(["src/issues/meta.tsx: measures arbitrary-px-spacing gap-[2px], and no park names it"]);
  });

  it("says nothing about a file whose measured offences its park already names", () => {
    const only = parkMap([["src/issues/meta.tsx", "XTRM-943", [spacing("gap-[2px]")]]]);
    const result = reconcile(only, () => [spacing("gap-[2px]")], () => [{ file: "src/issues/meta.tsx", offences: [spacing("gap-[2px]")] }]);
    expect(result.unparked).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.pruned).toEqual([]);
  });

  it("keeps one whole side of a conflict, so a reader can be imported from it", () => {
    // The gate holds the markers and the gate is what gets imported, so a static import dies before a
    // single park is read (F1). One side is a complete version of the file by construction; this is
    // the only reason importing it is legitimate.
    const source = [
      'const before = 1;',
      "<<<<<<< HEAD",
      'const pick = "ours";',
      "=======",
      'const pick = "theirs";',
      ">>>>>>> stale/base",
      "const after = 2;",
    ].join("\n");
    expect(oneSide(source)).toEqual(['const before = 1;', 'const pick = "ours";', "const after = 2;"].join("\n"));
    expect(oneSide("export const clean = true;\n")).toEqual("export const clean = true;\n");
  });

  it("counts a multiset, not a total", () => {
    expect([...multiset([offscale("a"), offscale("a"), spacing("b")])]).toEqual([
      ["offscale-rem-font a", 2],
      ["arbitrary-px-spacing b", 1],
    ]);
  });
});

/**
 * The exit status is the thing a resolver's shell reads, and the pure tests above cannot see it:
 * `reconcile()` returns counts, `main()` turns them into a code. These cases spawn the CLI against
 * `--file` (a copy, never the tree) so the number that decides "paste this" or "you are wrong yet"
 * is asserted rather than transcribed from a manual run.
 */
const APP_ROOT = process.cwd();
const CLI = join(APP_ROOT, "scripts", "units-parks-reconcile.ts");
const GATE = join(APP_ROOT, "scripts", "units-gate.ts");
const REPO_ROOT = resolve(APP_ROOT, "..", "..");

const runCli = (args: string[], cwd: string = APP_ROOT) => {
  const done = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 120_000 });
  return { status: done.status, stdout: done.stdout ?? "", stderr: done.stderr ?? "" };
};

const withCopy = (source: string, body: (file: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "x958-cli-"));
  try {
    const file = join(dir, "units-gate.ts");
    writeFileSync(file, source, "utf8");
    body(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("the reconciler's exit status, as a resolver reads it", () => {
  const gateSource = readFileSync(GATE, "utf8");
  const staleAnchor = `  [join("src", "issues", "meta.tsx")]: { owner: "XTRM-943", offences: [{ rule: "arbitrary-px-spacing", match: "gap-[2px]" }] },
};`;
  // A park for a file that measures nothing: `src/ui/toolbar.tsx` holds no offence. This is the
  // stale entry the tool exists to remove, and it lands in `dropped` — never in `drift`.
  const withStalePark = `${gateSource.replace(staleAnchor, `  [join("src", "issues", "meta.tsx")]: { owner: "XTRM-943", offences: [{ rule: "arbitrary-px-spacing", match: "gap-[2px]" }] },
  [join("src", "ui", "toolbar.tsx")]: { owner: "XTRM-000", offences: [{ rule: "offscale-rem-font", match: "text-[0.62rem]" }] },
};`)}`;

  it("exits 1 on an unconflicted copy holding a park its file does not measure", () => {
    // The regression this pins: composing the status from `drift` alone reports "unchanged" here,
    // because a dropped entry is not drift. `dropped` has to count or a stale park exits 0.
    expect(withStalePark).not.toEqual(gateSource);
    withCopy(withStalePark, (file) => {
      const done = runCli(["--file", file]);
      expect(done.stdout).toContain("measures zero");
      expect(done.status, done.stdout + done.stderr).toBe(1);
    });
  });

  it("exits 0 on an unconflicted copy that measures what it names", () => {
    withCopy(gateSource, (file) => {
      const done = runCli(["--file", file]);
      expect(done.stdout).toContain("the park map is unchanged and measures what it names");
      expect(done.status, done.stdout + done.stderr).toBe(0);
    });
  });

  it("unions a conflict by the greater multiplicity, not the sum", () => {
    // Both sides carry the same map. A sum would claim x2 of every offence, cap them at the
    // measurement, and exit 1 with `lowered` lines for a conflict that agrees with itself.
    const twice = `<<<<<<< HEAD\n${gateSource}=======\n${gateSource}>>>>>>> stale/base\n`;
    withCopy(twice, (file) => {
      const done = runCli(["--file", file]);
      expect(done.stdout).not.toContain("lowered");
      expect(done.stdout).toContain("offscale-rem-font text-[0.68rem] x2 (measured 2)");
      expect(done.status, done.stdout + done.stderr).toBe(0);
    });
  });

  it("runs in the state it exists for: the project's own gate holds the markers", () => {
    // F1. A mid-conflict tree, no flags, the tool's default invocation. Before the one-side reader this
    // died `SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Merge conflict marker encountered` with zero
    // lines of output, because the module holding the markers was the module being imported.
    const dir = mkdtempSync(join(tmpdir(), "x958-conflict-"));
    try {
      mkdirSync(join(dir, "scripts"), { recursive: true });
      mkdirSync(join(dir, "src", "issues"), { recursive: true });
      mkdirSync(join(dir, "src", "shell"), { recursive: true });
      writeFileSync(join(dir, "src", "issues", "meta.tsx"), 'export const A = () => <div className="gap-[2px]" />;\n', "utf8");
      // The other two parked files must exist for the measurement to read them; empty, they measure
      // zero, which is the ordinary "this tree paid them down" answer.
      writeFileSync(join(dir, "src", "issues", "PullRequestsBlock.tsx"), "export const Empty = 1;\n", "utf8");
      writeFileSync(join(dir, "src", "shell", "ContextSidebar.tsx"), "export const Empty = 1;\n", "utf8");
      const ours = `  [join("src", "issues", "meta.tsx")]: { owner: "XTRM-943", offences: [{ rule: "arbitrary-px-spacing", match: "gap-[2px]" }] },`;
      const theirs = ours.replace("gap-[2px]", "gap-[3px]");
      const conflictedGate = gateSource.replace(ours, `<<<<<<< HEAD\n${ours}\n=======\n${theirs}\n>>>>>>> stale/base`);
      expect(conflictedGate).not.toEqual(gateSource);
      writeFileSync(join(dir, "scripts", "units-gate.ts"), conflictedGate, "utf8");
      const done = runCli(["--project-root", dir]);
      // Both sides stay in the parse, so the map still carries ours; theirs is dropped because the
      // tree measures `gap-[2px]` and nothing measures `gap-[3px]`.
      expect(done.stdout).toContain("src/issues/meta.tsx -> XTRM-943 (1 parked)");
      expect(done.stdout).toContain("gap-[2px] (measured 1)");
      expect(done.stdout).toContain("gap-[3px] is no longer found");
      expect(done.stdout).toContain("measures zero, so its");
      expect(done.stderr).not.toContain("Merge conflict marker");
      expect(done.status, done.stdout + done.stderr).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers the same from the repository root with --project-root", () => {
    // Measured before this fix: `ENOENT scandir 'src'`, and with only the walk rooted, 8 bogus
    // `not parked at all` lines for `src/agent/*.tsx` and exit 1. The flag has to move the reader
    // and the measurement together.
    const done = runCli(["--project-root", join("packages", "xtrm-app")], REPO_ROOT);
    expect(done.stdout).toContain("the park map is unchanged and measures what it names");
    expect(done.stdout).not.toContain("not parked at all");
    expect(done.status, done.stdout + done.stderr).toBe(0);
  });
});
