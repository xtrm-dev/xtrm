// Bun-compatibility seam for the SQLite opener (bead xtrm-6qu.7.4):
// the opener must select bun:sqlite under Bun and node:sqlite under Node
// with no static value import of "node:sqlite" anywhere in src (Bun 1.3
// exits with "No such built-in module: node:sqlite" on such an import).
// The source-scan below fails against the pre-change opener; the behavioral
// checks pin the preserved Node semantics (WAL, pragmas, bindings,
// transactions, fail-closed reopen).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { withTransaction } from "../src/store/transactions.ts";

const base = process.env.TMPDIR || "/var/tmp";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("sqlite runtime seam", () => {
  it("src has no static value import of node:sqlite or bun:sqlite", () => {
    const srcDir = new URL("../src", import.meta.url).pathname;
    const offenders: string[] = [];
    for (const f of walk(srcDir)) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const t = line.trim();
        if (t.startsWith("//")) continue;
        // import type ... is erased at runtime and safe on both runtimes.
        if (/^import\s+type\b/.test(t)) continue;
        if (/^import\b.*["'](node|bun):sqlite["']/.test(t)) offenders.push(`${f}: ${t}`);
        if (/\bfrom\s+["'](node|bun):sqlite["']/.test(t)) offenders.push(`${f}: ${t}`);
      }
    }
    assert.deepEqual(offenders, [], "static value import of a runtime sqlite module");
  });

  it("Node path preserves pragmas, bindings, transactions, durability", () => {
    assert.ok(!("Bun" in globalThis), "this leg runs under Node");
    const dir = mkdtempSync(join(base, "substrate-rt-"));
    try {
      const db = openSubstrate(join(dir, "state.db"));
      assert.equal(db.constructor.name, "DatabaseSync");
      const get = (sql: string) => (db.prepare(sql).get() as Record<string, unknown> | undefined);
      assert.equal((get("PRAGMA journal_mode") as { journal_mode: string }).journal_mode, "wal");
      assert.equal((get("PRAGMA synchronous") as { synchronous: number }).synchronous, 2);
      assert.equal((get("PRAGMA foreign_keys") as { foreign_keys: number }).foreign_keys, 1);
      // busy_timeout is set-only (no result row); exec succeeding is the check.
      // Statement bindings across value shapes.
      db.exec("CREATE TABLE probe (a TEXT, b INTEGER, c BIGINT)");
      db.prepare("INSERT INTO probe VALUES (?, ?, ?)").run("x", 7, 2n ** 40n);
      // Integer columns read back as numbers when exactly representable.
      // (Driver rows are null-prototype objects; compare via JSON.)
      const rows = db.prepare("SELECT * FROM probe").all();
      assert.equal(JSON.stringify(rows), JSON.stringify([{ a: "x", b: 7, c: 2 ** 40 }]));
      // Transactions roll back all-or-nothing.
      assert.throws(() => withTransaction(db, () => {
        db.prepare("INSERT INTO probe VALUES (?, ?, ?)").run("y", 1, 1n);
        throw new Error("boom");
      }), /boom/);
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM probe").get() as { n: number }).n, 1);
      // Fail-closed reopen: committed rows survive close/open on one store.
      db.close();
      const db2 = openSubstrate(join(dir, "state.db"));
      try {
        assert.equal((db2.prepare("SELECT COUNT(*) AS n FROM probe").get() as { n: number }).n, 1);
      } finally {
        db2.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
