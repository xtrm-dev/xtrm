# @xtrm/substrate

Durable work substrate (Substrate Issues v0). Library-first: the `sb` CLI,
Pi extension, and Claude plugin consume the typed service, never SQL.

## Layout

- `src/domain/` — three-form identity (§8), contract schema + hashing (§§9–11),
  typed edges + cycle probe (§14)
- `src/store/sqlite.ts` — WAL opener, fail-closed (§§7, 46–47)
- `src/store/migrations/` — append-only runner; landed migrations never edited
- `src/store/transactions.ts` — §7.3 transaction rule + idempotency primitives
- `src/service/` — issues, readiness/planning, claims/leases, journal/resume
- `integrations/pi/` — native Pi extension over the typed service
- `skills/using-substrate/` — agent doctrine (Pi content owned here)
- `tests/` — per-phase acceptance plus CLI and integration smoke

## Rules this kernel enforces

- Machine ID (`iss_<uuidv7>`) + human ref (`PREFIX-NNN`) immutable;
  locator derived from monotonic never-reused `child_slot`s; reparenting
  records the old locator as a historical alias.
- Revision only on contract-hash change; `expectedRevision` guards races.
- Key namespaces never collide: `human_ref` / `child_slot` counters plus
  `command` / `plan` / `inbox` / `outbox` idempotency namespaces.
- Corrupt schema or unknown migration state refuses startup/mutation.
- Uncertain external effects are recorded `uncertain`, never guessed.

## CLI

`cli/sb.ts` (`bin: sb`) is a thin adapter over the typed service — no SQL,
no business logic. Groups: `issue` (create/show/edit/note/validate/attest/
list/ready/tree/children/relate/unrelate/claim/release/state/close/reopen/
defer/cancel/archive/resume), `project` (create/link/unlink), `plan`
(check/apply), `journal` (append/checkpoint/show/since/render), `provenance`
(dispatch/trace/commit/receipt/pr/bundle), `import beads`, `export project`.
Every Issue-taking command accepts all five ID forms via `resolveRef`.
`--json` emits the `substrate-cli/v1` envelope (see `cli/schema.json`,
version 1.0.0, additive-only compat); human output is command-specific —
list/ready render one concise line per item
(locator · humanRef · title [state revN]), while `show` prints the header
plus the multi-line contract body.

Side-effect-free surfaces: `sb --help` / `sb help [group [verb]] [--json]`
and `sb --version` never open or create `state.db`. `sb doctor [--json]`
reports the keys `dbPath`, `schemaHealthy`, `schemaError`, `projects`,
`link`, `linkError`, `gitRoot` and exits 0 healthy / 1 otherwise.
`sb issue note` is
append-only journal (no revision bump); `sb issue edit --title/--priority`
is metadata (no revision) while the `--contract`, `--ownership`,
`--context-refs`, and `--scrutiny` flags are execution-relevant
(new revision, readiness invalidated);
`sb issue state` is the canonical lifecycle operation with
close/reopen/defer/cancel/archive aliases; `sb issue unrelate` deactivates a
typed edge fail-closed (`parent_child` stays structural). Start at
`docs/substrate/README.md` for the operator walkthrough.

## Pi integration (P6)

`integrations/pi/` consumes the typed service directly (never `exec sb`):
eight model tools (`substrate_issue_*`, `substrate_journal_*`,
`substrate_provenance_trace`), session→issue bindings, `session_start`
resume surfacing, and a `session_before_compact` handler (mechanical
checkpoint first, secondary-model semantic, custom summary or host-default
fallback). Host-agnostic logic in `handlers.ts`; Pi wiring in
`extension.ts` (API verified against installed Pi 0.84 docs at build time).
Skill: `skills/using-substrate/SKILL.md` (Pi content owned here; the Claude
lane consumes it read-only).

## WorkItemStore + Specialists gate (P9)

`src/workitems/` is the backend-neutral seam (§35): `SubstrateIssueStore`
canonical, `BeadsWorkItemStore` temporary read-only compatibility (no
dual-write), `dispatch-gate.ts` replacing Bead dispatch authority with
Substrate readiness + execution binding (no prompt smuggling by
construction — the gate takes no prompt text). Conformance record:
`docs/substrate/phase10-conformance.md`.

## Beads migration

One-way import only (no dual-write, no reverse sync):
`sb import beads --file <export.jsonl> --project <id>` with optional
`[--edges-file <f>]`, `[--create-project <PREFIX:Name>]`, and `[--dry-run]`.
Imported Beads IDs live on
as aliases, so old refs keep resolving.

## Develop

```sh
npm install
npm test          # node --test, no build step (erasable-syntax TS only)
npm run typecheck # tsc --noEmit
```

Constraint: keep `src/` to erasable TypeScript (no enums, no parameter
properties) so tests run directly on Node ≥24 without a build.

Runtime support: the library imports in-process on Node ≥24 (`node:sqlite`)
and on Bun ≥1.3 (`bun:sqlite`); `openSubstrate()` selects the driver at
runtime with no static `node:sqlite` import. Bun acceptance:
`TMPDIR=/var/tmp bun tests/bun-acceptance.ts`.
