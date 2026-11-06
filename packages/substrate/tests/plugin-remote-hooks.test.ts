// Hook transport (XTRM-692): with a remote configured, a hook event is answered
// by the store-owning machine; with none it runs in-process. The two failure
// modes that matter are proved here — noise never reaches the hook's JSON, and an
// unreachable remote makes the edit gate block instead of allowing (XTRM-712).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = join(ROOT, "plugin", "substrate", "scripts");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;

function fixture(remoteBody: string) {
  const dir = mkdtempSync(join(tmpdir(), "hook-remote-"));
  const bin = join(dir, "bin");
  spawnSync("mkdir", ["-p", bin]);
  const log = join(dir, "ssh-argv");
  const payload = join(dir, "ssh-stdin");
  writeFileSync(join(bin, "ssh"), `#!/bin/sh\nprintf '%s\\n' "$@" > ${log}\ncat > ${payload}\n${remoteBody}\n`);
  chmodSync(join(bin, "ssh"), 0o755);
  const configPath = join(dir, "substrate.json");
  writeFileSync(configPath, JSON.stringify({ remote: "ssh:probe", remoteSb: "/usr/local/bin/sb", checkouts: {} }));
  return {
    dir,
    run: (script: string, input: string, env: NodeJS.ProcessEnv = {}) =>
      spawnSync(process.execPath, [join(SCRIPTS, script)], {
        encoding: "utf8",
        timeout: 20000,
        input,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env["PATH"] ?? ""}`,
          SUBSTRATE_REMOTE_CONFIG: configPath,
          SUBSTRATE_MCP_SERVER_ROOT: dir,
          XTRM_SESSION_ID: "0f7b9e34-6a1e-4b8e-9d95-0d1e6f2f0a11",
          ...env,
        },
      }),
    payload: () => {
      try {
        return readFileSync(payload, "utf8");
      } catch {
        return "";
      }
    },
    argv: () => {
      try {
        return readFileSync(log, "utf8");
      } catch {
        return "";
      }
    },
  };
}

describe("hook entries follow the configured transport", () => {
  it("relays the far side's answer and discards its startup noise", () => {
    const ready = `@@substrate-hook-ready {"version":"${VERSION}"}`;
    const fx = fixture(`printf 'banner from a login shell\\n'\nprintf '%s\\n' '${ready}'\nprintf '{"decision":"block","reason":"from the server"}\\n'`);
    const result = fx.run("edit-gate.mjs", JSON.stringify({ tool_name: "Edit", tool_input: {}, cwd: "/pc/worktree" }));
    assert.equal(result.stdout, '{"decision":"block","reason":"from the server"}\n');
    assert.match(fx.argv(), /--remote-hook/);
    assert.match(fx.argv(), /--workspace/, "the workspace travels as an argument, not as environment");
    // The payload is what the far side's handler reads, and it carries the PC
    // workspace: the server never falls back to its own checkout.
    assert.match(fx.payload(), /\/pc\/worktree/);
    assert.match(fx.argv(), /0f7b9e34-6a1e-4b8e-9d95-0d1e6f2f0a11/, "identity travels as an argument");
  });

  it("blocks the edit gate when a configured remote is unreachable", () => {
    const fx = fixture('cat > /dev/null\nprintf "ssh: connect to host probe: Connection refused\\n" >&2\nexit 255');
    const result = fx.run("edit-gate.mjs", JSON.stringify({ tool_name: "Edit", tool_input: {}, cwd: "/pc/worktree" }));
    const decision = JSON.parse(result.stdout.trim());
    assert.equal(decision.decision, "block", "an unreachable remote must never allow an edit");
    assert.match(decision.reason, /connection_lost/);
  });

  it("fails closed when the far side runs a different version", () => {
    const ready = '@@substrate-hook-ready {"version":"0.0.1"}';
    const fx = fixture(`printf '%s\\n' '${ready}'`);
    const result = fx.run("edit-gate.mjs", JSON.stringify({ tool_name: "Edit", tool_input: {}, cwd: "/pc/worktree" }));
    const decision = JSON.parse(result.stdout.trim());
    assert.equal(decision.decision, "block");
    assert.match(decision.reason, /version_mismatch/);
  });

  it("never spawns ssh when no remote is configured", () => {
    const fx = fixture("cat > /dev/null\nprintf 'must not run\\n'");
    const result = fx.run(
      "edit-gate.mjs",
      JSON.stringify({ tool_name: "Read", tool_input: {}, cwd: process.cwd() }),
      { SUBSTRATE_REMOTE_CONFIG: join(fx.dir, "absent.json") },
    );
    assert.equal(fx.argv(), "");
    assert.doesNotMatch(result.stdout, /from the server|must not run/);
  });
});
