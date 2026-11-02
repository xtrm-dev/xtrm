// The service on the wire, exercised the way a remote consumer meets it: a real
// `sb serve --stdio` child process, real JSON frames, and a store on the other
// side that the client process never opens.
//
// Design rules this file follows (the lessons from PR #307):
//   - every exchange goes through real parsing; nothing calls a handler directly;
//   - the two stores are distinct files, so a test passes only if the operation
//     really happened where the server lives;
//   - each guard named in a test has a mutation that kills it (proved by running
//     the suite against the mutation, see the commit message).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSubstrate } from "../src/store/sqlite.ts";
import { migrate } from "../src/store/migrations/runner.ts";
import { CAPABILITIES } from "../src/service/ops.ts";
import { PROTOCOL_VERSION, encodeRequest } from "../src/service/protocol.ts";
import { createLocalService, createServiceClient, spawnLink } from "../src/service/client.ts";
import { sshArgv } from "../src/remote/ssh.ts";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "sb.ts");
const NODE = process.execPath;

interface Frame {
  id: number | string | null;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

/** A client that speaks the protocol over a child's pipes, and can also send junk. */
function spawnServer(dbPath: string): {
  child: ChildProcess;
  send: (frame: unknown) => void;
  sendRaw: (text: string) => void;
  next: () => Promise<Frame>;
  lines: () => string[];
  close: () => Promise<void>;
  stderr: () => string;
} {
  const child = spawn(NODE, [CLI, "serve", "--stdio", "--db", dbPath], { stdio: ["pipe", "pipe", "pipe"] });
  const received: Frame[] = [];
  const raw: string[] = [];
  const waiters: Array<(frame: Frame) => void> = [];
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  createInterface({ input: child.stdout!, crlfDelay: Infinity }).on("line", (line) => {
    raw.push(line);
    let frame: Frame;
    try {
      frame = JSON.parse(line) as Frame;
    } catch {
      frame = { id: null, ok: false, error: { code: "not_json", message: line } };
    }
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else received.push(frame);
  });
  return {
    child,
    send: (frame) => child.stdin!.write(JSON.stringify(frame) + "\n"),
    sendRaw: (text) => child.stdin!.write(text),
    next: () =>
      new Promise<Frame>((resolve, reject) => {
        const queued = received.shift();
        if (queued) resolve(queued);
        else {
          const timer = setTimeout(() => reject(new Error("no frame arrived within 10 s")), 10_000);
          waiters.push((frame) => {
            clearTimeout(timer);
            resolve(frame);
          });
        }
      }),
    lines: () => [...raw],
    stderr: () => stderr,
    close: () =>
      new Promise<void>((resolve) => {
        // Already gone: a second close must not wait for an event that fired.
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once("close", () => resolve());
        child.stdin!.end();
      }),
  };
}

function tempDb(label: string): string {
  return join(mkdtempSync(join(tmpdir(), `sb-service-${label}-`)), "state.db");
}

async function handshake(server: ReturnType<typeof spawnServer>, protocol = PROTOCOL_VERSION): Promise<Frame> {
  server.send({ id: 0, op: "hello", args: { protocol, client: "test" } });
  return server.next();
}

describe("sb serve --stdio", () => {
  it("answers the handshake with the protocol, the version and a closed capability list", async () => {
    const server = spawnServer(tempDb("hello"));
    try {
      const hello = await handshake(server);
      assert.equal(hello.ok, true, JSON.stringify(hello.error));
      assert.equal(hello.result?.["protocol"], PROTOCOL_VERSION);
      assert.equal(typeof hello.result?.["substrate"], "string");
      assert.match(String(hello.result?.["substrate"]), /^\d+\.\d+\.\d+/);
      const capabilities = hello.result?.["capabilities"] as string[];
      assert.deepEqual(capabilities, CAPABILITIES);
      assert.ok(capabilities.includes("issue.getActiveClaim"), "the claim read a consumer needs is advertised");
      assert.ok(capabilities.includes("authority.record"), "activation authority is advertised");
      assert.ok(!capabilities.some((op) => /sql|exec|expression/i.test(op)), "no operation widens the surface to SQL");
    } finally {
      await server.close();
    }
  });

  it("refuses a write before hello, and still serves the next frame", async () => {
    const server = spawnServer(tempDb("gate"));
    try {
      server.send({ id: 1, op: "authority.record", args: { activationId: "act_gate", specialist: "researcher", state: "running", lastActivityAt: 1 } });
      const refused = await server.next();
      assert.equal(refused.ok, false);
      assert.equal(refused.error?.code, "bad_request");
      assert.match(String(refused.error?.message), /hello/);

      const hello = await handshake(server);
      assert.equal(hello.ok, true, "the connection survives a refused frame");
      server.send({ id: 2, op: "authority.list", args: {} });
      const answered = await server.next();
      assert.equal(answered.id, 2);
      assert.equal(answered.ok, true, JSON.stringify(answered.error));
    } finally {
      await server.close();
    }
  });

  it("names a protocol mismatch instead of failing later on a domain error", async () => {
    const server = spawnServer(tempDb("protocol"));
    try {
      const refused = await handshake(server, PROTOCOL_VERSION + 1);
      assert.equal(refused.ok, false);
      assert.equal(refused.error?.code, "unsupported");
      assert.match(String(refused.error?.message), new RegExp(`speaks ${PROTOCOL_VERSION}`));

      // Not greeted: the refusal must not have opened the door.
      server.send({ id: 2, op: "authority.list", args: {} });
      const after = await server.next();
      assert.equal(after.error?.code, "bad_request");

      const ok = await handshake(server);
      assert.equal(ok.ok, true);
    } finally {
      await server.close();
    }
  });

  it("answers a malformed frame with an id-less error and keeps the store open", async () => {
    const server = spawnServer(tempDb("malformed"));
    try {
      server.sendRaw("not a frame\n");
      const first = await server.next();
      assert.equal(first.id, null);
      assert.equal(first.ok, false);
      assert.equal(first.error?.code, "bad_request");

      const hello = await handshake(server);
      assert.equal(hello.ok, true, "a junk line must not end the session");
      server.send({ id: 3, op: "authority.list", args: {} });
      const listed = await server.next();
      assert.equal(listed.ok, true);
    } finally {
      await server.close();
    }
  });

  it("rejects an unknown operation by name", async () => {
    const server = spawnServer(tempDb("unknown"));
    try {
      await handshake(server);
      server.send({ id: 4, op: "issue.sql", args: {} });
      const refused = await server.next();
      assert.equal(refused.ok, false);
      assert.equal(refused.error?.code, "unknown_op");
      assert.match(String(refused.error?.message), /issue\.sql/);
    } finally {
      await server.close();
    }
  });

  it("writes and reads where the store lives, not where the client runs", async () => {
    const serverDb = tempDb("server");
    const clientDb = tempDb("client");
    // A local service on the CLIENT's file: this is what a consumer would touch
    // if the service did not exist, and it must stay empty.
    const client = createLocalService(clientDb, "0.2.4-test");
    const server = spawnServer(serverDb);
    try {
      const hello = await handshake(server);
      assert.equal(hello.ok, true, JSON.stringify(hello.error));

      server.send({
        id: 5,
        op: "authority.record",
        args: { activationId: "act_wire_1", specialist: "researcher", state: "running", lastActivityAt: 1_700_000_000_000 },
      });
      const recorded = await server.next();
      assert.equal(recorded.ok, true, JSON.stringify(recorded.error));
      assert.deepEqual(recorded.result, { activationId: "act_wire_1" });

      server.send({ id: 6, op: "authority.list", args: {} });
      const listed = await server.next();
      assert.deepEqual(listed.result?.["rows"], [
        { activationId: "act_wire_1", specialist: "researcher", state: "running", issueRef: null, lastActivityAt: 1_700_000_000_000 },
      ]);

      // The row is in the server's file, read without the service.
      const store = openSubstrate(serverDb);
      migrate(store);
      const rows = store.prepare("SELECT activation_id, specialist FROM activations").all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.["activation_id"], "act_wire_1");
      store.close();

      // And absent from the client's file, even through the same op table: the
      // operation succeeds and finds nothing, which is what "different store"
      // means — not an error that would hide a wrong-file write.
      const local = await client.call<{ rows: unknown[] }>("authority.list", {});
      assert.deepEqual(local.rows, []);
      const clientStore = openSubstrate(clientDb);
      migrate(clientStore);
      const clientRows = clientStore.prepare("SELECT COUNT(*) AS n FROM activations").get();
      assert.equal(Number(clientRows?.["n"]), 0);
      clientStore.close();
    } finally {
      client.close();
      await server.close();
    }
  });

  it("carries an issue through create, read and journal append", async () => {
    const serverDb = tempDb("issue");
    const server = spawnServer(serverDb);
    try {
      await handshake(server);
      // A real binding: `sb init` in a throwaway repository, against the same
      // store the service owns. A consumer's project resolution is a lookup of
      // an existing binding, not something the service invents.
      const gitRoot = mkdtempSync(join(tmpdir(), "sb-service-repo-"));
      const init = spawnSync(NODE, ["-e", "0"], { encoding: "utf8" });
      assert.equal(init.status, 0);
      const git = (args: string[]): void => {
        const done = spawnSync("git", args, { cwd: gitRoot, encoding: "utf8" });
        assert.equal(done.status, 0, done.stderr);
      };
      git(["init", "-q", "."]);
      git(["remote", "add", "origin", "git@github.com:xtrm-dev/service-round-trip.git"]);
      const initialized = spawnSync(NODE, [CLI, "init", "--db", serverDb], { cwd: gitRoot, encoding: "utf8" });
      assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);

      server.send({ id: 10, op: "issue.resolveProject", args: { gitRoot } });
      const project = await server.next();
      assert.equal(project.ok, true, JSON.stringify(project.error));
      const projectId = project.result?.["projectId"];
      assert.equal(typeof projectId, "string");

      server.send({
        id: 11,
        op: "issue.create",
        args: {
          input: {
            projectId,
            title: "service round trip",
            kind: "task",
            contract: {
              problem: "a client on another machine needs typed access",
              success: "the operation runs where the store lives",
              scope: ["the service"],
              nonGoals: ["a network listener"],
              constraints: ["no SQL over the wire"],
              validation: [{ check: "a real round trip" }],
              output: [{ artifact: "a row" }],
            },
            scrutiny: "LOW",
            authoredBy: "test",
          },
        },
      });
      const created = await server.next();
      assert.equal(created.ok, true, JSON.stringify(created.error));
      const issue = created.result as unknown as { id: string; humanRef: string };
      assert.equal(issue.humanRef, "SERVICEROUNDTRIP-1", "the ref comes from the project the binding named");

      server.send({ id: 12, op: "issue.get", args: { issueId: issue.id } });
      const fetched = await server.next();
      assert.equal(fetched.ok, true);
      assert.equal((fetched.result as unknown as { title: string }).title, "service round trip");

      server.send({ id: 13, op: "store.addJournal", args: { ref: issue.humanRef, kind: "finding" } });
      const journal = await server.next();
      assert.equal(journal.ok, true, JSON.stringify(journal.error));
      server.send({ id: 14, op: "journal.listEntries", args: { issueId: issue.id } });
      const entries = await server.next();
      assert.equal(entries.ok, true, JSON.stringify(entries.error));
      assert.ok(Array.isArray(entries.result), "a list op answers with the array its service method returns");
      assert.equal((entries.result as unknown[]).length, 1);
    } finally {
      await server.close();
    }
  });

  it("refuses an authority write that is missing a required field", async () => {
    const server = spawnServer(tempDb("validation"));
    try {
      await handshake(server);
      server.send({ id: 30, op: "authority.record", args: { activationId: "act_x", state: "running", lastActivityAt: 1 } });
      const refused = await server.next();
      assert.equal(refused.ok, false);
      assert.equal(refused.error?.code, "bad_request");
      assert.match(String(refused.error?.message), /specialist/);

      server.send({ id: 31, op: "authority.record", args: { activationId: "act_x", specialist: "r", state: "running", lastActivityAt: 0 } });
      const badTime = await server.next();
      assert.equal(badTime.error?.code, "bad_request");
      assert.match(String(badTime.error?.message), /lastActivityAt/);

      server.send({ id: 32, op: "authority.list", args: {} });
      const listed = await server.next();
      assert.deepEqual(listed.result?.["rows"], [], "a refused write wrote nothing");
    } finally {
      await server.close();
    }
  });

  it("serves the same loop when the verb form names it", async () => {
    const dbPath = tempDb("verb");
    const child = spawn(NODE, [CLI, "serve", "stdio", "--db", dbPath], { stdio: ["pipe", "pipe", "pipe"] });
    const line = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no frame")), 10_000);
      createInterface({ input: child.stdout!, crlfDelay: Infinity }).once("line", (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      child.stdin!.write(JSON.stringify({ id: 1, op: "hello", args: { protocol: PROTOCOL_VERSION } }) + "\n");
    });
    child.stdin!.end();
    const frame = JSON.parse(line) as Frame;
    assert.equal(frame.ok, true, JSON.stringify(frame.error));
    await new Promise<void>((resolve) => child.once("close", () => resolve()));
  });

  it("keeps stdout free of diagnostics", async () => {
    const server = spawnServer(tempDb("stdout"));
    try {
      await handshake(server);
      server.send({ id: 20, op: "authority.list", args: { activationId: "missing" } });
      await server.next();
      await server.close();
      for (const line of server.lines()) {
        assert.doesNotThrow(() => JSON.parse(line) as unknown, `stdout line is not a frame: ${line}`);
      }
      assert.match(server.stderr(), /sb serve:/, "diagnostics exist, and they went to stderr");
    } finally {
      await server.close();
    }
  });
});

describe("service client", () => {
  it("times out a call that never answers, and closes the wait", async () => {
    const link = spawnLink([NODE, "-e", "process.stdin.resume()"]);
    const client = createServiceClient(link, { timeoutMs: 150 });
    try {
      await assert.rejects(client.ready(), (error: Error & { code?: string }) => {
        assert.equal(error.code, "timeout");
        return true;
      });
    } finally {
      client.close();
    }
  });

  it("reports a client command that cannot be started, instead of hanging", async () => {
    const link = spawnLink(["/nonexistent/ssh", "host"]);
    const client = createServiceClient(link, { timeoutMs: 5_000 });
    try {
      await assert.rejects(client.ready(), (error: Error) => {
        assert.match(error.message, /cannot run \/nonexistent\/ssh/);
        return true;
      });
    } finally {
      client.close();
    }
  });

  it("names a server that does not speak the protocol", async () => {
    // What a 0.2.2 server does: it prints CLI help, not a frame.
    const link = spawnLink([NODE, "-e", "console.log('usage: sb <group> <verb>'); process.stdin.resume()"]);
    const client = createServiceClient(link, { timeoutMs: 5000 });
    try {
      await assert.rejects(client.ready(), (error: Error & { code?: string }) => {
        assert.equal(error.code, "unsupported");
        assert.match(error.message, /0\.2\.4/);
        return true;
      });
    } finally {
      client.close();
    }
  });

  it("reaches a 'remote' store through an ssh-shaped command, over pipes", async () => {
    // The shim stands in for ssh: it drops the options and runs the command the
    // client built. The service it reaches uses a different file from the one
    // this process would open, which is the whole point of the hop.
    const dir = mkdtempSync(join(tmpdir(), "sb-service-ssh-"));
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "ssh"),
      `#!/bin/sh
for a in "$@"; do last="$a"; done
exec sh -c "$last"
`,
      { mode: 0o755 },
    );
    chmodSync(join(bin, "ssh"), 0o755);
    const serverDb = join(dir, "server", "state.db");
    const env = { ...process.env, PATH: bin + ":" + String(process.env["PATH"] ?? "") };
    const command = `cd ${JSON.stringify(dir)} && ${JSON.stringify(NODE)} ${JSON.stringify(CLI)} serve --stdio --db ${JSON.stringify(serverDb)}`;
    const link = spawnLink(["ssh", ...sshArgv("fake-host", command)], env);
    const client = createServiceClient(link, { timeoutMs: 15_000, client: "test" });
    try {
      const hello = await client.ready();
      assert.equal(hello.protocol, PROTOCOL_VERSION);
      await client.call("authority.record", {
        activationId: "act_via_shim",
        specialist: "reviewer",
        state: "settled",
        lastActivityAt: 1_700_000_000_001,
      });
      const listed = await client.call<{ rows: Array<{ activationId: string }> }>("authority.list", {});
      assert.deepEqual(listed.rows.map((row) => row.activationId), ["act_via_shim"]);
      assert.ok(existsSync(serverDb), "the write landed in the server's file");
    } finally {
      client.close();
    }
  });
});
