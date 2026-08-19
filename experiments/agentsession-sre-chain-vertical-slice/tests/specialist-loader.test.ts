import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  assertSpecialistCompatible,
  compileSpecialistActivationProfile,
  findSpecialistJson,
  loadSpecialistFromRepo,
  loadSpecialistJson,
  renderInlineMandatoryRules,
  renderSpecialistSystemLayer,
  renderSpecialistTaskTemplate,
  SpecialistLoadError,
} from "../src/specialists/loader.ts";
import { SpecialistSchemaError } from "../src/specialists/schema.ts";

async function tempRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "svs-specialist-"));
}

function fullSpec(overrides: Record<string, unknown> = {}) {
  return {
    specialist: {
      metadata: {
        name: "fixture-specialist",
        version: "1.2.3",
        description: "full-shape fixture",
        category: "test",
        future_metadata: { preserved: true },
      },
      execution: {
        mode: "tool",
        model: "provider/model",
        fallback_model: "provider/fallback",
        fallback_models: ["provider/fallback-2", "provider/fallback"],
        timeout_ms: 321000,
        stall_timeout_ms: 123000,
        max_retries: 2,
        interactive: true,
        response_format: "json",
        output_type: "analysis",
        permission_required: "LOW",
        requires_worktree: false,
        bare: false,
        thinking_level: "high",
        auto_commit: "never",
        expected_output_keys: ["summary", "evidence"],
        extensions: { gitnexus: false, future_extension: "retain-me" },
        future_execution: 42,
      },
      prompt: {
        system: "You are the fixture cognition layer.",
        system_prompt_mode: "replace",
        task_template: "Incident=$prompt cwd=$cwd injected=$injected",
        output_schema: {
          type: "object",
          required: ["summary"],
          properties: { summary: { type: "string" } },
        },
      },
      skills: {
        paths: [".xtrm/skills/fixture"],
        scripts: [
          { path: "./scripts/preflight.sh", phase: "pre", inject_output: true },
        ],
      },
      capabilities: {
        required_tools: ["bash", "read"],
        external_commands: ["git", "docker"],
      },
      validation: {
        files_to_watch: ["compose.yml"],
        stale_threshold_days: 30,
      },
      stall_detection: {
        running_silence_warn_ms: 60000,
        waiting_auto_close_ms: null,
      },
      mandatory_rules: {
        template_sets: ["repo-hygiene"],
        disable_default_globals: false,
        inline_rules: [
          { id: "fixture-no-write", level: "error", text: "Do not mutate state." },
        ],
      },
      permissions: {
        LOW: { denied_natives_when_extension: ["write"], denied_natives_mode: "hard" },
      },
      output_file: ".specialists/fixture-result.md",
      notes_mode: "final-only",
      beads_integration: "auto",
      beads_write_notes: true,
      future_top_level: { retained: true },
      ...overrides,
    },
    future_document_field: "keep-me",
  };
}

async function writeFixtureRepo(spec = fullSpec()): Promise<{ repo: string; specPath: string }> {
  const repo = await tempRepo();
  const specDir = path.join(repo, ".specialists", "user");
  const skillDir = path.join(repo, ".xtrm", "skills", "fixture");
  await fs.mkdir(specDir, { recursive: true });
  await fs.mkdir(skillDir, { recursive: true });
  await fs.mkdir(path.join(repo, "scripts"), { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Fixture skill\nRead evidence before conclusions.\n");
  await fs.writeFile(path.join(repo, "scripts", "preflight.sh"), "#!/usr/bin/env bash\necho preflight\n");
  const specPath = path.join(specDir, "fixture-specialist.specialist.json");
  await fs.writeFile(specPath, JSON.stringify(spec, null, 2));
  return { repo, specPath };
}

describe("full Specialist JSON loader", () => {
  test("Zod validates the full shape while preserving future fields", async () => {
    const { specPath } = await writeFixtureRepo();
    const loaded = await loadSpecialistJson(specPath);
    expect((loaded.raw as any).future_document_field).toBe("keep-me");
    expect((loaded.document as any).future_document_field).toBe("keep-me");
    expect((loaded.document.specialist as any).future_top_level.retained).toBe(true);
    expect((loaded.document.specialist.execution as any).future_execution).toBe(42);
    expect(loaded.source.sha256).toHaveLength(64);
  });

  test("schema errors are structural and path-addressed", async () => {
    const { specPath } = await writeFixtureRepo({
      specialist: {
        ...fullSpec().specialist,
        metadata: { ...(fullSpec().specialist as any).metadata, name: "NOT VALID" },
      },
    } as any);
    await expect(loadSpecialistJson(specPath)).rejects.toBeInstanceOf(SpecialistSchemaError);
  });

  test("repo resolver prefers .specialists/user over package fallback", async () => {
    const repo = await tempRepo();
    const user = path.join(repo, ".specialists", "user");
    const pkg = path.join(repo, "config", "specialists");
    await fs.mkdir(user, { recursive: true });
    await fs.mkdir(pkg, { recursive: true });
    await fs.writeFile(path.join(user, "fixture-specialist.specialist.json"), JSON.stringify(fullSpec()));
    await fs.writeFile(path.join(pkg, "fixture-specialist.specialist.json"), JSON.stringify(fullSpec()));
    expect(await findSpecialistJson(repo, "fixture-specialist")).toBe(
      path.join(user, "fixture-specialist.specialist.json"),
    );
  });

  test("compiler resolves + fingerprints skills and normalizes legacy script.path", async () => {
    const { repo } = await writeFixtureRepo();
    const loaded = await loadSpecialistFromRepo(repo, "fixture-specialist");
    const profile = await compileSpecialistActivationProfile(loaded, { targetRepo: repo });
    expect(profile.skills).toHaveLength(1);
    expect(profile.skills[0]!.name).toBe("fixture");
    expect(profile.skills[0]!.sha256).toHaveLength(64);
    expect(profile.scripts[0]).toMatchObject({
      run: "./scripts/preflight.sh",
      phase: "pre",
      inject_output: true,
      legacy_path_field: true,
    });
    expect(profile.execution.fallback_models).toEqual([
      "provider/fallback",
      "provider/fallback-2",
    ]);
    expect(profile.full_specialist).toHaveProperty("future_top_level");
  });

  test("missing declared skills fail closed by default", async () => {
    const spec = fullSpec();
    (spec.specialist.skills as any).paths = ["missing/SKILL.md"];
    const { repo } = await writeFixtureRepo(spec);
    const loaded = await loadSpecialistFromRepo(repo, "fixture-specialist");
    await expect(
      compileSpecialistActivationProfile(loaded, { targetRepo: repo }),
    ).rejects.toBeInstanceOf(SpecialistLoadError);
  });

  test("feature matrix never silently enables host scripts or canonical mandatory sets", async () => {
    const { repo } = await writeFixtureRepo();
    const loaded = await loadSpecialistFromRepo(repo, "fixture-specialist");
    const profile = await compileSpecialistActivationProfile(loaded, { targetRepo: repo });
    expect(profile.feature_matrix.find((x) => x.feature === "skills.scripts")?.disposition).toBe("deferred");
    expect(
      profile.feature_matrix.find((x) => x.feature === "mandatory_rules.template_sets/default globals")?.disposition,
    ).toBe("deferred");
    expect(renderInlineMandatoryRules(profile)).toContain("fixture-no-write");
  });

  test("write-capable or auto-commit Specialist cannot self-upgrade this read-only harness", async () => {
    for (const executionPatch of [
      { permission_required: "HIGH" },
      { auto_commit: "checkpoint_on_terminal" },
    ]) {
      const spec = fullSpec();
      spec.specialist.execution = { ...spec.specialist.execution, ...executionPatch } as any;
      const { repo } = await writeFixtureRepo(spec);
      const loaded = await loadSpecialistFromRepo(repo, "fixture-specialist");
      const profile = await compileSpecialistActivationProfile(loaded, { targetRepo: repo });
      expect(() => assertSpecialistCompatible(profile)).toThrow(/rejected by this runtime/);
    }
  });

  test("task rendering is one-pass: injected variables are data, not template source", async () => {
    const { repo } = await writeFixtureRepo();
    const loaded = await loadSpecialistFromRepo(repo, "fixture-specialist");
    const profile = await compileSpecialistActivationProfile(loaded, { targetRepo: repo });
    const rendered = renderSpecialistTaskTemplate(profile, {
      prompt: "literal $cwd must stay literal",
      cwd: "/repo",
      injected: "ok",
    });
    expect(rendered).toBe("Incident=literal $cwd must stay literal cwd=/repo injected=ok");
  });

  test("system layer keeps Pi/XTRM authority outside specialist system_prompt_mode=replace", async () => {
    const { repo } = await writeFixtureRepo();
    const loaded = await loadSpecialistFromRepo(repo, "fixture-specialist");
    const profile = await compileSpecialistActivationProfile(loaded, { targetRepo: repo });
    const rendered = renderSpecialistSystemLayer(profile, "CHAIN DOCTRINE", "ROLE OVERLAY");
    expect(rendered).toContain("CHAIN DOCTRINE");
    expect(rendered).toContain("You are the fixture cognition layer.");
    expect(rendered).toContain("Fixture skill");
    expect(rendered).toContain("ROLE OVERLAY");
    expect(rendered).toContain("you are NOT the workflow scheduler");
    expect(rendered).toContain("AgentSession end is not step satisfaction");
  });
});
