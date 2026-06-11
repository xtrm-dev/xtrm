# Glossary — xtrm decoder ring

> Acronyms, CLIs, codenames, and internal jargon for the xtrm project. Bilingual IT/EN.

## CLIs / binaries
| Term | Meaning |
|---|---|
| **`xt`** | Core CLI. `xt daemon` (runs the state engine), `xt init` (bootstrap a repo). Owns `state.db` + Unix socket protocol. |
| **`sb`** | Substrate CLI. Domain operations: `sb chain review / approve / insert`. (Specialists' `sp chain …` mirrors this 1:1 so migration is just `sp`→`sb`.) |
| **`sp`** | Specialists CLI. `sp chain <root-bead>`, `sp merge`, `sp tail`, `sp epic`, `sp shepherd hints <job>`. |
| **`bd`** | Bead task tracker CLI — **for agent/robot work only**. `bd memories`, `bd recall`. Human work is tracked in **Jira**. |
| **`gh`** | GitHub CLI — PR/issue workflow. |

## Systems / packages
| Term | Meaning |
|---|---|
| **xtrm** | The product family + the umbrella monorepo. |
| **core** | `packages/core`. Daemon + state engine + `state.db` + socket. Everything imports `@xtrm/core` `StateClient`. |
| **substrate** | `packages/substrate`. Domain layer: issues, containers, plans, collisions, validator, memory. The major upcoming foundation. |
| **channels** | `packages/channels`. Cross-container channel primitives. |
| **specialists** | `packages/specialists`. Runtime for "specialists" — agents that execute work. |
| **console / xt-console** | `apps/console`. Descendant of **gitboard**; includes the **materializer**. Operator UI surface. |
| **devops** | Cross-cutting system spanning xt+sp+sb. Explicitly **not** a 6th package. Lands much later. |
| **telemetry / forensic** | The `xtrm.forensic.v1` event envelope + forensic event contract (specialists-owned). |

## Concepts
| Term | Meaning |
|---|---|
| **operator** | The human running the system (Dawid). Accepts/steers work, makes decisions by hand. "owner" used similarly. |
| **chain** | A multi-step unit of work executed by specialists. |
| **chain-template / `.formula.json`** | Reusable chain definitions; ~15 canonical templates live in the specialists repo (code). |
| **bead** | A task/work item in the `bd` tracker, **for agent/robot work**. IDs like `xtrm-h9hqg`, `kj651`, `60w93.1`, `eoqxp.1`. Root beads vs step-beads. (Human work → Jira.) |
| **shepherd** | Always-on sidecar that *forces* relevant memories/paths/scope reminders into a specialist's next turn (opt-out only). Design in `xtrm/tether.md`. |
| **tether** | The doc/codename for the shepherd context-injection design. |
| **reviewer** | End-of-turn judgment over a specialist's output. |
| **runner** | Executes the specialist job. |
| **coordinator / chain-coordinator** | Orchestrates a chain's steps. |
| **mailbox** | Message channel into a job (`kind=steer`, `kind=hint`, …). Read-only audit for shepherd. |
| **supervisor** | Specialist-runtime supervision role. |
| **materializer** | Console component that materializes state into the UI. |
| **GitNexus / gitnexus** | Code-intelligence layer: file:line pointers, impact analysis, related-symbol graphs. |
| **gitboard** | Predecessor/ancestor of the console app. |
| **collisions** | Substrate concept — conflicting work detection. |
| **validator** | Substrate validation layer. |

## Vault / process
| Term | Meaning |
|---|---|
| **vault** | The `xtrm/` Obsidian vault — deliberation, cross-repo thinking, `[[wikilinks]]`. History grafted from `~/second-mind/1-projects/xtrm/`. |
| **MOC** | Map of Content (`xtrm/xtrm-MOC.md`) — index of the whole design surface, with each doc's home + status. |
| **ordine** | The decision log (`[[ordine]]`). |
| **SSOT** | Single Source of Truth. Rule: package-owned + code implements against it → repo; cross-cutting/in-deliberation → vault. |
| **canonico / canonical** | The authoritative copy of a doc. **STALE** = superseded, needs realign/archive. **candidate-archive** = likely to be archived. |
| **pre-substrate** | The current window before substrate lands; operator works ~10 repos in parallel. |

## Adjacent projects
| Term | Meaning |
|---|---|
| **Mercury** | A separate market-data **product Dawid owns** (mercury-api, econ-*, mmd, treasury, doltlab, infra-* containers). **xtrm is being tested/dogfooded on Mercury** — Mercury's real repos and work are xtrm's proving ground. |
| **xtrm-tools** | Upstream repo being grafted in; holds skills like `repo-bootstrap`. |
| **xtrm-dev** | The GitHub organization. |
