import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLI = new URL("../src/cli.mjs", import.meta.url).pathname;
const { createSessionEventHandler, promptInteractive, setupInteractiveSession, toolResultText } = await import("../src/cli.mjs");

function run(args, options = {}) {
  if (!Object.hasOwn(options, "input")) return execFileAsync(process.execPath, [CLI, ...args], options);
  const { input, ...spawnOptions } = options;
  return runWithInput(args, (stdin) => stdin.end(input), spawnOptions);
}

function runWithInput(args, writeInput, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { ...options, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`child exited ${code}`), { code, stdout, stderr }));
    });
    writeInput(child.stdin);
  });
}

function writeToolEventsLoader(dir) {
  const modules = {
    "./prompt.mjs": "export function buildUserMessage() { return 'test envelope'; }",
    "./stdin.mjs": "export async function readStdin() { return { content: '' }; }",
    "./context.mjs": "export async function loadShellContext() { return ''; }",
    "./config.mjs": "export async function readConfig() { return {}; }",
    "./model.mjs": "export async function resolveModel() { return { provider: 'test', id: 'test-model' }; }",
    "./runtime.mjs": [
      "export async function createXtsSession() {",
      "  let onEvent = () => {};",
      "  const session = {",
      "    subscribe(callback) { onEvent = callback; },",
      "    async prompt() {",
      "      onEvent({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'echo   called-by-tool' } });",
      "      onEvent({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: {}, isError: false });",
      "      onEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'done' } });",
      "    },",
      "    dispose() {},",
      "  };",
      "  return { session };",
      "}",
    ].join("\n"),
    "@earendil-works/pi-coding-agent": "export const ModelRuntime = { create: async () => ({}) };",
  };
  const loader = path.join(dir, "tool-events-loader.mjs");
  writeFileSync(
    loader,
    `import { register } from "node:module";\n` +
      `register(import.meta.url, import.meta.url);\n` +
      `const modules = ${JSON.stringify(modules)};\n` +
      "export async function resolve(specifier, context, nextResolve) {\n" +
      "  const source = modules[specifier];\n" +
      "  if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };\n" +
      "  return nextResolve(specifier, context);\n" +
      "}\n",
  );
  return loader;
}

function writeOneShotErrorLoader(dir) {
  const modules = {
    "./prompt.mjs": "export function buildUserMessage() { return 'test envelope'; }",
    "./stdin.mjs": "export async function readStdin() { return { content: '' }; }",
    "./context.mjs": "export async function loadShellContext() { return ''; }",
    "./config.mjs": "export async function readConfig() { return {}; }",
    "./model.mjs": "export async function resolveModel() { return { provider: 'test', id: 'test-model' }; }",
    "./runtime.mjs": [
      "export async function createXtsSession() {",
      "  let onEvent = () => {};",
      "  const session = {",
      "    subscribe(callback) { onEvent = callback; },",
      "    async prompt() {",
      "      onEvent({ type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'simulated provider failure' }] });",
      "    },",
      "    dispose() {},",
      "  };",
      "  return { session };",
      "}",
    ].join("\n"),
    "@earendil-works/pi-coding-agent": "export const ModelRuntime = { create: async () => ({}) };",
  };
  const loader = path.join(dir, "one-shot-error-loader.mjs");
  writeFileSync(
    loader,
    `import { register } from "node:module";\n` +
      `register(import.meta.url, import.meta.url);\n` +
      `const modules = ${JSON.stringify(modules)};\n` +
      "export async function resolve(specifier, context, nextResolve) {\n" +
      "  const source = modules[specifier];\n" +
      "  if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };\n" +
      "  return nextResolve(specifier, context);\n" +
      "}\n",
  );
  return loader;
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
  // Isolated config dir: no model configured -> one-shot fails fast with a
  // clear message (never hangs waiting on the network when no model is set).
  const dir = mkdtempSync(path.join(os.tmpdir(), "xts-cli-"));
  try {
    await assert.rejects(run(["frobnicate"], { env: { ...process.env, XTS_CONFIG_DIR: dir }, input: "" }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /no model configured/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("not-yet-implemented commands exit 1 with stderr message", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "xts-cli-"));
  try {
    await assert.rejects(run(["interactive"], { env: { ...process.env, XTS_CONFIG_DIR: dir } }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /(interactive session requires a TTY|no model configured)/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shellhook prints pure hook code safe for eval (no usage text)", async () => {
  const { stdout } = await run(["shellhook"]);
  assert.match(stdout, /xts_hook\(\)/);
  assert.doesNotMatch(stdout, /Install:/);
});

test("shellhook --help prints usage without hook code", async () => {
  const { stdout } = await run(["shellhook", "--help"]);
  assert.match(stdout, /Install it with/);
  assert.doesNotMatch(stdout, /xts_hook\(\) \{/);
});

test("shellhook zsh prints the zsh hook code only", async () => {
  const { stdout } = await run(["shellhook", "zsh"]);
  assert.match(stdout, /add-zsh-hook precmd xts_hook/);
  assert.doesNotMatch(stdout, /Install it with/);
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

// --- Bare pipe dispatch regressions (xtrm-nka.7.1) ---
// `command | xts` (no positional) must analyze stdin, not route to
// interactive. Isolated config dir so the no-model path fails fast.

test("bare pipe with stdin does not route to interactive", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "xts-cli-"));
  try {
    // No positional + piped stdin -> one-shot path -> no-model error (exit 1),
    // NOT the interactive-TTY error. Assert the one-shot error message.
    await assert.rejects(
      run([], { env: { ...process.env, XTS_CONFIG_DIR: dir }, input: "some piped data" }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /no model configured/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bare pipe with --show-prompt includes stdin evidence", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "xts-cli-"));
  try {
    const { stdout } = await run(["--show-prompt"], {
      env: { ...process.env, XTS_CONFIG_DIR: dir },
      input: "delayed producer line\n",
    });
    assert.match(stdout, /stdin evidence/);
    assert.match(stdout, /delayed producer line/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit question waits for a delayed producer through EOF", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "xts-cli-"));
  try {
    const { stdout } = await runWithInput(
      ["question", "--show-prompt"],
      (stdin) => setTimeout(() => stdin.end("DELAYED_EXPLICIT_EVIDENCE\n"), 400),
      { env: { ...process.env, XTS_CONFIG_DIR: dir } },
    );
    assert.match(stdout, /DELAYED_EXPLICIT_EVIDENCE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bare pipe waits for a delayed producer through EOF", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "xts-cli-"));
  try {
    const { stdout } = await runWithInput(
      ["--show-prompt"],
      (stdin) => setTimeout(() => stdin.end("producer arrived after startup\n"), 250),
      { env: { ...process.env, XTS_CONFIG_DIR: dir } },
    );
    assert.match(stdout, /producer arrived after startup/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tool result multipart preview joins parts with real newlines", () => {
  assert.equal(
    toolResultText({ content: [{ type: "text", text: "first" }, { type: "text", text: "second" }] }),
    "first\nsecond",
  );
});

test("assistant error renders once across turn_end and agent_end", () => {
  const calls = { errors: [], complete: 0, busy: [] };
  const app = {
    appendAssistantError: (error) => calls.errors.push(error),
    appendAssistantComplete: () => { calls.complete += 1; },
    setBusy: (busy) => calls.busy.push(busy),
    appendAssistantDelta() {},
    appendToolRow() {},
    appendToolResult() {},
  };
  const handle = createSessionEventHandler(app);
  const message = { role: "assistant", stopReason: "error", errorMessage: "provider failed" };
  handle({ type: "agent_start" });
  handle({ type: "turn_end", message });
  handle({ type: "agent_end", messages: [message] });
  assert.deepEqual(calls.errors, ["provider failed"]);
  assert.equal(calls.busy.at(-1), false);
});

test("interactive prompt lifecycle resets busy when context assembly fails", async () => {
  const calls = { busy: [], errors: [] };
  await promptInteractive({
    text: "question",
    session: { prompt: async () => { throw new Error("prompt should not run"); } },
    app: {
      setBusy: (busy) => calls.busy.push(busy),
      appendAssistantError: (error) => calls.errors.push(error),
    },
    loadShellContext: async () => { throw new Error("shell unavailable"); },
    buildUserMessage: () => "unused",
  });
  assert.equal(calls.busy.at(-1), false);
  assert.deepEqual(calls.errors, ["shell unavailable"]);
});

test("interactive setup closes the TUI when session creation fails", async () => {
  let closed = 0;
  await assert.rejects(
    setupInteractiveSession({
      createApp: () => ({ close: () => { closed += 1; }, setReady() {} }),
      createSession: async () => { throw new Error("session setup failed"); },
    }),
    /session setup failed/,
  );
  assert.equal(closed, 1);
});

test("interactive setup disposes a created session when wiring fails", async () => {
  let closed = 0;
  let disposed = 0;
  await assert.rejects(
    setupInteractiveSession({
      createApp: () => ({ close: () => { closed += 1; }, setReady() {} }),
      createSession: async () => ({ session: { dispose: () => { disposed += 1; } } }),
      setup: () => { throw new Error("session wiring failed"); },
    }),
    /session wiring failed/,
  );
  assert.equal(closed, 1);
  assert.equal(disposed, 1);
});

test("one-shot surfaces assistant stopReason errors on stderr and exits 1", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "xts-oneshot-error-"));
  try {
    const loader = writeOneShotErrorLoader(dir);
    const child = spawn(
      process.execPath,
      ["--import", pathToFileURL(loader).href, CLI],
      { env: { ...process.env, XTS_CONFIG_DIR: dir }, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.end(""); // close stdin so non-TTY pipe mode reads to EOF immediately
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    assert.equal(code, 1, `expected exit 1, stderr: ${stderr}`);
    assert.match(stderr, /xts: assistant error: simulated provider failure/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one-shot prints bash tool calls to stderr while stdout stays clean", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "xts-tool-events-"));
  try {
    const loader = writeToolEventsLoader(dir);
    const child = spawn(
      process.execPath,
      ["--import", pathToFileURL(loader).href, CLI],
      { env: { ...process.env, XTS_CONFIG_DIR: dir }, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.stdin.end("");
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    assert.equal(code, 0, `stderr: ${stderr}`);
    assert.match(stderr, /\$ echo called-by-tool/);
    assert.match(stderr, /-> ok/);
    assert.equal(stdout.trim(), "done");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("postinstall appends marked hook block once and honors opt-out", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "xts-postinstall-"));
  const script = path.join(path.dirname(CLI), "..", "scripts", "postinstall.mjs");
  const env = { ...process.env, HOME: home, SHELL: "/usr/bin/zsh", XTS_CONFIG_DIR: home };
  const runScript = async (extraEnv = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], {
        env: { ...env, ...extraEnv },
        stdio: "ignore",
      });
      child.on("error", reject);
      child.on("close", resolve);
    });

  try {
    assert.equal(await runScript(), 0);
    const rc = readFileSync(path.join(home, ".zshrc"), "utf8");
    assert.match(rc, /# xts shell history/);
    assert.match(rc, /eval "\$\(xts shellhook\)"/);

    // Idempotent: second run must not duplicate the block.
    assert.equal(await runScript(), 0);
    const again = readFileSync(path.join(home, ".zshrc"), "utf8");
    assert.equal((again.match(/# xts shell history/g) ?? []).length, 1);

    // Opt-out respected even with no rc present.
    const home2 = mkdtempSync(path.join(os.tmpdir(), "xts-postinstall-skip-"));
    try {
      assert.equal(await runScript({ XTS_SKIP_HOOK_INSTALL: "1" }), 0);
      assert.equal((() => { try { readFileSync(path.join(home2, ".zshrc"), "utf8"); return true; } catch { return false; } })(), false);
    } finally {
      rmSync(home2, { recursive: true, force: true });
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
