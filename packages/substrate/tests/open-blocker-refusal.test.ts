// XTRM-980: one refusal vocabulary for an open blocker.
//
// Two paths reach the same rule and each used to compose its own sentence:
// XTRM-959's close guard (`ClosureService.settleOpenBlockers`, plus the legacy
// bare close) and XTRM-967's terminal-state guard in
// `IssueService.setLifecycleState`. The second was written before the first
// merged, so the two drifted. `openBlockerRefusal` now owns the rule's words and
// the callers pass only what genuinely differs: the operation that was refused
// and the remedy (a close can record why the blocker stopped binding and carries
// the override flag on its own command; a state transition has nowhere to record
// a reason, so it points at a close instead of offering the flag itself).
//
// Store discipline matches the rest of `tests/`: an explicit temporary
// SUBSTRATE_DB, every mutation passing --project, never ~/.xtrm/state.db.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract, tempDir } from "./helpers.ts";
import { openBlockerRefusal } from "../src/service/open-blocker-refusal.ts";

function setupDb(): string {
  const dir = tempDir("sb-x980-");
  return join(dir, "state.db");
}

function cli(dbPath: string, argv: string[]): unknown {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
  const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; data: unknown };
  assert.equal(env.schema, SCHEMA_VERSION);
  assert.equal(env.ok, true);
  return env.data;
}

function cliFail(dbPath: string, argv: string[]): string {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  assert.equal(res.code, 1, `sb ${argv.join(" ")} should fail`);
  const env = JSON.parse(res.stdout) as { ok: boolean; error: string };
  assert.equal(env.ok, false);
  return env.error;
}

const PROJECT_ARGS = ["--project", "prj_x9"];
function mut(dbPath: string, argv: string[]): unknown {
  return cli(dbPath, [...argv, ...PROJECT_ARGS]);
}
function mutFail(dbPath: string, argv: string[]): string {
  return cliFail(dbPath, [...argv, ...PROJECT_ARGS]);
}

function seed(dbPath: string): { a: string; b: string } {
  const dir = tempDir("sb-x980c-");
  const c = join(dir, "c.json");
  writeFileSync(c, JSON.stringify(contract({ nonGoals: ["n"], constraints: ["c"] })));
  cli(dbPath, ["project", "create", "--prefix", "X9", "--name", "refusal vocabulary"]);
  const a = cli(dbPath, [
    "issue", "create", "--project", "prj_x9", "--title", "A", "--kind", "task", "--contract", c, "--scrutiny", "LOW",
  ]) as { humanRef: string };
  const b = cli(dbPath, [
    "issue", "create", "--project", "prj_x9", "--title", "B", "--kind", "task", "--contract", c, "--scrutiny", "LOW",
  ]) as { humanRef: string };
  return { a: a.humanRef, b: b.humanRef };
}

/** A blocked pair, seeded through the CLI the way a user would. */
function blockedPair(dbPath: string): { a: string; b: string } {
  const { a, b } = seed(dbPath);
  mut(dbPath, ["issue", "relate", "--from", a, "--to", b, "--kind", "blocks"]);
  return { a, b };
}

/**
 * Splits a refusal into the three parts it is built from, so a test can say
 * "these two agree on the middle and differ on the end" instead of comparing
 * whole strings and calling a coincidence parity.
 *
 * The boundary is the remedy's own opening (" Close <first blocker> first"), not
 * the first " Close " in the text: a drift that adds a sentence to the rule
 * would otherwise be swallowed into the remedy and the parity claim would hold
 * over two different sentences.
 */
function parts(message: string, firstBlocker: string): { operation: string; rule: string; remedy: string } {
  const colon = message.indexOf(": ");
  const remedyAt = message.indexOf(` Close ${firstBlocker} first`);
  assert.ok(colon > 0, `the refusal starts with the refused operation: ${message}`);
  assert.ok(remedyAt > colon, `the refusal carries a remedy clause: ${message}`);
  return {
    operation: message.slice(0, colon),
    rule: message.slice(colon + 2, remedyAt),
    remedy: message.slice(remedyAt + 1),
  };
}

describe("XTRM-980 one refusal vocabulary", () => {
  it("the close path and the state path state the rule in the same words, and differ only in the remedy", () => {
    const db = setupDb();
    const { a, b } = blockedPair(db);

    // The delivery close (XTRM-959): it can record an override, and says so.
    const closeRefusal = mutFail(db, ["issue", "close", b, "--outcome", "completed", "--reason", "shipped"]);
    // The terminal state (XTRM-967): it cannot record a reason, so it must not
    // advertise a flag this command does not honour.
    const stateRefusal = mutFail(db, ["issue", "state", b, "done"]);

    const close = parts(closeRefusal, a);
    const state = parts(stateRefusal, a);

    assert.equal(close.operation, `refusing to close ${b}`, "the close names the close command");
    assert.equal(state.operation, `refusing to mark ${b} done`, "the state transition names what it refused");

    // The vocabulary under test: identical rule, character for character.
    assert.equal(state.rule, close.rule, "both paths must say the same thing about blockers");
    assert.match(close.rule, new RegExp(`blocker ${a} is still open`), "names the open blocker by human ref");
    assert.match(
      close.rule,
      /satisfied only when it is itself terminal \(done or archived\): an open PR is not evidence/,
      "states the rule the predicate actually implements",
    );

    // The asymmetry the contract asks for: the close path offers the override on
    // its own command; the state path points at a close and does not pretend to
    // accept the flag itself.
    assert.match(close.remedy, /--outcome completed/, "the close remedy repeats the outcome the caller chose");
    assert.match(close.remedy, /--force-close-with-open-blocker/, "a close can record why the blocker stopped binding");
    assert.match(state.remedy, /or record the decision where it can be read/, "it says where the decision belongs");
    assert.match(state.remedy, new RegExp(`sb issue close ${b}`), "it points at the command that can record one");
    assert.match(state.remedy, /--outcome <completed\|wont_fix\|invalid\|abandoned>/, "it names the outcomes that qualify");
    assert.doesNotMatch(
      state.remedy,
      /--outcome completed /,
      "a transition does not claim the caller chose an outcome on this path",
    );
    // Both remedies quote the flag, but only as part of a well-formed close
    // command: the state verb itself rejects the flag (a1-lifecycle, "the state
    // verb refuses the close verb's override flag"), so quoting it is a pointer,
    // not an offer. Pinned by shape and by count, not by position: a remedy that
    // mentions the flag once, in the wrong place, or claims another verb accepts
    // it, fails here even though "the flag appears after 'sb issue close'" holds.
    const CLOSE_COMMAND = new RegExp(
      `sb issue close ${b} --outcome (?:completed|wont_fix|<completed\\|wont_fix\\|invalid\\|abandoned>)` +
        ` --reason "<[^"]*>" --force-close-with-open-blocker "<[^"]*>"`,
    );
    for (const [label, remedy] of [["close", close.remedy], ["transition", state.remedy]] as const) {
      assert.match(remedy, CLOSE_COMMAND, `${label}: the remedy quotes one well-formed close command`);
      assert.equal(
        remedy.split("--force-close-with-open-blocker").length - 1,
        1,
        `${label}: the flag is quoted once, inside that command, and no later sentence claims another verb accepts it`,
      );
    }

    // "Differ only in the remedy": the rule is shared and the remedy is not.
    assert.notEqual(close.remedy, state.remedy);

    // And both refusals are total: nothing was written by either.
    const shown = (ref: string) =>
      cli(db, ["issue", "show", ref]) as { lifecycleState: string; closure: { closed: boolean; reason: string | null } };
    const after = shown(b);
    assert.equal(after.lifecycleState, "open");
    assert.equal(after.closure.closed, false, "a refusal writes no Closure row");
  });

  it("the legacy bare close shares the sentence and names the outcome close that can override", () => {
    const db = setupDb();
    const { a, b } = blockedPair(db);
    const bare = parts(mutFail(db, ["issue", "close", b]), a);
    const delivery = parts(mutFail(db, ["issue", "close", b, "--outcome", "completed", "--reason", "shipped"]), a);

    assert.equal(bare.operation, delivery.operation, "both are closes and both say so");
    assert.equal(bare.rule, delivery.rule, "a caller meets one sentence on both close paths");
    assert.match(bare.remedy, new RegExp(`--outcome completed`), "the legacy verb's only way past a blocker is an outcome close");
    assert.match(bare.rule, new RegExp(`blocker ${a} is still open`));
  });

  it("the builder is parameterised over the mode, and the remedy follows from it", () => {
    const shared = { action: "close X9-2", blockers: ["X9-1"], locator: "X9-2" } as const;
    const closing = openBlockerRefusal({ ...shared, mode: "close", outcome: "wont_fix" });
    const transition = openBlockerRefusal({ ...shared, mode: "transition" });

    // Mode is the only knob: the rule cannot be reached by any argument, which
    // is what makes "one vocabulary" a property rather than a convention.
    assert.equal(transition.shared, closing.shared, "same action and refs, same rule");
    assert.notEqual(transition.remedy, closing.remedy);
    assert.equal(closing.message, `${closing.shared} ${closing.remedy}`);
    assert.equal(transition.message, `${transition.shared} ${transition.remedy}`);
    assert.equal(parts(closing.message, "X9-1").rule, parts(transition.message, "X9-1").rule);
    // The outcome slot is the close's, and it is the caller's own outcome.
    assert.match(closing.remedy, /--outcome wont_fix/);
    assert.match(transition.remedy, /--outcome <completed\|wont_fix\|invalid\|abandoned>/);
  });

  it("pluralises a blocker list and refuses to build a remedy for no blockers", () => {
    const two = openBlockerRefusal({
      mode: "close",
      action: "close X9-9",
      blockers: ["X9-1", "X9-2"],
      locator: "X9-9",
      outcome: "completed",
    });
    assert.match(two.shared, /blockers X9-1, X9-2 are still open/);
    assert.match(two.remedy, /Close X9-1, X9-2 first/);
    // A refusal that names no blocker would tell the caller to close nothing.
    assert.throws(
      () =>
        openBlockerRefusal({
          mode: "close",
          action: "close X9-9",
          blockers: [],
          locator: "X9-9",
          outcome: "completed",
        }),
      /at least one blocker/,
    );
  });
});
