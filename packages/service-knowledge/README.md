# service-knowledge

First-class operational **service-knowledge** package. Gives an agent persistent,
repo-specific operational knowledge about your services — architecture, data flows,
failure modes, runnable health checks, deploy/runbook, and diagnostic scripts — kept in
sync with the code via a GitNexus-aware drift engine, gated by a deterministic claim
verifier, and served through a fast FTS5 evidence index and read-only MCP tools.

Independent CLI. Own versioning, release cadence, and CHANGELOG. **Not** routed through
`xt update --apply`.

---

## Install

The easiest path (Debian/Ubuntu/macOS; installs pipx if you pass `--system-pipx`):

```bash
git clone https://github.com/xtrm-dev/xtrm ~/dev/xtrm     # or wherever
cd ~/dev/xtrm/packages/service-knowledge
./install.sh                     # or ./install.sh --system-pipx
```

The script:
1. Ensures `pipx` is available (or apt-installs it with `--system-pipx`).
2. Auto-clones `vaultctl` (the only cross-package dep) into a sibling of
   the `xtrm` checkout (default: `~/dev/vaultctl`) if it isn't already
   present. Override the location with `VAULTCTL_DIR=/your/path`.
3. `pipx install --editable` this package.
4. Injects the vaultctl checkout into the same venv, editable.
5. Runs `pipx ensurepath` so `~/.local/bin` lands on `$PATH` for future shells.

Any push to this repo (or to `vaultctl`) updates the installed CLI automatically —
no reinstall.

Manual install if you already run pipx everywhere:

```bash
pipx install --editable /path/to/vaultctl
pipx install --editable /path/to/xtrm/packages/service-knowledge
pipx inject --editable service-knowledge /path/to/vaultctl
```

Verify:

```bash
service-knowledge --version
```

---

## Per-repo bootstrap

Once the CLI is on PATH, wire it into a consumer repo:

```bash
cd <your-service-hosting-repo>
service-knowledge install     # vendor machinery + wire hooks + build index
service-knowledge status      # confirm install state + package vs consumer version
service-knowledge update      # pull the current package version into this repo
```

`install` is idempotent — safe to re-run after upgrading the package.

---

## CLI surface

```
service-knowledge install     # vendor machinery + wire hooks (idempotent)
service-knowledge update      # pull installed package version into a consumer
service-knowledge status      # report install state (+ drift marker state)
service-knowledge migrate     # one-time service-skills → service-knowledge rename
service-knowledge remove      # uninstall machinery + cache + hooks
service-knowledge drift       # scan | clear  (drift marker + index rebuild)
service-knowledge index       # build | rebuild | query | stats  (FTS5 evidence index)
service-knowledge canary      # status | enable | disable        (auto-merge policy)
```

Every subcommand takes `--path <repo-root>` (defaults to `git rev-parse --show-toplevel`).

### `index`

Builds a per-repo FTS5 evidence index at `.xtrm/cache/service-knowledge.sqlite`:

```bash
service-knowledge index build                    # full rebuild
service-knowledge index query "alertmanager routing"
service-knowledge index stats                    # item counts + last source_ref
```

Ranking:  `0.40·T + 0.30·L + 0.15·I + 0.10·A + 0.05·F` (territory, BM25 lexical, intent,
authority, freshness). Read-only queries add zero latency to the hot path — retrieval is
sub-10ms on the reference corpus (17 services, ~230 items).

Reads are freshness-gated (Layer 1): every query compares `sk_index_state.source_ref`
against `HEAD` and rebuilds under a cross-session lock within a 90 s budget on
mismatch (absent cache counts as mismatch), serving stale plus a `stale_served`
notice on budget exhaustion — never blocking, never raising. Fresh clones and
post-landing checkouts self-heal on first query; explicit `index build` stays
for forcing a rebuild.

### `canary`

Manages the per-repo auto-merge canary. Disabled by default; enabling is an explicit
operator action once the eval thresholds are met:

```bash
service-knowledge canary status                  # show current state + thresholds
service-knowledge canary enable --classes literal,path
service-knowledge canary disable
```

Default thresholds (all must hold before enable is accepted):

| Threshold                    | Default |
|------------------------------|---------|
| `observation_window_days_min`| 30      |
| `verifier_runs_min`          | 200     |
| `verifier_fp_max`            | 0.02    |
| `verifier_fn_max`            | 0.05    |

State lives at `.xtrm/state/service-knowledge/canary.json`.

### `drift`

Detects and reconciles service-knowledge drift (xtrm-6z6.2):

```bash
service-knowledge drift                # scan; writes marker if drifted
service-knowledge drift clear          # remove marker(s) + rebuild evidence index
```

`drift` scans each service's territory for files changed since its last sync
(`last_sync_ref` -> HEAD ref-range semantics with a tracked-files filter; mtime
is fallback only) and, on drift, writes a pending marker at
`.xtrm/.service-knowledge-drift-pending` carrying `trigger, range, reason,
services, files, timestamp` plus a per-service inventory. Reason tags:
`ref-range`, `mtime-heuristic`, `initial-sync-needed` (never-synced service),
`range-unknown`. The legacy `.xtrm/.service-skills-drift-pending` name is
recognized too — the canonical name wins when both exist, matching the pi
extension's semantics. Reconcile stays skill-driven
(`/updating-service-knowledge`): it syncs the drifted SKILL.md, stamps
`last_sync_ref`, regenerates the umbrella table (SEMANTIC block preserved),
and only then is the marker removed and the FTS5 evidence index rebuilt
(`drift clear` does the marker removal + rebuild AFTER a successful
reconcile). Marker reads are live — re-read the file at use time; never rely
on session-start snapshots.

### Git hooks

Three touches-gated, marker-only git hooks keep the marker fresh across every
landing path — merge, rebase/amend, checkout/switch, worktree creation:
`post-merge` (`ORIG_HEAD..HEAD`), `post-checkout` (argv range,
`reason: fresh-cache` on clone/worktree), `post-rewrite` (amend/rebase SHAs).
A landing *touches* service-knowledge when a git-tracked file in range is the
registry, a skill body, the umbrella, or matches a registered territory glob
(untracked scratch dirs never count). No-touch exits silent in <1 s; touch
writes/refreshes the marker only — hooks never build the index and always
exit 0. Installed by `service-knowledge install` / `update` (idempotent,
`--all-worktrees` covers every linked worktree), with a post-install
self-check that fails loudly when no hook can fire (wrong active dir, stale
paths, syntax errors).

---

## Agent-facing doctrine: when service-knowledge is absent or stale

For agents working in a repo that uses service-knowledge, the memory priority
is:

1. **service-knowledge, if present** — check for `service-registry.json`
   (canonical: `.xtrm/skills/<pack>/service-knowledge/service-registry.json`)
   before service-specific questions. Use it when present; ignore when absent —
   never grep-hunt for it speculatively.
2. **Commit corpus — always available, first-class memory** — when the registry
   is absent or stale, fall back to `git log -p --follow -- <file>` for
   per-file history, `git log --grep`/`--oneline` for corpus, and diffs vs
   `last_sync_ref` when a registry states one. Commits do not go stale.
3. **Substrate work tracking** — before workflow-sensitive questions, search
   `sb issue query --search <topic>` / `sb issue list --search <q>` for prior
   issues, resume continuity with `sb issue resume <ref>` / `sb journal since
   <ref>`, and record durable findings with `sb issue note <ref>`. Underuse
   is the default failure mode — check before re-deriving.

**Drift doctrine**: if a drift marker (`.service-skills-drift-pending` or
`service-knowledge status`) reports drift, treat it as **advisory**. Suggest
the update, proceed with current knowledge + commit corpus in parallel;
reconcile via `/updating-service-knowledge` and stamp `last_sync_ref` after.
Never block task work on updating service-knowledge, and rebuild the index
only after a successful reconcile.

---

## Deterministic claim verifier

Every proposed SKILL.md update is verified against source-of-truth before the reconcile
loop is allowed to write it. Extracts 13 claim types from a candidate SKILL.md, checks
each against territory globs, and returns a 6-tier gate verdict:

`INVALID · CONFLICT · EVIDENCE_RACE · INSUFFICIENT_EVIDENCE_HIGH_RISK · PASS_WITH_ADVISORIES · PASS`

Only `PASS` and `PASS_WITH_ADVISORIES` are writable. `INVALID` / `CONFLICT` /
`EVIDENCE_RACE` are blocking; `INSUFFICIENT_EVIDENCE_HIGH_RISK` is non-blocking
but non-writable — it opens a draft PR for human review instead of reconciling.

Invoke standalone:

```bash
python3 -m service_knowledge.scripts.verifier \
    --candidate <new>.md --current <old>.md \
    --territory 'prometheus/**' \
    --source-root . \
    --output-format json --gate-mode
```

`--gate-mode` exits non-zero on blocking verdicts (INVALID / CONFLICT / EVIDENCE_RACE) so
it can drop straight into CI. The reconcile driver (`service_knowledge.scripts.reconcile`)
consumes the same verdict internally.

---

## MCP read surface

Three read-only MCP tools serve the FTS5 index to substrate agents:

| Tool                             | What it returns |
|----------------------------------|-----------------|
| `knowledge_search`               | ranked evidence bundle (routing · top items · citations · verification · probes · skill links) for a free-text query, optional service_id / paths |
| `knowledge_get`                  | single item by `item_id` (`service:<id>`, `section:<service>:<slug>`, …) or `skill_path` |
| `knowledge_evidence_for_files`   | evidence bundle for a list of touched paths — used by the PreToolUse activator to route edits to the right expert |

Two additional tools (`knowledge_probes`, `knowledge_conflicts`) are declared deferred in
the tool registry and reserved for follow-up. There is deliberately no `answer()` endpoint:
the layer returns evidence, never conclusions.

The MCP server module exposes `tool_registry()` and `tool_specs()` for hosting into an
existing MCP host.

---

## Activator (PreToolUse hook)

`skill_activator.py` runs on every `Bash` / `Write` / `Edit` and, when the target paths
or command text match a service's territory, injects a compact routing hint into the
tool context so the agent loads the expert skill before proceeding. It reads the same
FTS5 index the MCP tools do — one source of truth for territory routing.

Wired automatically by `service-knowledge install` (writes `.claude/settings.json`).

---

## Eval harness

Ships a labeled corpus (85 cases on 2026-07-25) exercising routing, retrieval, verifier
accuracy, and diagnostic latency. Weekly report writes to `.xtrm/eval-reports/YYYY-WW.md`:

```bash
python3 -m service_knowledge.eval.harness run \
    --corpus src/service_knowledge/eval/corpus/ \
    --output-dir .xtrm/eval-reports/
```

Gated metrics:

| Metric                          | Threshold |
|---------------------------------|-----------|
| `routing_precision`             | ≥ 0.80    |
| `retrieval_precision_at_5`      | ≥ 0.60    |
| `stale_claim_escape_rate`       | ≤ 0.05    |
| `verifier_fp_rate`              | ≤ 0.05    |
| `verifier_fn_rate`              | ≤ 0.10    |

The harness runs offline against fixtures too — the eval CI job does not need a live
consumer repo.

---

## Telemetry

Every verifier run, retrieval call, activator injection, and eval-metric emission writes
one structured line to `.xtrm/state/service-knowledge/events.jsonl` — the durable audit
trail behind the canary metrics. Grep-friendly: `component=<name> event=<name> ...`.

Suppress with `--no-telemetry` on the verifier CLI (useful for interactive debugging).

---

## Package layout

```
src/service_knowledge/
├── cli/         # install · update · status · migrate · remove · index · canary
├── scripts/     # cataloger, drift_detector, skill_activator, reconcile, verifier/, …
├── contracts/   # service_skill_contract.json (SKILL.md section SSOT)
├── skills/      # reference SKILLs (creating, using, updating, routing, system-guide)
├── index/       # FTS5 schema + query engine + ranking (BM25 + T/I/A/F overlay)
├── mcp/         # knowledge_search + knowledge_get + knowledge_evidence_for_files
├── canary/      # state + status + enable + disable + decision
├── dispatch/    # bead-body evidence bundle + narrow-blocking activator upgrade
├── eval/        # harness + metrics + labeled corpus + weekly report
└── install/     # install-service-knowledge.py + settings.json + git-hooks/
```

---

## Dependencies

Stdlib-only CLI. The single cross-package dep is **vaultctl** (SQLite/FTS5/BM25 substrate).
The CLI does **not** depend on xtrm/sp/xt/xtmux.

---

## Status

**v0.7.0** — reframe substrate complete: independent CLI · deterministic claim verifier ·
verifier-gated reconcile · FTS5 evidence index · 3 MCP tools · PreToolUse activator with
bead-body evidence bundles and narrow blocking · eval corpus + telemetry + weekly reports
· canary policy + state (disabled by default; `v1.0.0` is reserved for the enable moment).

See the CHANGELOG and `docs/research/kb-knowledge-base-svc.md` (xtrm repo) for the full
reframe spec and the per-PR delivery record.
