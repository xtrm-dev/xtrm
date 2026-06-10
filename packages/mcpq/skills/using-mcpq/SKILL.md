---
name: using-mcpq
description: Use this skill whenever the user wants to query an MCP server from the command line — run PromQL, search Grafana dashboards, list alert rules, describe an MCP tool's args, or call any MCP tool from the shell. Trigger on `mcpq`, `.mcpq.json`, "what tools does the prometheus mcp have", "search grafana dashboards from cli", "execute_query for up{job=...}", "list MCP servers configured in this project", "verify mcpq wiring", or whenever a `.mcpq.json` exists at the project root. Also use for accessing internal Docker-network MCP sidecars (no host port exposed) from the host without paying the per-session tool-schema cost of wiring them into `.mcp.json`. Do NOT trigger for installing/wiring an MCP into Claude Desktop, IDE clients, or the user's `.mcp.json` — this skill is the CLI alternative, not a setup guide.
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

## Per-project verifier (recommended)

When a project adds `.mcpq.json`, ship a parallel verifier so the wiring is
durable across upstream image bumps. Reference implementation:
`mercury-infra/scripts/verify_mcpq.py` + `make verify-mcpq`. Pattern:

- Gate on sidecars-up via `docker ps`; skip cleanly (exit 0) when down
- Run the canonical discovery loop against the live config
- Assert shapes that prove the wiring — expected server names, tool counts,
  required prefixes, one known happy-path call returning expected value
- `--json` mode for CI / agents

Live discovery is only useful if drift is noticed; a scripted verifier is
what makes that durable.

## Security

Set `MCPQ_ALLOWED_HOSTS=host1,host2` in shared environments to restrict the
URL allowlist. Header values are CRLF-validated. Container names are
regex-validated to prevent argv injection. `.mcpq.json` is
operator-trust-equivalent.

## Reference

Full README in `packages/mcpq/README.md`. Epic spec in `bd show xtrm-2m3`.
