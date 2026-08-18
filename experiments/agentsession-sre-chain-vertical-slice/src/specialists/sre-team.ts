import type { ParticipantRole } from "../chain/types.ts";
import {
  compileSpecialistActivationProfile,
  loadSpecialistFromRepo,
  type LoadedSpecialistDocument,
} from "./loader.ts";

export const SRE_SPECIALIST_BY_ROLE: Partial<Record<ParticipantRole, string>> = {
  "chain-coordinator": "sre-coordinator",
  explorer: "sre-host-forensics",
  "observability-analyst": "sre-observability-forensics",
  "sre-diagnostician": "sre-change-forensics",
  // reviewer intentionally remains XTRM-native: the current SRE Specialists team
  // has no independent reviewer equivalent, and the reviewer is a runtime quality gate.
};

export interface FrozenSkillBinding {
  declared_path: string;
  resolved_path: string;
  sha256: string;
}

export interface FrozenSpecialistBinding {
  name: string;
  source_path: string;
  sha256: string;
  version: string;
  skills: FrozenSkillBinding[];
}

export async function resolveSreSpecialistBindings(
  targetRepo: string,
  mode: "auto" | "required",
): Promise<Partial<Record<ParticipantRole, FrozenSpecialistBinding>>> {
  const result: Partial<Record<ParticipantRole, FrozenSpecialistBinding>> = {};
  for (const [role, name] of Object.entries(SRE_SPECIALIST_BY_ROLE) as Array<[ParticipantRole, string]>) {
    try {
      const loaded: LoadedSpecialistDocument = await loadSpecialistFromRepo(targetRepo, name);
      // Compile at approval/materialization time so every declared skill is resolved
      // and fingerprinted before the first activation. `required` therefore fails
      // early if cognition assets are incomplete.
      const profile = await compileSpecialistActivationProfile(loaded, {
        targetRepo,
        strictSkills: true,
      });
      result[role] = {
        name,
        source_path: loaded.source.path,
        sha256: loaded.source.sha256,
        version: loaded.document.specialist.metadata.version,
        skills: profile.skills.map((skill) => ({
          declared_path: skill.declared_path,
          resolved_path: skill.resolved_path,
          sha256: skill.sha256,
        })),
      };
    } catch (error) {
      if (mode === "auto") continue;
      throw error;
    }
  }

  if (mode === "required") {
    const missing = Object.entries(SRE_SPECIALIST_BY_ROLE)
      .filter(([role]) => !result[role as ParticipantRole])
      .map(([, name]) => name);
    if (missing.length > 0) {
      throw new Error(`required SRE Specialist JSON/cognition assets missing: ${missing.join(", ")}`);
    }
  }
  return result;
}

export function roleAdaptationOverlay(role: ParticipantRole): string {
  switch (role) {
    case "chain-coordinator":
      return [
        "## Chain-role adaptation: coordinator",
        "The loaded sre-coordinator JSON contains legacy instructions to fan out via `sp`, poll children, write result files and update Beads.",
        "Those are cognition-era orchestration instructions and are superseded here.",
        "For this activation, perform ONLY the coordinator entry/close gate assigned by XTRM. The reducer schedules all advisors and gates.",
        "A declared pre-script is not automatically executed by the loader; do not emulate it with arbitrary shell. Use only host-provided evidence/tools for this assignment.",
      ].join("\n");
    case "explorer":
      return [
        "## Chain-role adaptation: explorer",
        "Use the loaded sre-host-forensics probe doctrine as your domain cognition.",
        "Your governed output is topology/host evidence for the downstream diagnostician, not the legacy result file.",
      ].join("\n");
    case "observability-analyst":
      return [
        "## Chain-role adaptation: observability analyst",
        "Use the loaded sre-observability-forensics query doctrine as your domain cognition.",
        "Your governed output is observability evidence for the downstream diagnostician, not the legacy result file.",
      ].join("\n");
    case "sre-diagnostician":
      return [
        "## Chain-role adaptation: diagnostician",
        "The loaded sre-change-forensics JSON is a probe library and change-correlation doctrine, not your complete chain role.",
        "You MUST synthesize BOTH upstream advisor evidence sets, use change-forensics probes where useful, rank causal hypotheses, expose discrepancies and publish the diagnostician report required by XTRM.",
      ].join("\n");
    case "reviewer":
      return "";
  }
}
