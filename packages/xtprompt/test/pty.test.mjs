import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const appUrl = new URL("../src/app.mjs", import.meta.url).href;
const cliUrl = new URL("../src/cli.mjs", import.meta.url).href;
const finalPrompt = "security and tests prompt";
const osc52 = Buffer.from(`\u001b]52;c;${Buffer.from(finalPrompt).toString("base64")}\u0007`);

const helperSource = `
import assert from "node:assert/strict";
const [{ runCli }, { openInteractive }] = await Promise.all([
  import(${JSON.stringify(appUrl)}),
  import(${JSON.stringify(cliUrl)}),
]);
const model = { provider: "test-provider", id: "test-model", maxTokens: 4096 };
const replies = ["initial prompt", "security prompt", ${JSON.stringify(finalPrompt)}];
let turn = 0;
const runtime = {
  getModel: () => model,
  hasConfiguredAuth: () => true,
  getAvailable: async () => [model],
  completeSimple: async (_model, request) => {
    if (turn === 0) assert.match(request.messages[0].content, /release checklist/);
    if (turn === 1) {
      assert.match(request.messages[0].content, /initial prompt/);
      assert.match(request.messages[0].content, /focus on security/);
    }
    if (turn === 2) {
      assert.match(request.messages[0].content, /security prompt/);
      assert.match(request.messages[0].content, /add test requirements/);
    }
    return { content: [{ type: "text", text: \`<xtprompt>\${replies[turn++]}</xtprompt>\` }] };
  },
};
process.exitCode = await runCli({
  argv: ["--interactive", "Implement a release checklist for packages/xtprompt with validation."],
  isInputTTY: process.stdin.isTTY,
  createRuntime: async () => runtime,
  settingsManager: { getDefaultProvider: () => undefined, getDefaultModel: () => undefined },
  openInteractive,
  controlStream: process.stderr,
  env: {},
});
`;

async function runPty(onOutput) {
  const directory = await mkdtemp(join(tmpdir(), "xtprompt-pty-"));
  const helper = join(directory, "smoke.mjs");
  await writeFile(helper, helperSource);

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn("script", ["-qfec", `${process.execPath} ${helper}`, "/dev/null"], {
        cwd: new URL("..", import.meta.url),
        stdio: ["pipe", "pipe", "pipe"],
      });
      const chunks = [];
      let output = Buffer.alloc(0);
      const capture = (chunk) => {
        chunks.push(chunk);
        output = Buffer.concat([output, chunk]);
        onOutput?.(child, output);
      };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      child.once("error", reject);
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("PTY smoke timed out with an open readline process"));
      }, 10_000);
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal, output: Buffer.concat(chunks) });
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("PTY performs two refinements, emits exact OSC 52, and exits after :accept", async () => {
  const lines = ["focus on security\n", "add test requirements\n", ":accept\n"];
  let sent = 0;
  const result = await runPty((child, output) => {
    const prompts = output.toString().split("xtprompt> ").length - 1;
    if (sent < lines.length && prompts > sent) child.stdin.write(lines[sent++]);
  });

  assert.equal(sent, 3);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.output.includes(osc52), true, result.output.toString("hex"));
  assert.equal(result.output.includes(Buffer.from(finalPrompt)), true);
  assert.match(result.output.toString(), /copied to clipboard\. Exiting\./);
});

test("PTY SIGINT exits with code 130 without copying or leaving readline open", async () => {
  let sent = false;
  const result = await runPty((child, output) => {
    if (!sent && output.includes(Buffer.from("xtprompt> "))) {
      sent = true;
      child.stdin.write("\u0003");
    }
  });

  assert.equal(sent, true);
  assert.equal(result.code, 130, result.output.toString("hex"));
  assert.equal(result.signal, null);
  assert.equal(result.output.includes(osc52), false);
  assert.doesNotMatch(result.output.toString(), /copied to clipboard/);
});
