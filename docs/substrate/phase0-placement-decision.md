# Phase 0 — Package/toolchain placement decision (frozen)

**Bead:** `xtrm-7wc.1` · **PRD freeze:** `ca3ae04` (merge #121) · **Date:** 2026-09-09
**Basis:** PRD §§6, 51; `packages/xts/package.json` precedent; root-toolchain
absence; `docs/monorepo-migration.md`.

## Decisions

1. **Location and language.** `packages/substrate/`, TypeScript, laid out per PRD
   §6 (`src/domain|service|store/migrations|projections|compatibility/beads|exports`,
   `cli/`, `integrations/pi|claude-code/`, `hooks/`, `skills/using-substrate/`,
   `contracts/`, `tests/`). Resolves the Node-vs-Python precedent conflict in
   favor of TypeScript per the PRD baseline.
2. **Packaging.** Single npm artifact `@xtrm/substrate` version `0.1.0` with
   `bin sb`, following the `packages/xts` precedent (`type module`,
   `files [src, README.md]`, `engines node >=24`, `publishConfig restricted`).
   The CLI is a thin consumer of the exported `IssueService` library
   (library-first §6.1); Pi extension, Claude plugin/MCP, and hooks consume the
   same typed service, never `exec("sb …")`. A future split (CLI vs extension
   artifacts) stays open per §51 but is **not** taken now.
3. **SQLite access.** `node:sqlite` (Node built-in, no native dependency) in WAL
   mode at `~/.xtrm/state.db`, multi-project. Rationale: zero native-dep install
   friction under the per-package-lockfile precedent; WAL crash-safety per §47.
4. **Migrations.** Hand-rolled append-only versioned migration runner against a
   `schema_migrations` table (baseline table list: PRD §44). No query
   builder / migration framework is introduced in v0. Landed migrations are
   never edited; only new migrations append (epic shared requirement).
5. **TS config.** Per-package strict `tsconfig.json` inside
   `packages/substrate/` (no root base exists; no root wiring is introduced by
   this programme — see open point 1 below).
6. **Identity formatting.** `iss_<uuidv7>` machine IDs via the `uuid` package
   (`uuidv7()`); durable refs `XTRM-NNN` via per-project atomic counters;
   hierarchical locators derived from monotonic never-reused `child_slot`s (§8).
7. **Key namespaces.** WAL human-reference counters, `child_slot` allocation,
   and outbox/inbox idempotency keys use distinct key namespaces; keys never
   reused across domains (.2 constraint, recorded here so .3–.10 inherit it).
8. **Skills/hooks placement.** Authored in-package (`skills/using-substrate/`,
   `hooks/`); promotion to root-active copies follows the existing
   `scripts/install-beads-hooks.sh` + `.bd-sync` pattern at cutover (.12),
   not during implementation phases.

## Open points (explicitly not decided here; owned by later beads)

1. Whether to introduce root plumbing (root `package.json` workspaces,
   `tsconfig.base.json`, changesets) — owned by the monorepo track, not this
   epic; `packages/substrate` lands standalone with its own manifest + lockfile.
2. Exact TS module boundaries inside `src/` — local to .2+ per §51.
3. Semantic checkpoint model selection — local to .6/.7/.8 per §51.
4. Provenance bundle sharding, GitHub/Jira retry backoff, terminal formatting —
   local to .9/.11 per §51.

## Validation

- Exact package path named: `packages/substrate/`.
- Driver + migration choices named: `node:sqlite` + hand-rolled append-only runner.
- Single-artifact npm decision recorded with precedent cited.
