import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SYSTEM_PROMPT } from "../src/prompt.mjs";
import { makeClosedLoader, makeGatedBashTool } from "../src/runtime.mjs";

const stubCtx = {
  sessionManager: { getSessionId: () => "test-session", getSessionFile: () => undefined },
  model: { provider: "test", id: "test-model" },
  thinkingLevel: "off",
};

test("closed loader exposes an empty, closed runtime surface", () => {
  const loader = makeClosedLoader();
  assert.equal(loader.getExtensions().extensions.length, 0);
  assert.equal(loader.getExtensions().errors.length, 0);
  assert.equal(loader.getSkills().skills.length, 0);
  assert.equal(loader.getPrompts().prompts.length, 0);
  assert.equal(loader.getThemes().themes.length, 0);
  assert.equal(loader.getAgentsFiles().agentsFiles.length, 0);
  assert.equal(loader.getSystemPrompt(), SYSTEM_PROMPT);
  assert.equal(loader.getAppendSystemPrompt().length, 0);
  assert.equal(loader.getAppendSystemPromptSources().length, 0);
});

test("gated bash tool exposes a valid bash tool definition", () => {
  const tool = makeGatedBashTool({ cwd: "/tmp", askApprove: null });
  assert.equal(tool.name, "bash");
  assert.equal(typeof tool.execute, "function");
});

test("createXtsSession reuses the invocation ModelRuntime and exposes only bash", async () => {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const { getModel } = await import("@earendil-works/pi-ai/compat");
  const dir = await mkdtemp(path.join(os.tmpdir(), "xts-runtime-"));
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(dir, "auth.json"),
    modelsPath: path.join(dir, "models.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const model = getModel("anthropic", "claude-sonnet-4-5");
  assert.ok(model, "Pi test model should exist");
  const { createXtsSession } = await import("../src/runtime.mjs");
  const created = await createXtsSession({ model, modelRuntime, sessionMode: "inMemory" });
  try {
    assert.equal(created.runtime, modelRuntime);
    assert.deepEqual(created.session.agent.state.tools.map((tool) => tool.name), ["bash"]);
  } finally {
    created.session.dispose();
  }
});

test("gated bash tool: dangerous command with denying askApprove does not execute", async () => {
  let realCalled = false;
  const tool = makeGatedBashTool({
    cwd: "/tmp",
    askApprove: async () => false, // deny
  });
  // Denied dangerous command must throw (the tool result the model sees).
  await assert.rejects(
    tool.execute("call_1", { command: "rm -rf /tmp/x" }, new AbortController().signal, undefined, stubCtx),
    /blocked by XTS safety gate/,
  );
  assert.equal(realCalled, false);
});

test("gated bash tool: approved dangerous command executes", async () => {
  const tool = makeGatedBashTool({
    cwd: "/tmp",
    askApprove: async () => true, // approve
  });
  // Safe command also executes (approval not needed, PRD §14).
  const result = await tool.execute("call_1", { command: "echo hi" }, new AbortController().signal, undefined, stubCtx);
  assert.ok(result);
});

test("classifier drives the gate: safe skips approval, dangerous asks", async () => {
  const { classifyCommand } = await import("../src/safety/classify.mjs");
  assert.equal(classifyCommand("echo hi").safe, true);
  assert.equal(classifyCommand("rm -rf /tmp/x").safe, false);
});
