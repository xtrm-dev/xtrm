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
