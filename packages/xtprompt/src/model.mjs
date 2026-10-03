/**
 * xtprompt model layer — Pi runtime access, model selection, and completion.
 *
 * Extracted from app.mjs (CORE-2342): app.mjs now owns only CLI orchestration
 * and interactive state; every call into the Pi SDK lives here so the CLI and
 * future adapters share one runtime surface.
 *
 * Pin: @earendil-works/pi-coding-agent ^1.0.0. Verified against pi 1.0.0:
 * ModelRuntime.create/getModel/getAvailable/hasConfiguredAuth/completeSimple,
 * SettingsManager.create/getDefaultProvider/getDefaultModel, resolveCliModel.
 */

const DEFAULT_MAX_OUTPUT_TOKENS = 1600;
const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Create the Pi ModelRuntime. `createRuntime` is an injection seam for tests;
 * default loads the runtime from Pi's model configuration. Throws when that
 * configuration cannot be loaded (caller maps this to exit code 1).
 */
export async function createRuntime(injected) {
  if (injected) return injected();
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  return ModelRuntime.create();
}

/**
 * Resolve the model: explicit --model first, then Pi's saved default
 * (provider+model, when authenticated), else the first authenticated model.
 * Returns { model } or { error } (error text is terminal-safe; exit code 2).
 */
export async function selectModel(runtime, requested, configuredSettings) {
  if (requested) {
    const { resolveCliModel } = await import("@earendil-works/pi-coding-agent");
    const resolved = resolveCliModel({ cliModel: requested, modelRuntime: runtime });
    if (resolved.error) return { error: resolved.error };
    if (resolved.model) return { model: resolved.model };
  }

  const { SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const settings = configuredSettings ?? SettingsManager.create(process.cwd());
  const defaultProvider = settings.getDefaultProvider();
  const defaultModel = settings.getDefaultModel();
  if (defaultProvider && defaultModel) {
    const preferred = runtime.getModel(defaultProvider, defaultModel);
    if (preferred && runtime.hasConfiguredAuth(defaultProvider)) return { model: preferred };
  }

  let available;
  try {
    available = await runtime.getAvailable();
  } catch {
    return { error: "could not resolve authenticated Pi models." };
  }
  if (available.length === 0) {
    return { error: "no authenticated Pi models are available; configure Pi auth or pass --model." };
  }
  return { model: available[0] };
}

/**
 * Run one rewrite request. Resolves to the AssistantMessage or rejects on
 * timeout/abort; callers map errors to diagnostics and the retry policy.
 */
export function completeOnce(runtime, model, request, signal, { timeoutMs = DEFAULT_TIMEOUT_MS, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS } = {}) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return runtime.completeSimple(model, request, {
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    maxTokens: Math.min(model.maxTokens ?? maxTokens, maxTokens),
  });
}

export const MODEL_LIMITS = { DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_TIMEOUT_MS };
