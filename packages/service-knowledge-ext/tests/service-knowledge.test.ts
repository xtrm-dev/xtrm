import { describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The Pi host provides typebox at runtime; unused by this extension but kept for
// parity with the other extension tests' module mocks.
mock.module("typebox", () => ({
  Type: {
    Object: (shape: unknown) => ({ kind: "object", shape }),
    String: (opts: unknown) => ({ kind: "string", opts }),
    Boolean: (opts: unknown) => ({ kind: "boolean", opts }),
    Optional: (t: unknown) => ({ kind: "optional", t }),
  },
}));

const extension = await import("../index.ts");

function tmpBase() {
  const dir = mkdtempSync(join("/tmp", "pi-sk-ext-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Write a canonical service-knowledge registry: .xtrm/skills/<pack>/service-knowledge/. */
function writeRegistry(packDir: string, services: Record<string, Record<string, unknown>>) {
  const umbrella = join(packDir, "service-knowledge");
  mkdirSync(umbrella, { recursive: true });
  writeFileSync(join(umbrella, "service-registry.json"), JSON.stringify({ services }, null, 2));
  return umbrella;
}

/** The canonical service registry location the extension must find (xtrm-6z6.1). */
function canonicalPackDir(cwd: string, pack: string) {
  return join(cwd, ".xtrm", "skills", pack);
}

function fakePi() {
  const commands: any[] = [];
  const listeners = new Map<string, Array<(event: any, ctx: any) => Promise<void>>>();
  return {
    registerCommand(name: string, def: any) {
      commands.push({ name, ...def });
    },
    on(event: string, cb: (event: any, ctx: any) => Promise<void>) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    },
    commands,
    listeners,
  };
}

describe("service-knowledge ext v1 (xtrm-6z6.1)", () => {
  test("self-gating: no registry anywhere → zero surface (no command, no handlers)", () => {
    const fx = tmpBase();
    try {
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      expect(pi.commands).toHaveLength(0);
      expect(pi.listeners.size).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("findUmbrellaPacks: canonical .xtrm/skills/<pack>/service-knowledge layout is found", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db" } });
      const packs = extension.findUmbrellaPacks(fx.dir);
      expect(packs).toHaveLength(1);
      expect(packs[0].umbrellaName).toBe("service-knowledge");
      expect(packs[0].registryPath).toContain(".xtrm/skills/infra/service-knowledge/service-registry.json");
    } finally {
      fx.cleanup();
    }
  });

  test("findUmbrellaPacks: NEW service-knowledge wins over LEGACY service-skills per pack", () => {
    const fx = tmpBase();
    try {
      const pack = canonicalPackDir(fx.dir, "infra");
      // Legacy umbrella first.
      const legacy = join(pack, "service-skills");
      mkdirSync(legacy, { recursive: true });
      writeFileSync(join(legacy, "service-registry.json"), JSON.stringify({ services: { a: {} } }));
      // New umbrella wins when present.
      writeRegistry(pack, { "db-expert": { description: "db" } });
      const packs = extension.findUmbrellaPacks(fx.dir);
      expect(packs).toHaveLength(1);
      expect(packs[0].umbrellaName).toBe("service-knowledge");
      expect(packs[0].registryPath).toContain("service-knowledge");
    } finally {
      fx.cleanup();
    }
  });

  test("findUmbrellaPacks: reserved pack names are skipped", () => {
    const fx = tmpBase();
    try {
      // 'default' is reserved — must not be treated as a service pack.
      writeRegistry(canonicalPackDir(fx.dir, "default"), { x: {} });
      const packs = extension.findUmbrellaPacks(fx.dir);
      expect(packs).toHaveLength(0);
    } finally {
      fx.cleanup();
    }
  });

  test("findUmbrellaPacks: user/packs root is scanned too", () => {
    const fx = tmpBase();
    try {
      const userPack = join(fx.dir, ".xtrm", "skills", "user", "packs", "team-a");
      writeRegistry(userPack, { svc: {} });
      const packs = extension.findUmbrellaPacks(fx.dir);
      expect(packs).toHaveLength(1);
      expect(packs[0].packDir).toContain("user/packs/team-a");
    } finally {
      fx.cleanup();
    }
  });

  test("layout validation: exact mercury/infra canonical shape is found", () => {
    const fx = tmpBase();
    try {
      // .xtrm/skills/infra/service-knowledge/service-registry.json (mercury/infra).
      const umb = join(fx.dir, ".xtrm", "skills", "infra", "service-knowledge");
      mkdirSync(umb, { recursive: true });
      writeFileSync(join(umb, "service-registry.json"), JSON.stringify({ services: { "db-expert": { description: "db" } } }));
      const packs = extension.findUmbrellaPacks(fx.dir);
      expect(packs).toHaveLength(1);
      expect(packs[0].umbrellaName).toBe("service-knowledge");
      expect(packs[0].registryPath).toBe(join(umb, "service-registry.json"));
      expect(packs[0].packDir.endsWith(join(".xtrm", "skills", "infra"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("layout validation: legacy .claude/skills/service-skills is deliberately NOT found", () => {
    const fx = tmpBase();
    try {
      mkdirSync(join(fx.dir, ".claude", "skills", "service-skills"), { recursive: true });
      writeFileSync(join(fx.dir, ".claude", "skills", "service-skills", "service-registry.json"), JSON.stringify({ services: {} }));
      // The canonical resolver does not fall back to .claude/skills — that was
      // the stale ext's behavior and is deliberately dropped.
      expect(extension.findUmbrellaPacks(fx.dir)).toHaveLength(0);
    } finally {
      fx.cleanup();
    }
  });

  test("registry present → registers command + before_agent_start handler", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db", last_sync_ref: "abc12345" } });
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      expect(pi.commands).toHaveLength(1);
      expect(pi.commands[0].name).toBe("service-knowledge:status");
      expect(pi.listeners.has("before_agent_start")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("before_agent_start emits a context note with service count + drift state", async () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db" } });
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      const handler = pi.listeners.get("before_agent_start")![0];
      const result = await handler({}, { cwd: fx.dir });
      expect(result?.message?.content).toContain("1 pack(s), 1 service(s)");
      expect(result?.message?.content).toContain("drift: none detected");
      // Drift marker present flips the notice.
      mkdirSync(join(fx.dir, ".xtrm"), { recursive: true });
      writeFileSync(join(fx.dir, ".xtrm", ".service-knowledge-drift-pending"), "drift");
      const result2 = await handler({}, { cwd: fx.dir });
      expect(result2?.message?.content).toContain("drift: PENDING marker present");
    } finally {
      fx.cleanup();
    }
  });

  test("drift marker: legacy service-skills marker name is detected (xtrm-6z6.2)", async () => {
    const fx = tmpBase();
    try {
      mkdirSync(join(fx.dir, ".xtrm"), { recursive: true });
      writeFileSync(join(fx.dir, ".xtrm", ".service-skills-drift-pending"), "legacy drift");
      expect(extension.hasDriftMarker(fx.dir)).toBe(true);
      expect(extension.driftMarkerPath(fx.dir)).toBe(".xtrm/.service-skills-drift-pending");
    } finally {
      fx.cleanup();
    }
  });

  test("drift marker: canonical name wins when both are present (xtrm-6z6.2)", async () => {
    const fx = tmpBase();
    try {
      mkdirSync(join(fx.dir, ".xtrm"), { recursive: true });
      writeFileSync(join(fx.dir, ".xtrm", ".service-skills-drift-pending"), "legacy");
      writeFileSync(join(fx.dir, ".xtrm", ".service-knowledge-drift-pending"), "new");
      expect(extension.hasDriftMarker(fx.dir)).toBe(true);
      expect(extension.driftMarkerPath(fx.dir)).toBe(".xtrm/.service-knowledge-drift-pending");
    } finally {
      fx.cleanup();
    }
  });

  test("drift marker: absent when neither marker exists", () => {
    const fx = tmpBase();
    try {
      expect(extension.hasDriftMarker(fx.dir)).toBe(false);
      expect(extension.driftMarkerPath(fx.dir)).toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  test("status command golden: services, last_sync_ref vs HEAD, marker, suggested action", async () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), {
        "db-expert": { description: "db", last_sync_ref: "0000000" }, // deliberately != HEAD
        "auth-svc": { description: "auth" }, // never synced
      });
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      const cmd = pi.commands[0];
      const notifications: string[] = [];
      const ctx = { cwd: fx.dir, ui: { notify: (m: string) => notifications.push(m) } };
      await cmd.handler("", ctx);
      const out = notifications.join("\n");
      expect(out).toContain("service-knowledge status");
      expect(out).toContain("db-expert: last_sync_ref 0000000");
      expect(out).toContain("auth-svc: last_sync_ref (never)");
      expect(out).toContain("git HEAD:");
      expect(out).toContain("drift marker: absent");
      expect(out).toContain("suggested action: run /updating-service-knowledge");
    } finally {
      fx.cleanup();
    }
  });

  test("status command reports a legacy drift marker as PRESENT with its path (xtrm-6z6.2)", async () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db", last_sync_ref: "0000000" } });
      mkdirSync(join(fx.dir, ".xtrm"), { recursive: true });
      writeFileSync(join(fx.dir, ".xtrm", ".service-skills-drift-pending"), "legacy drift");
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      const cmd = pi.commands[0];
      const notifications: string[] = [];
      const ctx = { cwd: fx.dir, ui: { notify: (m: string) => notifications.push(m) } };
      await cmd.handler("", ctx);
      const out = notifications.join("\n");
      expect(out).toContain("drift marker: PRESENT (.xtrm/.service-skills-drift-pending)");
      expect(out).toContain("suggested action: run /updating-service-knowledge");
    } finally {
      fx.cleanup();
    }
  });

  test("status command: no drift when every service matches HEAD", async () => {
    const fx = tmpBase();
    try {
      // No last_sync_ref at all + no marker → nothing to reconcile.
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db" } });
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      const cmd = pi.commands[0];
      const notifications: string[] = [];
      const ctx = { cwd: fx.dir, ui: { notify: (m: string) => notifications.push(m) } };
      await cmd.handler("", ctx);
      const out = notifications.join("\n");
      expect(out).toContain("suggested action: none — registry is in sync with HEAD");
    } finally {
      fx.cleanup();
    }
  });

  test("status command: in-sync refs (7-char, matching git HEAD short sha) are NOT flagged (xtrm-vs7f8)", async () => {
    const fx = tmpBase();
    try {
      // Point the command's cwd at the real core repo so gitHead resolves, and
      // give a service a last_sync_ref equal to the current HEAD short sha.
      const coreRoot = join(import.meta.dir, "../../..");
      const head = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: coreRoot, encoding: "utf8" }).trim();
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db", last_sync_ref: head } });
      const pi = fakePi();
      extension.default(pi as any, { cwd: fx.dir });
      const cmd = pi.commands[0];
      const notifications: string[] = [];
      const ctx = { cwd: coreRoot, ui: { notify: (m: string) => notifications.push(m) } };
      await cmd.handler("", ctx);
      const out = notifications.join("\n");
      expect(out).toContain(`db-expert: last_sync_ref ${head}`);
      expect(out).toContain("suggested action: none — registry is in sync with HEAD");
    } finally {
      fx.cleanup();
    }
  });
});

/**
 * CORE-2714 — tool surface at parity with the Python MCP server.
 *
 * The definitions are generated from the Python single source of truth
 * (`service-knowledge mcp specs --json`) and pinned by a pytest on the Python side. These tests
 * assert the extension renders exactly that set — bare names, unchanged schemas, unchanged
 * descriptions — and that a hostile environment cannot redirect a read.
 */
const COMMITTED = JSON.parse(readFileSync(join(import.meta.dir, "..", "tool-definitions.json"), "utf8"));

function toolsPi() {
  const base = fakePi();
  const tools: any[] = [];
  return {
    ...base,
    registerTool(tool: any) {
      tools.push(tool);
    },
    tools,
  };
}

describe("service-knowledge ext v1.1 tool surface (CORE-2714)", () => {
  test("registers exactly the committed tool names, in order", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db" } });
      const pi = toolsPi();
      extension.default(pi as any, { cwd: fx.dir });
      expect(pi.tools.map((t: any) => t.name)).toEqual(COMMITTED.tools.map((s: any) => s.name));
    } finally {
      fx.cleanup();
    }
  });

  test("every registered schema and description equals the committed definition", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db" } });
      const pi = toolsPi();
      extension.default(pi as any, { cwd: fx.dir });
      for (const spec of COMMITTED.tools) {
        const tool = pi.tools.find((t: any) => t.name === spec.name);
        expect(tool, spec.name).toBeDefined();
        expect(tool.description, spec.name).toBe(spec.description);
        expect({ type: "object", ...tool.parameters }, spec.name).toEqual({
          type: "object",
          ...spec.parameters,
        });
      }
    } finally {
      fx.cleanup();
    }
  });

  test("zero surface still means zero tools when no registry exists", () => {
    const fx = tmpBase();
    try {
      const pi = toolsPi();
      extension.default(pi as any, { cwd: fx.dir });
      expect(pi.tools).toHaveLength(0);
      expect(pi.commands).toHaveLength(0);
      expect(pi.listeners.size).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("tools carry the read-only annotation", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db" } });
      const pi = toolsPi();
      extension.default(pi as any, { cwd: fx.dir });
      for (const tool of pi.tools) {
        expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
      }
    } finally {
      fx.cleanup();
    }
  });

  test("a tool name another extension already holds is skipped, never thrown", () => {
    // A flat pi namespace is shared; colliding must fail open (advisor ruling, CORE-2714).
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db" } });
      const pi = toolsPi();
      (pi as any).getAllTools = () => [{ name: "knowledge_search" }];
      const notices: string[] = [];
      (pi as any).ui = { notify: (m: string) => notices.push(m) };
      expect(() => extension.default(pi as any, { cwd: fx.dir })).not.toThrow();
      const names = pi.tools.map((t: any) => t.name);
      expect(names).not.toContain("knowledge_search");
      expect(names).toEqual(
        COMMITTED.tools.map((s: any) => s.name).filter((n: string) => n !== "knowledge_search"),
      );
      expect(notices.join("\n")).toContain("knowledge_search");
    } finally {
      fx.cleanup();
    }
  });

  test("a host without registerTool still gets command + context note", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db" } });
      const pi = fakePi(); // pre-1.4 host shape: no registerTool
      expect(() => extension.default(pi as any, { cwd: fx.dir })).not.toThrow();
      expect(pi.commands).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });

  test("the context note names the five tools", async () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), { "db-expert": { description: "db" } });
      const pi = toolsPi();
      extension.default(pi as any, { cwd: fx.dir });
      const handler = pi.listeners.get("before_agent_start")![0];
      const result = await handler({}, { cwd: fx.dir });
      for (const name of COMMITTED.tools.map((s: any) => s.name)) {
        expect(result?.message?.content).toContain(name);
      }
    } finally {
      fx.cleanup();
    }
  });

  test("resolveSessionRoot returns the git toplevel, not the worktree", () => {
    const fx = tmpBase();
    try {
      const repo = join(fx.dir, "repo");
      mkdirSync(join(repo, ".xtrm", "worktrees", "feature"), { recursive: true });
      execFileSync("git", ["init", "-q"], { cwd: repo });
      const worktree = join(repo, ".xtrm", "worktrees", "feature");
      expect(extension.resolveSessionRoot(worktree)).toBe(
        execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repo, encoding: "utf8" }).trim(),
      );
    } finally {
      fx.cleanup();
    }
  });

  test("resolveSessionRoot falls back to the cwd outside a git repo", () => {
    const fx = tmpBase();
    try {
      expect(extension.resolveSessionRoot(fx.dir)).toBe(fx.dir);
    } finally {
      fx.cleanup();
    }
  });

  test("callTool reports a missing CLI as a named error result, never a throw", async () => {
    // PATH must be genuinely empty of the CLI: CI installs service-knowledge so the suite can
    // exercise parity, which would otherwise make this test pass or fail on the host's PATH
    // rather than on the behaviour it names.
    const fx = tmpBase();
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = fx.dir; // an empty directory: nothing resolves there
      const result = await extension.callTool("knowledge_search", { query: "x" }, fx.dir);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("knowledge_search");
      expect(result.content[0].text).toContain("install.sh");
    } finally {
      process.env.PATH = originalPath;
      fx.cleanup();
    }
  });

  test("callTool honours the abort signal (sync execFileSync silently ignored it)", async () => {
    // A stale index rebuild holds the CLI for up to the 90 s gate budget. With execFileSync the
    // signal was a no-op: the session froze and Esc did nothing. Assert the call rejects quickly.
    const fx = tmpBase();
    const originalPath = process.env.PATH;
    try {
      const bin = join(fx.dir, "bin");
      mkdirSync(bin, { recursive: true });
      const stub = join(bin, "service-knowledge");
      // Absolute /bin/sleep: PATH is stubbed to `bin`, so a bare `sleep` would not resolve and
      // the stub would exit at once -- the test would then pass without exercising the signal.
      writeFileSync(stub, "#!/bin/sh\n/bin/sleep 10\n");
      execFileSync("chmod", ["+x", stub]);
      process.env.PATH = bin;
      const controller = new AbortController();
      const started = Date.now();
      setTimeout(() => controller.abort(), 100);
      const result = await extension.callTool("knowledge_search", { query: "x" }, fx.dir, controller.signal);
      const elapsed = Date.now() - started;
      expect(result.isError).toBe(true);
      expect(elapsed).toBeLessThan(3000); // would be ~10000 ms if the signal were ignored
      // Name the CAUSE, not just the timing. Without this, a stub whose /bin/sleep is missing
      // exits 127 at once, isError is true, and the test passes without ever exercising the
      // signal (verified against the reviewer's mutation).
      expect(result.content[0].text).toMatch(/abort/i);
    } finally {
      process.env.PATH = originalPath;
      fx.cleanup();
    }
  });

  test("callTool names a CLI that rejects the mcp subcommand", async () => {
    // The 0.8.0 CLI has no `mcp` verb. That must read as an actionable error, not as empty tools.
    const fx = tmpBase();
    const originalPath = process.env.PATH;
    try {
      const bin = join(fx.dir, "bin");
      mkdirSync(bin, { recursive: true });
      const stub = join(bin, "service-knowledge");
      writeFileSync(stub, "#!/bin/sh\necho \"invalid choice: 'mcp'\" >&2\nexit 2\n");
      execFileSync("chmod", ["+x", stub]);
      process.env.PATH = bin;
      const result = await extension.callTool("knowledge_search", { query: "x" }, fx.dir);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("invalid choice");
    } finally {
      process.env.PATH = originalPath;
      fx.cleanup();
    }
  });
});

describe("service-knowledge ext v1.2 path nudge (XTRM-997)", () => {
  const REGISTRY = {
    "api": { description: "API service", territory: ["api/**/*.py", "api/app.py"] },
    "web": { description: "Web service", territory: ["web/src/**"] },
    "blue": { description: "Single-file service", territory: ["blue?.py"] },
  };

  function nudgePi() {
    return { pi: toolsPi() };
  }

  test("territoryMatch mirrors the Python matcher, including its broad-prefix behaviour", () => {
    // Expectations here were produced by running skill_activator.match_territory on the same
    // table; the two must answer identically or the plugin nudges a different service than the
    // Python activator gates.
    const fx = tmpBase();
    try {
      expect(extension.territoryMatch("api/app.py", ["api/app.py"], fx.dir)).toBe(true);
      expect(extension.territoryMatch("api/app.py", ["api/**/*.py"], fx.dir)).toBe(true);
      expect(extension.territoryMatch("api/nested/deep.py", ["api/**/*.py"], fx.dir)).toBe(true);
      // A directory-prefix pattern claims everything below it, exactly as Python does.
      expect(extension.territoryMatch("api/app.txt", ["api/**/*.py"], fx.dir)).toBe(true);
      expect(extension.territoryMatch("web/src/ui/App.tsx", ["web/src/**"], fx.dir)).toBe(true);
      // Python checks the suffix against the whole path when the prefix does not match.
      expect(extension.territoryMatch("other/app.py", ["api/**/*.py"], fx.dir)).toBe(true);
      expect(extension.territoryMatch("other/app.txt", ["api/**/*.py"], fx.dir)).toBe(false);
      expect(extension.territoryMatch("blue1.py", ["blue?.py"], fx.dir)).toBe(true);
      expect(extension.territoryMatch("blue12.py", ["blue?.py"], fx.dir)).toBe(false);
      expect(extension.territoryMatch("README.md", ["api/app.py"], fx.dir)).toBe(false);
      expect(extension.territoryMatch("api/app.py", [], fx.dir)).toBe(false);
      // A registry entry with no territory, or a malformed one, never throws.
      expect(extension.territoryMatch("api/app.py", undefined, fx.dir)).toBe(false);
      expect(extension.territoryMatch("api/app.py", [42], fx.dir)).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("territoryMatch: an absolute path inside the session root is made relative first", () => {
    const fx = tmpBase();
    try {
      expect(extension.territoryMatch(join(fx.dir, "api", "app.py"), ["api/app.py"], fx.dir)).toBe(true);
      expect(extension.territoryMatch("/elsewhere/api/app.py", ["api/app.py"], fx.dir)).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("nudgeForToolCall names the next knowledge call for an owned path", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), REGISTRY);
      const packs = extension.findUmbrellaPacks(fx.dir);
      const seen = new Set<string>();
      const message = extension.nudgeForToolCall(fx.dir, packs, "read", { path: "api/app.py" }, seen);
      expect(message).toContain("api");
      expect(message).toContain("knowledge_evidence_for_files");
      expect(message).toContain("knowledge_get");
      // Exact shape, shared with the Claude plugin hook: owner, then the exact next call.
      expect(message).toBe(
        '[service-knowledge] api owns api/app.py. Next: knowledge_evidence_for_files {"paths":["api/app.py"]}, or knowledge_get api.',
      );
      expect(seen.has("api")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("nudgeForToolCall is once per service per session", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), REGISTRY);
      const packs = extension.findUmbrellaPacks(fx.dir);
      const seen = new Set<string>();
      expect(extension.nudgeForToolCall(fx.dir, packs, "read", { path: "api/app.py" }, seen)).not.toBeNull();
      expect(extension.nudgeForToolCall(fx.dir, packs, "read", { path: "api/other.py" }, seen)).toBeNull();
      // A different service is still nudged once.
      expect(extension.nudgeForToolCall(fx.dir, packs, "read", { path: "web/src/a.ts" }, seen)).toContain("web");
    } finally {
      fx.cleanup();
    }
  });

  test("nudgeForToolCall stays silent for unowned paths and unhooked tools", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), REGISTRY);
      const packs = extension.findUmbrellaPacks(fx.dir);
      const seen = new Set<string>();
      expect(extension.nudgeForToolCall(fx.dir, packs, "read", { path: "README.md" }, seen)).toBeNull();
      expect(extension.nudgeForToolCall(fx.dir, packs, "edit", { path: "api/app.py" }, seen)).toBeNull();
      expect(extension.nudgeForToolCall(fx.dir, packs, "write", { path: "api/app.py" }, seen)).toBeNull();
      expect(seen.size).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("nudgeForToolCall reads a file path out of a shell read command only", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), REGISTRY);
      const packs = extension.findUmbrellaPacks(fx.dir);
      expect(
        extension.nudgeForToolCall(fx.dir, packs, "bash", { command: "sed -n '1,40p' api/app.py" }, new Set()),
      ).toContain("api");
      // Not a read: a mutating or VCS command must not trigger the nudge.
      expect(extension.nudgeForToolCall(fx.dir, packs, "bash", { command: "git status" }, new Set())).toBeNull();
      expect(extension.nudgeForToolCall(fx.dir, packs, "bash", { command: "rm -f api/app.py" }, new Set())).toBeNull();
      // A sed script is not a path; only the file argument is.
      expect(extension.nudgePaths("bash", { command: "sed -n 1,5p api/app.py" })).toEqual(["api/app.py"]);
      expect(extension.nudgePaths("bash", { command: "sed -i s/a/b/g api/app.py" })).toEqual(["api/app.py"]);
      expect(extension.nudgePaths("bash", { command: "sed -n 1,5p" })).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("nudgeForToolCall adds the drift hint when a pending marker exists", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), REGISTRY);
      mkdirSync(join(fx.dir, ".xtrm"), { recursive: true });
      writeFileSync(join(fx.dir, ".xtrm", ".service-knowledge-drift-pending"), "");
      const packs = extension.findUmbrellaPacks(fx.dir);
      expect(extension.nudgeForToolCall(fx.dir, packs, "read", { path: "api/app.py" }, new Set())).toContain(
        "knowledge_drift",
      );
    } finally {
      fx.cleanup();
    }
  });

  test("territoryScore ranks an exact path above a file family above a directory", () => {
    const fx = tmpBase();
    try {
      expect(extension.territoryScore("api/app.py", ["api/app.py"], fx.dir)).toBe(3);
      expect(extension.territoryScore("api/nested/deep.py", ["api/**/*.py"], fx.dir)).toBe(2);
      expect(extension.territoryScore("web/src/a.ts", ["web/src/**"], fx.dir)).toBe(1);
      // The matcher's suffix branch also matches outside the pattern's own directory. That is the
      // write gate's business, not the nudge's: it is not ownership and must not score.
      expect(extension.territoryScore("api/app.py", ["alembic/**/*"], fx.dir)).toBe(0);
      // A leading double star is real ownership of that file family anywhere in the repo.
      expect(extension.territoryScore("db/migrations/001.py", ["**/migrations/*.py"], fx.dir)).toBe(2);
      expect(extension.territoryScore("README.md", ["api/app.py"], fx.dir)).toBe(0);
      expect(extension.territoryScore("api/app.py", undefined, fx.dir)).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("nudgeForToolCall names the most specific owner, never a directory-grabbing neighbour", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), {
        api: {
          description: "API service",
          territory: ["api/mcp_server.py", "api/docstrings/**/*"],
          skill_path: ".xtrm/skills/infra/service-knowledge/services/api/SKILL.md",
        },
        schema: { description: "Schema service", territory: ["alembic/**/*", "scripts/data/migrations.py"] },
      });
      const packs = extension.findUmbrellaPacks(fx.dir);
      const seen = new Set<string>();
      const message = extension.nudgeForToolCall(fx.dir, packs, "read", { path: "api/mcp_server.py" }, seen);
      expect(message).toContain("[service-knowledge] api owns api/mcp_server.py.");
      expect(message).not.toContain("schema");
      expect(message).toContain("knowledge_get with skill_path .xtrm/skills/infra/service-knowledge/services/api/SKILL.md");
      // The neighbour was never named, so its own territory is still free to nudge later.
      expect(seen.has("schema")).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("nudgeForToolCall reports co-owners of shared territory instead of picking one", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), {
        store: { description: "Store", territory: ["docker-compose.yml"] },
        platform: { description: "Platform", territory: ["docker-compose.yml"] },
      });
      const packs = extension.findUmbrellaPacks(fx.dir);
      const seen = new Set<string>();
      const message = extension.nudgeForToolCall(fx.dir, packs, "read", { path: "docker-compose.yml" }, seen);
      // Shared territory lists every owner, each with its own next call, in one injection.
      expect(message).toContain("[service-knowledge] 2 services own these paths:");
      expect(message).toContain('- store owns docker-compose.yml. Next: knowledge_evidence_for_files {"paths":["docker-compose.yml"]}');
      expect(message).toContain("- platform owns docker-compose.yml.");
      expect(seen.has("store")).toBe(true);
      expect(seen.has("platform")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("nudgePaths never treats a grep pattern as a path", () => {
    expect(extension.nudgePaths("grep", { pattern: "api/app.py", path: "lib" })).toEqual(["lib"]);
    expect(extension.nudgePaths("find", { pattern: "**/*.py", path: "api" })).toEqual(["api"]);
    expect(extension.nudgePaths("read", { file_path: "api/app.py" })).toEqual(["api/app.py"]);
    expect(extension.nudgePaths("bash", { command: "git status" })).toEqual([]);
    expect(extension.nudgePaths("edit", { path: "api/app.py" })).toEqual([]);
  });

  test("a directory grep resolves to every service whose territory lies under it", () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), {
        api: { description: "API", territory: ["api/mcp_server.py"] },
        store: { description: "Store", territory: ["storage/repo.py"] },
      });
      mkdirSync(join(fx.dir, "api"), { recursive: true });
      const packs = extension.findUmbrellaPacks(fx.dir);
      const seen = new Set<string>();
      const message = extension.nudgeForToolCall(fx.dir, packs, "grep", { pattern: "TODO", path: "api" }, seen);
      expect(message).toContain("api owns api");
      expect(message).not.toContain("storage");
      expect(seen.has("api")).toBe(true);
      expect(seen.has("store")).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("one injection names at most three services", () => {
    const fx = tmpBase();
    try {
      const services: Record<string, unknown> = {};
      for (const id of ["a01", "a02", "a03", "a04", "a05"]) {
        services[id] = { description: id, territory: ["api/**/*.py"] };
      }
      writeRegistry(canonicalPackDir(fx.dir, "infra"), services);
      const packs = extension.findUmbrellaPacks(fx.dir);
      const seen = new Set<string>();
      const message = extension.nudgeForToolCall(fx.dir, packs, "read", { path: "api/app.py" }, seen)!;
      expect(message).toContain("3 services own these paths:");
      expect(seen.size).toBe(3);
    } finally {
      fx.cleanup();
    }
  });

  test("the tool_result handler appends one advisory block to the triggering result", async () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), REGISTRY);
      const { pi } = nudgePi();
      extension.default(pi as any, { cwd: fx.dir });
      const handler = pi.listeners.get("tool_result")![0];
      const result: any = await handler(
        { toolName: "read", input: { path: "api/app.py" }, content: [{ type: "text", text: "print(1)" }], isError: false },
        { cwd: fx.dir },
      );
      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({ type: "text", text: "print(1)" });
      expect(result.content[1].text).toContain("[service-knowledge] api owns api/app.py.");
      expect(result.content[1].text).toContain("knowledge_evidence_for_files");
      // Second read of the same service adds nothing: the service was announced.
      const repeat = await handler(
        { toolName: "read", input: { path: "api/other.py" }, content: [{ type: "text", text: "x" }], isError: false },
        { cwd: fx.dir },
      );
      expect(repeat).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });

  test("the tool_result handler carries a structured result through untouched", async () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), REGISTRY);
      const { pi } = nudgePi();
      extension.default(pi as any, { cwd: fx.dir });
      const handler = pi.listeners.get("tool_result")![0];
      const result: any = await handler(
        {
          toolName: "read",
          input: { path: "api/app.py" },
          content: [{ type: "text", text: "x" }],
          structuredContent: { lines: 1 },
          isError: false,
        },
        { cwd: fx.dir },
      );
      expect(result.structuredContent).toEqual({ lines: 1 });
    } finally {
      fx.cleanup();
    }
  });

  test("the tool_result handler returns undefined when there is nothing to add", async () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), REGISTRY);
      const { pi } = nudgePi();
      extension.default(pi as any, { cwd: fx.dir });
      const handler = pi.listeners.get("tool_result")![0];
      const content = [{ type: "text", text: "x" }];
      // Unowned path, unhooked tool, and a result with no content array.
      await expect(handler({ toolName: "read", input: { path: "README.md" }, content }, { cwd: fx.dir })).resolves.toBeUndefined();
      await expect(handler({ toolName: "edit", input: { path: "api/app.py" }, content }, { cwd: fx.dir })).resolves.toBeUndefined();
      await expect(handler({ toolName: "read", input: { path: "api/app.py" } }, { cwd: fx.dir })).resolves.toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });

  test("the tool_result handler fails open when the registry read throws", async () => {
    const fx = tmpBase();
    try {
      writeRegistry(canonicalPackDir(fx.dir, "infra"), REGISTRY);
      // A registry path that is a directory makes every read throw; the handler must stay silent.
      const broken = [{ registryPath: join(fx.dir, "api"), packDir: fx.dir, umbrellaName: "service-knowledge" }];
      const { pi } = nudgePi();
      extension.default(pi as any, { cwd: fx.dir });
      const handler = pi.listeners.get("tool_result")![0];
      const result = await handler(
        { toolName: "read", input: { path: "api/app.py" }, content: [{ type: "text", text: "x" }], isError: false },
        { cwd: fx.dir },
      );
      // Whatever happened, the handler must not throw and must not corrupt the result.
      expect(result === undefined || Array.isArray(result.content)).toBe(true);
      expect(extension.nudgeForToolCall(fx.dir, broken as any, "read", { path: "api/app.py" }, new Set())).toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  test("no registry means no tool_result handler at all", () => {
    const fx = tmpBase();
    try {
      const { pi } = nudgePi();
      extension.default(pi as any, { cwd: fx.dir });
      expect(pi.listeners.get("tool_result")).toBeUndefined();
      expect(pi.listeners.get("tool_call")).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });
});
