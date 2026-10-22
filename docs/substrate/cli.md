# `sb` command surface — operator reference

The release gate imports `COMMAND_HELP` from `packages/substrate/cli/sb.ts`
at run time and fails CI if any registered command lacks a section here,
or if any command documented here is not registered
(`packages/substrate/tests/docs-drift-gate.test.ts`). This page is an
inventory with one-line semantics; per-verb flags and methodology live
behind `sb <group> <verb> --help`, which never opens the database.

Global flags: `--db PATH` (else `$SUBSTRATE_DB`, else `~/.xtrm/state.db`),
`--json` (machine envelope `{schema, command, ok, data|error}`).
`sb --help` and `sb --version` never touch state.db.

## init / doctor

- `sb init` — initialize this Git repository (derive identity, detect
  base branch, create/adopt the deterministic Project, bind, verify).
  Atomic, idempotent. Takes no verbs.
  See [`repository-identity.md`](./repository-identity.md).
- `sb doctor` — store health, repository key, initialization state, bound
  Project, effective override. Exit 0 healthy / 1 otherwise. Takes no verbs.

## issue — 22 verbs

- `issue create --project <id> --title <t> --kind <epic|task|bug|decision|research|followup> --contract <file|json> [--scrutiny <LOW|MEDIUM|HIGH|CRITICAL>]` — create; pins the
  seven-field contract at write time. --scrutiny wins when present, otherwise the contract's own scrutiny applies; a missing or invalid value is refused at create naming the accepted levels.
- `issue show <ref>` — header plus contract body (human) or full payload
  (`--json`).
- `issue edit <ref> [--title/--priority | --contract/--ownership/--context-refs/--scrutiny]` —
  metadata (no revision) vs execution-bearing (new revision, attestation
  invalidated). Never use for progress — journal instead.
- `issue note <ref> ["text"] --kind <note|finding|decision|blocker|milestone|handoff>` —
  append-only journal fast path, never bumps the revision.
- `issue validate <ref>` — derived readiness: state, structural validity,
  attestation currency, blockers.
- `issue attest <ref> --outcome <ready|reject> --policy <p> --attested-by <who>` —
  explicit semantic sign-off for one contract revision.
- `issue list [--project <id>]` — all Issues in the Project.
- `issue ready [--project <id>]` — dispatchable Issues only.
- `issue query --project <id> [--limit <n>] [--cursor <c>] [--lifecycle <s,...>] [--kind <k,...>] [--readiness <r,...>] [--search <q>]` — one paged board page (rows/nextCursor/hasMore/scanned/truncated).
- `issue tree [--project <id> | --root <ref>]` / `issue children <ref>` —
  hierarchy views.
- `issue relate --from <ref> --to <ref> --kind <blocks|relates_to|discovered_from|supersedes|duplicates>` —
  relate; `issue unrelate` deactivates the edge. Only `blocks` edges
  affect readiness.
- `issue claim <ref> --holder <who>` / `issue release <ref> --holder <who>` —
  atomic lease, exactly one live holder; anti-steal, expiry closes the old
  generation first. `--holder` defaults to `SUBSTRATE_HOLDER`. A repeated
  claim by the live holder does not extend the lease.
- `issue renew <ref> [--holder <who>] [--ttl-ms <ms>]` — extend the live
  claim's expiry (holder defaults to `SUBSTRATE_HOLDER`).
- `issue state <ref> <open|deferred|done|cancelled|archived>` — set the
  lifecycle state; every transition emits a durable event.
- `issue close|reopen|cancel|archive <ref>` — lifecycle aliases:
  `issue close` (= state `done`), `issue reopen` (= `open`),
  `issue cancel` (= `cancelled`), `issue archive` (= `archived`);
  `issue defer <ref>` = state `deferred`.
  `close` explains outcomes/reason/provenance — see
  [`provenance.md`](./provenance.md).
- `issue resume <ref>` — bounded Resume Capsule (derived, never a source
  of truth).

`<ref>` is a machine ID, durable reference, locator, historical locator,
or alias. Mutating verbs resolve the effective project context
(`--project` > `SUBSTRATE_PROJECT` > repository binding > checkout link)
and fail closed across Projects.

## project — administration (normal work uses `sb init`)

Advanced/recovery surface only (ADR sbcloseout4 §18), not the normal
onboarding workflow. New repositories start with `sb init`.

- `project create --prefix <PREFIX> --name <name>` — low-level creation.
- `project link --project <id>` — link the cwd checkout to a project.
  `--project` is required: bare `project link` never infers the Project.
- `project unlink` — remove the cwd checkout link (the local alias only).
- `project list` — list every project in this database.
- `project show [--project <id>]` — show one project with its repository
  bindings; without `--project` it shows the resolved project, and an
  uninitialized checkout fails closed instead of guessing.
- `project links` — list the local checkout aliases (inspection; the
  repository binding is the authority).
- `project repair` — re-establish the cwd checkout alias from the
  repository binding and verify resolution. Fails closed without a
  binding: run `sb init`.

## plan

- `plan check --file <plan.json>` — validate a plan draft (cycles fail).
- `plan apply --file <plan.json>` — execute it against the effective
  project context.

## journal

- `journal append <ref> --kind <checkpoint|handoff|milestone|decision|finding|blocker|result|compaction|note> [--mechanical/--semantic/--refs <file|json>] [--summary-file <path|->] [--result <file|json>]` —
  full journal surface; `checkpoint`/`compaction` require a mechanical row, `result` requires a bounded
  `--result` payload. `result` carries a bounded execution outcome with an optional result payload and is
  required for a meaningful settlement: a progress note or a contract edit must not be used in place of a result.
  Summary text is limited to 16,000 characters (CLI, MCP and Pi alike); longer text fails, never cut.
- `journal checkpoint <ref>` — mechanical-first checkpoint now.
- `journal show <ref> [--kind <k>] [--limit <n>]` — full bodies, newest last.
- `journal since <ref> <cursor>` — compact delta after cursor (0 reads all).
- `journal latest <ref> [--kind <k>]` — the newest entry, optionally of one kind.
- `journal timeline <ref> [--limit <n>] [--kind <k>]` — bounded chronological entries.
- `journal render <ref> [--sequence <n>]` — render a checkpoint as text.

Kind doctrine and examples: [`journal.md`](./journal.md).

## provenance

- `provenance dispatch <ref>` — bind an execution to the Issue revision.
- `provenance allocate <binding-id|ref> [--checkpoint <entry-id>]` — create the
  host-owned receipt for that binding; `--checkpoint` links the Journal
  checkpoint that settles the execution, and omitting it records an explicit
  null.
- `provenance bind <receipt-id> <40-char-sha>` — link the receipt to the commit
  carrying its work. Idempotent for the same SHA; a receipt already bound to
  another SHA fails closed instead of silently re-pointing.
- `provenance trace <ref>` — full lineage spine.
- `provenance commit <40-char-sha>` / `provenance receipt <id>` /
  `provenance pr <provider-ref>` — reverse lookups.
- `provenance session <session-id>` / `provenance activation <activation-id>` —
  session-centric queries (what a session touched / what an activation produced).
- `provenance bundle <ref>` — portable evidence set.

Graphs and closure doctrine: [`provenance.md`](./provenance.md).

## import / export

- `import beads --file <export.jsonl> --project <id>` — one-way Beads
  migration (`--dry-run` reports without mutating). Imported IDs live on
  as aliases.
- `export project --project <id> [--file <path>]` — project snapshot.

## MCP and Pi tools (shared surface)

Claude (MCP server `integrations/claude-code/mcp-server.ts`) and Pi
(`integrations/pi/extension.ts`, names prefixed `substrate_`) expose the same
nine tools with the same parameter keys. Names, one-line descriptions and
parameter docs are defined once in `packages/substrate/integrations/tool-surface.ts`
(under 5000 characters in total); behaviour lives in `integrations/tool-core.ts`.

```text
issue_get  issue_list  issue_claim  issue_update  issue_close
journal_append  journal_read  resume_capsule  provenance
```

- `issue_list` covers listing, ready and search; `claimedBy` (holder or `me`)
  returns `{holder, issues}` with each claim and the latest handoff.
- `issue_claim` takes `op` claim|renew|release; `holder` defaults to
  `SUBSTRATE_HOLDER`, else the xt worktree name.
- `issue_close` warns when `completed` cites no refs; `participant` defaults
  to the resolved identity.
- `journal_append` writes every writable kind with a summary (`checkpoint`
  takes the mechanical path); `journal_read` takes `mode`
  latest|since|timeline|show and returns full bodies.
- `provenance` takes exactly one of `ref`, `sessionId`, `activationId`.

The journal kind glossary is `sb help kinds`; the removed tool names and their
replacements are listed in `packages/substrate/CHANGELOG.md`. Pi also keeps
the `substrate-resume` command, the claim-gated edit/write `tool_call` gate
and the advisor (`integrations/pi/advisor.ts`): the same advisories and status
widget as the Claude plugin hooks and mod (`docs/advisories.md`).

## Help is methodology

`sb help init`, `sb issue edit --help` (says: not for progress),
`sb issue note --help`, `sb issue close --help`
(outcomes/reason/provenance), `sb journal --help`, `sb provenance --help`
— help teaches the model, not only flags. Skills must teach the same
model; any skill teaching a retired command or bypassing Journal
methodology fails the gate.
