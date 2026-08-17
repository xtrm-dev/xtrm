/**
 * Verbose smoke — dumps session state + tool list + assistant response.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { initRunDir, paths, saveResolvedChain, saveRunState } from "../src/chain/store.ts";
import { newResolvedChain, stepById } from "../src/chain/topology.ts";
import { initialRunState } from "../src/chain/reducer.ts";
import { nowIso, participantId, executionId, shortId } from "../src/util/ids.ts";
import { createLogger, defaultRender } from "../src/util/logger.ts";
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  createExtensionRuntime,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import { buildTools, DEFAULT_SRE_ALLOWLIST, DEFAULT_SRE_DENYLIST } from "../src/tools/index.ts";
import * as fsp from "node:fs/promises";

const ROLES_DIR = path.resolve(new URL("../roles", import.meta.url).pathname);
async function readRolePrompt(role: string): Promise<string> {
  const [doctrine, body] = await Promise.all([
    fsp.readFile(path.join(ROLES_DIR, "_chain_doctrine.md"), "utf8"),
    fsp.readFile(path.join(ROLES_DIR, `${role}.md`), "utf8"),
  ]);
  return `${doctrine}\n\n---\n\n${body}`;
}

const targetRepo = path.resolve(new URL("../fixtures/tiny-repo", import.meta.url).pathname);
const stateDir = `${process.env.HOME}/.cache/agentsession-sre-chain-vertical-slice`;
const chainRunId = `verb-${shortId("sre", 4)}`;
const p = paths(stateDir, chainRunId);
await initRunDir(p);

const chain = newResolvedChain({
  root_bead_id: "verb-root",
  fingerprint: {
    pi_package: { name: "verb", version: "0" },
    beads_version: "verb",
    experiment_source_dir: path.resolve(new URL("..", import.meta.url).pathname),
    experiment_source_dirty: false,
    baseline_specialists: [],
  },
});
await saveResolvedChain(p, chain);
const run = initialRunState(chain, chainRunId);
await saveRunState(p, run);

const step = stepById(chain, "coordinator-entry");
const pid = participantId(chain.chain_id, step.role);
const identity = {
  chain_id: chain.chain_id,
  step_id: step.step_id,
  step_bead_id: "svs-verb-1",
  role: step.role,
  class: step.class,
  participant_id: pid,
  execution_id: executionId(pid, 1),
  attempt: 1,
};

const model = getModel("opencode-go", "deepseek-v4-flash");
if (!model) throw new Error("no model");

const customTools = buildTools({
  paths: p,
  channelId: `chain:${chain.chain_id}`,
  identity,
  targetRepo,
  execAllowlist: DEFAULT_SRE_ALLOWLIST,
  execDenylist: DEFAULT_SRE_DENYLIST,
  onFact: () => {},
});
const rolePrompt = await readRolePrompt(identity.role);
const resourceLoader: ResourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => undefined,
  getAppendSystemPrompt: () => [rolePrompt],
  extendResources: () => {},
  reload: async () => {},
};

const { session } = await createAgentSession({
  cwd: targetRepo,
  model,
  thinkingLevel: "medium",
  resourceLoader,
  customTools,
  noTools: "builtin",
  sessionManager: SessionManager.inMemory(targetRepo),
  settingsManager: SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 } }),
});

console.log("\n=== ACTIVE TOOLS ===");
console.log(session.getActiveToolNames().join(", "));
console.log("\n=== ALL TOOLS ===");
console.log(session.getAllTools().map((t) => t.name).join(", "));
console.log("\n=== SYSTEM PROMPT (first 1600 chars) ===");
console.log(session.systemPrompt.slice(0, 1600));
console.log("\n=== SYSTEM PROMPT (last 1600 chars) ===");
console.log(session.systemPrompt.slice(-1600));

let doneResolve!: () => void;
const done = new Promise<void>((r) => (doneResolve = r));
session.subscribe((ev) => {
  if (ev.type === "agent_end" && !ev.willRetry) doneResolve();
});

await session.prompt([
  "## Assignment",
  `chain_id: ${chain.chain_id}`,
  `step_id: coordinator-entry`,
  `role: chain-coordinator`,
  `participant_id: ${pid}`,
  `execution_id: ${identity.execution_id}`,
  "",
  "## Incident brief",
  "svc-b OOM-kills in the fixture repo after last commit dropped memory_limit from 512Mi to 64Mi.",
  "",
  "## Exit criteria",
  "You MUST call evidence_publish(kind='coordinator.decision', summary='...', body={...}) and then channel_post(kind='work.turn', action_targets=['" + chain.chain_id + "::explorer','" + chain.chain_id + "::observability-analyst'], body={summary:'...'}, evidence_refs=[<evidence_id>]). Do not respond in plain text — call the tools.",
].join("\n"));
await done;

console.log("\n=== SESSION MESSAGES ===");
for (const m of session.state.messages) {
  console.log(`\n--- ${m.role} ---`);
  if (typeof m.content === "string") {
    console.log(m.content.slice(0, 1200));
  } else {
    console.log(JSON.stringify(m.content, null, 2).slice(0, 2000));
  }
}
session.dispose();
