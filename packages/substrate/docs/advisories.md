# Advisories

Substrate surfaces deterministic advisories: short nudges computed from durable
state, never from a model. One catalogue in
`packages/substrate/src/presentation/advisories.ts` is the single authority for
when a nudge is correct, so the same state produces the same advisory on every
surface.

Catalogue only: nothing wires these rules to a hook, extension or plugin yet,
and this document does not describe a surface that exists. Exporting the
catalogue from `src/index.ts` and documenting the rules is the point of this
step; wiring the `sb` CLI, the Claude Code hooks and the Pi extension is
step-12 work on the shared tool surface (XTRM-724 part B).

Each advisory has two texts:

- **message**: one line for the operator.
- **instruction**: the exact next step for the agent.

`formatAdvisory` joins them for a consumer that shows both.

## Identity

`resolveIdentity(env)` decides only what this session is called:

1. `SUBSTRATE_HOLDER` (exported by `xt claude|pi|codex <name>`).
2. Nothing. `{ holder: null, source: "none" }`.

This is a diagnostic input, never a holder source:

- `resolveClaimHolder` (XTRM-722) is the only thing that decides a holder: it
  resolves an explicit flag, then `SUBSTRATE_HOLDER`, then fails closed.
- The xt worktree name is not consulted. Worktree-slug derivation belongs to
  `xt attach` (CORE-2536).
- `XTRM_SESSION_NAME` and `XTRM_SESSION_ID` are never used: they identify a tmux
  session, which every pane in it shares, not a worker.

## Issue rules

`evaluateIssue(snapshot, identity, { phase })` returns the rules that apply, in
priority order. A caller usually shows the first rule that is not cooling down.

| Code | Condition | Cooldown |
|---|---|---|
| `identity_missing` | Live claim, no resolvable identity | 30 min |
| `holder_mismatch` | Live claim held by another holder | 30 min |
| `attest_ready` | No claim, readiness `draft` | 30 min |
| `claim_start` | No claim, readiness `ready` | 30 min |
| `claim_expired` | Claim past `expiresAt` | 10 min |
| `claim_renew` | Less than 20% of the TTL left (5 min floor) | 10 min |
| `close_due` | Latest journal entry is a `result` | 20 min |
| `revise_contract` | Claimed, current revision `draft` | 30 min |
| `checkpoint_due` | 8 or more entries since the last checkpoint, or 3 or more with no checkpoint yet | 20 min |
| `handoff_due` | Stop phase only: no handoff 30 min after the claim | 60 min |

`identity_missing` and `holder_mismatch` are exclusive: a mismatch is never also
reported as a missing holder. An expired claim is never also reported as needing
renewal.

Terminal issues (`done`, `cancelled`, `archived`) produce no advisories.

## Operation rules

`evaluateOperation(fact)` describes one write that just happened, so these never
cool down.

| Code | Condition |
|---|---|
| `identity_missing` | A journal entry or closure was recorded with no participant |
| `close_without_result` | Closed as `completed` with no result, validation, receipt or artifact reference |

## Cooldowns

`selectAdvisory(list, cooldowns, now)` returns the first advisory that is not
cooling down and records its cooldown in the map it is given. The clock is a
parameter, so a surface or a test decides the time. The key is
`<issueRef>:<code>`, and the map is plain data: the consuming surface owns where
(and whether) it persists, which is why no file handling lives in this module.
Losing the map only repeats one advisory.

## Tuning

`ADVISORY_TUNING` holds the numbers the rules share (renewal fraction and floor,
entries between checkpoints, first-checkpoint threshold, handoff delay), and
`ADVISORY_COOLDOWN_MIN` holds one cooldown per code. Changing a number here
changes every surface at once; that is the reason the catalogue exists.
