// One backing per session (XTRM-711), and the retry rule that belongs with it.
//
// The measurement that motivated this: a Pi tool call opened ssh for that call
// alone, 639/658/633 ms across three runs, and the edit gate did the same on
// every edit. These tests count connections instead of timing them, so a
// regression to per-call opening fails here rather than showing up as latency.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SessionBacking, type Backing } from "../integrations/pi/backing.ts";
import { isReadOperation, readOperations } from "../src/service/operations.ts";
import { OPERATIONS } from "../src/service/ops.ts";

interface Fake {
  backing: Backing;
  calls: Array<{ op: string; args: Record<string, unknown> }>;
  closed: boolean;
}

function fake(answer: (op: string) => unknown): Fake {
  const record: Fake = {
    calls: [],
    closed: false,
    backing: {
      kind: "remote",
      where: "ssh:test",
      async call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
        record.calls.push({ op, args });
        const value = answer(op);
        if (value instanceof Error) throw value;
        return value as T;
      },
      async close() {
        record.closed = true;
      },
    },
  };
  return record;
}

function lost(): Error {
  return Object.assign(new Error("connection_lost: the service connection ended"), { code: "connection_lost" });
}

describe("a session holds one backing", () => {
  it("reuses the connection across calls and closes it once", async () => {
    const opened: Fake[] = [];
    const session = new SessionBacking(() => {
      const f = fake(() => ({ ok: true }));
      opened.push(f);
      return f.backing;
    });
    await session.call("issue.get", { ref: "XTRM-711" });
    await session.call("issue.getReadiness", { ref: "XTRM-711" });
    assert.equal(opened.length, 1, "two calls must not open two connections");
    assert.equal(opened[0].calls.length, 2);
    await session.close();
    assert.equal(opened[0].closed, true, "closing the session closes the connection");
    assert.equal(session.connectionCount, 1);
  });

  it("opens again after the session closed, and only then", async () => {
    const opened: Fake[] = [];
    const session = new SessionBacking(() => {
      const f = fake(() => ({ ok: true }));
      opened.push(f);
      return f.backing;
    });
    await session.call("issue.get", { ref: "a" });
    await session.close();
    await session.call("issue.get", { ref: "b" });
    assert.equal(opened.length, 2);
    assert.equal(opened[1].closed, false);
    await session.close();
    assert.equal(opened[1].closed, true);
  });
});

describe("a dropped connection", () => {
  it("retries a read once on a new connection", async () => {
    const opened: Fake[] = [];
    const session = new SessionBacking(() => {
      const f = fake(opened.length === 0 ? () => lost() : () => ({ ok: true }));
      opened.push(f);
      return f.backing;
    });
    const result = await session.call("issue.get", { ref: "XTRM-711" });
    assert.deepEqual(result, { ok: true });
    assert.equal(opened.length, 2, "the dead connection is not reused");
    assert.equal(opened[0].closed, true, "the dead connection is closed before the retry");
  });

  it("does not retry a mutation, because a retry may run twice", async () => {
    const opened: Fake[] = [];
    const session = new SessionBacking(() => {
      const f = fake(() => lost());
      opened.push(f);
      return f.backing;
    });
    await assert.rejects(() => session.call("issue.claimIssue", { ref: "XTRM-711", holder: "h" }), /connection_lost/);
    assert.equal(opened.length, 1, "a mutation is attempted exactly once");
    assert.equal(opened[0].calls.length, 1);
  });

  it("retries a read only once", async () => {
    const opened: Fake[] = [];
    const session = new SessionBacking(() => {
      const f = fake(() => lost());
      opened.push(f);
      return f.backing;
    });
    await assert.rejects(() => session.call("issue.get", { ref: "XTRM-711" }), /connection_lost/);
    assert.equal(opened.length, 2, "one retry, not a loop");
  });

  it("does not retry a failure that is not a lost connection", async () => {
    const opened: Fake[] = [];
    const refused = Object.assign(new Error("ref not found"), { code: "not_found" });
    const session = new SessionBacking(() => {
      const f = fake(() => refused);
      opened.push(f);
      return f.backing;
    });
    await assert.rejects(() => session.call("issue.get", { ref: "nope" }), /ref not found/);
    assert.equal(opened.length, 1, "a refusal is an answer, not a transport failure");
  });
});

describe("the read classification", () => {
  it("names only operations the service actually has", () => {
    const unknown = readOperations().filter((op) => !(op in OPERATIONS));
    assert.deepEqual(unknown, [], "a stale read name would silently make a read unretryable");
  });

  it("treats an unclassified operation as a mutation", () => {
    assert.equal(isReadOperation("issue.somethingNew"), false);
    assert.equal(isReadOperation("issue.get"), true);
  });

  it("does not classify a write as a read", () => {
    for (const op of ["issue.create", "issue.claimIssue", "journal.appendEntry", "journal.enrichEntry", "gate.dispatch", "authority.record"]) {
      assert.equal(isReadOperation(op), false, `${op} must never be retried`);
    }
  });
});
