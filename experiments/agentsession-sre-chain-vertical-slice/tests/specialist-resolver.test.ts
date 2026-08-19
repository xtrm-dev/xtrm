import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { compileFromEffectiveResolver } from "../src/specialists/resolver.ts";

async function repoWithSkill(): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "svs-resolver-"));
  const skill = path.join(repo, ".xtrm", "skills", "resolved");
  await fs.mkdir(skill, { recursive: true });
  await fs.writeFile(path.join(skill, "SKILL.md"), "# Resolved skill\n");
  return repo;
}

function effectiveSpec() {
  return {
    specialist: {
      metadata: {
        name: "resolved-specialist",
        version: "2.0.0",
        description: "already merged by upstream SpecialistLoader",
        category: "test",
      },
      execution: {
        model: "provider/model",
        permission_required: "LOW",
        auto_commit: "never",
      },
      prompt: {
        task_template: "$prompt",
      },
      skills: {
        paths: [".xtrm/skills/resolved"],
      },
      capabilities: {
        required_tools: ["read"],
      },
      mandatory_rules: {
        disable_default_globals: true,
      },
    },
  };
}

describe("effective Specialist resolver seam", () => {
  test("accepts a SpecialistLoader-compatible get(name) provider and fingerprints effective content", async () => {
    const repo = await repoWithSkill();
    const resolver = {
      async get(name: string) {
        expect(name).toBe("resolved-specialist");
        return effectiveSpec();
      },
    };
    const profile = await compileFromEffectiveResolver(
      resolver,
      {
        resolver: "@jaggerxtrm/specialists/lib:SpecialistLoader",
        specialist_name: "resolved-specialist",
        source_hint: "<effective-specialists-loader>",
      },
      { targetRepo: repo },
    );
    expect(profile.name).toBe("resolved-specialist");
    expect(profile.source.sha256).toHaveLength(64);
    expect(profile.skills[0]!.name).toBe("resolved");
  });

  test("effective digest is stable across object key ordering", async () => {
    const repo = await repoWithSkill();
    const a = effectiveSpec();
    const b = {
      specialist: {
        mandatory_rules: { disable_default_globals: true },
        capabilities: { required_tools: ["read"] },
        skills: { paths: [".xtrm/skills/resolved"] },
        prompt: { task_template: "$prompt" },
        execution: { auto_commit: "never", permission_required: "LOW", model: "provider/model" },
        metadata: {
          category: "test",
          description: "already merged by upstream SpecialistLoader",
          version: "2.0.0",
          name: "resolved-specialist",
        },
      },
    };
    const pa = await compileFromEffectiveResolver(
      { get: async () => a },
      { resolver: "fixture", specialist_name: "resolved-specialist" },
      { targetRepo: repo },
    );
    const pb = await compileFromEffectiveResolver(
      { get: async () => b },
      { resolver: "fixture", specialist_name: "resolved-specialist" },
      { targetRepo: repo },
    );
    expect(pa.source.sha256).toBe(pb.source.sha256);
  });
});
