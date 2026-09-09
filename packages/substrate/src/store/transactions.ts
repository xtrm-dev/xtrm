import type { DatabaseSync } from "node:sqlite";

// Transaction rule (PRD §7.3): check revision/idempotency, validate, mutate,
// event, revision, commit atomically — or commit nothing.

// Counter namespaces. 'human_ref' and 'child_slot' share one table but never
// collide: the namespace is part of the primary key.
export const COUNTER_NAMESPACES = ["human_ref", "child_slot"] as const;
export type CounterNamespace = (typeof COUNTER_NAMESPACES)[number];

// Idempotency namespaces. Same key string in different namespaces is a
// different key; keys are never reused across domains.
export const IDEMPOTENCY_NAMESPACES = ["command", "plan", "inbox", "outbox"] as const;
export type IdempotencyNamespace = (typeof IDEMPOTENCY_NAMESPACES)[number];

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* rollback of a failed transaction must not mask the cause */
    }
    throw err;
  }
}

// Monotonic, never-reused allocation inside the caller's transaction.
export function nextInNamespace(db: DatabaseSync, namespace: CounterNamespace, name: string): number {
  if (!(COUNTER_NAMESPACES as readonly string[]).includes(namespace)) {
    throw new Error(`unknown counter namespace: ${namespace}`);
  }
  const row = db
    .prepare("SELECT next_val AS v FROM seq_counters WHERE namespace = ? AND name = ?")
    .get(namespace, name) as { v: number } | undefined;
  if (!row) {
    db.prepare("INSERT INTO seq_counters (namespace, name, next_val) VALUES (?, ?, ?)").run(namespace, name, 2);
    return 1;
  }
  db.prepare("UPDATE seq_counters SET next_val = ? WHERE namespace = ? AND name = ?").run(row.v + 1, namespace, name);
  return row.v;
}

// Idempotent mutation: the first call runs fn and records its JSON result;
// replays with the same (namespace, key) return the recorded result without
// re-executing. Must be called inside withTransaction.
export function mutateOnce<T>(db: DatabaseSync, namespace: IdempotencyNamespace, key: string, fn: () => T): T {
  if (!(IDEMPOTENCY_NAMESPACES as readonly string[]).includes(namespace)) {
    throw new Error(`unknown idempotency namespace: ${namespace}`);
  }
  const prior = db
    .prepare("SELECT result_json AS r FROM idempotency_keys WHERE namespace = ? AND key = ?")
    .get(namespace, key) as { r: string } | undefined;
  if (prior) return JSON.parse(prior.r) as T;
  const result = fn();
  db.prepare("INSERT INTO idempotency_keys (namespace, key, result_json, created_at) VALUES (?, ?, ?, ?)").run(
    namespace,
    key,
    JSON.stringify(result),
    Date.now(),
  );
  return result;
}
