import * as path from "node:path";
import type { Paths } from "./store.ts";
import { readJsonSafe, writeJsonAtomic } from "../util/fs.ts";

export interface ChainRunInputs {
  schema_version: 1;
  target_repo_path: string;
  incident_brief: string;
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
