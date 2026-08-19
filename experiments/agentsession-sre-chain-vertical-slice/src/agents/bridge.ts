/**
 * AgentSession bridge per spec §6.
 *
 * One direct createAgentSession() per activation. When a ChainRun has frozen
 * Specialist JSON bindings, dispatch is delegated to specialist-bridge.ts;
 * otherwise the original adapted role markdown remains the compatibility path.
 */

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
import { loadBoundSpecialistProfile } from "../specialists/bindings.ts";
import { dispatchSpecialistActivation } from "./specialist-bridge.ts";

const ROLES_DIR = path.resolve(new URL("../../roles", import.meta.url).pathname);

async function readRolePrompt(role: string): Promise<string> {
  const [doctrine, body] = await Promise.all([
    fs.readFile(path.join(ROLES_DIR, "_chain_doctrine.md"), "utf8"),
    fs.readFile(path.join(ROLES_DIR, `${role}.md`), "utf8"),
  ]);
  return `${doctrine}\n\n---\n\n${body}`;
}

export interface DispatchArgs {
  paths: Paths;
  channelId: string;
  identity: ParticipantIdentity;
  model: string; // "<provider>/<model-id>"
  fallbackModel?: string;
  targetRepo: string;
  assignmentPrompt: string;
  perTurnTimeoutMs?: number;
  onFact: (fact: RuntimeFact) => void;
}

export interface DispatchResult {
  execution_id: string;
  pi_session_id?: string;
  agent_end_ok: boolean;
  agent_end_error?: string;
  final_state_message_count: number;
}

function parseModelString(modelStr: string): { provider: string; id: string } {
  const idx = modelStr.indexOf("/");
  if (idx < 0) throw new Error(`invalid model string, expected provider/id, got: ${modelStr}`);
  return { provider: modelStr.slice(0, idx), id: modelStr.slice(idx + 1) };
}

/**
 * ResourceLoader that keeps pi's base system prompt (which auto-generates the
 * "Available tools" section from customTools' promptSnippet + parameters), and
 * APPENDS our chain-participant doctrine + role body. Discovery of user-level
 * skills/extensions/prompts is turned off — we want a clean env per activation.
 */
function makeAppendResourceLoader(appendPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    // Return undefined for getSystemPrompt so pi uses its default coding-agent prompt
    // which is where the "Available tools" section is emitted.
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [appendPrompt],
    extendResources: () => {},
    reload: async () => {},
  };
}

/**
 * Run one activation of one logical participant. Returns when the AgentSession's
 * agent_end event fires (which is NOT the same as step-satisfied — the reducer
 * checks evidence for that separately).
 */
export async function dispatchActivation(args: DispatchArgs): Promise<DispatchResult> {
  // Full Specialist JSON is opt-in per ChainRun. Bindings are persisted before
  // dispatch and source-hash verified on every activation/resume.
  const specialistProfile = await loadBoundSpecialistProfile(
    args.paths,
    args.targetRepo,
    args.identity.role,
  );
  if (specialistProfile) {
    const result = await dispatchSpecialistActivation({
      paths: args.paths,
      channelId: args.channelId,
      identity: args.identity,
      profile: specialistProfile,
      targetRepo: args.targetRepo,
      assignmentPrompt: args.assignmentPrompt,
      // Scheduler already emits the canonical step.start. Suppress the bridge's
      // provenance start duplicate while preserving failures/other facts.
      onFact: (fact) => {
        if (fact.kind === "step.start") return;
        args.onFact(fact);
      },
    });
    return {
      execution_id: result.execution_id,
      pi_session_id: result.pi_session_id,
      agent_end_ok: result.agent_end_ok,
      agent_end_error: result.agent_end_error,
      final_state_message_count: result.final_state_message_count,
    };
  }

  const rolePrompt = await readRolePrompt(args.identity.role);
  const resourceLoader = makeAppendResourceLoader(rolePrompt);

  // Do NOT override agentDir — this makes pi use the operator's real ~/.pi/agent/auth.json
  // and models.json. Per-run isolation happens via SessionManager.inMemory + SettingsManager.inMemory below.

  const { provider, id } = parseModelString(args.model);
  const primary = getModel(provider, id);
  if (!primary) throw new Error(`model not found: ${args.model}`);
  const scoped: Array<{ model: any }> = [{ model: primary }];
  if (args.fallbackModel) {
    const { provider: p2, id: i2 } = parseModelString(args.fallbackModel);
    const fb = getModel(p2, i2);
    if (fb) scoped.push({ model: fb });
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
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

  const { session } = await createAgentSession({
    cwd: args.targetRepo,
    model: primary,
    thinkingLevel: "medium",
    scopedModels: scoped,
    resourceLoader,
    customTools,
    // Disable pi's built-in bash/edit/write/read; keep our custom tools active.
    // Coordination is exclusively via chain_*/evidence_*/sre_exec.
    noTools: "builtin",
    sessionManager: SessionManager.inMemory(args.targetRepo),
    settingsManager,
  });

  let piSessionId: string | undefined;
  let agentEnded = false;
  let agentEndError: string | undefined;
  const done = new Promise<void>((resolve) => {
    const unsub = session.subscribe((event) => {
      // ---- LIVE STREAM patch (uncommitted): forward Pi runtime events to onFact
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
        } catch { /* best-effort */ }
      };
      const ev: any = event;
      switch (ev.type) {
        case "agent_start": emitLive("activation.start", `pi_session=${ev.sessionId ?? ev.session_id ?? "?"}`); return;
        case "message_start": emitLive("activation.msg.start", `role=${ev.role ?? ev.messageRole ?? "?"}`); return;
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
      if (event.type === "agent_end") {
        agentEnded = true;
        if (event.willRetry) {
          // let it retry — resolve on the second agent_end
          return;
        }
        try {
          piSessionId = session.sessionId;
        } catch {
          // ignore
        }
        unsub();
        resolve();
      }
    });
  });

  try {
    piSessionId = session.sessionId;
    await session.prompt(args.assignmentPrompt);
    await done;
  } catch (e: any) {
    agentEndError = e?.message ?? String(e);
    args.onFact({
      ts: nowIso(),
      chain_id: args.identity.chain_id,
      role: args.identity.role,
      step_id: args.identity.step_id,
      participant_id: args.identity.participant_id,
      kind: "step.failed",
      detail: `AgentSession prompt threw: ${agentEndError}`,
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
  };
}
