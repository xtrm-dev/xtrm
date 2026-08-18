import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  createExtensionRuntime,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import type { ParticipantIdentity, RuntimeFact } from "../chain/types.ts";
import type { Paths } from "../chain/store.ts";
import { buildTools, DEFAULT_SRE_ALLOWLIST, DEFAULT_SRE_DENYLIST } from "../tools/index.ts";
import { nowIso } from "../util/ids.ts";
import {
  renderInlineMandatoryRules,
  renderSpecialistSystemLayer,
  renderSpecialistTaskTemplate,
  type SpecialistActivationProfile,
} from "../specialists/loader.ts";
import { roleAdaptationOverlay } from "../specialists/sre-team.ts";

const ROLES_DIR = path.resolve(new URL("../../roles", import.meta.url).pathname);

export interface SpecialistDispatchArgs {
  paths: Paths;
  channelId: string;
  identity: ParticipantIdentity;
  profile: SpecialistActivationProfile;
  targetRepo: string;
  assignmentPrompt: string;
  incidentBrief?: string;
  preScriptOutput?: string;
  onFact: (fact: RuntimeFact) => void;
}

export interface SpecialistDispatchResult {
  execution_id: string;
  pi_session_id?: string;
  agent_end_ok: boolean;
  agent_end_error?: string;
  final_state_message_count: number;
  specialist_name: string;
  specialist_version: string;
  specialist_sha256: string;
}

function parseModelString(modelStr: string): { provider: string; id: string } {
  const idx = modelStr.indexOf("/");
  if (idx < 0) throw new Error(`invalid model string, expected provider/id, got: ${modelStr}`);
  return { provider: modelStr.slice(0, idx), id: modelStr.slice(idx + 1) };
}

function makeAppendResourceLoader(appendPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    // Keep Pi's host/tool kernel. `system_prompt_mode=replace` only replaces the
    // Specialist cognition layer; it can never erase tool discovery or XTRM authority.
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [appendPrompt],
    extendResources: () => {},
    reload: async () => {},
  };
}

function effectiveThinkingLevel(profile: SpecialistActivationProfile) {
  // Pi currently accepts this exact enum; undefined lets Pi/model defaults apply.
  return profile.execution.thinking_level;
}

/**
 * Direct AgentSession activation driven by a fully-loaded Specialist JSON.
 *
 * Important: loading a Specialist does NOT transfer orchestration authority to
 * the Specialist prompt. XTRM still owns scheduling, Channels, Beads, retries,
 * evidence and satisfaction. Arbitrary skills.scripts are retained by the
 * compiler but intentionally NOT executed by this bridge.
 */
export async function dispatchSpecialistActivation(
  args: SpecialistDispatchArgs,
): Promise<SpecialistDispatchResult> {
  const doctrine = await fs.readFile(path.join(ROLES_DIR, "_chain_doctrine.md"), "utf8");
  const systemLayer = renderSpecialistSystemLayer(
    args.profile,
    doctrine,
    roleAdaptationOverlay(args.identity.role),
  );

  const primaryParts = parseModelString(args.profile.execution.model);
  const primary = getModel(primaryParts.provider, primaryParts.id);
  if (!primary) throw new Error(`model not found: ${args.profile.execution.model}`);

  const scoped: Array<{ model: any }> = [{ model: primary }];
  for (const fallback of args.profile.execution.fallback_models) {
    const parsed = parseModelString(fallback);
    const model = getModel(parsed.provider, parsed.id);
    if (model) scoped.push({ model });
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: {
      enabled: args.profile.execution.max_retries > 0,
      maxRetries: args.profile.execution.max_retries,
    },
  });

  const customTools = buildTools({
    paths: args.paths,
    channelId: args.channelId,
    identity: args.identity,
    targetRepo: args.targetRepo,
    execAllowlist: DEFAULT_SRE_ALLOWLIST,
    execDenylist: DEFAULT_SRE_DENYLIST,
    onFact: args.onFact,
  });

  const resourceLoader = makeAppendResourceLoader(systemLayer);
  const taskFromSpecialist = renderSpecialistTaskTemplate(args.profile, {
    prompt: args.assignmentPrompt,
    cwd: args.targetRepo,
    pre_script_output: args.preScriptOutput ?? "",
    bead_id: args.identity.step_bead_id ?? "",
  });
  const inlineRules = renderInlineMandatoryRules(args.profile);
  const prompt = [
    taskFromSpecialist,
    inlineRules,
    "## XTRM assignment — authoritative execution envelope",
    args.assignmentPrompt,
  ].filter(Boolean).join("\n\n");

  const { session } = await createAgentSession({
    cwd: args.targetRepo,
    model: primary,
    ...(effectiveThinkingLevel(args.profile)
      ? { thinkingLevel: effectiveThinkingLevel(args.profile) as any }
      : {}),
    scopedModels: scoped,
    resourceLoader,
    customTools,
    // permission_required is compiled to host policy; it never re-enables Pi's
    // generic builtin bash/edit/write surface in this read-only SRE harness.
    noTools: "builtin",
    sessionManager: SessionManager.inMemory(args.targetRepo),
    settingsManager,
  });

  let piSessionId: string | undefined;
  let agentEnded = false;
  let agentEndError: string | undefined;
  const done = new Promise<void>((resolve) => {
    const unsub = session.subscribe((event) => {
      if (event.type !== "agent_end") return;
      if (event.willRetry) return;
      agentEnded = true;
      try {
        piSessionId = session.sessionId;
      } catch {
        // disposal-safe capture is best-effort; logical execution identity is XTRM-owned.
      }
      unsub();
      resolve();
    });
  });

  try {
    piSessionId = session.sessionId;
    args.onFact({
      ts: nowIso(),
      chain_id: args.identity.chain_id,
      role: args.identity.role,
      step_id: args.identity.step_id,
      participant_id: args.identity.participant_id,
      kind: "step.start",
      detail: `specialist=${args.profile.name}@${args.profile.version} sha256=${args.profile.source.sha256.slice(0, 12)}`,
      meta: {
        specialist_name: args.profile.name,
        specialist_version: args.profile.version,
        specialist_sha256: args.profile.source.sha256,
      },
    });
    await session.prompt(prompt);
    await done;
  } catch (error: any) {
    agentEndError = error?.message ?? String(error);
    args.onFact({
      ts: nowIso(),
      chain_id: args.identity.chain_id,
      role: args.identity.role,
      step_id: args.identity.step_id,
      participant_id: args.identity.participant_id,
      kind: "step.failed",
      detail: `Specialist AgentSession prompt threw: ${agentEndError}`,
      meta: {
        specialist_name: args.profile.name,
        specialist_version: args.profile.version,
        specialist_sha256: args.profile.source.sha256,
      },
    });
  } finally {
    session.dispose();
  }

  const messageCount = (() => {
    try {
      return session.state.messages.length;
    } catch {
      return -1;
    }
  })();

  return {
    execution_id: args.identity.execution_id,
    pi_session_id: piSessionId,
    agent_end_ok: agentEnded && !agentEndError,
    agent_end_error: agentEndError,
    final_state_message_count: messageCount,
    specialist_name: args.profile.name,
    specialist_version: args.profile.version,
    specialist_sha256: args.profile.source.sha256,
  };
}
