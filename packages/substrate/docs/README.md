---
status: current
owner: substrate
source_of_truth_for:
  - current Substrate product/operator documentation map
last_verified_against: 4d83048bb86d5924b864278ff106640c6046e271
---

# Substrate documentation

This directory is the current product/operator documentation for
`@jaggerxtrm/substrate`. It is source-first: live services, CLI registrations,
Pi tools, Claude MCP registrations and package layout outrank historical prose.

## Start by intent

| Intent | Page |
|---|---|
| Understand the authority model | [Concepts](concepts.md) |
| See the implementation boundaries | [Architecture](architecture.md) |
| Run work end to end | [Workflow](workflow.md) |
| Understand identity/readiness/claims | [Issues and readiness](issues-and-readiness.md) |
| Record/resume execution | [Journal and Resume](journal-and-resume.md) |
| Trace evidence and close work | [Provenance and Closure](provenance-and-closure.md) |
| Understand `sb init` and repository Projects | [Repository identity](repository-identity.md) |
| Use the terminal CLI | [CLI](cli.md) |
| Understand provider boundaries | [Integrations](integrations.md) |
| Use the Pi integration | [Pi](pi.md) |
| Use the Claude plugin/MCP | [Claude](claude.md) |
| Understand Specialists integration | [Specialists](specialists.md) |
| Diagnose common failures | [Troubleshooting](troubleshooting.md) |

## Current vs architecture/history

Current how-to/reference lives here. Repository-root [`docs/substrate`](../../../docs/substrate/README.md)
keeps ADRs, PRDs, migration history and acceptance evidence. Historical documents
may retain Beads-era or implementation-phase wording; they are evidence, not the
normal operator entry point.

## Documentation rule

Do not hand-maintain an inventory the runtime can expose or CI can derive. Tool
names, Journal kinds, Closure outcomes, CLI commands and package layout should be
checked against source. Intentional Pi/Claude differences are documented as
differences, not forced into false parity.
