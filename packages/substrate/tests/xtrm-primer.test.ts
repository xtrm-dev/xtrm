import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";

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

const IDENTITY_VARS = ["XTRM_DISPATCHER_NAME", "XTRM_DISPATCHER_ADDRESS", "SUBSTRATE_HOLDER"];

// XTRM-746: the CORE-2619 rule, verbatim. A drift in either direction fails here.
const RUN_IDENTITY =
  "- Run identity: a PR marker's run= takes the worker's own runtime session id — PI_SESSION_ID in Pi, the Claude session id in Claude — never XTRM_SESSION_ID or XTRM_PARENT_SESSION_ID, which are tmux session ids ($N) that every window in one tmux session shares (CORE-2619; the gh shim refuses a $N run=).";
const ALWAYS_ON_HEADING = "XTRM always-on rules (mirrored from the Pi primer's ALWAYS_ON; change both together).";

function run(home: string, cwd: string, extra: Record<string, string> = {}): { context: string; top: string | undefined; reason: unknown } {
  // The runner may itself be an xt worker; its identity must not leak into the case.
  const env: Record<string, string | undefined> = { ...process.env, HOME: home };
  for (const k of IDENTITY_VARS) delete env[k];
  const out = execFileSync("node", [ENTRY], { input: JSON.stringify({ source: "startup", cwd }), encoding: "utf8", cwd, env: { ...env, ...extra }, timeout: 30000 });
  const parsed = JSON.parse(out) as { additionalContext?: string; reason?: unknown; hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  return { context: parsed.hookSpecificOutput.additionalContext, top: parsed.additionalContext, reason: parsed.reason };
}

describe("SessionStart XTRM primer entry (XTRM-637)", () => {
  let home: string;
  let project: string;
  beforeEach(() => {
    home = tempDir("primer-home-");
    project = tempDir("primer-proj-");
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

  it("carries the mirrored run= rule verbatim, with no skill installed (XTRM-746)", () => {
    const { context } = run(home, project);
    assert.ok(context.includes(RUN_IDENTITY), "the CORE-2619 rule is mirrored byte for byte");
    assert.ok(context.includes(ALWAYS_ON_HEADING), "the block names its mirror so the next doctrine edit finds both vehicles");
  });

  it("drops only the skill that is missing", () => {
    install(home, "multiplexing", skill("multiplexing", [["Native first", "KEEP-native"]]));
    const { context } = run(home, project);
    assert.ok(context.includes("KEEP-native"));
    assert.ok(!context.includes("using-xtrm"), "a missing skill leaves no trace");
  });

  it("ships the always-on block when no global skill exists, and still exits 0", () => {
    const { context, top } = run(home, project);
    // XTRM-746: the always-on block is unconditional; only the skill excerpts
    // drop with the skill tree. A session without skills still learns run=.
    assert.ok(context.includes(RUN_IDENTITY), "run= doctrine ships without any skill");
    assert.ok(!context.includes("/using-xtrm:"), "a missing skill leaves no load hint");
    assert.equal(top, context, "top-level copy mirrors hookSpecificOutput");
  });

  it("names the dispatcher and the participant when xt exported them (CORE-2390)", () => {
    const { context } = run(home, project, {
      XTRM_DISPATCHER_NAME: "coord-a",
      XTRM_DISPATCHER_ADDRESS: "uds:/run/x/1.sock",
      SUBSTRATE_HOLDER: "worker-b",
    });
    assert.ok(context.startsWith("### Launch identity"), "identity comes first, even with no skill installed");
    assert.ok(context.includes("dispatched by coord-a (uds:/run/x/1.sock)"));
    assert.ok(context.includes("SendMessage to uds:/run/x/1.sock"), "reply goes to the exact address, not the display name");
    assert.ok(context.includes("participant is worker-b") && context.includes("--holder worker-b"));
  });

  it("omits each identity line whose variable is absent or blank", () => {
    const holderOnly = run(home, project, { SUBSTRATE_HOLDER: "worker-b", XTRM_DISPATCHER_NAME: "  " }).context;
    assert.ok(holderOnly.includes("participant is worker-b"));
    assert.ok(!holderOnly.includes("dispatched by"), "a blank dispatcher name is absent, not a line");
    const bare = run(home, project).context;
    assert.ok(bare.includes(RUN_IDENTITY), "the always-on block survives an identity-free session");
    assert.ok(!bare.includes("dispatched by") && !bare.includes("participant is"), "no identity lines when the variables are absent");
  });

  it("never reads the project copy of a skill (global load only)", () => {
    install(project, "using-xtrm", skill("using-xtrm", [["The system contract", "PROJECT-COPY"]]));
    const { context } = run(home, project);
    assert.ok(!context.includes("PROJECT-COPY"), "a project-vendored skill must not be injected");
    assert.ok(context.includes(RUN_IDENTITY), "the always-on block is not conditional on a skill");
  });
});
