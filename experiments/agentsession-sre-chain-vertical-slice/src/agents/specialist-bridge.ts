import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  createExtensionRuntime,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { resolveModel as getModel } from "./model-resolver.ts";
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
      // ---- LIVE STREAM patch (uncommitted, xtrm-pq1.x): forward Pi runtime
      // events to onFact so the operator sees per-activation progress in the
      // pane and in forensics/events.jsonl, not just start/done.
      const emitLive = (kind: string, detail: string) => {
        try {
          args.onFact({
            ts: new Date().toISOString(),
            chain_id: args.identity.chain_id,
            step_id: args.identity.step_id,
            participant_id: args.identity.participant_id,
            role: args.identity.role,
            kind: kind as any,
            detail,
            meta: { execution_id: args.identity.execution_id },
          } as any);
        } catch { /* best-effort telemetry */ }
      };
      const ev: any = event;
      switch (ev.type) {
        case "agent_start":
          emitLive("activation.start", `pi_session=${ev.sessionId ?? ev.session_id ?? "?"}`); return;
        case "message_start":
          emitLive("activation.msg.start", `role=${ev.role ?? ev.messageRole ?? "?"}`); return;
        case "message_end": {
          const t = ev.text ?? ev.content ?? ev.assistantText ?? "";
          const snip = typeof t === "string" ? t.replace(/\s+/g, " ").slice(0, 160) : "";
          emitLive("activation.msg.end", `len=${(typeof t === "string" ? t.length : 0)}  head="${snip}"`);
          return;
        }
        case "tool_execution_start": {
          const name = ev.name ?? ev.toolName ?? ev.tool ?? "?";
          const argStr = (() => { try { return JSON.stringify(ev.arguments ?? ev.input ?? {}).slice(0, 200); } catch { return "?"; } })();
          emitLive("activation.tool.start", `${name}  args=${argStr}`); return;
        }
        case "tool_execution_end": {
          const name = ev.name ?? ev.toolName ?? ev.tool ?? "?";
          const okv = (ev.ok ?? ev.success ?? (ev.error == null)) ? "ok" : `err=${ev.error ?? "?"}`;
          emitLive("activation.tool.end", `${name}  ${okv}`); return;
        }
        case "bash_execution_update":
          emitLive("activation.bash", (ev.line ?? ev.text ?? "").toString().replace(/\s+/g," ").slice(0, 200)); return;
        case "agent_settled":
          emitLive("activation.settled", `settled`); return;
      }
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
    // ---- LIVE MESSAGES dump (xtrm-pq1.5): one activation.msg fact per
    // session message. ponytail: moved from catch to finally so it fires on
    // the happy path -- the previous placement only ran when session.prompt
    // threw, so a successful activation emitted zero activation.msg.<role>
    // facts.
    try {
      const msgs = ((session as any).state?.messages ?? []) as any[];
      for (let i = 0; i < msgs.length; i++) {
        const m: any = msgs[i];
        let snippet = "";
        try {
          const c = m.content;
          if (typeof c === "string") snippet = c;
          else snippet = JSON.stringify(c);
        } catch { snippet = "?"; }
        const head = String(snippet ?? "").replace(/\s+/g, " ").slice(0, 240);
        args.onFact({
          ts: new Date().toISOString(),
          chain_id: args.identity.chain_id,
          step_id: args.identity.step_id,
          participant_id: args.identity.participant_id,
          role: args.identity.role,
          kind: ("activation.msg." + (m.role ?? "?")) as any,
          detail: "#" + i + "  " + head,
          meta: { execution_id: args.identity.execution_id, idx: i, msg_role: m.role },
        } as any);
      }
    } catch { /* best-effort */ }
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
