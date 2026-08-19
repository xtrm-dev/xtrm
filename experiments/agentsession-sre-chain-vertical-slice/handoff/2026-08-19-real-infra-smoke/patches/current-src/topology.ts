/**
 * Fixed SRE triage topology per spec §3.
 *
 *   coordinator (entry) → [explorer + observability-analyst] → diagnostician → reviewer → coordinator (close)
 *
 * The reviewer verdict routes:
 *   PASS      → coordinator (close)
 *   PARTIAL   → diagnostician (bounded remediation, cap = 2 loops)
 *   FAIL      → coordinator (escalate/close_fail)
 *
 * Coordinator appears TWICE conceptually (entry gate + close gate) but as one
 * logical participant with one step_id — its "phase" is derived from run state.
 */

import type { ChainStep, ParticipantRole, ResolvedChain } from "./types.ts";
import { nowIso, shortId } from "../util/ids.ts";

const DEFAULT_MODEL = "commandcode/deepseek/deepseek-v4-flash";
const DEFAULT_FALLBACK = "opencode-go/deepseek-v4-flash";

const STEP_DEFS: Array<{
  step_id: string;
  role: ParticipantRole;
  class: ChainStep["class"];
  needs: string[];
}> = [
  { step_id: "coordinator-entry", role: "chain-coordinator", class: "coordinator", needs: [] },
  { step_id: "explorer", role: "explorer", class: "advisor", needs: ["coordinator-entry"] },
  { step_id: "observability", role: "observability-analyst", class: "advisor", needs: ["coordinator-entry"] },
  {
    step_id: "diagnostician",
    role: "sre-diagnostician",
    class: "step",
    needs: ["explorer", "observability"],
  },
  { step_id: "reviewer", role: "reviewer", class: "gate", needs: ["diagnostician"] },
  { step_id: "coordinator-close", role: "chain-coordinator", class: "coordinator", needs: ["reviewer"] },
];

export function buildFixedSreTopology(): ChainStep[] {
  return STEP_DEFS.map((s) => ({
    ...s,
    model: DEFAULT_MODEL,
    fallback_model: DEFAULT_FALLBACK,
  }));
}

export function newResolvedChain(args: {
  chain_id?: string;
  root_bead_id: string;
  fingerprint: ResolvedChain["fingerprint"];
}): ResolvedChain {
  const chain_id = args.chain_id ?? shortId("chain-sre");
  const topology = buildFixedSreTopology();
  return {
    chain_id,
    root_bead_id: args.root_bead_id,
    topology,
    entry_step_id: "coordinator-entry",
    close_step_id: "coordinator-close",
    reviewer_step_id: "reviewer",
    diagnostician_step_id: "diagnostician",
    created_at: nowIso(),
    fingerprint: args.fingerprint,
  };
}

export function stepById(chain: ResolvedChain, stepId: string): ChainStep {
  const s = chain.topology.find((x) => x.step_id === stepId);
  if (!s) throw new Error(`unknown step_id: ${stepId}`);
  return s;
}
