# AgentSession SRE Chain — Scripted Runtime Vertical Slice

**Status:** bounded harness experiment; non-canonical. Reconciled post PR #68 (bead `xtrm-5z4`) — see `experiment-report.md` §10.
**Spec:** [`docs/harness/experiments/agentsession-sre-chain-vertical-slice-2026-08-17.md`](../../docs/harness/experiments/agentsession-sre-chain-vertical-slice-2026-08-17.md)
**Bead:** `xtrm-19w` (original experiment) · `xtrm-5z4` (reconciliation pass)
**Baseline compared against:** `mercuryintelligence/infra:.specialists/user/sre-*.specialist.json` (the `/sre-triage` team).

## What this is

A Bun/TypeScript experiment that implements the SRE triage chain via **direct `createAgentSession()`** from `@earendil-works/pi-coding-agent` — no Pi RPC. Everything else — Beads materialization, ResolvedChain, ChainRun, pure reducer, Channels-style messaging with attention, evidence store, custom Pi tools, resume — is implemented locally to prove that Pi's public SDK is a sufficient boundary for XTRM to own its own governed harness.

The original path uses adapted role markdown. The optional full-JSON path can now ingest the actual Specialist definitions while deliberately keeping scheduling/runtime authority in XTRM rather than reproducing the legacy `sp` coordinator control loop. See [`full-specialist-json-loader.md`](./full-specialist-json-loader.md).

Topology (fixed, frozen at run-start):

```
chain-coordinator (entry)
  ├─ explorer                ─┐
  └─ observability-analyst   ─┤
                              → sre-diagnostician → reviewer → chain-coordinator (close)
```

Roles map to the SRE team:

| Chain role | Specialist cognition | XTRM adaptation |
|---|---|---|
| `chain-coordinator` | `sre-coordinator` | entry/close gate only; XTRM owns fan-out/wait/retry |
| `explorer` | `sre-host-forensics` | topology + operational evidence |
| `observability-analyst` | `sre-observability-forensics` | observability evidence |
| `sre-diagnostician` | `sre-change-forensics` | change probes + mandatory synthesis of both advisor evidence sets |
| `reviewer` | XTRM-native | independent evidence coverage + PASS/PARTIAL/FAIL |

## Quick start

```bash
cd ~/dev/xtrm/experiments/agentsession-sre-chain-vertical-slice
bun install

# One-time: stamp the synthetic fixture (choose scenario)
scripts/setup-fixture.sh true-regression   # real 512Mi -> 64Mi (default)
scripts/setup-fixture.sh false-premise     # value never changed; only a comment removed

# Dry-run (materialize plan, no dispatch)
bun run src/cli/main.ts --repo ./fixtures/tiny-repo --dry-run

# Full run against tiny synthetic fixture (legacy adapted role markdown)
bun run src/cli/main.ts --repo ./fixtures/tiny-repo --root-bead <bd-id>

# Real run against Mercury infra using the ACTUAL SRE Specialist JSON files.
# `required` fails if any mapped real SRE Specialist is missing.
bun run src/cli/main.ts \
  --repo /home/dawid/projects/mercury/infra \
  --specialist-json required \
  --root-bead <bd-id> \
  --incident "Baseline current infra state: what are the top 3-5 SRE observations right now?"

# Inspect one full Specialist JSON compile without model dispatch
bun run scripts/inspect-specialist.ts \
  --repo /home/dawid/projects/mercury/infra \
  --name sre-host-forensics

# Resume (frozen Specialist source hashes are revalidated)
bun run src/cli/main.ts --repo /home/dawid/projects/mercury/infra --resume <chain-run-id>

# NDJSON facts
bun run src/cli/main.ts --repo <path> --json

# Tests
# PR #69 baseline: 48 previously verified green.
# Full-JSON loader/resolver tests are added by the current branch and must also pass.
bun test tests/
```

## Files

```
src/
  chain/         resolved chain, run state, reducer, topology
  channels/      messages, cursors, attention, kind allowlist, authority checks
  evidence/      pointer-first evidence store
  tools/         host-owned Pi custom tools
  agents/        AgentSession bridges (legacy role markdown + compiled Specialist JSON)
  specialists/   Zod schema, loader/compiler, frozen bindings, SRE role mapping, upstream resolver seam
  adapters/      bd (beads) CLI wrapper
  cli/           main entry + stdout renderer + args
  util/          fs atomic, ids, logger
roles/           legacy adapted role prompts + chain doctrine
fixtures/tiny-repo/  deterministic synthetic incident (two scenarios via setup-fixture.sh)
tests/           reducer/channels + reconciliation + full Specialist loader/resolver contracts
scripts/         fixture/inspectors + live-model runbooks
```

## Full Specialist JSON authority boundary

The full JSON path intentionally does **not** mean "run the old Specialists runtime inside XTRM".

```text
Specialist JSON / upstream SpecialistLoader
  owns: authored cognition + declared model/skills/capabilities/output expectations

XTRM
  owns: topology + scheduling + retries/stall/recovery + Beads + Channels
        + evidence + capability enforcement + step satisfaction + terminalization

Pi AgentSession
  owns: model session
```

`system_prompt_mode: replace` can replace the Specialist cognition layer but can never erase Pi tool discovery or XTRM authority doctrine. Declared skills are host-resolved and fingerprinted. Arbitrary pre/post scripts, canonical mandatory-rule template sets, complete capability parity and output-schema enforcement are retained/deferred rather than silently claimed as supported; see the detailed loader document.

## Non-goals (per spec)

- No full Substrate, no daemon, no new XTRM package.
- No production remediation — triage only.
- No target-repo mutation.
- No Pi RPC for participant execution.
