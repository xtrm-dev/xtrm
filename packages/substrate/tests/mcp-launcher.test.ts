// The MCP launcher decides where the server runs (XTRM-692). These tests stand in
// for ssh with a shim, so the launcher's own behaviour — the handshake, the
// version probe, the stream guard and the failure codes — is what is measured.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = join(ROOT, "plugin", "substrate", "scripts", "substrate-mcp.mjs");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;

interface Fixture {
  dir: string;
  run: (options?: { env?: NodeJS.ProcessEnv }) => { status: number | null; stdout: string; stderr: string };
  shimArgv: () => string;
}

function fixture(remoteBody: string, configRemote = "ssh:probe"): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "mcp-launcher-"));
  const bin = join(dir, "bin");
  spawnSync("mkdir", ["-p", bin]);
  const log = join(dir, "ssh-argv");
  const shim = join(bin, "ssh");
  writeFileSync(
    shim,
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${log}\n${remoteBody}\n`,
  );
  chmodSync(shim, 0o755);
  const configPath = join(dir, "substrate.json");
  writeFileSync(
    configPath,
    JSON.stringify({ remote: configRemote, remoteSb: "/usr/local/bin/sb", serverVersion: VERSION, checkouts: {} }),
  );
  return {
    dir,
    run: (options = {}) =>
      spawnSync(process.execPath, [LAUNCHER], {
        encoding: "utf8",
        timeout: 20000,
        input: "",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env["PATH"] ?? ""}`,
          SUBSTRATE_REMOTE_CONFIG: configPath,
          SUBSTRATE_MCP_SERVER_ROOT: dir,
          SUBSTRATE_HOLDER: "pc-holder",
          XTRM_SESSION_ID: "0f7b9e34-6a1e-4b8e-9d95-0d1e6f2f0a11",
          SUBSTRATE_ACTIVATION_ID: "act-pc",
          SUBSTRATE_REMOTE: undefined,
          ...options.env,
        },
      }),
    shimArgv: () => {
      try {
        return readFileSync(log, "utf8");
      } catch {
        return "";
      }
    },
  };
}

describe("the MCP launcher picks the transport from the configuration", () => {
  it("discards what the far side prints before the handshake and forwards frames after it", () => {
    const ready = `@@substrate-mcp-ready {"version":"${VERSION}"}`;
    const fx = fixture(`printf 'noise from a login shell\\n'\nprintf '%s\\n' '${ready}'\nprintf '{"jsonrpc":"2.0","id":1,"result":{}}\\n'\nexit 0`);
    const result = fx.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '{"jsonrpc":"2.0","id":1,"result":{}}\n', "only frames reach the MCP stream");
    assert.doesNotMatch(result.stdout, /noise/);
  });

  it("fails closed with version_mismatch naming both versions", () => {
    const ready = '@@substrate-mcp-ready {"version":"0.0.1"}';
    const fx = fixture(`printf '%s\\n' '${ready}'\nexit 0`);
    const result = fx.run();
    assert.equal(result.status, 78);
    assert.match(result.stderr, /version_mismatch/);
    assert.match(result.stderr, new RegExp(`0\\.0\\.1`));
    assert.match(result.stderr, new RegExp(VERSION.replace(/\./g, "\\.")));
    assert.equal(result.stdout, "", "nothing may be forwarded when the probe fails");
  });

  it("treats a far side that never sends the handshake as a lost connection", () => {
    // Noise is discarded, but the handshake is mandatory: without it the process
    // did not reach our server, and pretending otherwise would serve a mystery.
    const fx = fixture(`printf 'usage: something else\\n'\nexit 0`);
    const result = fx.run();
    assert.equal(result.status, 78);
    assert.match(result.stderr, /connection_lost/);
    assert.equal(result.stdout, "", "not one byte of noise reaches the MCP stream");
  });

  it("sends identity as explicit arguments and keeps it out of the environment", () => {
    const ready = `@@substrate-mcp-ready {"version":"${VERSION}"}`;
    const fx = fixture(`printf '%s\\n' '${ready}'\nexit 0`);
    const result = fx.run();
    assert.equal(result.status, 0, result.stderr);
    const argv = fx.shimArgv();
    assert.match(argv, /--identity/);
    assert.match(argv, /pc-holder/);
    assert.match(argv, /0f7b9e34-6a1e-4b8e-9d95-0d1e6f2f0a11/);
    assert.match(argv, /act-pc/);
    assert.match(argv, /-T\n/, "ssh runs without a pty");
    // ssh takes options, then destination, then command. A token between the
    // options and the host is read as the host, which is how a live probe
    // produced "Could not resolve hostname sh".
    const args = argv.trimEnd().split("\n");
    assert.equal(args[args.length - 2], "probe", "the destination is the last argument but one");
    assert.equal(args.includes("sh"), false, "no shell token is passed where ssh expects the host");
    assert.match(argv, /BatchMode=yes/);
    assert.match(argv, /ServerAliveInterval=15/);
  });

  it("reports an unreachable server as connection_lost and never serves locally", () => {
    const fx = fixture('printf "ssh: connect to host probe: Connection refused\\n" >&2\nexit 255');
    const result = fx.run();
    assert.equal(result.status, 78);
    assert.match(result.stderr, /connection_lost/);
    assert.equal(result.stdout, "", "a configured remote never falls back to the local store");
  });

  it("stays fully local when no remote is configured", () => {
    const fx = fixture(`printf 'should not run\\n'; exit 3`);
    const result = fx.run({ env: { SUBSTRATE_REMOTE_CONFIG: join(fx.dir, "absent.json") } });
    // Local mode loads the MCP server and waits on stdin, which closes immediately.
    assert.equal(result.stdout.includes("should not run"), false);
    assert.equal(fx.shimArgv(), "", "ssh is never spawned without a remote");
  });

  it("runs the script from the installed package, not from the store checkout (review HIGH)", () => {
    // A server may hold a checkout of a DIFFERENT repository — core has no
    // packages/substrate. The script ships with the installed package, so the
    // checkout must only resolve the repository, never supply the script path.
    const dir = mkdtempSync(join(tmpdir(), "mcp-script-dir-"));
    const bin = join(dir, "bin");
    const pkg = join(dir, "pkg");
    const scripts = join(pkg, "plugin", "substrate", "scripts");
    const checkout = join(dir, "checkout-of-another-repo");
    for (const d of [bin, scripts, join(pkg, "bin"), checkout]) spawnSync("mkdir", ["-p", d]);
    writeFileSync(join(pkg, "bin", "sb"), "#!/bin/sh\n");
    const ready = `@@substrate-mcp-ready {"version":"${VERSION}"}`;
    writeFileSync(
      join(scripts, "substrate-mcp.mjs"),
      `process.stdout.write(${JSON.stringify(ready + "\n")});\nprocess.stdout.write('{"jsonrpc":"2.0","id":1,"result":{}}\\n');\n`,
    );
    // The shim runs the far-side command locally, as a real login shell would.
    writeFileSync(join(bin, "ssh"), '#!/bin/sh\nfor a in "$@"; do last="$a"; done\nexec sh -c "$last"\n');
    chmodSync(join(bin, "ssh"), 0o755);
    const configPath = join(dir, "substrate.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        remote: "ssh:probe",
        remoteSb: join(pkg, "bin", "sb"),
        checkouts: { "probe github.com/xtrm-dev/xtrm": { root: checkout } },
      }),
    );
    const result = spawnSync(process.execPath, [LAUNCHER], {
      encoding: "utf8",
      timeout: 20000,
      input: "",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env["PATH"] ?? ""}`,
        SUBSTRATE_REMOTE_CONFIG: configPath,
        SUBSTRATE_MCP_SERVER_ROOT: undefined,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"id":1/, "the installed package's script served the session");
    assert.doesNotMatch(result.stderr, /Cannot find module|MODULE_NOT_FOUND/);
  });

  it("fails with a named code when the handshake is not JSON", () => {
    const fx = fixture(`printf '@@substrate-mcp-ready not-json\n'\nexit 0`);
    const result = fx.run();
    assert.equal(result.status, 78);
    assert.match(result.stderr, /protocol_mismatch/);
    assert.doesNotMatch(result.stderr, /SyntaxError|at JSON\.parse/);
    assert.equal(result.stdout, "");
  });

  it("refuses to serve when the far side could not parse the identity", () => {
    const fx = fixture(`printf '@@substrate-mcp-ready {"version":"${VERSION}","identity":"unparsed"}\n'`);
    const result = fx.run();
    assert.equal(result.status, 78);
    assert.match(result.stderr, /protocol_mismatch/);
    assert.match(result.stderr, /identity/);
    assert.equal(result.stdout, "");
  });

  it("names the missing plugin script as not_installed", () => {
    // The package is there but does not ship the script (an older install): that
    // is a named condition, not a lost connection.
    const dir = mkdtempSync(join(tmpdir(), "mcp-not-installed-"));
    const bin = join(dir, "bin");
    const pkg = join(dir, "pkg");
    const checkout = join(dir, "checkout");
    for (const d of [bin, join(pkg, "bin"), checkout]) spawnSync("mkdir", ["-p", d]);
    writeFileSync(join(pkg, "bin", "sb"), "#!/bin/sh\n");
    writeFileSync(join(bin, "ssh"), '#!/bin/sh\nfor a in "$@"; do last="$a"; done\nexec sh -c "$last"\n');
    chmodSync(join(bin, "ssh"), 0o755);
    const configPath = join(dir, "substrate.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        remote: "ssh:probe",
        remoteSb: join(pkg, "bin", "sb"),
        checkouts: { "probe github.com/xtrm-dev/xtrm": { root: checkout } },
      }),
    );
    const result = spawnSync(process.execPath, [LAUNCHER], {
      encoding: "utf8",
      timeout: 20000,
      input: "",
      env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}`, SUBSTRATE_REMOTE_CONFIG: configPath, SUBSTRATE_MCP_SERVER_ROOT: undefined },
    });
    assert.equal(result.status, 78);
    assert.match(result.stderr, /not_installed/);
    assert.equal(result.stdout, "");
  });
});
