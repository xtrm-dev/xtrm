import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers.ts";
import { RemoteError, buildRemoteCommand } from "../src/remote/spec.ts";
import { clientRepositoryKey, openRemoteSession, resolveMapping, runRemote } from "../src/remote/session.ts";
import { MAX_DOCUMENT_BYTES, forwardCli, hookSession } from "../src/remote/executor.ts";
import { HOOK_BUDGET_MS, resolveIssueRef } from "../hooks/remote.ts";
import { remoteSetup } from "../src/remote/setup.ts";
import { mappingKey, selectRemote } from "../src/remote/config.ts";
import { localRepositoryKey, normalizeRemote } from "../src/domain/repository.ts";
import { renderRemoteStatus } from "../src/remote/render.ts";
import { runCli } from "../cli/sb.ts";
import { resolveClaimHolder } from "../src/domain/claim.ts";
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
  receipt?: { id: string; issueId: string; issueRevision: number };
  trace?: {
    receipts?: Array<{ id: string; executionBindingId: string; commitSha?: string | null; finalizedAt?: number | null }>;
    bindings?: Array<{ id: string; workspace: string }>;
    // XTRM-684: the trailer path reads the Issue, its revision and its bindings.
    issueId?: string;
    revision?: number;
    externalBindings?: Array<{ provider: string; remoteKey?: string | null; remoteId?: string | null }>;
  };
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
} else if (cfg.mode === "echo") {
  if (argv[0] === "provenance" && argv[1] === "receipt") {
    if (!argv.includes("--json")) { process.stderr.write("fake sb: provenance receipt needs --json\\n"); process.exit(9); }
    if (cfg.receipt) out("provenance.receipt", { receipt: cfg.receipt });
    process.stderr.write("fake sb: no receipt\\n");
    process.exit(9);
  }
  if (argv[0] === "provenance" && argv[1] === "trace") out("provenance.trace", cfg.trace || { receipts: [], bindings: [] });
  out("echo", { argv, cwd: process.cwd(), env });
}
if (cfg.mode === "envelope") { process.stdout.write(cfg.envelope || ""); process.exit(cfg.exit ?? 0); }
process.stderr.write("fake sb: unhandled " + JSON.stringify(argv) + "\\n");
process.exit(9);
`;

function makeFake(config: FakeConfig): Fake {
  const dir = tempDir("sb-remote-");
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
    SUBSTRATE_REMOTE: undefined,
    SUBSTRATE_REMOTE_CONFIG: configPath,
    SUBSTRATE_DB: undefined,
    SUBSTRATE_HOLDER: undefined,
    SUBSTRATE_PROJECT: undefined,
    ...extra,
  };
}

function writeClientConfig(path: string, sbPath: string, checkouts: Record<string, { root: string; projectId: string | null }>): void {
  const entries: Record<string, { root: string; projectId: string | null; verifiedAt: number }> = {};
  for (const [key, mapping] of Object.entries(checkouts)) entries[mappingKey("fake", key)] = { ...mapping, verifiedAt: 1 };
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

  it("never expands a hostile environment value", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const marker = join(fake.dir, "env-proof");
    const hostile = `a' ; touch ${marker} ; echo '$(id)`;
    const built = buildRemoteCommand({ sbPath: "/usr/bin/sb", argv: ["issue", "note", "X-1"], cwd: null, env: { SUBSTRATE_HOLDER: hostile } });
    const res = spawnSync("sh", ["-c", built.command], { encoding: "utf8" });
    assert.notEqual(res.status, 0, "the command fails on the missing sb, not on the injection");
    assert.equal(existsSync(marker), false, "an env value is data, never shell code");
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
    const receive = join(tempDir("sb-remote-receive-"), "contract.md");
    const fake = makeFake({ mode: "file", fileFlag: "--contract", receive, version: "sb 0.2.2\n" });
    const body = Buffer.from("## PROBLEM\nquoted 'text' and $dollars and\nnewlines\n");
    const plan = buildRemoteCommand({
      sbPath: fake.sbPath,
      argv: ["issue", "update", "XTRM-1", "--contract", "/client/contract.md"],
      uploads: [{ argvIndex: 4, content: body }],
    });
    const result = localTransport().run({ host: "fake", command: plan.command, stdin: plan.stdin });
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
    // Control: the same argv against the same db path, forced local, does
    // create it. Without this the assertion above would also pass if nothing on
    // either path ever opened a store.
    runCli(["issue", "list", "--json"], { env: remoteEnvNoDb, transport: localTransport(), dbPath: localDb });
    assert.equal(existsSync(localDb), true, "the local control creates the store the remote run avoided");
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

  it("refuses --flag=value for a document flag instead of sending a bare path", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const contractPath = join(fake.dir, "contract.json");
    writeFileSync(contractPath, '{"problem":"x"}');
    const refused = forwardCli(["issue", "create", "--project", "prj_x", `--contract=${contractPath}`], { env, transport: localTransport() });
    assert.equal(refused?.code, 1);
    assert.match(refused.stderr, /is not accepted in remote mode|does not split/);
    assert.equal(fake.calls().length, 0, "nothing reaches the server when the invocation is refused");
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

  // XTRM-722 forwarding property: the client resolves the claim holder before
  // it forwards anything. The server's own SUBSTRATE_HOLDER is therefore never
  // the deciding value — either the flag wins there, or the client's value
  // overrides it, and a client with neither fails closed without a request.
  function serverWithHolder(holder: string | undefined): RemoteTransport {
    return {
      run(request) {
        const env: NodeJS.ProcessEnv = { ...process.env };
        if (holder === undefined) delete env["SUBSTRATE_HOLDER"];
        else env["SUBSTRATE_HOLDER"] = holder;
        const result = spawnSync("sh", ["-c", request.command], {
          input: request.stdin ?? undefined,
          encoding: "utf8",
          timeout: 60_000,
          env,
        });
        return { code: result.status ?? 255, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
      },
    };
  }

  function remoteClaim(argv: string[], clientHolder: string | undefined, serverHolder: string | undefined) {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const outcome = forwardCli(argv, {
      env: remoteEnv(fake.clientConfigPath, { SUBSTRATE_HOLDER: clientHolder }),
      transport: serverWithHolder(serverHolder),
    });
    assert.ok(outcome, "remote mode forwards the invocation");
    return { fake, outcome };
  }

  it("refuses a forwarded claim with no holder on the client, and sends nothing", () => {
    for (const verb of ["claim", "release"]) {
      const { fake, outcome } = remoteClaim(["issue", verb, "XTRM-722", "--json"], undefined, "server-holder");
      assert.equal(outcome.code, 1, `${verb}: the client fails closed`);
      const envelope = JSON.parse(outcome.stdout) as { ok: boolean; error: string };
      assert.equal(envelope.ok, false);
      assert.match(envelope.error, /--holder/, `${verb}: names the flag`);
      assert.match(envelope.error, /SUBSTRATE_HOLDER/, `${verb}: names the environment`);
      assert.equal(fake.calls().length, 0, `${verb}: the executor was never invoked`);
    }
  });

  it("uses the client's holder, never the server's, on a forwarded claim", () => {
    const { fake, outcome } = remoteClaim(["issue", "claim", "XTRM-722", "--json"], "client-holder", "server-holder");
    assert.equal(outcome.code, 0, outcome.stderr);
    const call = fake.calls()[0];
    assert.equal(call?.env.holder, "client-holder", "the client's value overrides the server's");
  });

  it("sends the flag on a forwarded claim, and the flag beats both environments", () => {
    const { fake, outcome } = remoteClaim(
      ["issue", "claim", "XTRM-722", "--holder", "flag-holder", "--json"],
      "client-holder",
      "server-holder",
    );
    assert.equal(outcome.code, 0, outcome.stderr);
    const call = fake.calls()[0];
    const index = call?.argv.indexOf("--holder") ?? -1;
    assert.ok(index >= 0, "the flag is on the wire");
    assert.equal(call?.argv[index + 1], "flag-holder");
    // The server resolves exactly this pair: the flag wins over its own env.
    assert.equal(resolveClaimHolder("flag-holder", { SUBSTRATE_HOLDER: "client-holder" }).holder, "flag-holder");
    assert.equal(resolveClaimHolder("flag-holder", { SUBSTRATE_HOLDER: "server-holder" }).holder, "flag-holder");
  });

  it("uploads every document flag, whether its value is a file or inline JSON", () => {
    // The live probe caught this: --mechanical was not in the upload list, so
    // the server read a path that does not exist there and reported it as bad
    // inline JSON. The rule is the CLI's own: a value that exists as a file
    // here is uploaded, anything else travels untouched.
    const receive = join(tempDir("sb-remote-mech-"), "mechanical.json");
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

    const inlineBody = '{"summary":"inline probe"}';
    const inline = forwardCli(["journal", "append", "XTRM-685", "--kind", "note", "--mechanical", inlineBody], {
      env: remoteEnv(fake.clientConfigPath),
      transport: localTransport(),
    });
    assert.ok(inline);
    assert.equal(inline.code, 0, inline.stderr);
    // Inline JSON is materialised on the server as well: the bytes arrive
    // intact, and the document never appears in the server's process list.
    assert.equal(readFileSync(receive, "utf8"), inlineBody);
    const argv = fake.calls().pop()?.argv ?? [];
    assert.notEqual(argv[argv.indexOf("--mechanical") + 1], inlineBody, "the inline document is not passed as argv");
  });

  it("uploads --summary-file instead of sending this machine's path (XTRM-751)", () => {
    // Reported from a forwarded checkout: `sb journal append --summary-file
    // <path>` answered "--summary-file not found: <path>" while the file
    // existed on the caller, and `--summary-file -` answered "is empty". The
    // flag is a client-side document the CLI reads itself (cli/sb.ts
    // semanticArg), so it crosses like --mechanical: uploaded bytes, never the
    // caller's path.
    const receive = join(tempDir("sb-remote-summary-"), "summary.md");
    const fake = makeFake({ mode: "file", fileFlag: "--summary-file", receive, version: "sb 0.3.1\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const summaryPath = join(fake.dir, "summary.md");
    const summary = "## SUMMARY\nsummary-file transport probe; this file exists only on the caller.\n";
    writeFileSync(summaryPath, summary);
    const inner = localTransport();
    const transport: RemoteTransport = {
      run: (request) => {
        // The caller's copy is gone before the server runs: a run handed the
        // path instead of the bytes fails on the server, not here.
        rmSync(summaryPath, { force: true });
        return inner.run(request);
      },
    };
    const result = forwardCli(
      ["journal", "append", "XTRM-751", "--kind", "note", "--project", "prj_x", "--summary-file", summaryPath],
      { env: remoteEnv(fake.clientConfigPath), transport },
    );
    assert.ok(result);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(readFileSync(receive, "utf8"), summary);
    const argv = fake.calls().at(-1)?.argv ?? [];
    assert.notEqual(argv[argv.indexOf("--summary-file") + 1], summaryPath, "the server never receives this machine's path");
  });

  it("uploads a --summary-file given as a relative path (XTRM-786)", () => {
    // The path is relative to the caller's cwd. It must be resolved here, never
    // handed to the server: the server's cwd is a checkout that has no such
    // file, which is exactly how the reported failure read.
    const receive = join(tempDir("sb-remote-summary-rel-"), "summary.md");
    const fake = makeFake({ mode: "file", fileFlag: "--summary-file", receive, version: "sb 0.3.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const summaryPath = join(fake.dir, "summary-relative.md");
    const summary = "## SUMMARY\nrelative-path probe; the server has no file under this name.\n";
    writeFileSync(summaryPath, summary);
    const relativePath = relative(process.cwd(), summaryPath);
    assert.ok(!relativePath.startsWith("/"), "the probe must stay a relative path");
    const inner = localTransport();
    const transport: RemoteTransport = {
      run: (request) => {
        // The caller's copy is gone before the server runs.
        rmSync(summaryPath, { force: true });
        return inner.run(request);
      },
    };
    const result = forwardCli(
      ["journal", "append", "XTRM-786", "--kind", "note", "--project", "prj_x", "--summary-file", relativePath],
      { env: remoteEnv(fake.clientConfigPath), transport },
    );
    assert.ok(result);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(readFileSync(receive, "utf8"), summary);
    const argv = fake.calls().at(-1)?.argv ?? [];
    assert.notEqual(argv[argv.indexOf("--summary-file") + 1], relativePath, "the server never receives this machine's relative path");
  });

  it("forwards --summary-file - as the client's stdin (XTRM-751)", () => {
    const fake = makeFake({ mode: "cat", version: "sb 0.3.1\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const summary = "## SUMMARY\npiped into the caller, not the server\n";
    const result = forwardCli(
      ["journal", "append", "XTRM-751", "--kind", "note", "--project", "prj_x", "--summary-file", "-"],
      { env: remoteEnv(fake.clientConfigPath), transport: localTransport(), readStdin: () => summary },
    );
    assert.ok(result);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, summary, "the server reads the caller's stdin, not an empty stream");
  });

  it("refuses a --summary-file that does not exist on this machine (XTRM-751)", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.3.1\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const result = forwardCli(
      ["journal", "append", "XTRM-751", "--kind", "note", "--project", "prj_x", "--summary-file", "only-on-the-server.md", "--json"],
      { env: remoteEnv(fake.clientConfigPath), transport: localTransport() },
    );
    assert.ok(result);
    assert.equal(result.code, 1);
    assert.match((JSON.parse(result.stdout) as { error: string }).error, /not a readable file on this machine/);
    assert.equal(fake.calls().length, 0, "a path this machine does not have never reaches the server");
  });

  it("refuses a document value that is neither a file here nor inline JSON", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const outcome = forwardCli(["issue", "edit", "XTRM-1", "--contract", "a-contract-only-the-server-has.md", "--json"], {
      env: remoteEnv(fake.clientConfigPath),
      transport: localTransport(),
    });
    assert.ok(outcome);
    assert.equal(outcome.code, 1);
    assert.match((JSON.parse(outcome.stdout) as { error: string }).error, /not a file on this machine and not inline JSON/);
    assert.equal(fake.calls().length, 0, "a refused document never reaches the server");
  });

  it("accepts inline --contract JSON and materialises it on the server", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const contract = '{"problem":"inline contract"}';
    const result = runCli(["issue", "edit", "XTRM-1", "--contract", contract, "--json"], {
      env: remoteEnv(fake.clientConfigPath),
      transport: localTransport(),
    });
    assert.equal(result.code, 0, result.stderr);
    const argv = fake.calls()[0]?.argv ?? [];
    assert.notEqual(argv[argv.indexOf("--contract") + 1], contract, "the inline contract is uploaded, not passed as argv");
  });

  it("refuses an output path instead of writing it on the server", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    writeClientConfig(fake.clientConfigPath, fake.sbPath, {});
    const outcome = forwardCli(["export", "project", "--project", "prj_x", "--file", "snapshot.json", "--json"], {
      env: remoteEnv(fake.clientConfigPath),
      transport: localTransport(),
    });
    assert.ok(outcome);
    assert.equal(outcome.code, 1);
    assert.match((JSON.parse(outcome.stdout) as { error: string }).error, /output path/);
    assert.equal(fake.calls().length, 0, "nothing ran on the server");
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
    const localDb = join(fake.dir, "offline-state.db");
    const outcome = forwardCli(["issue", "list", "--json"], { env, transport: offline });
    assert.ok(outcome);
    assert.equal(outcome.code, 1);
    const envelope = JSON.parse(outcome.stdout) as { ok: boolean; error: string; command: string };
    assert.equal(envelope.ok, false);
    assert.equal(envelope.command, "issue.list");
    assert.match(envelope.error, /cannot reach fake/);
    assert.match(envelope.error, /Connection refused/);
    // The failure never becomes a local fallback. The control proves the store
    // would exist had the same invocation run locally.
    assert.equal(existsSync(localDb), false);
    runCli(["issue", "list", "--json"], { env: { ...env, SUBSTRATE_DB: localDb }, transport: localTransport() });
    assert.equal(existsSync(localDb), true, "the local control creates the store the failed remote run avoided");
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
    assert.equal(readClientConfig(fake.clientConfigPath).checkouts[mappingKey("fake", CLIENT_KEY!)]?.root, matching);
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
    assert.equal(readClientConfig(configPath).checkouts[mappingKey("fake", CLIENT_KEY!)]?.root, root);
  });

  it("returns every consumer to local mode on disable", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    const configPath = join(fake.dir, "client.json");
    writeClientConfig(configPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const env = remoteEnv(configPath);
    assert.ok(forwardCli(["issue", "list", "--json"], { env, transport: localTransport() }), "remote before disable");

    const overridden = { ...env, SUBSTRATE_REMOTE: "ssh:fake" };
    const result = runCli(["remote", "disable", "--json"], { env: overridden, transport: localTransport() });
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

describe("local store override", () => {
  it("treats --db and SUBSTRATE_DB as local even with a remote configured", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    assert.equal(forwardCli(["issue", "list", "--json", "--db", join(fake.dir, "a.db")], { env, transport: localTransport() }), null);
    assert.equal(forwardCli(["issue", "list", "--json", `--db=${join(fake.dir, "b.db")}`], { env, transport: localTransport() }), null);
    assert.equal(forwardCli(["issue", "list", "--json"], { env: { ...env, SUBSTRATE_DB: join(fake.dir, "c.db") }, transport: localTransport() }), null);
    // The service client reads SUBSTRATE_LOCAL_DB too; the forwarder read only the
    // first name, so a worker configured with the second wrote to the server.
    assert.equal(
      forwardCli(["issue", "list", "--json"], { env: { ...env, SUBSTRATE_LOCAL_DB: join(fake.dir, "d.db") }, transport: localTransport() }),
      null,
    );
    assert.equal(fake.calls().length, 0, "no query reaches the server when the local store is named");
  });

  it("reports the local override in doctor instead of an unconfigured remote", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const result = runCli(["doctor"], {
      env: remoteEnv(fake.clientConfigPath, { SUBSTRATE_DB: join(fake.dir, "local.db") }),
      transport: localTransport(),
    });
    assert.match(result.stdout, /note: SUBSTRATE_DB=.* selects the local store/);
    assert.equal(fake.calls().length, 0);
  });

  it("shows a malformed config in doctor rather than falling back to the local store", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const configPath = join(fake.dir, "broken.json");
    writeFileSync(configPath, "{ this is not json");
    const result = runCli(["doctor"], { env: remoteEnv(configPath), transport: localTransport() });
    assert.equal(result.code, 1);
    assert.match(result.stdout, /cannot parse/);
    assert.equal(fake.calls().length, 0);

    // An explicit local store still wins over the broken remote config.
    const local = runCli(["doctor"], { env: remoteEnv(configPath), transport: localTransport(), dbPath: join(fake.dir, "local.db") });
    assert.doesNotMatch(local.stdout, /cannot parse/);
  });
});

describe("explicit project without a checkout", () => {
  it("runs with --project outside any Git checkout and refuses without it", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, {});
    const outside = tempDir("sb-outside-");
    const before = process.cwd();
    try {
      process.chdir(outside);
      const without = forwardCli(["issue", "list", "--json"], { env, transport: localTransport() });
      assert.ok(without);
      assert.equal(without.code, 1);
      assert.match((JSON.parse(without.stdout) as { error: string }).error, /not inside a Git checkout/);

      const withProject = forwardCli(["issue", "list", "--project", "prj_x", "--json"], { env, transport: localTransport() });
      assert.ok(withProject);
      assert.equal(withProject.code, 0, withProject.stderr);
      const call = fake.calls().pop();
      assert.deepEqual(call?.argv, ["issue", "list", "--project", "prj_x", "--json"]);
      assert.equal(call?.env.project, null, "--project travels as an argument, not as an injected env var");
    } finally {
      process.chdir(before);
    }
  });
});

describe("stdin through the CLI", () => {
  it("forwards the client's stdin for a '-' document", () => {
    const fake = makeFake({ mode: "cat", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const document = "## PROBLEM\nthrough the real CLI path\n";
    const result = runCli(["journal", "append", "XTRM-685", "--kind", "note", "--mechanical", "-"], {
      env: remoteEnv(fake.clientConfigPath),
      transport: localTransport(),
      readStdin: () => document,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, document);
    assert.deepEqual(fake.calls()[0]?.argv.slice(-2), ["--mechanical", "-"]);
  });
});

// The hooks build their own transport, so the "server" is reached through a
// stand-in `ssh` on PATH: it runs the command it was handed, which is exactly
// what the real ssh does with the one command string the encoder produced.
function sshShim(fake: Fake): string {
  const binDir = join(fake.dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, "ssh");
  writeFileSync(shim, '#!/bin/sh\nfor a in "$@"; do last="$a"; done\nexec sh -c "$last"\n', { mode: 0o755 });
  return binDir;
}

function hookEnv(fake: Fake, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SUBSTRATE_REMOTE: "ssh:fake",
    SUBSTRATE_REMOTE_CONFIG: fake.clientConfigPath,
    XTRM_REPO_ROOT: process.cwd(),
    PATH: sshShim(fake) + ":" + (process.env["PATH"] ?? ""),
  };
  delete env["SUBSTRATE_DB"];
  delete env["SUBSTRATE_HOLDER"];
  return { ...env, ...extra };
}

// A checkout outside the package directory, carrying the same origin as this
// repository so the client key (and therefore the cached mapping) resolves.
function scratchCheckout(fake: Fake): string {
  const dir = join(fake.dir, "checkout");
  mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, encoding: "utf8" });
  const url = spawnSync("git", ["-C", process.cwd(), "remote", "get-url", "origin"], { encoding: "utf8" }).stdout?.trim();
  if (url) spawnSync("git", ["-C", dir, "remote", "add", "origin", url], { encoding: "utf8" });
  return dir;
}

function hookPath(name: string): string {
  return fileURLToPath(new URL(`../hooks/${name}`, import.meta.url));
}

describe("remote hooks", () => {
  it("binds the commit on the server and narrates nothing on stdout", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const sha = "a".repeat(40);
    const res = spawnSync(process.execPath, [hookPath("post-commit.ts")], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: hookEnv(fake, { XTRM_RECEIPT_ID: "wr_probe", XTRM_COMMIT_SHA: sha }),
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "", "the hook never narrates provenance on stdout");
    const bind = fake.calls().find((call) => call.argv[0] === "provenance" && call.argv[1] === "bind");
    assert.deepEqual(bind?.argv, ["provenance", "bind", "wr_probe", sha, "--json"]);
  });

  it("resolves an open receipt through the server when the hook has no receipt id", () => {
    const fake = makeFake({
      mode: "echo",
      version: "sb 0.2.2\n",
      trace: { receipts: [{ id: "wr_traced", executionBindingId: "eb_1", commitSha: null, finalizedAt: null }], bindings: [{ id: "eb_1", workspace: process.cwd() }] },
    });
    assert.ok(CLIENT_KEY);
    // The binding records the client checkout, which is this process's cwd.
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const sha = "b".repeat(40);
    const res = spawnSync(process.execPath, [hookPath("post-commit.ts")], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: hookEnv(fake, { XTRM_RECEIPT_ID: undefined, SUBSTRATE_ISSUE_REF: "XTRM-685", XTRM_COMMIT_SHA: sha }),
    });
    assert.equal(res.status, 0, res.stderr);
    const bind = fake.calls().find((call) => call.argv[0] === "provenance" && call.argv[1] === "bind");
    assert.deepEqual(bind?.argv, ["provenance", "bind", "wr_traced", sha, "--json"]);
  });

  it("attaches trailers read from the server without opening the local store", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n", receipt: { id: "wr_probe", issueId: "iss_x", issueRevision: 7 } });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const messageFile = join(fake.dir, "COMMIT_EDITMSG");
    writeFileSync(messageFile, "feat: probe\n");
    const res = spawnSync(process.execPath, [hookPath("prepare-commit-msg.ts"), messageFile], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: hookEnv(fake, { XTRM_RECEIPT_ID: "wr_probe" }),
    });
    assert.equal(res.status, 0, res.stderr);
    const message = readFileSync(messageFile, "utf8");
    assert.match(message, /XTRM-Issue: iss_x/);
    assert.match(message, /XTRM-Issue-Revision: 7/);
    assert.match(message, /XTRM-Receipt: wr_probe/);
  });

  it("resolves no Issue in a checkout whose branch names none, so nothing reaches the server", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const checkout = scratchCheckout(fake);
    const messageFile = join(checkout, "COMMIT_EDITMSG");
    writeFileSync(messageFile, "feat: untracked\n");
    // The resolution is the decision the hook acts on; assert it directly, so the
    // case fails if a reader ever starts inventing a ref for this checkout.
    assert.equal(resolveIssueRef(checkout), null, "a 'main' checkout names no Issue");
    const res = spawnSync(process.execPath, [hookPath("prepare-commit-msg.ts"), messageFile], {
      encoding: "utf8",
      cwd: checkout,
      env: hookEnv(fake, { XTRM_RECEIPT_ID: undefined, SUBSTRATE_ISSUE_REF: undefined, SUBSTRATE_ISSUE: undefined, XTRM_REPO_ROOT: checkout }),
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readFileSync(messageFile, "utf8"), "feat: untracked\n");
    assert.equal(fake.calls().length, 0, "no resolved Issue means no remote read");
  });

  it("attaches the Issue trailers from the server trace without a receipt (XTRM-684)", () => {
    const fake = makeFake({
      mode: "echo",
      version: "sb 0.2.2\n",
      trace: { receipts: [], bindings: [], issueId: "iss_remote", revision: 7, externalBindings: [{ provider: "jira", remoteKey: "PRG-7", remoteId: "10042" }] },
    });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const checkout = scratchCheckout(fake);
    const messageFile = join(checkout, "COMMIT_EDITMSG");
    writeFileSync(messageFile, "feat: probe\n");
    const res = spawnSync(process.execPath, [hookPath("prepare-commit-msg.ts"), messageFile], {
      encoding: "utf8",
      cwd: checkout,
      env: hookEnv(fake, { XTRM_RECEIPT_ID: undefined, SUBSTRATE_ISSUE_REF: "XTRM-684", SUBSTRATE_HOLDER: "worker-x", XTRM_REPO_ROOT: checkout }),
    });
    assert.equal(res.status, 0, res.stderr);
    const message = readFileSync(messageFile, "utf8");
    assert.match(message, /XTRM-Issue: iss_remote/, "the server's issue id, not the ref the branch named");
    assert.match(message, /XTRM-Issue-Revision: 7/);
    assert.match(message, /Jira: PRG-7/, "the key, never the numeric remote id");
    assert.match(message, /Agent: worker-x/);
    const trace = fake.calls().find((call) => call.argv[0] === "provenance" && call.argv[1] === "trace");
    assert.deepEqual(trace?.argv, ["provenance", "trace", "XTRM-684", "--json"]);
  });

  it("never ssh's when the hook names a local store", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const sha = "c".repeat(40);
    const res = spawnSync(process.execPath, [hookPath("post-commit.ts")], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: hookEnv(fake, { SUBSTRATE_DB: join(fake.dir, "hook-local.db"), XTRM_RECEIPT_ID: "wr_probe", XTRM_COMMIT_SHA: sha }),
    });
    assert.equal(fake.calls().length, 0, "an explicit local store must never reach the server");
    assert.equal(res.stdout, "");
  });

  it("reports that a rewritten commit was not reconciled on the server", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    const res = spawnSync(process.execPath, [hookPath("post-rewrite.ts")], {
      encoding: "utf8",
      cwd: process.cwd(),
      input: `${"d".repeat(40)} ${"e".repeat(40)}\n`,
      env: hookEnv(fake),
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /not reconciled on the server/);
    assert.equal(fake.calls().length, 0);
  });
});

describe("second-audit findings", () => {
  it("never uploads a file from a private-key or kernel directory", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const refused = forwardCli(["issue", "note", "XTRM-1", "--project", "prj_x", "--file", "/proc/self/cmdline"], { env, transport: localTransport() });
    assert.equal(refused?.code, 1);
    assert.match(refused.stderr, /holds secrets or kernel state/);
    assert.equal(fake.calls().length, 0);
  });

  it("refuses a symlinked document and an oversized one", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const target = join(fake.dir, "contract.json");
    writeFileSync(target, '{"problem":"x"}');
    const link = join(fake.dir, "contract-link.json");
    symlinkSync(target, link);
    const viaLink = forwardCli(["issue", "create", "--project", "prj_x", "--contract", link], { env, transport: localTransport() });
    assert.equal(viaLink?.code, 1);
    assert.match(viaLink.stderr, /refusing a symlink/);
    const big = join(fake.dir, "big.json");
    writeFileSync(big, "x".repeat(MAX_DOCUMENT_BYTES + 1));
    const tooBig = forwardCli(["issue", "create", "--project", "prj_x", "--contract", big], { env, transport: localTransport() });
    assert.equal(tooBig?.code, 1);
    assert.match(tooBig.stderr, /above the \d+-byte limit/);
    assert.equal(fake.calls().length, 0);
  });

  it("uploads --file only for the commands that take one", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const note = join(fake.dir, "note.md");
    writeFileSync(note, "a note");
    assert.ok(forwardCli(["issue", "note", "XTRM-1", "--project", "prj_x", "--file", note], { env, transport: localTransport() }));
    // `issue list` takes no --file: the token is forwarded unchanged, not
    // turned into an upload of whatever path it happens to name.
    assert.ok(forwardCli(["issue", "list", "--project", "prj_x", "--file", note, "--json"], { env, transport: localTransport() }));
    const calls = fake.calls();
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.argv.includes(note), true);
  });

  it("rejects a repository authority that hides a host behind credentials or a fragment", () => {
    assert.equal(normalizeRemote("http://127.0.0.1:18765#@github.com/acme/app"), null);
    assert.equal(normalizeRemote("https://github.com/acme/app?x=1"), "github.com/acme/app");
    assert.equal(normalizeRemote("https://git\\hub.com/acme/app"), null);
    assert.equal(normalizeRemote("https://github.com/acme/app\\evil"), null);
    assert.equal(normalizeRemote("git@github.com:acme/app.git"), "github.com/acme/app");
  });

  it("does not persist a host that came from the environment", () => {
    const root = tempDir("sb-remote-root-");
    const fake = makeFake({
      mode: "echo",
      version: "sb 0.2.2\n",
      roots: [root],
      keys: { [root]: CLIENT_KEY ?? "github.com/xtrm-dev/xtrm" },
      projects: { [root]: "prj_app" },
    });
    const env = { ...remoteEnv(fake.clientConfigPath), SUBSTRATE_REMOTE: "ssh:fake" };
    writeClientConfig(fake.clientConfigPath, fake.sbPath, {});
    const session = openRemoteSession({ env, transport: localTransport() });
    assert.ok(session);
    assert.equal(session.envOverride, true);
    const mapping = resolveMapping(session, CLIENT_KEY!, { refresh: true });
    assert.equal(mapping.root, root);
    assert.deepEqual(readClientConfig(fake.clientConfigPath).checkouts, {}, "a one-off SUBSTRATE_REMOTE leaves no durable mapping");
  });

  it("reports a server refusal from its --json envelope, not an empty stderr", () => {
    const fake = makeFake({
      mode: "envelope",
      exit: 1,
      envelope: JSON.stringify({ schema: "substrate-cli/v1", command: "provenance.bind", ok: false, error: "receipt wr_probe is already finalized" }),
      version: "sb 0.2.2\n",
    });
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const res = spawnSync(process.execPath, [hookPath("post-commit.ts")], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: hookEnv(fake, { XTRM_RECEIPT_ID: "wr_probe", XTRM_COMMIT_SHA: "e".repeat(40) }),
    });
    assert.equal(res.status, 0);
    assert.match(res.stderr, /receipt wr_probe is already finalized/);
  });

  it("refuses a receipt id that looks like an option", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const res = spawnSync(process.execPath, [hookPath("post-commit.ts")], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: hookEnv(fake, { XTRM_RECEIPT_ID: "--db", XTRM_COMMIT_SHA: "c".repeat(40) }),
    });
    assert.equal(res.status, 0);
    assert.match(res.stderr, /is not a receipt id/);
    assert.equal(fake.calls().length, 0, "an option-shaped id never reaches the server");
  });

  it("refuses a client project that contradicts the verified checkout", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = { ...remoteEnv(fake.clientConfigPath), SUBSTRATE_PROJECT: "prj_other" };
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const refused = forwardCli(["issue", "list"], { env, transport: localTransport() });
    assert.equal(refused?.code, 1);
    assert.match(refused.stderr, /contradicts the server checkout's project prj_x/);
    assert.equal(fake.calls().length, 0);
  });

  it("rejects a remote setting that is not a host string", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    writeFileSync(fake.clientConfigPath, JSON.stringify({ remote: 5, checkouts: {} }));
    const refused = forwardCli(["issue", "list"], { env: remoteEnv(fake.clientConfigPath), transport: localTransport() });
    assert.equal(refused?.code, 1);
    assert.match(refused.stderr, /"remote" must be a non-empty string/);
  });

  it("carries a large document over stdin and keeps its bytes out of the command line", () => {
    const receive = join(tempDir("sb-remote-large-"), "mechanical.json");
    const fake = makeFake({ mode: "file", fileFlag: "--mechanical", receive, version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const body = Buffer.from("MARKER-" + "m".repeat(60 * 1024));
    const path = join(fake.dir, "mechanical.json");
    writeFileSync(path, body);
    const plan = buildRemoteCommand({ sbPath: fake.sbPath, argv: ["journal", "append", "XTRM-1", "--kind", "note", "--mechanical", path], uploads: [{ argvIndex: 6, content: body }] });
    assert.equal(plan.command.includes("MARKER-"), false, "no document bytes in the argv the server sees");
    assert.equal(plan.command.length < 4096, true);
    const result = localTransport().run({ host: "fake", command: plan.command, stdin: plan.stdin });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(readFileSync(receive), body);
    assert.ok(forwardCli(["journal", "append", "XTRM-1", "--kind", "note", "--project", "prj_x", "--mechanical", path], { env, transport: localTransport() }));
  });

  it("bounds the hook to the remaining budget and never discovers", () => {
    // The mapping is present, so the hook reaches the transport: a hang here is
    // what the budget exists for. Without the mapping the test would exit early
    // and never prove anything about the ssh timeout (final review).
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    assert.ok(CLIENT_KEY);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY!]: { root: fake.dir, projectId: "prj_x" } });
    // hookEnv() writes the passthrough shim, so the hanging one comes after it.
    const env = hookEnv(fake, { XTRM_RECEIPT_ID: "wr_probe", XTRM_COMMIT_SHA: "d".repeat(40) });
    writeFileSync(join(sshShim(fake), "ssh"), "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
    const started = Date.now();
    const res = spawnSync(process.execPath, [hookPath("post-commit.ts")], {
      encoding: "utf8",
      cwd: process.cwd(),
      env,
    });
    const elapsed = Date.now() - started;
    assert.equal(res.status, 0, "a slow server never fails the commit");
    const budget = /timed out after (\d+) ms/.exec(res.stderr);
    assert.ok(budget, `expected a timeout warning, got: ${res.stderr}`);
    assert.ok(Number(budget![1]) > 0 && Number(budget![1]) <= HOOK_BUDGET_MS, `the transport got the remaining budget (${budget![1]} ms)`);
    assert.equal(res.stdout, "");
    assert.ok(elapsed >= 7_000 && elapsed < 20_000, `the hook gave up inside its budget, not at 120 s (took ${elapsed} ms)`);
    assert.equal(fake.calls().some((call) => call.argv[0] === "project"), false, "a hook never walks candidate checkouts");
  });
});

describe("final-review findings", () => {
  it("refuses an upload stream that ends before its marker", () => {
    const body = Buffer.from('{"problem":"complete"}');
    const plan = buildRemoteCommand({ sbPath: "/bin/true", argv: ["issue", "create", "--contract", "x"], uploads: [{ argvIndex: 3, content: body }] });
    assert.ok(plan.stdin);
    const cut = plan.stdin.slice(0, Math.floor(plan.stdin.length / 2));
    const result = localTransport().run({ host: "fake", command: plan.command, stdin: cut });
    assert.notEqual(result.code, 0, "a truncated stream must not succeed");
    assert.match(result.stderr, /ended early/);
  });

  it("refuses a document whose decoded size is not the size sent", () => {
    const body = Buffer.from('{"problem":"complete"}');
    const plan = buildRemoteCommand({ sbPath: "/bin/true", argv: ["issue", "create", "--contract", "x"], uploads: [{ argvIndex: 3, content: body }] });
    const honest = plan.stdin!;
    // Keep every marker but drop half the payload: only the byte-count check,
    // which compares the decoded file with the length in the command, notices.
    const lines = honest.split("\n");
    const payloadIndex = lines.findIndex((line) => line.startsWith("@@sb-remote-file "));
    const payload = lines[payloadIndex + 1]!;
    lines[payloadIndex + 1] = payload.slice(0, Math.floor(payload.length / 2));
    const short = lines.join("\n");
    const result = localTransport().run({ host: "fake", command: plan.command, stdin: short });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /wrong size|ended early/);
  });

  it("unpacks the frame under zsh, the server's login shell", () => {
    if (spawnSync("zsh", ["-c", "true"]).status !== 0) return; // no zsh: nothing to prove
    const body = Buffer.from('{"problem":"zsh"}');
    const plan = buildRemoteCommand({
      sbPath: "/bin/cat",
      argv: ["placeholder"],
      uploads: [{ argvIndex: 0, content: body }],
    });
    const result = spawnSync("zsh", ["-c", plan.command], { input: plan.stdin ?? undefined, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(Buffer.from(result.stdout), body);
  });

  it("keys an scp remote under the host git would connect to", () => {
    // Git splits at the first ':'. Refusing such paths would silently re-key the
    // repositories below onto local: keys (final review).
    assert.equal(normalizeRemote("evil.com:path@github.com:acme/app"), "evil.com/path@github.com:acme/app");
    assert.equal(normalizeRemote("git@github.com:acme/app.git"), "github.com/acme/app");
    assert.equal(normalizeRemote("git@host:/srv/git/a@b/repo.git"), "host/srv/git/a@b/repo");
    assert.equal(normalizeRemote("git@github.com:acme/app@v1"), "github.com/acme/app@v1");
    assert.equal(normalizeRemote("ssh://git@github.com/acme/app"), "github.com/acme/app");
    assert.equal(normalizeRemote("git@[2001:db8::1]:a/b.git"), "[2001:db8::1]/a/b");
  });

  it("binds only a receipt whose binding is this client workspace", () => {
    const fake = makeFake({
      mode: "echo",
      version: "sb 0.2.2\n",
      trace: { receipts: [{ id: "wr_server_side", executionBindingId: "eb_s", commitSha: null, finalizedAt: null }], bindings: [{ id: "eb_s", workspace: "/srv/other/checkout" }] },
    });
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const res = spawnSync(process.execPath, [hookPath("post-commit.ts")], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: hookEnv(fake, { XTRM_RECEIPT_ID: undefined, SUBSTRATE_ISSUE_REF: "XTRM-685", XTRM_COMMIT_SHA: "f".repeat(40) }),
    });
    assert.equal(res.status, 0);
    assert.equal(fake.calls().some((call) => call.argv[1] === "bind"), false, "a server-session receipt is not adopted");
  });

  it("ignores a .substrate-issue that is tracked in the repository", () => {
    const repo = tempDir("sb-tracked-");
    const git = (args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "T"]);
    writeFileSync(join(repo, ".substrate-issue"), "XTRM-685\n");
    git(["add", ".substrate-issue"]);
    git(["commit", "-qm", "carry the marker"]);
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const key = localRepositoryKey(repo);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [key]: { root: fake.dir, projectId: "prj_x" } });
    const res = spawnSync(process.execPath, [hookPath("post-commit.ts")], {
      encoding: "utf8",
      cwd: repo,
      env: { ...hookEnv(fake), XTRM_REPO_ROOT: repo, XTRM_RECEIPT_ID: undefined },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(fake.calls().length, 0, "a committed marker is repository content, not an instruction");
  });

  it("uploads --result for issue.note and --refs for journal.checkpoint", () => {
    const refsReceive = join(tempDir("sb-refs-"), "refs.json");
    const fake = makeFake({ mode: "file", fileFlag: "--refs", receive: refsReceive, version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const refs = join(fake.dir, "refs.json");
    writeFileSync(refs, '{"refs":["a"]}');
    const forwarded = forwardCli(["journal", "checkpoint", "XTRM-1", "--project", "prj_x", "--refs", refs], { env, transport: localTransport() });
    assert.equal(forwarded?.code ?? 0, 0, forwarded?.stderr);
    assert.deepEqual(JSON.parse(readFileSync(refsReceive, "utf8")), { refs: ["a"] });
    const noteFake = makeFake({ mode: "file", fileFlag: "--result", receive: join(tempDir("sb-result-"), "result.json"), version: "sb 0.2.2\n" });
    const noteEnv = remoteEnv(noteFake.clientConfigPath);
    writeClientConfig(noteFake.clientConfigPath, noteFake.sbPath, { [CLIENT_KEY ?? "k"]: { root: noteFake.dir, projectId: "prj_x" } });
    assert.ok(forwardCli(["issue", "note", "XTRM-1", "--project", "prj_x", "--result", refs], { env: noteEnv, transport: localTransport() }));
  });

  it("refuses a directory and a disguised kernel path as documents", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const directory = forwardCli(["issue", "create", "--project", "prj_x", "--contract", fake.dir], { env, transport: localTransport() });
    assert.equal(directory?.code, 1);
    assert.match(directory.stderr, /not a regular file/);
    const disguised = forwardCli(["issue", "create", "--project", "prj_x", "--contract", "/tmp/../proc/self/cmdline"], { env, transport: localTransport() });
    assert.equal(disguised?.code, 1);
    assert.match(disguised.stderr, /holds secrets or kernel state/);
    assert.equal(fake.calls().length, 0);
  });

  it("refuses a document with a second hard link", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const original = join(fake.dir, "contract.json");
    writeFileSync(original, '{"problem":"linked"}');
    const linked = join(fake.dir, "contract-hardlink.json");
    linkSync(original, linked);
    const refused = forwardCli(["issue", "create", "--project", "prj_x", "--contract", linked], { env, transport: localTransport() });
    assert.equal(refused?.code, 1);
    assert.match(refused.stderr, /hard links/);
    assert.equal(fake.calls().length, 0);
  });

  it("never uploads a --file that the command does not read", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const path = join(fake.dir, "some.json");
    writeFileSync(path, "{}");
    assert.ok(forwardCli(["issue", "show", "XTRM-1", "--project", "prj_x", "--file", path, "--json"], { env, transport: localTransport() }));
    assert.equal(fake.calls()[0]?.argv.includes(path), true, "the token crosses unchanged; nothing is uploaded");
  });

  it("gives each forwarded command only the budget that remains", () => {
    const seen: number[] = [];
    const transport: RemoteTransport = {
      run(request) {
        if (request.command.includes("--version")) return { code: 0, stdout: "sb 0.2.2\n", stderr: "" };
        if (request.command.includes("command -v")) return { code: 0, stdout: "/usr/bin/sb\n", stderr: "" };
        seen.push(request.timeoutMs ?? 0);
        const sleep = Math.min(request.timeoutMs ?? 1, 250);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleep);
        return { code: 124, stdout: "", stderr: "" };
      },
    };
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
    const session = openRemoteSession({ env: remoteEnv(fake.clientConfigPath), transport });
    assert.ok(session);
    session.deadlineMs = Date.now() + 60;
    const started = Date.now();
    runRemote(session, ["issue", "list"], { cwd: fake.dir });
    assert.ok(Date.now() - started < 2_000, "the remaining budget bounds the call");
    assert.ok((seen.at(-1) ?? 0) <= 100, "the transport got the remaining budget, not the default timeout");
  });

  it("shows the mapping age and the refresh hint", () => {
    const plan = buildRemoteCommand({ sbPath: "/usr/bin/sb", argv: ["issue", "list"], cwd: "/gone", remoteLabel: "ssh:server" });
    assert.match(plan.command, /sb remote setup ssh:server --refresh/);
    const report = {
      mode: "ssh" as const, configPath: "/tmp/c.json", remote: "ssh:server", host: "server", remoteSb: "/usr/bin/sb",
      clientVersion: "0.2.3", serverVersion: "0.2.2", latencyMs: 1, repositoryKey: CLIENT_KEY,
      checkout: { root: "/srv/repo", projectId: "prj_x", cached: true, verifiedAt: Date.now() - 10 * 24 * 3600 * 1000 },
      capabilities: { holderEnv: "", workspaceOverride: "", commitBinding: "", codecService: "", repositoryKeyLookup: "" },
      error: null, note: null,
    };
    const text = renderRemoteStatus(report);
    assert.match(text, /verified 10 d ago/);
  });
});

describe("closure review", () => {
  it("scopes the cached sb path to the host the FILE names", () => {
    const dir = tempDir("sb-m2-");
    const path = join(dir, "substrate.json");
    writeFileSync(
      path,
      JSON.stringify({ remote: "ssh:server", remoteSb: "/usr/bin/sb", serverVersion: "0.2.2", checkouts: {} }),
    );
    const base = { ...process.env, SUBSTRATE_REMOTE_CONFIG: path };
    const other = selectRemote({ ...base, SUBSTRATE_REMOTE: "ssh:other" });
    assert.equal(other?.spec.host, "other");
    assert.equal(other?.config.remoteSb, null, "a path verified for ssh:server is not reused for ssh:other");
    assert.equal(other?.config.serverVersion, null);
    const same = selectRemote({ ...base, SUBSTRATE_REMOTE: "ssh:server" });
    assert.equal(same?.config.remoteSb, "/usr/bin/sb", "the same host keeps what was verified for it");
    assert.equal(same?.config.serverVersion, "0.2.2");
    const fromFile = selectRemote(base);
    assert.equal(fromFile?.config.remoteSb, "/usr/bin/sb");
  });

  it("sends the decoded bytes of --result and --refs, not the client path", () => {
    // The client file is deleted before the server runs, and the server's fake
    // reads the flag value: if the document were not uploaded, sb would be
    // pointed at a path that no longer exists and exit 9 (final review 3).
    const cases: Array<{ argv: (path: string) => string[]; flag: string; body: string }> = [
      { flag: "--result", body: '{"summary":"done"}', argv: (path) => ["issue", "note", "XTRM-1", "--project", "prj_x", "--result", path] },
      { flag: "--refs", body: '{"refs":["a"]}', argv: (path) => ["journal", "checkpoint", "XTRM-1", "--project", "prj_x", "--refs", path] },
    ];
    for (const testCase of cases) {
      const closureReceive = join(tempDir("sb-closure-"), `${testCase.flag.slice(2)}.json`);
      const fake = makeFake({ mode: "file", fileFlag: testCase.flag, receive: closureReceive, version: "sb 0.2.2\n" });
      const env = remoteEnv(fake.clientConfigPath);
      writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });
      const document = join(fake.dir, `doc-${testCase.flag.slice(2)}.json`);
      writeFileSync(document, testCase.body);
      const inner = localTransport();
      const transport: RemoteTransport = {
        run: (request) => {
          rmSync(document, { force: true });
          return inner.run(request);
        },
      };
      const result = forwardCli(testCase.argv(document), { env, transport });
      assert.equal(result?.code, 0, `${testCase.flag}: ${result?.stderr}`);
      assert.deepEqual(JSON.parse(readFileSync(closureReceive, "utf8")), JSON.parse(testCase.body));
    }
  });

  it("carries the frame marker without an unread byte count", () => {
    const plan = buildRemoteCommand({
      sbPath: "/usr/bin/sb",
      argv: ["issue", "create", "--contract", "x"],
      uploads: [{ argvIndex: 3, content: Buffer.from('{"a":1}') }],
    });
    const markers = (plan.stdin ?? "").split("\n").filter((line) => line.startsWith("@@sb-remote-file "));
    assert.deepEqual(markers, ["@@sb-remote-file f3"]);
  });

  // XTRM-963: the budget is a wall clock, so a test that opens a session with
  // `Date.now() + 80` and then does any work is racing the host, not the rule.
  // Under full-suite parallelism the 80 ms had usually elapsed before the first
  // assertion read it, which made this test fail on a loaded box and pass alone.
  // Freeze the clock instead: every assertion below then measures what the code
  // computes from the remaining budget, and the expiry branch is exercised by
  // advancing the frozen clock deliberately rather than by losing a race.
  it("bounds every transport call by the remaining budget, and by a requested timeout", () => {
    const seen: Array<number | undefined> = [];
    const transport: RemoteTransport = {
      run: (request) => {
        seen.push(request.timeoutMs);
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const dir = tempDir("sb-deadline-");
    const configPath = join(dir, "substrate.json");
    writeClientConfig(configPath, "/usr/bin/sb", {});
    const env = { ...process.env, SUBSTRATE_REMOTE_CONFIG: configPath, SUBSTRATE_REMOTE: "ssh:fake" };

    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      const budgeted = openRemoteSession({ transport, env, deadlineMs: now + 80 });
      assert.ok(budgeted);
      runRemote(budgeted, ["issue", "list"], {});
      assert.equal(typeof seen.at(-1), "number", "a call without a timeout would hang until the ssh default");
      assert.equal(seen.at(-1), 80, "the remaining budget is handed over whole, not clipped to a guess");

      runRemote(budgeted, ["issue", "list"], { timeoutMs: 60_000 });
      assert.equal(seen.at(-1), 80, "a requested timeout never exceeds the budget");

      const unbudgeted = openRemoteSession({ transport, env });
      assert.ok(unbudgeted);
      runRemote(unbudgeted, ["issue", "list"], { timeoutMs: 5_000 });
      assert.equal(seen.at(-1), 5_000, "a requested timeout is honoured below the default");

      // A request shorter than the remaining budget is the only case that proves
      // the two are combined, not replaced: 5 s must beat a 60 s deadline
      // (final review; without Math.min the transport would get 60 s).
      const roomy = openRemoteSession({ transport, env, deadlineMs: now + 60_000 });
      assert.ok(roomy);
      runRemote(roomy, ["issue", "list"], { timeoutMs: 5_000 });
      assert.equal(seen.at(-1), 5_000, `a requested timeout below the budget wins (got ${seen.at(-1)})`);

      // --project keeps the call from stopping at mapping resolution, so the
      // assertion is about the timeout the transport received.
      forwardCli(["issue", "list", "--project", "prj_x"], { env, transport, deadlineMs: now + 80 });
      assert.equal(seen.at(-1), 80, "forwardCli passes the budget on");

      const hook = hookSession(env, { transport, deadlineMs: now + 80 });
      assert.ok(hook);
      runRemote(hook, ["issue", "list"], {});
      assert.equal(seen.at(-1), 80, "hookSession passes the budget on");

      // The expiry branch, deterministically: an elapsed budget must refuse the
      // command before it is sent, so the transport never sees a call.
      const callsBeforeExpiry = seen.length;
      now = (budgeted.deadlineMs ?? now) + 1;
      assert.throws(
        () => runRemote(budgeted, ["issue", "list"], {}),
        /budget expired before the command could be sent/,
        "an elapsed budget must refuse rather than run with a negative timeout",
      );
      assert.equal(seen.length, callsBeforeExpiry, "a refused call must not reach the transport");
    } finally {
      Date.now = realNow;
    }
  });

  it("refuses a document reached through a symlinked directory or a symlinked HOME", () => {
    const saved = { HOME: process.env["HOME"] };
    try {
      const home = tempDir("sb-home-");
      mkdirSync(join(home, ".ssh"), { recursive: true });
      writeFileSync(join(home, ".ssh", "id_ed25519"), "private key");
      process.env["HOME"] = home;
      const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
      const env = remoteEnv(fake.clientConfigPath);
      writeClientConfig(fake.clientConfigPath, fake.sbPath, { [CLIENT_KEY ?? "k"]: { root: fake.dir, projectId: "prj_x" } });

      symlinkSync(join(home, ".ssh"), join(home, "alias"));
      const viaDirectory = forwardCli(["issue", "create", "--project", "prj_x", "--contract", join(home, "alias", "id_ed25519")], { env, transport: localTransport() });
      assert.equal(viaDirectory?.code, 1);
      assert.match(viaDirectory.stderr, /holds secrets or kernel state/);

      const realHome = tempDir("sb-realhome-");
      mkdirSync(join(realHome, ".ssh"), { recursive: true });
      writeFileSync(join(realHome, ".ssh", "id_ed25519"), "private key");
      const linkHome = join(tempDir("sb-homelink-"), "home");
      rmSync(linkHome, { force: true });
      symlinkSync(realHome, linkHome);
      process.env["HOME"] = linkHome;
      const viaHome = forwardCli(["issue", "create", "--project", "prj_x", "--contract", join(linkHome, ".ssh", "id_ed25519")], { env, transport: localTransport() });
      assert.equal(viaHome?.code, 1, "an unresolved $HOME must not defeat the denylist");
      assert.match(viaHome.stderr, /holds secrets or kernel state/);
      assert.equal(fake.calls().length, 0);
    } finally {
      if (saved.HOME === undefined) delete process.env["HOME"];
      else process.env["HOME"] = saved.HOME;
    }
  });

  it("reports a prologue failure as an error envelope in --json mode", () => {
    const transport: RemoteTransport = {
      run: () => ({ code: 72, stdout: "", stderr: "sb remote: the upload stream ended early; nothing ran on the server\n" }),
    };
    const dir = tempDir("sb-envelope-");
    const configPath = join(dir, "substrate.json");
    writeClientConfig(configPath, "/usr/bin/sb", {});
    const env = { ...process.env, SUBSTRATE_REMOTE_CONFIG: configPath, SUBSTRATE_REMOTE: "ssh:fake" };
    const result = forwardCli(["issue", "list", "--json", "--project", "prj_x"], { env, transport });
    assert.equal(result?.code, 72, "the exit code survives, so the caller can tell which step failed");
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout) as { ok: boolean; error: string; command: string };
    assert.equal(envelope.ok, false);
    assert.equal(envelope.command, "issue.list");
    assert.match(envelope.error, /ended early/);
  });
});

// CORE-2787: `issue link pr` reads T2 evidence from the repository it runs in. In
// remote mode that repository is the server's checkout, so a commit pushed from
// this machine seconds ago is missing there and the link loses its evidence. The
// forwarder reads the caller's own repository instead and sends the evidence as
// the document the command already accepts.
describe("issue link evidence read in the caller's repository", () => {
  function clientRepo(): { repo: string; head: string } {
    const repo = tempDir("sb-evidence-client-");
    const git = (args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "t"]);
    writeFileSync(join(repo, "a.txt"), "a");
    git(["add", "a.txt"]);
    git(["commit", "-q", "-m", "init"]);
    writeFileSync(join(repo, "b.txt"), "b");
    git(["add", "b.txt"]);
    git(["commit", "-q", "-m", "feat: work\n\nXTRM-Issue: XTRM-1\nXTRM-Receipt: r1"]);
    const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    return { repo, head };
  }

  const LINK = (project: string) => [
    "issue", "link", "pr", "XTRM-1", "--project", project, "--repo", "o/r", "--number", "7", "--commits-range", "HEAD~1..HEAD",
  ];

  it("sends the evidence the caller read, and removes its temporary document", () => {
    const receive = join(tempDir("sb-evidence-receive-"), "document.json");
    const fake = makeFake({ mode: "file", fileFlag: "--commit-evidence", receive });
    const env = remoteEnv(fake.clientConfigPath);
    const { repo, head } = clientRepo();
    writeClientConfig(fake.clientConfigPath, fake.sbPath, {});
    const saved = process.cwd();
    try {
      process.chdir(repo);
      const outcome = forwardCli(LINK("prj_x"), { env, transport: localTransport() });
      assert.ok(outcome, "the invocation is forwarded");
      assert.equal(outcome.code, 0, outcome.stderr);
      // The first forwarded command is the session's own `project links` probe.
      const call = fake.calls().find((entry) => entry.argv.includes("issue"));
      assert.ok(call, "the link reached the server");
      const index = call!.argv.indexOf("--commit-evidence");
      assert.ok(index > 0, "the forwarded argv carries the evidence document: " + call!.argv.join(" "));
      const document = JSON.parse(readFileSync(receive, "utf8")) as Array<{ sha: string; message: string }>;
      assert.equal(document.length, 1);
      assert.equal(document[0]!.sha, head);
      assert.match(document[0]!.message, /XTRM-Receipt: r1/);
      assert.equal(existsSync(call!.argv[index + 1]!), false, "the caller's temporary document does not outlive the run");
    } finally {
      process.chdir(saved);
    }
  });

  it("retries with the plain argv when the server does not know the flag", () => {
    const fake = makeFake({ mode: "echo", version: "sb 0.2.2\n" });
    const env = remoteEnv(fake.clientConfigPath);
    const { repo } = clientRepo();
    writeClientConfig(fake.clientConfigPath, fake.sbPath, {});
    const saved = process.cwd();
    const inner = localTransport();
    const taken: string[] = [];
    let refused = false;
    const transport: RemoteTransport = {
      run(request) {
        if (!refused && request.command.includes("--commit-evidence")) {
          refused = true;
          taken.push(request.command);
          // The wording assertKnownFlags produces on a server that predates the flag.
          return { code: 1, stdout: "", stderr: "sb: unknown flag --commit-evidence\n" };
        }
        if (request.command.includes("'--commits-range'")) taken.push(request.command);
        return inner.run(request);
      },
    };
    try {
      process.chdir(repo);
      const outcome = forwardCli(LINK("prj_x"), { env, transport });
      assert.ok(outcome);
      assert.equal(outcome.code, 0, outcome.stderr);
      assert.equal(taken.length, 2, "one refused attempt, one plain retry: " + JSON.stringify(taken));
      assert.ok(!taken[1]!.includes("--commit-evidence"), "the retry carries the argv the older server understands");
      const call = fake.calls().find((entry) => entry.argv.includes("issue"));
      assert.ok(call, "the retry reached the server");
      assert.ok(call!.argv.includes("--commits-range"), "the retry still asks the server to read the range itself");
    } finally {
      process.chdir(saved);
    }
  });
});
