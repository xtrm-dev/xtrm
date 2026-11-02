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

## remote — dispatch to a server-owned store

Design and limits: [`../runtime/adr/008-substrate-remote-store-access.md`](../runtime/adr/008-substrate-remote-store-access.md).
One argument changes the store, nothing else changes: with
`SUBSTRATE_REMOTE=ssh:<host>` every command is executed by `sb` on that
host over ssh, and the local store is never opened. `--db` or
`SUBSTRATE_DB` keeps the invocation local; `--help`, `--version`,
`doctor`, `help` and `remote` always answer locally.

- `sb remote setup ssh:<host> [--server-root <path>] [--refresh]` — verify the
  remote `sb` (version, latency) and resolve which checkout of this
  repository the server owns. The server reports repository keys, not
  client paths, so the mapping is keyed by `repositoryKey`; `--server-root`
  picks one explicitly when more than one server checkout matches. Writes
  `~/.xtrm/config/substrate.json` and no state.
- `sb remote status` — the configured remote, resolved `sb` path, server
  version, latency, repository key and cached checkout, plus the
  capabilities the server's version actually has. Read-only.
- `sb remote disable` — remove the setting so every consumer (CLI, hooks,
  in-process callers, the MCP launcher) runs locally again, and drop the
  server `sb` path, version and checkout cache. Nothing on the server is
  touched. Remote mode is opt-in and reversible: with no setting there is no
  ssh requirement at all. Precedence is stated, not implied — `disable`
  reports an active `SUBSTRATE_REMOTE`, which outranks the file.

Not yet covered: native dispatch against the server (the stdio server mode
needs server 0.2.3) and `post-rewrite` reconciliation (no CLI verb before
0.2.3).

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
  generation first.
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

- `journal append <ref> --kind <checkpoint|handoff|milestone|decision|finding|blocker|result|compaction|note> [--mechanical/--semantic/--refs <file|json>] [--result <file|json>]` —
  full journal surface; `checkpoint`/`compaction` require a mechanical row, `result` requires a bounded
  `--result` payload. `result` carries a bounded execution outcome with an optional result payload and is
  required for a meaningful settlement: a progress note or a contract edit must not be used in place of a result.
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

## MCP tools (Claude integration)

Registered in `packages/substrate/integrations/claude-code/mcp-server.ts`
in stable order (served in-process, never via CLI text):

```text
issue_get  issue_list  issue_ready
issue_claim  issue_update  issue_note  issue_close
journal_append  journal_checkpoint  journal_show  journal_query
provenance_trace  provenance_session  provenance_activation  resume_capsule
```

`issue_get` read one Issue with live readiness; `issue_list` / `issue_ready`
search one Project (all Issues / dispatchable only); `issue_claim`
op-discriminated lease (`op` claim|release, exactly one live holder);
`issue_update` metadata vs revision-bearing writes; `issue_note` append-only
journal fast path; `issue_close` canonical close with bounded outcome,
reason and cited refs; `journal_append` full nine-kind surface;
`journal_checkpoint` mechanical-first checkpoint now; `journal_show`
full-body read; `journal_query` op-discriminated bounded reads
(`op` since|latest|timeline); `provenance_trace` lineage spine;
`resume_capsule` derived continuity capsule with rendering.

Every tool carries a description (normative instruction surface, ADR
§63): what the tool changes, what it does not change, whether the Issue
revision changes, whether readiness goes stale, when to use the Journal
instead of a contract edit, and what actor/session/provenance context is
added automatically. Journal-facing tools explain all nine kinds (ADR §64).
The exported registration inventory lives in
`packages/substrate/integrations/claude-code/mcp-server.ts`
(`MCP_TOOL_NAMES`, `MCP_TOOL_DESCRIPTIONS`), and the release gate checks
name presence, non-trivial description depth and inventory agreement —
description inventory LANDED, owner M1.

## Pi tools

`integrations/pi/` consumes the typed service directly (never `exec sb`):
`substrate_issue_get/search/claim/update`,
`substrate_journal_append/checkpoint`, `substrate_issue_resume`,
`substrate_provenance_trace`, plus the `substrate-resume` command and the
claim-gated edit/write `tool_call` gate.

## Help is methodology

`sb help init`, `sb issue edit --help` (says: not for progress),
`sb issue note --help`, `sb issue close --help`
(outcomes/reason/provenance), `sb journal --help`, `sb provenance --help`
— help teaches the model, not only flags. Skills must teach the same
model; any skill teaching a retired command or bypassing Journal
methodology fails the gate.
