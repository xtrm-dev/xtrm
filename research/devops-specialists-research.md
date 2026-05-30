---
title: devops-specialists-research
date_created: 2026-05-30
date_modified: 2026-05-30
---

# DevOps specialist research synthesis

## Executive summary

AWS DevOps Agent evidence says product is **incident-response + prevention layer**, not generic chat wrapper. It wants topology, telemetry, deployment context, repos, and runbooks; it lives in a **dual-console model** with Agent Spaces as blast-radius boundaries; it starts on alerts/tickets; it publishes findings into Slack/ServiceNow and can open AWS Support cases; it can also ingest custom tools through MCP ([AWS docs](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.md), accessed 2026-05-30; local analyses in `inbox/transcripts/*.analysis.md`).

Terraform Docker tutorial is smaller but important: it frames infra work as **build / change / destroy** lifecycle in code, which maps cleanly to VPS/container provisioning and repeatable deploy modules ([HashiCorp Docker tutorial](https://developer.hashicorp.com/terraform/tutorials/docker-get-started), accessed 2026-05-30).

Grafana MCP + Prometheus MCP make observability wireable as agent tools, but with sharp auth/transport boundaries: Grafana MCP uses service-account token or basic auth, supports stdio/SSE/streamable-http, tool scoping, read-only mode, and TLS; Prometheus MCP exposes PromQL/query discovery over stdio/http/sse, with auth, timeout, stateless HTTP, and token-savings knobs ([Grafana MCP docs](https://grafana.com/docs/grafana/latest/developer-resources/mcp.md), accessed 2026-05-30; [Grafana configure](https://grafana.com/docs/grafana/latest/developer-resources/mcp/configure/authentication.md), [transports](https://grafana.com/docs/grafana/latest/developer-resources/mcp/configure/transports-and-addresses.md), [tools ref](https://grafana.com/docs/grafana/latest/developer-resources/mcp/reference/mcp-tools-table.md), accessed 2026-05-30; [Prometheus MCP README](https://github.com/pab1it0/prometheus-mcp-server), accessed 2026-05-30).

Recommendation: **do not wire AWS DevOps Agent directly as prod VPS mutator**. Use it as model/UX reference and as read-only/curated investigation plane. For xtrm/Mercury, start with a **dedicated devops-specialist primitive** (can live beside specialists-service at first) plus a **gitboard/xtrm DevOps page**. Add event/schedule wakeups on deploys, incidents, drift, queue/cost thresholds. Split deployment-specialist and database-specialist out early; DevOps owns platform, release, observability, cost, and rollback; DB specialist owns schema/migrations/replication/backups.

## Source inventory

| Source | What it contributes | Key APIs / concepts | Relevance to xtrm / Mercury |
|---|---|---|---|
| `1-projects/xtrm/research/devops-specialists.md` | Local design brief; names target responsibilities and current gaps | DevOps scope, per-repo deploy specialist, wakeup primitive, IoT/IaC gap, database specialist gap | Primary project-specific constraints and desired end state |
| `inbox/transcripts/Introducing-AWS-DevOps-Agent-Amazon-Web-Services.analysis.md` | Launch framing, core product model, integrations, and prevention loop | always-on incident response, topology graph, Slack/ServiceNow, custom MCP, support cases | Strong evidence for UI/UX and operating model |
| `inbox/transcripts/AWS-reInvent-2025-Move-beyond-reactive-Transform-cloud-ops-with-AWS-DevOps-Agent-COP362.analysis.md` | Demo-level evidence for agent spaces, trust-first autonomy, prevention, pricing, and cross-tool integration | agent space blast radius, read-only posture, subagents, Kiro handoff, usage caps | Best evidence for trust model and human-in-loop workflow |
| `inbox/transcripts/Diving-Deep-on-AWS-DevOps-Agent-AWS-Tech-Tales.analysis.md` | GA-era refinements, transport/telemetry breadth, parallel investigations, prompt steering, cost math | agent-space IAM, MCP servers, read-only mode, service account-style thinking, cost/credits | Best evidence for ops ergonomics and boundaries |
| [AWS DevOps Agent docs](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.md) | Canonical product model and architecture | Agent Spaces, topology graph, CloudWatch/Dynatrace/Datadog/New Relic/Splunk, GitHub/GitLab, Slack/ServiceNow, AWS Support, custom MCP | Primary source for current AWS behavior |
| [Terraform Docker tutorial](https://developer.hashicorp.com/terraform/tutorials/docker-get-started) | Declarative resource lifecycle for Docker infra | build/change/destroy, IaC workflow, variables/outputs | Model for VPS/container provisioning discipline |
| [Grafana MCP docs](https://grafana.com/docs/grafana/latest/developer-resources/mcp.md) + config pages | Observability agent bridge and auth/transport model | dashboards, alerts, incidents, datasources, service-account token, stdio/SSE/streamable-http, read-only mode, TLS, RBAC | Strong fit for xtrm monitoring surface |
| [Prometheus MCP README](https://github.com/pab1it0/prometheus-mcp-server) | PromQL tool server implementation | execute_query, execute_range_query, list_metrics, metadata, targets, auth, request timeout, stateless HTTP | Strong fit for per-repo metrics / token telemetry |

## AWS DevOps Agent model distilled

### Operating model

**Facts**

- AWS says DevOps Agent is a “frontier agent” that “resolves and proactively prevents incidents,” improves reliability/performance, and works by learning resources/relationships, using observability tools, skills, code repos, and CI/CD pipelines ([AWS docs](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.md), accessed 2026-05-30).
- The docs describe a **dual-console architecture**: admins use AWS Management Console to create/manage Agent Spaces; operators use the DevOps Agent web app for investigations and prevention ([AWS docs](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.md), accessed 2026-05-30).
- Agent Spaces are logical containers for access scope; the service builds a topology graph and starts investigating immediately on alert or support ticket ([AWS docs](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.md), accessed 2026-05-30).
- The local analyses add trust-first details: read/list/describe posture, parallel subagents, support escalation, “co-worker” framing, and roadmap toward actions later.

**Inference for xtrm**

- DevOps specialist should be **workspace- and repo-scoped**, not global.
- Operator UX must show current blast radius, current signal source, current deploy version, and current recommendation confidence.
- Human approval stays in loop until tool trust and rollback coverage are proven.

### UI/UX lessons

- Web app, not terminal, is the primary ops surface.
- Chat must be **page-context aware**: topology view, investigation view, prevention view.
- Investigation output should show: evidence trail, ruled-out hypotheses, timeline, mitigation, rollback, and follow-up hardening.
- Multi-incident handling should be first-class, not one monolithic chat thread.
- Prompt steering matters; vague prompts should request more context, not hallucinate certainty.

### Data/context requirements

- Telemetry: logs, metrics, traces, alarms.
- Deployment history: CI/CD events, release versions, rollout timestamps, rollback markers.
- Topology: resources and their relationships; account boundaries; service maps.
- Code context: repo diffs, recent merges, build artifacts, tests, ownership metadata.
- Human context: runbooks, steering files, support tickets, incident history, feedback.
- External context: third-party telemetry and ticketing; custom MCP tools for non-AWS stacks.

### Integrations

- Built-ins: CloudWatch, Dynatrace, Datadog, New Relic, Splunk; GitHub/GitLab; Slack; ServiceNow; AWS Support; custom MCP ([AWS docs](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.md), accessed 2026-05-30).
- Transcript evidence adds: support-case style workflow, Kiro handoff, Graph/knowledge-graph topology, prevention scans, and the “one click pull AWS Support engineer into investigation” pattern.

### Reusable vs AWS-specific

**Reusable**
- Topology graph as reasoning substrate.
- Read-first / human-in-loop investigation flow.
- Evidence-rich RCA + mitigation + rollback bundle.
- Historical incident mining for prevention.
- MCP as adapter layer for custom telemetry and tools.

**AWS-specific**
- Agent Spaces / AWS console management.
- AWS account + IAM centric access model.
- AWS Support integration.
- Native CloudWatch and AWS service topology.
- AWS pricing / preview caps.

## Terraform / IaC

### What the Docker tutorial demonstrates

The Docker tutorial is a plain IaC pattern: **build, change, destroy Docker infrastructure using Terraform** with step-by-step CLI lessons ([HashiCorp Docker tutorial](https://developer.hashicorp.com/terraform/tutorials/docker-get-started), accessed 2026-05-30). The important signal is not Docker itself; it is that container infra should be treated as declarative state, with lifecycle, variables, and outputs.

### Mapping to VPS / container provisioning for xtrm / Mercury

Use Terraform for:
- VPS instance provisioning
- network / firewall / security-group state
- Docker host bootstrap
- volumes / persistent storage
- DNS and load balancer wiring
- per-env secrets references
- reproducible teardown / recreate paths

Meaning: for Mercury, DevOps should own the **repeated host+container substrate**, not one-off shell provisioning.

### DevOps specialist vs future IoT/IaC specialist

**DevOps specialist owns**
- deployment pipelines
- host/container provisioning primitives
- rollout / rollback / health checks
- infra drift detection
- observability and cost telemetry
- service-level release policy

**Future IoT/IaC specialist owns**
- device/edge fleet provisioning
- edge config lifecycle
- remote firmware/config rollout
- field telemetry ingestion
- device health + edge recovery

So: DevOps handles platform delivery; IoT/IaC handles edge fleet behavior.

## Observability / MCP

### Grafana MCP capabilities

Grafana MCP exposes AI access to Grafana for **metrics, logs, dashboards, alert rules, incidents, Sift, deeplinks, and datasource-backed queries** ([Grafana MCP docs](https://grafana.com/docs/grafana/latest/developer-resources/mcp.md), accessed 2026-05-30). Config docs add:
- auth via **service account token** (recommended) or username/password
- transports: **stdio**, **SSE**, **streamable-http**
- tool allow/deny and **read-only mode**
- client/server TLS and multi-org headers
- Grafana **9.0+** for full functionality ([authentication](https://grafana.com/docs/grafana/latest/developer-resources/mcp/configure/authentication.md), [transports](https://grafana.com/docs/grafana/latest/developer-resources/mcp/configure/transports-and-addresses.md), [configure](https://grafana.com/docs/grafana/latest/developer-resources/mcp/configure.md), [tools ref](https://grafana.com/docs/grafana/latest/developer-resources/mcp/reference/mcp-tools-table.md), accessed 2026-05-30).

### Prometheus MCP capabilities

Prometheus MCP server provides:
- `execute_query` / `execute_range_query`
- metric discovery (`list_metrics`)
- metadata and target inspection (`get_metric_metadata`, `get_targets`)
- auth via username/password, bearer token, or mTLS
- transports: `stdio`, `http`, `sse`
- `PROMETHEUS_REQUEST_TIMEOUT`, stateless HTTP mode, tool prefixing, and optional link suppression to save context tokens ([Prometheus MCP README](https://github.com/pab1it0/prometheus-mcp-server), accessed 2026-05-30).

### Likely integration risks

- **Cardinality blow-up**: PromQL on noisy labels can burn context and latency.
- **Auth sprawl**: too many service tokens / headers / orgs.
- **Tool overexposure**: Grafana MCP has write-capable tools; xtrm needs strict allowlists and likely read-only defaults.
- **Token bloat**: disable links when needed; summarize metric names before raw query dumps.
- **Timeouts / hanging queries**: keep request timeouts small; Prometheus MCP already exposes this knob.
- **Freshness mismatch**: logs and metrics may lag jobs/worktrees/Dolt state.
- **Cross-env confusion**: same metric names across repos/environments need explicit tool prefixes and labels.

### Metrics/dashboards the DevOps specialist needs

For specialists-service / jobs / worktrees / Dolt / LSP / MCP / token-cost telemetry, track at minimum:
- active specialists
- running jobs / waiting jobs / queue depth
- job latency, failure rate, retry count
- worktree count, age, dirty state, stale branch count
- Dolt server count, availability, replication lag, backup age
- LSP instance count, startup failures, memory/CPU, crash loops
- MCP server uptime, request latency, error count, tool-call volume
- token usage by repo, model, workflow, and time window
- cost per job / per workflow / per repo
- deployment count, rollback count, health-check pass rate
- orphan process count, cleanup backlog, stuck runner count

## DevOps specialist responsibility model

### CI/CD vs monitoring

Keep them separate but connected:
- **CI/CD** owns build, test, release, deploy, rollback, and promotion policy.
- **Monitoring/observability** owns signal collection, dashboards, alerts, and diagnosis.
- **DevOps specialist** bridges them: use alerts to trigger analysis, use analysis to harden pipelines.

If one agent owns both blindly, it will either mutate too much or observe too little.

### Platform engineering scope

From the local note and AWS/Grafana evidence, platform engineering should include:
- container orchestration / service discovery
- secrets / access control / audit logs
- restart policies / retries / health checks
- queue and worker management
- backup / restore / disaster recovery
- capacity planning and cost telemetry
- developer experience commands
- deployment guards and release policy
- observability and alert routing

### Boundaries: deployment specialist vs broader DevOps specialist vs database specialist

- **Deployment specialist**: per-repo release logic, environment wiring, rollout safety, repo-specific deploy hooks.
- **DevOps specialist**: shared platform, multi-repo observability, incident response, cost, SLOs, job runners, infra drift, wakeups.
- **Database specialist**: schema, migrations, replication, backup/restore, query perf, data consistency, failure recovery.

These should not collapse into one giant “ops” agent.

### Per-repo specialist config / deployment model

Each repo should export a small config that declares:
- deploy command(s)
- allowed direct shell commands
- required pre-checks and post-checks
- target dashboards and alert rules
- service ownership / on-call path
- rollback command
- environment labels
- MCP sources and secrets scope

That makes specialist behavior reproducible across repos.

## Architecture recommendation for xtrm / Mercury

### Wire AWS DevOps Agent directly to VPS stack?

**No** as direct production controller. Use it as:
- design reference
- UI/UX benchmark
- investigation pattern benchmark
- optional read-only model for custom telemetry adapters

Reason: AWS docs + transcript analyses show the product still leans on safe, curated, read-first behavior. Direct mutation control across VPS services before guardrails exist is wrong blast radius.

### specialists-service container vs dedicated devops-specialist container

- **Short term**: keep inside specialists-service only if tools are minimal and scope is one repo.
- **Preferred**: create a **dedicated devops-specialist container** once it needs stable Prometheus/Grafana/MCP access, worktree context, and deploy hooks.
- specialists-service can remain orchestration layer; devops-specialist is the operational brain.

### gitboard / future xtrm console DevOps page

Yes. Needed now.

That page should show:
- active deployments
- failed health checks
- active incidents / investigations
- queue depth / jobs
- worktree state
- token spend and cost burn
- Dolt/LSP/MCP health
- manual wakeups / scheduled sweeps
- last deploy per repo and rollback path

### Wakeup model after deploys and during incidents

Use **event + schedule**:
- event: post-deploy, failed health check, queue spike, token spike, orphan process, incident page
- schedule: periodic sweep, prevention scan, drift scan, cost scan

This matches the local “pulse emitter” primitive. Long-running node can come later.

### Minimal first primitive vs long-running substrate node

- **Phase 1**: stateless-ish event worker + persisted state.
- **Phase 2**: long-running substrate node once you need continuous background scanning, multi-repo memory, and self-tuning prevention.

Do not start with always-on daemon as default.

## Implementation roadmap

### Phase 0 — research validation
- Inventory repos, services, worktrees, runners, telemetry, deploy commands.
- Identify canonical dashboards and alert sources.
- Define allowed command surface and escalation rules.

### Phase 1 — primitive/manual workflow
- One repo, one deploy path, one DevOps page.
- Manual wakeups only.
- Read-only investigations first.
- Record before/after evidence.

### Phase 2 — metrics + dashboards
- Wire Grafana + Prometheus MCP.
- Add token/cost dashboards.
- Add queue/worktree/LSP/Dolt dashboards.
- Add alerts for health, backlog, and spend.

### Phase 3 — gated deployment workflow
- Introduce `make spdeploy` or equivalent.
- Add hooks/extensions that block direct `docker compose up` when unsafe.
- Require pre/post health checks and rollback hooks.
- Add per-repo deployment specialist config.

### Phase 4 — substrate / long-running node
- Promote to persistent node with scheduled prevention scans.
- Keep memory of incidents and remediations.
- Coordinate across repos and services.
- Add learned policies, not just static scripts.

## Risks, unknowns, follow-up questions

### Risks
- direct shell/docker bypass of deploy policy
- auth leakage through MCP tokens/headers
- false positives from noisy observability labels
- stale telemetry vs live job/worktree state
- agent write-capability creep
- cost blow-up from broad PromQL queries
- per-repo config drift

### Unknowns
- which repo owns canonical deploy hooks
- which dashboard becomes source of truth
- what the minimum safe command allowlist is
- how to version specialist configs
- whether Dolt should be read-only in first phase
- whether LSP lifecycle belongs in DevOps or platform ops

### Follow-up research questions
- What exact metrics do current repos already emit?
- Which commands must be blocked globally vs per repo?
- Should Grafana MCP be read-only by default for xtrm?
- Which incidents should wake the specialist immediately vs batch later?
- What is the clean boundary between deployment specialist and database specialist in Mercury?

## Concrete beads / issues to create next

| Priority | Proposed title | Description |
|---|---|---|
| P0 | Define DevOps specialist boundary and command surface | Lock scope: read-only investigation, allowed deploy actions, forbidden direct docker commands, escalation rules |
| P0 | Add DevOps page to gitboard / xtrm console | Build incident/deploy/queue/token/cost dashboard and wakeup controls |
| P0 | Prototype Prometheus + Grafana MCP wiring | Expose metrics/dashboards/alerts for specialists-service, jobs, worktrees, Dolt, LSP, MCP |
| P1 | Design per-repo deployment specialist config | Per-repo deploy hooks, checks, rollback path, alert bindings, source inventory |
| P1 | Implement `make spdeploy` gated deploy flow | Replace ad hoc docker commands with validated deploy primitive and hooks |
| P1 | Add token/cost telemetry dashboard | Track token use, cost per job, cost per repo, model usage, and budget alerts |
| P2 | Create event/schedule pulse emitter | Wake specialist on deploys, incidents, drift, queue spikes, and schedule |
| P2 | Decide database specialist MCP scope | Define DB specialist ownership, tool surface, and data-safety boundaries |
| P2 | Evaluate dedicated devops-specialist container | Compare against specialists-service embedding for blast radius and observability |

## Bottom line

Use AWS DevOps Agent as **reference architecture for ops cognition**, not as direct control-plane authority. For xtrm/Mercury, the right shape is: **dedicated DevOps specialist primitive + Gitboard DevOps page + Prometheus/Grafana MCP + per-repo deployment specialization + event-driven wakeups**. Long-running substrate node comes later.
