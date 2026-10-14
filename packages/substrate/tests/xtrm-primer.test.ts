import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// XTRM-637: the matcher-free primer entry injects a condensed excerpt of the
// GLOBAL using-xtrm and multiplexing skills, ignores any project copy, and
// degrades to no context (exit 0) when a skill, section or home is missing.
// End-to-end through the real xtrm-primer.mjs with a scratch HOME.

const ENTRY = join(import.meta.dirname, "..", "plugin", "substrate", "scripts", "xtrm-primer.mjs");

function skill(name: string, sections: Array<[string, string]>): string {
  const body = sections.map(([h, t]) => `## ${h}\n\n${t}`).join("\n\n");
  return `---\nname: ${name}\ndescription: FRONTMATTER-${name}\n---\n\n# Title ${name}\n\nPREAMBLE-${name}\n\n${body}\n`;
}

function install(home: string, name: string, text: string): void {
  const dir = join(home, ".xtrm", "skills", "default", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), text);
}

function run(home: string, cwd: string): { context: string; top: string | undefined; reason: unknown } {
  const out = execFileSync("node", [ENTRY], { input: JSON.stringify({ source: "startup", cwd }), encoding: "utf8", cwd, env: { ...process.env, HOME: home }, timeout: 30000 });
  const parsed = JSON.parse(out) as { additionalContext?: string; reason?: unknown; hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  return { context: parsed.hookSpecificOutput.additionalContext, top: parsed.additionalContext, reason: parsed.reason };
}

describe("SessionStart XTRM primer entry (XTRM-637)", () => {
  let home: string;
  let project: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "primer-home-"));
    project = mkdtempSync(join(tmpdir(), "primer-proj-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });

  it("injects the preamble and the named sections of both global skills, nothing else", () => {
    install(home, "using-xtrm", skill("using-xtrm", [["The system contract", "KEEP-contract"], ["Runtime enforcement", "DROP-enforcement"], ["Completion rule", "KEEP-completion"]]));
    install(home, "multiplexing", skill("multiplexing", [["Native first", "KEEP-native"], ["Messaging semantics", "DROP-messaging"], ["Failure rules", "KEEP-failure"], ["Durable work is separate from transport", "KEEP-durable"]]));
    const { context, top, reason } = run(home, project);
    for (const s of ["PREAMBLE-using-xtrm", "KEEP-contract", "KEEP-completion", "PREAMBLE-multiplexing", "KEEP-native", "KEEP-durable", "KEEP-failure"]) {
      assert.ok(context.includes(s), `primer must contain ${s}`);
    }
    for (const s of ["DROP-enforcement", "DROP-messaging", "FRONTMATTER", "Title using-xtrm"]) {
      assert.ok(!context.includes(s), `primer must not contain ${s}`);
    }
    assert.ok(context.includes("/using-xtrm:") && context.includes("/multiplexing:"), "primer must say when to load each full skill");
    assert.equal(top, context, "top-level copy mirrors hookSpecificOutput");
    assert.equal(reason, undefined, "reason must be omitted, never null");
  });

  it("drops only the skill that is missing", () => {
    install(home, "multiplexing", skill("multiplexing", [["Native first", "KEEP-native"]]));
    const { context } = run(home, project);
    assert.ok(context.includes("KEEP-native"));
    assert.ok(!context.includes("using-xtrm"), "a missing skill leaves no trace");
  });

  it("emits no context when no global skill exists, and still exits 0", () => {
    const { context, top } = run(home, project);
    assert.equal(context, "");
    assert.equal(top, undefined);
  });

  it("never reads the project copy of a skill (global load only)", () => {
    install(project, "using-xtrm", skill("using-xtrm", [["The system contract", "PROJECT-COPY"]]));
    const { context } = run(home, project);
    assert.equal(context, "", "a project-vendored skill must not be injected when the global one is absent");
  });
});
