#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { performance } from "node:perf_hooks";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CLI = path.join(ROOT, "src", "cli.mjs");
const NODE = process.execPath;
const TIMEOUT_MS = 2_000;
const INTERACTIVE_TIMEOUT_MS = 90_000;

function runNoModel(env) {
  const started = performance.now();
  const result = spawnSync(NODE, [CLI, "--show-prompt"], {
    cwd: ROOT,
    env,
    input: "",
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  assert.equal(result.status, 0, result.stderr);
  return performance.now() - started;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

// Strip CSI/OSC terminal control sequences before deciding whether a PTY
// render contains visible content. Raw escape bytes are not a TUI readiness
// signal.
function printable(text) {
  return text
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()][0-2A-Z]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
}

function modelInventory() {
  const result = spawnSync(NODE, [CLI, "model", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function prepareEnvironment() {
  const inventory = modelInventory();
  const configDir = await mkdtemp(path.join(os.tmpdir(), "xts-perf-config-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "xts-perf-state-"));
  const model = inventory.providers[0]?.models[0];
  if (model) {
    await writeFile(
      path.join(configDir, "xts.json"),
      `${JSON.stringify({ model: { provider: inventory.providers[0].provider, id: model.id } }, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
  return {
    inventory,
    env: { ...process.env, XTS_CONFIG_DIR: configDir, XTS_STATE_DIR: stateDir },
    cleanup: () => Promise.all([rm(configDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]),
  };
}

function measureInteractive(env, measureResponse) {
  const command = [NODE, CLI].map(shellQuote).join(" ");
  const started = performance.now();
  const child = spawn("script", ["-qefc", command, "/dev/null"], {
    cwd: ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let raw = "";
  let firstVisible;
  let promptAt;
  let responseAt;
  let shutdownTimer;
  let settled = false;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`real CLI PTY smoke timed out; output: ${printable(raw).slice(-500)}`));
    }, INTERACTIVE_TIMEOUT_MS);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(shutdownTimer);
      resolve(value);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      raw += chunk;
      const visible = printable(raw);
      if (firstVisible === undefined && visible.length > 0) firstVisible = performance.now() - started;
      if (promptAt === undefined && /\bxts\b/.test(visible)) {
        promptAt = performance.now();
        child.stdin.write("Without using tools, calculate 1240189 + 7654645; reply only with the decimal result.\r");
      }
      if (measureResponse && promptAt !== undefined && responseAt === undefined && visible.includes("8894834")) {
        responseAt = performance.now() - promptAt;
        shutdownTimer = setTimeout(() => child.stdin.write("\x03"), 750);
      }
    });
    child.stderr.on("data", (chunk) => { raw += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(shutdownTimer);
      if (code !== 0) {
        reject(new Error(`real CLI PTY smoke exited ${code}: ${printable(raw).slice(-500)}`));
        return;
      }
      assert.notEqual(firstVisible, undefined, "real CLI produced no printable TUI output");
      if (measureResponse) assert.notEqual(responseAt, undefined, "real CLI produced no first-response evidence");
      finish({ firstVisible, responseAt, output: raw });
    });
  });
}

async function measureTui(env, measureResponse) {
  return measureInteractive(env, measureResponse);
}

function peakRssKb(env) {
  const time = spawnSync("/usr/bin/time", ["-f", "%M", NODE, CLI, "--help"], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  if (time.error?.code !== "ENOENT") {
    assert.equal(time.status, 0, time.stderr);
    const match = time.stderr.trim().match(/(\d+)\s*$/);
    assert.ok(match, `could not parse peak RSS from /usr/bin/time: ${time.stderr}`);
    return Number(match[1]);
  }

  const probe = "data:text/javascript,process.on('exit',()=>console.error('XTS_RSS='+process.memoryUsage().rss))";
  const fallback = spawnSync(NODE, ["--import", probe, CLI, "--help"], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  assert.equal(fallback.status, 0, fallback.stderr);
  const match = fallback.stderr.match(/XTS_RSS=(\d+)/);
  assert.ok(match, `could not parse child process RSS: ${fallback.stderr}`);
  return Math.ceil(Number(match[1]) / 1024);
}

async function schemaTokenCount() {
  const { makeGatedBashTool } = await import("../src/runtime.mjs");
  const { estimateTokens } = await import("../src/prompt.mjs");
  const tool = makeGatedBashTool({ cwd: ROOT, askApprove: null });
  const schema = JSON.stringify({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters ?? tool.inputSchema ?? tool.schema,
  });
  return { tokens: estimateTokens(schema), bytes: schema.length };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main() {
  const { inventory, env, cleanup } = await prepareEnvironment();
  try {
    const cold = runNoModel(env);
    const warmSamples = [runNoModel(env), runNoModel(env), runNoModel(env), runNoModel(env), runNoModel(env)];
    const interactive = await measureTui(env, inventory.providers.length > 0);
    const { SYSTEM_PROMPT, estimateTokens } = await import("../src/prompt.mjs");
    const systemTokens = estimateTokens(SYSTEM_PROMPT);
    const schema = await schemaTokenCount();
    const rss = peakRssKb(env);

    assert.ok(cold < 1_500, `cold non-model startup ${cold.toFixed(1)}ms >= 1500ms`);
    assert.ok(average(warmSamples) < 1_500, `repeated full CLI startup ${average(warmSamples).toFixed(1)}ms >= 1500ms`);
    assert.ok(interactive.firstVisible < 2_000, `first visible TUI ${interactive.firstVisible.toFixed(1)}ms >= 2000ms`);
    if (inventory.providers.length > 0) assert.ok(interactive.responseAt > 0, "Enter-to-first-response timing must be positive");
    assert.ok(systemTokens <= 250, `system prompt estimate ${systemTokens} tokens exceeds 250-token budget`);
    assert.ok(schema.tokens <= 1_000, `bash schema estimate ${schema.tokens} tokens exceeds 1000-token budget`);

    const rows = [
      ["cold full CLI startup (--show-prompt)", `${cold.toFixed(1)} ms`],
      ["warm repeated full CLI startup mean (5 runs)", `${average(warmSamples).toFixed(1)} ms`],
      ["time to first visible TUI (real cli.mjs + pty)", `${interactive.firstVisible.toFixed(1)} ms`],
      ["time from Enter to first streamed answer evidence", interactive.responseAt === undefined ? "SKIP (no authenticated model)" : `${interactive.responseAt.toFixed(1)} ms`],
      ["system prompt (heuristic, 4 chars/token)", `${systemTokens} tokens`],
      ["bash tool schema (heuristic, 4 chars/token)", `${schema.tokens} tokens (${schema.bytes} bytes)`],
      ["peak RSS (--help)", `${rss} KiB`],
    ];
    const width = Math.max(...rows.map(([name]) => name.length));
    console.log("XTS performance metrics");
    console.log(`${"metric".padEnd(width)} | value`);
    console.log(`${"-".repeat(width)}-|-------`);
    for (const [name, value] of rows) console.log(`${name.padEnd(width)} | ${value}`);
    console.log("warm definition: repeated full no-model CLI processes; no module-cache claim");
  } finally {
    await cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`perf: ${error.message}`);
    process.exitCode = 1;
  });
}

export { main, measureTui };
