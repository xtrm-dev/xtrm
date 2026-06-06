---
date_created: Sunday, May 31st 2026, 12:35:24 pm
date_modified: Sunday, May 31st 2026, 1:38:04 pm
---
# AgentOps telemetry for specialists

## Summary

Current external evidence says best shape for specialist platforms is:

- OTel GenAI spans + metrics for agent lifecycle, tokens, latency, streaming, inputs/outputs, tool calls.
- OTel MCP semconv for transport/session/tool-call spans and session/op duration metrics.
- Grafana MCP + Prometheus MCP for read-only observability access, metrics queries, dashboards, alerting, and incident workflow.
- Custom app metrics for queue depth, waiting/running job states, worktree health, orphan processes, budgets, and eval outcomes.

Use standard semconv where it exists; add custom Prometheus metrics where it does not. Keep write paths gated. (Sources below, accessed 2026-05-31.)

## Current external evidence

| Area | Evidence | Mercury use |
|---|---|---|
| Agent lifecycle | OTel GenAI semconv defines `create_agent`, `invoke_agent`, `invoke_workflow`, and `execute_tool` spans; `create_agent`/`invoke_agent` include agent id/name/version, conversation id, data source id, inputs/outputs, and tool definitions. https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/ and https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ (accessed 2026-05-31) | Model specialist/job lifecycle as nested spans, not raw logs. |
| Token / cost / latency | OTel GenAI metrics define `gen_ai.client.token.usage`, `gen_ai.client.operation.duration`, `gen_ai.client.operation.time_to_first_chunk`, `gen_ai.server.request.duration`, `gen_ai.server.time_per_output_token`, `gen_ai.server.time_to_first_token`. `time_to_first_token` explicitly measures queue + prefill time. https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/ (accessed 2026-05-31) | Build token, latency, and queue panels from these names; derive USD cost from token totals + model pricing. |
| Tool telemetry | OTel GenAI spans define `execute_tool` with `gen_ai.tool.name`, optional `gen_ai.tool.call.id`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`. MCP semconv maps tool calls to `tools/call` spans with `gen_ai.operation.name=execute_tool`, `mcp.method.name`, `mcp.session.id`, `jsonrpc.request.id`, `error.type`, `rpc.response.status_code`, and `tool_error` when tool result is error. https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ and https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/ (accessed 2026-05-31) | Instrument every MCP/tool hop; correlate LLM decision -> tool args -> tool result -> failure. |
| MCP health / transport | MCP semconv defines client/server spans and metrics: `mcp.client.operation.duration`, `mcp.server.operation.duration`, `mcp.client.session.duration`, `mcp.server.session.duration`, plus transport mapping (`pipe` for stdio, `tcp/quic` for HTTP). https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/ (accessed 2026-05-31) | Track session stability, retry noise, stdio vs HTTP transport, and per-tool error rate. |
| Grafana MCP ops | `mcp-grafana` exposes Prometheus metrics + OTLP traces/logs, read-only mode (`--disable-write`), tool-category toggles, slow-request logging, and metrics: `mcp_server_operation_duration_seconds`, `mcp_server_session_duration_seconds`, `http_server_request_duration_seconds`. https://raw.githubusercontent.com/grafana/mcp-grafana/main/README.md (accessed 2026-05-31) | Use Grafana MCP as read-only observability surface for agents; alert on slow tool calls. |
| Prometheus MCP ops | `prometheus-mcp-server` exposes `health_check`, `execute_query`, `execute_range_query`, `list_metrics`, `get_metric_metadata`, `get_targets`; uses `PROMETHEUS_REQUEST_TIMEOUT`, auth env vars, and optional stateless HTTP. https://raw.githubusercontent.com/pab1it0/prometheus-mcp-server/main/README.md (accessed 2026-05-31) | Give specialist agent controlled metric-query access and server health signal. |
| Eval traces | Pydantic Logfire docs say it provides token tracking, cost monitoring, tool call inspection, multi-turn conversations, and evaluations via `pydantic-evals`; it runs on OpenTelemetry and can be queried via SQL/MCP. https://pydantic.dev/docs/logfire/get-started/ai-observability/ (accessed 2026-05-31) | Use traces + eval runs together; keep evals in CI and review in observability backend. |

## Metric map for Mercury

### Standard metrics to adopt

- `gen_ai.client.token.usage`
- `gen_ai.client.operation.duration`
- `gen_ai.client.operation.time_to_first_chunk`
- `gen_ai.server.request.duration`
- `gen_ai.server.time_to_first_token`
- `gen_ai.server.time_per_output_token`
- `mcp.client.operation.duration`
- `mcp.server.operation.duration`
- `mcp.client.session.duration`
- `mcp.server.session.duration`
- `mcp_server_operation_duration_seconds`
- `mcp_server_session_duration_seconds`
- `http_server_request_duration_seconds`

### Custom app metrics to add

- `specialist_job_state{state=queued|waiting|running|blocked|failed|done}`
- `specialist_queue_depth`
- `specialist_job_wait_seconds`
- `specialist_job_latency_seconds`
- `specialist_worktree_dirty_total`
- `specialist_worktree_age_seconds`
- `specialist_process_orphan_total`
- `specialist_process_restart_total`
- `specialist_mcp_error_total{tool,error_type}`
- `specialist_token_budget_remaining_usd`
- `specialist_cost_usd_total`
- `specialist_eval_pass_rate`
- `specialist_eval_score`

## Dashboards / alerts

Recommended panels:

- active specialists / running jobs / waiting jobs
- tool-call latency by tool and repo
- token usage and USD burn by job, repo, model (usd no, just token)
- */nice to have: token/kb payload usage by tool use and output*
- queue depth + wait time
- MCP error rate and `tool_error` rate
- worktree drift / dirty worktrees / stale worktrees
- process count, orphan count, restart loops
- post-deploy health and rollback outcomes
- eval pass rate over time

Recommended alerts:

- queue depth over threshold
- waiting jobs older than SLO
- token budget burn rate above plan
- MCP `tool_error` spike
- specialist process crash loop
- stale/dirtied worktree older than threshold
- zero-heartbeat / no active worker
- post-deploy error or latency regression

## Mercury recommendation

1. Instrument agent/job lifecycle with OTel GenAI spans first.
2. Add MCP semconv on every tool boundary.
3. Export token + cost + latency metrics to Prometheus.
4. Add custom gauges/counters for queue, worktree, and process health.
5. Use Grafana MCP read-only for agent investigation; keep writes behind explicit approval.
6. Run evals in CI and store traces in the same observability stack.
7. Redact or truncate message/tool payloads by default; opt in only where needed.

## Risks

- Tool arguments, tool results, input/output messages can carry PII or secrets.
- High-cardinality labels can wreck Prometheus and dashboards.
- Agent observability without write controls can become unsafe fast.
- Token and cost metrics need model/version attribution or they lie.

## Verification

Sources checked (all accessed 2026-05-31):

- https://opentelemetry.io/docs/specs/semconv/gen-ai/
- https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/
- https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
- https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
- https://raw.githubusercontent.com/grafana/mcp-grafana/main/README.md
- https://raw.githubusercontent.com/pab1it0/prometheus-mcp-server/main/README.md
- https://pydantic.dev/docs/logfire/get-started/ai-observability/

## Follow-ups

- Map Mercury repos to a concrete metric naming convention.
- Decide if xtrm console needs one dashboard per repo or one cross-platform Ops view.
- Define budget policy: per job, per repo, per model, per user.
- Add SLOs for queue wait, tool latency, and post-deploy regression.

## Beads

bd claim/update for `second-mind-76vz2` failed here because bead id was not resolved by CLI, so work continued without bead state mutation.
