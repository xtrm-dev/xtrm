# Advisories

Substrate surfaces deterministic advisories: short nudges computed from durable state, never from a model. One catalogue in `src/presentation/advisories.ts` serves the `sb` CLI, the Claude Code plugin hooks and the Pi extension, so the same state produces the same advisory on every surface.

Each advisory has two texts:

- **message**: one line for the operator (Claude `systemMessage`, Pi `ui.notify`).
- **instruction**: the exact next step for the agent (Claude `additionalContext`, Pi tool-result append).

## Identity

`resolveIdentity(env, cwd)` decides who is acting, in this order:

1. `SUBSTRATE_HOLDER` (exported by `xt claude|pi|codex <name>`).
2. The xt worktree name: `.xtrm/worktrees/<repo>-xt-<runtime>-<name>` gives `<name>`.
3. None. `XTRM_SESSION_NAME` is never used, because every pane of a tmux session shares it.

## Issue rules

Evaluated in this order. A caller usually shows the first rule that is not cooling down.

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
| `checkpoint_due` | 8 or more entries since the last checkpoint, or none ever | 20 min |
| `handoff_due` | Stop phase only: no handoff 30 min after the claim | 60 min |

Terminal issues (`done`, `cancelled`, `archived`) produce no advisories.

## Operation rules

These describe one write that just happened, so they never cool down.

| Code | Condition |
|---|---|
| `identity_missing` | A journal entry or closure was recorded with no participant |
| `close_without_result` | Closed as `completed` with no result, validation, receipt or artifact reference |

## Cooldowns

Hooks are separate processes, so cooldowns persist per session in `<tmpdir>/substrate-advisories-<session>.json`. The key is `<issueRef>:<code>`. Losing the file only repeats one advisory.

## Turning advisories off

Set `SUBSTRATE_ADVISORIES=off` to silence the hook and extension advisories. Gates (edit gate) and CLI errors are not affected.
