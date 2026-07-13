---
title: mercury-devops-collaborator — containerized DevOps bot architecture
status: DESIGN — pre-implementation
authored: 2026-06-26
authors: dawid + claude-orchestrator (infra session)
supersedes:
  - xtrm-dev/specialists:docs/design/auto-reconcile-delivery.md
    (Options A/B/C/D for service-skills-sync PR delivery — collapsed into Section 4 of this doc as v0 implementation)
related:
  - mercury-infra:docs/telemetry/runbooks/devops-agent-grounding.md (xtrm devops crosswalk)
  - mercury-infra:CLAUDE.md (Mercury infra topology — observed and incorporated)
  - xtrm-dev/xtrm:packages/specialists (sp run, sp ps, sp feed semantics)
---

# mercury-devops-collaborator

A containerized DevOps agent platform: a single sandboxed container that hosts
all xtrm specialist agents responsible for operating on Mercury repos, with its
own GitHub identity, its own clones of every Mercury repo, and full autonomy
over its internal specialist lifecycle. The operator interacts with it through
GitHub (PRs, issues) and `docker exec` (introspection), never through host
filesystem coupling.

This document captures the design space, the proposed first concrete
implementation (`service-skills-sync` as v0), the open questions, and the
sequencing for ramping up.

---

## 1. Motivation

xtrm's devops/SRE surface is heading toward a system of cooperating
specialists: SRE triage, watcher loops, incident research, dependency
monitoring, alert-to-runbook reconciliation, observability-rule maintenance,
and so on. These agents need:

- read access to source code of every repo under management
- the ability to commit and open PRs on the repos they manage
- the ability to run independently of the operator's working session
- observability into their own progress
- a credential store that does not put production secrets in their hands

Today the only working pattern is "operator manually invokes `sp run X` from
their host". This blocks every autonomous use case (watcher loops, scheduled
audits, webhook-driven reactions). It also couples specialist work to the
operator's filesystem state, which is the source of every drift bug we've
hit in the Phase C campaign — restage races, beads-hook noise, `git status`
pollution, accidental working-tree mutations.

The proposed pattern: a long-lived container that holds the agent platform.

## 2. Trust and isolation requirements

- The bot must NOT have access to the operator's working tree, SSH keys,
  production database credentials, deploy keys, or any state derived from
  them.
- The bot must NOT be able to force-push, delete branches, or merge PRs on
  upstream Mercury repos. Its writes are confined to its own fork; promotion
  to upstream is a normal PR flow gated by upstream's protected-branch rules.
- The bot must NOT operate on the operator's clones. Filesystem coupling
  is the failure mode being eliminated.
- The bot's identity must be visually and structurally distinguishable from
  the operator's identity in every artifact it produces (commits, PRs,
  issues, comments).
- The bot's credentials must be scoped to what its agents need and rotatable
  without touching upstream Mercury repo settings.

These rules collapse to: separate GitHub account, separate clones, separate
filesystem, separate credentials, separate observability surface, all of
which live in a container.

## 3. Architecture

```
┌────────────────────────────────────────────────────────────┐
│ Mercury VPS (host)                                          │
│                                                             │
│  Operator's working clones at ~/projects/mercury/<repo>     │
│  (untouched by the bot, never bind-mounted into container)  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ mercury-devops container ("the collaborator")        │   │
│  │                                                      │   │
│  │  Toolchain (image-baked):                            │   │
│  │   - sp + @jaggerxtrm/specialists (canonical)         │   │
│  │   - bun, node, gh CLI                                │   │
│  │   - claude-code CLI                                  │   │
│  │   - serena, gitnexus binaries (pinned glibc-safe)    │   │
│  │                                                      │   │
│  │  State (named volumes, persistent across restarts):  │   │
│  │   - /workspace/repos/<repo>      cloned forks        │   │
│  │   - /workspace/beads             bot's own bd state  │   │
│  │   - /root/.pi/agent/             nano-gpt key + sp   │   │
│  │   - /root/.config/gh             bot's GH PAT        │   │
│  │   - /var/log/mercury-devops      structured logs     │   │
│  │                                                       │   │
│  │  Agents inside (process model):                      │   │
│  │   - webhook receiver (FastAPI on internal port)      │   │
│  │   - cron scheduler (system + per-agent)              │   │
│  │   - sp daemon (canonical job orchestrator)           │   │
│  │   - watchers (sre-triage, dependency-monitor, …)     │   │
│  │     each a systemd-user unit or cron loop            │   │
│  │   - episodic specialists invoked per webhook event   │   │
│  │                                                       │   │
│  │  Network surface:                                    │   │
│  │   - inbound: Traefik route → webhook receiver        │   │
│  │   - outbound: github.com, nano-gpt.com, sp telemetry │   │
│  │   - NO connection to mercury_dev_network             │   │
│  │   - NO connection to mmd-network / treasury-network  │   │
│  │   - NO read of Mercury production databases          │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
                           ↑
                  webhook deliveries from
                  github.com (per-repo subs)
                           ↓
                  PR from bot's fork → upstream Mercury repo
                  (operator reviews + merges, exactly as for any contributor)
```

### Bot identity

v0/v1: dedicated GH user account (e.g. `mercury-devops-bot`) with a PAT
stored in `/root/.config/gh/` inside the container. The bot is invited to
`mercuryintelligence` org as outside-collaborator with PR-write permission on
listed repos. No `repo:admin`, no `workflow`, no `org:admin`.

v2+ (when scale demands it): migrate to GitHub App. Per-repo permission
grants are time-bounded; audit log is first-class; PRs surface as
`mercury-devops-bot[bot]`. Migration is one credential swap in the container
+ webhook source re-config.

### Specialist lifecycle inside the container

The container is itself an xtrm project. Inside:
- `~/.pi/agent/auth.json` holds the bot's LLM provider keys
- `sp` is the canonical job orchestrator (jobs, feed, ps, result)
- `bd` is the canonical task tracker (separate project: `mercury-devops`)
- `xt update --apply` runs on cron (04:00 daily) — bot self-updates xtrm
  canonical skills with zero operator intervention
- `xt doctor` runs on cron (05:00 daily) — drift detected files a bd for
  internal self-investigation
- `.specialists/user/` holds bot-authored specialists (e.g. a future
  `mercury-devops-reconciler` tuned to Mercury's repo conventions)
- Memories accumulated via `bd remember` compound across runs

The operator's `sp ps`, `bd ready`, and working tree are independent of the
container's. They share only the github.com surface.

## 4. Sync model: GitHub is single source of truth

The bot does not look at the operator's host. It looks at github.com. When
the operator commits and pushes, that push is the bot's "this is now real,
consider reacting" signal. Pre-push state is irrelevant — it is not work yet.

### Sync layer 1: webhook-driven (canonical path)

Every Mercury repo subscribes its webhook to the bot's receiver for:
- `push` events on `master|main`
- `pull_request.closed` with `merged=true`
- `repository_dispatch` (manual operator trigger or cross-agent dispatch)

The receiver's first action on every event (regardless of which agent it
ultimately dispatches) is to sync the local fork:

```bash
cd /workspace/repos/$repo
git fetch upstream --quiet
git checkout $branch
git merge --ff-only upstream/$branch
git push origin $branch       # bot's fork now mirrors upstream
```

Only after the sync does the receiver evaluate whether the event matches
any agent's trigger. Sync is unconditional. The bot's forks are kept fresh
by every event the bot receives, regardless of whether the bot acts.

### Sync layer 2: cron safety net (15-minute heartbeat)

```cron
*/15 * * * * /usr/local/bin/sync-all-forks.sh
```

```bash
# sync-all-forks.sh
for repo in /workspace/repos/*; do
  cd "$repo"
  for branch in main master; do
    if git rev-parse --verify "upstream/$branch" >/dev/null 2>&1; then
      git fetch upstream --quiet "$branch"
      git checkout "$branch" 2>/dev/null && \
        git merge --ff-only "upstream/$branch" && \
        git push origin "$branch" --quiet
    fi
  done
done
```

Catches webhook delivery losses (GitHub does not retry past 200). Cron is
the safety net; webhook is the canonical path.

### Sync layer 3: pre-flight inside dispatcher

Before any `sp run` invocation, one final fetch + checkout to the exact
SHA in the event payload:

```bash
cd /workspace/repos/$repo
git fetch upstream --quiet
git checkout $event_sha          # the exact sha the webhook referenced
sp run service-skills-sync --bead $bid --background
```

Specialist works on a deterministic SHA, not "current master + lag". PR base
remains `master` (named branch); if upstream moved during the run, the PR
shows "needs rebase" and the post-run hook handles `git pull --rebase
origin master` before push.

### Compositional guarantee

- Webhook arrives → L1 syncs in sub-second
- Webhook lost → L2 syncs within 15 min
- Specialist dispatched → L3 ensures deterministic SHA

The three layers together: no work scenarios where the bot acts on stale
state, and no scenarios where lost work goes undetected past 15 min.

## 5. Race conditions and concurrency

### Same-repo race

Scenario: specialist A is in flight on `infra@sha_X`. Operator merges PR Y
on `infra`, master moves to `sha_Y`. Specialist A finishes; opens PR.

If A's diff doesn't overlap Y's diff → PR merges clean.
If A overlaps → GitHub shows "needs rebase". A's post-run hook runs:
```bash
git pull --rebase origin master
git push --force-with-lease origin xtrm-auto-reconcile/$sha_X
```
If rebase has conflicts → A files a `bd note` and posts a sticky comment on
its own PR: "needs operator merge". No autonomous conflict resolution.

### Same-repo queue (per-repo lock)

```bash
flock -n /var/lock/sp-$repo.lock sp run service-skills-sync --bead $bid
```

If webhook B fires while A is running on the same repo, B waits for A's
lock. When A releases, B's pre-flight `git fetch upstream` picks up A's
landed PR (if merged) — B sees the latest state.

Cross-repo concurrency is unrestricted: bot can run 5 specialists in
parallel on 5 different repos with no coordination cost.

### Webhook receiver crash mid-dispatch

Receiver accepts, hands off to a background queue, returns 200 to GitHub
immediately. If the receiver crashes after 200 but before dispatch, GitHub
will not retry. Mitigation: the L2 cron safety net runs every 15 min, but it
does NOT trigger specialists — it only syncs the mirror. Missed specialist
dispatches need a different recovery path:

**Post-restart audit** (see Section 6).

## 6. Crash recovery and post-restart audit

Container restart leaves orphaned in-progress specialists in the bot's
`observability.db`:

```bash
# entry point of container CMD:
sp ps --json | jq -r '.jobs[] | select(.status=="running") | .id' | \
  xargs -r -n1 sp stop --reason="container-restart-orphan"
```

Then a post-restart audit detects missed work:

```bash
for repo in /workspace/repos/*; do
  cd "$repo"
  git fetch upstream --quiet
  upstream_head=$(git rev-parse upstream/main 2>/dev/null || \
                  git rev-parse upstream/master)
  mirror_head=$(git rev-parse HEAD)
  if [ "$upstream_head" != "$mirror_head" ]; then
    bd create --title="Post-restart audit: $(basename $repo) lagged" \
              --description="Container down; mirror at $mirror_head, upstream at $upstream_head. Re-evaluate triggers between these refs." \
              --priority=2 --type=task
  fi
done
```

The bot then processes those bds autonomously — for each lagged repo, it
walks the commit range and re-decides which specialists should have fired.

Crash recovery is autonomous. The operator never intervenes.

## 7. Garbage collection (autonomous)

Weekly cron inside the container:

```bash
# delete reconcile branches whose upstream PR is closed/merged
for repo in /workspace/repos/*; do
  cd "$repo"
  upstream=$(git config --get remote.upstream.url)
  for branch in $(git branch -r | grep 'origin/xtrm-auto-reconcile'); do
    pr_state=$(gh pr list --repo "$upstream" \
                 --head "${branch#origin/}" --state all \
                 --json state -q '.[0].state' 2>/dev/null)
    case "$pr_state" in
      MERGED|CLOSED) git push origin --delete "${branch#origin/}" ;;
    esac
  done
done

# vacuum sp observability history > 30d
sp clean --history --older-than=30d

# rotate /var/log/mercury-devops
logrotate /etc/logrotate.d/mercury-devops
```

No operator action required.

## 8. service-skills-sync as v0 implementation

`service-skills-sync` is the natural primitive to validate the entire
architecture without committing to it. Why it fits:

| Quality | Why it matters here |
|---|---|
| Bounded scope | Reconciles only service-skill docs; no business logic |
| Low risk | Output is documentation; worst case is "PR not merged" |
| Synchronous + completable | Webhook → reconcile → PR → done; no long-running daemon |
| Clear input | Push/PR-merge event payload + repo + SHA |
| Clear output | One PR per reconcile run, with structured diff |
| Forces every infra decision | Bot identity, fork strategy, PR flow, container, webhook |

What v0 forces us to decide and ship:
- GH bot account + PAT
- Container Dockerfile + image
- Webhook receiver (~50 LOC FastAPI) inside the container
- Fork-sync cron + on-demand sync
- L3 pre-flight dispatcher
- Specialist `service-skills-sync` with `requires_worktree: true` and
  Phase 6 (specialist self-opens PR via `gh pr create`)
- `register-webhook.sh` one-shot per Mercury repo
- `/workspace/repos/` topology

What v0 does NOT yet force (deferred to later agents):
- Persistent watcher loops
- Cross-repo correlation
- Self-improvement memory loops
- Bot-authored specialists in `.specialists/user/`
- Inter-agent dispatch (one agent triggering another)

v0 produces all the infrastructure that later agents drop into for free.

## 9. Operator observability into the bot

The operator does not bind-mount anything from the container into the host.
All visibility is `docker exec` based.

| What the operator wants to see | How |
|---|---|
| What's the bot running right now? | `docker exec mercury-devops sp ps` |
| Live feed of a specific job | `docker exec -it mercury-devops sp feed <job-id>` |
| What has the bot discovered? | `docker exec mercury-devops bd ready` |
| Bot's open PRs across Mercury | `gh pr list --author mercury-devops-bot` |
| Bot's bd memories | `docker exec mercury-devops bd memories <keyword>` |
| Container health | `docker compose ps mercury-devops`, structured logs in `/var/log/mercury-devops` (volume mounted) |
| Forensic.v1 traces | Grafana Tempo, filter by `mercury_module=devops-bot` (same axis as every other Mercury producer) |
| Internal metrics | Container exposes `/metrics` on internal network; Prometheus scrape job; new dashboard panel in `mercury-forensic-runners-specialists.json` |

Operator-to-bot communication for non-routine cases: the bot files a bd in
ITS board, tagged `escalate:operator`. Cron exports those to a structured
notice (Telegram message, sticky issue on a dedicated "mercury-devops-bot
status" repo). Choice of channel is operator preference; see open question 1.

## 10. Open questions

These are intentionally unresolved at design-time. They affect implementation
shape but not the architecture skeleton.

### Q1. Operator-bot urgent notification channel

When the bot discovers a P0 incident or a security finding it cannot
autonomously fix, how does it page the operator outside of "look at the
bot's bd board"? Options:
- Telegram via existing alertmanager pipeline (reuses Mercury infra)
- GitHub issue with `@dawid` mention in a dedicated tracking repo
- Push notification to operator's Claude Code session via xtrm push API
- Nothing: bd-only, operator polls at convenience

### Q2. Trust escalation curve

The bot starts at `pr-write` permission. After N months of zero
false-positive PRs, do we extend its scope (e.g. self-merge of dependabot-
style trivial bumps)? Or stay PR-only forever for principled separation?

Author's bias: PR-only forever. Even routine bumps benefit from operator
eyeball pattern-matching. The cost of "one more click" is negligible vs the
audit trail benefit.

### Q3. Identity ownership

Is `mercury-devops-bot` a real GH user (PAT minted from operator's
account), or a GH App owned by an xtrm org? GH App is cleaner but
heavier setup; GH user is sufficient for v0/v1.

Author's bias: GH user (v0), migrate to GH App when adding the second
agent (v2). Migration cost is one credential swap.

### Q4. Bot personality / commit style

Should the bot have a distinct commit message style, PR description
template, emoji set, or "voice"? It seems trivial but it directly affects
operator pattern-matching when scanning git log or PR lists.

Author's bias: subtle stylistic markers (prefix `bot:` in commit subject,
distinct PR description template). No emoji. Plain prose. Clear separation
from operator-written commits without being noisy.

### Q5. Container as platform for further bots

When a second devops bot makes sense (e.g. `data-quality-bot` for Mercury
market-data ingestion validation, scoped to that domain), is it the same
container with multiple agent processes, or a separate container per
domain?

Author's bias: same container while the overhead of duplication > the
overhead of isolation (probably through 3-5 agents). Refactor to
container-per-bot when one agent becomes heavy (e.g. holds its own
domain-specific DB state).

### Q6. Webhook receiver inside the container vs in api-gateway

Mercury already has api-gateway (FastAPI) wired into Traefik. Receiver
inside the container is more autonomous (container down = webhook 503,
single observable unit). Receiver in api-gateway reuses existing auth
chain but mixes HMAC auth (webhook) with API-key auth (api-gateway),
which fragments the auth model.

Author's bias: inside the container. Self-contained, autonomous,
container restart = full system recovery in one place.

### Q7. Bd memory federation

Bot's bd is separate from operator's. Does the bot ever publish its
memories to the operator's board? On bd close? On significant discovery?

Author's bias: bot files `discovered-from:bot:<bot-bead-id>` references
into operator's relevant project boards when its discovery is actionable
for the operator. Not automatic; gated by a "should I escalate this
memory?" specialist decision.

### Q8. Per-agent vs container-wide resource limits

If sre-triage decides to scan all 13 Mercury repos in parallel and
consumes all bot CPU, episodic agents like service-skills-sync wait.
Container-wide limits or per-agent priority? cgroups? sp's own scheduling?

Author's bias: defer. Single-agent v0 doesn't surface this. Address when
the second agent ships.

### Q9. Test environment for the bot itself

How does the bot test changes to its own image or its own bd-managed
specialists before they go live? Staging container? Dry-run mode of
specialist invocations? Feature flag gate inside specialist prompts?

Author's bias: a `--dry-run` mode at the dispatcher level. Specialist runs
normally but with `gh pr create --draft`. Operator promotes draft → ready
manually. Mature into a real staging container only when justified.

### Q10. Webhook secret rotation

Webhook secret is shared between GitHub repo settings (per-repo) and the
bot container (one secret in env). Rotation requires touching every
subscribed repo's webhook settings. Acceptable for v0; what's the
production answer?

Author's bias: defer to GH App migration (Q3). GH App authenticates
webhook deliveries via signed JWT, no shared HMAC secret.

## 11. Implementation sequencing (proposed)

The following sequence ships v0 (service-skills-sync) end-to-end and
validates every architecture pillar.

**Phase 1: identity + container skeleton (no agents yet)**
- Mint `mercury-devops-bot` GH account; PAT with PR-write scope
- Author Dockerfile (image: ubuntu-24.04 base; sp, bun, node, gh CLI,
  claude-code, serena, gitnexus pinned glibc-safe)
- Compose entry in `mercury-infra/docker-compose.yml` with volume mounts
- Boot, verify `sp help`, `bd help`, `gh auth status` all work inside

**Phase 2: fork strategy + sync**
- Fork all Mercury repos under `mercury-devops-bot/<repo>` (one-shot script)
- L2 cron `sync-all-forks.sh`, log to `/var/log/mercury-devops/sync.log`
- Verify mirror staleness < 15 min on every repo

**Phase 3: webhook receiver**
- FastAPI receiver inside container on internal port (e.g. 8080)
- Traefik route → container
- HMAC-SHA256 verify; reject non-mercuryintelligence-org events
- On valid event: sync the affected repo (L1), file a bd
  `webhook-received:<repo>:<sha>`, return 200

**Phase 4: service-skills-sync specialist updates**
- Pane 3 ships: `requires_worktree: true`, `stall_timeout_ms: 600000`,
  Phase 6 prompt (`gh pr create --base <branch> --head <auto-branch>`)
- npm publish; container pulls new specialists version on next image build
  (or pinned in image)

**Phase 5: dispatcher**
- Dispatcher reads `webhook-received` bds, evaluates triggers, runs
  `flock -n /var/lock/sp-$repo.lock sp run service-skills-sync --bead
  $bid --background`
- Pre-flight L3 fetch + checkout
- Specialist's Phase 6 opens PR from bot's fork

**Phase 6: end-to-end smoke**
- Register webhook on mercury-infra only (one repo first)
- Merge a noop PR; observe entire flow: webhook → sync → bd → dispatcher
  → specialist → PR opened from bot's fork
- Operator reviews bot's PR; merges if appropriate
- Validate `sp feed` from outside container via `docker exec`

**Phase 7: scale-out**
- Register webhooks on all Mercury repos
- Add post-restart audit cron (Section 6)
- Add garbage collection cron (Section 7)
- Add Grafana panel + Prometheus scrape (Section 9)

**Phase 8: tear down CI-based service-skills-sync caller workflows**
- PR on each of infra, market-data, darth-feedor, treasury-cb to remove
  `.github/workflows/service-skills-drift.yml`
- Drop `NANO_GPT_API_KEY` repo secret on each (bot has its own)
- Keep "Allow GitHub Actions to create and approve pull requests" repo
  policy enabled (cheap; harmless; useful for any future GH Action need)

## 12. What this design rejects

For the record, to prevent rediscovery:

- **Bind-mounting host's working tree into container.** Destroys trust
  boundary. The whole point is no host coupling.
- **Sharing operator's bd database with container.** Bot's discoveries
  must be distinguishable from operator's; mixing them muddles `bd ready`.
- **Webhook receiver running outside the container.** Adds operational
  surface; doesn't reduce blast radius; complicates ownership.
- **Specialist commits direct to upstream master.** Trust violation. PR
  flow is non-negotiable.
- **Bot's repo clones living on host filesystem.** Filesystem coupling
  bug we already paid for in Phase C. Forks live IN the container.
- **CI-based execution of service-skills-sync.** Already paid the cost:
  no observability, peter-evans dance, parser fragility, repo policy
  setup, secret-per-repo, runner glibc/bun issues, npm install-per-run,
  intermittent provider flakes invisible to operator until post-mortem.
  This whole architecture replaces it.
- **Multiple containers per agent for v0.** Premature partitioning. One
  container is enough until a single agent becomes resource-heavy.

## 13. Pre-container cleanup checklist

Before the container ships, the following pre-existing artifacts from the
Phase C campaign should be resolved so we don't carry dead code or
unresolved follow-ups into the new architecture:

- `mercury-infra/.github/workflows/service-skills-drift.yml` — remove
- `mercury-market-data/.github/workflows/service-skills-drift.yml` — remove
- `mercury-darth-feedor/.github/workflows/service-skills-drift.yml` — remove
- `mercury-treasury-cb/.github/workflows/service-skills-drift.yml` — remove
- `xtrm-tools/.xtrm/skills/default/setup-service-skills-sync/SKILL.md` —
  remove (taught operators how to wire the now-defunct CI caller)
- `xtrm-dev/specialists/docs/design/auto-reconcile-delivery.md` — supersede
  with a one-line pointer to this design doc
- `xtrm-dev/core/.github/workflows/service-skills-drift-sweep.yml` — keep
  for now (it's the reusable; could be reused for non-Mercury consumers).
  Mark "deprecated for Mercury, kept for ecosystem" in its preamble.
- bd open issues to close as superseded:
  - mercury-infra: `treasury-cb-60n`, `economic-data-cd6` (pack migration
    precondition — moot in container model)
  - xtrm-tools: `xtrm-oafcs` (Node 24 bump for runner — runner not used),
    `xtrm-92wx3` (reconcile.py vendoring — Phase B fallback not used),
    `xtrm-vu2ro.1` (Path B specialist self-PR — promoted to Phase 4 of
    this design),
    `xtrm-efa2a.1` (stall_timeout bump — promoted to Phase 4 of this
    design)
- repo secrets to delete after caller workflow removal:
  - `mercuryintelligence/{infra,market-data,darth-feedor,treasury-cb}:
    NANO_GPT_API_KEY`

## 14. References

- Phase C campaign memories: `phase-c-completed-end-to-end-2026-06-24`,
  `phase-c-autonomous-merge-authority-2026-06-24`,
  `py_backend-0dvp-fanout-2026-06-25`
- xtrm devops crosswalk: `mercury-infra:docs/telemetry/runbooks/devops-agent-grounding.md`
- `using-specialists-v3` skill: defines `sp run` semantics; container's
  sp behavior must remain compatible
- `auto-reconcile-delivery.md` (superseded): `xtrm-dev/specialists:docs/
  design/auto-reconcile-delivery.md` — the Path A/B/C/D analysis that
  preceded this design. Author retained as historical record but the
  design questions it answered are subsumed by Sections 3 and 8 here.

---

*Status: DESIGN — pre-implementation. Not yet committed beyond this file.
Implementation gated on operator approval of architecture skeleton and
sequencing. Open questions Q1-Q10 do not block design approval; they are
implementation-shape decisions to be made phase-by-phase.*
