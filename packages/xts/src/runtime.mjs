// Slim AgentSession factory for XTS (PRD §12, §20).
//
// Closed runtime surface: an explicit empty resource loader (no skills,
// extensions, prompt templates, themes, context files, AGENTS — PRD §12.1),
// exactly one operational tool (bash — PRD §13), deterministic safety gate
// on every bash call (PRD §14), and explicit model selection (PRD §8).
//
// Wiring verified live in plan/runtime-prototype-notes.md (proto4.mjs):
//   - ModelRuntime.create({ allowModelNetwork:false, refreshOnCreate:false }) ≈ 11ms
//   - createAgentSession with the closed loader + custom gated bash ≈ 8ms
//   - getActiveToolNames() === ['bash']
//   - a denied dangerous command reaches the model as tool error evidence

import { createBashTool, createExtensionRuntime, createLocalBashOperations } from "@earendil-works/pi-coding-agent";
import { SYSTEM_PROMPT } from "./prompt.mjs";
import { classifyCommand } from "./safety/classify.mjs";

/**
 * Minimal explicit resource loader: an empty closed surface. The runtime
 * boundary is exactly the XTS prompt and the bash tool — nothing else is
 * discovered (PRD §12.1, acceptance criteria 2/3/4).
 */
export function makeClosedLoader() {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => SYSTEM_PROMPT,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

/**
 * Build the gated bash tool. Every bash call from the model passes through
 * the deterministic classifier; dangerous commands await explicit approval
 * (askApprove returns Promise<boolean>; the TUI overlay is the interactive
 * impl, the stdin fallback in safety/approve.mjs is the non-interactive one).
 *
 * Denied commands throw — the error text becomes the tool result the model
 * sees (exact evidence, PRD §21). Approved commands execute normally.
 */
export function makeGatedBashTool({ cwd, askApprove }) {
  const realOps = createLocalBashOperations();
  const gatedOps = {
    exec: async (command, execCwd, options) => {
      const verdict = classifyCommand(command);
      if (!verdict.safe) {
        let approved = false;
        if (typeof askApprove === "function") {
          approved = await askApprove({ command, reason: verdict.reason });
        }
        if (!approved) {
          throw new Error(`Command blocked by XTS safety gate: ${verdict.reason}`);
        }
      }
      return realOps.exec(command, execCwd, options);
    },
  };
  return createBashTool(cwd, { operations: gatedOps });
}

/**
 * Create a slim XTS AgentSession.
 *
 * @param {object} opts
 * @param {object} opts.model            resolved { provider, id } (from model.mjs)
 * @param {string} [opts.cwd]            working directory
 * @param {"persistent"|"inMemory"} [opts.sessionMode]  interactive persists
 * @param {(o:{command:string,reason:string})=>Promise<boolean>} [opts.askApprove]
 * @returns {Promise<{session: import("@earendil-works/pi-coding-agent").AgentSession, runtime: import("@earendil-works/pi-coding-agent").ModelRuntime}>}
 */
export async function createXtsSession({ model, cwd = process.cwd(), sessionMode = "inMemory", askApprove }) {
  const { ModelRuntime, SessionManager, SettingsManager, createAgentSession } =
    await import("@earendil-works/pi-coding-agent");

  const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const sessionManager =
    sessionMode === "persistent" ? SessionManager.create(cwd) : SessionManager.inMemory(cwd);
  const resourceLoader = makeClosedLoader();
  const bashTool = makeGatedBashTool({ cwd, askApprove });

  const { session } = await createAgentSession({
    model,
    thinkingLevel: "off",
    modelRuntime: runtime,
    settingsManager,
    resourceLoader,
    customTools: [bashTool],
    tools: ["bash"],
    sessionManager,
  });

  return { session, runtime };
}
