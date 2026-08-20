import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLI = new URL("../src/cli.mjs", import.meta.url).pathname;

function run(args) {
  return execFileAsync(process.execPath, [CLI, ...args]);
}

test("--help exits 0 and prints usage", async () => {
  const { stdout } = await run(["--help"]);
  assert.match(stdout, /Usage:/);
  assert.match(stdout, /xts run "command"/);
  assert.match(stdout, /xts model/);
});

test("--version exits 0 and prints the version", async () => {
  const { stdout } = await run(["--version"]);
  assert.equal(stdout.trim(), "0.1.0");
});

test("unknown option exits 2", async () => {
  await assert.rejects(run(["--bogus"]), (error) => {
    assert.equal(error.code, 2);
    assert.match(error.stderr, /invalid arguments/);
    return true;
  });
});

test("bare unknown positional is a one-shot question and exits 1", async () => {
  await assert.rejects(run(["frobnicate"]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /not implemented yet/);
    return true;
  });
});

test("not-yet-implemented commands exit 1 with stderr message", async () => {
  for (const args of [["interactive"], ["run", "ls"], ["model"], ["shellhook"], ["a question"]]) {
    await assert.rejects(run(args), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /not implemented yet/);
      return true;
    });
  }
});
