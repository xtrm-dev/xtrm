# Substrate — architecture, ADRs, migration history and acceptance evidence

For **current product/operator documentation**, start at
[`packages/substrate/docs/README.md`](../../packages/substrate/docs/README.md)
or the package landing page
[`packages/substrate/README.md`](../../packages/substrate/README.md).

This root directory keeps the deeper architectural record: PRDs, ADRs,
migration/termination decisions, acceptance transcripts and historical phase
evidence. Historical files may intentionally retain Beads-era or implementation-
phase wording; do not treat an old phase statement as a current command/tool
contract.

## Current authority

- [`sbcloseout4-adr.md`](./sbcloseout4-adr.md) — final repository identity,
  Journal/outcome/session/provenance/agentic-work ADR.
- [`substrate-issues-v0-prd.md`](./substrate-issues-v0-prd.md) — Issues slice
  product/implementation baseline.
- [`sb-cli-ux-design.md`](./sb-cli-ux-design.md) — terminal-native human `sb`
  presentation contract.

## Mechanically retained reference mirrors

These repository-root pages remain cross-linked and CI-gated while the current
package-local docs become the normal operator entry point:

- [`workflow.md`](./workflow.md)
- [`journal.md`](./journal.md)
- [`provenance.md`](./provenance.md)
- [`repository-identity.md`](./repository-identity.md)
- [`cli.md`](./cli.md)

New current provider/tool inventories should live in package docs and be derived
or checked against source; do not fork another hand-maintained normative list
here.

## Historical / migration material

`sbcloseout2-*`, `sbcloseout3-adr.md`, phase reports and acceptance transcripts
are durable evidence of the path to the current system. `sbcloseout3-adr.md` is
superseded by `sbcloseout4-adr.md`. One-way Beads import/history compatibility
does not make Beads current work authority.

## Current system invariant

```text
Issue revision/hash
→ readiness
→ claim / execution binding
→ Journal result + WorkReceipt
→ commit / PR / artifact / validation
→ Closure
```

Git owns code/integration truth. Substrate owns durable work. Messages coordinate
but do not silently change Issue authority.
