import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
};
const hooks = JSON.parse(read("hooks/hooks.json")) as {
  hooks: Record<string, { hooks: { type: string; command: string; args?: string[] }[] }[]>;
};
const mcp = JSON.parse(read(".mcp.json")) as {
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
};

function hookEntries() {
  return Object.values(hooks.hooks).flatMap((matchers) => matchers.flatMap((m) => m.hooks));
}

describe("packaged plugin (xtrm-iip.1)", () => {
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
    assert.deepEqual(server.args, ["${CLAUDE_PLUGIN_ROOT}/scripts/substrate-mcp.ts"]);
  });

  it("ships no repo-local database default", () => {
    for (const [name, server] of Object.entries(mcp.mcpServers)) {
      assert.equal(server.env?.["SUBSTRATE_DB"], undefined, `${name} must not default SUBSTRATE_DB`);
    }
  });

  it("sets an explicit skill name rather than inheriting the install directory", () => {
    // Marketplace install directories are version strings that change on every
    // update, so a skill without an explicit name changes invocation name too.
    const skill = read("skills/using-substrate/SKILL.md");
    assert.match(skill, /^---\n(?:.*\n)*?name:\s*using-substrate\s*$/m);
  });

  it("keeps one doctrine: the Authority block is byte-identical in both halves", () => {
    const authority = (src: string) => {
      const m = /## Authority \(non-negotiable\)\s*\n\n```text\n([\s\S]*?)\n```/.exec(src);
      assert.ok(m, "Authority block not found");
      return m[1];
    };
    const canonical = readFileSync(new URL("../skills/using-substrate/SKILL.md", import.meta.url), "utf8");
    assert.equal(
      authority(read("skills/using-substrate/SKILL.md")),
      authority(canonical),
      "plugin skill Authority block drifted from the canonical Pi doctrine; edit the Pi half, then mirror",
    );
  });
});
