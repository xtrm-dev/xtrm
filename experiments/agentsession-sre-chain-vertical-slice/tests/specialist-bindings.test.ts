import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { initRunDir, paths } from "../src/chain/store.ts";
import { loadBoundSpecialistProfile, saveSpecialistBindings } from "../src/specialists/bindings.ts";
import { resolveSreSpecialistBindings } from "../src/specialists/sre-team.ts";

async function writeCoordinator(repo: string): Promise<string> {
  const specialistDir = path.join(repo, ".specialists", "user");
  const skillDir = path.join(repo, ".xtrm", "skills", "coord");
  await fs.mkdir(specialistDir, { recursive: true });
  await fs.mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  await fs.writeFile(skillPath, "# coord skill\nv1\n");
  await fs.writeFile(
    path.join(specialistDir, "sre-coordinator.specialist.json"),
    JSON.stringify({
      specialist: {
        metadata: {
          name: "sre-coordinator",
          version: "1.0.0",
          description: "fixture coordinator",
          category: "sre-forensics",
        },
        execution: {
          model: "provider/model",
          permission_required: "LOW",
          auto_commit: "never",
        },
        prompt: { task_template: "$prompt" },
        skills: { paths: [".xtrm/skills/coord"] },
        mandatory_rules: { disable_default_globals: true },
      },
    }),
  );
  return skillPath;
}

async function makeRun() {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "svs-bind-"));
  const p = paths(state, "run-bind");
  await initRunDir(p);
  return p;
}

describe("frozen Specialist cognition bindings", () => {
  test("binding freezes JSON + resolved skill hashes", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "svs-bind-repo-"));
    await writeCoordinator(repo);
    const bindings = await resolveSreSpecialistBindings(repo, "auto");
    const binding = bindings["chain-coordinator"]!;
    expect(binding.sha256).toHaveLength(64);
    expect(binding.skills).toHaveLength(1);
    expect(binding.skills[0]!.sha256).toHaveLength(64);
  });

  test("resume-style load fails closed when a bound skill changes", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "svs-bind-repo-"));
    const skillPath = await writeCoordinator(repo);
    const bindings = await resolveSreSpecialistBindings(repo, "auto");
    const p = await makeRun();
    await saveSpecialistBindings(p, {
      schema_version: 1,
      mode: "auto",
      created_at: new Date().toISOString(),
      bindings,
    });

    const first = await loadBoundSpecialistProfile(p, repo, "chain-coordinator");
    expect(first?.name).toBe("sre-coordinator");

    await fs.writeFile(skillPath, "# coord skill\nv2 changed\n");
    await expect(
      loadBoundSpecialistProfile(p, repo, "chain-coordinator"),
    ).rejects.toThrow(/skill drift/);
  });
});
