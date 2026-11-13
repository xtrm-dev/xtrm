#!/usr/bin/env node
// Refresh the [Unreleased] section of CHANGELOG.md from the git log.
//
// Why this exists instead of `git-cliff --prepend`:
//   --prepend blindly inserts at line 1. On this repo that put the generated block
//   ABOVE the "# Changelog" title (stranding it mid-file) and stacked a SECOND
//   [Unreleased] section on top of the existing one. Every run made it worse.
//
// This script is idempotent: it replaces the [Unreleased] section in place, keeping
// the title/preamble at the top and every released section untouched. Run it twice,
// get the same file.
//
// It never uses `git-cliff -o` / plain generate — those rebuild CHANGELOG.md from the
// git log and would drop every hand-written line (measured: 362 lines in this repo).
//
//   node scripts/changelog-update.mjs [--check] [--tag vX.Y.Z]
//     --check       exit 1 if the file would change (CI guard), write nothing
//     --tag vX.Y.Z  cut a versioned section (## [X.Y.Z] - YYYY-MM-DD) from the
//                   current [Unreleased] entries, leaving an empty [Unreleased]
//                   on top. Used by the npm `version` hook to promote entries.
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(REPO_ROOT);
// Overridable so a test can run against a fixture file and a stub binary: the
// real defaults are what `npm version` uses.
const flagValue = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
};
const CHANGELOG = flagValue('--changelog') ?? 'packages/substrate/CHANGELOG.md';
const CONFIG = flagValue('--config') ?? 'packages/substrate/changelog/cliff.toml';
const CLIFF = flagValue('--cliff') ?? process.env.GIT_CLIFF ?? 'git-cliff';
// The floor this script's flags need (`--include-path`, postprocessors).
const MIN_CLIFF = '2.10';
const UNRELEASED = '## [Unreleased]';
const check = process.argv.includes('--check');
const tagIndex = process.argv.indexOf('--tag');
const tag = tagIndex !== -1 ? process.argv[tagIndex + 1] : null;
if (tagIndex !== -1 && (!tag || tag.startsWith('--'))) {
  throw new Error('--tag requires a version argument (e.g. --tag v3.21.5)');
}
if (tag && check) {
  throw new Error('--tag and --check are mutually exclusive');
}

const current = readFileSync(CHANGELOG, 'utf8');

// The header is everything before the first section heading (title + preamble + rule).
const firstSection = current.search(/^## \[/m);
if (firstSection === -1) throw new Error(`${CHANGELOG}: no "## [" section found — refusing to guess its shape.`);
const header = current.slice(0, firstSection).trimEnd();

// A file already corrupted by `git-cliff --prepend` has its "# Changelog" title BELOW the
// injected [Unreleased] block, so "everything above the first section" is empty and the title
// would be dropped along with that block. Refuse rather than silently delete it.
if (!/^# /m.test(header)) {
  throw new Error(
    `${CHANGELOG}: no "# " title above the first section — the file looks --prepend-corrupted.\n` +
    `Restore the title/preamble to the top of the file, then re-run.`,
  );
}

const cliffArgs = ['--config', CONFIG, '--unreleased', '--include-path', 'packages/substrate/**'];
if (tag) cliffArgs.push('--tag', tag);

const generated = (() => {
  try {
    return execFileSync(CLIFF, cliffArgs, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch (error) {
    if (error && (error.code === 'ENOENT' || String(error.message).includes('ENOENT'))) {
      throw new Error(
        `${CHANGELOG}: git-cliff >= ${MIN_CLIFF} is required and was not found on PATH.\n` +
        `Install it (https://git-cliff.org/docs/installation), then re-run: node scripts/changelog-update.mjs\n` +
        `Nothing was written.`,
      );
    }
    throw error;
  }
})();

// Released sections = everything from the first "## [" that is NOT [Unreleased].
// Dropping any existing [Unreleased] block is what makes this idempotent.
const sections = current.slice(firstSection).split(/^(?=## \[)/m);
const released = sections.filter((s) => !s.startsWith(UNRELEASED)).join('').trimEnd();

// This package has no per-release git tag, so `--unreleased` renders the whole
// package history and would re-promote entries that are already released. The
// released sections are the record of what shipped: drop any rendered entry whose
// line already appears there. Deterministic, needs no tag, and a wrongly promoted
// entry is still visible in the released history the operator reads.
const releasedEntryLines = new Set(
  released.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.trim()),
);
const keptLines = generated
  .split('\n')
  .filter((line) => !(line.startsWith('- ') && releasedEntryLines.has(line.trim())));
const unreleased = keptLines.join('\n').trimEnd();

const hasEntries = /^- /m.test(unreleased);

// Assemble the next file body.
//   --tag mode: keep an empty [Unreleased] on top, then the versioned block below,
//               then the existing released history. If there are no unreleased entries,
//               that's a hard error — a version bump with no unreleased content means
//               either the [Unreleased] section was already promoted (double-tag) or
//               the previous release swept everything up (nothing to promote).
//   default:    single [Unreleased] block above released history.
let next;
if (tag) {
  if (!hasEntries) {
    throw new Error(
      `${CHANGELOG}: --tag ${tag} refused — no [Unreleased] entries to promote.\n` +
      `Either commits since the last tag are all skip-classified (checkpoint/merge/release), or\n` +
      `[Unreleased] was already promoted. Inspect the file and re-run without --tag if that's expected.`,
    );
  }
  const versioned = unreleased.startsWith(UNRELEASED)
    ? unreleased.slice(UNRELEASED.length).trimStart()
    : unreleased;
  next = `${header}\n\n${UNRELEASED}\n\n${versioned}\n\n${released}\n`;
} else {
  // git-cliff emits its own "## [Unreleased]" heading; keep exactly one.
  const body = unreleased.startsWith(UNRELEASED) ? unreleased : `${UNRELEASED}\n\n${unreleased}`;
  next = `${header}\n\n${hasEntries ? body : UNRELEASED}\n\n${released}\n`;
}

if (next === current) {
  console.log(`${CHANGELOG}: already up to date`);
  process.exit(0);
}
if (check) {
  console.error(`${CHANGELOG}: out of date — run: node scripts/changelog-update.mjs`);
  process.exit(1);
}

// Safety net: never lose a released section (matches both v-prefixed and bare shapes).
for (const heading of current.match(/^## \[[^\]]+\].*$/gm) ?? []) {
  if (heading === UNRELEASED) continue;
  if (!next.includes(heading)) throw new Error(`refusing to write: would drop released section ${heading}`);
}

const tmp = `${CHANGELOG}.tmp-${process.pid}`;
writeFileSync(tmp, next);
renameSync(tmp, CHANGELOG);
const entries = (unreleased.match(/^- /gm) ?? []).length;
console.log(
  tag
    ? `${CHANGELOG}: cut ${tag} section (${entries} entries)`
    : `${CHANGELOG}: [Unreleased] refreshed (${entries} entries)`,
);
