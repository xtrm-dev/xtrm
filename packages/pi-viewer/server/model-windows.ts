import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { contextWindowFromRegistry, type ModelRegistry } from "../src/lib/context-usage.ts"

/** Pi writes fetched model data here; models.json holds the operator's own additions. */
const FILES = [join(homedir(), ".pi", "agent", "models-store.json"), join(homedir(), ".pi", "agent", "models.json")]

let cache: { key: string; registry: ModelRegistry } | null = null
let override: ModelRegistry | null | undefined

/** Test hook: answer from this registry instead of the operator's files. */
export function setModelRegistryForTests(registry: ModelRegistry | null): void {
  override = registry
}

function fileKey(): string {
  return FILES.map((file) => {
    try {
      const stat = statSync(file)
      return `${stat.mtimeMs}:${stat.size}`
    } catch {
      return "missing"
    }
  }).join("|")
}

function load(): ModelRegistry {
  const key = fileKey()
  if (cache && cache.key === key) return cache.registry
  const merged: ModelRegistry = {}
  for (const file of FILES) {
    let data: unknown
    try {
      data = JSON.parse(readFileSync(file, "utf8"))
    } catch {
      continue
    }
    if (typeof data !== "object" || data === null) continue
    const providers = (data as { providers?: unknown }).providers ?? data
    if (typeof providers !== "object" || providers === null) continue
    for (const [provider, value] of Object.entries(providers)) {
      if (typeof value !== "object" || value === null) continue
      const models = (value as { models?: unknown }).models
      if (!Array.isArray(models)) continue
      merged[provider] = { models: [...(merged[provider]?.models ?? []), ...models] }
    }
  }
  cache = { key, registry: merged }
  return merged
}

/** The context window Pi reports for this model, or null when its registry does not know it. */
export function piContextWindow(model: string | null | undefined): number | null {
  if (override !== undefined) return contextWindowFromRegistry(model, override)
  return contextWindowFromRegistry(model, load())
}
