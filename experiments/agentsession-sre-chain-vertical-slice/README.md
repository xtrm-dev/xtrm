# AgentSession SRE Chain — Scripted Runtime Vertical Slice

**Status:** bounded harness experiment; non-canonical. Reconciled post PR #68 (bead `xtrm-5z4`) — see `experiment-report.md` §10.
**Spec:** [`docs/harness/experiments/agentsession-sre-chain-vertical-slice-2026-08-17.md`](../../docs/harness/experiments/agentsession-sre-chain-vertical-slice-2026-08-17.md)
**Bead:** `xtrm-19w` (original experiment) · `xtrm-5z4` (reconciliation pass)
**Baseline compared against:** `mercuryintelligence/infra:.specialists/user/sre-*.specialist.json` (the `/sre-triage` team).

## What this is

A Bun/TypeScript experiment that implements the SRE triage chain via **direct `createAgentSession()`** from `@earendil-works/pi-coding-agent` — no Pi RPC, no specialists framework, no `sp run`. Everything else — Beads materialization, ResolvedChain, ChainRun, pure reducer, Channels-style messaging with attention, evidence store, custom Pi tools, resume — is implemented locally to prove that Pi's public SDK is a sufficient boundary for XTRM to own its own governed harness.

Topology (fixed, frozen at run-start):

```
chain-coordinator (entry)
  ├─ explorer                ─┐
  └─ observability-analyst   ─┤
                              → sre-diagnostician → reviewer → chain-coordinator (close)
```

Roles map to the baseline SRE team (system prompt bodies reused verbatim, wrapped with chain-participant doctrine per spec §6):

| Chain role | Baseline specialist | Source of adaptation |
|---|---|---|
| `chain-coordinator` | `sre-coordinator` | wrap for entry/close gate posture |
| `explorer` | `sre-host-forensics` | topology + operational surface |
| `observability-analyst` | `sre-observability-forensics` | verbatim |
| `sre-diagnostician` | synthesized (consumes both advisor sets + `sre-change-forensics` angle) | new |
| `reviewer` | synthesized (independent evidence coverage + PASS/PARTIAL/FAIL) | new |

## Quick start

```bash
cd ~/dev/xtrm/experiments/agentsession-sre-chain-vertical-slice
bun install

# One-time: stamp the synthetic fixture (choose scenario)
scripts/setup-fixture.sh true-regression   # real 512Mi -> 64Mi (default)
scripts/setup-fixture.sh false-premise     # value never changed; only a comment removed

# Dry-run (materialize plan, no dispatch)
bun run src/cli/main.ts --repo ./fixtures/tiny-repo --dry-run

# Full run against tiny synthetic fixture
bun run src/cli/main.ts --repo ./fixtures/tiny-repo --root-bead <bd-id>

# Real run against the mercury infra baseline target
bun run src/cli/main.ts --repo /home/dawid/projects/mercury/infra --root-bead <bd-id>

# Resume
bun run src/cli/main.ts --resume <chain-run-id>

# NDJSON facts
bun run src/cli/main.ts --repo <path> --json

# Tests (48 pass)
bun test tests/
```

## Files

```
src/
  chain/         resolved chain, run state, reducer, topology
  channels/      messages, cursors, attention, kind allowlist, authority checks
  evidence/      pointer-first evidence store
  tools/         host-owned Pi custom tools
  agents/        AgentSession bridge + resource loaders
  adapters/      bd (beads) CLI wrapper
  cli/           main entry + stdout renderer + args
  util/          fs atomic, ids, logger
roles/           adapted role system prompts (baseline verbatim + chain doctrine)
fixtures/tiny-repo/  deterministic synthetic incident (two scenarios via setup-fixture.sh)
tests/           reducer + channels + adversarial authority + beads adapter + sre_exec policy + fixture scenarios
scripts/         smoke run + setup-fixture (two scenarios) + inspector + docs for the two live-model runnables (adversarial-authority.md, crash-resume.md)
```

## Non-goals (per spec)

- No full Substrate, no daemon, no new XTRM package.
- No production remediation — triage only.
- No target-repo mutation.
- No Pi RPC for participant execution.
