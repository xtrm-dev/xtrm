import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteError, buildRemoteCommand } from "../src/remote/spec.ts";
import { clientRepositoryKey, openRemoteSession, resolveMapping, runRemote } from "../src/remote/session.ts";
import { forwardCli } from "../src/remote/executor.ts";
import { remoteSetup } from "../src/remote/setup.ts";
import { runCli } from "../cli/sb.ts";
import type { RemoteTransport } from "../src/remote/ssh.ts";

// Remote transport tests (ADR-008). The "server" is this machine: a fake `sb`
// receives the command the real encoder produced and reports its own argv, cwd
// and environment. That is the property under test — an argument crosses ssh
// intact, or it does not — so the assertions are on what the far side read, not
// on the shape of the command string.

interface FakeConfig {
  version?: string;
  roots?: string[];
  keys?: Record<string, string>;
  projects?: Record<string, string>;
  mode?: "echo" | "cat" | "file" | "envelope";
  exit?: number;
  fileFlag?: string;
  receive?: string;
  envelope?: string;
}

interface Fake {
  sbPath: string;
  // The fake server's own config, read by the fake sb.
  serverConfigPath: string;
  // The client-side remote config (remoteSb + mapping cache), kept separate so
  // a test that seeds one cannot clobber the other.
  clientConfigPath: string;
  dir: string;
  calls: () => Array<{ argv: string[]; cwd: string; env: { project: string | null; holder: string | null; db: string | null } }>;
}

const FAKE_SOURCE = (configPath: string): string => `#!/usr/bin/env node
const fs = require("node:fs");
const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(configPath)}, "utf8"));
const argv = process.argv.slice(2);
const env = {
  project: process.env.SUBSTRATE_PROJECT ?? null,
  holder: process.env.SUBSTRATE_HOLDER ?? null,
  db: process.env.SUBSTRATE_DB ?? null,
};
fs.appendFileSync(cfg.log, JSON.stringify({ argv, cwd: process.cwd(), env }) + "\\n");
const out = (command, data) => { process.stdout.write(JSON.stringify({ schema: "substrate-cli/v1", command, ok: true, data }) + "\\n"); process.exit(0); };
if (argv[0] === "--version") { process.stdout.write(cfg.version || "sb 0.2.2\\n"); process.exit(0); }
if (argv[0] === "project" && argv[1] === "links") out("project.links", { gitRoot: null, links: (cfg.roots || []).map((gitRoot) => ({ gitRoot })) });
if (argv[0] === "doctor") out("doctor", { repository: { repositoryKey: (cfg.keys || {})[process.cwd()] ?? null }, project: { id: (cfg.projects || {})[process.cwd()] ?? null } });
if (cfg.mode === "cat") {
  const input = fs.readFileSync(0);
  process.stdout.write(input);
  process.exit(cfg.exit ?? 0);
}
if (cfg.mode === "file") {
  const index = argv.indexOf(cfg.fileFlag);
  if (index < 0 || index + 1 >= argv.length) { process.stderr.write("fake sb: missing " + cfg.fileFlag + "\\n"); process.exit(9); }
  fs.writeFileSync(cfg.receive, fs.readFileSync(argv[index + 1]));
  out("echo", { argv, cwd: process.cwd(), env });
} else if (cfg.mode === "echo") out("echo", { argv, cwd: process.cwd(), env });
if (cfg.mode === "envelope") { process.stdout.write(cfg.envelope || ""); process.exit(0); }
process.stderr.write("fake sb: unhandled " + JSON.stringify(argv) + "\\n");
process.exit(9);
`;

function makeFake(config: FakeConfig): Fake {
  const dir = mkdtempSync(join(tmpdir(), "sb-remote-"));
  const serverConfigPath = join(dir, "fake.json");
  const clientConfigPath = join(dir, "client-config.json");
  const log = join(dir, "calls.jsonl");
  const sbPath = join(dir, "fake-sb.cjs");
  writeFileSync(serverConfigPath, JSON.stringify({ log, ...config }));
  writeFileSync(sbPath, FAKE_SOURCE(serverConfigPath), { mode: 0o755 });
  return {
    sbPath,
    serverConfigPath,
    clientConfigPath,
    dir,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter((line) => line.trim() !== "")
            .map((line) => JSON.parse(line) as { argv: string[]; cwd: string; env: { project: string | null; holder: string | null; db: string | null } })
        : [],
  };
}

// Executes the produced command through a real POSIX shell: quoting defects
// surface here, which is the point.
function localTransport(): RemoteTransport {
  return {
    run(request) {
      const result = spawnSync("sh", ["-c", request.command], {
        input: request.stdin ?? undefined,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env },
      });
      return { code: result.status ?? 255, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
  };
}

function remoteEnv(configPath: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SUBSTRATE_REMOTE: "ssh:fake",
    SUBSTRATE_REMOTE_CONFIG: configPath,
    SUBSTRATE_DB: undefined,
    SUBSTRATE_HOLDER: undefined,
    SUBSTRATE_PROJECT: undefined,
    ...extra,
  };
}

function writeClientConfig(path: string, sbPath: string, checkouts: Record<string, { root: string; projectId: string | null }>): void {
  const entries: Record<string, { root: string; projectId: string | null; verifiedAt: number }> = {};
  for (const [key, mapping] of Object.entries(checkouts)) entries[key] = { ...mapping, verifiedAt: 1 };
  writeFileSync(path, JSON.stringify({ remote: "ssh:fake", remoteSb: sbPath, serverVersion: "0.2.2", checkouts: entries }));
}

function readClientConfig(path: string): { checkouts: Record<string, { root: string; projectId: string | null }> } {
  return JSON.parse(readFileSync(path, "utf8")) as { checkouts: Record<string, { root: string; projectId: string | null }> };
}

const CLIENT_KEY = clientRepositoryKey();

describe("remote command encoding", () => {
  it("round-trips hostile argv through a real shell byte-identically", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const argv = ["a b", 'it\'s', "", "$HOME", "line\nbreak", "*", "--json"];
    const plan = buildRemoteCommand({ sbPath: fake.sbPath, argv });
    const result = localTransport().run({ host: "fake", command: plan.command });
    assert.equal(result.code, 0, result.stderr);
    const [call] = fake.calls();
    assert.deepEqual(call?.argv, argv);
  });

  it("quotes the working directory and keeps it as one argument", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const cwd = `${fake.dir}/a dir with spaces`;
    const plan = buildRemoteCommand({ sbPath: fake.sbPath, argv: ["issue", "list"], cwd });
    // The directory does not exist on purpose: cd must fail cleanly, proving
    // the path stayed one encoded argument instead of word-splitting.
    const result = localTransport().run({ host: "fake", command: plan.command });
    assert.equal(result.code, 71);
    assert.match(result.stderr, /cannot cd to .*a dir with spaces/);
  });

  it("never expands a hostile working directory in its own error message", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const marker = join(fake.dir, "pwned");
    const cwd = `${fake.dir}/missing-$(touch ${marker})`;
    const plan = buildRemoteCommand({ sbPath: fake.sbPath, argv: ["issue", "list"], cwd });
    const result = localTransport().run({ host: "fake", command: plan.command });
    assert.equal(result.code, 71);
    assert.equal(existsSync(marker), false, "the cwd must not be evaluated by the shell");
    assert.ok(result.stderr.includes(cwd), "the message still names the path");
  });

  it("carries an allowlisted environment prefix and never SUBSTRATE_DB", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const plan = buildRemoteCommand({
      sbPath: fake.sbPath,
      argv: ["issue", "list"],
      env: { SUBSTRATE_HOLDER: "worker-1", SUBSTRATE_PROJECT: "prj_x" },
    });
    assert.equal(plan.command.includes("SUBSTRATE_DB"), false);
    const result = localTransport().run({ host: "fake", command: plan.command });
    assert.equal(result.code, 0, result.stderr);
    const env = fake.calls()[0]?.env;
    assert.equal(env?.holder, "worker-1");
    assert.equal(env?.project, "prj_x");
    assert.equal(env?.db, null);
  });

  it("materialises an uploaded file into a server temp path", () => {
    const receive = join(tmpdir(), `sb-remote-receive-${process.pid}-${Date.now()}`);
    const fake = makeFake({ mode: "file", fileFlag: "--contract", receive, version: "sb 0.2.2\n" });
    const body = Buffer.from("## PROBLEM\nquoted 'text' and $dollars and\nnewlines\n");
    const plan = buildRemoteCommand({
      sbPath: fake.sbPath,
      argv: ["issue", "update", "XTRM-1", "--contract", "/client/contract.md"],
      uploads: [{ argvIndex: 4, content: body }],
    });
    const result = localTransport().run({ host: "fake", command: plan.command });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(readFileSync(receive), body);
  });
});

describe("remote execution passthrough", () => {
  it("forwards stdin, stdout and the exit code unchanged", () => {
    const fake = makeFake({ mode: "cat", exit: 7, version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, {});
    const session = openRemoteSession({ env, transport: localTransport() });
    assert.ok(session);
    const result = runRemote(session, ["provenance", "receipt", "wr_1", "--json"], { stdin: "payload\n" });
    assert.equal(result.code, 7);
    assert.equal(result.stdout, "payload\n");
  });

  it("forwards --json output byte-identically through the CLI", () => {
    const envelope = '{"schema":"substrate-cli/v1","command":"issue.list","ok":true,"data":[]}\n';
    const fake = makeFake({ mode: "envelope", envelope, version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const outcome = forwardCli(["issue", "list", "--json"], { env, transport: localTransport() });
    assert.ok(outcome);
    assert.equal(outcome.code, 0);
    assert.equal(outcome.stdout, envelope);
  });

  it("runs the whole CLI invocation on the server before any local store work", () => {
    const envelope = '{"schema":"substrate-cli/v1","command":"issue.list","ok":true,"data":[]}\n';
    const fake = makeFake({ mode: "envelope", envelope, version: "sb 0.2.2\n" });
    const localDb = join(fake.dir, "state.db");
    const env = remoteEnv(fake.clientConfigPath, { SUBSTRATE_DB: localDb });
    // SUBSTRATE_DB selects the local store, so this invocation is local by
    // design; the remote one below must not create it.
    assert.equal(forwardCli(["issue", "list", "--json"], { env, transport: localTransport() }), null);

    const remoteEnvNoDb = remoteEnv(fake.clientConfigPath, { SUBSTRATE_HOLDER: "worker-1" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const result = runCli(["issue", "list", "--json"], { env: remoteEnvNoDb, transport: localTransport() });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, envelope);
    assert.equal(existsSync(localDb), false, "remote mode must not create the local store");
    assert.equal(fake.calls()[0]?.env.holder, "worker-1");
    assert.equal(fake.calls()[0]?.env.project, "prj_x", "the client passes the project it resolved");
  });

  it("answers help, version, doctor and remote locally", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    for (const argv of [["--version"], ["--help"], ["doctor"], ["remote", "status"], ["help", "issue"]]) {
      assert.equal(forwardCli(argv, { env, transport: localTransport() }), null, argv.join(" "));
    }
    assert.equal(fake.calls().length, 0);
  });

  it("uploads --flag=value and keeps the flag name in the server's argv", () => {
    const receive = join(tmpdir(), `sb-remote-eq-${process.pid}-${Date.now()}`);
    const fake = makeFake({ mode: "file", fileFlag: "--contract", receive, version: "sb 0.2.2\n" });
    const contractPath = join(fake.dir, "contract.md");
    const body = "## PROBLEM\ninline form\n";
    writeFileSync(contractPath, body);
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const outcome = forwardCli(["issue", "update", "XTRM-1", `--contract=${contractPath}`], {
      env: remoteEnv(fake.clientConfigPath),
      transport: localTransport(),
    });
    assert.ok(outcome);
    assert.equal(outcome.code, 0, outcome.stderr);
    // The fake reads argv[indexOf("--contract") + 1] and exits 9 without it.
    assert.equal(readFileSync(receive, "utf8"), body);
    const argv = fake.calls().pop()?.argv ?? [];
    assert.deepEqual(argv.slice(argv.indexOf("--contract")), ["--contract", argv[argv.indexOf("--contract") + 1]]);
  });

  it("leaves an explicit --project= alone instead of injecting one from the mapping", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_from_mapping" } });
    const outcome = forwardCli(["issue", "list", "--json", "--project=prj_explicit"], {
      env: remoteEnv(fake.clientConfigPath),
      transport: localTransport(),
    });
    assert.ok(outcome);
    assert.equal(outcome.code, 0, outcome.stderr);
    assert.equal(fake.calls()[0]?.env.project, null);
  });

  it("carries the participant of a forwarded journal write to the server's environment", () => {
    // Measured on the real server: sb 0.2.2 reads SUBSTRATE_HOLDER as the
    // ambient identity for a write that supplies none, so an exported holder is
    // the whole mechanism by which a forwarded note records its participant.
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const outcome = forwardCli(["issue", "note", "XTRM-685", "probe", "--kind", "note"], {
      env: remoteEnv(fake.clientConfigPath, { SUBSTRATE_HOLDER: "holder-probe-pc" }),
      transport: localTransport(),
    });
    assert.ok(outcome);
    assert.equal(outcome.code, 0, outcome.stderr);
    assert.equal(fake.calls()[0]?.env.holder, "holder-probe-pc");
  });

  it("uploads every document flag, whether its value is a file or inline JSON", () => {
    // The live probe caught this: --mechanical was not in the upload list, so
    // the server read a path that does not exist there and reported it as bad
    // inline JSON. The rule is the CLI's own: a value that exists as a file
    // here is uploaded, anything else travels untouched.
    const receive = join(tmpdir(), `sb-remote-mech-${process.pid}-${Date.now()}`);
    const fake = makeFake({ mode: "file", fileFlag: "--mechanical", receive, version: "sb 0.2.2\n" });
    const mechanicalPath = join(fake.dir, "mechanical.json");
    const body = '{"summary":"transport probe"}';
    writeFileSync(mechanicalPath, body);
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const fromFile = forwardCli(["journal", "append", "XTRM-685", "--kind", "note", "--mechanical", mechanicalPath], {
      env: remoteEnv(fake.clientConfigPath),
      transport: localTransport(),
    });
    assert.ok(fromFile);
    assert.equal(fromFile.code, 0, fromFile.stderr);
    assert.equal(readFileSync(receive, "utf8"), body);

    const inline = forwardCli(["journal", "append", "XTRM-685", "--kind", "note", "--mechanical", body], {
      env: remoteEnv(fake.clientConfigPath),
      transport: localTransport(),
    });
    assert.ok(inline);
    // Inline JSON is not a file here, so it must reach the server verbatim
    // instead of being replaced by an uploaded copy.
    const argv = fake.calls().pop()?.argv ?? [];
    assert.equal(argv[argv.indexOf("--mechanical") + 1], body);
  });

  it("forwards the client's stdin when an argument is '-'", () => {
    const fake = makeFake({ mode: "cat", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const document = "## PROBLEM\nfrom stdin\n";
    const outcome = forwardCli(["issue", "note", "XTRM-685", "--file", "-"], {
      env: remoteEnv(fake.clientConfigPath),
      transport: localTransport(),
      readStdin: () => document,
    });
    assert.ok(outcome);
    assert.equal(outcome.code, 0, outcome.stderr);
    assert.equal(outcome.stdout, document);
    assert.deepEqual(fake.calls()[0]?.argv, ["issue", "note", "XTRM-685", "--file", "-"]);
  });

  it("turns an unreachable server into an error envelope and creates no local state", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const offline: RemoteTransport = {
      run() {
        return { code: 255, stdout: "", stderr: "ssh: connect to host fake port 22: Connection refused" };
      },
    };
    const outcome = forwardCli(["issue", "list", "--json"], { env, transport: offline });
    assert.ok(outcome);
    assert.equal(outcome.code, 1);
    const envelope = JSON.parse(outcome.stdout) as { ok: boolean; error: string; command: string };
    assert.equal(envelope.ok, false);
    assert.equal(envelope.command, "issue.list");
    assert.match(envelope.error, /cannot reach fake/);
    assert.match(envelope.error, /Connection refused/);
  });
});

describe("repository-key mapping", () => {
  it("maps through the server's own repository key, not a matching path", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    const other = join(fake.dir, "other-checkout");
    const matching = join(fake.dir, "matching-checkout");
    mkdirSync(other, { recursive: true });
    mkdirSync(matching, { recursive: true });
    writeFileSync(
      fake.serverConfigPath,
      JSON.stringify({
        log: join(fake.dir, "calls.jsonl"),
        version: "sb 0.2.2\n",
        mode: "echo",
        roots: [other, matching],
        keys: { [other]: "github.com/xtrm-dev/other", [matching]: CLIENT_KEY },
        projects: { [matching]: "prj_xtrm" },
      }),
    );
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, {});
    const session = openRemoteSession({ env, transport: localTransport() });
    assert.ok(session);
    const mapping = resolveMapping(session, CLIENT_KEY!, { refresh: true });
    assert.equal(mapping.root, matching);
    assert.equal(mapping.projectId, "prj_xtrm");
    assert.equal(readClientConfig(fake.clientConfigPath).checkouts[CLIENT_KEY!]?.root, matching);
  });

  it("fails closed when the server has no checkout of this repository", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n", roots: [] });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, {});
    const session = openRemoteSession({ env, transport: localTransport() });
    assert.ok(session);
    assert.throws(
      () => resolveMapping(session, CLIENT_KEY ?? "github.com/xtrm-dev/xtrm"),
      (err: unknown) => err instanceof RemoteError && err.kind === "mapping" && /sb remote setup/.test(err.message),
    );
  });

  it("refuses an ambiguous mapping and names the flag that resolves it", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    const a = join(fake.dir, "a");
    const b = join(fake.dir, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(
      fake.serverConfigPath,
      JSON.stringify({ log: join(fake.dir, "calls.jsonl"), version: "sb 0.2.2\n", mode: "echo", roots: [a, b], keys: { [a]: CLIENT_KEY, [b]: CLIENT_KEY } }),
    );
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, {});
    const session = openRemoteSession({ env, transport: localTransport() });
    assert.ok(session);
    assert.throws(
      () => resolveMapping(session, CLIENT_KEY!, { refresh: true }),
      (err: unknown) => err instanceof RemoteError && err.kind === "mapping" && /--server-root/.test(err.message),
    );
  });
});

describe("remote setup", () => {
  it("records the verified server checkout in the client config", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    const root = join(fake.dir, "server-checkout");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      fake.serverConfigPath,
      JSON.stringify({ log: join(fake.dir, "calls.jsonl"), version: "sb 0.2.2\n", mode: "echo", roots: [root], keys: { [root]: CLIENT_KEY }, projects: { [root]: "prj_xtrm" } }),
    );
    const configPath = join(fake.dir, "client.json");
    const env = remoteEnv(configPath);
    // Seed the resolved server path so setup does not pay a login-shell probe
    // (and never finds the real sb on this machine).
    writeClientConfig(configPath, fake.sbPath, {});
    const result = remoteSetup("ssh:fake", { env, transport: localTransport() });
    assert.equal(result.serverVersion, "0.2.2");
    assert.deepEqual(result.checkout, { root, projectId: "prj_xtrm" });
    assert.equal(result.remote, "ssh:fake");
    assert.equal(readClientConfig(configPath).checkouts[CLIENT_KEY!]?.root, root);
  });

  it("returns every consumer to local mode on disable", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    const configPath = join(fake.dir, "client.json");
    writeClientConfig(configPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const env = remoteEnv(configPath);
    assert.ok(forwardCli(["issue", "list", "--json"], { env, transport: localTransport() }), "remote before disable");

    const result = runCli(["remote", "disable", "--json"], { env, transport: localTransport() });
    assert.equal(result.code, 0);
    const disabled = (JSON.parse(result.stdout) as { data: { cleared: boolean; mode: string; envOverride: string | null } }).data;
    assert.equal(disabled.cleared, true);
    // The environment variable outranks the file and the reply says so.
    assert.equal(disabled.mode, "remote");
    assert.equal(disabled.envOverride, "ssh:fake");

    // With no remote setting anywhere, there is no forwarding and no ssh: the
    // local fallback the two-way rule requires.
    const localOnlyEnv = { ...env, SUBSTRATE_REMOTE: undefined };
    assert.equal(forwardCli(["issue", "list", "--json"], { env: localOnlyEnv, transport: localTransport() }), null);
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    assert.equal("remote" in config, false);
    for (const stale of ["remoteSb", "serverVersion", "checkouts"]) assert.equal(stale in config, false, stale);

    const again = runCli(["remote", "disable", "--json"], { env: localOnlyEnv, transport: localTransport() });
    assert.equal(again.code, 0);
    assert.equal((JSON.parse(again.stdout) as { data: { cleared: boolean; mode: string } }).data.mode, "local");
    assert.equal((JSON.parse(again.stdout) as { data: { cleared: boolean } }).data.cleared, false);
  });
});
