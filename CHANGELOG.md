
## [Unreleased]

### Added

- **Service-knowledge v0.1.0 — new xtrm package (PR0 lift-and-shift) [xtrm-56flm.6] (#13)** ([2d91be9](https://github.com/xtrm-dev/xtrm/commit/2d91be93be0c33b4d86237e044ce34cea74307d4)) — 2026-07-24 15:04

  PR0 of xtrm-56flm epic — new first-class xtrm package.

  Adds packages/service-knowledge/ (v0.1.0) with:
  - Own CLI (install/update/status/migrate/remove/telemetry) — NOT routed
  through xt update
  - All 11 machinery scripts moved from
  xtrm-dev/core/.claude/skills/service-skills/scripts/ (byte-copies;
  separate repos = cannot preserve git history)
  - Reference SKILLs, contracts (service_skill_contract.json v1.0.0),
  install hooks, MCP scaffold
  - Depends on vaultctl (declared) — used starting PR3

  Tag v0.1.0 pushed. Sibling PRs: xtrm-dev/core retirement,
  mercuryintelligence/infra migration (#247), xtrm-dev/specialists
  relocation (pending — escalated: commit landed on local master, needs
  operator judgment).


- **V0.2.0 — claim verifier foundations [xtrm-56flm.1] (#15)** ([93a3dc9](https://github.com/xtrm-dev/xtrm/commit/93a3dc9443e093b78dcfe5401c32d9ad2cdb53b3)) — 2026-07-24 17:24

  PR1 of the knowledge-base reframe. See commit message for module
  breakdown. Bumps v0.1.1 → v0.2.0. Bead: xtrm-56flm.1


- **V0.3.0 — per-repo FTS5 index + 3 MCP tools + cataloger reframe [xtrm-56flm.3] (#16)** ([d864562](https://github.com/xtrm-dev/xtrm/commit/d86456269b817bd8ab3ce732ace56849387668c9)) — 2026-07-24 19:17

  ## Summary
  - add vaultctl-backed per-repo SQLite FTS5 evidence index at
  `.xtrm/cache/service-knowledge.sqlite`
  - expose exactly 3 read-only MCP tools: `knowledge_search`,
  `knowledge_get`, `knowledge_evidence_for_files`
  - add interpretable T/L/I/A/F ranking, provenance, freshness, telemetry,
  cataloger/index-health reframe, umbrella provenance, CLI, post-merge
  rebuild, and docs
  - bump service-knowledge `0.2.0` → `0.3.0`

  ## Verification
  - 127 package tests pass
  - targeted Ruff passes for PR3 index/MCP/CLI/cataloger/umbrella/hook
  surfaces
  - security re-audit PASS: arbitrary-read and webhook-secret findings
  fixed
  - obligations scan CLEAN
  - net diff restricted to `packages/service-knowledge/**` and
  `docs/devops/**`

  ## Tracking
  Core bead `xtrm-56flm.3` remains IN_PROGRESS pending operator merge.
  Deferred follow-ups: `xtrm-56flm.3.1` (`knowledge_probes`) and
  `xtrm-56flm.3.2` (`knowledge_conflicts`).


- **V0.4.0 deterministic verifier gate [xtrm-56flm.2] (#17)** ([ac5bb56](https://github.com/xtrm-dev/xtrm/commit/ac5bb5644228020cacc38474f0b09b0f637acac1)) — 2026-07-24 19:57


- **V0.5.0 — dispatch integration + activator upgrade [xtrm-56flm.4] (#18)** ([621b73c](https://github.com/xtrm-dev/xtrm/commit/621b73c3ff2703d3f23083450262f4db0243d547)) — 2026-07-24 20:47

  ## Summary

  PR4 of the service-knowledge reframe (bead **xtrm-56flm.4**): the
  retrieval surface shipped in PR3 becomes *demanded* rather than passive.
  `skill_activator.py` no longer nags "please read SKILL.md" — on a
  territory match it invokes `knowledge_evidence_for_files` and injects
  the §3.2 evidence bundle straight into the PreToolUse context. Dispatch
  pipeline attaches the bundle to the bead body via a well-defined marker
  so downstream specialists see it in `bd show`. Contract-promotion gate
  refuses draft→ready when SCOPE touches a registered territory with no
  `matched_services` attached.

  Version bump: `0.4.0 → 0.5.0`.

  ## What's in the diff

  - **Activator behavior replaced**
  (`packages/service-knowledge/src/service_knowledge/scripts/skill_activator.py`)
  — matcher unchanged; injects evidence bundle instead of reminder; narrow
  §3.7 block matrix.
  - **New `service_knowledge.dispatch` module** — evidence-bundle →
  bead-body renderer with marker `<!-- knowledge:evidence:BUNDLE_ID
  -->…<!-- /knowledge:evidence -->`, promotion gate (`validate_promotion`
  + CLI `python3 -m service_knowledge.dispatch validate`), telemetry
  emitter.
  - **Block matrix**:
  - Read / Glob / Grep → evidence-inject, **never** block (even on broken
  index).
  - Write / Edit in registered territory → block **only** if retrieval
  fails.
    - Bash read-only → evidence-inject, don't block.
  - Bash mutating (`rm`/`mv`/`docker rm`/`systemctl`/`kubectl apply`/`gh
  pr merge` …) → bundle + conflict-check; block on conflicted high-risk
  claim.
    - PostToolUse → telemetry only, never blocks.
  - **Operator override**: `OVERRIDE_KNOWLEDGE_BUNDLE=1` proceeds with
  warning; override event recorded.
  - **Structured telemetry**: JSONL to
  `.xtrm/state/service-knowledge/events.jsonl` with
  `component=activator|dispatch|bead-validator`,
  `decision=inject|block|allow|override`, `override_reason?`,
  `duration_ms`.
  - **LOUD failure messages**: which service, which territory, which
  bundle expected, why retrieval failed — no silent skips.
  - **No session cache** (deferred per SCOPE — every PreToolUse
  re-fetches).
  - **No bd-schema change** — promotion gate is a regex-on-`bd show`
  wrapper; bd-tracking paths (`.beads/**`, `.xtrm/state`, `.xtrm/cache`)
  are exempt from blocks so the gate cannot lock itself out.

  ## Companion PR

  Specialist `task_template` update (task 8) lives on
  `xtrm-dev/specialists` branch
  `feature/xtrm-56flm.4.1-coordinator-evidence` (commit `09fd7047`) —
  separate PR.

  ## Test plan

  Pytest — 67/67 pass (`python3 -m pytest
  packages/service-knowledge/src/service_knowledge/dispatch/tests/`):

  - [x] Block-matrix unit tests: every (tool, territory-match,
  index-state) combination → expected decision
  - [x] Activator integration: PreToolUse on Write in registered territory
  → bundle injected
  - [x] Activator integration: PreToolUse on Write with broken index →
  block with actionable message
  - [x] Bead promotion: SCOPE touches registered territory + no
  `matched_services` → refused with reason
  - [x] Override path: `OVERRIDE_KNOWLEDGE_BUNDLE=1` + Write → warns,
  proceeds, override event in telemetry
  - [x] Regression: Read/Glob/Grep never block, even on broken index
  - [x] Regression: existing in-flight beads NOT retroactively refused on
  promotion

  ## Non-goals (deferred)

  - No session cache (measure latency first)
  - No bd schema change / no bd migration
  - No auto-remediation / no auto-merge behavior change (PR5)
  - No new MCP tools (PR3 shipped them; this PR only calls them)

  Bead **xtrm-56flm.4** stays open pending operator merge.


- **V0.6.0 — eval corpus + telemetry + alert-to-service [xtrm-56flm.5] (#19)** ([0d3b3f6](https://github.com/xtrm-dev/xtrm/commit/0d3b3f61b831342c0ed3e5db9f48d4728b540e41)) — 2026-07-24 22:07

  PR5a. Ships the measurement layer for the service-knowledge reframe.

  ## What lands

  - **85-case labeled corpus** at
  `packages/service-knowledge/src/service_knowledge/eval/corpus/`
  including the 3 mandated api-gateway regression anchors (invented
  redaction key set, wrong redaction literal, mislabeled
  `http_request_duration_seconds` label set). Sourced from real closed
  `bd` issues + merged PRs across `~/dev/core` and `~/dev/xtrm`, plus a
  small synthetic-alert tail. Every case has the 8-field §3.9 schema +
  `expected_verifier` + non-empty `provenance`.
  - **`service_knowledge.eval.metrics`** — the 12 §3.9 metrics as pure
  functions; `THRESHOLDS` map drives the report's green/yellow/red status
  column.
  - **`service_knowledge.eval.harness`** — CLI: `python -m
  service_knowledge.eval.harness run --corpus <dir> --output-dir <dir>`.
  Loads corpus, calls shipped retrieval + verifier (labels-echo stub
  fallback when live index absent — keeps CI runnable without a warm
  index), emits `YYYY-WW.md`. Emits `component=eval-harness` telemetry
  lines (one per run + one per metric).
  - **`service_knowledge.mcp.incident_routing`** — thin advisory-only
  Alertmanager-payload → `knowledge_search` → top-K services + probes
  bundle. No mutations.
  - **`.github/workflows/eval-weekly.yml`** — cron (Mon 06:00 UTC) +
  `workflow_dispatch`. Uploads report artifact + sticky-comments summary
  on the tracking issue "service-knowledge eval baseline — weekly reports"
  (auto-created on first run).
  - **`install/git-hooks/post_merge_reindex.py`** — post-merge
  default-branch reindex (60s target, 90s cap). Silent no-op off default
  branch, when no registry present, or when CLI missing. Never fails the
  merge.
  - **Verifier telemetry side-channel**: `scripts/verifier/telemetry.py`
  now also writes the per-run record to
  `.xtrm/state/service-knowledge/events.jsonl` (`component=verifier`)
  matching the emission surfaces of PR3 (`knowledge-index`) and PR4
  (`activator`). No raw claim text, no source content — only claim_id
  aggregates + content hashes.
  - **Six new pytest modules** covering: corpus schema (≥30 case floor +
  provenance), harness E2E (report has all metrics), regression anchors (3
  anchor cases present + verifier catches api-gateway fixture), baseline
  thresholds (routing precision ≥ 0.80, retrieval precision@5 ≥ 0.60,
  stale escape ≤ 0.05, verifier FP ≤ 0.05, FN ≤ 0.10), incident routing
  smoke, telemetry-shape/PII checks.

  Bumps `VERSION` 0.5.0 → 0.6.0.

  ## Out of scope by design

  - Canary auto-merge policy → PR5b (bead `xtrm-56flm.7`).
  - Verifier claim-type additions → PR1 follow-up, not driven yet.
  - Cross-repo aggregation switch → follow-up if metrics demand it.

  ## Test plan

  - `pytest packages/service-knowledge/` — 238 passing locally (including
  the 11 new eval tests).
  - Harness smoke: `python -m service_knowledge.eval.harness run --corpus
  … --output-dir …` produced `2026-Wxx.md` with all 12 metric rows,
  threshold statuses, and telemetry lines in `events.jsonl`.
  - Verifier telemetry: env `SERVICE_KNOWLEDGE_CONSUMER_ROOT=<tmp>`
  produces a `component=verifier`/`event=run` line alongside the
  pre-existing stderr line.
  - Weekly workflow: needs a `workflow_dispatch` run to establish the real
  baseline once a warm index is available in CI.

  ## Bead

  `xtrm-56flm.5` — stays OPEN pending operator merge.


- **V0.7.0 — canary policy + gated auto-merge switch [xtrm-56flm.7] (#20)** ([d7d4e22](https://github.com/xtrm-dev/xtrm/commit/d7d4e226fa4535048e3057d959dc2f466070adf7)) — 2026-07-25 10:23

  PR5b. Ships the canary policy doc + mechanism to enable per-class
  auto-merge, without enabling it. v1.0.0 reserved for the
  operator-authorized enable moment. See commit for module breakdown.
  Bead: xtrm-56flm.7


- **PR-checkpoint Board-Audit handoffs [xtrm-5t7]** — PR number and commit SHA added on merge

  Adds per-PR Board-Audit evidence handoffs bound to an exact remote PR head:
  - `board-audit pr-checkpoint <PR>` publishes a per-Bead read projection to
    transport branch `board-audit/pr-<n>` from one canonical `bd export --all`
    in an isolated Beads-managed worktree; the caller's checkout never switches
  - `board-audit pr-status <PR>` reports FRESH / STALE_CODE_HEAD /
    STALE_SNAPSHOT / NO_HANDOFF; `--check` exits 3 when not FRESH
  - content-derived snapshot ids; unchanged records keep identical canonical
    hashes and are never rewritten; NO_CHANGES checkpoints add no transport
    commit
  - publishes the bounded root/work-package handoff (existing exporter, single
    acquisition via --from-raw) plus per-root prepared editable artifacts, so
    the existing edit → reconcile → execute round trip resolves off the PR
    transport branch
  - confidentiality gate: automated publication fails closed unless the
    repository is listed in BOARD_AUDIT_PR_AUTHORIZED_REPOS
  - `board-audit-pr-adapter.sh` event adapter (client pre-push hook /
    self-hosted PR-event executor / manual)
  - `--comment` posts the compact locator as a PR comment; docs in
    README.md/ROUNDTRIP.md; unit tests


### Fixed

- **V0.1.1 — 5 P1 Codex findings post-#13 merge (#14)** ([4cd724b](https://github.com/xtrm-dev/xtrm/commit/4cd724b645298399d92bab2a196031d716146759)) — 2026-07-24 15:07

  Fast-follow to #13. Resolves 5 P1 Codex findings the PR shipped with.
  All are shipping bugs (crashes/wrong paths/missing dep) that would hit
  any consumer running install/scaffold/migrate.

  Details in commit message. Bumps v0.1.0 → v0.1.1.


- **Install.sh vaultctl dep resolution (#25)** ([59ac519](https://github.com/xtrm-dev/xtrm/commit/59ac5194a063d0706112878fd1ca03f290308ded)) — 2026-07-25 13:15

  `./install.sh` failed with `No matching distribution found for
  vaultctl<0.2,>=0.1.0`. Root cause: pyproject.toml declared `vaultctl` as
  a PyPI dependency, but it lives in a sibling local repo and is NOT
  published to PyPI. pipx tried to resolve it during initial install,
  before the subsequent `pipx inject --editable` step could add it.

  **Fix**
  - Drop `vaultctl` from pyproject.toml `dependencies`. Documented in the
  comment: install.sh is the supported path; manual pipx users get a
  snippet to inject vaultctl editably.
  - Clean up install.sh comment to reflect the new reality.

  **Smoke test** (fresh Debian 13, pipx from apt)
  ```
  $ ./install.sh
  ==> installing service-knowledge (editable) via pipx
    installed package service-knowledge 0.7.0
  ==> injecting vaultctl (editable) into the service-knowledge venv
    injected package vaultctl into venv service-knowledge
  ==> installed: service-knowledge 0.7.0

  $ service-knowledge --version
  service-knowledge 0.7.0

  $ service-knowledge help topics
  Available help topics: …
  ```


### Project maintenance

- **Rich CLI help surface + install.sh + README rewrite (#21)** ([82cce27](https://github.com/xtrm-dev/xtrm/commit/82cce272ae255a6b219d6738b131bcae5d1779a0)) — 2026-07-25 12:05

  ## Summary

  Ships a proper help surface for the standalone \`service-knowledge\`
  CLI, plus the installer + README rewrite the v0.7.0 branch auto-saved.

  **CLI help surface** (new)

  - \`service-knowledge --help\` — top-level epilog with common workflows
  and pointer to concept help
  - Every subcommand \`--help\` — argparse epilog with description + 2-3
  examples (\`install\`/\`update\`/\`status\`/\`migrate\`/\`remove\` and
  the nested \`index\`/\`canary\` actions)
  - **New \`service-knowledge help <topic>\` subcommand** — 10 concept
  explainers (workflow · install · bootstrap · index · verifier · mcp ·
  activator · eval · canary · telemetry). \`help topics\` (or bare
  \`help\`) lists them; unknown topic errors with the index to stderr,
  exit 2

  All content in the new \`cli/_help.py\` module. Stdlib argparse only, no
  new deps.

  **Installer** (was auto-saved on the v0.7.0 branch)

  \`install.sh\` at package root — pipx-based one-command installer,
  editable, \`--system-pipx\` bootstraps pipx via apt.

  **README rewrite** (was auto-saved on the v0.7.0 branch)

  Full rewrite to cover the v0.7.0 surface: verifier + FTS5 index + MCP
  tools + activator + eval harness + canary + telemetry. Old README was
  v0.1.0-era.

  ## Test plan
  - [x] All help paths smoke-tested locally on the mercury-infra reference
  install
  - [x] \`./install.sh\` smoke-installed with pipx; \`service-knowledge
  --version\` returns 0.7.0 after

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  ---------


- **Restore pre-session orchestrator worktree state (#22)** ([6330413](https://github.com/xtrm-dev/xtrm/commit/6330413d9e34fdf083a3d1ce23e9bfe1e9ab7c55)) — 2026-07-25 12:12

  Restores tooling scaffolding (`.agents/`, `.claude/hooks/`,
  `.claude/settings.json`, `.claude/skills` symlink, `.codex/`,
  `.mcp.json`, `AGENTS.md`, `CLAUDE.md`, `.gitignore` updates) that
  pre-existed on the xtrm worktree before the service-knowledge CLI-help
  session but hadn't been committed. Merged from two overlapping stashes
  (`pre-session-xtrm-worktree-dirty-2026-07-25` and
  `pre-2m3-orchestrator-state-from-session-start`).


- **Adapt machinery skills to v0.4-v0.7 substrate (#23)** ([d19d0d6](https://github.com/xtrm-dev/xtrm/commit/d19d0d61201e304d6033807902a39d38fe0f5fef)) — 2026-07-25 12:40

  ## Summary

  The reference SKILLs under
  \`packages/service-knowledge/src/service_knowledge/skills/\` still
  described the pre-reframe flow — sync brings them in line with the
  shipped v0.4–v0.7 machinery (verifier gate, FTS5 evidence index, MCP
  tools, narrow-blocking activator, canary policy) and sweeps residual
  \`service-skills\` path references left over from before the package
  rename.

  **Content additions** (per file)

  - **SKILL.md** (router): new \"Evidence-First Retrieval\" (T/L/I/A/F
  ranking, CLI + 3 MCP tools) and \"Verifier Gate\" sections; rewritten
  \"Installation\" for host-level (\`install.sh\` + pipx) and per-repo
  layers; rewritten naming-note explaining the package-renamed /
  slash-commands-kept split
  - **creating.md**: new \"Before You Scaffold — Territory-Overlap Check\"
  (uses \`knowledge_evidence_for_files\` / \`index query --paths\`); Phase
  3 renamed \"Finalize\" with 4 ordered steps: A. Rebuild FTS5 index, B.
  Verifier smoke on fresh SKILL, C. Hook, D. Communicate
  - **updating.md**: new Step 5 (verifier gate — reconcile.py refuses to
  write on blocking verdicts) + Step 6 (rebuild index so retrieval +
  activator see updates)
  - **using.md**: new \"Search Evidence, Not Just Titles\" section between
  \"Activate an Expert\" and \"Navigate with the Graph\"
  - **system-guide.md**: short \"what changed in v0.4-v0.7\" callout
  separating authoring loop from serving loop

  **Text sweep** — sedded stale paths and self-refs:
  - \`.claude/skills/service-skills/scripts/\` →
  \`.xtrm/skills/default/service-knowledge/scripts/\`
  - Umbrella umbrella path, install script name, drift-pending marker,
  migrator path, contracts path
  - Descriptive \"service-skills router / installer / system\" →
  \"service-knowledge …\"

  **Deliberately kept** — slash-command muscle memory
  (\`/service-skills\`, \`/creating-service-skills\`,
  \`/using-service-skills\`, \`/updating-service-skills\`) and the
  SKILL.md \`name:\` frontmatter so existing invocations don't break.

  ## Test plan
  - [x] All shipped machinery referenced in the diff verified to exist
  (\`service-knowledge index/canary/help\` subcommands,
  \`service_knowledge.scripts.verifier/reconcile\`, three MCP tools)
  - [x] \`grep -c service-skills\` on the 5 flow files drops to
  slash-command / frontmatter residue only (which we keep intentionally)
  - [x] Diff scope confined to
  \`packages/service-knowledge/src/service_knowledge/skills/*.md\`

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  ---------


- **Rename slash commands to /service-knowledge (#24)** ([aeae776](https://github.com/xtrm-dev/xtrm/commit/aeae77622c40cc077cc89cae60743db01d9dab96)) — 2026-07-25 13:00

  Completes the package rename. The half-rename (`service-knowledge`
  package, `/service-skills` invocations) was documented as "muscle memory
  preservation" but reads as inconsistency. Full rename now.

  - Frontmatter `name: service-skills` → `service-knowledge`
  - Description trigger list updated
  - 5 flow files: `/service-skills` → `/service-knowledge`,
  `/creating-service-skills` → `/creating-service-knowledge`, `/using-...`
  → `/using-...`, `/updating-...` → `/updating-...`
  - Removed the "Naming note" block from SKILL.md (no longer applicable)
  - `service-skills-sync specialist` → `service-knowledge-sync specialist`
  (paired with xtrm-dev/specialists PR)

  ---------


- **Sweep service-skills → service-knowledge in arch prose (#26)** ([4b4ce12](https://github.com/xtrm-dev/xtrm/commit/4b4ce124b39fc1c4cc1b87bf41c07dac7a41febb)) — 2026-07-25 14:34

  Post-rename cleanup for the two Italian devops architecture docs
  (`docs/devops/devops-system.md` + `dependencies-updating.md`) that still
  carried pre-reframe references to the package name and the pre-rename
  `service-skills-sync` specialist.

  Purely textual — no diagrams / config / code touched. Rename order was
  `-sync` first then bare `-skills` so the sync-suffix wasn't clobbered
  mid-token.

  ---------



## [Unreleased]

### Added

- **Phase A — protocol client, via-mode dispatch, .mcpq.json discovery** ([e9c483f](https://github.com/xtrm-dev/xtrm/commit/e9c483f81d71f0a490eed0dbca26949e9ca09514)) — 2026-06-10 01:59

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


- **Phase B — list-tools, describe, call subcommands with typed args** ([5967a9d](https://github.com/xtrm-dev/xtrm/commit/5967a9db7686f1ea871d78394056a0af4611ca4b)) — 2026-06-10 02:46

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


- **Phase D — tests + cli OP-required fix** ([618f737](https://github.com/xtrm-dev/xtrm/commit/618f7373343c17c9f4493983450967f044dedd0f)) — 2026-06-10 02:58

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

- **Add DevOps specialist research synthesis** ([608e32a](https://github.com/xtrm-dev/xtrm/commit/608e32a109f954116343f8735a5503dd1af9ef43)) — 2026-05-30 10:23


- **Translate DevOps research and expand Terraform guide** ([2a96a0c](https://github.com/xtrm-dev/xtrm/commit/2a96a0c54aa23c40311c143f124bd0fcb438d4da)) — 2026-05-30 11:31


- **Add Terraform first steps note** ([9f7a9e0](https://github.com/xtrm-dev/xtrm/commit/9f7a9e0ce50aaf2ebcb0e32b01ae9962678afa53)) — 2026-05-31 02:15


- **Add infra Terraform fit notes** ([314b99b](https://github.com/xtrm-dev/xtrm/commit/314b99bd892adb915ee2836352d7f89e944bc846)) — 2026-05-31 02:19


- **Clarify infra MCP and metrics coverage** ([6dfc1e0](https://github.com/xtrm-dev/xtrm/commit/6dfc1e02ff926708c6e626f86196dccb8c98cf05)) — 2026-05-31 09:39


- **Add DevOps telemetry research notes** ([ef8fcc7](https://github.com/xtrm-dev/xtrm/commit/ef8fcc70cd07be68bf6f05b569aa15cb94195080)) — 2026-05-31 10:37


- **Add AWS official docs research** ([9600d52](https://github.com/xtrm-dev/xtrm/commit/9600d521ec6c219ca10f604c367ac4b518959d73)) — 2026-05-31 13:40


- **1-projects/xtrm baseline pre-modifiche** ([21f1935](https://github.com/xtrm-dev/xtrm/commit/21f193516f170e6756c74fdac1fea19cb6ba082c)) — 2026-06-06 20:12

  Cattura stato corrente: nuovi file channels, substrate, telemetry,
  specialists; archivio devops research; console e devjournal aggiornati.


- **Rename channels.html.md to channels.html** ([8656970](https://github.com/xtrm-dev/xtrm/commit/8656970b0ca5b38f013b935dc07ec20677c46f9b)) — 2026-06-06 21:48


- **Added console architecture docs** ([ce8c3e4](https://github.com/xtrm-dev/xtrm/commit/ce8c3e4e967c003f681e2e7124dad3d494de7774)) — 2026-06-07 02:08


- **Vault backup: 2026-06-07 07:36:08** ([5a8a82f](https://github.com/xtrm-dev/xtrm/commit/5a8a82f7779c920ba0f511c86989e91ef9eeef3f)) — 2026-06-07 05:36


- **2026-06-07 04:53:50 (1 files)** ([31d43d7](https://github.com/xtrm-dev/xtrm/commit/31d43d7619609c8a41f695c8e29e8bf43df22988)) — 2026-06-07 02:53


- **2026-06-07 05:03:52 (1 files)** ([0244aca](https://github.com/xtrm-dev/xtrm/commit/0244acad230f71632f7b5bd92cc763ab6f027145)) — 2026-06-07 03:03


- **2026-06-07 07:03:50 (1 files)** ([a1346fb](https://github.com/xtrm-dev/xtrm/commit/a1346fb9a05e18b334c3d0d47a02fd6dfb03940c)) — 2026-06-07 05:03


- **2026-06-07 07:13:59 (1 files)** ([78d6bd1](https://github.com/xtrm-dev/xtrm/commit/78d6bd14ce6865a3014b0fd175acb2cf08277921)) — 2026-06-07 05:13


- **2026-06-07 07:24:50 (1 files)** ([72bf2ce](https://github.com/xtrm-dev/xtrm/commit/72bf2ce8079a15107788c8490cff0456e34b7e9a)) — 2026-06-07 05:24


- **2026-06-07 07:35:50 (6 files)** ([b610985](https://github.com/xtrm-dev/xtrm/commit/b61098514ce2d7c9cf7ea9eaa027711671f3a74b)) — 2026-06-07 05:35


- **Vault backup: 2026-06-07 07:37:36** ([3c79980](https://github.com/xtrm-dev/xtrm/commit/3c79980318e113135c53ed0d4817503a2534933c)) — 2026-06-07 05:37


- **2026-06-07 07:46:52 (1 files)** ([2277c90](https://github.com/xtrm-dev/xtrm/commit/2277c90b55f51e4af052ea02b1095a60f4d855d8)) — 2026-06-07 05:46


- **2026-06-07 09:14:20 (1 files)** ([ebe06b3](https://github.com/xtrm-dev/xtrm/commit/ebe06b34540ef432612f127eec8f6616c3f1e023)) — 2026-06-07 07:14


- **2026-06-07 09:57:50 (1 files)** ([b9250b9](https://github.com/xtrm-dev/xtrm/commit/b9250b9bfd09daf675acac2634f5286ce29b70eb)) — 2026-06-07 07:57


- **2026-06-07 10:19:50 (1 files)** ([b3ccbe9](https://github.com/xtrm-dev/xtrm/commit/b3ccbe9d4fc0122d4ae2929443151d2889aecd89)) — 2026-06-07 08:19


- **2026-06-07 11:25:51 (1 files)** ([903fe3f](https://github.com/xtrm-dev/xtrm/commit/903fe3f4e6f640fc83656fa9d31f7b74108fee4e)) — 2026-06-07 09:25


- **2026-06-07 11:57:25 (2 files)** ([7f8de46](https://github.com/xtrm-dev/xtrm/commit/7f8de46e7a51d565760fe1c724ea4e380b030870)) — 2026-06-07 09:57


- **Added channels enhancements to verify** ([e6f6319](https://github.com/xtrm-dev/xtrm/commit/e6f631948bfb113551b46b41a6e02c516460eb1c)) — 2026-06-08 22:31


- **2026-06-10 02:44:08 (1 files)** ([a362f1f](https://github.com/xtrm-dev/xtrm/commit/a362f1f045582ee5805a11467a3c4c6482fc7e6c)) — 2026-06-10 00:44


- **Merge xtrm-2m3.10: Phase A — mcpq foundation (protocol client + via-mode dispatch + .mcpq.json)** ([2ac44b4](https://github.com/xtrm-dev/xtrm/commit/2ac44b4b91958b02d2d6d8384162b206b909a54e)) — 2026-06-10 02:19


- **Merge xtrm-2m3.17: Phase B — mcpq CLI subcommands (list-tools, describe, call)** ([3615e5c](https://github.com/xtrm-dev/xtrm/commit/3615e5c59a4fc7478ed017d6ea9fb64487672d36)) — 2026-06-10 02:49


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

Co-authored-by: dawid <dawid@v2202602340735437128.quicksrv.de>** ([e02b9b6](https://github.com/xtrm-dev/xtrm/commit/e02b9b66fa677b7ba216a7b5fc1a3828281e726d)) — 2026-06-11 00:40


- **Apply 2026-06-11 audit (visibility/cursor/outcome/evidence/swap/forensic; §12 resolutions + residuals; Design Lineage); revert docs→xtrm rename (#6)** ([efb644a](https://github.com/xtrm-dev/xtrm/commit/efb644a72b1a9ed4bf99dea94884262377a9495a)) — 2026-06-11 07:23

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

🤖 If generated with Claude Code, leave the trailer in commits.** ([9824715](https://github.com/xtrm-dev/xtrm/commit/982471580d860e7264f42857b90e75975fefaef2)) — 2026-06-28 10:20


### Project maintenance

- **Add console product contract** ([5f62d8a](https://github.com/xtrm-dev/xtrm/commit/5f62d8aa4a33b78a14aeca87bb63e88dea707191)) — 2026-06-02 12:13


- **Finalize console product contract** ([77bcdb7](https://github.com/xtrm-dev/xtrm/commit/77bcdb7dfa33973688d40ed14526fd5ebe51f8bf)) — 2026-06-02 12:30


- **Persist 2026-06-06 session edits + clean Syncthing conflicts** ([3ce8549](https://github.com/xtrm-dev/xtrm/commit/3ce85497df0e82610a25445dabf9eb8e17fd7680)) — 2026-06-06 21:35

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


- **Relocate vault content under docs/** ([c7f6893](https://github.com/xtrm-dev/xtrm/commit/c7f68933ccaafc907b7f152efbdd4ee98650f0ad)) — 2026-06-06 21:37

  All markdown moved into docs/ to match monorepo layout. Packages/ and apps/
  scaffolding added in the next commit.


- **Scaffold monorepo (packages/, apps/, README, .gitignore, LICENSE)** ([12bf46c](https://github.com/xtrm-dev/xtrm/commit/12bf46c897c3f2eac630fb747096fa04cd828058)) — 2026-06-06 21:39

  - README.md: umbrella overview + package ownership table + docs map
  - .gitignore: node/pnpm/build/agent-runtime/syncthing patterns
  - LICENSE: proprietary closed-source notice
  - packages/.gitkeep, apps/.gitkeep: placeholder dirs for graft targets


- **Collaborator-ready scaffolding** ([75f8b1a](https://github.com/xtrm-dev/xtrm/commit/75f8b1aa5b695df29c8ad4d48f7646ce5c75af1e)) — 2026-06-06 21:59

  - .github/dependabot.yml: weekly GH Actions + npm bumps, grouped
  - .github/CODEOWNERS: default ownership rules (per-package owners TBD)
  - .github/pull_request_template.md: scope + bead/Jira link + validation
  - .github/ISSUE_TEMPLATE/{bug_report,feature_request,config.yml}
  - SECURITY.md: private-disclosure policy


- **Add CONTRIBUTING.md + link from README** ([5f8efef](https://github.com/xtrm-dev/xtrm/commit/5f8efef74d542b33440462b720ecd40da0f10952)) — 2026-06-06 22:14


- **Add vault-workflow.md — obsidian-git as sole sync layer** ([3975dfa](https://github.com/xtrm-dev/xtrm/commit/3975dfab520fd38c96547af3ef109302b2565636)) — 2026-06-06 23:27

  Documents the recommended workflow for using docs/ as an Obsidian vault
  synced across machines via git only (no Syncthing). Covers first-time
  setup, plugin config (vault backup + auto pull intervals, commit format),
  daily workflow, conflict resolution, branching policy for big edits, and
  separation from the personal ~/second-mind/ vault.


- **Baseline .obsidian/ config copied from second-mind** ([73b8847](https://github.com/xtrm-dev/xtrm/commit/73b8847711b04d4f678e2ebf34bde61309d72e62)) — 2026-06-07 00:13

  35 plugins + 10 themes + snippets + hotkeys + appearance pre-installed.
  Cleaned: 76 sync-conflict files, novel-word-count 60MB cache, livesync
  plugin (incompatible with obsidian-git), workspace.json. Net ~35MB.


- **Update vault-workflow.md — plugins now pre-installed via baseline** ([ebbb10a](https://github.com/xtrm-dev/xtrm/commit/ebbb10a932520d7a7a1e8c1050d2ad9e2733a332)) — 2026-06-07 00:14


- **Vault sync + fix merge artifacts in docs (#1)** ([1f8d96e](https://github.com/xtrm-dev/xtrm/commit/1f8d96e85a5036fc29da633da1d247e49e4fa9e6)) — 2026-06-10 00:21

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


- **Phase C — full README + using-mcpq skill** ([55eda90](https://github.com/xtrm-dev/xtrm/commit/55eda9021349388851db0971d8f0ee63d361881d)) — 2026-06-10 02:53

  - README.md: install, per-project setup, all 4 subcommands with examples,
    via semantics (host + docker:<container> with distroless caveat), typed-arg
    syntax, security (MCPQ_ALLOWED_HOSTS opt-in), telemetry format, exit codes,
    troubleshooting
  - skills/using-mcpq/SKILL.md: auto-trigger description for observability MCP
    CLI queries, discovery workflow (list-tools → describe → call), CLI surface,
    .mcpq.json schema, via modes, typed args, troubleshooting. ~125 lines.

  Closes coverage of xtrm-2m3.6 + xtrm-2m3.8.


- **Scaffold CHANGELOG.md (umbrella + per-package mcpq)** ([2a234ed](https://github.com/xtrm-dev/xtrm/commit/2a234edf8091d8125b2f6f4e514f218782701aa0)) — 2026-06-10 10:24

  Follows the xtrm-tools convention: Keep a Changelog 1.0.0 + SemVer, root
  CHANGELOG.md aggregates repo-level changes and links to per-package
  CHANGELOG.md files for packages with their own release cadence
  (packages/mcpq is the first).

  Initial [Unreleased] section documents the xtrm-2m3 epic landing —
  mcpq Python CLI at packages/mcpq/, the using-mcpq skill, and the full
  test suite. Per-package mcpq changelog enumerates each phase with bead
  refs for traceability.


- **Agent observability access pattern + using-mcpq skill polish (#2)** ([ca7cdad](https://github.com/xtrm-dev/xtrm/commit/ca7cdad90a059c2f465ba343fd1e9bd36c2e85a9)) — 2026-06-10 16:03

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


- **Vault rename docs→xtrm, add CLAUDE.md + memory bootstrap (#4)** ([d63c4ac](https://github.com/xtrm-dev/xtrm/commit/d63c4ac9e622df7ad5c4c847e79b852b032ce004)) — 2026-06-11 03:35

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


- **Update CLAUDE.md, TASKS.md, memory bootstrap (#5)** ([75995cc](https://github.com/xtrm-dev/xtrm/commit/75995ccba1bf7d3fa43654c2f84c55a7acc5f958)) — 2026-06-11 04:17

  ## Summary
  - Updated `CLAUDE.md` and `TASKS.md`
  - Refreshed `memory/` bootstrap files (context, glossary, projects)

  🤖 Generated with [Claude Code](https://claude.com/claude-code)


- **Publish local design updates (#7)** ([d2d1690](https://github.com/xtrm-dev/xtrm/commit/d2d16907d195a45e3054ece59f0765e20712f760)) — 2026-06-22 22:08

  ## Summary
  - publish local substrate/premortem/session report design commits
  - includes design reconciliation and roadmap housekeeping

  ## Notes
  - Direct push to main is blocked by branch protection, so this PR
  carries the 5 local commits ahead of origin/main.

  ---------


- **Add dependency bump policy** ([63a9cb8](https://github.com/xtrm-dev/xtrm/commit/63a9cb85587561a70a3d4805057537009f1079ff)) — 2026-06-23 14:10


- **Apply bd auto-stage patch (xtrm-tools auto-applied)** ([d925b17](https://github.com/xtrm-dev/xtrm/commit/d925b17d9a32b4b8e661621fb74ec33cb542129c)) — 2026-07-13 06:02


- **Add git-cliff config and changelog** ([861f426](https://github.com/xtrm-dev/xtrm/commit/861f4267f5ad7c4b3e1bfa4ee3735b7167cae441)) — 2026-07-14 00:55

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
