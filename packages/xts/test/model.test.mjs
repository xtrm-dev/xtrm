import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readConfig } from "../src/config.mjs";
import {
  NO_MODELS_GUIDANCE,
  formatModel,
  inventoryToJson,
  isModelAvailable,
  listAvailable,
  requireAvailableModels,
  resolveModel,
  resolveOrSelectModel,
} from "../src/model.mjs";

async function withTempConfig(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xts-model-"));
  const prevDir = process.env.XTS_CONFIG_DIR;
  process.env.XTS_CONFIG_DIR = dir;
  try {
    await run();
  } finally {
    if (prevDir === undefined) delete process.env.XTS_CONFIG_DIR;
    else process.env.XTS_CONFIG_DIR = prevDir;
  }
}

const MODELS = [
  { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
  { provider: "openai", id: "gpt-5.6", name: "GPT-5.6" },
  { provider: "anthropic", id: "claude-haiku", name: "Claude Haiku" },
];

function makeRuntime(models = MODELS) {
  return {
    getAvailable: async () => models,
    getModel: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
  };
}

test("listAvailable groups and sorts by provider then id", async () => {
  const models = await listAvailable(makeRuntime());
  assert.deepEqual(models, [
    { provider: "anthropic", id: "claude-haiku", name: "Claude Haiku" },
    { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
    { provider: "openai", id: "gpt-5.6", name: "GPT-5.6" },
  ]);
});

test("resolveModel returns the persisted model when available", async () => {
  const config = { model: { provider: "anthropic", id: "claude-sonnet" } };
  const model = await resolveModel(makeRuntime(), config);
  assert.ok(model, "model should resolve");
  assert.equal(model.provider, "anthropic");
  assert.equal(model.id, "claude-sonnet");
});

test("resolveModel returns null when no model is configured", async () => {
  assert.equal(await resolveModel(makeRuntime(), { model: null }), null);
  assert.equal(await resolveModel(makeRuntime(), {}), null);
});

test("resolveModel returns null for a persisted-but-unavailable model (no silent fallback)", async () => {
  const runtime = makeRuntime([{ provider: "anthropic", id: "claude-haiku", name: "Claude Haiku" }]);
  const config = { model: { provider: "anthropic", id: "claude-opus" } };
  assert.equal(await resolveModel(runtime, config), null);
});

test("isModelAvailable reflects the available set", async () => {
  const runtime = makeRuntime();
  assert.equal(await isModelAvailable(runtime, "anthropic", "claude-sonnet"), true);
  assert.equal(await isModelAvailable(runtime, "anthropic", "claude-opus"), false);
});

test("resolveModel handles model ids containing slashes", async () => {
  const runtime = makeRuntime([{ provider: "commandcode", id: "deepseek/deepseek-v4-flash", name: "DeepSeek" }]);
  const model = await resolveModel(runtime, { model: { provider: "commandcode", id: "deepseek/deepseek-v4-flash" } });
  assert.ok(model, "model should resolve");
  assert.equal(model.provider, "commandcode");
  assert.equal(model.id, "deepseek/deepseek-v4-flash");
});

test("formatModel renders provider/id", () => {
  assert.equal(formatModel({ provider: "openai", id: "gpt-5.6" }), "openai/gpt-5.6");
});

test("requireAvailableModels returns the inventory when non-empty", async () => {
  const models = await requireAvailableModels(makeRuntime());
  assert.ok(models.length > 0);
});

test("requireAvailableModels throws with Pi-auth guidance when empty", async () => {
  await assert.rejects(requireAvailableModels(makeRuntime([])), (error) => {
    assert.match(error.message, /pi/i);
    assert.match(error.message, /authenticat/i);
    return true;
  });
});

test("inventoryToJson shapes providers with models", () => {
  assert.deepEqual(inventoryToJson(MODELS), {
    providers: [
      {
        provider: "anthropic",
        models: [
          { id: "claude-haiku", name: "Claude Haiku" },
          { id: "claude-sonnet", name: "Claude Sonnet" },
        ],
      },
      { provider: "openai", models: [{ id: "gpt-5.6", name: "GPT-5.6" }] },
    ],
  });
});

test("resolveOrSelectModel: no config -> calls selector, persists result", async () => {
  const runtime = makeRuntime();
  const calls = [];
  const select = async (models) => {
    calls.push(models);
    return { provider: "openai", id: "gpt-5.6" };
  };
  const { result } = await (async () => {
    let result;
    await withTempConfig(async () => {
      result = await resolveOrSelectModel(runtime, { model: null }, select);
      assert.equal(result.model.provider, "openai");
      assert.equal(result.model.id, "gpt-5.6");
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0][0], {
        provider: "anthropic",
        id: "claude-haiku",
        name: "Claude Haiku",
      });
      assert.deepEqual(await readConfig(), { model: { provider: "openai", id: "gpt-5.6" } });
    });
    return { result };
  })();
  assert.equal(result.model.provider, "openai");
  assert.equal(result.model.id, "gpt-5.6");
});

test("resolveOrSelectModel: valid config -> skips selector", async () => {
  const runtime = makeRuntime();
  let called = 0;
  const result = await resolveOrSelectModel(runtime, { model: { provider: "openai", id: "gpt-5.6" } }, async () => {
    called++;
    throw new Error("selector should not run");
  });
  assert.equal(result.model.provider, "openai");
  assert.equal(result.model.id, "gpt-5.6");
  assert.equal(called, 0);
});

test("resolveOrSelectModel: invalid config -> calls selector", async () => {
  const runtime = makeRuntime();
  let called = 0;
  await withTempConfig(async () => {
    const result = await resolveOrSelectModel(
      runtime,
      { model: { provider: "openai", id: "does-not-exist" } },
      async () => {
        called++;
        return { provider: "anthropic", id: "claude-haiku" };
      },
    );
    assert.equal(result.model.provider, "anthropic");
    assert.equal(result.model.id, "claude-haiku");
    assert.equal(called, 1);
    assert.deepEqual(await readConfig(), { model: { provider: "anthropic", id: "claude-haiku" } });
  });
});

test("resolveOrSelectModel returns the authoritative runtime Model object", async () => {
  const authoritative = { provider: "openai", id: "gpt-5.6", capabilities: { toolCall: true } };
  const runtime = {
    getAvailable: async () => [{ provider: authoritative.provider, id: authoritative.id, name: "GPT-5.6" }],
    getModel: (provider, id) => provider === authoritative.provider && id === authoritative.id ? authoritative : undefined,
  };
  await withTempConfig(async () => {
    const result = await resolveOrSelectModel(runtime, { model: null }, async () => ({
      provider: authoritative.provider,
      id: authoritative.id,
    }));
    assert.equal(result.model, authoritative);
  });
});

test("resolveOrSelectModel rejects a selection missing from the runtime inventory", async () => {
  const runtime = makeRuntime();
  await withTempConfig(async () => {
    const result = await resolveOrSelectModel(runtime, { model: null }, async () => ({
      provider: "missing",
      id: "model",
    }));
    assert.match(result.error, /unavailable|not found|selection/i);
    assert.deepEqual(await readConfig(), { model: null });
  });
});

test("resolveOrSelectModel: selector cancel -> error, nothing persisted", async () => {
  await withTempConfig(async () => {
    const runtime = makeRuntime();
    const result = await resolveOrSelectModel(runtime, { model: null }, async () => null);
    assert.deepEqual(result, { error: "Model selection cancelled." });
    assert.deepEqual(await readConfig(), { model: null });
  });
});

test("resolveOrSelectModel: empty inventory -> error with Pi guidance", async () => {
  const result = await resolveOrSelectModel(makeRuntime([]), { model: null }, async () => {
    throw new Error("selector should not run");
  });
  assert.deepEqual(result, { error: NO_MODELS_GUIDANCE });
});
