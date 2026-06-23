# Changelog

All notable changes to the **xtrm** monorepo will be documented in this file.

This is the umbrella changelog for the repository. Packages under `packages/`
that warrant their own release cadence keep a focused `CHANGELOG.md` next to
their `pyproject.toml` / `package.json`; this file aggregates their releases
and tracks repo-level changes (skills, docs, infrastructure, top-level
configs).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-package changelogs:

- [`packages/mcpq/CHANGELOG.md`](packages/mcpq/CHANGELOG.md)

---

## [Unreleased]

### Added

- **Dependency-bump policy decision package.** Adds `docs/devops/dependency-bump-policy.md`, locking the advisory-vs-blocking CI policy (OSV PR advisory with SECURITY_FORCED block, 7-day cooldown, push/schedule hard gates) and mapping the implementation board across xtrm-tools and specialists (`unitAI-3v5sn`).
- **`packages/mcpq/` — new Python CLI** for querying Docker-network-only MCP
  servers from the host without paying the always-loaded `.mcp.json`
  tool-schema token tax. Live tool discovery, stdlib-only call path, two
  transport modes (`host` direct urllib + `docker:<container>` proxy for
  internal sidecars), typed `--arg name[:type]=value` parser, security
  hardening (URL scheme allowlist with `MCPQ_ALLOWED_HOSTS`, CRLF header
  guards, walk-up bounded by `$HOME`, container-name regex). Ships with
  `using-mcpq` skill. 84/84 tests pass (77 unit + 7 smoke gated on
  `docker ps`). End-to-end verified against `mercury_platform` sidecars
  (`infra-prometheus-mcp` 6 `mercury_*` tools, `infra-grafana-mcp` 49 tools).
  See [`packages/mcpq/CHANGELOG.md`](packages/mcpq/CHANGELOG.md) for the
  package-level entry. (xtrm-2m3)
