import * as path from "node:path";
import type { Paths } from "../chain/store.ts";
import type { ParticipantRole } from "../chain/types.ts";
import { readJsonSafe, writeJsonAtomic } from "../util/fs.ts";
import {
  assertSpecialistCompatible,
  compileSpecialistActivationProfile,
  loadSpecialistJson,
  type SpecialistActivationProfile,
} from "./loader.ts";
import type { FrozenSpecialistBinding } from "./sre-team.ts";

export interface SpecialistBindingsFile {
  schema_version: 1;
  mode: "auto" | "required";
  created_at: string;
  bindings: Partial<Record<ParticipantRole, FrozenSpecialistBinding>>;
}

export function specialistBindingsPath(p: Paths): string {
  return path.join(p.chainDir, "specialist-bindings.json");
}

export async function saveSpecialistBindings(p: Paths, file: SpecialistBindingsFile): Promise<void> {
  await writeJsonAtomic(specialistBindingsPath(p), file);
}

export async function loadSpecialistBindings(p: Paths): Promise<SpecialistBindingsFile | null> {
  return readJsonSafe<SpecialistBindingsFile>(specialistBindingsPath(p));
}

/**
 * Rehydrate the exact Specialist cognition approved for this run.
 * Source drift is fail-closed: a resume cannot silently pick up a changed JSON.
 */
export async function loadBoundSpecialistProfile(
  p: Paths,
  targetRepo: string,
  role: ParticipantRole,
): Promise<SpecialistActivationProfile | undefined> {
  const frozen = await loadSpecialistBindings(p);
  const binding = frozen?.bindings[role];
  if (!binding) return undefined;

  const loaded = await loadSpecialistJson(binding.source_path);
  if (loaded.source.sha256 !== binding.sha256) {
    throw new Error(
      `Specialist source drift for role=${role} name=${binding.name}: ` +
      `frozen sha256=${binding.sha256}, current sha256=${loaded.source.sha256}. ` +
      "Start a new ChainRun/revision instead of mutating cognition in-place.",
    );
  }
  if (loaded.document.specialist.metadata.name !== binding.name) {
    throw new Error(
      `Specialist identity drift for role=${role}: frozen name=${binding.name}, ` +
      `current name=${loaded.document.specialist.metadata.name}`,
    );
  }
  if (loaded.document.specialist.metadata.version !== binding.version) {
    throw new Error(
      `Specialist version drift for role=${role}: frozen version=${binding.version}, ` +
      `current version=${loaded.document.specialist.metadata.version}`,
    );
  }

  const profile = await compileSpecialistActivationProfile(loaded, {
    targetRepo,
    strictSkills: true,
  });
  assertSpecialistCompatible(profile);
  return profile;
}
