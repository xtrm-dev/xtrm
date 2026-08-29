import * as path from "node:path";
import type { Paths } from "./store.ts";
import { readJsonSafe, writeJsonAtomic } from "../util/fs.ts";

/**
 * Opt-in provenance run config (robot identities slice 3, xtrm-1zv).
 * Host-provided trusted inputs ONLY: registries, role->actor binding,
 * designated non-production scratch target, authorship mode. The scheduler
 * emits ONE provenance receipt per satisfied step (real git commit in the
 * designated scratch repo) when this config is present and enabled.
 */
export type ProvenanceAuthorshipMode =
  | "human_direct"
  | "xtrm_web_direct"
  | "xtrm_local_direct"
  | "xtrm_host_direct"
  | "xtrm_relay";

export interface ProvenanceRunConfig {
  enabled: true;
  /** Registered actor + principal-set config (schema-checked at use). */
  registries: {
    actors: Record<string, unknown>;
    principalSets: Record<string, unknown>;
  };
  /** step.role -> registered actor_id (role-bound actor resolution, F4). */
  roleActors: Record<string, string>;
  /** Designated NON-PRODUCTION scratch root containing the commit repo. */
  scratchRoot: string;
  /** Repo dir inside scratchRoot receiving the real canary commit. */
  repoDir: string;
  /** Assignment beacon; defaults to the chain root bead id. */
  assignmentId?: string;
  assignmentVersion?: number;
  /** Authority ref; defaults to the chain root bead id. */
  authorityRef?: string;
  principalSetId?: string;
  authorshipMode: ProvenanceAuthorshipMode;
}

export interface ChainRunInputs {
  schema_version: 1;
  target_repo_path: string;
  incident_brief: string;
  /** Present ONLY when the run opts into provenance receipts. */
  provenance?: ProvenanceRunConfig;
}

export function chainRunInputsPath(p: Paths): string {
  return path.join(p.chainDir, "run-inputs.json");
}

export async function saveChainRunInputs(p: Paths, inputs: ChainRunInputs): Promise<void> {
  await writeJsonAtomic(chainRunInputsPath(p), inputs);
}

export async function loadChainRunInputs(p: Paths): Promise<ChainRunInputs | null> {
  return readJsonSafe<ChainRunInputs>(chainRunInputsPath(p));
}
