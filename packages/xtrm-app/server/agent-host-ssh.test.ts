// @vitest-environment node
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  INTERACTIVE_COMMAND,
  LOGIN_COMMAND,
  bootstrap,
  bootstrapArgv,
  displayCommand,
  forwardArgv,
  parseEnsureOutput,
  spawnRunner,
  terminalArgv,
  validateRemoteCommand,
  validateTarget,
  type SshRun,
  type SshRunner,
} from "./agent-host-ssh.ts";

const ok = (port = 41234, major = 1) => JSON.stringify({ schema: "xtrm.agent-host-ensure.v1", version: "0.9.0", protocol: { major }, port, pid: 4242 });
const run = (r: Partial<SshRun>): SshRun => ({ code: 0, stdout: "", stderr: "", timedOut: false, ...r });

/** Scripted runner: answers by remote command, records every argv. */
function scripted(answers: Record<string, SshRun>) {
  const calls: string[][] = [];
  const runner: SshRunner = async (argv) => {
    calls.push(argv);
    const remote = argv[argv.length - 1]!;
    return answers[remote] ?? run({ code: 127, stderr: "zsh:1: command not found: xt" });
  };
  return { runner, calls, remotes: () => calls.map((a) => a[a.length - 1]) };
}

describe("bootstrap (PRD §35.8 item 2)", () => {
  it("uses the login shell when it finds xt", async () => {
    const s = scripted({ [LOGIN_COMMAND]: run({ stdout: `${ok()}\n` }) });
    const host = await bootstrap("box", { run: s.runner });
    expect(host).toMatchObject({ port: 41234, pid: 4242, protocolMajor: 1, via: "login" });
    expect(s.calls[0]).toEqual(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "box", "--", `"\${SHELL:-/bin/sh}" -lc 'xt host ensure --json'`]);
  });

  it("falls back to the interactive login shell when -lc exits 127", async () => {
    const s = scripted({ [INTERACTIVE_COMMAND]: run({ stdout: ok() }) });
    const host = await bootstrap("nvm-box", { run: s.runner });
    expect(s.remotes()).toEqual([LOGIN_COMMAND, INTERACTIVE_COMMAND]);
    expect(INTERACTIVE_COMMAND).toBe(`"\${SHELL:-/bin/sh}" -ilc 'xt host ensure --json'`);
    expect(host.via).toBe("interactive");
  });

  it("ignores rc-file noise before the ensure line and takes the last ensure line", async () => {
    const noise = ["Welcome to box", "nvm: using node v24", '{"not":"ensure"}', ok(1111), "{broken json", ok(2222), "bye"].join("\n");
    const s = scripted({ [INTERACTIVE_COMMAND]: run({ stdout: noise }) });
    expect((await bootstrap("box", { run: s.runner })).port).toBe(2222);
  });

  it("uses the stored remote command when both shells fail", async () => {
    const stored = "/opt/xt/bin/xt host ensure --json";
    const s = scripted({ [stored]: run({ stdout: ok() }) });
    const host = await bootstrap("box", { run: s.runner, remoteCommand: stored });
    expect(s.remotes()).toEqual([LOGIN_COMMAND, INTERACTIVE_COMMAND, stored]);
    expect(host.via).toBe("stored");
  });

  it("skips the interactive shell when the login shell fails for another reason", async () => {
    const stored = "/opt/xt/bin/xt host ensure --json";
    const s = scripted({ [LOGIN_COMMAND]: run({ code: 1, stderr: "error: unknown command 'host'" }), [stored]: run({ stdout: ok() }) });
    await bootstrap("box", { run: s.runner, remoteCommand: stored });
    expect(s.remotes()).toEqual([LOGIN_COMMAND, stored]);
  });

  it("names the fix when no shell finds xt and no remote command is stored", async () => {
    const s = scripted({});
    await expect(bootstrap("box", { run: s.runner })).rejects.toMatchObject({ code: "xt_not_found", message: expect.stringContaining("Set a remote command") });
  });

  it("rejects a different protocol major and tells the operator to update the host", async () => {
    const s = scripted({ [LOGIN_COMMAND]: run({ stdout: ok(1, 0) }) });
    await expect(bootstrap("old-box", { run: s.runner })).rejects.toMatchObject({ code: "protocol_mismatch", message: expect.stringContaining("Run `xt update` on old-box") });
    const t = scripted({ [LOGIN_COMMAND]: run({ stdout: ok(1, 2) }) });
    await expect(bootstrap("new-box", { run: t.runner })).rejects.toMatchObject({ code: "protocol_mismatch", message: expect.stringContaining("protocol v2") });
  });

  it("stops on an ensure error line, an ssh failure, or a timeout", async () => {
    const err = JSON.stringify({ schema: "xtrm.agent-host-ensure.v1", error: { code: "host_start_timeout", message: "xt host did not become ready" } });
    await expect(bootstrap("box", { run: scripted({ [LOGIN_COMMAND]: run({ code: 1, stdout: err }) }).runner })).rejects.toMatchObject({ code: "ensure_failed" });
    const ssh = scripted({ [LOGIN_COMMAND]: run({ code: 255, stderr: "box: Permission denied (publickey)." }) });
    await expect(bootstrap("box", { run: ssh.runner, remoteCommand: "x" })).rejects.toMatchObject({ code: "ssh_failed", message: expect.stringContaining("Permission denied") });
    expect(ssh.calls).toHaveLength(1);
    const hang = scripted({ [LOGIN_COMMAND]: run({ code: null, timedOut: true }) });
    await expect(bootstrap("box", { run: hang.runner })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("spawnRunner", () => {
  it("fires the timeout on a hanging command and closes stdin", async () => {
    // `sh -c` stands in for ssh: argv is passed through unchanged.
    const runner = spawnRunner("/bin/sh");
    const started = Date.now();
    const hung = await runner(["-c", "sleep 30"], 300);
    expect(hung.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
    const stdin = await runner(["-c", "cat; echo done"], 5_000);
    expect(stdin).toMatchObject({ code: 0, stdout: "done\n", timedOut: false });
  });

  it("times out even when the child leaves a grandchild holding the pipes, and kills it", async () => {
    // `sleep 37; true` keeps sleep as a grandchild on every shell (dash never execs it, bash cannot
    // here). Without a process-group kill, `close` waits until sleep exits (XTRM-594).
    const runner = spawnRunner("/bin/sh");
    const marker = `37.${process.pid}`; // unique sleep argument, matched exactly below
    const started = Date.now();
    const hung = await runner(["-c", `sleep ${marker}; true`], 300);
    expect(hung.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
    await new Promise((r) => setTimeout(r, 100));
    const left = spawnSync("pgrep", ["-f", `^sleep ${marker.replace(".", "\\.")}$`], { encoding: "utf8" });
    expect(left.stdout.trim()).toBe("");
  });
});

describe("argv construction", () => {
  it("accepts targets and aliases, never options or shell syntax", () => {
    for (const t of ["box", "dawid@159.195.49.110", "prod-agent", "u@[::1]"]) expect(validateTarget(t)).toBe(t);
    for (const t of ["-oProxyCommand=sh", "a b", "box;rm", "$(id)", "", 3]) expect(validateTarget(t)).toBeNull();
    expect(validateRemoteCommand("  ~/bin/xt host ensure --json ")).toBe("~/bin/xt host ensure --json");
    expect(validateRemoteCommand("a\nb")).toBeNull();
  });

  it("forwards loopback to loopback", () => {
    expect(forwardArgv("box", 5000, 41234)).toEqual(["-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=10", "-L", "127.0.0.1:5000:127.0.0.1:41234", "box"]);
    expect(bootstrapArgv("box", "cmd").slice(-2)).toEqual(["--", "cmd"]);
  });

  it("builds Open in terminal as ssh -t <target> tmux attach -t <session>", () => {
    expect(terminalArgv("box", "xtrm-main")).toEqual(["ssh", "-t", "box", "tmux", "attach", "-t", "xtrm-main"]);
    expect(terminalArgv("box", "-x")).toBeNull();
    expect(terminalArgv("box", "a;b")).toBeNull();
    expect(displayCommand(["ssh", "-t", "box", "it's"])).toBe(`ssh -t box 'it'\\''s'`);
  });

  it("parses only xtrm.agent-host-ensure.v1 lines", () => {
    expect(parseEnsureOutput("")).toBeNull();
    expect(parseEnsureOutput(JSON.stringify({ schema: "other", port: 1 }))).toBeNull();
    expect(parseEnsureOutput(ok(70000))).toBeNull();
  });
});
