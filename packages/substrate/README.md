# @xtrm/substrate

Durable work substrate, Phase 1 (domain + SQLite kernel). Library-first: the
`sb` CLI, Pi extension, and Claude plugin consume `IssueService`, never SQL.

## Layout

- `src/domain/` — three-form identity (§8), contract schema + hashing (§§9–11),
  typed edges + cycle probe (§14)
- `src/store/sqlite.ts` — WAL opener, fail-closed (§§7, 46–47)
- `src/store/migrations/` — append-only runner; landed migrations never edited
- `src/store/transactions.ts` — §7.3 transaction rule + idempotency primitives
- `src/service/issue-service.ts` — CRUD / revision / edge scope only
- `tests/` — acceptance A7–A10, G47, crash-restart, concurrency, fail-closed

## Rules this kernel enforces

- Machine ID (`iss_<uuidv7>`) + human ref (`PREFIX-NNN`) immutable;
  locator derived from monotonic never-reused `child_slot`s; reparenting
  records the old locator as a historical alias.
- Revision only on contract-hash change; `expectedRevision` guards races.
- Key namespaces never collide: `human_ref` / `child_slot` counters plus
  `command` / `plan` / `inbox` / `outbox` idempotency namespaces.
- Corrupt schema or unknown migration state refuses startup/mutation.
- Uncertain external effects are recorded `uncertain`, never guessed.

## CLI (P4)

`cli/sb.ts` (`bin: sb`) is a thin adapter over the typed service — no SQL,
no business logic. Verbs: `issue
create/show/edit/validate/list/ready/tree/children/relate/claim/release/close`
plus `plan check/apply`. Every Issue-taking command accepts all five ID
forms via `resolveRef`. `--json` emits the `substrate-cli/v1` envelope
(see `cli/schema.json`, version 1.0.0, additive-only compat); otherwise one
concise human line per item (locator · humanRef · title [state revN]).

## Deferred to later phases

Journal (P5), provenance (P8), import compat (P11).

## Develop

```sh
npm install
npm test          # node --test, no build step (erasable-syntax TS only)
npm run typecheck # tsc --noEmit
```

Constraint: keep `src/` to erasable TypeScript (no enums, no parameter
properties) so tests run directly on Node ≥24 without a build.
