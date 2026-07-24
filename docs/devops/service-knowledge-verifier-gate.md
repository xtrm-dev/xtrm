# service-knowledge verifier gate — deterministic write gate (PR2, v0.4.0)

The service-knowledge package ships a **deterministic gate** that sits between the LLM
reconciler's candidate output and the canonical SKILL write. PR1 (v0.2.0) added the
advisory claim verifier; **PR2 wires it into the write path** so a candidate reaches
`atomic_write` only when the verifier clears it. It implements research
[`§2.7`](../research/kb-knowledge-base-svc.md) (gate lattice) and [`§2.8`](../research/kb-knowledge-base-svc.md)
(deterministic-first arbiter).

- **Package:** `~/dev/xtrm/packages/service-knowledge` (`service_knowledge.scripts.verifier.gate` + `reconcile.py`)
- **Spec source:** [`docs/research/kb-knowledge-base-svc.md`](../research/kb-knowledge-base-svc.md) §2.7 / §2.8
- **Verifier contract:** see `packages/service-knowledge/src/service_knowledge/scripts/verifier/`
- **Telemetry:** `<consumer>/.xtrm/state/service-knowledge/events.jsonl` (`component=reconcile-gate`)

## Why a gate

The verifier from PR1 was advisory-only — `reconcile.py` still shipped whatever the LLM
returned. The gate makes the verifier **binding**: the reconciler writes the candidate to a
temp path first, runs the verifier, computes a single lattice verdict, and only writes the
canonical SKILL on `PASS` / `PASS_WITH_ADVISORIES`. A recent specialist run shipped three
factual errors in one SKILL section that only manual operator review caught; the gate is the
blast-radius fix that makes that class of failure impossible to auto-ship.

## The 6-tier lattice

Ordered most → least severe. `compute_gate(manifest, evidence_race=...)` reduces a
`ClaimManifest` to exactly one verdict:

| Verdict | Trigger | Writable? | PR behaviour |
| --- | --- | :---: | --- |
| `EVIDENCE_RACE` | source SHA changed mid-run | ✗ | invalidate + retry once, then fail |
| `INVALID` | candidate failed structural validation | ✗ | no PR; report only |
| `CONFLICT` | ≥1 claim contradicted by source of truth | ✗ | no PR; report only |
| `INSUFFICIENT_EVIDENCE_HIGH_RISK` | ≥1 **high-risk** claim left `UNKNOWN` | ✗ | **draft** PR + `do-not-merge` label |
| `PASS_WITH_ADVISORIES` | no conflicts; unresolved low/medium claims or advisory notes | ✓ | normal PR, **no auto-merge**, advisories rendered |
| `PASS` | every extracted claim verified `PASS`, clean structure | ✓ | normal PR, **no auto-merge** |

Only `PASS` and `PASS_WITH_ADVISORIES` reach `atomic_write`. **`PASS` never auto-merges** —
auto-merge is a separate later decision (canary policy, PR5b).

### Precedence

The lattice short-circuits in severity order, so the most severe signal wins:

```
EVIDENCE_RACE  >  INVALID  >  CONFLICT  >  INSUFFICIENT_EVIDENCE_HIGH_RISK  >  PASS_WITH_ADVISORIES  >  PASS
```

- `EVIDENCE_RACE` dominates everything: if the source of truth moved under the run, *every*
  verdict is suspect, so the whole run is invalidated and retried.
- `INVALID` (structural) dominates `CONFLICT` because a malformed candidate's claims can't be
  trusted.
- `CONFLICT` dominates `INSUFFICIENT_EVIDENCE_HIGH_RISK`: a deterministic contradiction is a
  harder stop than an unresolved claim.

### EVIDENCE_RACE detection

`reconcile.run_verifier()` fingerprints the service territory (sha256 over the territory
globs' file contents) at the **start** and **end** of the verifier run. A mismatch means the
source changed mid-run → `evidence_race=True` → the gate returns `EVIDENCE_RACE` →
`gated_write()` invalidates and **retries the whole verification once**. A second race fails
the write (no retry loop).

### No residual LLM critic (REVISION 3)

Research §2.8 recommends a deterministic-first arbiter with an LLM critic *only* on residuals
the deterministic verifier returned `UNKNOWN` on. **This PR ships the deterministic gate
only.** The residual LLM critic is deferred to a follow-up bead (to be added only if measured
verifier false-negative rate exceeds 0.10). The telemetry schema reserves `critic_calls` /
`critic_tokens` fields (pinned to `0` here) so the line shape is forward-compatible.

## The single write path (specialist parity)

The gate lives **inside `reconcile.py`'s only write path** (`gated_write`). Every consumer
funnels through it:

```
service-skills-sync specialist ─┐
auto-reconcile GHA workflow ────┼─> reconcile.py ─> gated_write() ─> compute_gate() ─> atomic_write()
manual CLI (`python3 -m …`) ────┘                                   (only on PASS / PASS_WITH_ADVISORIES)
```

There is **no override flag and no alternate write path** — `atomic_write` for SKILL content
is reachable only through the gate. The `service-skills-sync` specialist invokes this same
`reconcile.py` entry point, so a local specialist run **cannot bypass** what CI enforces.
(Accidental addition of a bypass flag is guarded by `test_no_gate_bypass_flag_exists`.)

## CI gate (`--gate-mode`)

The verifier CLI gains `--gate-mode`, which emits the gate verdict and sets the process exit
code for clean CI gating:

```bash
python3 -m verifier --candidate SKILL.candidate.md --current SKILL.md \
    --territory 'source/**' --gate-mode --output-format json > manifest.json
echo "exit=$?  # 0 on PASS/PASS_WITH_ADVISORIES/INSUFFICIENT_EVIDENCE_HIGH_RISK; 1 on INVALID/CONFLICT/EVIDENCE_RACE"
```

- **Exit 0:** `PASS`, `PASS_WITH_ADVISORIES`, `INSUFFICIENT_EVIDENCE_HIGH_RISK` (the last opens
  a *draft* PR rather than failing the job).
- **Exit 1:** `INVALID`, `CONFLICT`, `EVIDENCE_RACE` (the job fails; sticky comment, no PR).

The JSON output is `{"gate": <decision>, "manifest": <manifest>}`; `--output-format markdown`
prepends a gate-verdict banner to the human-readable evidence report.

The shipped workflow template lives at
`packages/service-knowledge/.github/workflows/service-skills-drift-sweep.yml`. A consumer
adopts it by copying it to their own repo-root `.github/workflows/`. It runs the gate
**before** `peter-evans/create-pull-request`, publishes `manifest.json` + `report.md` as the
`service-skills-verify` artifact, surfaces a `service-skills-verify` status check on the PR,
fails on `INVALID`/`CONFLICT`/`EVIDENCE_RACE`, and opens a draft `do-not-merge` PR on
`INSUFFICIENT_EVIDENCE_HIGH_RISK`.

## What the reviewer sees

The Markdown evidence report (rendered into the PR body) leads with the gate verdict banner,
then lists, per claim:

- the candidate diff line and section path,
- the per-claim verdict (`PASS` / `CONFLICT` / `UNKNOWN`),
- the evidence path + line range (`source_refs`),
- the complete-set comparison for `set_claim`s (`expected_count` vs `observed_count`,
  `comparison=equal|unequal|subset|superset|unresolved`),
- residual `UNKNOWN` claims as explicit caveats.

## Telemetry

Every gate decision appends one structured line to
`<consumer>/.xtrm/state/service-knowledge/events.jsonl`:

```json
{"component":"reconcile-gate","conflict_count":2,"critic_calls":0,"critic_tokens":0,"duration_ms":5.6,"event":"gate_decision","invalid_count":0,"service_id":"api-gateway","timestamp":"2026-07-24T19:42:38.540Z","unknown_count":1,"verdict":"CONFLICT"}
```

Grep `component=reconcile-gate` to isolate every gate decision in the audit trail. No claim
text or source content is recorded — only verdicts, counts, the service id and timing.

## Operator override

**There is no operator override in this PR.** A blocking verdict means no write (local flow)
or no PR / draft PR (workflow). If a future need arises to force a write past the gate, it
lands as a separate bead with an operator-recorded override reason (using-specialists rule #15
style) — not silently here.
