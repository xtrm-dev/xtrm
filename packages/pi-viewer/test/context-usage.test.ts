import assert from "node:assert/strict"
import { test } from "node:test"

import {
  contextLabel,
  contextPercent,
  contextTokensUsed,
  contextTone,
  contextUsageFrom,
  contextUsageOf,
  contextWindowFor,
  contextWindowFromRegistry,
  formatTokens,
} from "../src/lib/context-usage.ts"

/** A Claude transcript record, exactly as ~/.claude/projects/**.jsonl writes it. */
const claudeAssistant = (usage: Record<string, number>) => ({
  type: "assistant",
  message: { role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "ok" }], usage },
})

/** A pi transcript record, exactly as ~/.pi/agent/sessions/**.jsonl writes it. */
const piAssistant = (usage: Record<string, number>) => ({
  type: "message",
  id: "m1",
  message: { role: "assistant", content: [{ type: "text", text: "ok" }], usage },
})

const claudeUsage = { input_tokens: 2, cache_creation_input_tokens: 46_393, cache_read_input_tokens: 0, output_tokens: 4 }
const piUsage = { input: 525, output: 340, cacheRead: 103_552, cacheWrite: 0, totalTokens: 104_417 }

test("the window comes from the model id, and an unknown model has none", () => {
  assert.equal(contextWindowFor("claude-opus-5-5"), 200_000)
  assert.equal(contextWindowFor("claude-sonnet-5-5"), 200_000)
  assert.equal(contextWindowFor("claude-opus-4-8"), 200_000)
  assert.equal(contextWindowFor("anthropic/claude-sonnet-4-5"), 200_000)
  assert.equal(contextWindowFor("claude-opus-5-5[1m]"), 1_000_000)
  assert.equal(contextWindowFor("deepseek/deepseek-v4.1-flash"), null)
  assert.equal(contextWindowFor("beam-free"), null)
  assert.equal(contextWindowFor(null), null)
  assert.equal(contextWindowFor(""), null)
  assert.equal(contextWindowFor("   "), null)
})

test("Claude usage counts input plus both cache paths, never output", () => {
  assert.equal(contextTokensUsed([claudeAssistant(claudeUsage)]), 46_395)
})

test("pi usage counts input plus both cache paths, never output", () => {
  assert.equal(contextTokensUsed([piAssistant(piUsage)]), 104_077)
})

test("the newest assistant message that carries usage wins", () => {
  const records = [
    piAssistant({ ...piUsage, cacheRead: 1_000 }),
    { type: "message", message: { role: "user", content: "hi" } },
    piAssistant(piUsage),
    claudeAssistant({ ...claudeUsage, input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
  ]
  assert.equal(contextTokensUsed(records), 104_077)
})

test("no usage anywhere means no ring", () => {
  assert.equal(contextTokensUsed([]), null)
  assert.equal(contextTokensUsed([{ type: "message", message: { role: "assistant", content: [] } }]), null)
  assert.equal(contextTokensUsed([claudeAssistant({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })]), null)
  assert.equal(contextTokensUsed([{ type: "assistant" }, { type: "user", usage: piUsage }]), null)
})

test("usage is reported only when both the window and the usage are known", () => {
  const records = [piAssistant(piUsage)]
  assert.deepEqual(contextUsageOf(records, "claude-opus-5-5"), { used: 104_077, window: 200_000 })
  assert.equal(contextUsageOf(records, "deepseek/deepseek-v4.1-flash"), null)
  assert.equal(contextUsageOf(records, null), null)
  assert.equal(contextUsageOf([], "claude-opus-5-5"), null)
})

test("the fraction is a clamped whole percent", () => {
  assert.equal(contextPercent({ used: 46_395, window: 200_000 }), 23)
  assert.equal(contextPercent({ used: 0, window: 200_000 }), 0)
  assert.equal(contextPercent({ used: 200_000, window: 200_000 }), 100)
  assert.equal(contextPercent({ used: 260_000, window: 200_000 }), 100)
  assert.equal(contextPercent({ used: 10, window: 0 }), 0)
})

test("the tone steps at three quarters and nine tenths", () => {
  const tone = (percent: number) => contextTone({ used: percent * 2_000, window: 200_000 })
  assert.equal(tone(0), "calm")
  assert.equal(tone(74), "calm")
  assert.equal(tone(75), "warm")
  assert.equal(tone(89), "warm")
  assert.equal(tone(90), "hot")
  assert.equal(tone(100), "hot")
})

test("token counts read compactly in the tooltip", () => {
  assert.equal(formatTokens(500), "500")
  assert.equal(formatTokens(46_395), "46k")
  assert.equal(formatTokens(165_000), "165k")
  assert.equal(formatTokens(200_000), "200k")
  assert.equal(formatTokens(1_000_000), "1M")
  assert.equal(formatTokens(1_048_576), "1.0M")
})

test("the accessible name carries the state, as on the sidebar dot", () => {
  assert.equal(contextLabel({ used: 46_395, window: 200_000 }), "23% of 200k tokens")
  assert.equal(contextLabel({ used: 990_000, window: 1_000_000 }), "99% of 1M tokens")
})

test("pi's registry resolves the window from provider and model id", () => {
  const registry = {
    "opencode-go": { models: [{ id: "deepseek-v4.1-flash", contextWindow: 1_000_000 }] },
    deepseek: { models: [{ id: "deepseek-v4-pro", contextWindow: 1_048_576 }] },
  }
  assert.equal(contextWindowFromRegistry("opencode-go/deepseek-v4.1-flash", registry), 1_000_000)
  assert.equal(contextWindowFromRegistry("deepseek/deepseek-v4-pro", registry), 1_048_576)
  assert.equal(contextWindowFromRegistry("deepseek/deepseek-v4-pro:thinking", registry), 1_048_576)
  assert.equal(contextWindowFromRegistry("opencode-go/unknown", registry), null)
  assert.equal(contextWindowFromRegistry("deepseek-v4-pro", registry), null)
  assert.equal(contextWindowFromRegistry("deepseek/deepseek-v4-pro", null), null)
})

test("context from a cached usage block takes the registry window", () => {
  assert.deepEqual(contextUsageFrom(piUsage, "opencode-go/deepseek-v4.1-flash", 1_000_000), { used: 104_077, window: 1_000_000 })
  assert.equal(contextUsageFrom(null, "opencode-go/deepseek-v4.1-flash", 1_000_000), null)
  assert.equal(contextUsageFrom(piUsage, "unknown/model", null), null)
})
