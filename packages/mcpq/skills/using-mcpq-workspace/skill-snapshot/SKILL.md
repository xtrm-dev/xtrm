---
name: using-mcpq
description: Use when the user asks to query a Docker-sidecar MCP server (Grafana MCP, Prometheus MCP, Loki MCP, Tempo MCP, etc.) from the CLI without paying the always-loaded `.mcp.json` tool-schema token tax, or when the user references `mcpq`, the `.mcpq.json` per-project config, or any subcommand surface (`servers`, `list-tools`, `describe`, `call`). Triggers on observability MCP queries from CLI, "discover MCP tools live", "call MCP tool from shell", "what tools does <server> have", "describe tool X on server Y", or any task that should hit an MCP server without wiring it into `.mcp.json`. Skill teaches the discovery workflow `list-tools → describe → call` and does NOT enumerate any server's tool catalog.
---

# Using mcpq

`mcpq` is a CLI for querying Docker-network-only MCP servers from the host.
Per-project servers live in `.mcpq.json`. Tools are discovered live — never
hardcoded.

## When to use this skill

- A `.mcpq.json` exists in the project (or a parent dir up to `$HOME`).
- User wants to call an MCP tool but doesn't want to wire the server into
  `.mcp.json` (avoids loading 40+ tool schemas per session).
- The MCP server is on a Docker network with no exposed host port.
- User mentions: `mcpq`, `.mcpq.json`, observability MCP, sidecar MCP query.

## Discovery workflow

Three steps, all live against the server. Never assume tool names.

```bash
# 1. What servers are configured?
mcpq servers

# 2. What tools does this server expose?
mcpq <server> list-tools

# 3. What args does this tool take?
mcpq <server> describe <tool>

# 4. Call it.
mcpq <server> call <tool> --arg name=value --arg other:int=42
```

Example:

```bash
mcpq prometheus list-tools                                          # see 6 tools
mcpq prometheus describe mercury_execute_query                       # query: string required
mcpq prometheus call mercury_execute_query --arg query='up{job="prometheus"}'
```

## CLI surface

| Subcommand | Purpose |
|---|---|
| `mcpq servers` | List configured servers from `.mcpq.json` |
| `mcpq <s> list-tools [--json]` | Live tool catalog for server `<s>` |
| `mcpq <s> describe <tool> [--json]` | Input schema for one tool |
| `mcpq <s> call <tool> [--arg k=v ...] [--json]` | Invoke a tool |
| `--config FILE` | Bypass walk-up `.mcpq.json` discovery |
| `--version` | Show version |

All subcommands emit one line of telemetry JSON to **stderr** on every run
(success and error). Pipe with `2>&1 1>/dev/null | jq` to inspect.

## `.mcpq.json` schema

```json
{
  "servers": {
    "prometheus": {
      "url": "http://infra-prometheus-mcp:8091/mcp",
      "via": "docker:infra-prometheus-mcp"
    }
  }
}
```

Fields: `url` (required), `via` (required), `headers` (optional),
`transport` (optional, default `streamable-http`), `protocol_version`
(optional, default `2024-11-05`).

## `via` modes

- **`host`** — direct urllib POST from the host. Use when the server is
  reachable from the host network.
- **`docker:<container>`** — exec into a Docker container on the server's
  network and run the request from there. Use for sidecars on internal
  networks. **The named container must have `python3` on PATH.** Distroless
  sidecars don't — pick a different container on the same network (the
  prometheus sidecar usually works as a proxy for sibling sidecars).

## Typed `--arg` syntax

| Form | Type | Example |
|---|---|---|
| `name=v` | str | `--arg query=up` |
| `name:int=v` | int | `--arg limit:int=50` |
| `name:float=v` | float | `--arg threshold:float=0.95` |
| `name:bool=v` | bool (true/false/1/0/yes/no) | `--arg fuzzy:bool=true` |
| `name:json=v` | `json.loads(v)` | `--arg filter:json='{"x":1}'` |

## Telemetry

```json
{"server":"prometheus","subcommand":"list-tools","tool":"","duration_ms":1319,"outcome":"ok"}
```

Fields: `server`, `subcommand`, `tool`, `duration_ms`, `outcome`
(`ok`/`error`/`stub`), `error` (exception class) when applicable.

## Troubleshooting

- **`server 'X' not in .mcpq.json`** — `mcpq servers` to see what's loaded;
  `--config FILE` to point at a specific config.
- **`docker exec ... exited 1`** — proxy container lacks `python3` or isn't
  running. Verify with `docker ps --filter name=<container>` and
  `docker exec <container> python3 --version`.
- **`tool 'X' returned error: ...`** — server-side error from the MCP tool,
  not from `mcpq`. Read the message; it's verbatim from the server.

## Security

Set `MCPQ_ALLOWED_HOSTS=host1,host2` in shared environments to restrict the
URL allowlist. Header values are CRLF-validated. Container names are
regex-validated to prevent argv injection. `.mcpq.json` is
operator-trust-equivalent.

## Reference

Full README in `packages/mcpq/README.md`. Epic spec in `bd show xtrm-2m3`.
