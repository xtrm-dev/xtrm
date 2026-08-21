import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  formatShellContext,
  getStatePath,
  loadShellContext,
  redactCommand,
  redactCommands,
  readShellState,
} from "../src/history/shell.mjs";

let tmpDir;
test.before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "xts-shell-test-"));
  process.env.XTS_STATE_DIR = path.join(tmpDir, "state");
  await mkdir(path.join(process.env.XTS_STATE_DIR, "xts"), { recursive: true });
});
test.after(async () => {
  delete process.env.XTS_STATE_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

test("redactCommand: secret forms are redacted", () => {
  const secrets = [
    "curl -H 'Authorization: token=ghp_longsecrettoken123' https://api.github.com",
    "git push https://user:password=super-secret-value@github.com/repo.git",
    "export OPENAI_API_KEY=sk-proj-abcdefghijklmnop",
    "aws configure set aws_secret_access_key=mysecretaccesskey123",
  ];
  for (const cmd of secrets) assert.equal(redactCommand(cmd), "[redacted]", cmd);
});

test("redactCommand: normal commands pass through unchanged", () => {
  const intact = [
    "ls -la",
    "git pull",
    "npm test",
    "cd foo",
    "ssh -i private_key.pem host  # file name, not a secret",
    "echo key=abc",
    "ls disk-usage",
    "task list --status=open",
  ];
  for (const cmd of intact) assert.equal(redactCommand(cmd), cmd, cmd);
});

test("redactCommands maps every command", () => {
  const cmds = ["git pull", "export TOKEN=hunter2-secret", "npm test"];
  assert.deepEqual(redactCommands(cmds), ["git pull", "[redacted]", "npm test"]);
});

test("readShellState: missing file -> null", async () => {
  assert.equal(await readShellState(), null);
});

test("readShellState: corrupt file -> null", async () => {
  await writeFile(getStatePath(), "{ not json", "utf8");
  assert.equal(await readShellState(), null);
});

test("readShellState: wrong-typed fields -> null", async () => {
  await writeFile(getStatePath(), JSON.stringify({ cwd: 42, shell: "bash" }), "utf8");
  assert.equal(await readShellState(), null);
  await rm(getStatePath(), { force: true });
});

test("readShellState: valid file -> parsed object", async () => {
  const state = {
    cwd: "/tmp",
    shell: "bash",
    lastExitCode: 1,
    recentCommands: ["git status", "git pull"],
  };
  await writeFile(getStatePath(), JSON.stringify(state), "utf8");
  assert.deepEqual(await readShellState(), state);
  await rm(getStatePath(), { force: true });
});

test("loadShellContext: no state -> cwd present, everything else empty", async () => {
  const ctx = await loadShellContext();
  assert.equal(typeof ctx.cwd, "string");
  assert.equal(ctx.shell, null);
  assert.equal(ctx.lastExitCode, null);
  assert.deepEqual(ctx.recentCommands, []);
  assert.equal(ctx.source, null);
});

test("loadShellContext: state file -> fields present, secrets redacted", async () => {
  await writeFile(
    getStatePath(),
    JSON.stringify({
      cwd: "/tmp",
      shell: "zsh",
      lastExitCode: 3,
      recentCommands: ["git pull", "export OPENAI_API_KEY=sk-proj-abcdefghij"],
    }),
    "utf8",
  );
  const ctx = await loadShellContext();
  assert.equal(ctx.cwd, "/tmp");
  assert.equal(ctx.shell, "zsh");
  assert.equal(ctx.lastExitCode, 3);
  assert.deepEqual(ctx.recentCommands, ["git pull", "[redacted]"]);
  assert.equal(ctx.source, "hook");
  await rm(getStatePath(), { force: true });
});

test("formatShellContext: cwd + exit code + recent commands present", () => {
  const out = formatShellContext({
    cwd: "/home/user/proj",
    shell: "bash",
    lastExitCode: 1,
    recentCommands: ["git status", "git pull", "npm test"],
  });
  assert.match(out, /cwd: \/home\/user\/proj/);
  assert.match(out, /shell: bash/);
  assert.match(out, /last exit code: 1/);
  assert.match(out, /recent commands \(last 3\):/);
  assert.match(out, /  git status/);
  assert.match(out, /  npm test/);
});

test("formatShellContext: absent shell/exit code -> lines omitted", () => {
  const out = formatShellContext({
    cwd: "/tmp",
    shell: null,
    lastExitCode: null,
    recentCommands: [],
  });
  assert.match(out, /cwd: \/tmp/);
  assert.doesNotMatch(out, /shell:/);
  assert.doesNotMatch(out, /last exit code/);
  assert.match(out, /recent commands: none available/);
});

test("shell hooks force private state and do not persist obvious secrets", async () => {
  const hookDir = path.resolve(new URL("../src/history", import.meta.url).pathname);
  const shells = ["bash"];
  if (spawnSync("zsh", ["-f", "-c", "exit 0"], { encoding: "utf8" }).status === 0) shells.push("zsh");

  for (const shell of shells) {
    const stateDir = path.join(tmpDir, `hook-${shell}`);
    const hook = path.join(hookDir, `hook.${shell}`);
    const script = `umask 000; export XTS_STATE_DIR=${JSON.stringify(stateDir)}; mkdir -p ${JSON.stringify(path.join(stateDir, "xts"))}; printf '%s\\n' 'export OPENAI_API_KEY=sk-proj-secret-value' > ${JSON.stringify(path.join(stateDir, "xts", "cmds.txt"))}; source ${JSON.stringify(hook)}; xts_hook`;
    const result = execFileSync(shell, shell === "bash" ? ["--noprofile", "--norc", "-c", script] : ["-f", "-c", script], {
      encoding: "utf8",
      env: { ...process.env, XTS_STATE_DIR: stateDir },
    });
    assert.equal(result, "", `${shell} hook must stay silent`);

    const dirMode = (await stat(path.join(stateDir, "xts"))).mode & 0o777;
    const stateMode = (await stat(path.join(stateDir, "xts", "state.json"))).mode & 0o777;
    const commandsMode = (await stat(path.join(stateDir, "xts", "cmds.txt"))).mode & 0o777;
    assert.equal(dirMode, 0o700, `${shell} state directory mode`);
    assert.equal(stateMode, 0o600, `${shell} state file mode`);
    assert.equal(commandsMode, 0o600, `${shell} command file mode`);
    const raw = await readFile(path.join(stateDir, "xts", "state.json"), "utf8");
    assert.doesNotMatch(raw, /sk-proj-secret-value/);
    assert.match(raw, /\[redacted\]/);
  }
});
