# AWS AgentCore observability official docs

Date: 2026-05-31

## Summary

AWS docs say AgentCore observability is CloudWatch-centered, OTEL-compatible, and split across runtime, memory, gateway, built-in tools, identity, policy, payments, and evaluations. Runtime gets session metrics plus traces/logs; memory/gateway/built-in tools/identity need explicit log/trace setup; evaluations consume sessions/traces/spans and write results back into observability.


## Delta vs existing xtrm research

The earlier `agentops-telemetry-for-specialists.md`, `devops-query-surfaces-mcp-architecture.md`, and SRE telemetry notes already argued for job/tool/token/MCP observability. The official AgentCore docs sharpen the design in four ways:

- **Trace-first evidence model.** AgentCore ties runtime sessions, gateway tool calls, identity calls, policy decisions, built-in tools, and evaluations to traces/spans rather than treating them as independent logs.
- **CloudWatch is the documented source of truth.** Prometheus/Grafana are still useful for Mercury, but an AWS-compatible design needs an export/bridge decision rather than assuming Prometheus-native metrics.
- **Gateway + policy are observability boundaries.** Tool-call telemetry is not only latency/error metrics; it includes authorization decision, mismatched policies, target execution time, auth failures, and request-parameter errors.
- **Evaluations are part of observability.** Agent quality should be measured from sessions/traces/spans, not only from final text outputs.

For xtrm this suggests a hybrid: keep existing specialists token/cost/worktree/process metrics, but add trace/span IDs and a quality/eval namespace so agent runs become inspectable like distributed systems.

## AWS concept → xtrm/Mercury mapping

| AgentCore concept | xtrm/Mercury analogue | Owner | Action |
|---|---|---|---|
| Runtime session metrics/spans | specialist job/session lifecycle | specialists | Add stable session/trace/span identifiers to job events. |
| Gateway MCP tool spans | MCP/tool-call layer | specialists + infra | Record tool name, target, auth result, latency, error type, and trace IDs. |
| Identity metrics/spans | API keys, OAuth, service credentials, shell-admin gates | infra + specialists | Track credential fetch/use failures and throttle/auth-deny patterns. |
| Policy metrics/spans | permission tiers, approval gates, hard-deny rules | specialists + gitboard | Emit allow/deny/mismatch events; console renders evidence and approvals. |
| Evaluations | reviewer/test-runner/eval jobs and quality gates | specialists | Persist eval scores/pass rates and connect them to traces/jobs. |
| CloudWatch Transaction Search | queryable trace/log backend | infra | Decide whether to use CloudWatch directly or bridge into Grafana/Prometheus. |
| Observability dashboards | xtrm console panels | gitboard | Consume upstream metrics/traces; do not redefine source metrics in UI. |

## Source bibliography

### AWS docs / AWS-owned pages

All URLs accessed 2026-05-31.

- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-get-started.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-configure.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-view.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-telemetry.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-service-provided.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-runtime-metrics.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-gateway-metrics.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-identity-metrics.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-memory-metrics.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-tool-metrics.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-policy-metrics.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-payments-metrics.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity-overview.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-using.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/evaluations.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/how-it-works-evaluations.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/evaluations-terminology.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/built-in-evaluators-overview.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/ground-truth-evaluations.html

### Local xtrm context read
- `1-projects/xtrm/research/agentops-telemetry-for-specialists.md`
- `1-projects/xtrm/research/devops-query-surfaces-mcp-architecture.md`
- `1-projects/xtrm/research/sre-telemetry-patterns-for-mercury.md`

## AgentCore component taxonomy relevant to observability

| Surface | AWS doc claim |
|---|---|
| Observability | Unified view for trace/debug/monitor; OTEL-compatible telemetry; CloudWatch dashboards and traces. |
| Runtime | Secure serverless runtime; session isolation; built-in identity; agent-specific observability. |
| Memory | Metrics by default; spans/logs if enabled. |
| Gateway | MCP tool gateway; metrics/logs/spans; ingress + egress auth; policy hooks. |
| Built-in tools | Code Interpreter + Browser metrics/spans/logs. |
| Identity | Agent identity and credential service; auth/authorization telemetry. |
| Policy | Deterministic policy control on gateway tool calls; metrics/spans. |
| Payments | Payment transaction telemetry. |
| Evaluations | Trace/session/tool-call based evals; built-in/custom evaluators; results feed observability. |

## What metrics, traces, logs, evals are documented

### Runtime
- Metrics: `Invocations`, `Invocations (aggregated)`, `Throttles`, `System Errors`, `User Errors`, `Latency`, `Total Errors`, `Session Count`, `Sessions (aggregated)`, `ActiveStreamingConnections`, `InboundStreamingBytesProcessed`, `OutboundStreamingBytesProcessed`.
- Resource-usage metrics: `CPUUsed-vCPUHours`, `MemoryUsed-GBHours`.
- Spans: `InvokeAgentRuntime` with `session.id`, `latency_ms`, `error_type`, `aws.request_id`, `aws.endpoint.name`, `aws.agent.id`.
- Logs: `USAGE_LOGS`, `APPLICATION_LOGS` with `trace_id`, `span_id`, `request_payload`, `response_payload`.

### Gateway
- Metrics: `Invocations`, `Throttles`, `SystemErrors`, `UserErrors`, `Latency`, `Duration`, `TargetExecutionTime`, `TargetType`.
- Spans: `List Tools`, `Call Tool`, `Search Tools`.
- Log behavior: start/completion of request processing, target-config errors, bad/missing auth headers, bad request params, request/response bodies with `trace_id` and `span_id`.

### Identity
- Usage metrics: `CallCount`, `ThrottleCount`.
- Auth metrics: `WorkloadAccessTokenFetchSuccess`, `WorkloadAccessTokenFetchFailures`, `WorkloadAccessTokenFetchThrottles`.
- Resource-access metrics: `ResourceAccessTokenFetchSuccess`, `ResourceAccessTokenFetchFailures`, `ResourceAccessTokenFetchThrottles`, `ApiKeyFetchSuccess`, `ApiKeyFetchFailures`, `ApiKeyFetchThrottles`.
- Spans: `GetWorkloadAccessToken`, `GetWorkloadAccessTokenForJWT`, `GetWorkloadAccessTokenForUserId`, `GetResourceOAuth2Token`, `GetResourceAPIKey`.
- Logs: request/response payloads plus `trace_id` and `span_id`.

### Memory
- Metrics: `Latency`, `Invocations`, `System Errors`, `User Errors`, `Errors`, `Throttles`, `Creation Count`.
- Spans: `CreateEvent`, `GetEvent`, `ListEvents`, `DeleteEvent`, `RetrieveMemoryRecords`, `ListMemoryRecords`.
- Logs: `Extraction`, `Consolidation` workflows.

### Built-in tools
- Metrics: invoke-tool `Invocations`, `Throttles`, `SystemErrors`, `UserErrors`, `Latency`; session `Duration`; browser takeover `TakerOverCount`, `TakerOverReleaseCount`, `TakerOverDuration`.
- Resource usage metrics: `CPUUsed-vCPUHours`, `MemoryUsed-GBHours`.
- Spans: `StartCodeInterpreterSession`, `StopCodeInterpreterSession`, `InvokeCodeInterpreter`, `CodeInterpreterSessionExpire`, `StartBrowserSession`, `StopBrowserSession`, `ConnectBrowserAutomationStream`, `BrowserSessionExpire`.
- Logs: `APPLICATION_LOGS` for code interpreter with `trace_id`, `span_id`, request/response payloads.

### Policy
- Metrics: `Invocations`, `SystemErrors`, `UserErrors`, `Latency`, `AllowDecisions`, `DenyDecisions`, `TotalMismatchedPolicies`, `PolicyMismatch`, `MismatchErrors`, `DeterminingPolicies`, `NoDeterminingPolicies`.
- Spans: `AuthorizeAction`, `PartiallyAuthorizeActions` with `aws.agentcore.policy.authorization_decision`, `aws.agentcore.policy.mismatched_policies`, `aws.agentcore.gateway.policy.mode`, `aws.agentcore.gateway.policy.arn`.

### Payments
- Metrics: `OperationSuccess`, `OperationFailure`, `OperationLatency`, `SpendAmount`, `Throttles`, `UserErrors`, `ActiveSessions`, `PaymentRequestCount`, `PaymentSuccessCount`, `PaymentFailureCount`, `PaymentLatency`.
- Spans: `ProcessPayment`, `CreatePaymentInstrument`, `GetPaymentInstrument`, `ListPaymentInstruments`, `DeletePaymentInstrument`, `GetPaymentInstrumentBalance`, `CreatePaymentSession`, `GetPaymentSession`, `ListPaymentSessions`, `DeletePaymentSession`.

### Evaluations
- Inputs: sessions, traces, spans.
- Supported frameworks/instrumentation: Strands, LangGraph, OpenTelemetry, OpenInference, ADOT.
- Modes: online, on-demand, batch, dataset, simulation.
- Built-in evaluators: `Builtin.Correctness`, `Builtin.GoalSuccessRate`, `Builtin.TrajectoryExactOrderMatch`, `Builtin.TrajectoryInOrderMatch`, `Builtin.TrajectoryAnyOrderMatch`.
- Ground-truth fields: `expectedResponse`, `assertions`, `expectedTrajectory`.
- Docs say results integrate into AgentCore Observability powered by CloudWatch.

## Identity / runtime / gateway hooks that affect telemetry and governance

### Runtime hooks
- Runtime auto-instruments when deploy via AgentCore CLI.
- Non-runtime agents need `aws-opentelemetry-distro` and framework tracing support.
- Session propagation uses `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`.
- Trace propagation uses `traceId=<traceId>` plus standard `X-Amzn-Trace-Id`, `traceparent`, `tracestate`, `baggage`.
- Runtime uses built-in identity, session isolation, and outbound auth to third-party services.

### Gateway hooks
- Gateway is MCP-native; docs expose `tools/call`, `tools/list`, `prompts/list`, `resources/read`, `notifications/progress`, `notifications/message`, `sampling/createMessage`, `elicitation/create`.
- Gateway traces capture target type, target execution time, overhead latency, tool name, request/response bodies, auth failures, and bad request params.
- Policy observability is attached to gateway traces; policy spans are emitted only after gateway trace enablement.

### Identity hooks
- Identity supports Sigv4, OAuth 2.0, API keys, workload identities, credential providers, token vaults.
- Identity observability can be enhanced with `X-Amzn-Trace-Id` and `traceparent`.
- Identity metrics/spans expose fetch success/failure/throttle patterns for workload tokens, OAuth2 tokens, and API keys.

## Comparison to xtrm specialists observability needs

| xtrm need | AgentCore doc coverage | Gap / action |
|---|---|---|
| Agent lifecycle / tool hops | Strong. Runtime sessions + gateway tool spans + identity spans + policy spans. | Map every agent/tool hop to trace/span IDs; keep custom app spans too. |
| Token / cost / latency | Partial. Docs mention token usage in overview, but service-specific pages here mostly expose latency, errors, sessions. | Keep xtrm token/cost counters and attach model/version labels. |
| Queue / wait / orphan / worktree / process health | No direct AgentCore coverage. | Keep custom app metrics and alerts in xtrm stack. |
| Read-only observability surface | No native Grafana/Prometheus MCP surface in AgentCore docs. | Keep Grafana MCP + Prometheus MCP for operator-facing queries. |
| Evaluation quality signals | Strong. Evaluations consume traces/sessions/spans and integrate into observability. | Export eval score/pass-rate into existing dashboards. |
| Governance / auth / tool policy | Strong. Identity + gateway + policy metrics/spans/logs cover this directly. | Treat gateway/policy traces as audit surface. |

## Concrete follow-up updates

### infra-bnh
- Add CloudWatch Transaction Search bootstrap to setup/run docs.
- Add ADOT distro and OTEL env setup to runtime images and deploy scripts.
- Create log destinations for runtime, memory, gateway, built-in tools, and identity.
- Add dashboards/alarms for runtime latency, gateway duration, identity throttle/failures, policy deny/mismatch, and eval pass rate.
- Add export bridge for custom xtrm metrics: queue depth, wait seconds, worktree age, orphan process count, token budget, cost.

### unitAI-eoqxp
- Propagate `session.id`, `traceId`, `traceparent`, `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`, `mcp-session-id`, and baggage.
- Instrument tool calls as spans, not logs only.
- Redact request/response payloads by default.
- Add eval runs against sessions/traces/spans and store score/pass-rate in metrics.
- Keep explicit token/cost metrics for budget SLOs.

### forge-ow7c
- Treat AgentCore Gateway/Policy/Identity telemetry as upstream evidence that the console renders, filters, links, and explains.
- Add panel/spec requirements for target execution time, auth failure rate, request-parameter errors, policy allow/deny/mismatch, eval pass rate, and trace-linked incident timelines.
- Do not make gitboard the source of gateway metrics; route missing metric work to specialists/infra.
- Make request/response payload visibility opt-in, redacted, and trace-linked in the UI.

## Risks

- CloudWatch is source of truth in docs; Prometheus/Grafana export is an integration task, not built in.
- High-cardinality labels and raw payload logging will hurt cost and safety fast.
- Token usage is mentioned in overview, but the service-specific runtime metric list here does not expose a named token counter.
- Memory/gateway/built-in tool logs are not automatic in all cases; destinations must be configured.

## Follow-ups

- Decide CloudWatch-only vs CloudWatch-to-Grafana export path for xtrm.
- Decide whether xtrm eval scores live in same metrics namespace as runtime telemetry.
- Decide redaction policy for request/response payload capture.

## Machine-readable block

```json
{
  "status": "success",
  "summary": "Researched AWS AgentCore official docs and wrote evidence artifact.",
  "files_changed": ["1-projects/xtrm/research/aws-agentcore-observability-official-docs.md"],
  "follow_ups": ["Commit/push if repo workflow wants it."],
  "risks": ["CloudWatch-first telemetry requires export work for Prometheus/Grafana."],
  "verification": ["Read official AWS docs pages on 2026-05-31."]
}
```