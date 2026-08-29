# Mutation provenance and XTRM web principals

Status: contract record for slice 1 (xtrm-c4z). Implementation:
`experiments/agentsession-sre-chain-vertical-slice/src/identity/`.
Normative direction: operator robot-identities decision 2026-08-14.
This document records accepted semantics and a documented-not-executed
cutover plan. It does not itself create accounts or cut anything over.

## 1. Superseded assumption

Earlier Mercury-facing material assumed one external web role maps to one
account per role. SUPERSEDED: all connected web agents share exactly ONE
GitHub account and ONE Jira account (principal set `xtrm-web` by
convention). The external account identifies the access plane only.

## 2. Identity separation

| Layer | Carrier | Example |
|---|---|---|
| Credential principal | platform account via connector | `xtrm-web` user |
| Logical actor | `xtrm.actor.v1` registry entry | `<project>/<role>` |
| Execution attempt | `xtrm.execution-identity.v1` | retry mints new attempt; participant stable |
| Authority | `authority_ref` | `jira:ISSUE-n:comment:<id>` |

Labels, branch names, prose and model names NEVER establish identity.

## 3. Authorship modes (closed enum)

`human_direct | xtrm_web_direct | xtrm_local_direct | xtrm_host_direct |
xtrm_relay | legacy_unattributed`

Historical actions are classified `legacy_unattributed` with no guessed
actor. Unsigned receipts classify `self_attested_web`; `xtrm_attested`
requires signer+signature from a separately approved attestation service.
Validation passing for legacy/unattributed envelopes proves format
consistency only — unsigned evidence never becomes an authenticity claim.
After credential cutover, validators should set `cutoverComplete` so no
binding — envelope OR trusted principal-set config — may still carry a
null platform account id; the flag enforces both sides.

## 4. Platform projection

- Jira: visible compact line first; full envelope in an `xtrm.provenance`
  comment property when supported; bounded footer fallback otherwise.
- GitHub: compact line in bodies/comments; commit trailers `XTRM-Actor`,
  `XTRM-Principal-Set`, `XTRM-Execution`, `XTRM-Assignment`,
  `XTRM-Authority`, `XTRM-Receipt`.

## 5. Documented cutover (operator-only; NOT executed here)

1. Create one GitHub machine user (XTRM name) manually — automated
   creation is prohibited by GitHub. Enable strong auth/recovery.
2. Create one connector-compatible ordinary Atlassian user.
3. Grant only permissions identified by the accepted permission matrix.
4. Connect ChatGPT GitHub/Jira connectors to those two accounts.
5. Preserve operator personal accounts for human-direct actions.
6. Separately decide local GitHub App + Jira service account.
7. Reversible canary on a test issue/repository before production.

Rollback: disconnect connectors and revert to operator personal accounts;
envelopes remain valid history because they do not depend on the
connector for interpretation.

## 6. Local/host principals

Local and host automation may later use separate least-privilege XTRM
principal sets (`local_automation`, `host_automation`, `ops` kinds).
Preferred mechanisms: private GitHub App installation tokens; Atlassian
service account with scoped API tokens where supported.

## 7. Slice 2: real trusted lane integration + projection canary (xtrm-eq8)

Slice 2 (xtrm-eq8, PR #105) wires ONE real trusted XTRM host/local
execution lane into these contracts and proves a bounded, non-production
projection canary. Integration is proven by tests bound to the real
scheduler lane functions (`makeIdentity`, `newResolvedChain`,
`StepExecutionState`); no production mutation call site or platform adapter
was added in this slice. It does not perform account or connector cutover.

Trusted context source: the chain-runtime scheduler lane
(`experiments/agentsession-sre-chain-vertical-slice/src/chain/scheduler.ts`,
`makeIdentity` + frozen `ResolvedChain` + `StepExecutionState`). The
scheduler resolves participant/execution identity BEFORE any
model-controlled mutation code runs. The adapter
(`src/chain/trusted-context.ts`) maps that lane deterministically into
`ResolvedExecutionContext`:

| Slice 1 field | Resolved from trusted lane / host |
|---|---|
| `participant_id` | scheduler `participant_id` (`chainId::role`) |
| `execution_id` | scheduler `execution_id` (deterministic `exec-<participant>-<attempt>`; a retry mints a new attempt, so a new execution id) |
| `attempt` | `StepExecutionState.attempts` |
| `runtime_session_id` | host-supplied runtime session id (pi session) when the lane has one |
| `assignment_id` / `assignment_version` | host-supplied assignment beacon (bead ref) + version |
| `authority_ref` | host-supplied authority (bead ref / issue ref) |
| `parent_execution_id` | host-supplied lineage on resume/retry |
| `actor_id` | deterministic role projection (`<chain>/<role>`) or host-selected registered actor |
| `principal_set_id` | registered principal set, must be allowed for the actor |

Fail-closed: missing actor, missing registered principal set, actor not
allowed for the set, missing assignment/version, missing authority, missing
execution identity all throw at resolution time. Caller mutation payloads
carry only content/target/source cursors; identity fields in a payload are
rejected (`caller_identity_assertion`, extended key list).

Canary: `src/identity/canary.ts` + `tests/identity-slice2-runtime.test.ts`
prove trusted context → envelope → projection → injected platform adapter
(dry-run GitHub fixture) → returned platform object id → binding
(`bindPlatformResult`) → receipt validation (`validateMutation`). Rebind
conflict and already-bound-receipt tampering fail closed. Legacy history
remains `legacy_unattributed`.

Classification before cutover remains:

```text
authorship_mode: appropriate direct/relay mode
attribution_strength: self_attested_web
```

No signer is implemented in this slice; unkeyed hashes remain tamper
evidence only. No credentials, accounts, connectors, daemons or production
targets were created.

## 8. Slice 3: real non-production mutation call site (xtrm-1zv)

Slice 3 (PR for this document) closes the four residuals recorded at Slice 2
acceptance. It still performs NO connector/account cutover and never touches
production GitHub/Jira.

1. Real mutation call site. `ChainRunInputs.provenance` (opt-in per run)
   enables a scheduler hook (`src/chain/provenance-receipts.ts`) that emits
   one provenance receipt per newly-satisfied step. The receipt binds a REAL
   non-production GitHub-model mutation: `LocalGitCommitAdapter`
   (`src/identity/adapters/local-git-commit.ts`) creates a git commit in a
   designated scratch repo and returns the REAL commit SHA as the
   platform-assigned object id. The adapter fails closed if the repo path
   escapes the designated scratch root; no remotes are touched, nothing is
   pushed. Receipt records persist under
   `outputs/provenance-receipts/` (schema `xtrm.provenance-receipt.v1`).
2. Runtime-session identity (review F3). `runtime_session_id` is read from
   `StepExecutionState.last_pi_session_id` inside the adapter, never from a
   host literal. Distinct runs at the same (participant, attempt) therefore
   mint distinct receipts; deterministic execution ids remain valid because
   the runtime session disambiguates.
3. Role-bound actor (review F4). Actor resolution requires a role→actor
   binding (`roleActors`); a caller-side `actorId` override that disagrees
   with the binding fails closed (`actor_role_mismatch`), and a missing
   binding fails (`actor_role_unbound`).
4. Account-binding asymmetry (review F5). `validateMutation` now fails when
   the envelope carries a non-null `immutable_account_id` while the trusted
   principal-set binding is null — the asymmetry previously only checked the
   envelope-null direction. Matching non-null ids still validate.

Classification remains unchanged before cutover:

```text
authorship_mode: appropriate direct/relay mode
attribution_strength: self_attested_web
```

No credentials, accounts, tokens, connectors, daemons or production targets
are created by this slice. The canary's only side effect is a local commit
inside a designated scratch repository.
