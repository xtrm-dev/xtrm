import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// Acceptance xtrm-iip.1 (closeout E1): the packaged plugin is installable and
// path-correct. Hermetic: reads files only, opens no database, spawns nothing.
// `claude plugin validate --strict` is the live half of this acceptance and is
// recorded on the bead; these assertions guard the properties a validator does
// not check.

const plugin = (p: string) => new URL(`../plugin/substrate/${p}`, import.meta.url);
const read = (p: string) => readFileSync(plugin(p), "utf8");

const manifest = JSON.parse(read(".claude-plugin/plugin.json")) as {
  name: string;
  author?: { name?: string };
  hooks?: string;
  mcpServers?: string;
  experimental?: { monitors?: string };
};
const hooks = JSON.parse(read("hooks/hooks.json")) as {
  hooks: Record<string, { hooks: { type: string; command: string; args?: string[] }[] }[]>;
};
const mcp = JSON.parse(read(".mcp.json")) as {
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
};
const monitors = JSON.parse(read("monitors/monitors.json")) as Array<{ name?: string; when?: string }>;

function hookEntries() {
  return Object.values(hooks.hooks).flatMap((matchers) => matchers.flatMap((m) => m.hooks));
}

describe("packaged plugin (xtrm-iip.1)", () => {
  it("does not redeclare the auto-loaded hooks path (xtrm-iip.10)", () => {
    // Live session 2.1.266: a manifest `hooks` key plus the standard
    // hooks/hooks.json double-loads ("Duplicate hooks file detected");
    // validate --strict is blind to it, so the pin lives here.
    assert.equal((manifest as Record<string, unknown>)["hooks"], undefined, "plugin.json must not redeclare hooks/hooks.json");
    assert.ok(manifest.mcpServers, "manifest must declare mcpServers - .mcp.json at the default path is NOT auto-discovered");
  });

  it("declares undiscoverable components and namespaced monitor gate (xtrm-iip.12)", () => {
    assert.equal(manifest.experimental?.monitors, "./monitors/monitors.json", "manifest must declare the monitors path - monitors/ is NOT auto-discovered (xtrm-iip.12)");
    // The skill is installed by xt as a user skill (XTRM-679), so its invocation
    // name is bare. xtrm-iip.12 proved the namespaced form for the plugin copy
    // that no longer exists. Not yet proven on a live rig with the xt install.
    const gate = monitors.find((m) => m.name === "substrate-events")?.when;
    assert.equal(gate, "on-skill-invoke:using-substrate");
  });

  it("declares an author, without which validate --strict fails", () => {
    // Measured: Claude Code 2.1.266 emits "author: No author information
    // provided" as a warning, and --strict turns warnings into errors, so a
    // manifest that is otherwise correct still fails the bead's VALIDATION.
    assert.ok(manifest.author?.name, "plugin.json must declare author.name");
  });

  it("resolves every script through CLAUDE_PLUGIN_ROOT, never the project checkout", () => {
    const paths = [...hookEntries().flatMap((h) => h.args ?? []), ...Object.values(mcp.mcpServers).flatMap((s) => s.args ?? [])];
    assert.ok(paths.length > 0, "expected script paths to assert on");
    for (const p of paths) {
      assert.ok(p.includes("${CLAUDE_PLUGIN_ROOT}"), `${p} must resolve through CLAUDE_PLUGIN_ROOT`);
      assert.ok(!p.includes("${CLAUDE_PROJECT_DIR}"), `${p} must not resolve through the user project directory`);
      assert.ok(!p.includes("packages/substrate"), `${p} must not assume the xtrm checkout layout`);
    }
  });

  it("uses .mjs hook entry scripts so the handler modules do not self-invoke", () => {
    // integrations/claude-code/*.ts self-invoke on
    // process.argv[1].endsWith("<name>.ts"). A .ts entry script — including a
    // prefixed one like hook-precompact.ts — matches that suffix and would run
    // the handler twice. .mjs breaks the match.
    for (const arg of hookEntries().flatMap((h) => h.args ?? [])) {
      assert.ok(arg.endsWith(".mjs"), `hook entry ${arg} must be .mjs`);
    }
  });

  it("names the MCP entry exactly as the seam E3 owns", () => {
    const server = mcp.mcpServers["substrate"];
    assert.ok(server, "an mcpServers.substrate entry is required");
    assert.equal(server.command, "node");
    assert.deepEqual(server.args, ["${CLAUDE_PLUGIN_ROOT}/scripts/substrate-mcp.mjs"]);
  });

  it("ships no repo-local database default", () => {
    for (const [name, server] of Object.entries(mcp.mcpServers)) {
      assert.equal(server.env?.["SUBSTRATE_DB"], undefined, `${name} must not default SUBSTRATE_DB`);
    }
  });

  it("ships the skill source for xt to vendor, and no copy in the plugin or the Pi manifest (XTRM-679)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { pi?: { skills?: string[] } };
    assert.equal(pkg.pi?.skills, undefined, "Pi must not load a package skill: xt installs using-substrate");
    assert.equal(existsSync(new URL("../plugin/substrate/skills", import.meta.url)), false, "plugin must not ship a second copy of the skill");
    const source = readFileSync(new URL("../skills/using-substrate/SKILL.md", import.meta.url), "utf8");
    assert.match(source, /^---\nname: using-substrate\ndescription: \S.{0,1022}\n---\n/);
  });
});
