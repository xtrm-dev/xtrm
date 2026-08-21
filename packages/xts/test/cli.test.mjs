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
    assert.match(error.stderr, /model call is not wired yet/);
    return true;
  });
});

test("not-yet-implemented commands exit 1 with stderr message", async () => {
  for (const args of [
    ["interactive"],
    ["a question"],
  ]) {
    await assert.rejects(run(args), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /(not implemented yet|model call is not wired yet)/);
      return true;
    });
  }
});

test("shellhook prints the bash hook and install instructions", async () => {
  const { stdout } = await run(["shellhook"]);
  assert.match(stdout, /xts_hook\(\)/);
  assert.match(stdout, /PROMPT_COMMAND/);
  assert.match(stdout, /~\/\.bashrc/);
});

test("shellhook zsh prints the zsh hook and instructions", async () => {
  const { stdout } = await run(["shellhook", "zsh"]);
  assert.match(stdout, /add-zsh-hook precmd xts_hook/);
  assert.match(stdout, /~\/\.zshrc/);
});

test("shellhook with unknown shell defaults to bash", async () => {
  const { stdout } = await run(["shellhook", "fish"]);
  assert.match(stdout, /xts_hook\(\)/);
  assert.doesNotMatch(stdout, /fish/);
});

test("run executes a safe command and prints its output", async () => {
  const { stdout } = await run(["run", "echo", "hi"]);
  assert.equal(stdout.trim(), "hi");
});

test("run denies a dangerous command without executing it", async () => {
  // stdin is not a TTY under execFile, so the gate defaults to deny.
  await assert.rejects(run(["run", "rm -rf /tmp/xts-cli-test"]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /command denied/);
    return true;
  });
});

test("model --json prints the inventory as JSON and exits 0", async () => {
  const { stdout } = await run(["model", "--json"]);
  const parsed = JSON.parse(stdout);
  assert.ok(Array.isArray(parsed.providers));
  for (const p of parsed.providers) {
    assert.equal(typeof p.provider, "string");
    assert.ok(Array.isArray(p.models));
    for (const m of p.models) {
      assert.equal(typeof m.id, "string");
      assert.equal(typeof m.name, "string");
    }
  }
});

test("model without TTY exits 1 with interactive-terminal guidance", async () => {
  // execFile has no TTY on stdin.
  await assert.rejects(run(["model"]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /interactive terminal/);
    return true;
  });
});
