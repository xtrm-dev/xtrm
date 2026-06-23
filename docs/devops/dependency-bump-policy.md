---
title: Dependency-Bump Policy — Advisory vs Blocking CI + updating-dependencies v0
status: decided
type: design-note (decision layer over the spec)
created: 2026-06-23
spec: dependencies-updating.md
bead: unitAI-3v5sn (specialists DB)
scope: xtrm / specialists / xtrm-tools (cross-cutting)
---

# Dependency-Bump Policy

This is the **decision and implementation layer**. The exhaustive capability
spec is [`dependencies-updating.md`](dependencies-updating.md) (living draft,
sections 1–21). Read that for *why* and *what could exist*; read this for
*what we decided*, *what blocks a merge right now*, and *how we build it in
phases*.

## 1. Locked decisions (unitAI-3v5sn)

| # | Decision | Choice |
|---|---|---|
| D1 | OSV on PR | **Conditional blocking (Option B)** — advisory by default; **SECURITY_FORCED** findings still block. |
| D2 | Cooldown default | **7 days** for ordinary (non-security) bumps. Bypass only via SECURITY_FORCED. |
| D3 | v0 skill location | `~/dev/xtrm-tools/.xtrm/skills/default/updating-dependencies/` (ships to every repo via `xt update`). |
| D4 | This design's output | Complete e2e design + v0 skill package + implementation board (two coordinated epics). |

These are settled. Do not re-litigate during implementation.

## 2. Guiding principle

> A CI check may block a PR merge **only** when its finding represents real risk
> to the merged artifact. Harness noise, stale transitive lockfile entries, and
> non-actionable pre-existing debt are **advisory**, not merge blockers.

This is the rule PR #152 violated: a stale nested `vite@8.0.13` (under
`vitest/vite`) blocked a merge while the root dependency was already
`vite@8.0.16`. The cost of that friction is disproportionate and recurring.

## 3. Failure-mode evidence

| Symptom | Concrete case | Root cause |
|---|---|---|
| Scanner blocks merge on stale transitive entry | PR #152 — OSV found `vite@8.0.13` nested under vitest after the direct bump to `8.0.16` | `bun.lock` retained a stale subtree; OSV has no notion of "already remediated at root" |
| Harness failure masquerades as payload defect | PR #152 — `payload-contract` failed for infra reasons (pipefail / frozen-lockfile drift), not a real payload change | `set -euo pipefail` + brittle step ordering; failure not isolated to the contract assertion |
| Toolchain micro-debugging instead of risk reasoning | Recurring — agents debug `deps.dev` RPC 127, semgrep baseline, osv `--no-resolve` flags | No policy separating "scanner is noisy" from "bump is dangerous" |

## 4. Advisory vs blocking — per-workflow policy (specialists repo)

| Workflow | On PR | On push/schedule | Verdict mapping | Action |
|---|---|---|---|---|
| `gitleaks` | **BLOCK** | BLOCK | → `BLOCKED` | Secrets = always real risk. No advisory mode. |
| `osv-scanner` | **ADVISORY** unless **SECURITY_FORCED** | **BLOCK** (any finding) | → `COOLDOWN` / `PASS_WITH_NOTES` / `SECURITY_FORCED` | **Rework (A1 / `unitAI-c7zdy.1`).** |
| `semgrep` | **BLOCK** (new findings only, diff-baseline) | INFO (no baseline) | → `BLOCKED` (new) / advisory (historical) | Already correct. Keep. |
| `package-payload` | **BLOCK** (real contract) | n/a | → `BLOCKED` | Keep; **harness hardening (A2 / `unitAI-c7zdy.2`)** so infra failures don't read as payload defects. |
| `telemetry-contract` | **BLOCK** (path-scoped) | BLOCK | → `BLOCKED` | Keep. |
| `pi-compat` | **BLOCK** (path-scoped canary) | weekly canary | → `BLOCKED` | Keep. |
| `release-gate` | n/a (push/master) | **BLOCK** | → `BLOCKED` | Keep. |

### 4.1 SECURITY_FORCED definition (operational)

An OSV/SAST finding is **SECURITY_FORCED** — and therefore blocks a PR despite
the advisory default — when **any** is true:

- Listed in **CISA KEV**, or OSV/GHSA explicitly flags active exploitation.
- **Public exploit / PoC** available.
- **EPSS ≥ 0.7** (high bucket).
- **CVSS ≥ 9.0 (critical)** **and** runtime-reachable in this repo's usage map
  (imported on a publicly-exposed path).
- Maintainer-reported active attack.

Everything else is advisory on PR. The push/schedule scan remains a hard gate
(SoT) regardless of classification.

## 5. Verdict taxonomy — operationalized (spec §9)

| Verdict | Triggered when | PR effect | Hand-off |
|---|---|---|---|
| `PASS` | Small bump, cooldown cleared, no advisories, low usage impact, tests present | comment, no gate | none |
| `PASS_WITH_NOTES` | Acceptable but needs migration note / specific test / watch | comment + required follow-up | service-skill update if drift |
| `COOLDOWN` | No security urgency, release `< 7d` old | defer / quarantine ledger | reschedule |
| `SECURITY_FORCED` | Meets §4.1 | **BLOCK** until remediated | bypasses cooldown; gated remediation |
| `NEEDS_CHANGES` | Requires code/config/test/workflow change | **BLOCK** until changed | executor follow-up |
| `BLOCKED` | Suspicious pkg, yanked, worsening advisory, unpinned Action, broken CI, missing critical signal | **BLOCK** | `ESCALATE_SECURITY` if supply-chain |
| `ESCALATE_SECURITY` / `ESCALATE_DEPLOYER` / `ESCALATE_SRE` | Crosses role boundary | per role | security-devops / deployer / SRE |

## 6. End-to-end pipeline (what we build)

```
Dependabot/Renovate/manual bump/advisory/sweep
  │
  ▼
[Deterministic Inspector]  ──► dependency_update_case.json   (C1 / xtrm-r1ed7.2)
  │   parse diff/lockfile, SBOM graph, advisory lookup, release age,
  │   usage map, service-skill lookup — NO LLM invention
  ▼
[updating-dependencies SKILL]  ──► upgrade dossier + verdict  (B / xtrm-r1ed7.1)
  │   source matrix (4 tiers) + migration analysis + local impact
  ▼
[Substrate materialization]   ──► advisor / followup / gate    (E1 / unitAI-c7zdy.3)
  │
  ▼
[GitHub Action wrapper]       ──► PR comment + label/verdict   (D1 / xtrm-r1ed7.3)
  │   read-only + PR-comment perms; no aggressive auto-mutation
  ▼
deployer (scoped issue + dossier) ──► deploy pulse ──► SRE post-deploy watch (v2, roadmap)
```

**Delivery boundary (spec §3):** the dependency capability prepares the case
and may propose a patch/comment. The **deployer** decides and executes
delivery; **SRE** observes post-deploy. The capability does not become a
DevOps monolith.

## 7. specialists repo transition (concrete)

### 7.1 `osv-scanner.yml` — current → target (A1 / `unitAI-c7zdy.1`)

**Current:** `osv-scanner scan source --recursive --no-resolve .` on
`pull_request` + `push` + `schedule`. Any finding → non-zero exit → blocks PR.

**Target:**
- **PR job:** run scan with `--format json`, explicitly capture stdout/status
  (`set +e`, redirect JSON to a file, then restore `set -e`) or mark only the
  scan step `continue-on-error`. Post-process the saved JSON through a
  **SECURITY_FORCED classifier** (§4.1). If all findings are
  non-SECURITY_FORCED → post an advisory PR comment, `exit 0`. If any
  SECURITY_FORCED → `exit 1` (block).
- **push(master) + schedule job:** unchanged hard gate — any finding blocks.
- Add `osv-scanner.toml` only for documented, bead-backed overrides, or pass an
  explicit `--config <path>` when using a different filename (mirrors the
  `.gitleaks.toml` allowlist discipline: no blanket ignores).

**v0 classifier (ships with A1, before the inspector exists):** CVSS ≥ 9 from
OSV severity field **or** KEV/active-exploit flag present → SECURITY_FORCED.
Refined to full EPSS/usage-awareness when the deterministic inspector (C1)
lands; A1 then consumes `dependency_update_case.json` instead of inline logic.

### 7.2 `package-payload.yml` — harness hardening (A2 / `unitAI-c7zdy.2`)

**Problem:** `set -euo pipefail` + multi-step `npm pack`/assert means a
harness failure (lockfile drift, transient install) reads as a payload-contract
failure and blocks the merge.

**Target:** isolate the contract assertion. The `payload-contract` job fails
**only** when `assert-package-payload.sh` returns non-zero against a
successfully-built payload. Install/build failures must surface as their own
named step, not as a false payload defect. (PR #152 already added
`9f52bc05 fix(ci): avoid pipefail false negatives`; A2 completes and
documents the isolation.)

## 8. v0 skill package — authored (B / delivered with this design)

Location: `~/dev/xtrm-tools/.xtrm/skills/default/updating-dependencies/`

```
updating-dependencies/
  SKILL.md                                  # rigid contract: inputs, sources, method, verdicts, escalation
  templates/
    upgrade-dossier.md                      # stable-section dossier (the agent's primary output)
    pr-comment.md                           # verdict + summary for PR
    research-matrix.md                      # 4-tier source matrix
    post-deploy-watch-spec.md               # OTel watch spec hand-off to SRE
  schemas/
    dependency_update_case.schema.json      # v0 deterministic case (spec §7)
    upgrade_dossier.schema.json             # dossier structure
```

The skill is **rigid by design** (spec §8): it does not let the agent invent
the process. It specifies inputs, the deterministic-first protocol, the source
matrix tiers, the verdict taxonomy with decision rules, the cooldown policy,
the GitHub-Actions special case, and the required outputs.

## 9. Phased roadmap → implementation board

Implementable now (v0 → v1.5); v2/v3 are roadmap (spec §18). Two coordinated
epics (bd edges do not cross DBs, so they are linked by this doc + prose):

**xtrm-tools capability epic — `xtrm-r1ed7`** (xtrm-tools DB):
| Phase | Bead | Deliverable | Deps |
|---|---|---|---|
| **B** | `xtrm-r1ed7.1` | v0 skill package (SKILL.md + 4 templates + 2 schemas) — *delivered with this design* | — |
| **C1** | `xtrm-r1ed7.2` | deterministic inspector → `dependency_update_case.json` | B |
| **D1** | `xtrm-r1ed7.3` | GitHub Action wrapper (case → skill → PR comment + verdict label) | B, C1 |
| **F** | `xtrm-r1ed7.4` | service-skill `Dependency Surface` section rollout (spec §12, v0.2) | B |

**specialists CI-adoption epic — `unitAI-c7zdy`** (specialists DB, discovered-from `unitAI-3v5sn`):
| Phase | Bead | Deliverable | Deps |
|---|---|---|---|
| **A1** | `unitAI-c7zdy.1` | `osv-scanner.yml` conditional blocking + v0 SECURITY_FORCED classifier + `.osv-scanner.toml` discipline | — (swaps to consume D1 when it ships) |
| **A2** | `unitAI-c7zdy.2` | `package-payload.yml` harness isolation | — |
| **E1** | `unitAI-c7zdy.3` | substrate materialization (advisor/followup/gate from verdict) | A1 |

**Roadmap (not in this board):**
- **v2** — deployer consumes scoped dossier; SRE post-deploy regression watch via OTel (spec §14–15).
- **v3** — productized agentic wedge: multi-repo backlog, risk prioritization, learned skills (spec §18–19).

## 10. Open decisions (deferred, not blocking)

- **Ecosystem-specific cooldown tuning.** 7d default is adopted; per-ecosystem
  npm/PyPI/Actions tuning deferred to after real cases (spec §20).
- **Artifact tarball diff depth.** v0 uses heuristic warnings; tarball/install-
  script diff deferred (spec §20).
- **`xt dep` command surface.** Deferred until the inspector + Action prove
  which primitives are needed (spec §17). The skill is the v0 surface.

## 11. Validation of this design (bead unitAI-3v5sn acceptance)

- [x] Synthesis of recurring problem + failure modes (§3)
- [x] Advisory-only vs blocking policy, explicit (§4)
- [x] Concrete v0 `updating-dependencies/SKILL.md` package (§8, authored)
- [x] Reduces operational ambiguity for the next dependency-bump PR (§4, §7)
- [x] Follow-up beads for multi-phase execution (§9 board: `xtrm-r1ed7` + `unitAI-c7zdy`)
