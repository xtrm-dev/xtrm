#!/usr/bin/env bun
import * as path from "node:path";
import {
  loadAndCompileSpecialist,
  type SpecialistActivationProfile,
} from "../src/specialists/loader.ts";

function usage(): never {
  process.stderr.write(
    "usage: bun run scripts/inspect-specialist.ts --repo <repo> --name <specialist> [--allow-missing-skills]\n",
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
let repo = "";
let name = "";
let strictSkills = true;
for (let i = 0; i < argv.length; i++) {
  switch (argv[i]) {
    case "--repo": repo = argv[++i] ?? ""; break;
    case "--name": name = argv[++i] ?? ""; break;
    case "--allow-missing-skills": strictSkills = false; break;
    case "--help":
    case "-h": usage();
  }
}
if (!repo || !name) usage();

const profile = await loadAndCompileSpecialist(path.resolve(repo), name, { strictSkills });

function printable(profile: SpecialistActivationProfile) {
  return {
    schema_version: profile.schema_version,
    name: profile.name,
    version: profile.version,
    category: profile.category,
    source: profile.source,
    execution: profile.execution,
    prompt: {
      system_prompt_mode: profile.prompt.system_prompt_mode,
      system_bytes: Buffer.byteLength(profile.prompt.system),
      task_template_bytes: Buffer.byteLength(profile.prompt.task_template),
      has_output_schema: Boolean(profile.prompt.output_schema),
      skill_inherit: profile.prompt.skill_inherit,
    },
    skills: profile.skills.map((skill) => ({
      name: skill.name,
      declared_path: skill.declared_path,
      resolved_path: skill.resolved_path,
      sha256: skill.sha256,
      bytes: skill.bytes,
      outside_target_repo: skill.outside_target_repo,
    })),
    scripts: profile.scripts,
    capabilities: profile.capabilities,
    mandatory_rules: {
      template_sets: profile.mandatory_rules.template_sets,
      disable_default_globals: profile.mandatory_rules.disable_default_globals,
      inline_rule_ids: profile.mandatory_rules.inline_rules.map((rule) => rule.id),
    },
    validation: profile.validation,
    stall_detection: profile.stall_detection,
    output: profile.output,
    feature_matrix: profile.feature_matrix,
  };
}

process.stdout.write(`${JSON.stringify(printable(profile), null, 2)}\n`);
