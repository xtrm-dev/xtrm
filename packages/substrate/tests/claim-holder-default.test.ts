import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { createLocalService } from "../src/service/client.ts";
import { runCli } from "../cli/sb.ts";
import { resolveClaimHolder } from "../src/domain/claim.ts";
import { buildServer } from "../integrations/claude-code/mcp-server.ts";
import { SessionBindings, toolIssueClaim } from "../integrations/pi/handlers.ts";
import type { StoreCall } from "../integrations/pi/backing.ts";
import { contract } from "./helpers.ts";

// XTRM-722: the claim holder defaults to the session's own SUBSTRATE_HOLDER.
// One resolver serves the CLI, the MCP tools and the Pi extension, so an
// explicit holder always wins, an ambient holder is used when the caller states
// none, and neither fails closed — never an implicit unix-user holder. Every
// store here is a scratch database; the live ~/.xtrm/state.db is never touched.

const HOLDER_ENV = "SUBSTRATE_HOLDER";

function withEnv<T>(holder: string | undefined, fn: () => T): T {
  const saved = process.env[HOLDER_ENV];
  if (holder === undefined) delete process.env[HOLDER_ENV];
  else process.env[HOLDER_ENV] = holder;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[HOLDER_ENV];
    else process.env[HOLDER_ENV] = saved;
  }
}

// Async variant: the env must stay set while the awaited work runs.
async function withEnvAsync<T>(holder: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = process.env[HOLDER_ENV];
  if (holder === undefined) delete process.env[HOLDER_ENV];
  else process.env[HOLDER_ENV] = holder;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env[HOLDER_ENV];
    else process.env[HOLDER_ENV] = saved;
  }
}

// -- resolver (shared policy) -------------------------------------------------

describe("resolveClaimHolder (XTRM-722)", () => {
  it("prefers an explicit holder and reports its source", () => {
    assert.deepEqual(resolveClaimHolder("flag-holder", { [HOLDER_ENV]: "env-holder" }), {
      holder: "flag-holder",
      source: "flag",
    });
  });

  it("falls back to a trimmed SUBSTRATE_HOLDER", () => {
    assert.deepEqual(resolveClaimHolder(undefined, { [HOLDER_ENV]: "  env-holder  " }), {
      holder: "env-holder",
      source: "env",
    });
    assert.deepEqual(resolveClaimHolder("   ", { [HOLDER_ENV]: "env-holder" }), {
      holder: "env-holder",
      source: "env",
    });
  });

  it("fails closed naming both ways to supply the holder", () => {
    for (const env of [{}, { [HOLDER_ENV]: "" }, { [HOLDER_ENV]: "   " }]) {
      assert.throws(
        () => resolveClaimHolder(undefined, env),
        (error: Error) => {
          assert.match(error.message, /--holder/);
          assert.match(error.message, /SUBSTRATE_HOLDER/);
          return true;
        },
      );
    }
  });
});

// -- CLI ----------------------------------------------------------------------

interface Scratch {
  dir: string;
  dbPath: string;
  humanRef: string;
}

function scratch(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), "sb-holder-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_demo", prefix: "DEMO", name: "holder" });
  const issue = svc.createIssue({
    projectId: "prj_demo",
    title: "holder work",
    kind: "task",
    contract: contract(),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
  svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  db.close();
  return { dir, dbPath, humanRef: issue.humanRef };
}

function cli(dbPath: string, argv: string[]): { code: number; data: Record<string, unknown>; error?: string } {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  const envelope = JSON.parse(res.stdout) as { ok: boolean; data?: Record<string, unknown>; error?: string };
  return { code: res.code, data: envelope.data ?? {}, error: envelope.error };
}

function storedHolder(dbPath: string, humanRef: string): string | null {
  const db = openSubstrate(dbPath);
  try {
    const svc = new IssueService(db);
    return svc.getActiveClaim(svc.resolveRef(humanRef).id)?.holder ?? null;
  } finally {
    db.close();
  }
}

describe("sb issue claim/release holder default (XTRM-722)", () => {
  let s: Scratch;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => rmSync(s.dir, { recursive: true, force: true }));

  it("claims with SUBSTRATE_HOLDER when --holder is omitted and names its source", () => {
    withEnv("session-holder", () => {
      const res = cli(s.dbPath, ["issue", "claim", s.humanRef, "--project", "prj_demo"]);
      assert.equal(res.code, 0, JSON.stringify(res));
      assert.equal(res.data["holder"], "session-holder");
      assert.equal(res.data["holderSource"], "env");
    });
    assert.equal(storedHolder(s.dbPath, s.humanRef), "session-holder");
  });

  it("an explicit --holder wins over SUBSTRATE_HOLDER", () => {
    withEnv("session-holder", () => {
      const res = cli(s.dbPath, ["issue", "claim", s.humanRef, "--holder", "flag-holder", "--project", "prj_demo"]);
      assert.equal(res.code, 0, JSON.stringify(res));
      assert.equal(res.data["holder"], "flag-holder");
      assert.equal(res.data["holderSource"], "flag");
    });
    assert.equal(storedHolder(s.dbPath, s.humanRef), "flag-holder");
  });

  it("claims with --holder when the environment carries no holder", () => {
    withEnv(undefined, () => {
      const res = cli(s.dbPath, ["issue", "claim", s.humanRef, "--holder", "flag-holder", "--project", "prj_demo"]);
      assert.equal(res.code, 0, JSON.stringify(res));
      assert.equal(res.data["holder"], "flag-holder");
      assert.equal(res.data["holderSource"], "flag");
    });
  });

  it("fails closed with neither --holder nor SUBSTRATE_HOLDER", () => {
    withEnv(undefined, () => {
      const res = cli(s.dbPath, ["issue", "claim", s.humanRef, "--project", "prj_demo"]);
      assert.equal(res.code, 1);
      assert.match(res.error ?? "", /--holder/);
      assert.match(res.error ?? "", /SUBSTRATE_HOLDER/);
    });
    assert.equal(storedHolder(s.dbPath, s.humanRef), null, "no claim row is written on a fail-closed claim");
  });

  it("releases the session's own claim with the environment holder", () => {
    withEnv("session-holder", () => {
      assert.equal(cli(s.dbPath, ["issue", "claim", s.humanRef, "--project", "prj_demo"]).code, 0);
      const released = cli(s.dbPath, ["issue", "release", s.humanRef, "--project", "prj_demo"]);
      assert.equal(released.code, 0, JSON.stringify(released));
      assert.equal(released.data["released"], true);
      assert.equal(released.data["holder"], "session-holder");
      assert.equal(released.data["holderSource"], "env");
    });
    assert.equal(storedHolder(s.dbPath, s.humanRef), null);
  });

  it("still refuses to release another holder's claim without the explicit flag", () => {
    withEnv("session-holder", () => {
      assert.equal(cli(s.dbPath, ["issue", "claim", s.humanRef, "--holder", "flag-holder", "--project", "prj_demo"]).code, 0);
      const released = cli(s.dbPath, ["issue", "release", s.humanRef, "--project", "prj_demo"]);
      assert.equal(released.code, 1);
      assert.match(released.error ?? "", /claim-held/);
    });
    assert.equal(storedHolder(s.dbPath, s.humanRef), "flag-holder", "the foreign claim survives");
  });

  it("fails closed on release with neither --holder nor SUBSTRATE_HOLDER", () => {
    withEnv("session-holder", () => assert.equal(cli(s.dbPath, ["issue", "claim", s.humanRef, "--project", "prj_demo"]).code, 0));
    withEnv(undefined, () => {
      const res = cli(s.dbPath, ["issue", "release", s.humanRef, "--project", "prj_demo"]);
      assert.equal(res.code, 1);
      assert.match(res.error ?? "", /--holder/);
      assert.match(res.error ?? "", /SUBSTRATE_HOLDER/);
    });
  });
});

// -- MCP (Claude surface) -----------------------------------------------------

interface Wire {
  call(name: string, args: Record<string, unknown>): Promise<{ result?: unknown; error?: { message: string } }>;
  close(): Promise<void>;
}

async function linkedServer(): Promise<Wire> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(() => buildServer(), { legacy: "reject", transport: serverT });
  await clientT.start();
  let id = 1;
  const pending = new Map<number, (msg: { result?: unknown; error?: { message: string } }) => void>();
  clientT.onmessage = (msg) => {
    const m = msg as { id?: number; result?: unknown; error?: { message: string } };
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined)) {
      pending.get(m.id)?.(m);
      pending.delete(m.id);
    }
  };
  return {
    call(name, args) {
      const myId = id++;
      return new Promise((resolve) => {
        pending.set(myId, resolve);
        void clientT.send({
          jsonrpc: "2.0",
          id: myId,
          method: "tools/call",
          params: {
            name,
            arguments: args,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": { name: "claim-holder-test", version: "0.0.1" },
            },
          },
        });
      });
    },
    async close() {
      await handle.close();
    },
  };
}

function payload(res: { result?: unknown; error?: { message: string } }): Record<string, unknown> {
  assert.ok(!res.error, JSON.stringify(res.error));
  const result = res.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe("MCP issue_claim holder default (XTRM-722)", () => {
  let s: Scratch;
  let wire: Wire;
  beforeEach(async () => {
    s = scratch();
    wire = await linkedServer();
  });
  afterEach(async () => {
    await wire.close();
    rmSync(s.dir, { recursive: true, force: true });
  });

  it("claims and releases without a holder argument using SUBSTRATE_HOLDER", async () => {
    await withEnvAsync("mcp-session-holder", async () => {
      const claimed = payload(await wire.call("issue_claim", { op: "claim", ref: s.humanRef, project: "prj_demo", dbPath: s.dbPath }));
      assert.equal((claimed["claim"] as { holder: string }).holder, "mcp-session-holder");
      assert.equal(claimed["holderSource"], "env");
      assert.equal(storedHolder(s.dbPath, s.humanRef), "mcp-session-holder");

      const released = payload(await wire.call("issue_claim", { op: "release", ref: s.humanRef, project: "prj_demo", dbPath: s.dbPath }));
      assert.equal(released["holderSource"], "env");
    });
    assert.equal(storedHolder(s.dbPath, s.humanRef), null);
  });

  it("keeps an explicit holder when one is given", async () => {
    await withEnvAsync("mcp-session-holder", async () => {
      const claimed = payload(
        await wire.call("issue_claim", { op: "claim", ref: s.humanRef, holder: "explicit-mcp", project: "prj_demo", dbPath: s.dbPath }),
      );
      assert.equal((claimed["claim"] as { holder: string }).holder, "explicit-mcp");
      assert.equal(claimed["holderSource"], "flag");
    });
  });

  it("refuses a claim with neither holder nor SUBSTRATE_HOLDER", async () => {
    await withEnvAsync(undefined, async () => {
      const res = await wire.call("issue_claim", { op: "claim", ref: s.humanRef, project: "prj_demo", dbPath: s.dbPath });
      const failed = res.error !== undefined || (res.result as { isError?: boolean } | undefined)?.isError === true;
      assert.equal(failed, true, "a holderless claim must fail closed");
    });
    assert.equal(storedHolder(s.dbPath, s.humanRef), null);
  });
});

// -- Pi extension -------------------------------------------------------------

describe("Pi substrate_issue_claim holder default (XTRM-722)", () => {
  let s: Scratch;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => rmSync(s.dir, { recursive: true, force: true }));

  it("claims and binds the session with SUBSTRATE_HOLDER when holder is omitted", async () => {
    await withEnvAsync("pi-session-holder", async () => {
      const backing = createLocalService(s.dbPath, "test");
      try {
        const bindings = new SessionBindings();
        const result = await toolIssueClaim(backing, bindings, { ref: s.humanRef, sessionId: "sess-1" });
        assert.equal(result["holder"], "pi-session-holder");
        assert.equal(result["holderSource"], "env");
        assert.equal(bindings.identityFor("sess-1")?.holder, "pi-session-holder");
      } finally {
        await backing.close();
      }
    });
    assert.equal(storedHolder(s.dbPath, s.humanRef), "pi-session-holder");
  });

  it("resolves in the Pi process and sends the holder explicitly over the backing", async () => {
    // The remote Pi path is a typed-service call, and the far side strips its own
    // ambient identity (sb serve). The holder must therefore be resolved HERE and
    // travel as a claim argument, never as something the server could invent.
    await withEnvAsync("pi-session-holder", async () => {
      const local = createLocalService(s.dbPath, "test");
      const sent: Array<{ op: string; args: Record<string, unknown> }> = [];
      const backing: StoreCall = {
        async call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
          sent.push({ op, args });
          return local.call<T>(op, args);
        },
      };
      try {
        await toolIssueClaim(backing, new SessionBindings(), { ref: s.humanRef, sessionId: "sess-remote" });
      } finally {
        await local.close();
      }
      const claim = sent.find((entry) => entry.op === "issue.claimIssue");
      assert.ok(claim, "the claim travels as a typed-service call");
      assert.equal(claim.args["holder"], "pi-session-holder", "the resolved holder is an explicit argument, not server-side state");
    });
    assert.equal(storedHolder(s.dbPath, s.humanRef), "pi-session-holder");
  });
});
