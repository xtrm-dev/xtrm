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
    "KEY = generic-long-secret-value",
    "curl --password=long-password-value",
    "Authorization: Bearer bearer-secret-value",
    "-----BEGIN RSA PRIVATE KEY-----",
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

test("zsh precmd captures the prior command without hook internals", async () => {
  if (spawnSync("zsh", ["-f", "-c", "exit 0"], { encoding: "utf8" }).status !== 0) return;
  const stateDir = path.join(tmpDir, "zsh-live");
  const hook = path.resolve(new URL("../src/history/hook.zsh", import.meta.url).pathname);
  const script = [
    'PS1=""',
    `export XTS_STATE_DIR=${JSON.stringify(stateDir)}`,
    "export XTS_SESSION_ID=live-zsh",
    `source ${JSON.stringify(hook)}`,
    "true",
    "printf '%s\\n' 'KEY = live-generic-secret-value' >/dev/null",
    "printf '%s\\n' 'Authorization: Bearer live-bearer-secret' >/dev/null",
    "exit",
    "",
  ].join("\n");
  const output = execFileSync("zsh", ["-f", "-i"], {
    input: script,
    encoding: "utf8",
    env: { ...process.env, XTS_STATE_DIR: stateDir },
  });
  assert.equal(output, "", "zsh hook must not write to stdout");
  const state = await readFile(path.join(stateDir, "xts", "state.live-zsh.json"), "utf8");
  const commands = await readFile(path.join(stateDir, "xts", "cmds.live-zsh.txt"), "utf8");
  assert.match(`${state}\\n${commands}`, /true/);
  assert.doesNotMatch(`${state}\\n${commands}`, /live-generic-secret-value|live-bearer-secret/);
  assert.doesNotMatch(`${state}\\n${commands}`, /xts_history_redact|fc -ln|xts_hook/);
});

test("shell hooks force private state and do not persist obvious secrets", async () => {
  const hookDir = path.resolve(new URL("../src/history", import.meta.url).pathname);
  const shells = ["bash"];
  if (spawnSync("zsh", ["-f", "-c", "exit 0"], { encoding: "utf8" }).status === 0) shells.push("zsh");

  for (const shell of shells) {
    const stateDir = path.join(tmpDir, `hook-${shell}`);
    const hook = path.join(hookDir, `hook.${shell}`);
    const script = `umask 000; export XTS_STATE_DIR=${JSON.stringify(stateDir)}; export XTS_SESSION_ID=priv-test; mkdir -p ${JSON.stringify(path.join(stateDir, "xts"))}; printf '%s\\n' 'KEY = generic-long-secret-value' 'Authorization: Bearer bearer-secret-value' 'curl --password=long-password-value' '-----BEGIN RSA PRIVATE KEY-----' > ${JSON.stringify(path.join(stateDir, "xts", "cmds.priv-test.txt"))}; source ${JSON.stringify(hook)}; xts_hook`;
    const result = execFileSync(shell, shell === "bash" ? ["--noprofile", "--norc", "-c", script] : ["-f", "-c", script], {
      encoding: "utf8",
      env: { ...process.env, XTS_STATE_DIR: stateDir },
    });
    assert.equal(result, "", `${shell} hook must stay silent`);

    const dirMode = (await stat(path.join(stateDir, "xts"))).mode & 0o777;
    const stateMode = (await stat(path.join(stateDir, "xts", "state.priv-test.json"))).mode & 0o777;
    const commandsMode = (await stat(path.join(stateDir, "xts", "cmds.priv-test.txt"))).mode & 0o777;
    assert.equal(dirMode, 0o700, `${shell} state directory mode`);
    assert.equal(stateMode, 0o600, `${shell} state file mode`);
    assert.equal(commandsMode, 0o600, `${shell} command file mode`);
    const statePath = path.join(stateDir, "xts", "state.priv-test.json");
    const commandsPath = path.join(stateDir, "xts", "cmds.priv-test.txt");
    const raw = await readFile(statePath, "utf8");
    const rawCommands = await readFile(commandsPath, "utf8");
    assert.doesNotMatch(`${raw}\n${rawCommands}`, /generic-long-secret-value|bearer-secret-value|long-password-value|BEGIN RSA PRIVATE KEY/);
    assert.match(raw, /\[redacted\]/);
  }
});

test("session id isolates state paths and falls back without one", async () => {
  const { getStatePath, getCommandsPath } = await import("../src/history/shell.mjs");
  delete process.env.XTS_SESSION_ID;
  assert.match(getStatePath(), /state\.json$/);
  assert.match(getCommandsPath(), /cmds\.txt$/);

  process.env.XTS_SESSION_ID = "1234-pts0";
  try {
    assert.match(getStatePath(), /state\.1234-pts0\.json$/);
    assert.match(getCommandsPath(), /cmds\.1234-pts0\.txt$/);
    // Traversal attempts are neutralized ("/" is stripped), keeping files
    // inside the state dir.
    process.env.XTS_SESSION_ID = "../../evil";
    const evil = getStatePath();
    assert.ok(!evil.split(path.sep).some((part) => part === ".."), "no parent traversal");
    assert.match(evil, /xts\/state\.+evil\.json$/);
  } finally {
    delete process.env.XTS_SESSION_ID;
  }
});

test("hooks write per-session files when XTS_SESSION_ID is preset", async () => {
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const hookDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "src", "history");
  for (const shell of ["bash", "zsh"]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `xts-sid-${shell}-`));
    try {
      execFileSync(shell,
        shell === "bash"
          ? ["--noprofile", "--norc", "-c", `export XTS_SESSION_ID=777-tty9; source ${hookDir}/hook.bash; xts_hook`]
          : ["-f", "-c", `export XTS_SESSION_ID=777-tty9; source ${hookDir}/hook.zsh; true; xts_hook`],
        { env: { ...process.env, XTS_STATE_DIR: dir } });
      assert.ok(fs.existsSync(path.join(dir, "xts", "state.777-tty9.json")), `${shell} state.<id>.json`);
      // cmds ring only appears once a real command has run; non-interactive
      // xts_hook has no history, so only the absence of a global file matters.
      if (fs.existsSync(path.join(dir, "xts", "cmds.777-tty9.txt"))) {
        assert.ok(!fs.existsSync(path.join(dir, "xts", "cmds.txt")), `${shell} no global cmds`);
      }
      assert.ok(!fs.existsSync(path.join(dir, "xts", "state.json")), `${shell} no global state`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
