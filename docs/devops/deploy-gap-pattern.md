# Deploy Gap — merge-vs-running-image drift

**Class of failure**: a code change lands on `master`, but the running container is never rebuilt from the new image. Observability, alarms, and the Deploy Monitor keep reflecting the old code. Nothing distinguishes "regression" from "expected new-code behavior with old bytes still serving traffic". Nobody notices for weeks.

**Provenance**: two live incidents on Mercury Platform.
1. `mercury-market-data-82wh` — the snapshot-feed cycle-time regression sat undetected for **over a month** because the fix that had been discussed was never actually built into the running image.
2. `mmd-sprint 2026-07-03` — during the sprint that closed 82wh, the Deploy Monitor opened its 60-minute observation window after PR #342 merged and correctly measured the pre-fix p95 (~779s) against the still-running old image. It aborted the window as a regression. The orchestrator had to manually run `docker compose build && docker compose up -d --force-recreate` before observation could resume. Same class of failure, reproduced inside the response to it.

Follow-up bead: **`mercury-market-data-nsur`** (P1, `contract:ready`).

---

## Why merge is not deploy

CI on green merge does not, by default, rebuild any running container. Depending on the service, the actual deploy step may be:

- A GitOps push (Argo, Flux) that materializes on the next reconcile loop.
- A CD pipeline triggered by tag, not by merge to `master`.
- A manual `docker compose build && up -d --force-recreate` per host.
- Nothing at all — the container is rebuilt only when the operator restarts it, which may be weeks later.

In every one of those paths, the interval between "PR merged" and "container running new code" is nonzero and often unbounded. During that interval:

- Prometheus, Tempo, and Grafana show the old code's behavior.
- Any alarm that would have caught the pre-fix regression continues to be quiet, because the fix's premise ("code is now different") is false.
- A Deploy Monitor window opened during this interval measures the pre-fix baseline and either reports "regression persists" (correct read of the wrong world) or "clean" (if the pre-fix baseline happened to be inside tolerance).
- A subsequent operator restart — even for an unrelated reason — silently promotes the new code without any observation window at all.

The gap is the whole point. Nothing in git, no CI status, no dashboard makes the gap visible without an explicit check.

---

## Enforcement — two chained guards

### Guard 1 (orchestrator-side): merge → rebuild → observe

The sprint orchestrator (or any protocol that moves a PR from merge to observation) must chain the three steps as one indivisible sequence:

1. `gh pr merge <N> --repo <owner>/<repo> --squash --admin` (or the repo's actual merge command).
2. `docker compose -f <compose-file> build <service>` on the target host.
3. `docker compose -f <compose-file> up -d --force-recreate <service>` on the target host.
4. Only then hand off to the Deploy Monitor.

`--force-recreate` is not cosmetic. Without it, Docker keeps the existing container if the image tag hasn't changed textually, even when the image bytes underneath have. That is the trapdoor 82wh fell through: the compose file pinned `latest`, the image was rebuilt, but the container was left untouched.

For services deployed via GitOps or a CD pipeline: the equivalent guard is "wait for the reconciler / pipeline to report a rollout where `.Status.RolloutRevision` post-dates the PR `mergedAt`". A rebuild-triggering commit or tag push, then poll rollout status until it advances.

Skipping this chain to "let the operator restart it later" is the bug. The whole point is that "later" doesn't happen and nobody notices.

### Guard 2 (DM-side): pre-window refuse

The Deploy Monitor must refuse to open its observation window if the running container's start time is earlier than the PR's merge time. This is the belt-and-suspenders against Guard 1 being skipped.

```bash
# Both timestamps in RFC3339. mergedAt from the PR; StartedAt from the container.
PR_MERGED=$(gh pr view "$PR" --repo "$REPO" --json mergedAt --jq .mergedAt)
CONTAINER_STARTED=$(docker inspect --format '{{.State.StartedAt}}' "$CONTAINER")

# Refuse if container started BEFORE the merge landed.
if [[ "$CONTAINER_STARTED" < "$PR_MERGED" ]]; then
  echo "REFUSE: container $CONTAINER started at $CONTAINER_STARTED, PR $PR merged at $PR_MERGED. Rebuild + force-recreate first." >&2
  exit 2
fi
```

Same check works for k8s: `kubectl get pod -o jsonpath='{.status.startTime}'` against PR `mergedAt`.

The check is cheap (one API call + one shell inspect) and its false-positive rate is zero: if the container was started before the merge, whatever it is running is not the merged code.

Add the check to the DM's per-window preflight, next to the existing "no firing alerts" and "target service reachable" checks. Fail the window open with a specific error, not a generic "aborted".

---

## What the check does not cover

- **The compose file itself was not deployed.** If the deploy method is `git pull && docker compose up -d` and the operator forgot to pull, the container will restart with the OLD compose file. `StartedAt > mergedAt` will pass. Mitigation: version-pin the compose file itself in the deploy step, or compare `docker inspect --format {{.Image}}` against the expected image digest published by CI. This is a variant of the same gap and worth extending Guard 2 to cover for critical services.
- **Multi-container services with partial rollout.** If the PR touches N containers and only some are rebuilt, `StartedAt` on the untouched containers will still be pre-merge. That is correct — the DM should refuse. Do not add per-container overrides; the whole rollout is either fresh or it isn't.
- **Blue/green with the old color still serving.** `docker inspect` on the "new" color passes the check; traffic is still on "old". The check needs to inspect whichever container is actually receiving traffic, not whichever one exists. Consult the reverse proxy / service mesh routing before the inspect.

---

## Related material

- `mercury-devops-collaborator.md` — the operator-side handbook for how DM windows are opened and closed. This doc adds the "before opening" precondition; the collaborator doc owns the "during" and "after".
- `agent-observability-pattern.md` — general observability wiring. Deploy gaps are a specific failure mode of the observation-vs-actual-code invariant that pattern relies on.
- `git-hooks-vs-ci-policy.md` — sibling doc on why `--no-verify` is sometimes justified and what test coverage that shifts onto CI. Related, but a different axis: git hooks let a change land; deploy gap keeps it from taking effect.
- Sprint eval: `/tmp/mmd-sprint/eval-harness.md` (EVAL-22 — the P0 headline that motivated this file).

## Change log

- 2026-07-03: initial version. Extracted from EVAL-22 during the mmd-sprint harness-extraction pass. Cross-referenced with bead `mercury-market-data-nsur`.
