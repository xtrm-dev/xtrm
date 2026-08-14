---
title: Automatic CD Deployment Verification and Rollback — Mercury reference profile
type: design-supplement
status: accepted
date_created: 2026-08-14
date_modified: 2026-08-14
parent: docs/devops/devops-system.md
refines: docs/devops/deploy-gap-pattern.md
implementation_owner: mercuryintelligence/infra
specialist_owner: xtrm-dev/specialists
programme_owner: mercuryintelligence/program/workstreams/WS-010-devops-sre-specialist-team
---

# Automatic CD Deployment Verification and Rollback — Mercury reference profile

> **Role of this document.** `devops-system.md` remains the system-level DevOps canon. `deploy-gap-pattern.md` documents the merge-vs-running-image failure class. This document is the accepted first bounded Mercury implementation profile for the deployment boundary: exact artifact identity, deployment receipts, deterministic fast gates, automatic `deploy-monitor` dispatch, narrow automatic rollback, and explicit runtime/repository reconciliation.
>
> Acceptance of this design does **not** authorize a production deployment, restart, rollback, credential change, or other operational mutation. Repository-local Beads and the applicable operational authority continue to govern execution.

## 1. Problem

A merge can trigger continuous deployment, but repository delivery does not prove that the intended revision is running, healthy, stable, or recoverable.

A deployment pipeline that ends at `docker compose up` plus a short log tail leaves a deployment gap between Git and production. A container `start` event also does not prove that a governed deployment occurred: it can represent a restart, recovery, crash loop, manual recreate, or unrelated operational action.

The first implementation must therefore make the deployment itself an evidence-producing transaction.

## 2. Existing principles to preserve

The existing DevOps role split remains authoritative:

- `deployer` owns delivery, preflight, rollout, bounded deterministic validation, and rollback execution when policy explicitly permits it;
- `devops-sre` / `deploy-monitor` owns read-only post-deploy observation, evidence capture, and the verdict;
- the orchestrator/operator owns ambiguous or authority-expanding decisions.

The current `deploy-monitor` contract is directionally correct. It owns:

- deploy-gap verification;
- proof that the intended artifact is running;
- absolute-time post-deploy sampling;
- evidence capture;
- one verdict per observation window: `PASS`, `HOLD`, or `BLOCKED`.

It does **not** own PR review, merge, code edits, redeployment, or rollback execution.

## 3. Target lifecycle

```text
PR accepted
    ↓
merge / authorized deployment request
    ↓
capture previous-known-good artifact N-1
    ↓
resolve exact candidate artifact N
    ↓
deploy N
    ↓
emit deployment receipt
    ↓
deterministic fast deployment gate
    ├── hard deterministic failure
    │       ↓
    │   restore exact N-1
    │       ↓
    │   validate N-1
    │       ↓
    │   emit rollback receipt
    │
    └── pass
            ↓
      dispatch deploy-monitor
            ↓
      post-deploy observation
        ├── PASS    → deployment accepted
        ├── HOLD    → orchestrator evaluates
        └── BLOCKED → deployment not accepted
```

The canonical monitor trigger is a **successful governed deployment**, not the merge event alone and not a raw Docker lifecycle event.

## 4. Deployment authority versus reconciliation signals

The runtime must distinguish deployment authority from detection.

### 4.1 Authoritative trigger

The authoritative trigger is a deployment controller or equivalent governed CD path that can prove:

- which repository revision requested the deployment;
- which immutable artifact was selected;
- which target was changed;
- which artifact was previously known good;
- whether the deployment command succeeded;
- whether the deterministic fast gate passed.

Only this path may emit a `deployment receipt` that authorizes automatic `deploy-monitor` dispatch.

### 4.2 `docker events` is reconciliation, not deployment authority

A bounded `docker events` listener can still be useful, but only as a reconciliation detector.

Examples:

```text
container start with matching governed deployment receipt
    → expected event; no new authority

container start without a current deployment receipt
    → unmanaged-runtime-change finding
    → reconcile / escalate

restart loop after accepted deployment
    → runtime incident signal
    → sre-triage / deploy-monitor evidence
```

The listener must not manufacture a deployment retrospectively from `event=start`.

## 5. Deployment receipt

Every governed deployment should emit a structured receipt.

Illustrative contract:

```yaml
schema_version: mercury.deployment-receipt.v1
deployment_id: <stable-id>
repository: <owner/repo>
service: <service-name>
merge_sha: <git-sha>
artifact_id: <immutable image digest or artifact id>
previous_revision: <git-sha-or-null>
previous_artifact_id: <immutable image digest or artifact id>
deployed_at: <utc timestamp>
deployment_target: <sanitized target identity>
workflow_run: <run id/url-or-local-execution-id>
monitor_profile: <profile>
fast_gate_result: PASS
```

No credentials, tokens, secrets, private payloads, raw environment values, or sensitive host data belong in the receipt.

A deployment receipt is evidence of the deployment transaction. It is not by itself evidence of post-deploy acceptance.

## 6. Exact artifact identity

A fresh `StartedAt` is not sufficient proof of the intended deployment.

Preferred identity:

```text
immutable image digest
+
org.opencontainers.image.revision=<merge SHA>
```

Where the deployment mechanism does not use OCI images, use the strongest immutable artifact identity available.

`deploy-monitor` must refuse to open its observation window when it cannot prove that the intended artifact is serving the target workload.

`StartedAt > mergedAt` remains a useful lower-bound deploy-gap check, but it is not sufficient identity evidence.

## 7. Previous-known-good artifact

Rollback safety requires N-1 to be captured **before** N changes the target.

The controller must record the currently deployed artifact and its attributable revision before rollout.

Preferred rollback source:

```text
exact immutable artifact N-1
```

Do not depend on rebuilding an old source revision during an incident when the exact previous artifact is still available.

If no attributable previous-known-good artifact can be established, automatic rollback is disabled for that deployment and the receipt must record that limitation explicitly.

## 8. Fast deployment gate

The CD path performs a short synchronous deterministic gate before long observation begins.

Minimum checks for a service profile are:

1. deployment command completed successfully;
2. target service/container exists;
3. intended immutable artifact is running;
4. no persistent restart loop is present;
5. declared health check becomes healthy within a bounded timeout;
6. no deterministic fatal startup/schema/import error is present;
7. a direct functional probe succeeds where a stable deterministic probe exists.

The gate must fail closed when required identity or mandatory evidence is unavailable.

Do not ask an LLM to decide whether these deterministic conditions passed when a script can evaluate them directly.

## 9. Deploy-monitor window

After the fast gate passes, the deployment controller automatically dispatches `deploy-monitor` with the deployment receipt and profile.

The current observation contract remains appropriate:

- optional T+0 baseline;
- absolute UTC schedule;
- 5-minute cadence;
- up to 60 minutes by default;
- immediate escalation on the first material abnormal sample.

Signals remain profile-specific, with generic fallbacks:

- Tempo/traces;
- Prometheus/alerts;
- Grafana;
- direct health/freshness/API probes;
- bounded read-only DB queries when necessary;
- public edge probes where relevant.

Final verdict:

```text
PASS
HOLD
BLOCKED
```

The monitor reports evidence and verdict. It does not mutate production.

## 10. Rollback model

Runtime rollback and source-code reconciliation are separate operations.

On an authorized deterministic hard failure:

```text
deploy N
→ hard failure
→ redeploy exact previous artifact N-1
→ validate N-1
→ record deployment N as ROLLED_BACK
→ emit rollback receipt
```

After runtime rollback, repository state must be reconciled separately through a bounded revert/fix PR when required so production does not remain silently behind the default branch.

A runtime rollback must never silently rewrite Git history.

## 11. Automatic rollback versus HOLD

Automatic rollback remains deliberately narrow.

### 11.1 AUTO-ROLLBACK candidates

A service profile may authorize automatic rollback for deterministic conditions such as:

- service/container fails to start;
- health check remains failed beyond the declared startup allowance;
- persistent restart loop;
- deterministic schema/runtime incompatibility prevents operation;
- wrong artifact was deployed;
- target service becomes unreachable immediately after deployment;
- deterministic edge-wide outage attributable to the deployment.

The service profile must declare which predicates are authorized. A global implicit rollback policy is not permitted.

### 11.2 HOLD / orchestrator decision

The following conditions remain evidence for judgement rather than automatic rollback:

- latency degradation;
- elevated but non-catastrophic error rate;
- freshness anomaly;
- suspicious trace behavior;
- telemetry conflict;
- partial downstream degradation;
- ambiguous business/data-quality signals.

`deploy-monitor` reports the evidence and emits `HOLD` or `BLOCKED`. The orchestrator/operator decides the next action under the current authority envelope.

## 12. Service profiles and allow-listing

Automatic monitoring and rollback policy should be **allow-list based**.

Illustrative profile shape:

```yaml
services:
  mcp-gateway:
    monitor_profile: edge-api
    auto_monitor: true
    auto_rollback:
      - startup-hard-fail
      - wrong-artifact

  questdb:
    monitor_profile: database
    auto_monitor: true
    auto_rollback:
      - startup-hard-fail

  darth-feedor:
    monitor_profile: worker-freshness
    auto_monitor: true
    auto_rollback:
      - startup-hard-fail
```

Services not present in the allow-list do not acquire automatic production mutation authority by default.

## 13. Closure semantics

Deployment is not closed because a GitHub Actions workflow or local deploy command exited successfully.

Preferred lifecycle:

```text
DEPLOYING
→ FAST_GATE_PASSED
→ MONITORING
→ ACCEPTED
```

or:

```text
DEPLOYING
→ FAILED
→ ROLLING_BACK
→ ROLLED_BACK
```

Repository delivery, runtime deployment, runtime acceptance, and programme reconciliation remain separate evidence surfaces.

## 14. Workflow-engine decision for the first implementation

The first Mercury implementation must **not** add Archon as a production runtime dependency.

Archon is a useful reference because its workflow model cleanly separates declarative coordination, deterministic script execution, structured outputs, approvals, resumability, and agent judgement. The same separation is appropriate here:

```text
declarative workflow topology coordinates
code/scripts compute deterministic gates
specialists judge ambiguous operational evidence
```

However, placing Archon in the first production path would create a second workflow authority between Mercury CD and XTRM/Specialists while XTRM is already defining its own deterministic chain/runtime contracts.

The first implementation is therefore **Archon-shaped but XTRM-native**:

```text
GitHub/CD or authorized deploy request
→ small Mercury/XTRM deployment controller
→ deterministic gates and receipts
→ existing Specialists/Pi deploy-monitor role
→ Mercury infra
```

Later, when XTRM `ChainTemplate` / `ResolvedChain` execution is ready for this vertical, the same lifecycle can be materialized as the canonical `devops-deploy` chain without changing the authority model or evidence contracts.

## 15. Initial implementation ownership

The first implementation should preserve the current separation of concerns.

### `mercuryintelligence/infra`

Owns the concrete Mercury deployment controller and operational integration:

- target/service configuration;
- deployment lock/idempotency;
- previous-artifact capture;
- exact artifact deployment;
- deterministic fast gates;
- deployment/rollback receipt persistence;
- systemd/event reconciliation integration where needed;
- GitHub Actions or other CD entry points that call the controller.

### `xtrm-dev/specialists`

Owns the reusable role semantics and execution contract for:

- `deployer`;
- `devops-sre` / `deploy-monitor`;
- authority boundaries;
- handoff/result schema where shared;
- reusable service/profile integration points where they belong to Specialists rather than Mercury.

Do not create a separate `mercury/specialists` repository for this first slice.

### `xtrm-dev/xtrm`

Owns the DevOps system design, cross-cutting workflow/evidence semantics, and eventual XTRM chain integration.

### `mercuryintelligence/program`

`WS-010-devops-sre-specialist-team` owns programme-level sequencing and cross-repository reconciliation. It does not become the implementation tracker.

Repository-local Beads remain executable implementation truth.

## 16. Minimal implementation path

Do not build a new deployment platform first.

1. Select one allow-listed Mercury service as the reference vertical.
2. Make its existing CD/deploy path resolve an exact immutable candidate artifact.
3. Capture the previous-known-good artifact before rollout.
4. Add a small idempotent deployment controller in `mercuryintelligence/infra`.
5. Replace weak `sleep && tail logs` checks with bounded deterministic fast gates.
6. Emit `mercury.deployment-receipt.v1`.
7. Automatically dispatch existing `deploy-monitor` only after fast-gate success.
8. Persist the monitor result with the same `deployment_id`.
9. Implement only the explicitly allowed deterministic hard-failure rollback predicates.
10. Emit a rollback receipt and validate restored N-1.
11. Treat unmatched `docker events` as reconciliation findings, not deploy receipts.
12. Add a controlled failure exercise before promoting the mechanism to additional services.

Only after repeated evidence should Mercury consider a broader shared deployment manager, fleet deployment history, canary orchestration, or progressive delivery primitives.

## 17. Non-goals

This first profile does not require:

- Kubernetes;
- GitOps;
- Archon as a production dependency;
- a new general workflow engine;
- a new monitoring stack;
- a new `mercury/specialists` repository;
- automatic rollback for every metric anomaly;
- `deploy-monitor` authority to mutate production;
- treating every Docker start as a deploy;
- autonomous source-code reverts;
- a general agent-team framework.

## 18. Acceptance criteria for operational promotion

Before the mechanism is promoted beyond a bounded reference service, demonstrate that:

1. an authorized merge/deployment request triggers the governed CD path;
2. the running artifact is attributable to the intended revision using immutable identity;
3. the previous-known-good artifact is captured before rollout;
4. the fast gate rejects a controlled broken deployment;
5. `deploy-monitor` starts automatically only after the intended artifact is proven running and the fast gate passes;
6. the monitor produces a durable `PASS`, `HOLD`, or `BLOCKED` result linked to `deployment_id`;
7. a controlled hard-failure exercise restores the exact previous artifact;
8. the restored artifact is validated after rollback;
9. repository/runtime divergence after rollback is explicitly reconciled;
10. unmatched runtime starts are surfaced as reconciliation findings rather than forged deployment evidence;
11. receipts leak no credentials, secrets, environment payloads, or sensitive host information;
12. duplicate/replayed deploy requests do not produce uncontrolled duplicate rollouts or monitor windows.

## 19. Final rule

> A merge may trigger CD automatically. A successful governed deploy must emit an attributable deployment receipt and pass deterministic fast gates before `deploy-monitor` starts. Production acceptance requires proof of the exact running artifact plus a clean monitoring verdict. Hard deterministic failures may roll back only through explicitly authorized service predicates to the captured previous-known-good artifact. Ambiguous degradation produces `HOLD`/`BLOCKED` evidence and escalates. Raw Docker lifecycle events are reconciliation signals, not deployment authority.
