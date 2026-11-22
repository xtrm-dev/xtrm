// Reconcile the parked-offence map in `scripts/units-gate.ts` after a conflict, mechanically.
//
// XTRM-958. A conflict in the park map was resolved by hand twice, and each resolution had the same
// two failure modes:
//
//   1. A plain union of both sides **resurrects** an entry a merged slice deleted. The slice paid the
//      offence down, deleted the entry, merged; a stale branch still carries the entry, and `union`
//      puts it back. The gate then fails with "parked offence is gone", which reads like the stale
//      branch is right and the merged tree is wrong.
//   2. An instruction to "keep the bigger count" lets a resolver hit the number while re-adding the
//      entry: `{ allowed: 2 }` can be satisfied by two entries, or by one entry the file no longer
//      has plus one it does.
//
// So the reconciler does not count. It reads both sides of the conflict, unions them **as the
// `(rule, match)` multiset per file**, then measures every parked file with the gate's own
// `offenders()` and drops what the file no longer holds. A park is a receipt for a measured offence,
// and the measurement — not the conflict, not the count — decides what survives.
//
// It never writes and never commits: it prints the reconciled map, so a resolver pastes it and can
// read the number beside each offence before doing so.
//
// Usage: node scripts/units-parks-reconcile.ts [--file scripts/units-gate.ts] [--project-root .]
//
// `--project-root` sets the directory both the walk and the scope filter read from (the tool chdirs
// into it once), so the same answer comes out whether it runs from the package directory or from the
// repository root with `--project-root packages/xtrm-app`. `--file` is resolved from the same
// directory, and only decides which source is *read* — the measurement always uses the gate module.
//
// What this tool cannot see, stated here rather than found later: it reads the gate's `PARKS` block
// from a source file, so it reconciles a map, not a rule set. The gate's class rule has its own blind
// spots (a template in the second argument of `cx`/`cn`, a `"…" + …` concatenation, `clsx`/`classNames`,
// a template inside a wider expression), and they are listed beside `CLASS_TEMPLATE` in
// `scripts/units-gate.ts` — a park for a glued class that the rule cannot see is not a shape this
// reconciler can invent either.
//
// The map lives in `scripts/units-gate.ts`: XTRM-949 extracted the gate out of `src/ui/units.test.ts`
// so this reconciler could measure with the gate's own reader. `units.test.ts` is now the assertion
// set and imports the map from there, so the file named in the XTRM-958 contract is the importer, not
// the definition.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Offence } from "./units-gate.ts";

export type ParkedOffence = { rule: string; match: string };
export type ReconciledPark = { file: string; owner: string; offences: ParkedOffence[]; found: Map<string, number> };

const key = (offence: { rule: string; match: string }) => `${offence.rule} ${offence.match}`;

/** The multiset of a list of offences, which is what a park has to equal — not a total. */
export const multiset = (offences: Array<{ rule: string; match: string }>): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const offence of offences) counts.set(key(offence), (counts.get(key(offence)) ?? 0) + 1);
  return counts;
};

/** Both sides of every conflict in `source`, unioned. Nothing outside a conflict is changed. */
export const unionConflict = (source: string): string => {
  const lines = source.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    // `<<<<<<<`, `|||||||` (diff3 base) and `>>>>>>>` are separators; `=======` alone would also match
    // a banner comment, so the marker test requires the marker to be the whole token run.
    //
    // The diff3 base section's *content* stays: only markers are removed. Dropping the base would be a
    // judgement this tool is not entitled to make — it has no way to know which of three sides is the
    // merged truth — and keeping it costs nothing, because the union below is a multiset and a
    // duplicated park collapses into itself rather than doubling a count.
    if (/^<{7}(\s|$)/.test(line) || /^\|{7}(\s|$)/.test(line) || /^>{7}(\s|$)/.test(line) || /^={7}$/.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n");
};

/**
 * The park map literal from `source`, or `undefined` when the file does not carry one. Brace matching
 * rather than a regex: an offence list is nested two levels deep and a file path may hold a brace in
 * a character class.
 */
export const parkLiteral = (source: string): string | undefined => {
  // Every `PARKS` block in the source, not only the first: a union of two whole maps carries the
  // declaration twice, and reading one side only would silently reconcile against half the conflict.
  const marker = "export const PARKS";
  const bodies: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = source.indexOf(marker, cursor);
    if (start < 0) break;
    const open = source.indexOf("{", start);
    if (open < 0) break;
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    bodies.push(source.slice(open + 1, end));
    cursor = end + 1;
  }
  if (bodies.length === 0) return undefined;
  return `{${bodies.join("\n")}}`;
};

export type ParkEntry = { file: string; owner: string; offences: ParkedOffence[] };

/**
 * A double-quoted string literal body, escape-aware.
 *
 * `[^"]*` stops at the first quote, so a `match` that carries a quote of its own — a scroll-container
 * offence's `match` is the trimmed source line, and a class line contains quotes — parsed as an empty
 * match. The park then read as zero offences and the printed map silently dropped a park the file
 * still held, which is the one thing this tool must not do.
 */
const STRING_BODY = String.raw`((?:[^"\\]|\\.)*)`;
const quoted = (flags = "") => new RegExp(String.raw`"${STRING_BODY}"`, flags);

/** `\"` → `"`, `\\` → `\`: the park holds the string's value, not its TypeScript spelling. */
const unquote = (value: string): string => value.replace(/\\(.)/g, "$1");

/**
 * Read the entries out of a park map literal. `file` is recovered from the `join("src", …)` call the
 * map uses for its keys, so a resolver reads the path the walk will read.
 */
export const parseParks = (literal: string): ParkEntry[] => {
  const entries: ParkEntry[] = [];
  const segments = [...literal.matchAll(/\[join\(([^\]]*)\)\]\s*:\s*\{/g)];
  segments.forEach((segment, index) => {
    const parts = [...(segment[1] ?? "").matchAll(quoted("g"))].map((part) => unquote(part[1] ?? ""));
    const file = join(...parts);
    const bodyStart = (segment.index ?? 0) + segment[0].length;
    const bodyEnd = index + 1 < segments.length ? (segments[index + 1]?.index ?? literal.length) : literal.length;
    const body = literal.slice(bodyStart, bodyEnd);
    const owner = unquote(new RegExp(String.raw`owner\s*:\s*"${STRING_BODY}"`).exec(body)?.[1] ?? "");
    const offences = [...body.matchAll(new RegExp(String.raw`\{\s*rule\s*:\s*"${STRING_BODY}"\s*,\s*match\s*:\s*"${STRING_BODY}"\s*\}`, "g"))].map(
      (match) => ({ rule: unquote(match[1] ?? ""), match: unquote(match[2] ?? "") }),
    );
    entries.push({ file, owner, offences });
  });
  return entries;
};

export type ReconcileResult = {
  parks: ReconciledPark[];
  /** Entries dropped because the file measures zero, or because the named offence is gone. */
  dropped: string[];
  /** Entries kept, but at a lower count than the union claimed: the file measures fewer duplicates. */
  pruned: string[];
  /** Files whose measured multiset is not explained by either side of the conflict. */
  drift: string[];
  /**
   * Files that measure an offence while neither side names any park for them at all.
   *
   * This is the direction a park-only view cannot see: deleting a whole entry leaves nothing to
   * iterate, so measuring "every parked file" reports nothing while the offence still stands. A park
   * is the receipt; a missing receipt is the failure, not the absence of one.
   */
  unparked: string[];
};

/**
 * Reconcile both sides of a conflict against what the files actually measure.
 *
 * `measure` is injected rather than imported at the call site so the replay test can supply the four
 * historical shapes without writing files, while the CLI passes the gate's own reader.
 *
 * `survey` is the optional complement to `measure`: `measure` answers "what does this parked file
 * hold?", `survey` answers "which files hold anything at all?". Without it a whole deleted park is
 * invisible, because the reconciler would only ever look where a park already points.
 */
export const reconcile = (
  conflictedSource: string,
  measure: (file: string) => Array<{ rule: string; match: string }>,
  survey: () => Array<{ file: string; offences: Array<{ rule: string; match: string }> }> = () => [],
): ReconcileResult => {
  const literal = parkLiteral(unionConflict(conflictedSource));
  if (literal === undefined) return { parks: [], dropped: [], pruned: [], drift: [], unparked: [] };
  // Union per file as a multiset union — the greater multiplicity on either side, never the sum.
  // Both sides carry the same file in an ordinary conflict, and summing would double every entry a
  // slice did not touch, which is not a union and does not match any tree.
  const byFile = new Map<string, { owner: string; offences: Map<string, number> }>();
  for (const entry of parseParks(literal)) {
    const existing = byFile.get(entry.file);
    const counts = existing?.offences ?? new Map<string, number>();
    for (const [k, count] of multiset(entry.offences)) counts.set(k, Math.max(counts.get(k) ?? 0, count));
    byFile.set(entry.file, { owner: existing?.owner ?? entry.owner, offences: counts });
  }
  const merged = [...byFile].map(([file, park]) => ({
    file,
    owner: park.owner,
    offences: [...park.offences].flatMap(([k, count]) => {
      const [rule = "", ...rest] = k.split(" ");
      return Array.from({ length: count }, () => ({ rule, match: rest.join(" ") }));
    }),
  }));
  const parks: ReconciledPark[] = [];
  const dropped: string[] = [];
  const pruned: string[] = [];
  const drift: string[] = [];

  for (const entry of merged) {
    const found = multiset(measure(entry.file));
    const union = multiset(entry.offences);
    if (found.size === 0 && union.size > 0) {
      // The file holds none of these: a merged slice paid them down and this side is a stale base.
      dropped.push(`${entry.file}: measures zero, so its ${entry.offences.length} parked offence(s) are stale — ${[...union.keys()].join(", ")}`);
      continue;
    }
    const kept = new Map<string, number>();
    for (const [k, parked] of union) {
      const got = found.get(k) ?? 0;
      if (got === 0) {
        dropped.push(`${entry.file}: ${k} is no longer found, so it leaves the park`);
        continue;
      }
      // The measurement caps what may be claimed: a union cannot invent a duplicate the file does not
      // hold. It cannot lower the park either, because an offence the file still has stays named, and
      // a file that measures MORE than either side named is reported rather than quietly raised —
      // raising it would hide a slice that added an offence without parking it.
      kept.set(k, Math.min(parked, got));
      if (got < parked) pruned.push(`${entry.file}: ${k} parked x${parked}, measured x${got} — the park drops to the measurement`);
      if (got > parked) drift.push(`${entry.file}: measured ${got} of ${k}, which neither side parked`);
    }
    const offences = [...kept].flatMap(([k, count]) => {
      const [rule = "", ...rest] = k.split(" ");
      return Array.from({ length: count }, () => ({ rule, match: rest.join(" ") }));
    });
    parks.push({ file: entry.file, owner: entry.owner, offences, found });
    for (const [k, got] of found) {
      if (kept.has(k)) continue;
      drift.push(`${entry.file}: measured ${got} of ${k}, which no park names`);
    }
  }
  return { parks, dropped, pruned, drift, unparked: surveyUnparked(parks, survey) };
};

/**
 * Offences the tree holds that no park names at all, per file.
 *
 * Reported as a difference rather than silently listed: the parked set is the committed claim, and a
 * file that measures an offence while the map is silent about it is the exact state the gate refuses.
 * A file the union did name is skipped here — its shortfall already belongs to `drift` or `dropped`,
 * and naming it twice would make one defect read as two.
 */
const surveyUnparked = (
  parks: ReconciledPark[],
  survey: () => Array<{ file: string; offences: Array<{ rule: string; match: string }> }>,
): string[] => {
  const named = new Set(parks.map((park) => park.file));
  const unparked: string[] = [];
  for (const measured of survey()) {
    if (named.has(measured.file) || measured.offences.length === 0) continue;
    const counts = multiset(measured.offences);
    const listed = [...counts].map(([k, count]) => (count > 1 ? `${k} x${count}` : k)).join(", ");
    unparked.push(`${measured.file}: measures ${listed}, and no park names it`);
  }
  return unparked;
};

/** The map as it should be pasted back into `scripts/units-gate.ts`, each offence annotated with its count. */
export const printParks = (result: ReconcileResult, indent = "  "): string => {
  const lines: string[] = [];
  for (const park of result.parks) {
    const counts = multiset(park.offences);
    lines.push(`${indent}${park.file} -> ${park.owner} (${park.offences.length} parked)`);
    for (const [k, count] of counts) {
      const measured = park.found.get(k) ?? 0;
      lines.push(`${indent}${indent}${k}${count > 1 ? ` x${count}` : ""} (measured ${measured})`);
    }
  }
  return lines.join("\n");
};

/**
 * One side of a conflicted file, line by line: the text before each conflict, then that conflict's
 * first ("ours") side, then the text after it. A side is a complete version of the file by
 * construction, which is the only reason importing it is legitimate.
 */
export const oneSide = (source: string): string => {
  const out: string[] = [];
  let state: "text" | "ours" | "theirs" = "text";
  for (const line of source.split("\n")) {
    if (line.startsWith("<<<<<<<")) {
      state = "ours";
      continue;
    }
    if (line.startsWith("=======") && state === "ours") {
      state = "theirs";
      continue;
    }
    if (line.startsWith(">>>>>>>") && state === "theirs") {
      state = "text";
      continue;
    }
    if (state !== "theirs") out.push(line);
  }
  return out.join("\n");
};

/**
 * A reader that parses while the gate does not.
 *
 * The dynamic import below removes the module-load crash, but it cannot by itself make the tool work
 * in the state the tool exists for: the module holding the markers IS the module being imported, so
 * `await import("./units-gate.ts")` fails for exactly the same reason a static import did. Measured.
 *
 * What does parse is one side of the conflict — each side is a complete version of the file by
 * construction. So the reader is loaded from a copy with the markers and the *other* side removed,
 * and only `offenders`, `walk` and `ROOT` are used from it: the map itself is still parsed out of the
 * conflicted source by `parkLiteral`/`parseParks` above, and both sides stay in that parse. The
 * measurement rules are not what a park conflict is about, so a one-sided rules module cannot change
 * the answer this tool prints; if a conflict ever spans the rules too, the copy still parses and the
 * gate's own test is the thing that decides which rules are right.
 */
const importOneSide = async (source: string) => {
  const dir = mkdtempSync(join(tmpdir(), "units-parks-reader-"));
  const reader = join(dir, "units-gate.ts");
  try {
    writeFileSync(reader, oneSide(source), "utf8");
    return await import(pathToFileURL(reader).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const main = async () => {
  const argv = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
  };
  // `--project-root` is the unit of BOTH the read and the measurement: chdir once, so `walk(ROOT)`,
  // `offenders()` and `--file` all resolve against the same directory. Walking from `base` while
  // leaving `inScope` (which compares unprefixed paths against `OUT_OF_SCOPE`) reading from the
  // process was measured to report 8 clean-tree `src/agent/*.tsx` offences and exit 1 from the repo
  // root — a flag that silently changes the answer is worse than no flag.
  const base = resolve(flag("--project-root", "."));
  const file = flag("--file", join("scripts", "units-gate.ts"));
  process.chdir(base);
  const source = readFileSync(isAbsolute(file) ? file : join(base, file), "utf8");
  const conflicted = /^<{7}(\s|$)/m.test(source);
  // The reader is always the project's gate, never `--file`: `--file` names the source whose map is
  // being reconciled and it may be a conflicted copy, while the measurement needs a module that
  // parses. When the project's own gate holds the markers, one side of it is imported instead — see
  // `importOneSide`.
  const reader = join(base, "scripts", "units-gate.ts");
  const readerSource = reader === (isAbsolute(file) ? file : join(base, file)) ? source : readFileSync(reader, "utf8");
  // The gate is imported HERE, after the source is in memory, and not at module load: this tool exists
  // for the state where `scripts/units-gate.ts` holds conflict markers, and a static import of that
  // file dies `SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Merge conflict marker encountered` before
  // a single park is read. Measured. The refusal below is the last state, not the design: it is what
  // remains if the gate cannot be loaded even when it is not the file under reconciliation.
  let gate: { offenders: (file: string) => Offence[]; walk: (dir: string) => string[]; ROOT: string };
  try {
    gate = /^<{7}(\s|$)/m.test(readerSource) ? await importOneSide(readerSource) : await import(pathToFileURL(reader).href);
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    process.stderr.write(
      `cannot load ${join("scripts", "units-gate.ts")}: ${detail}\n` +
        `the reconciler measures with the gate's own reader, so that file has to parse before it can\n` +
        `measure anything — including when --file names a copy. Two commands get there:\n` +
        `  cp ${join("scripts", "units-gate.ts")} /tmp/gate-conflicted.ts   # keep both sides\n` +
        `  git checkout --ours ${join("scripts", "units-gate.ts")}          # the tree's copy must parse\n` +
        `then: node ${join("scripts", "units-parks-reconcile.ts")} --file /tmp/gate-conflicted.ts\n` +
        `The map that comes out is still the union measured against the files; the tree copy is only\n` +
        `the reader.\n`,
    );
    process.exit(2);
  }
  // `walk(ROOT)` and nothing wider: that is the file set the gate measures, already filtered through
  // `inScope`, so a park-less offence in `src/agent` or `e2e/` is not this tool's business. A wider
  // walk would report files the gate ignores and make a clean tree look unpaid.
  const survey = () =>
    gate
      .walk(gate.ROOT)
      .map((path) => ({ file: path.split("\\").join("/"), offences: gate.offenders(path) }))
      .filter((measured) => measured.offences.length > 0)
      .map((measured) => ({ file: measured.file, offences: measured.offences.map(({ rule, match }) => ({ rule, match })) }));

  const result = reconcile(source, (parked) => gate.offenders(parked), survey);
  // Every difference counts, in either direction, and `dropped` counts most of all: an unconflicted
  // file carrying a park for a file that measures zero is exactly the stale entry this tool exists to
  // remove. Testing only `drift` here would answer "unchanged" while holding a park nothing measures,
  // which is the failure mode the tool was written against.
  const changed = result.dropped.length + result.pruned.length + result.drift.length + result.unparked.length;
  if (!conflicted && changed === 0) {
    process.stdout.write(`no conflict in ${file}: the park map is unchanged and measures what it names\n`);
    process.exit(0);
  }
  if (changed > 0 || conflicted) {
    process.stdout.write(`reconciled ${file} against what the files measure\n\n`);
    process.stdout.write(`${result.parks.length} park(s)\n`);
    process.stdout.write(`${printParks(result)}\n`);
    if (result.dropped.length > 0) process.stdout.write(`\ndropped ${result.dropped.length} entr(y/ies):\n${result.dropped.join("\n")}\n`);
    if (result.pruned.length > 0) process.stdout.write(`\nlowered ${result.pruned.length} count(s):\n${result.pruned.join("\n")}\n`);
    if (result.drift.length > 0) process.stdout.write(`\nnot explained by either side (${result.drift.length}):\n${result.drift.join("\n")}\n`);
    if (result.unparked.length > 0) process.stdout.write(`\nnot parked at all (${result.unparked.length}):\n${result.unparked.join("\n")}\n`);
    if (changed > 0) process.stdout.write(`\nthe map above differs from what is committed; paste it and re-run the gate\n`);
  }
  // The status describes the committed tree, not the printed map: any difference, in either
  // direction, is non-zero — the same assertion the gate's `parkDrift()` makes.
  process.exit(changed > 0 ? 1 : 0);
};

if (process.argv[1]?.endsWith("units-parks-reconcile.ts")) void main();

export type { Offence };
