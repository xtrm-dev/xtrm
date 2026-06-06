---
title: devops-query-surfaces-mcp-architecture
date_created: Sunday, May 31st 2026, 12:35:24 pm
date_modified: Sunday, May 31st 2026, 12:55:30 pm
---

# DevOps query surfaces and MCP architecture

## Summary

Best shape for Mercury: **Grafana MCP as top-level read surface**, **Prometheus MCP as low-level metrics surface**, **Loki/LogQL for logs**, **vendor-native Datadog/CloudWatch query APIs when those backends are source of truth**, and **small read-only infra-wrapper MCP only for non-telemetry state**.

Reason: Grafana MCP already spans dashboards, datasources, alerting, incidents, OnCall, and deeplinks, and can run read-only with tool gates; Prometheus MCP already exposes PromQL instant/range queries plus metric discovery/targets; Loki/LogQL is logs-first; Datadog and CloudWatch both have explicit query DSLs and paging/time-window rules; raw infra state (Compose, Terraform drift, backups, DNS) is outside those surfaces. [Grafana MCP intro](https://grafana.com/docs/grafana/latest/developer-resources/mcp/introduction/) · [Grafana MCP configure](https://grafana.com/docs/grafana/latest/developer-resources/mcp/configure/) · [Prometheus MCP README](https://raw.githubusercontent.com/pab1it0/prometheus-mcp-server/main/README.md) · [Loki query docs](https://grafana.com/docs/loki/latest/query/) · [Datadog log search API](https://docs.datadoghq.com/logs/guide/access-your-log-data/programmatically/) · [CloudWatch Logs Insights syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html)

## Evidence by surface

| Surface                  | What it answers                                                                                                                                                | Safe posture                                                                                | Mercury fit                                       | Evidence                                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grafana MCP              | Search dashboards, query metrics/logs, manage alert rules, incidents, OnCall, deeplinks; datasources include Prometheus, Loki, CloudWatch, Elasticsearch, etc. | Gate tools with `--disable-<category>` and `--disable-write`; keep tool set minimal.        | Best operator-facing surface.                     | [Grafana intro](https://grafana.com/docs/grafana/latest/developer-resources/mcp/introduction/) · [Grafana configure](https://grafana.com/docs/grafana/latest/developer-resources/mcp/configure/)                |
| Prometheus MCP           | PromQL instant/range queries, list metrics, metric metadata, scrape targets.                                                                                   | Use request timeout, auth env vars, stateless HTTP only if needed, and tool prefix per env. | Best metrics investigator for infra/app counters. | [Prometheus MCP README](https://raw.githubusercontent.com/pab1it0/prometheus-mcp-server/main/README.md)                                                                                                         |
| Loki / LogQL             | Label-select logs, then pipeline filters/parsers/formatters; return log lines or metric queries from logs.                                                     | Narrow selectors first; prefer Grafana Explore / Logs Drilldown.                            | Best log surface.                                 | [Loki query docs](https://grafana.com/docs/loki/latest/query/)                                                                                                                                                  |
| Datadog                  | Full-text, attribute, numeric, wildcard, tag search; API search with time window, sort, paging.                                                                | API key + app key; limit pages; avoid relative windows while paging.                        | Good when Datadog is source of truth.             | [Datadog search syntax](https://docs.datadoghq.com/logs/explorer/search_syntax/) · [Datadog logs API](https://docs.datadoghq.com/logs/guide/access-your-log-data/programmatically/)                             |
| CloudWatch Logs Insights | Query logs with `filter`, `parse`, `stats`, `sort`, `limit`, `SOURCE`; results fetched via `GetQueryResults`.                                                  | Query groups explicitly; mind concurrency quota.                                            | Good for AWS-native logs.                         | [CloudWatch syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html) · [StartQuery API](https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_StartQuery.html) |

## What Grafana MCP already covers

Grafana docs say MCP lets client talk to Grafana without custom integrations; tools map to querying metrics/logs, searching dashboards, managing alert rules, incidents, OnCall, and deeplinks. The datasource tool group includes Prometheus, Loki, InfluxDB, ClickHouse, Snowflake, CloudWatch, Elasticsearch, and Pyroscope. Read-only mode keeps reads/query/list operations but blocks create/update actions. Optional tool groups can be disabled, and write ops can be disabled globally with `--disable-write`. [Grafana intro](https://grafana.com/docs/grafana/latest/developer-resources/mcp/introduction/) · [Grafana configure](https://grafana.com/docs/grafana/latest/developer-resources/mcp/configure/)

Implication: for Mercury, Grafana MCP should be first stop for agent investigations, because one surface can fan out to several telemetry backends without inventing another generic query layer.

## What Prometheus MCP already covers

Prometheus MCP exposes these core tools: `execute_query`, `execute_range_query`, `list_metrics`, `get_metric_metadata`, `get_targets`, plus `health_check`. It supports basic auth, bearer token auth, client certs, custom headers, request timeout (`PROMETHEUS_REQUEST_TIMEOUT`, default 30s), and transport modes `stdio`, `http`, `sse`. It also supports `PROMETHEUS_DISABLE_LINKS` to save context tokens and `TOOL_PREFIX` to run per-environment instances. [Prometheus MCP README](https://raw.githubusercontent.com/pab1it0/prometheus-mcp-server/main/README.md)

Implication: do not wrap Prometheus again unless you need policy, naming, or multi-source orchestration. Use it as low-level metric probe.

## Log surface: Loki / LogQL

Loki query model is label selector + optional log pipeline: `{ selector } | pipeline`. Loki indexes timestamp + labels, not full log body. LogQL supports log queries and metric queries from logs. Grafana Explore / Logs Drilldown is the intended human UI, while LogCLI can query from CLI. [Loki query docs](https://grafana.com/docs/loki/latest/query/)

Implication: logs should stay in Loki-like pipeline; agent should ask for narrow label sets first, then parser/pipeline, not dump raw logs blindly.

## Datadog pattern

Datadog log search supports boolean search, full-text `*:` queries, attribute search with `@`, wildcards, numeric range filters, tag filters, arrays, and calculated fields. Logs Search API needs API key + application key, lets client sort by facet or timestamp, page through results with cursor, and caps page size at 1000. Docs warn against relative time windows when paging. [Datadog search syntax](https://docs.datadoghq.com/logs/explorer/search_syntax/) · [Datadog logs API](https://docs.datadoghq.com/logs/guide/access-your-log-data/programmatically/)

Implication: Datadog is queryable, but agent should always pass bounded windows, bounded page size, and explicit sort.

## CloudWatch pattern

CloudWatch Logs Insights QL automatically discovers fields and uses `@`-prefixed discovered fields. Query commands include `filter`, `parse`, `stats`, `sort`, `limit`, `SOURCE`, and more. `StartQuery` must specify exactly one of `logGroupName`, `logGroupNames`, or `logGroupIdentifiers`, or put `SOURCE` in query string; results are stored by CloudWatch and later fetched with `GetQueryResults`. AWS notes interactive queries share concurrency quota with scheduled queries. [CloudWatch syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html) · [StartQuery API](https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_StartQuery.html)

Implication: for AWS-native telemetry, agent should query by group/source and not assume unlimited parallel searches.

## Auth and read-only boundaries

MCP auth spec says MCP servers must advertise authorization server location via Protected Resource Metadata discovery; MCP servers act as OAuth 2.1 resource servers, must validate access tokens for intended audience, and clients must keep separate registration state per authorization server. Tokens for one auth server must not be reused against another. [MCP authorization spec](https://modelcontextprotocol.io/specification/draft/basic/authorization)

Grafana side: service accounts replace API keys for Grafana API access, are scoped to an org, and can be given Viewer/Editor/Admin or RBAC permissions. [Grafana service accounts](https://grafana.com/docs/grafana/latest/administration/service-accounts/)

Implication for Mercury: every MCP surface should be read-first, org/env-scoped, and tokenized per backend. No shared super-token.

## Query safety rules

1. **Prefer narrow selectors**: labels/folders/services first, then deeper query.
2. **Bound time**: always pass time windows; no open-ended scrape across all history.
3. **Bound results**: page size, range step, and tool timeouts.
4. **Read-only by default**: writes off unless separate tool/server.
5. **Per-env separation**: staging/prod tokens and tool prefixes separate.
6. **No raw shell**: avoid generic exec surface when a purpose-built tool exists.

Evidence: Grafana MCP `--disable-write`; Prometheus MCP request timeout and `TOOL_PREFIX`; Datadog page limit 1000; CloudWatch concurrency quota. [Grafana configure](https://grafana.com/docs/grafana/latest/developer-resources/mcp/configure/) · [Prometheus MCP README](https://raw.githubusercontent.com/pab1it0/prometheus-mcp-server/main/README.md) · [Datadog logs API](https://docs.datadoghq.com/logs/guide/access-your-log-data/programmatically/) · [StartQuery API](https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_StartQuery.html)

## Metrics to standardize for Mercury

### Host / node level
- `node_cpu_seconds_total`
- `node_filesystem_avail_bytes`
- `node_network_receive_bytes_total`
- `node_exporter_build_info` [Node Exporter guide](https://prometheus.io/docs/guides/node-exporter/)

### Container / cAdvisor level
- `container_cpu_usage_seconds_total`
- `container_memory_working_set_bytes`
- `container_fs_usage_bytes`
- `container_network_receive_bytes_total`
- `container_start_time_seconds` [cAdvisor Prometheus metrics](https://raw.githubusercontent.com/google/cadvisor/master/docs/storage/prometheus.md)

### App/service level
Prometheus instrumentation guidance says online-serving systems should be measured by queries, errors, latency, and in-progress requests. Mercury services should emit their own counters/histograms for those behaviors; container metrics are not enough. [Prometheus instrumentation guide](https://prometheus.io/docs/practices/instrumentation/) · [cAdvisor Prometheus metrics](https://raw.githubusercontent.com/google/cadvisor/master/docs/storage/prometheus.md)

## Architecture recommendation for infra-bnh

### 1) Primary agent path
- **Grafana MCP** for most investigations.
- **Prometheus MCP** for precise metric/target queries.
- **Grafana datasource tools** for Loki/CloudWatch/Datadog-style data where Grafana is already configured.

### 2) Custom infra-wrapper MCP only if needed
Build a narrow read-only wrapper for things Grafana/Prometheus cannot see:
- Docker Compose state and health
- host process / port / socket state
- Terraform drift summary
- backup freshness / restore verification
- DNS / external bucket / volume existence
- repo deployment state and `make spdeploy` gates

Shape:
- structured JSON only
- read-only first
- one tool per question
- separate tools by env/repo
- no arbitrary command execution

### 3) What not to do
- no “generic infra shell MCP”
- no direct write access from agent to production
- no shared token across backends
- no container metrics treated as app health

## Recommendation for Mercury

For `infra-bnh`, standardize on:
1. **Grafana MCP** as operator UI surface.
2. **Prometheus MCP** as metric query backend.
3. **Loki** as log backend behind Grafana.
4. **Datadog / CloudWatch** only where those are source of truth or already integrated.
5. **Custom infra-wrapper MCP** only for Compose/Terraform/backup/DNS state.

That gives one read-first story for the DevOps specialist without turning it into a shell bot.

## Sources checked

- Grafana MCP intro — https://grafana.com/docs/grafana/latest/developer-resources/mcp/introduction/ (accessed 2026-05-31)
- Grafana MCP configure — https://grafana.com/docs/grafana/latest/developer-resources/mcp/configure/ (accessed 2026-05-31)
- Grafana service accounts — https://grafana.com/docs/grafana/latest/administration/service-accounts/ (accessed 2026-05-31)
- Prometheus MCP README — https://raw.githubusercontent.com/pab1it0/prometheus-mcp-server/main/README.md (accessed 2026-05-31)
- Loki query docs — https://grafana.com/docs/loki/latest/query/ (accessed 2026-05-31)
- Prometheus node exporter guide — https://prometheus.io/docs/guides/node-exporter/ (accessed 2026-05-31)
- Prometheus instrumentation guide — https://prometheus.io/docs/practices/instrumentation/ (accessed 2026-05-31)
- cAdvisor Prometheus metrics — https://raw.githubusercontent.com/google/cadvisor/master/docs/storage/prometheus.md (accessed 2026-05-31)
- Datadog search syntax — https://docs.datadoghq.com/logs/explorer/search_syntax/ (accessed 2026-05-31)
- Datadog logs search API — https://docs.datadoghq.com/logs/guide/access-your-log-data/programmatically/ (accessed 2026-05-31)
- CloudWatch Logs Insights syntax — https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html (accessed 2026-05-31)
- CloudWatch StartQuery API — https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_StartQuery.html (accessed 2026-05-31)
- MCP authorization spec — https://modelcontextprotocol.io/specification/draft/basic/authorization (accessed 2026-05-31)
