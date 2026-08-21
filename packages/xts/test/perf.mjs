#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CLI = path.join(ROOT, "src", "cli.mjs");
const NODE = process.execPath;
const TIMEOUT_MS = 2_000;

function runHelp() {
  const started = performance.now();
  const result = spawnSync(NODE, [CLI, "--help"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  const elapsed = performance.now() - started;
  assert.equal(result.status, 0, result.stderr);
  return elapsed;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function measureTui() {
  const appUrl = pathToFileURL(path.join(ROOT, "src", "ui", "app.mjs")).href;
  const source = `import { createXtsApp } from ${JSON.stringify(appUrl)}; const app = createXtsApp({}); setTimeout(() => app.close(), 100);`;
  const command = `${shellQuote(NODE)} --input-type=module -e ${shellQuote(source)}`;
  const started = performance.now();
  const child = spawn("script", ["-qefc", command, "/dev/null"], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  return new Promise((resolve, reject) => {
    let firstVisible;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("pty TUI smoke timed out"));
    }, TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (firstVisible === undefined && /[^\u001b\s]/.test(chunk)) firstVisible = performance.now() - started;
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`pty TUI smoke exited ${code}: ${stderr || stdout.slice(-500)}`));
        return;
      }
      assert.notEqual(firstVisible, undefined, `TUI produced no visible output: ${JSON.stringify(stdout)}`);
      resolve({ elapsed: firstVisible, output: stdout });
    });
  });
}

function peakRssKb() {
  const time = spawnSync("/usr/bin/time", ["-f", "%M", NODE, CLI, "--help"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  if (time.error?.code !== "ENOENT") {
    assert.equal(time.status, 0, time.stderr);
    const match = time.stderr.trim().match(/(\d+)\s*$/);
    assert.ok(match, `could not parse peak RSS from /usr/bin/time: ${time.stderr}`);
    return Number(match[1]);
  }

  // Minimal containers may not ship /usr/bin/time. Inject an exit hook into
  // the child so process.memoryUsage() still measures the CLI process itself.
  const probe = "data:text/javascript,process.on('exit',()=>console.error('XTS_RSS='+process.memoryUsage().rss))";
  const fallback = spawnSync(NODE, ["--import", probe, CLI, "--help"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  assert.equal(fallback.status, 0, fallback.stderr);
  const match = fallback.stderr.match(/XTS_RSS=(\d+)/);
  assert.ok(match, `could not parse child process RSS: ${fallback.stderr}`);
  return Math.ceil(Number(match[1]) / 1024);
}

function schemaTokenCount() {
  return import("../src/runtime.mjs").then(async ({ makeGatedBashTool }) => {
    const { estimateTokens } = await import("../src/prompt.mjs");
    const tool = makeGatedBashTool({ cwd: ROOT, askApprove: null });
    const schema = JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? tool.inputSchema ?? tool.schema,
    });
    return { tokens: estimateTokens(schema), bytes: schema.length };
  });
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main() {
  const cold = runHelp();
  const warmSamples = [runHelp(), runHelp(), runHelp(), runHelp(), runHelp()];
  const tui = await measureTui();
  const { SYSTEM_PROMPT, estimateTokens } = await import("../src/prompt.mjs");
  const systemTokens = estimateTokens(SYSTEM_PROMPT);
  const schema = await schemaTokenCount();
  const rss = peakRssKb();

  assert.ok(cold < 1_500, `cold non-model startup ${cold.toFixed(1)}ms >= 1500ms`);
  assert.ok(average(warmSamples) < 1_500, `warm non-model startup ${average(warmSamples).toFixed(1)}ms >= 1500ms`);
  assert.ok(tui.elapsed < 2_000, `first visible TUI ${tui.elapsed.toFixed(1)}ms >= 2000ms`);
  assert.ok(systemTokens <= 250, `system prompt estimate ${systemTokens} tokens exceeds 250-token budget`);
  assert.ok(schema.tokens <= 1_000, `bash schema estimate ${schema.tokens} tokens exceeds 1000-token budget`);

  const rows = [
    ["cold startup (--help)", `${cold.toFixed(1)} ms`],
    ["warm startup mean (5 runs)", `${average(warmSamples).toFixed(1)} ms`],
    ["time to first visible TUI (pty)", `${tui.elapsed.toFixed(1)} ms`],
    ["system prompt (heuristic, 4 chars/token)", `${systemTokens} tokens`],
    ["bash tool schema (heuristic, 4 chars/token)", `${schema.tokens} tokens (${schema.bytes} bytes)`],
    ["peak RSS (--help)", `${rss} KiB`],
  ];
  const width = Math.max(...rows.map(([name]) => name.length));
  console.log("XTS performance metrics");
  console.log(`${"metric".padEnd(width)} | value`);
  console.log(`${"-".repeat(width)}-|-------`);
  for (const [name, value] of rows) console.log(`${name.padEnd(width)} | ${value}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`perf: ${error.message}`);
    process.exitCode = 1;
  });
}

export { main };
