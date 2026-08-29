# src/identity — XTRM principal/actor/provenance contracts (xtrm-c4z)

Generic XTRM product identity layer. Project namespaces (Mercury or any
other) appear in caller registries and fixtures only — never as constants.

## What it owns

- `schemas.ts` — strict contracts: `xtrm.principal-set.v1` (per-platform
  credential bindings; one operational identity across systems),
  `xtrm.actor.v1` (logical actor independent of model/session/account),
  `xtrm.execution-identity.v1` (attempt/assignment/participant lineage +
  authority ref), `xtrm.provenance.v1` (mutation envelope with closed
  `authorship_mode` enum incl. honest `legacy_unattributed`).
- `context.ts` — trusted runtime-context assembly. Callers pass content +
  target ONLY; identity fields are structurally impossible to smuggle
  (`caller_identity_assertion`). Envelope hashing over canonical JSON.
  Platform-result binding with fail-closed rebind conflict.
- `projection.ts` — compact attribution line, GitHub trailers, Jira
  comment body/property projection with honest downgrade to
  `self_attested_web` when the property channel is unavailable.
- `validation.ts` — fail-closed validation against trusted config
  (registry, principal sets, expected assignment), content-hash binding,
  secret-material hygiene, legacy classification helper.

## Cardinality model

Many logical actors map many-to-one onto one shared external principal
set per access plane (web plane: one GitHub account + one Jira account).
The external account proves the PLANE. The XTRM receipt proves the ACTOR,
EXECUTION and AUTHORITY. Human-direct actions stay on human accounts and
are never merged into web attribution.

## Non-goals (slice 1)

No credentials/accounts/Apps/tokens created. No connector cutover. No
daemon/scheduler. No cryptographic non-repudiation claims: signatures are
optional until an approved attestation service exists, and unsigned
receipts must classify `self_attested_web`, never `xtrm_attested`.

Honesty boundary: `validateMutation(...).ok === true` for a
`legacy_unattributed` envelope proves FORMAT consistency only — unsigned
evidence carries no authenticity claim (docs/identity/mutation-provenance.md §3).

Post-cutover enforcement: pass `cutoverComplete: true` in the validation
config to reject envelope bindings that still claim a null immutable
account id.

Tests: `tests/identity.test.ts` (`bun test tests/identity.test.ts`).

## Slice 2 (xtrm-eq8) — trusted runtime wiring + canary

- `src/chain/trusted-context.ts` (runtime side) resolves
  `ResolvedExecutionContext` from the REAL chain-runtime scheduler lane
  (exported `makeIdentity` + `ResolvedChain` + `StepExecutionState`). No
  identity field is accepted from model/tool payloads.
- `src/identity/canary.ts` runs the bounded non-production projection canary
  (trusted context -> envelope -> projection -> platform adapter -> bind ->
  receipt validation). The adapter is injected; production connectors are
  NOT wired (no cutover).
- `tests/identity-slice2-runtime.test.ts` covers the end-to-end canary,
  identity-smuggling rejects, fail-closed rejection paths, rebind-conflict
  regression, and legacy attribution.
- Before cutover the correct classification for live web mutations remains
  `self_attested_web` (direct/relay authorship mode). Unkeyed hashes are
  tamper evidence only.
