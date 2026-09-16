---
status: current
owner: substrate
last_verified_against: 4d83048bb86d5924b864278ff106640c6046e271
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
