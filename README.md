# xtrm

> Closed-source umbrella monorepo for the xtrm product family.
> Version 0.1.0 — fresh start, per-package history grafted from upstream repos.

## Layout

```
xtrm/
├── packages/        # libraries: core, substrate, channels, specialists, …
├── apps/            # end-user apps: console, …
└── docs/            # canonical design docs and research (vault history preserved)
```

## Key docs

- [`docs/monorepo-migration.md`](docs/monorepo-migration.md) — migration strategy (fresh umbrella + per-package graft)
- [`docs/state-store-options.md`](docs/state-store-options.md) — two-tier state architecture
- [`docs/substrate/substrate_design_it.md`](docs/substrate/substrate_design_it.md) — substrate domain design
- [`docs/telemetry/forensic-event-contract.md`](docs/telemetry/forensic-event-contract.md) — `xtrm.forensic.v1` envelope
- [`docs/xtrm-MOC.md`](docs/xtrm-MOC.md) — map of content

## Package ownership

| Package | Role |
|---|---|
| `packages/core` | `xt daemon` + state engine + `state.db` + Unix socket protocol + bootstrap/worktree/install/update |
| `packages/substrate` | domain layer: issues, containers, plans, collisions, validator, memory |
| `packages/channels` | cross-container channel primitives |
| `packages/specialists` | specialist runtime (sp CLI) |
| `apps/console` | xt-console (gitboard descendant) + materializer |

Domain packages hard-import `@xtrm/core` for `StateClient`; they speak to the daemon over the socket and **never** open `state.db` directly.

## History

`docs/` carries the full git history of the vault `~/second-mind/1-projects/xtrm/`, extracted via `git filter-repo --subdirectory-filter 1-projects/xtrm` (`devjournal.md` excluded as personal). Package source code will be grafted in via `git filter-repo --to-subdirectory-filter <pkg>` + `git merge --allow-unrelated-histories` from upstream repos (`specialists`, `xtrm-tools`, …) — see migration doc.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for onboarding, branching, PR workflow, and house style. Security policy lives in [`SECURITY.md`](SECURITY.md).
