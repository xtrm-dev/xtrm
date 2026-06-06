---
title: SRE telemetry patterns for Mercury
date_created: 2026-05-31
date_modified: 2026-05-31
---

# SRE telemetry patterns for Mercury

## Summary

Current SRE/DevOps guidance stays consistent across Google SRE, Prometheus, Grafana, and OpenTelemetry:

- page on **user symptoms**, not root causes
- model services with **Four Golden Signals** / **RED**
- model hosts and containers with **USE**
- define **SLIs/SLOs** from user outcomes
- keep Prometheus metric names **single-unit, base-unit, low-cardinality**
- use **logs + traces** for forensics, not paging
- use **OpenTelemetry resource attributes** to pin service identity and environment
- keep dashboards opinionated, narrow, and linked from alerts

Mercury should turn that into a per-service **telemetry emission contract**: every service emits the same core resource attrs, a small RED metric set, USE metrics for infra, structured logs with trace correlation, and a few SLO-backed alerts.

## External evidence checked

| Source | Evidence used |
|---|---|
| Google SRE, *Monitoring Distributed Systems* | Four Golden Signals; white-box vs black-box; dashboards; simple, actionable alerting |
| Prometheus docs: metric naming, alerting, metric types | base units, suffixes, low-cardinality labels, symptom alerts, counters/gauges/histograms |
| Google Cloud SRE blog on SLI/SLO/SLA | SLI = direct measurement, SLO = numerical target, SLA = external commitment |
| Grafana dashboard best practices | USE for machines, RED for services, alerts on RED dashboards, dashboards should tell a story |
| Grafana Alerting docs | alert rules, multi-dim alert instances, notification policies, grouping, silences |
| OpenTelemetry signals / logs / service registry docs | traces/metrics/logs as signals, trace/span correlation in logs, resource context, `service.name`, `service.namespace`, `service.instance.id`, `deployment.environment.name` |
| Grafana MCP server docs | query metrics/logs, dashboards, alerting, incidents via MCP |
| Prometheus MCP server README | PromQL query + metric discovery via MCP |

## Pattern synthesis

### 1) Four Golden Signals

Google’s SRE book says to focus on **latency, traffic, errors, saturation** for user-facing systems. Grafana restates this as the main dashboard strategy for services.

Mercury mapping:

- **Latency** → request duration, tool-call duration, DB query duration
- **Traffic** → request rate, job rate, token volume, queue throughput
- **Errors** → 5xxs, failed jobs, failed tool calls, failed backups
- **Saturation** → queue depth, worker utilization, memory, CPU, connection pools, disk

### 2) RED vs USE

Grafana’s guidance is simple:

- **RED** = service view: Rate, Errors, Duration
- **USE** = machine view: Utilization, Saturation, Errors

For Mercury:

- service dashboards: RED
- host/container dashboards: USE
- alerts: mostly RED symptoms, some USE only when saturation is near outage

### 3) SLIs/SLOs

Google Cloud’s SRE guidance defines:

- **SLI**: direct measurement of service behavior
- **SLO**: numeric reliability target
- **SLA**: external commitment / penalty-bound promise

Mercury should define SLOs per critical service, not per whole platform only.

Good SLO candidates:

- request success ratio
- p95/p99 latency within threshold
- job freshness / queue drain time
- backup freshness
- data pipeline freshness

### 4) Prometheus metric naming

Prometheus docs say:

- metric names should use a **single unit** and **single quantity**
- use **base units**
- add unit suffixes like `_seconds`, `_bytes`
- counters use `_total`
- labels must stay **low-cardinality**
- histograms expose `_bucket`, `_sum`, `_count`

Implication for Mercury:

- no milliseconds in names
- no raw user IDs / emails / UUIDs in labels
- route templates, not raw URLs
- counters for counts, histograms for latency, gauges for current state

### 5) Alert design

Prometheus alerting guidance: keep alerting simple, alert on symptoms, have good consoles, avoid pages with nothing to do.

Grafana Alerting adds:

- multi-dimensional alert instances
- notification policies by team/service
- grouping, silences, mute timings

Mercury alerts should page only when users are hurting or data is at risk.

## Mercury emission contract

### Resource identity: mandatory

Every service should emit these OpenTelemetry resource attrs:

- `service.namespace=mercury`
- `service.name=<service>`
- `service.instance.id=<unique instance>`
- `service.version=<release>`
- `deployment.environment.name=<local|staging|production>`
- `service.criticality=<critical|high|medium|low>`

Why:

- `service.name` must be same for horizontally scaled instances
- `service.instance.id` must be unique per instance
- `service.namespace` groups related services
- `deployment.environment.name` does **not** change service identity

### Metric shape: required per service

Each user-facing service should export at least:

- `*_requests_total` counter
- `*_request_duration_seconds` histogram
- `*_errors_total` counter
- `*_inflight` gauge
- `*_queue_depth` gauge if async/work-queue based
- `*_saturation_ratio` or `*_utilization_ratio` where useful

### Label discipline

Allowed labels only when bounded:

- `service`
- `route`
- `method`
- `status`
- `status_class`
- `operation`
- `queue`
- `worker`
- `model`
- `repo`
- `result`

Not allowed:

- user IDs
- emails
- request IDs as metric labels
- raw URLs
- arbitrary exception text

### Example Mercury metrics

| Domain | Example metric | Type | Notes |
|---|---|---|---|
| HTTP | `mercury_api_requests_total` | counter | labels: `method`, `route`, `status` |
| HTTP latency | `mercury_api_request_duration_seconds` | histogram | p95/p99 from histogram |
| Background jobs | `mercury_jobs_running` | gauge | current active jobs |
| Queueing | `mercury_jobs_waiting` | gauge | backlog signal |
| Job latency | `mercury_job_duration_seconds` | histogram | end-to-end job time |
| Specialist runtime | `mercury_specialist_failures_total` | counter | failed agent/job runs |
| MCP | `mercury_mcp_request_duration_seconds` | histogram | tool-call latency |
| MCP | `mercury_mcp_failures_total` | counter | tool failures |
| LLM usage | `mercury_llm_tokens_input_total` | counter | token budget tracking |
| LLM usage | `mercury_llm_tokens_output_total` | counter | token budget tracking |
| DB/backup | `mercury_backup_age_seconds` | gauge | freshness SLI |
| Infra | `mercury_container_restart_total` | counter | restart churn |
| Infra | `mercury_container_memory_bytes` | gauge | host/container saturation |

## Logs and traces

OpenTelemetry says logs, metrics, and traces are all signals, and logs should carry trace/span IDs plus resource context when possible.

Mercury logs should be:

- structured JSON
- one event per action
- correlated with `trace_id` / `span_id`
- stamped with service resource attrs
- redacted for secrets / PII

Mercury traces should cover:

- incoming request path
- queue enqueue/dequeue
- DB calls
- MCP tool calls
- deploy / restart / rollback actions

## Dashboard rules

Use Grafana dashboard best practices:

- dashboard tells one story
- RED for services, USE for machines
- reduce cognitive load
- link alerts to dashboards
- use template variables instead of copy-paste dashboards
- keep version control for dashboard JSON

Mercury should have:

- one per-service RED dashboard
- one platform overview dashboard
- one infra USE dashboard
- one incident/ops dashboard with alert links, recent deploys, queue state, backup state

## Alert examples for Mercury

Page:

- error rate above threshold on critical API
- p95 latency breach on user-facing endpoint
- queue not draining / job freshness breach
- backup freshness breach on persistent data
- DB unavailable / severe saturation

Do not page:

- CPU high alone
- queue depth mild increase without user impact
- container restart if service auto-recovers and users are fine
- internal cause signal when user symptom is already covered

## Tooling position

Current docs support a read-first AI ops path:

- **Grafana MCP**: query metrics/logs, search dashboards, manage alerting/incidents, generate deeplinks
- **Prometheus MCP**: execute PromQL queries, list metrics, get targets/metadata

Mercury should use those before inventing a custom infra MCP. Custom MCP only if Mercury needs extra domain actions not covered by read/query tooling.

## Recommendation

1. Standardize on OTel resource attrs + Prometheus-friendly metric names.
2. Define a small per-service metric contract: RED + queue + saturation.
3. Use USE only for host/container dashboards.
4. Make alerts symptom-first and dashboard-linked.
5. Put logs/traces behind OTel correlation.
6. Add a machine-readable telemetry spec per repo and validate it in CI.

## Sources

- Google SRE, *Monitoring Distributed Systems*: https://sre.google/sre-book/monitoring-distributed-systems/ (accessed 2026-05-31)
- Prometheus metric and label naming: https://prometheus.io/docs/practices/naming/ (accessed 2026-05-31)
- Prometheus alerting: https://prometheus.io/docs/practices/alerting/ (accessed 2026-05-31)
- Prometheus metric types: https://prometheus.io/docs/concepts/metric_types/ (accessed 2026-05-31)
- Google Cloud SRE SLIs/SLOs/SLAs: https://cloud.google.com/blog/products/devops-sre/sre-fundamentals-slis-slas-and-slos (accessed 2026-05-31)
- Grafana dashboard best practices: https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices.md (accessed 2026-05-31)
- Grafana Alerting fundamentals: https://grafana.com/docs/grafana/latest/alerting/fundamentals.md (accessed 2026-05-31)
- OpenTelemetry signals: https://opentelemetry.io/docs/concepts/signals/ (accessed 2026-05-31)
- OpenTelemetry logs spec: https://opentelemetry.io/docs/specs/otel/logs/ (accessed 2026-05-31)
- OpenTelemetry service attributes: https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/ (accessed 2026-05-31)
- OpenTelemetry deployment environment: https://opentelemetry.io/docs/specs/semconv/resource/deployment-environment/ (accessed 2026-05-31)
- Grafana MCP server docs: https://grafana.com/docs/grafana/latest/developer-resources/mcp.md (accessed 2026-05-31)
- Prometheus MCP server README: https://github.com/pab1it0/prometheus-mcp-server (accessed 2026-05-31)
