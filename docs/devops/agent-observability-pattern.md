---
title: Agent Observability Access — pattern note
type: pattern
status: active
date_created: 2026-06-10
discovered_in: mercury-infra (infra-vh4, predecessors infra-6if + xtrm-2m3 + xtrm-6fe)
companions:
  - mcp-sidecars-pattern.md
  - devops-system.md
---

# Agent Observability Access

**One-line**: once you've deployed read-only MCP sidecars next to your
observability stack (see [`mcp-sidecars-pattern.md`](mcp-sidecars-pattern.md)),
agents access them through a **CLI + on-demand skill + live-query health
contract**, not through a wired-into-`.mcp.json` sidecar and not through a
file-cache mirror of telemetry. This note captures the agent-access layer
that sits between the sidecar deployment and the broader devops vision in
[`devops-system.md`](devops-system.md).

## The three pieces and how they compose

```
   agent prompt: "is the stack healthy?"
            │
            ▼
   ┌────────────────────────────────────────┐
   │ checking-stack-health skill            │   the contract
   │  - 3 canonical PromQL queries          │   (what an agent runs and
   │  - classification table → status       │    how it routes the result)
   │  - service-skills-sync routing         │
   └────────────────────────────────────────┘
            │
            │  agent shells out
            ▼
   ┌────────────────────────────────────────┐
   │ mcpq CLI + .mcpq.json (walk-up)        │   the access layer
   │  - dynamic tool discovery              │   (no per-session schema cost,
   │  - docker exec into internal network   │    no host port required)
   └────────────────────────────────────────┘
            │
            │  JSON-RPC over docker-network
            ▼
   ┌────────────────────────────────────────┐
   │ grafana-mcp / prometheus-mcp sidecars  │   the data plane
   │  (see mcp-sidecars-pattern.md)         │
   └────────────────────────────────────────┘
```

Each piece is replaceable in isolation. The skill is a markdown contract.
mcpq is a small Python CLI (~600 LOC). The sidecars are upstream OSS images.

---

## Piece 1 — `mcpq` CLI: query without paying per-session token cost

> Package: [`packages/mcpq/`](../../packages/mcpq/) in this monorepo.
> Skill: [`packages/mcpq/skills/using-mcpq/SKILL.md`](../../packages/mcpq/skills/using-mcpq/SKILL.md).

### Problem it solves

Wiring the upstream Grafana MCP into `.mcp.json` loads **~49 tool schemas
into every Claude Code session that opens the project** — roughly 18k tokens
per session, paid whether the session ever touches observability or not.
Wiring the Prometheus MCP adds 6 more. For a project that has multiple MCPs
per backend, this compounds.

The other failure mode is host-port exposure: sidecars deployed on the
internal Docker network have no host port by design (security-relevant —
see [`mcp-sidecars-pattern.md`](mcp-sidecars-pattern.md) §Canonical shape).
A host-side MCP client *cannot* reach them without a Traefik route or port
forward, both of which surrender the network-isolation guarantee.

### Shape

`mcpq` is a CLI that walks up from cwd to `$HOME` looking for `.mcpq.json`,
opens the configured MCP server **on demand** for the duration of one
subcommand, runs the JSON-RPC handshake, returns the result, exits. Tools
are discovered live via `tools/list` each call — never hardcoded.

```bash
mcpq servers                                          # what's configured
mcpq prometheus list-tools                            # live tool catalog
mcpq prometheus describe mercury_execute_query        # arg schema
mcpq prometheus call mercury_execute_query \
  --arg query='up{job="prometheus"}' --json           # invoke
```

Per-server config supports two `via` modes:

- `host` — direct urllib POST from the host. Use when the server is reachable
  from the host network.
- `docker:<container>` — exec into a container on the server's Docker
  network and run the request from there. **This is how you reach
  internal-only sidecars without exposing a host port.** Any container on
  the same network with `python3` on PATH works as the proxy.

Every call emits one line of telemetry JSON to stderr — server, subcommand,
tool, duration_ms, outcome. Useful for after-the-fact attribution.

### Why a CLI and not a wrapper MCP

A wrapper MCP would re-introduce the same per-session schema cost it set
out to avoid. A CLI has zero session cost; the agent pays the price of one
tool invocation per query, only when the query happens.

---

## Piece 2 — `.mcpq.json` walk-up: one config for a whole product

> Concrete instance: `~/projects/mercury/.mcpq.json` (operator-trust, no git repo).

mcpq does **walk-up discovery** from cwd to `$HOME`. Place one
`.mcpq.json` at the parent directory that contains all the product's
repos, and every sibling repo picks up the same config — no per-repo
duplication, no symlinks, no copy-paste.

```
~/projects/mercury/
├── .mcpq.json              ← single config for the whole product
├── infra/                  ← agents here walk up, find it
├── market-data/            ← agents here walk up, find it
├── darth-feedor/           ← same
├── economic-data/          ← same
└── treasury-cb/            ← same
```

Trade-off vs. checking the file into one of the repos:

| Placement | Pros | Cons |
|---|---|---|
| Inside one repo (e.g. `infra/`) | Versioned, bootstrap-on-clone | Sibling repos don't see it; every consumer needs `--config` or duplicate copies |
| Parent dir of all repos | Single SSOT, walk-up auto-discovery | Not in any git repo; new machines need a bootstrap step (12-line heredoc) |
| Symlinked into each repo | Discoverable from each cwd | Squash-merge hazard: `gh pr merge --squash` records the symlink AND deletes the symlinked dir from main (we've been bitten by this on `.beads`) |

The parent-dir placement is the only one that survives all three failure modes
(per-session token cost, host-port avoidance, multi-repo discoverability) at
the same time.

**Operator-trust note**: `.mcpq.json` can grant access to any reachable MCP
server, including ones with mutating tools if the operator chooses to add
them. It is operator-trust-equivalent to `~/.docker/config.json` or `.env`,
not something to casually commit (especially if you ever add a header-token
variant). Live outside git, document the bootstrap.

---

## Piece 3 — Live-query health skill: the agent contract

> Concrete instance: `mercury-infra/.xtrm/skills/user/packs/infra/service-skills/services/checking-stack-health/SKILL.md`

### What the skill is

The skill is a markdown contract that an agent reads when triggered by
`/health` (or any "something is wrong" phrasing). It does not duplicate
state. It enumerates **three canonical PromQL queries** the agent runs
through `mcpq`, then a **classification table** that maps the result
shape to overall status, then a **routing block** that maps each finding
to a registered per-service expert skill.

```bash
# The three canonical queries (Mercury instance)
mcpq prometheus call mercury_execute_query --arg query='up == 0' --json
mcpq prometheus call mercury_execute_query --arg query='ALERTS{alertstate="firing"}' --json
mcpq prometheus call mercury_execute_query \
  --arg query='time() - mercury_freshness_last_success_unix_seconds > 600' --json
```

Classification is mechanical:

- All three return empty `structuredContent.result` → `HEALTHY`
- Firing `severity="warning"` or freshness > SLO → `DEGRADED`
- `up == 0` rows OR firing `severity="critical"` → `CRITICAL`
- mcpq calls error AND fallback fails → `UNKNOWN` (query surface itself is
  down; fix that first)

### Why "live query", not "file cache"

The temptation, and the path the Mercury infra started down before this
refactor, is to write a cron that periodically renders the current health
state into per-repo markdown files (`SERVICE_HEALTH.md`) so agents can grep
them cheaply. This is **wrong in two stacking ways**:

1. **Prometheus already is the SSOT.** The cron is a stale, less-expressive
   mirror of data Prometheus serves on-demand. By the time the cron has
   written, the data is up to 2 minutes old; the agent can't re-query for a
   different cut (e.g. "show me only critical alerts in the last 5m") without
   either re-running the cron or going to Prometheus anyway.

2. **Per-repo file-cache duplicates the access surface.** Now every repo
   needs to know how to find / regenerate / repair the cache file, doubling
   the failure modes (cache stale? cache missing? cache corrupt? Prometheus
   actually fine?). With a live-query skill the surface area is one CLI call
   and one classification table — everything else flows through the same
   mcpq stack the rest of the product already depends on.

### What the skill keeps from the file-cache era

The mapping tables. **Container → service skill** and **alert name →
service skill** are the value-add of the skill; they encode the routing
that no PromQL query can produce. The skill rewrite kept those tables
verbatim and only replaced the data-source layer (Step 1: file read →
PromQL query) and the classification step (Step 2: parse script JSON →
parse mcpq result shape).

### Fallback path

For the bootstrap window during which the cron-and-files mechanism is
still alive (and as a defense against the sidecars themselves being down),
the skill retains a fallback: if mcpq returns errors mentioning
`docker exec ... exited` or `connection refused`, the agent reads the
file cache. Once the new path has handled one real production incident,
the fallback can be removed and the cron decommissioned.

---

## Piece 4 — Service-skills-sync: every finding routes to an expert

A health check that surfaces "container X is degraded" without telling the
agent **which expert skill to load** stalls the agent at the worst possible
moment. The skill bundles a registry that maps each container/alert name to
the per-service skill that owns it:

```
ext-summarizer          → summarizing-articles/SKILL.md
mmd-data-feed           → market-data feed ingestion (no skill yet → dashboard)
infra-prometheus-mcp    → prometheus-mcp/SKILL.md
…
```

When the health skill classifies a finding, it emits an XML
`<health_scope>` block listing every affected service and the path to its
skill. The agent then loads each skill before doing any diagnosis,
adopting the expert persona, failure-modes table, and runbook for that
service. **This is the "service-skills sync" mechanism** — the
observability layer and the expert-persona layer stay in lockstep via a
single mapping table maintained in the health skill.

Two consequences worth naming:

- Adding a new service to the product means adding one row to the routing
  table — not rewriting the health surface.
- The mapping table doubles as documentation: a new contributor reading
  the skill sees the full container-to-expert topology in one place.

---

## Motivation / thought process

The pattern landed by iterating against three local failures, in order:

1. **"Just wire it into `.mcp.json`"** — costs ~18k tokens per session
   for one Grafana MCP, paid even on sessions that never use it. Compounds
   with multiple sidecars and multi-MCP fleets. **Rejected** for default
   wiring; mcpq pays per-call instead of per-session.

2. **"Each repo has its own `.mcpq.json`"** — drift hazard (configs
   diverge as ports/containers change). **Rejected**; walk-up discovery
   to the parent dir gives one SSOT for the whole product.

3. **"Have a CLI that reads `SERVICE_HEALTH.md` per repo"** — duplicates
   access surface, adds a stale cache layer in front of a live SSOT
   (Prometheus). Also forced the design of a new `mercury-ops` CLI that
   was already obviated by mcpq. **Rejected**; the skill queries mcpq
   directly and classifies the live result.

The key realization was that **mcpq already was the centralized health
surface from the moment the sidecars went up**. The instinct to add a
cache + CLI on top was an artifact of how the pre-existing
`SERVICE_HEALTH.md` flow had organized itself before mcpq existed. Once
mcpq landed, the file cache became a stale shadow of live data. The
refactor was less "design a new thing" and more "delete the duplicate and
point the skill at what already worked."

This is the broader lesson for the xtrm devops system: **don't design new
access layers when the existing one already does the work**. Sidecars + a
small CLI + a skill that knows the right queries is sufficient; anything
more is duplication.

---

## How to apply this to other products

The pattern is product-shape-neutral. Any product with:

- A monorepo or sibling-repo layout under one parent directory
- An existing observability stack (Prometheus, Grafana, Loki, optionally Tempo)
- Agents (substrate, specialist, or operator-driven) that periodically
  need ops state
- Token-cost sensitivity (i.e. agents running on Claude Code or any LLM
  with a per-session schema budget)

…can adopt this stack in roughly half a day, given that the sidecars are
already running:

1. **Drop a `.mcpq.json` at the product's parent dir.** Configure one entry
   per sidecar; use `via: docker:<container>` for internal-only ones.
2. **Install `mcpq`**: `pip install --user --break-system-packages -e packages/mcpq` (or pipx).
3. **Verify**: run `mcpq servers` from any sibling repo. Walk-up should
   resolve the parent-dir config.
4. **Author the health skill** for the product. Three canonical PromQL queries
   are typical (`up == 0`, `ALERTS{alertstate="firing"}`, freshness past SLO).
   Reuse the mapping-table shape from the Mercury skill.
5. **Author the per-service expert skills** as needed — start with the highest-leverage
   services. The health skill should tolerate "no registered skill for X"
   and fall back to docker logs + cAdvisor for unregistered services.
6. **Ship a scripted smoke verifier** (Mercury reference: `mercury-infra/scripts/verify_mcpq.py`
   + `make verify-mcpq`). Live discovery is only useful if drift is noticed;
   the scripted verifier is what makes that durable.

---

## Anti-patterns this replaces

- **Per-session `.mcp.json` wiring of observability MCPs.** Default-loaded
  schema cost compounds across sessions; agents that never query observability
  still pay. Use mcpq instead and reserve `.mcp.json` for MCPs an agent uses
  in every session (e.g. project-native data MCPs the product itself depends on).
- **`SERVICE_HEALTH.md` cron-rendered file caches per repo.** Stale by design;
  duplicates a live data plane; doubles the failure modes. Replace with a
  skill that queries the live data plane.
- **Bespoke ops CLIs that wrap the same observability stack** (`mercury-ops
  health <repo>`, etc.). The CLI you actually need is `mcpq`; the
  product-specific intelligence belongs in the skill, not in a new binary.
- **Symlinking shared config into each repo.** Squash-merge hazard
  (the symlink lands in main as a 1-line entry and deletes the real directory).
  Walk-up discovery sidesteps the whole class of failure.

---

## Pointers

| What | Where |
|---|---|
| mcpq CLI source + tests | [`packages/mcpq/`](../../packages/mcpq/) |
| mcpq agent-facing skill | [`packages/mcpq/skills/using-mcpq/SKILL.md`](../../packages/mcpq/skills/using-mcpq/SKILL.md) |
| Sidecar deployment pattern | [`mcp-sidecars-pattern.md`](mcp-sidecars-pattern.md) |
| Broader devops vision | [`devops-system.md`](devops-system.md) |
| Mercury health skill (reference instance) | `mercury-infra/.xtrm/skills/user/packs/infra/service-skills/services/checking-stack-health/SKILL.md` |
| Mercury sidecar ops doc | `mercury-infra/docs/telemetry/mcp-query-surfaces.md` |
| Mercury smoke verifier | `mercury-infra/scripts/verify_mcpq.py` + `make verify-mcpq` |
| Original sidecar evaluation | `mercury-infra/docs/telemetry/devops-query-surface-eval.md` |

## Related beads (Mercury)

- `infra-6if` — sidecar deploy
- `xtrm-2m3` — mcpq CLI epic (this monorepo)
- `xtrm-6fe` — mcpq integration into mercury-infra
- `infra-vh4` — centralize health check via mcpq; move `.mcpq.json` to parent
- `infra-mhg` — follow-up: decommission `SERVICE_HEALTH.md` cron once new path is exercised in a real incident
