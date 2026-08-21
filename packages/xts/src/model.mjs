import { readConfig, writeConfig } from "./config.mjs";

// Model resolution for XTS.
//
// Authority: Pi's ModelRuntime inventory (built-ins + models.json + auth).
// XTS stores only the preference: { model: { provider, id } }.
// XTS never silently substitutes a model (PRD §8.4, §21).

export const NO_MODELS_GUIDANCE =
  "No authenticated models found. Configure a provider in Pi first: run `pi` and add an API key (or sign in via OAuth), then retry.";

/**
 * Return available models as { provider, id, name } from runtime.getAvailable().
 * Sorted by provider (alphabetical), then model id.
 */
export async function listAvailable(runtime) {
  const available = await runtime.getAvailable();
  return [...available]
    .map((m) => ({ provider: m.provider, id: m.id, name: m.name ?? m.id }))
    .sort(byProviderThenId);
}

/**
 * Return the persisted model { provider, id } from config if present AND
 * available in the runtime inventory. Returns null when not configured or
 * unavailable. Never silently substitutes another model.
 */
export async function resolveModel(runtime, config) {
  const model = config?.model;
  if (!model || typeof model.provider !== "string" || typeof model.id !== "string") {
    return null;
  }
  // Return the runtime's Model object (carries capabilities + auth state), not
  // a plain { provider, id } — createAgentSession needs the real Model.
  const found = runtime.getModel(model.provider, model.id);
  if (!found) return null;
  const available = await runtime.getAvailable();
  const isAvailable = available.some((m) => m.provider === model.provider && m.id === model.id);
  return isAvailable ? found : null;
}

/**
 * True when the model exists in the runtime inventory and is available
 * (in the getAvailable() set, or resolvable via getModel with configured auth).
 */
export async function isModelAvailable(runtime, provider, id) {
  const available = await runtime.getAvailable();
  return available.some((m) => m.provider === provider && m.id === id);
}

/** `${provider}/${id}` */
export function formatModel(model) {
  return `${model.provider}/${model.id}`;
}

/**
 * Return the available model inventory; throw a descriptive error with
 * Pi-auth guidance when it is empty.
 */
export async function requireAvailableModels(runtime) {
  const models = await listAvailable(runtime);
  if (models.length === 0) {
    throw new Error(NO_MODELS_GUIDANCE);
  }
  return models;
}

/**
 * JSON inventory shape for `xts model --json`:
 * { providers: [ { provider, models: [ { id, name } ] } ] }
 */
export function inventoryToJson(models) {
  const byProvider = new Map();
  for (const m of models) {
    if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
    byProvider.get(m.provider).push({ id: m.id, name: m.name });
  }
  const providers = [...byProvider.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, models]) => ({
      provider,
      models: models.sort((a, b) => a.id.localeCompare(b.id)),
    }));
  return { providers };
}

/**
 * Orchestration helper for first-launch and `xts model` (task 7 runtime wiring):
 * resolve the persisted model, or run the selector and persist the choice.
 *
 * `select` is an injectable function: async (models) => { provider, id } | null.
 *
 * Returns { model } on success or { error } when nothing could be selected.
 * Persistence is owned here: { model: { provider, id } } merged into config.
 */
export async function resolveOrSelectModel(runtime, config, select) {
  const persisted = await resolveModel(runtime, config);
  if (persisted) return { model: persisted };

  let models;
  try {
    models = await requireAvailableModels(runtime);
  } catch (error) {
    return { error: error.message };
  }

  const chosen = await select(models);
  if (!chosen || typeof chosen.provider !== "string" || typeof chosen.id !== "string") {
    return { error: "Model selection cancelled." };
  }
  const model = { provider: chosen.provider, id: chosen.id };
  await writeConfig({ ...(config ?? {}), model });
  return { model };
}

function byProviderThenId(a, b) {
  return a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id);
}
