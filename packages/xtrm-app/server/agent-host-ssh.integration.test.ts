// @vitest-environment node
// Connect end to end without a remote host: a fake `ssh` runs the remote command locally, with an
// isolated HOME and XDG_RUNTIME_DIR, against the built core CLI (`xt host ensure`, XTRM-567), and
// serves `-L` with a local TCP relay. No real host is contacted and ~/.ssh is never read or written.
// Every agent host the test starts is stopped in afterAll.
//
// XTRM_CORE_CLI points at core's cli/dist/index.cjs; the test is skipped when it is absent.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHostConnection, agentHostHandler } from "./agent-host-ssh.ts";

const CORE_CLI = process.env.XTRM_CORE_CLI ?? join(homedir(), "dev/core/.xtrm/worktrees/core-xt-claude-host-direct-mode/cli/dist/index.cjs");

const FAKE_SSH = (root: string) => `#!/bin/bash
# Fake ssh for tests: never connects anywhere.
echo "$*" >> "${root}/ssh.log"
fwd=; target=
while [ $# -gt 0 ]; do
  case "$1" in
    -o) shift 2 ;;
    -L) fwd="$2"; shift 2 ;;
    -N|-t|-T) shift ;;
    --) shift; [ -n "$target" ] && break ;;
    -*) shift ;;
    *) if [ -z "$target" ]; then target="$1"; shift; else break; fi ;;
  esac
done
if [ -n "$fwd" ]; then exec "${process.execPath}" "${root}/forward.mjs" "$fwd"; fi
if [ ! -x "${root}/shell-$target" ]; then echo "ssh: Could not resolve hostname $target" >&2; exit 255; fi
export HOME="${root}/home" XDG_RUNTIME_DIR="${root}/run" PATH="/usr/bin:/bin" SHELL="${root}/shell-$target"
exec /bin/bash -c "$*" </dev/null
`;

const FORWARD = `import net from "node:net";
const [, lport, , rport] = process.argv[2].split(":");
const srv = net.createServer((c) => { const u = net.connect(Number(rport), "127.0.0.1"); c.pipe(u).pipe(c); c.on("error", () => u.destroy()); u.on("error", () => c.destroy()); });
srv.listen(Number(lport), "127.0.0.1");
process.on("SIGTERM", () => process.exit(0));
`;

const shell = (path: string) => `#!/bin/bash\n# Remote login shell; $1 is -lc or -ilc.\n${path}exec bash "$@"\n`;

describe.skipIf(!existsSync(CORE_CLI))("SSH connection against the core CLI through a fake ssh", () => {
  let root: string;
  let ssh: string;
  let bridge: Server;
  let bridgeUrl: string;
  const hostPids = new Set<number>();
  const sshDir = join(homedir(), ".ssh");
  const fingerprint = () => (existsSync(sshDir) ? `${statSync(sshDir).mtimeMs}` : "absent");
  const before = fingerprint();

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "xtrm-ssh-"));
    for (const d of ["home", "run", "bin-remote", "bin-mismatch"]) mkdirSync(join(root, d), { mode: 0o700 });
    const exe = (name: string, text: string) => {
      writeFileSync(join(root, name), text);
      chmodSync(join(root, name), 0o755);
    };
    exe("ssh", FAKE_SSH(root));
    writeFileSync(join(root, "forward.mjs"), FORWARD);
    exe("bin-remote/xt", `#!/bin/sh\nexec "${process.execPath}" "${CORE_CLI}" "$@"\n`);
    exe("bin-mismatch/xt", `#!/bin/sh\necho '{"schema":"xtrm.agent-host-ensure.v1","version":"9.0.0","protocol":{"major":2},"port":1,"pid":1}'\n`);
    // box: xt on the login PATH. nvm-box: xt only in an interactive shell, after rc noise.
    // bare-box: xt on no PATH. mismatch-box: an ensure that answers protocol v2.
    exe("shell-box", shell(`export PATH="${root}/bin-remote:$PATH"\n`));
    exe("shell-nvm-box", shell(`if [ "$1" = "-ilc" ]; then echo "Now using node v24 (npm v11)"; export PATH="${root}/bin-remote:$PATH"; fi\n`));
    exe("shell-bare-box", shell(""));
    exe("shell-mismatch-box", shell(`export PATH="${root}/bin-mismatch:$PATH"\n`));
    ssh = join(root, "ssh");
  });

  afterAll(async () => {
    bridge?.close();
    for (const pid of hostPids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
    await new Promise((r) => setTimeout(r, 500));
    for (const pid of hostPids) expect(() => process.kill(pid, 0), `agent host ${pid} still running`).toThrow();
    expect(fingerprint()).toBe(before);
    rmSync(root, { recursive: true, force: true });
  });

  const connection = (name: string) => new AgentHostConnection({ sshBin: ssh, settingsFile: join(root, `${name}.json`) });

  it("connects through the interactive-shell fallback, lists sessions over the forward, and opens a terminal", async () => {
    const conn = connection("nvm");
    conn.save({ target: "nvm-box", remoteCommand: null });
    const state = await conn.connect();
    expect(state.error).toBeUndefined();
    expect(state).toMatchObject({ phase: "connected", host: { protocolMajor: 1, via: "interactive" } });
    hostPids.add(state.host!.pid);

    const log = readFileSync(join(root, "ssh.log"), "utf8").trim().split("\n");
    expect(log[0]).toBe(`-o BatchMode=yes -o ConnectTimeout=10 nvm-box -- "\${SHELL:-/bin/sh}" -lc 'xt host ensure --json'`);
    expect(log[1]).toContain(`-ilc 'xt host ensure --json'`);
    expect(log[2]).toBe(`-N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -L 127.0.0.1:${state.host!.localPort}:127.0.0.1:${state.host!.port} nvm-box`);

    // The bridge reads the host API over the forwarded loopback port.
    bridge = createServer((req, res) => void agentHostHandler(conn, undefined, () => null)(req, res, () => ((res.statusCode = 404), res.end())));
    await new Promise<void>((r) => bridge.listen(0, "127.0.0.1", r));
    bridgeUrl = `http://127.0.0.1:${(bridge.address() as { port: number }).port}/xtrm-api/agent-host`;
    const list = (await (await fetch(`${bridgeUrl}/api/v1/sessions`)).json()) as { schema: string; kind: string; sessions: unknown[] };
    expect(list).toMatchObject({ schema: "xtrm.agent-host-api.v1", kind: "session_list" });
    expect(Array.isArray(list.sessions)).toBe(true);

    const term = await fetch(`${bridgeUrl}/terminal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tmuxSession: "xtrm-main" }) });
    expect(await term.json()).toEqual({ argv: ["ssh", "-t", "nvm-box", "tmux", "attach", "-t", "xtrm-main"], command: "ssh -t nvm-box tmux attach -t xtrm-main", launched: false });

    // Disconnect closes the forward; the remote host keeps running.
    expect(conn.disconnect().phase).toBe("disconnected");
    expect((await fetch(`${bridgeUrl}/api/v1/sessions`)).status).toBe(409);
    await new Promise((r) => setTimeout(r, 200));
    await expect(fetch(`http://127.0.0.1:${state.host!.localPort}/v1/sessions`)).rejects.toThrow();
    expect(() => process.kill(state.host!.pid, 0)).not.toThrow();
  }, 60_000);

  it("reuses the running host from a login shell", async () => {
    const conn = connection("box");
    conn.save({ target: "box", remoteCommand: null });
    const state = await conn.connect();
    expect(state).toMatchObject({ phase: "connected", host: { via: "login" } });
    expect(hostPids.has(state.host!.pid)).toBe(true);
    conn.disconnect();
  }, 60_000);

  it("uses the stored remote command when neither shell finds xt", async () => {
    const conn = connection("bare");
    conn.save({ target: "bare-box", remoteCommand: `${root}/bin-remote/xt host ensure --json` });
    const state = await conn.connect();
    expect(state).toMatchObject({ phase: "connected", host: { via: "stored" } });
    hostPids.add(state.host!.pid);
    conn.disconnect();

    const none = connection("bare-none");
    none.save({ target: "bare-box", remoteCommand: null });
    expect(await none.connect()).toMatchObject({ phase: "error", error: { code: "xt_not_found" } });
  }, 60_000);

  it("shows a protocol-major mismatch and opens no forward", async () => {
    const conn = connection("mismatch");
    conn.save({ target: "mismatch-box", remoteCommand: null });
    const state = await conn.connect();
    expect(state).toMatchObject({ phase: "error", error: { code: "protocol_mismatch" } });
    expect(state.error!.message).toContain("protocol v2");
    const log = readFileSync(join(root, "ssh.log"), "utf8");
    expect(log).not.toMatch(/-L .* mismatch-box/);
  }, 60_000);

  it("reports an unreachable target as an ssh failure", async () => {
    const conn = connection("nowhere");
    conn.save({ target: "nowhere", remoteCommand: null });
    expect(await conn.connect()).toMatchObject({ phase: "error", error: { code: "ssh_failed" } });
    expect(execFileSync("/bin/sh", ["-c", `grep -c nowhere "${root}/ssh.log"`]).toString().trim()).toBe("1");
  });
});
