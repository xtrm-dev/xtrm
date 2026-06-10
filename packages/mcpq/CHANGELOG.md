# Changelog — `mcpq`

All notable changes to the `mcpq` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The umbrella repo changelog lives at [`../../CHANGELOG.md`](../../CHANGELOG.md).

---

## [Unreleased]

### Added

- **Initial release surface** — `mcpq` CLI with `servers`, `list-tools`,
  `describe`, `call` subcommands; `.mcpq.json` per-project config discovered
  by walking up cwd (bounded by `$HOME`; `--config FILE` override). Stdlib
  only on the call path; Python 3.10+. (xtrm-2m3)

- **MCP streamable-http protocol client** — initialize → notifications/
  initialized → tools/list → tools/call. Case-insensitive `Mcp-Session-Id`
  capture and replay. SSE-framed (`event: message\ndata: {...}`) and bare
  JSON responses both parsed. (xtrm-2m3.10)

- **`via`-mode dispatch** — `host` (direct urllib) and `docker:<container>`
  (subprocess-exec to `python3` inside a container on the MCP server's
  network — works around distroless sidecars that lack curl/python). The
  proxy container only needs `python3` on PATH. (xtrm-2m3.10)

- **Typed `--arg` parser** for `mcpq call`. Default `str`; explicit suffixes
  `:int`, `:float`, `:bool` (true/false/1/0/yes/no), `:json`. Duplicate
  names: last write wins. (xtrm-2m3.17)

- **Security hardening at boundaries** — URL scheme allowlist (http/https
  only), optional `MCPQ_ALLOWED_HOSTS` host allowlist, CRLF/NUL guard on
  every header value (including server-returned `Mcp-Session-Id`),
  `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$` container-name regex, walk-up discovery
  bounded by `$HOME` with `--config FILE` override. (xtrm-2m3.10)

- **Telemetry** — one-line JSON to stderr on every CLI invocation (success
  and error): `{server, subcommand, tool, duration_ms, outcome, error?}`.
  No payloads, no headers, no secrets. (xtrm-2m3.10)

- **`using-mcpq` skill** at `packages/mcpq/skills/using-mcpq/SKILL.md` —
  auto-triggers on observability MCP queries from CLI; teaches the
  discovery workflow `list-tools → describe → call` without enumerating any
  specific server's tool catalog. (xtrm-2m3.6)

- **Tests** — 84 cases passing: 77 unit (typed args, validation helpers,
  config discovery, protocol envelopes + SSE parser, session-id lookup) +
  7 smoke gated on `docker ps` showing both sidecars (full handshake,
  prometheus list/call, grafana list/describe). (xtrm-2m3.9)

- **README** with install, per-project setup, all 4 subcommands with
  examples, `via` semantics, typed-arg syntax, security model, telemetry
  format, exit codes, troubleshooting. (xtrm-2m3.8)
