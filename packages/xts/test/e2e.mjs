#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CLI = path.join(ROOT, "src", "cli.mjs");
const NODE = process.execPath;
const results = [];

function note(name, status, detail = "") {
  results.push({ name, status, detail });
  console.log(`${status.padEnd(5)} ${name}${detail ? ` — ${detail}` : ""}`);
}

function envFor(configDir, stateDir) {
  return { ...process.env, XTS_CONFIG_DIR: configDir, XTS_STATE_DIR: stateDir };
}

function runCli(args, { env, input, delayedInput, timeoutMs = 90_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], {
      cwd: ROOT,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (delayedInput) {
      delayedInput(child.stdin);
    } else if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function runPty(args, { env, action, timeoutMs = 90_000 } = {}) {
  const command = [NODE, CLI, ...args].map(shellQuote).join(" ");
  const child = spawn("script", ["-qefc", command, "/dev/null"], {
    cwd: ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let stderr = "";
  let actionError;
  let actionDone = false;
  const waiters = [];
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);

  const waitFor = (pattern) => new Promise((resolve, reject) => {
    if (pattern.test(output)) {
      resolve(output);
      return;
    }
    waiters.push({ pattern, resolve, reject });
  });
  const write = (text) => child.stdin.write(text);
  const checkWaiters = () => {
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].pattern.test(output)) {
        waiters[i].resolve(output);
        waiters.splice(i, 1);
      }
    }
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; checkWaiters(); });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const actionPromise = Promise.resolve().then(() => action({ write, waitFor, output: () => output }))
    .catch((error) => {
      actionError = error;
      child.kill("SIGKILL");
    })
    .finally(() => { actionDone = true; });
  void actionPromise;
  return new Promise((resolve) => {
    child.on("error", (error) => {
      clearTimeout(timer);
      for (const waiter of waiters) waiter.reject(error);
      resolve({ code: null, output, stderr, error, actionDone, actionError });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      for (const waiter of waiters) waiter.reject(new Error(`pty closed before ${waiter.pattern}`));
      resolve({ code, output, stderr, actionDone, actionError });
    });
  });
}

async function setConfig(configDir, model) {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(configDir, "xts.json"), `${JSON.stringify({ model }, null, 2)}\n`, { mode: 0o600 });
}

async function sessionContains(dir, text) {
  let names = [];
  try {
    names = await readdir(dir, { recursive: true });
  } catch {
    return false;
  }
  for (const name of names) {
    try {
      if ((await readFile(path.join(dir, name), "utf8")).includes(text)) return true;
    } catch {
      // A session may be rotated while the smoke reads it.
    }
  }
  return false;
}

async function main() {
  const base = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "xts-e2e-")));
  const configDir = path.join(base, "config");
  const stateDir = path.join(base, "state");
  const env = envFor(configDir, stateDir);
  const scriptAvailable = await access("/usr/bin/script").then(() => true).catch(() => false);
  assert.ok(scriptAvailable, "e2e requires /usr/bin/script for PTY probes");

  let inventory;
  try {
    const help = await runCli(["--help"], { env });
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /Usage:/);
    assert.match(help.stdout, /xts run/);
    note("xts --help", "PASS");

    const hook = await runCli(["shellhook", "bash"], { env });
    assert.equal(hook.code, 0, hook.stderr);
    assert.match(hook.stdout, /xts_hook\(\)/);
    assert.match(hook.stdout, /PROMPT_COMMAND/);
    const silentHook = await runCli(["shellhook", "bash"], { env });
    assert.equal(silentHook.stderr, "");
    note("shellhook output", "PASS");

    const hookPath = path.join(ROOT, "src", "history", "hook.bash");
    const silent = await new Promise((resolve) => {
      const child = spawn("bash", ["-c", `source ${shellQuote(hookPath)}; xts_hook`], {
        cwd: ROOT,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(silent.code, 0);
    assert.equal(silent.stdout, "");
    assert.equal(silent.stderr, "");
    note("shell integration silence", "PASS");

    const { readConfig, writeConfig } = await import("../src/config.mjs");
    const preference = { provider: "fixture-provider", id: "fixture/model" };
    await writeConfig({ model: preference });
    assert.deepEqual(await readConfig(), { model: preference });
    note("config round trip", "PASS");

    const inventoryRun = await runCli(["model", "--json"], { env });
    assert.equal(inventoryRun.code, 0, inventoryRun.stderr);
    inventory = JSON.parse(inventoryRun.stdout);
    assert.ok(Array.isArray(inventory.providers));
    assert.ok(inventory.providers.every((provider) => Array.isArray(provider.models)));
    note("model --json inventory", "PASS", `${inventory.providers.length} provider(s)`);

    const stateJson = path.join(stateDir, "xts", "state.json");
    await mkdir(path.dirname(stateJson), { recursive: true, mode: 0o700 });
    await writeFile(stateJson, JSON.stringify({
      cwd: ROOT,
      shell: "bash",
      lastExitCode: 1,
      recentCommands: ["echo normal", "TOKEN=E2E_SECRET_SHOULD_NOT_APPEAR"],
    }));
    const redaction = await runCli(["--show-prompt"], { env, input: "" });
    assert.equal(redaction.code, 0, redaction.stderr);
    assert.match(redaction.stdout, /\[redacted\]/);
    assert.doesNotMatch(redaction.stdout, /E2E_SECRET_SHOULD_NOT_APPEAR/);
    note("shell-context redaction", "PASS");

    const barePipe = await runCli(["--show-prompt"], {
      env,
      delayedInput: (stdin) => setTimeout(() => stdin.end("BARE_DELAYED_EVIDENCE\n"), 250),
    });
    assert.equal(barePipe.code, 0, barePipe.stderr);
    assert.match(barePipe.stdout, /BARE_DELAYED_EVIDENCE/);
    const explicitPipe = await runCli(["explain this", "--show-prompt"], {
      env,
      delayedInput: (stdin) => setTimeout(() => stdin.end("EXPLICIT_DELAYED_EVIDENCE\n"), 250),
    });
    assert.equal(explicitPipe.code, 0, explicitPipe.stderr);
    assert.match(explicitPipe.stdout, /EXPLICIT_DELAYED_EVIDENCE/);
    assert.match(explicitPipe.stdout, /explain this/);
    note("bare + explicit delayed pipe", "PASS");

    const largePipe = await runCli(["--show-prompt"], {
      env,
      input: `${"x".repeat(70_000)}\n`,
    });
    assert.equal(largePipe.code, 0, largePipe.stderr);
    assert.match(largePipe.stdout, /stdin truncated:/);
    note("bounded stdin truncation notice", "PASS");

    const safe = await runCli(["run", "printf safe-path"], { env });
    assert.equal(safe.code, 0, safe.stderr);
    assert.match(safe.stdout, /safe-path/);
    note("xts run safe path", "PASS");

    const deniedSentinel = path.join(base, "deny-sentinel");
    await writeFile(deniedSentinel, "must remain");
    const denied = await runCli(["run", `rm -rf ${deniedSentinel}`], { env });
    assert.equal(denied.code, 1);
    assert.match(denied.stderr, /command denied/);
    await access(deniedSentinel);
    note("xts run dangerous deny + no-exec sentinel", "PASS");

    const approvedSentinel = path.join(base, "approved-sentinel");
    await writeFile(approvedSentinel, "may be removed");
    const approved = await runPty(["run", `rm -rf ${approvedSentinel}`], {
      env,
      action: async ({ write, waitFor }) => {
        await waitFor(/Type 'yes' to approve/);
        write("yes\r");
      },
    });
    assert.equal(approved.actionError, undefined, approved.actionError?.message);
    assert.equal(approved.code, 0, approved.stderr || approved.output.slice(-1_000));
    await assert.rejects(access(approvedSentinel));
    note("xts run dangerous approval", "PASS");

    if (inventory.providers.length === 0) {
      note("live one-shot answer", "SKIP", "no available authenticated model");
      note("PTY retained final answer + restore", "SKIP", "no available authenticated model");
      note("persistent conversation recall", "SKIP", "no available authenticated model");
    } else {
      const firstProvider = inventory.providers[0];
      const firstModel = firstProvider.models[0];
      await setConfig(configDir, { provider: firstProvider.provider, id: firstModel.id });
      const answerMarker = `XTS_E2E_ANSWER_${Date.now().toString(36)}`;
      const answer = await runCli([`Reply with exactly ${answerMarker} and nothing else.`], { env });
      assert.equal(answer.code, 0, answer.stderr);
      assert.match(answer.stdout, new RegExp(answerMarker));
      note("live one-shot answer", "PASS", `${firstProvider.provider}/${firstModel.id}`);

      const ptyAnswer = "Canberra";
      const pty = await runPty([], {
        env,
        action: async ({ write, waitFor, output }) => {
          await waitFor(/xts/);
          const beforePrompt = output();
          assert.doesNotMatch(beforePrompt, new RegExp(ptyAnswer));
          write("What is the capital city of Australia? Reply with only its name.\r");
          await waitFor(new RegExp(ptyAnswer));
          write("\x03");
        },
      });
      assert.equal(pty.actionError, undefined, pty.actionError?.message);
      assert.equal(pty.code, 0, pty.stderr || pty.output.slice(-1_000));
      assert.match(pty.output, new RegExp(ptyAnswer));
      assert.match(pty.output, /\u001b\[\?1049l/);
      note("PTY retained final answer + restore", "PASS");

      const codeword = `XTS_PERSIST_${Date.now().toString(36)}`;
      const persistStateDir = path.join(base, "persist-state");
      const persistEnv = envFor(configDir, persistStateDir);
      const first = await runPty([], {
        env: persistEnv,
        action: async ({ write, waitFor }) => {
          await waitFor(/xts/);
          write(`Remember codeword ${codeword}. What is the capital city of Australia?\r`);
          await waitFor(/Canberra/);
          await new Promise((resolve) => setTimeout(resolve, 750));
          write("\x03");
        },
      });
      assert.equal(first.code, 0, first.stderr || first.output.slice(-1_000));
      assert.ok(await sessionContains(path.join(persistStateDir, "xts", "sessions"), codeword), "first persistent session did not save codeword");

      const second = await runPty([], {
        env: persistEnv,
        action: async ({ write }) => {
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          write("\x03");
        },
      });
      assert.equal(second.code, 0, second.stderr || second.output.slice(-1_000));
      assert.match(second.output, new RegExp(codeword));
      note("persistent conversation recall", "PASS");
    }
  } finally {
    // The temporary directory is intentionally left for failure diagnosis.
  }

  const failed = results.filter((result) => result.status === "FAIL");
  const skipped = results.filter((result) => result.status === "SKIP");
  console.log(`e2e summary: ${results.length - failed.length - skipped.length} passed, ${skipped.length} skipped, ${failed.length} failed`);
  assert.equal(failed.length, 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`e2e: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

export { main };
