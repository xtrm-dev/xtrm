---
status: current
owner: substrate
last_verified_against: 3f3e3cbfbbd03de8fc0926599d6797f4b7eab79f
---

# Troubleshooting

## "This repository is not initialized"

Run:

```bash
sb init
sb doctor
```

Do not pick the only Project in the global database. Repository identity is the
project boundary.

## Wrong/old Project binding

Use `sb doctor --json` to distinguish repository initialization, effective
override and checkout alias. `sb project` verbs are recovery/admin surfaces;
normal onboarding remains `sb init`.

## `sb issue list` hides old closed work

That is the human default. Use:

```bash
sb issue list --all
sb issue list --status closed
```

## Human filter with `--json` fails

Expected. `--status`, `--all`, `--flat` and `--search` are human presentation
filters. The wrapper refuses to pretend they changed the machine JSON contract.

## Provider cannot resume an Issue

Prefer `SUBSTRATE_ISSUE_REF`. `SUBSTRATE_ISSUE` is the compatibility alias. A
session claim can also establish the provider-local binding.

## Pi provenance looks incomplete

Current Pi trace uses `ProvenanceService.trace()`. If receipts/artifacts are
empty, verify that an ExecutionBinding/WorkReceipt actually exists rather than
assuming the provider synthesizes evidence.

## Claude tool surface is missing

Verify the packaged `substrate` plugin and MCP entry, then inspect `tools/list`.
The plugin uses `${CLAUDE_PLUGIN_ROOT}` and the canonical Substrate DB; it does
not execute `sb` text commands.

## Stale instructions

Current product docs live under `packages/substrate/docs`. Root
`docs/substrate` contains architecture/history as well as mechanically retained
reference mirrors; historical phase documents are not current runtime guidance.

## Invalid or missing execution identity

An identity-format rejection names the offending field and writes no partial
row. Supply a canonical XTRM session UUID or quoted tmux ID (`'$2'`), not a job
ID or display name. Provider session labels belong in `host.sessionId`.
Do not rewrite historical rows merely to make a display look attributed.

On CLI Journal append/checkpoint and provenance dispatch, a warning that
`--session` overrides `XTRM_SESSION_ID` means the explicit session was accepted.
Check that the override was intentional. JSON stdout remains machine-readable;
the warning is on stderr.

If attribution is absent, inspect explicit caller inputs and the process
`SUBSTRATE_HOLDER` / `SUBSTRATE_ACTIVATION_ID` environment. A null field is not
evidence of an inferred participant. See [Integrations](integrations.md#identity-propagation)
for the adapter-specific limits.

## No Substrate workspace lease

Migration v12 removed `workspace_leases` and the Substrate lease API. Do not
query that table or rely on a Substrate claim for cross-Issue workspace
exclusion. Claims still protect Issue mutations; the Specialists activation
layer owns workspace exclusion.

If an older client reports `unknown migration version 12`, update that client
to a compatible Substrate version. Do not delete migrations or downgrade the
database to bypass fail-closed version checks. The same applies to every later
migration: once any client opens the shared store with a newer Substrate, every
older `sb` on that store fails closed with `unknown migration version <n>`
(migration 17, `dispatcher-identity`, needs the `sb` release that ships it;
0.3.3 and earlier do not know it). Upgrade every `sb` binary that opens the
store before the first newer one touches it.

## Previously imported Beads data

The forward importer does not automatically repair previously imported rows.
The source-checkout repair script uses the original export to restore contract
structure, source timestamps and missing Closure records through typed services.
Without the source export, the affected project is unrepairable by this path.

From `packages/substrate` in a source checkout, first run a dry-run against the
intended database and Project:

```bash
node scripts/repair-beads-import.ts --db <state.db> --project <project-id> \
  --source <export.jsonl> --json --report <report.json>
```

The script writes only when `--apply` is passed. Before applying, retain a
consistent SQLite backup, review the report and confirm the database, Project
and source export. Use `--alias-prefix from:to` only for a verified legacy alias
prefix mapping. This is a one-off repair utility, not ongoing Beads sync.

Source: [`repair-beads-import.ts`](../scripts/repair-beads-import.ts).
