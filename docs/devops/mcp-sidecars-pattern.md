---
title: MCP Sidecars for Observability Backends — pattern note
type: pattern
status: active
date_created: 2026-06-10
discovered_in: mercury-infra (infra-6if)
---

# MCP Sidecars for Observability Backends

**One-line**: deploy upstream OSS MCP servers as read-only sidecars next to
existing observability backends (Prometheus, Grafana, Loki, Tempo) so substrate
and specialist agents can query telemetry natively instead of scraping rendered
dashboards.

## When to apply

- Project already has an observability stack (Grafana + Prometheus + Loki are
  typical). Agents need to *use* this telemetry, not just have it for humans.
- You don't want to give agents shell-on-the-host or expose query APIs to the
  public internet.
- Read-only access is sufficient. (If agents need to author dashboards or
  silence alerts, use a separate writable sidecar — never relax `--disable-write`
  on the read-only one.)

## Anti-pattern

- **Don't** point agents at the public Grafana URL with a long-lived admin
  token. Agents get write access by default; rotation hygiene degrades.
- **Don't** scrape rendered Grafana panels as PNGs. You lose query
  composability and you build a fragile screenshot OCR pipeline.
- **Don't** invent a new HTTP facade in front of Prom/Grafana for "agent
  ergonomics". The upstream MCP servers already model the right operations.

## Canonical shape

```
[substrate/specialist agent]
       │  (must share a Docker network with the sidecars)
       │  MCP over streamable-HTTP, JSON-RPC tool calls
       ▼
┌──────────────────────────────────┐    ┌──────────────────────────────────┐
│ infra-grafana-mcp:8090/mcp       │    │ infra-prometheus-mcp:8091/mcp    │
│  image: grafana/mcp-grafana      │    │  image: pab1it0/prometheus-mcp-  │
│  --disable-write                 │    │    server                        │
│  Bearer ${SA_TOKEN}              │    │  no auth (network-isolated)      │
└──────────────────────────────────┘    └──────────────────────────────────┘
       │                                       │
       ▼                                       ▼
[grafana:3000]                          [prometheus:9090]
```

### Key properties

- **Internal-only**: on the project's internal Docker network. **No Traefik
  route, no host port.** The only consumers are other containers on the same
  network.
- **Read-only**: `--disable-write` on Grafana MCP. Prometheus has no write API
  to disable.
- **Tag-pinned**: never track `:latest`. Both upstream projects ship breaking
  changes (env renames, tool renames, flag renames).
- **Tool-prefixed**: set `TOOL_PREFIX=<project>_` on the Prometheus MCP so an
  agent that talks to multiple projects' MCPs can disambiguate tools.

## Concrete instance

- **mercury-infra (2026-06-10)** — `infra-6if`. See
  `docs/telemetry/mcp-query-surfaces.md` in that repo for the full operational
  doc, and the per-service skills under
  `.xtrm/skills/user/packs/infra/service-skills/services/{grafana,prometheus}-mcp/SKILL.md`.

## Upstream drift to expect

Both upstream projects in the canonical shape above have spec/CLI surfaces
that drift between minor versions. The mercury-infra deploy hit all of these
in a single session:

| Class | What the eval doc said | Reality | Lesson |
|---|---|---|---|
| Registry | `ghcr.io/grafana/mcp-grafana` | Docker Hub `grafana/mcp-grafana` | Verify the actual published registry, don't assume GHCR for everything |
| Tag format | `v0.15.2` (matches git tag) | `0.15.2` (no `v`) | Image tag ≠ git tag; check `docker pull` before pinning |
| Secret env | `*_TOKEN_FILE` | `*_TOKEN` (no `_FILE` variant) | Many MCP server binaries don't read file-mounted secrets; budget for `.env` not Docker secrets |
| Port flag | `--port` | `--address host:port` (default `localhost:8000`) | Check CLI help; localhost-defaults break Docker networking silently |
| Default transport | (assumed HTTP) | `stdio` for Prom MCP | Default-stdio binaries need explicit transport env to serve cross-container |
| Endpoint path | `/` | `/mcp` (or `/sse`) | MCP path is convention not universal; check upstream README |
| Image minimality | (assumed Alpine-ish) | Distroless-ish, no `wget/curl/nc` | Healthchecks may require disabling or sidecar tooling |
| Baked healthchecks | (assumed working) | Probes `/`, gets 404, always unhealthy | Override or disable in compose |

## Implementation steps

1. **Identify the OSS MCP servers** for your backends. Currently mature:
   `grafana/mcp-grafana`, `pab1it0/prometheus-mcp-server`. Loki/Tempo MCPs
   exist but less stable.
2. **Verify registries + tags** by running `docker pull` against candidate
   refs before pinning. The eval doc's image refs *will* be wrong by the time
   you deploy.
3. **Verify env contracts** by `curl`ing the upstream README at the pinned
   tag (e.g. `raw.githubusercontent.com/<org>/<repo>/<tag>/README.md`) and
   `grep`ing for env names, flags, defaults. Don't trust evaluation-time notes.
4. **Decide auth model per sidecar**:
   - Grafana → service account (Viewer role) → token in `.env`. Provision in
     UI; the binary won't read file-mounted secrets.
   - Prometheus → typically no auth (network-isolated). If proxied behind auth,
     use `PROMETHEUS_TOKEN`/`PROMETHEUS_USERNAME`+`PROMETHEUS_PASSWORD`.
5. **Bind to `0.0.0.0` not `localhost`**. The CLI/env defaults for both
   projects bind loopback only, which is invisible to other Docker containers.
6. **Compose**: append two services to the existing observability compose.
   Put them on the same network as the backends. Don't add Traefik routes.
   Don't expose host ports.
7. **Healthcheck**: override anything baked in that probes `/`. Either disable
   (if image is too minimal for any probe) or write a custom check that
   accepts any HTTP response as proof of life.
8. **Smoke**:
   - container-level: `docker ps` healthy, `wget /mcp` from an adjacent container
     returns 200 (Grafana MCP) or 406 (FastMCP-based servers reject GET)
   - agent-level: `search_dashboards` returns the expected count;
     `execute_query` returns a real PromQL result; a mutation tool returns the
     "disabled" error
9. **Document the drift** in your project's per-service skill so the next
   image bump catches the right gotchas.

## When NOT to use

- If the project doesn't have an existing observability stack, build that
  first. MCP sidecars don't help if there's nothing to query.
- If agents need full write access to the observability layer (dashboard
  authoring, alert silencing). Run a separate, network-segregated writable
  sidecar — never relax the read-only one's flags.
- If the agent fleet is on a different host or VPC than the observability
  backends. The pattern assumes shared Docker network. Cross-host needs a
  different transport (SSE through a reverse proxy with mTLS, or similar).

## Related

- xtrm docs:
  - [`devops-system.md`](devops-system.md) — broader DevOps agent architecture
  - [`dashboard-grafana-dump-chatgpt.md`](dashboard-grafana-dump-chatgpt.md) —
    earlier exploratory note on Grafana MCP capabilities
- Concrete project instance: `mercury-infra/docs/telemetry/mcp-query-surfaces.md`
- Original evaluation: `mercury-infra/docs/telemetry/devops-query-surface-eval.md`
