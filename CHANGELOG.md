
## [Unreleased]

### Added

- **Phase A — protocol client, via-mode dispatch, .mcpq.json discovery** ([e9c483f](https://github.com/xtrm-dev/xtrm/commit/e9c483f81d71f0a490eed0dbca26949e9ca09514))

  - validation.py: URL scheme + host check (F-1 SSRF), header CRLF/NUL guard
    (F-2), container name regex (F-4), walk-up bound at $HOME (F-3)
  - config.py: bound discover_config to Path.home(); route all
    ServerSpec.headers via validate_header_value at load; reject
    via=docker:<name> unless the name matches the safe container regex;
    honour MCPQ_ALLOWED_HOSTS env var for URL allow-listing
  - protocol.py: drop dead event_name tracking in _parse_sse
  - transport.py: validate_url before any POST in both HostTransport and
    DockerTransport; validate container name at DockerTransport construction;
    insert '--' separator in docker exec argv to prevent flag injection
  - client.py: type-annotate __init__ transport parameter as
    HostTransport | DockerTransport | None; validate captured
    Mcp-Session-Id via validate_header_value (raise TransportError on
    forbidden bytes)
  - cli.py: --config FILE flag to bypass walk-up discovery

  Live smoke (post-hardening):
    prometheus list_tools: 6 tools, all mercury_-prefixed
    grafana list_tools: 49 tools
    Session-id captured on initialize, replayed on tools/list
    notifications/initialized returns 202

  Hardening probes:
    validate_url ftp://... -> rejected
    validate_url empty -> rejected
    validate_url http://... -> accepted
    validate_header_value 'a\r\nX-Evil' -> rejected (0x0d)
    validate_header_value 'a\x00b' -> rejected (0x00)
    validate_header_value 'bar' -> accepted
    container name 'foo;bar' -> rejected at config-load
    container name '--rm rm -rf /' -> rejected at config-load
    container name 'infra-prometheus-mcp' -> accepted
    discover_config start=/tmp -> rejected (above home ceiling)
    discover_config start=Path.home() -> rejected (no config there)
    load_config explicit path -> bypasses discovery
    header CRLF in .mcpq.json -> rejected at config-load
    ftp URL in .mcpq.json -> rejected at config-load

  Single commit; no .claude/ scope leak; stdlib-only call path preserved;
  Phase B subcommands remain stubbed.


- **Phase B — list-tools, describe, call subcommands with typed args** ([5967a9d](https://github.com/xtrm-dev/xtrm/commit/5967a9db7686f1ea871d78394056a0af4611ca4b))

  - args.py: --arg key[:type]=value parser supporting int/float/bool/json types
  - render.py: human-readable + json output for tool list, schema, results
  - cli.py: real implementations replace Phase A stubs; telemetry on every path

  Live-verified end-to-end against mercury_platform sidecars:
  - prometheus list-tools (6 mercury_* tools), describe mercury_execute_query,
    call mercury_health_check (healthy), call mercury_execute_query (vector=1)
  - grafana list-tools (49 tools), describe search_dashboards,
    call search_dashboards (16 dashboards)
  - Error path: nonexistent tool + bad --arg syntax both produce clear errors
  - Telemetry one-line JSON on every subcommand including errors

  Closes coverage of xtrm-2m3.4 + xtrm-2m3.5.


- **Phase D — tests + cli OP-required fix** ([618f737](https://github.com/xtrm-dev/xtrm/commit/618f7373343c17c9f4493983450967f044dedd0f))

  - tests/test_args.py: 18 cases for typed --arg parser (str/int/float/bool/json,
    duplicates, error paths)
  - tests/test_validation.py: 27 cases for validate_url (scheme allowlist,
    MCPQ_ALLOWED_HOSTS), validate_header_value (CRLF/NUL), validate_container_name
  - tests/test_config.py: 9 cases for ServerSpec coercion, discover_config walk-up
    with $HOME ceiling, explicit-path bypass
  - tests/test_protocol.py: 14 cases for JSON-RPC envelopes, SSE single/multi
    event, multi-line data concatenation, case-insensitive Mcp-Session-Id lookup
  - tests/test_smoke.py: 7 live integration tests gated on `docker ps` showing
    both sidecars (prometheus 6 mercury_* tools, grafana 40+ tools, full
    handshake, mercury_execute_query 'up' = vector value 1)

  84/84 tests pass: 77 unit + 7 smoke (verified against running
  infra-prometheus-mcp + infra-grafana-mcp on mercury_platform).


### Other changes

- **Add DevOps specialist research synthesis** ([608e32a](https://github.com/xtrm-dev/xtrm/commit/608e32a109f954116343f8735a5503dd1af9ef43))


- **Translate DevOps research and expand Terraform guide** ([2a96a0c](https://github.com/xtrm-dev/xtrm/commit/2a96a0c54aa23c40311c143f124bd0fcb438d4da))


- **Add Terraform first steps note** ([9f7a9e0](https://github.com/xtrm-dev/xtrm/commit/9f7a9e0ce50aaf2ebcb0e32b01ae9962678afa53))


- **Add infra Terraform fit notes** ([314b99b](https://github.com/xtrm-dev/xtrm/commit/314b99bd892adb915ee2836352d7f89e944bc846))


- **Clarify infra MCP and metrics coverage** ([6dfc1e0](https://github.com/xtrm-dev/xtrm/commit/6dfc1e02ff926708c6e626f86196dccb8c98cf05))


- **Add DevOps telemetry research notes** ([ef8fcc7](https://github.com/xtrm-dev/xtrm/commit/ef8fcc70cd07be68bf6f05b569aa15cb94195080))


- **Add AWS official docs research** ([9600d52](https://github.com/xtrm-dev/xtrm/commit/9600d521ec6c219ca10f604c367ac4b518959d73))


- **1-projects/xtrm baseline pre-modifiche** ([21f1935](https://github.com/xtrm-dev/xtrm/commit/21f193516f170e6756c74fdac1fea19cb6ba082c))

  Cattura stato corrente: nuovi file channels, substrate, telemetry,
  specialists; archivio devops research; console e devjournal aggiornati.


- **Rename channels.html.md to channels.html** ([8656970](https://github.com/xtrm-dev/xtrm/commit/8656970b0ca5b38f013b935dc07ec20677c46f9b))


- **Added console architecture docs** ([ce8c3e4](https://github.com/xtrm-dev/xtrm/commit/ce8c3e4e967c003f681e2e7124dad3d494de7774))


- **Vault backup: 2026-06-07 07:36:08** ([5a8a82f](https://github.com/xtrm-dev/xtrm/commit/5a8a82f7779c920ba0f511c86989e91ef9eeef3f))


- **2026-06-07 04:53:50 (1 files)** ([31d43d7](https://github.com/xtrm-dev/xtrm/commit/31d43d7619609c8a41f695c8e29e8bf43df22988))


- **2026-06-07 05:03:52 (1 files)** ([0244aca](https://github.com/xtrm-dev/xtrm/commit/0244acad230f71632f7b5bd92cc763ab6f027145))


- **2026-06-07 07:03:50 (1 files)** ([a1346fb](https://github.com/xtrm-dev/xtrm/commit/a1346fb9a05e18b334c3d0d47a02fd6dfb03940c))


- **2026-06-07 07:13:59 (1 files)** ([78d6bd1](https://github.com/xtrm-dev/xtrm/commit/78d6bd14ce6865a3014b0fd175acb2cf08277921))


- **2026-06-07 07:24:50 (1 files)** ([72bf2ce](https://github.com/xtrm-dev/xtrm/commit/72bf2ce8079a15107788c8490cff0456e34b7e9a))


- **2026-06-07 07:35:50 (6 files)** ([b610985](https://github.com/xtrm-dev/xtrm/commit/b61098514ce2d7c9cf7ea9eaa027711671f3a74b))


- **Vault backup: 2026-06-07 07:37:36** ([3c79980](https://github.com/xtrm-dev/xtrm/commit/3c79980318e113135c53ed0d4817503a2534933c))


- **2026-06-07 07:46:52 (1 files)** ([2277c90](https://github.com/xtrm-dev/xtrm/commit/2277c90b55f51e4af052ea02b1095a60f4d855d8))


- **2026-06-07 09:14:20 (1 files)** ([ebe06b3](https://github.com/xtrm-dev/xtrm/commit/ebe06b34540ef432612f127eec8f6616c3f1e023))


- **2026-06-07 09:57:50 (1 files)** ([b9250b9](https://github.com/xtrm-dev/xtrm/commit/b9250b9bfd09daf675acac2634f5286ce29b70eb))


- **2026-06-07 10:19:50 (1 files)** ([b3ccbe9](https://github.com/xtrm-dev/xtrm/commit/b3ccbe9d4fc0122d4ae2929443151d2889aecd89))


- **2026-06-07 11:25:51 (1 files)** ([903fe3f](https://github.com/xtrm-dev/xtrm/commit/903fe3f4e6f640fc83656fa9d31f7b74108fee4e))


- **2026-06-07 11:57:25 (2 files)** ([7f8de46](https://github.com/xtrm-dev/xtrm/commit/7f8de46e7a51d565760fe1c724ea4e380b030870))


- **Added channels enhancements to verify** ([e6f6319](https://github.com/xtrm-dev/xtrm/commit/e6f631948bfb113551b46b41a6e02c516460eb1c))


- **2026-06-10 02:44:08 (1 files)** ([a362f1f](https://github.com/xtrm-dev/xtrm/commit/a362f1f045582ee5805a11467a3c4c6482fc7e6c))


- **Merge xtrm-2m3.10: Phase A — mcpq foundation (protocol client + via-mode dispatch + .mcpq.json)** ([2ac44b4](https://github.com/xtrm-dev/xtrm/commit/2ac44b4b91958b02d2d6d8384162b206b909a54e))


- **Merge xtrm-2m3.17: Phase B — mcpq CLI subcommands (list-tools, describe, call)** ([3615e5c](https://github.com/xtrm-dev/xtrm/commit/3615e5c59a4fc7478ed017d6ea9fb64487672d36))


- **Session report: 2026-06-10 (xtrm-2m3 epic + branch protection + CHANGELOG scaffold) (#3)

## Summary

Session handoff report for 2026-06-10 covering the xtrm-2m3 epic
end-to-end delivery, branch protection tightening, and CHANGELOG
scaffolding. Continues into 2026-06-11 with user overnight work folded
in (agent-observability doc, skill polish, mercury-infra verifier).

Tracked via beads handoff `xtrm-y9i` (relates to `xtrm-8fo`).

## What is in the report

- Issues closed (23), issues filed (17), specialist dispatches (12
across 2 waves)
- Wave 1 (Phase A): full success — executor + 6 gates → reviewer PASS
98/100
- Wave 2 (Phase B/C/D): `nano-gpt/minimax-m3:thinking` backend started
returning zero tokens partway through; switched to manual orchestrator
implementation per explicit user authorization
- Code changes narrative (mcpq package architecture, CHANGELOG layout)
- Open issues with context (`xtrm-8fo` SSH commit signing — recipe in
bead)
- Memories saved (4)
- Suggested next priorities (4, ordered by leverage)

## Test plan

- [ ] Read the report at `.xtrm/reports/2026-06-10-ca7cdad.md`
- [ ] Confirm `bd show xtrm-y9i` and `bd show xtrm-8fo` are linked (`bd
dep relate`)
- [ ] Decide on the 4 suggested next priorities

Co-authored-by: dawid <dawid@v2202602340735437128.quicksrv.de>** ([e02b9b6](https://github.com/xtrm-dev/xtrm/commit/e02b9b66fa677b7ba216a7b5fc1a3828281e726d))


- **Apply 2026-06-11 audit (visibility/cursor/outcome/evidence/swap/forensic; §12 resolutions + residuals; Design Lineage); revert docs→xtrm rename (#6)** ([efb644a](https://github.com/xtrm-dev/xtrm/commit/efb644a72b1a9ed4bf99dea94884262377a9495a))

  channels.md/upgrade/forensic ora coerenti; channels.md mancava il
  contenuto audit nel primo tentativo. Include il ripristino del vault da
  xtrm/ a docs/.

  ---------


- **Update documentation (#9)

## Summary

<!-- 1-3 sentences. What changes and why. -->

## Scope

<!-- Affected packages / apps / docs paths. -->

- [ ] `packages/...`
- [ ] `apps/...`
- [ ] `docs/...`
- [ ] `.github/` / repo machinery

## Bead / issue link

<!-- Closes Jaggerxtrm/specialists#... or Jira KAN-... -->

## Validation

<!-- How was this verified? Tests, smoke runs, doc review. -->

- [ ] Lint / typecheck pass
- [ ] Tests added or updated
- [ ] Docs updated (if user-visible behavior changed)

## Risk

<!-- Blast radius. Migrations? Lockfile bumps? Cross-package changes?
-->

---

🤖 If generated with Claude Code, leave the trailer in commits.** ([9824715](https://github.com/xtrm-dev/xtrm/commit/982471580d860e7264f42857b90e75975fefaef2))


### Project maintenance

- **Add console product contract** ([5f62d8a](https://github.com/xtrm-dev/xtrm/commit/5f62d8aa4a33b78a14aeca87bb63e88dea707191))


- **Finalize console product contract** ([77bcdb7](https://github.com/xtrm-dev/xtrm/commit/77bcdb7dfa33973688d40ed14526fd5ebe51f8bf))


- **Persist 2026-06-06 session edits + clean Syncthing conflicts** ([3ce8549](https://github.com/xtrm-dev/xtrm/commit/3ce85497df0e82610a25445dabf9eb8e17fd7680))

  - monorepo-migration.md: §2 fresh umbrella + per-package graft, §3.0 daemon
    binary + state engine ownership in packages/core, §3.1 state engine pattern,
    §3.2 channels→{core} dep, §11 state-store alternatives considered
  - state-store-options.md: §1 bottom-tier ownership note, §9 decision log
    (Path 1 SQLite+daemon confirmed; Path 3/5 revisit triggers)
  - substrate_design_it.md: §13.2 daemon ownership (infra-vs-domain split),
    §13.3 (new) deployment tiers synthesis, §17.4 substrate=domain layer, layout
    table + DAG updated with core row + channels→{core}
  - devjournal.md: today's notes
  - Removed 13 .sync-conflict-*.md (untracked, never in git)

  Vault baseline before filter-repo extraction into the new xtrm/ repo.


- **Relocate vault content under docs/** ([c7f6893](https://github.com/xtrm-dev/xtrm/commit/c7f68933ccaafc907b7f152efbdd4ee98650f0ad))

  All markdown moved into docs/ to match monorepo layout. Packages/ and apps/
  scaffolding added in the next commit.


- **Scaffold monorepo (packages/, apps/, README, .gitignore, LICENSE)** ([12bf46c](https://github.com/xtrm-dev/xtrm/commit/12bf46c897c3f2eac630fb747096fa04cd828058))

  - README.md: umbrella overview + package ownership table + docs map
  - .gitignore: node/pnpm/build/agent-runtime/syncthing patterns
  - LICENSE: proprietary closed-source notice
  - packages/.gitkeep, apps/.gitkeep: placeholder dirs for graft targets


- **Collaborator-ready scaffolding** ([75f8b1a](https://github.com/xtrm-dev/xtrm/commit/75f8b1aa5b695df29c8ad4d48f7646ce5c75af1e))

  - .github/dependabot.yml: weekly GH Actions + npm bumps, grouped
  - .github/CODEOWNERS: default ownership rules (per-package owners TBD)
  - .github/pull_request_template.md: scope + bead/Jira link + validation
  - .github/ISSUE_TEMPLATE/{bug_report,feature_request,config.yml}
  - SECURITY.md: private-disclosure policy


- **Add CONTRIBUTING.md + link from README** ([5f8efef](https://github.com/xtrm-dev/xtrm/commit/5f8efef74d542b33440462b720ecd40da0f10952))


- **Add vault-workflow.md — obsidian-git as sole sync layer** ([3975dfa](https://github.com/xtrm-dev/xtrm/commit/3975dfab520fd38c96547af3ef109302b2565636))

  Documents the recommended workflow for using docs/ as an Obsidian vault
  synced across machines via git only (no Syncthing). Covers first-time
  setup, plugin config (vault backup + auto pull intervals, commit format),
  daily workflow, conflict resolution, branching policy for big edits, and
  separation from the personal ~/second-mind/ vault.


- **Baseline .obsidian/ config copied from second-mind** ([73b8847](https://github.com/xtrm-dev/xtrm/commit/73b8847711b04d4f678e2ebf34bde61309d72e62))

  35 plugins + 10 themes + snippets + hotkeys + appearance pre-installed.
  Cleaned: 76 sync-conflict files, novel-word-count 60MB cache, livesync
  plugin (incompatible with obsidian-git), workspace.json. Net ~35MB.


- **Update vault-workflow.md — plugins now pre-installed via baseline** ([ebbb10a](https://github.com/xtrm-dev/xtrm/commit/ebbb10a932520d7a7a1e8c1050d2ad9e2733a332))


- **Vault sync + fix merge artifacts in docs (#1)** ([1f8d96e](https://github.com/xtrm-dev/xtrm/commit/1f8d96e85a5036fc29da633da1d247e49e4fa9e6))

  ## Summary
  - Fix triple-stacked YAML frontmatter in `console-product-contract.md` —
  merge artifact from an earlier Obsidian Git conflict resolution that
  left two duplicate frontmatter blocks prepended (one with junk numeric
  tags)
  - Delete `docs/conflict-files-obsidian-git.md` — Obsidian Git's
  temporary conflict marker file (the file itself says it auto-deletes
  before commit; it was left behind from the conflict episode)
  - Commit 36 Obsidian `update-time-on-edit` timestamp updates across docs

  ## Context
  Local `main` was 3 commits ahead of `origin/main`. `origin/main` still
  contained raw `<<<<<<< Updated upstream` conflict markers in
  `devops/devops-system.md` — these commits (already merged locally) fix
  that.

  ## Test plan
  - [ ] Verify `console-product-contract.md` has exactly one valid YAML
  frontmatter block
  - [ ] Verify `conflict-files-obsidian-git.md` is absent from the tree
  - [ ] Verify `devops/devops-system.md` on origin no longer contains
  conflict markers after merge

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  ---------


- **Phase C — full README + using-mcpq skill** ([55eda90](https://github.com/xtrm-dev/xtrm/commit/55eda9021349388851db0971d8f0ee63d361881d))

  - README.md: install, per-project setup, all 4 subcommands with examples,
    via semantics (host + docker:<container> with distroless caveat), typed-arg
    syntax, security (MCPQ_ALLOWED_HOSTS opt-in), telemetry format, exit codes,
    troubleshooting
  - skills/using-mcpq/SKILL.md: auto-trigger description for observability MCP
    CLI queries, discovery workflow (list-tools → describe → call), CLI surface,
    .mcpq.json schema, via modes, typed args, troubleshooting. ~125 lines.

  Closes coverage of xtrm-2m3.6 + xtrm-2m3.8.


- **Scaffold CHANGELOG.md (umbrella + per-package mcpq)** ([2a234ed](https://github.com/xtrm-dev/xtrm/commit/2a234edf8091d8125b2f6f4e514f218782701aa0))

  Follows the xtrm-tools convention: Keep a Changelog 1.0.0 + SemVer, root
  CHANGELOG.md aggregates repo-level changes and links to per-package
  CHANGELOG.md files for packages with their own release cadence
  (packages/mcpq is the first).

  Initial [Unreleased] section documents the xtrm-2m3 epic landing —
  mcpq Python CLI at packages/mcpq/, the using-mcpq skill, and the full
  test suite. Per-package mcpq changelog enumerates each phase with bead
  refs for traceability.


- **Agent observability access pattern + using-mcpq skill polish (#2)** ([ca7cdad](https://github.com/xtrm-dev/xtrm/commit/ca7cdad90a059c2f465ba343fd1e9bd36c2e85a9))

  ## Summary

  Adds `docs/devops/agent-observability-pattern.md` documenting the
  three-layer methodology that emerged from the mercury-infra rollout. The
  doc sits between
  [`mcp-sidecars-pattern.md`](https://github.com/xtrm-dev/xtrm/blob/main/docs/devops/mcp-sidecars-pattern.md)
  (image-deploy layer) and
  [`devops-system.md`](https://github.com/xtrm-dev/xtrm/blob/main/docs/devops/devops-system.md)
  (vision).

  Also lands the `using-mcpq` skill polish (description tightening,
  per-project verifier section, snapshot/eval workspace) from the earlier
  skill-creator iteration on `packages/mcpq/`.

  ## The three layers

  1. **mcpq CLI** — query MCP sidecars without paying per-session
  tool-schema cost (~18k tokens for one Grafana MCP); sidesteps host-port
  exposure for internal-only sidecars via `via: docker:<container>` proxy.
  2. **`.mcpq.json` walk-up at the product's parent dir** — one config for
  all sibling repos, no per-repo duplication, no symlink-into-squash
  hazard.
  3. **Live-query health skill** — three canonical PromQL queries through
  mcpq, classification table, service-skills routing — replaces a
  stale-by-design `SERVICE_HEALTH.md` cron mirror with the live SSOT
  (Prometheus).

  ## Why this doc exists

  The pattern landed by iterating against three local failures, in order:
  ".mcp.json wiring" → "per-repo `.mcpq.json`" → "walk-up + live-query
  skill". The recurring lesson — **don't design new access layers when the
  existing one already does the work** — was nearly missed in the
  mercury-infra refactor (a `SERVICE_HEALTH.md` cache + bespoke
  `mercury-ops` CLI were both sketched and rejected before landing the
  live-query skill). Capturing it here means the next product doesn't
  repeat the discovery.

  The doc includes:
  - 6-step adoption recipe for applying the methodology to other products
  - Anti-patterns section enumerating what this replaces and why
  - Pointers to the mcpq package, the Mercury reference instance (skill +
  verifier + ops doc), and related beads

  ## Reference instance


- **Vault rename docs→xtrm, add CLAUDE.md + memory bootstrap (#4)** ([d63c4ac](https://github.com/xtrm-dev/xtrm/commit/d63c4ac9e622df7ad5c4c847e79b852b032ce004))

  ## Summary
  - Renames the Obsidian vault directory from `docs/` to `xtrm/` to match
  the vault name
  - Adds `CLAUDE.md`, `TASKS.md`, and `dashboard.html` to the repo root
  - Bootstraps `memory/` with context, glossary, and project files
  (force-tracked despite gitignore)
  - Removes stale `docs/channels/channels.md` and `obsidian_askpass.sh`

  ## Test plan
  - [ ] Verify Obsidian vault opens correctly from `xtrm/`
  - [ ] Confirm `CLAUDE.md` loads as project instructions in Claude Code

  🤖 Generated with [Claude Code](https://claude.com/claude-code)


- **Update CLAUDE.md, TASKS.md, memory bootstrap (#5)** ([75995cc](https://github.com/xtrm-dev/xtrm/commit/75995ccba1bf7d3fa43654c2f84c55a7acc5f958))

  ## Summary
  - Updated `CLAUDE.md` and `TASKS.md`
  - Refreshed `memory/` bootstrap files (context, glossary, projects)

  🤖 Generated with [Claude Code](https://claude.com/claude-code)


- **Publish local design updates (#7)** ([d2d1690](https://github.com/xtrm-dev/xtrm/commit/d2d16907d195a45e3054ece59f0765e20712f760))

  ## Summary
  - publish local substrate/premortem/session report design commits
  - includes design reconciliation and roadmap housekeeping

  ## Notes
  - Direct push to main is blocked by branch protection, so this PR
  carries the 5 local commits ahead of origin/main.

  ---------


- **Add dependency bump policy** ([63a9cb8](https://github.com/xtrm-dev/xtrm/commit/63a9cb85587561a70a3d4805057537009f1079ff))


- **Apply bd auto-stage patch (xtrm-tools auto-applied)** ([d925b17](https://github.com/xtrm-dev/xtrm/commit/d925b17d9a32b4b8e661621fb74ec33cb542129c))


- **Add git-cliff config and changelog** ([8fabb93](https://github.com/xtrm-dev/xtrm/commit/8fabb937903076e952d30dcc555961428665c75c))

  Generic type-based parsers; repo-specific scopes to be tuned (see P0 bead).


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
