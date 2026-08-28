"""Rich help content — epilogs per subcommand + `help <topic>` explainers.

Kept in one module so every CLI file gets its examples from the same place and
the top-level `help` command can enumerate the topic set. Stdlib-only.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Per-subcommand epilogs — argparse renders these under the options list.
# Use dedented text and RawDescriptionHelpFormatter to preserve line breaks.
# ---------------------------------------------------------------------------

EPILOGS: dict[str, str] = {
    "install": """\
Wires machinery into a consumer repo: vendors the reference SKILLs into
`.xtrm/skills/<pack>/service-knowledge/`, installs the Claude hooks
(SessionStart catalog · PreToolUse activator · PostToolUse drift), and builds
the initial FTS5 evidence index. Idempotent — safe to re-run after upgrading
the package.

Examples:
  service-knowledge install                    # bootstrap the current repo
  service-knowledge install --path ~/my/repo   # bootstrap a specific repo

Runs `git rev-parse --show-toplevel` when --path is omitted.
""",
    "update": """\
Pulls the currently-installed package version into the consumer's vendored
copy. No-op when the two versions already match. Use after upgrading the
package (git pull in the source tree or a fresh `install.sh`).

Examples:
  service-knowledge update                     # sync the current repo
  service-knowledge update --path ~/my/repo    # sync a specific repo

See also: `service-knowledge status` to check drift without applying.
""",
    "status": """\
Reports install state for a consumer: package version, installed version,
machinery directory, FTS5 cache presence, umbrella pack summary, and the
pending-drift marker state (both marker names recognized; canonical wins).
Read-only.

Examples:
  service-knowledge status
  service-knowledge status --path ~/my/repo
""",
    "drift": """\
Detects service-knowledge drift: scans each service's territory for files
changed since its last sync (`last_sync_ref` -> HEAD semantics) and, on drift,
writes a pending marker at `.xtrm/.service-knowledge-drift-pending` with a
per-service inventory. The legacy `.xtrm/.service-skills-drift-pending` name is
recognized too (canonical wins when both exist); `clear` removes whichever is
present. Read-only except for the marker under `<root>/.xtrm/`.

Examples:
  service-knowledge drift                    # scan + write marker if drifted
  service-knowledge drift clear              # remove the pending marker(s)

Reconcile stays skill-driven: run /updating-service-knowledge (the
service-knowledge-sync specialist), which syncs the drifted SKILL.md and
stamps `last_sync_ref`. After a successful reconcile the marker is removed and
the FTS5 evidence index is rebuilt.
""",
    "migrate": """\
One-time rename of the legacy `service-skills` umbrella to `service-knowledge`.
Detects the old layout under `.xtrm/skills/*/service-skills/` and moves it to
`service-knowledge/` in place. Safe on already-migrated repos.

Examples:
  service-knowledge migrate
  service-knowledge migrate --path ~/my/repo
""",
    "remove": """\
Removes machinery, the FTS5 cache, and the hooks — but KEEPS the per-service
knowledge itself (the actual SKILL.md files under
`.xtrm/skills/<pack>/service-knowledge/services/`). To clean those too, delete
the directory manually after `remove`.

Examples:
  service-knowledge remove                     # uninstall from current repo
  service-knowledge remove --path ~/my/repo
""",
}

# Nested `index` subactions
EPILOGS_INDEX = {
    "root": """\
The per-repo FTS5 evidence index at `.xtrm/cache/service-knowledge.sqlite`.
Ranking: 0.40·T + 0.30·L + 0.15·I + 0.10·A + 0.05·F
         (territory · BM25 lexical · intent · authority · freshness).
Sub-10ms queries on the reference corpus (17 services, ~230 items).

Actions:
  build / rebuild  Full rebuild — run after `install`, after skill edits, or
                   after a service add.
  query <text>     Free-text retrieval. Add --paths to bias by territory,
                   --service-id to restrict, --bundle for the §3.2 evidence
                   bundle (routing + citations + verification + probes).
  stats            Item counts + last source_ref (git SHA the index reflects).

Examples:
  service-knowledge index build
  service-knowledge index query "alertmanager routing telegram"
  service-knowledge index query "TLS renewal" --paths traefik/dynamic/certs.yml
  service-knowledge index query "backup freshness" --service-id backup --bundle
  service-knowledge index stats
""",
    "build": """\
Rebuilds the FTS5 index from every registered service SKILL.md.
Reports item / section / claim / probe / citation counts and the source_ref
(the git SHA the index reflects). Same as `rebuild`.

Examples:
  service-knowledge index build
  service-knowledge index build --path ~/my/repo
""",
    "rebuild": """\
Alias for `build`.

Examples:
  service-knowledge index rebuild
""",
    "query": """\
Read-only retrieval. Returns ranked evidence rows with metadata (territory,
triggers, source_path, source_ref, authority, status, risk, verification).

Positional:
  query            Free-text query (alert name, metric, error, concept, path).

Options:
  --service-id     Restrict/boost to a specific service id.
  --paths          Comma-separated file paths — biases by territory.
  --limit          Max results (default 7).
  --bundle         Return a §3.2 evidence bundle (routing + citations +
                   verification + conflicts + probes + skill_links +
                   token_estimate) instead of raw rows. Match the MCP-tool shape.

Examples:
  service-knowledge index query "prometheus alert rule"
  service-knowledge index query "TLS renewal failing" --limit 3
  service-knowledge index query "postgres connection pool" --paths db/postgres.conf
  service-knowledge index query "questdb candle freshness" --service-id market-data --bundle
""",
    "stats": """\
Emits index_state (source_ref + hash + build timestamp), item counts by kind
(service / section / claim / probe / citation), and retrieval_events since
last build.

Examples:
  service-knowledge index stats
""",
}

# Nested `canary` subactions
EPILOGS_CANARY = {
    "root": """\
The auto-merge canary is the switch that lets deterministically-verified
low-risk claim edits reconcile-merge without human review. Disabled by
default. Version 1.0.0 of the package is reserved for the enable moment.

Enable gates (ALL must hold):
  observation_window_days_min = 30       # runs in the wild before enable
  verifier_runs_min           = 200      # sample size floor
  verifier_fp_max             = 0.02     # measured false-positive rate ceiling
  verifier_fn_max             = 0.05     # measured false-negative rate ceiling

State: .xtrm/state/service-knowledge/canary.json
Metrics: aggregated from .xtrm/state/service-knowledge/events.jsonl

Actions:
  status           JSON dump — state + thresholds + observed metrics + gate checks.
  enable           Attempt to enable (thresholds enforced unless bypassed).
  disable          Turn it off — no threshold check.

Examples:
  service-knowledge canary status
  service-knowledge canary enable --classes config-value,literal --yes
  service-knowledge canary disable
""",
    "status": """\
Emits the canary JSON: current state (enabled + classes + enabled_at +
enabled_by), the threshold configuration, the observed metrics, and a per-
threshold gate check with pass/fail.

Read-only.

Examples:
  service-knowledge canary status
""",
    "enable": """\
Attempts to enable the canary for one or more low-risk claim classes. All
threshold gates must pass unless overridden. Prompts for confirmation unless
--yes is passed.

Options:
  --classes        Comma-separated claim classes to enable
                   (default: config-value,env-var,image,literal,path,symbol).
  --yes            Skip the interactive confirmation (thresholds still enforced).
  --enabled-by     Operator id for the audit log (default: current user).

Examples:
  service-knowledge canary enable
  service-knowledge canary enable --classes literal,path --yes
  service-knowledge canary enable --enabled-by alice
""",
    "disable": """\
Turns the canary off. No threshold check. Recommended to disable if verifier
FP/FN rates start to drift.

Options:
  --disabled-by    Operator id for the audit log (default: current user).

Examples:
  service-knowledge canary disable
  service-knowledge canary disable --disabled-by alice
""",
}

# Top-level epilog printed under `service-knowledge --help`
TOP_EPILOG = """\
Common workflows:
  Bootstrap a new consumer repo:
      cd <repo> && service-knowledge install
      service-knowledge status

  Refresh after upgrading the package:
      cd /path/to/service-knowledge && git pull
      cd <consumer-repo> && service-knowledge update

  Debug drift or plan an edit:
      service-knowledge index query "<symptom or concept>"
      service-knowledge index stats

  Track canary readiness:
      service-knowledge canary status

Concept help:
  service-knowledge help topics
  service-knowledge help <topic>              # e.g. verifier, mcp, activator, workflow

Docs: README.md, CHANGELOG.md, docs/research/kb-knowledge-base-svc.md (xtrm repo).
"""

# ---------------------------------------------------------------------------
# `service-knowledge help <topic>` explainers.
# ---------------------------------------------------------------------------

TOPICS: dict[str, str] = {
    "workflow": """\
Typical workflow, end to end
----------------------------
1. Install the CLI (once per machine):
     ./install.sh          # from the package source tree — see README

2. Bootstrap a repo:
     cd <repo>
     service-knowledge install
     service-knowledge status

3. Author or edit SKILLs under
     .xtrm/skills/<pack>/service-knowledge/services/<id>/SKILL.md
   Every reconcile run gates the diff through the verifier — see `help verifier`.

4. Rebuild the FTS5 index after edits:
     service-knowledge index build

5. During ops / incidents, retrieve evidence:
     service-knowledge index query "<symptom>"
   From an MCP host, use knowledge_search / knowledge_get / knowledge_evidence_for_files.
   See `help mcp`.

6. Track eval + canary readiness:
     service-knowledge canary status
     python3 -m service_knowledge.eval.harness run \\
         --corpus src/service_knowledge/eval/corpus/ \\
         --output-dir .beads/eval-reports/
""",
    "verifier": """\
Deterministic claim verifier
----------------------------
Every proposed SKILL.md update is evaluated against source-of-truth (repo
files matching the SKILL's `territory:` globs) BEFORE the reconcile driver
is allowed to write it. Extracts 13 claim types from the candidate SKILL.md
(file references, symbol references, env vars, image tags, config values,
port bindings, network attachments, health-check commands, metric names,
alert names, script invocations, literal strings, path assertions).

Six-tier gate lattice:
  INVALID                          blocking
  CONFLICT                         blocking
  EVIDENCE_RACE                    blocking
  INSUFFICIENT_EVIDENCE_HIGH_RISK  non-blocking, non-writable (opens draft PR)
  PASS_WITH_ADVISORIES             writable
  PASS                             writable

Only PASS and PASS_WITH_ADVISORIES flow through to `atomic_write`.

Standalone invocation:
  python3 -m service_knowledge.scripts.verifier \\
      --candidate new.md --current old.md \\
      --territory 'prometheus/**' \\
      --source-root . \\
      --output-format json --gate-mode

--gate-mode exits non-zero on blocking verdicts — drop into CI.
Consumed internally by service_knowledge.scripts.reconcile.
""",
    "mcp": """\
MCP read surface
----------------
Three read-only MCP tools serve the FTS5 index to substrate agents:

  knowledge_search
      Ranked evidence bundle for a free-text query. Optional service_id,
      paths, limit. Returns routing + top items + citations + verification +
      probes + skill_links + token_estimate.

  knowledge_get
      Fetch a single item by item_id (`service:<id>`, `section:<service>:<slug>`,
      `claim:<service>:<slug>`, …) or skill_path.

  knowledge_evidence_for_files
      Evidence bundle for a list of touched paths. Used by the PreToolUse
      activator to route edits to the right expert.

Two additional tools are declared deferred in the registry:
  knowledge_probes, knowledge_conflicts.

There is deliberately no `answer()` endpoint — the layer returns evidence,
never conclusions.

Host into your MCP server via:
  from service_knowledge.mcp import tool_registry, tool_specs
""",
    "activator": """\
PreToolUse activator
--------------------
`scripts/skill_activator.py` runs on every Claude Bash / Write / Edit call
and — when the target paths or command text match a service's territory —
injects a compact routing hint so the agent loads the expert skill before
proceeding.

Reads the same FTS5 index the MCP tools do (single source of truth for
territory routing). Wired automatically by `service-knowledge install`
(writes `.claude/settings.json`).

Turn it off temporarily by editing settings.json; turn it back on with
`service-knowledge install --path .`.

Design: narrow blocking (only when high-confidence match), evidence bundle
in the injected hint (small; token cost is <300 typical).
""",
    "eval": """\
Eval harness
------------
Ships a labeled corpus (85+ cases) exercising routing, retrieval, verifier
accuracy, and diagnostic latency. Weekly report writes to
.beads/eval-reports/YYYY-WW.md.

Run:
  python3 -m service_knowledge.eval.harness run \\
      --corpus src/service_knowledge/eval/corpus/ \\
      --output-dir .beads/eval-reports/

Gated metrics:
  routing_precision           >= 0.80
  retrieval_precision_at_5    >= 0.60
  stale_claim_escape_rate     <= 0.05
  verifier_fp_rate            <= 0.05
  verifier_fn_rate            <= 0.10

Runs offline against fixtures too — CI does not need a live consumer.
""",
    "telemetry": """\
Telemetry
---------
Every verifier run, retrieval call, activator injection, and eval-metric
emission writes one structured line to
  .xtrm/state/service-knowledge/events.jsonl

Format: `component=<name> event=<name> key=value ...`. Grep-friendly, one
line per event, JSON-loadable per line.

The canary metrics aggregate this file for its threshold gates
(see `help canary`).

Suppress with `--no-telemetry` on the verifier CLI (interactive debugging).
""",
    "canary": """\
Canary policy
-------------
The auto-merge canary is the switch that lets deterministically-verified
low-risk claim edits reconcile-merge without human review.

Disabled by default. Package v1.0.0 is reserved for the enable moment.

Enable gates (all must hold): see `service-knowledge canary status`.

State: .xtrm/state/service-knowledge/canary.json
Metrics: aggregated from .xtrm/state/service-knowledge/events.jsonl
""",
    "index": """\
FTS5 evidence index
-------------------
Per-repo SQLite database at `.xtrm/cache/service-knowledge.sqlite`.
Populated by `service-knowledge install` and refreshed by
`service-knowledge index build`. Backed by vaultctl's SQLite/FTS5/BM25
substrate (only cross-package dep).

Ranking: 0.40·T + 0.30·L + 0.15·I + 0.10·A + 0.05·F
         territory + BM25 lexical + intent + authority + freshness.

Kinds indexed: service (one per registered service), section (per SKILL.md
heading block), claim (typed source claims), probe (runnable diagnostics),
citation (source-of-truth pointers).

Sub-10ms retrieval on the reference corpus.
""",
    "install": """\
CLI install (host-level)
------------------------
Install the CLI itself once per machine:

    git clone https://github.com/xtrm-dev/xtrm ~/dev/xtrm
    cd ~/dev/xtrm/packages/service-knowledge
    ./install.sh                 # or ./install.sh --system-pipx

The script uses pipx (editable), so future `git pull` in the source tree
or in vaultctl updates the installed CLI automatically.

Per-repo bootstrap is `service-knowledge install` — different command,
different scope. See `help workflow`.
""",
    "bootstrap": """\
Per-repo bootstrap
------------------
Once the CLI is on PATH:

    cd <your-repo>
    service-knowledge install
    service-knowledge status

`install` is idempotent. Re-run after upgrading the package version.
Removes with `service-knowledge remove` (keeps the per-service knowledge).
""",

    "drift": """\
Drift detection and reconciliation
----------------------------------
`service-knowledge drift` scans each service's territory for files changed
since its last sync (`last_sync_ref` -> HEAD semantics) and, on drift, writes a
pending marker at `.xtrm/.service-knowledge-drift-pending` with a per-service
inventory. The legacy `.xtrm/.service-skills-drift-pending` name is recognized
too (canonical wins when both exist); `drift clear` removes whichever is
present and rebuilds the FTS5 evidence index.

Drift is advisory, never required: a drift check on session start surfaces a
notice; reconciliation stays skill-driven via `/updating-service-knowledge`
(the service-knowledge-sync specialist), which syncs the drifted SKILL.md,
stamps `last_sync_ref`, and triggers the index rebuild AFTER a successful
reconcile.

    service-knowledge drift          # scan + write marker if drifted
    service-knowledge drift clear    # remove marker(s) + rebuild index
""",
}

TOPIC_ORDER = [
    "workflow",
    "install",
    "bootstrap",
    "index",
    "verifier",
    "mcp",
    "activator",
    "eval",
    "canary",
    "telemetry",
]


def topic_index_text() -> str:
    """Human-readable topic list for `help topics`."""
    lines = ["Available help topics:", ""]
    for name in TOPIC_ORDER:
        first = TOPICS[name].strip().splitlines()[0]
        lines.append(f"  {name:<12} {first}")
    lines.append("")
    lines.append("Read one with:  service-knowledge help <topic>")
    return "\n".join(lines)
