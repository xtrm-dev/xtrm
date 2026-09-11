// Runtime-neutral SQLite handle types for the Substrate store.
//
// node:sqlite (DatabaseSync, Node >=22.5) and bun:sqlite (Database, Bun >=1)
// expose the same structural surface used by every service: exec, prepare,
// and one-shot get/all/run statements plus close. Services depend only on
// this interface, so the opener (./sqlite.ts) can select the driver at
// runtime without any static value import of "node:sqlite" (which Bun
// cannot resolve). Erasable syntax only: no enums, no parameter properties.

export type SQLInputValue = null | number | bigint | string | NodeJS.ArrayBufferView;

export interface SubstrateStatement {
  get(...params: SQLInputValue[]): Record<string, unknown> | undefined;
  all(...params: SQLInputValue[]): Array<Record<string, unknown>>;
  run(...params: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export interface SubstrateDatabase {
  exec(sql: string): void;
  prepare(sql: string): SubstrateStatement;
  close(): void;
}

// Alias kept so existing service code reads unchanged; both drivers satisfy
// SubstrateDatabase structurally (verified by the sqlite-runtime tests).
export type DatabaseSync = SubstrateDatabase;
