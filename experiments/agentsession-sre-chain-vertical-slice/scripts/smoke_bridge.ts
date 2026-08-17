/**
 * Smoke test: dispatch ONE coordinator-entry activation against the tiny fixture.
 * Verifies AgentSession + custom tools + prompt template + evidence store all wire together.
 * Does NOT run the full chain — this is the earliest failure detector.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { initRunDir, paths, saveResolvedChain, saveRunState } from "../src/chain/store.ts";
import { newResolvedChain, stepById } from "../src/chain/topology.ts";
import { initialRunState } from "../src/chain/reducer.ts";
import { dispatchActivation } from "../src/agents/bridge.ts";
import { nowIso, participantId, executionId, shortId } from "../src/util/ids.ts";
import { createLogger, defaultRender } from "../src/util/logger.ts";
import { projectEvidence } from "../src/evidence/index.ts";
import { readMessages } from "../src/chain/store.ts";

const targetRepo = path.resolve(new URL("../fixtures/tiny-repo", import.meta.url).pathname);
if (!fs.existsSync(targetRepo)) throw new Error(`fixture missing: ${targetRepo}`);
const stateDir = `${process.env.HOME}/.cache/agentsession-sre-chain-vertical-slice`;
const chainRunId = `smoke-${shortId("sre", 4)}`;
const p = paths(stateDir, chainRunId);
await initRunDir(p);

const chain = newResolvedChain({
  root_bead_id: "smoke-root",
  fingerprint: {
    pi_package: { name: "smoke", version: "0" },
    beads_version: "smoke",
    experiment_source_dir: path.resolve(new URL("..", import.meta.url).pathname),
    experiment_source_dirty: false,
    baseline_specialists: [],
  },
});
await saveResolvedChain(p, chain);
const run = initialRunState(chain, chainRunId);
await saveRunState(p, run);

const logger = createLogger({ forensicsPath: p.forensicsEvents, ndjsonMode: false, humanRender: defaultRender });

const step = stepById(chain, "coordinator-entry");
const pid = participantId(chain.chain_id, step.role);
const identity = {
  chain_id: chain.chain_id,
  step_id: step.step_id,
  step_bead_id: "svs-smoke-1",
  role: step.role,
  class: step.class,
  participant_id: pid,
  execution_id: executionId(pid, 1),
  attempt: 1,
};

console.log(`\n=== smoke: dispatching coordinator-entry against ${targetRepo} ===\n`);
const res = await dispatchActivation({
  paths: p,
  channelId: `chain:${chain.chain_id}`,
  identity,
  model: step.model,
  fallbackModel: step.fallback_model,
  targetRepo,
  assignmentPrompt: [
    "## Assignment",
    `chain_id: ${chain.chain_id}`,
    `step_id: ${step.step_id}`,
    `role: ${step.role}`,
    `participant_id: ${pid}`,
    `execution_id: ${identity.execution_id}`,
    "",
    "## Incident brief (from operator)",
    "svc-b in the fixture repo shows repeated OOM kills starting about 5 minutes ago. Last git commit dropped its memory_limit from 512Mi to 64Mi.",
    "",
    "## What you MUST do (exit criteria)",
    "1. Publish ONE evidence via `evidence_publish` with kind='coordinator.decision'.",
    "2. Post ONE `work.turn` message via `channel_post` action_targeting the two advisors.",
    "3. Then stop.",
  ].join("\n"),
  perTurnTimeoutMs: 120_000,
  onFact: (f) => void logger.fact(f),
});

console.log(`\n=== dispatch result ===`);
console.log(JSON.stringify(res, null, 2));
console.log(`\n=== evidence produced ===`);
const proj = await projectEvidence(p);
console.log(JSON.stringify(Object.entries(proj.by_step).map(([k, v]) => ({ step: k, count: v.length, kinds: v.map((e) => e.kind), summaries: v.map((e) => e.summary) })), null, 2));
console.log(`\n=== messages posted ===`);
const msgs = await readMessages(p);
console.log(msgs.map((m) => `#${m.id} ${m.kind} by ${m.author.participant_role} targets=[${m.audience.action_targets.join(",")}] evidence_refs=[${(m.evidence_refs ?? []).join(",")}]`).join("\n") || "(none)");
console.log(`\n=== state dir ===\n${p.root}`);
