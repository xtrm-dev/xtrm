# mcpq

Lightweight CLI for querying Docker-network-only MCP servers from the host.

Built to avoid two problems with the obvious `.mcp.json` wiring path:
1. Internal-only MCP sidecars (no host port) are unreachable from the host.
2. Loading 49+ tool schemas per session burns context tokens whether you query
   that server or not.

`mcpq` discovers tools live every call. No hard-coded schemas. No per-session
tool-tax. Stdlib only on the call path — Python 3.10+, no third-party deps.

## Install

```bash
pip install -e packages/mcpq
mcpq --help
```

## Per-project setup

Create `.mcpq.json` at the root of any project. `mcpq` walks up from cwd to
find it (bounded by `$HOME`; use `--config FILE` to override).

```json
{
  "servers": {
    "prometheus": {
      "url": "http://infra-prometheus-mcp:8091/mcp",
      "via": "docker:infra-prometheus-mcp"
    },
    "local-grafana": {
      "url": "http://localhost:8090/mcp",
      "via": "host"
    }
  }
}
```

Each server has:

| Field | Required | Purpose |
|---|---|---|
| `url` | yes | MCP endpoint (http/https only) |
| `via` | yes | Transport mode — `host` or `docker:<container>` |
| `headers` | no | Per-request headers (e.g., `Authorization`) |
| `transport` | no | Defaults to `streamable-http` |
| `protocol_version` | no | Defaults to `2024-11-05` |

## Subcommands

```bash
mcpq servers                                    # list configured servers
mcpq <server> list-tools [--json]               # live tool catalog
mcpq <server> describe <tool> [--json]          # input schema for one tool
mcpq <server> call <tool> [--arg k=v ...] [--json]
```

Add `--config FILE` before the server name to bypass walk-up discovery.

### Examples

```bash
# Discover what a server can do
mcpq prometheus list-tools

# Look up one tool's args
mcpq prometheus describe mercury_execute_query

# Invoke it
mcpq prometheus call mercury_execute_query --arg query='up{job="prometheus"}'

# JSON output for piping into jq / scripts
mcpq prometheus list-tools --json | jq '.[].name'
```

## `via` modes

### `host`

Direct `urllib.request` POST from this process. Use when the MCP server is
reachable from the host (`http://localhost:8090/mcp`, public URL, etc).

### `docker:<container>`

Indirection through a running Docker container on the MCP server's network.
The CLI runs `docker exec -i -- <container> python3 -c "..."` and the embedded
script does the HTTP call from inside that container's network namespace.

Use when the MCP server is on a Docker network with no host port (the common
case for internal sidecars built around `defense in depth`).

**Constraint:** the named container MUST have `python3` on PATH. Distroless
MCP sidecars typically do NOT — pick any other container on the same network
that has python3. For example, in `mercury_platform`, `infra-prometheus-mcp`
has python3 and can proxy for itself AND for the distroless `infra-grafana-mcp`
container.

## Typed `--arg` syntax

`mcpq call` accepts `--arg NAME=VALUE` or `--arg NAME:TYPE=VALUE`. Default is
string. Supported type suffixes:

| Suffix | Conversion | Example |
|---|---|---|
| (none) | `str` | `--arg query=up` |
| `int` | `int(value)` | `--arg limit:int=50` |
| `float` | `float(value)` | `--arg threshold:float=0.95` |
| `bool` | true/false/1/0/yes/no | `--arg fuzzy:bool=true` |
| `json` | `json.loads(value)` | `--arg filter:json='{"x":1}'` |

Duplicate names override (last write wins). Invalid type/value raises a clear
error and exits non-zero.

## Security

`mcpq` enforces guards at the config-load and transport boundary:

- **URL allowlist:** only `http`/`https` schemes. Optional opt-in: set
  `MCPQ_ALLOWED_HOSTS=hostA,hostB` to restrict to a comma-separated host list
  (case-insensitive; empty entries ignored).
- **Header value validation:** rejects CRLF / NUL bytes in any header,
  including the server-returned `Mcp-Session-Id`.
- **Container-name validation:** `docker:<container>` enforces
  `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$` to prevent flag/argv injection.
- **Walk-up bound:** `.mcpq.json` discovery stops at `$HOME` (override with
  `--config FILE`).

`.mcpq.json` is operator-trust-equivalent — anything written there is what
`mcpq` will dial. Set `MCPQ_ALLOWED_HOSTS` in shared CI / multi-user contexts.

## Telemetry

Every invocation emits one line of JSON to **stderr**:

```json
{"server":"prometheus","subcommand":"list-tools","tool":"","duration_ms":1319,"outcome":"ok"}
```

Fields: `server`, `subcommand`, `tool` (for describe/call), `duration_ms`,
`outcome` (`ok` / `error` / `stub`), and `error` (exception class name) when
applicable. No payloads, no headers, no secrets.

Pipe with `2>&1 1>/dev/null | jq` to inspect.

## Exit codes

- `0` — success
- `1` — user error (bad args, unknown tool, missing server)
- `2` — transport / server error

## Troubleshooting

**`error: server 'X' not in .mcpq.json` —** walk-up didn't find a `.mcpq.json`
that declares `X`. Run `mcpq servers` to see what's loaded; use
`--config FILE` to point at a specific file.

**`docker exec ... exited 1: ...` —** the proxy container doesn't have
`python3`, or the named container isn't running. Confirm with
`docker ps --filter name=<container>` and that `python3 --version` works:
`docker exec <container> python3 --version`.

**`error: invalid url 'X': host 'Y' not in MCPQ_ALLOWED_HOSTS` —** you set
the env var; either unset it or add the host. Empty env-var entries are
ignored, so `MCPQ_ALLOWED_HOSTS=,foo,` is equivalent to `MCPQ_ALLOWED_HOSTS=foo`.

**`error: tool 'X' returned error: ...` —** the server accepted the call and
returned a tool-level error (e.g., metric not found, dashboard query
malformed). Check the error message — it comes from the server, not `mcpq`.

## Why this exists

See the epic `xtrm-2m3` description in beads for the motivation: bridge
defense-in-depth Docker-network MCP sidecars to host-side discovery without
paying the always-loaded tool-schema token tax.
