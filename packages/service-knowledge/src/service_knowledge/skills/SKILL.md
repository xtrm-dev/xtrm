---
name: service-knowledge
description: >-
  Operational service-knowledge system for a project's services. One skill that
  creates, discovers, activates, updates, and scopes per-service expert skill
  packages (SKILL.md + diagnostic scripts + references), kept in sync with the
  code via a GitNexus-aware drift engine. Use when onboarding to a service,
  routing a task to the right expert, scaffolding a missing skill, or syncing a
  skill after the implementation drifted. Triggers: /service-knowledge,
  /creating-service-knowledge, /using-service-knowledge, /updating-service-knowledge,
  /scope, or any task that touches a registered service territory.
allowed-tools: Bash(python3 *), Read, Grep, Glob, Write
---

# Service Knowledge

The single entry point for a project's **service-knowledge** system. Each service gets a
dedicated expert package — architecture, data flows, failure modes, runnable health checks,
deploy/runbook, and diagnostic scripts — that agents load on demand instead of re-deriving
the service every session. This router tells you **which flow to run** and points at the
detailed reference for each.

> **Two skills at different layers:**
> - **This machinery skill** (`service-knowledge`) — the create/use/update/scope tooling.
>   Triggers: `/service-knowledge`, `/creating-service-knowledge`, `/using-service-knowledge`,
>   `/updating-service-knowledge`, `/scope`.
> - **The per-repo umbrella** (`<repo>-services`) — one generated skill per repo that maps that
>   repo's services and links their per-service skills. Repo-qualified name avoids collision.

---

## Pick the Flow

| You want to… | Flow | Reference | Trigger |
|---|---|---|---|
| Stand up a new service skill (scaffold + deep dive) | **create** | [references/creating.md](references/creating.md) | `/creating-service-knowledge` |
| Find & activate the right expert for a task | **use** | [references/using.md](references/using.md) | `/using-service-knowledge` (auto at session start) |
| Sync a skill after the code changed (drift) | **update** | [references/updating.md](references/updating.md) | `/updating-service-knowledge` (auto on Write/Edit) |
| Scope a task to the right service(s) before touching files | **scope** | [references/routing.md](references/routing.md) | `/scope "task"` |

Supporting references: [system-guide.md](references/system-guide.md) (how the whole system fits
together), [script_quality_standards.md](references/script_quality_standards.md) (diagnostic-script
templates), and the canonical section contract `references/service_skill_contract.json` (SSOT for
SKILL.md headings, order, and the `<!-- SEMANTIC_START/END -->` protected region).

---

## Scope First (absorbed routing)

Before any investigation, feature, refactor, config-change, or exploration task that involves a
service, **ground it in the right expert context before touching files**. Read the registry, detect
intent, map to service(s), emit a scope plan, load the skills, then act.

Detect intent from the task description:

| Intent | Signal keywords |
|---|---|
| `investigation` | broken, error, failing, not working, crash, down, missing, slow, 502, 404, 429, timeout |
| `feature` | add, implement, create, new, build, support |
| `refactor` | refactor, restructure, clean, reorganize, rename, extract |
| `config-change` | update, change, modify, set, configure, tune |
| `exploration` | how, explain, understand, what is, why, walk me through |

**Default when ambiguous → `investigation`** (check first, act second). Map symptoms to services,
confirm ownership with the graph when a task names a *symbol* rather than a path, then run the full
scope flow in [references/routing.md](references/routing.md) (intent workflows, XML scope block,
regression-test binding).

```bash
python3 "$CLAUDE_PROJECT_DIR/.xtrm/skills/default/service-knowledge/scripts/scope.py"   # registry + routing footer
```

---

## Evidence-First Retrieval (FTS5 index + MCP tools)

Every registered SKILL.md, its sections, claims, probes, and citations are indexed into a per-repo
FTS5 database at `.xtrm/cache/service-knowledge.sqlite` (built by `service-knowledge install`;
rebuild any time with `service-knowledge index build`). Ranking:
`0.40·T + 0.30·L + 0.15·I + 0.10·A + 0.05·F` (territory · BM25 lexical · intent · authority · freshness).
Sub-10ms on the reference corpus.

Three surfaces read the same index:

- **CLI**: `service-knowledge index query "<text>"` — quick shell probe (add `--paths` to bias by
  territory, `--service-id` to restrict, `--bundle` for the §3.2 evidence-bundle shape).
- **MCP tools** — five read-only tools, served over stdio MCP by `service-knowledge mcp serve`.
  They reach an agent through two hosts, at tool-definition parity (same names, schemas and
  descriptions, generated from `service_knowledge.mcp.TOOL_MODULES`):

  | Surface | Install |
  |---|---|
  | Claude Code plugin | `claude plugin install service-knowledge@xtrm` (needs CLI >= 0.9.0) |
  | pi extension | `@jaggerxtrm/pi-service-knowledge` >= 1.1.0 |

  A `service-knowledge` repository is one whose `.xtrm/skills/<pack>/service-knowledge/`
  holds a `service-registry.json`. The two hosts gate differently, and the difference matters:

  - **pi extension**: self-gating. With no registry in the session cwd or its six ancestors it
    registers NOTHING — not the tools, not the `/service-knowledge:status` command.
  - **Claude Code plugin**: project-scoped by root, not by absence. The plugin installs at user
    scope, so its five tools are ALWAYS listed; a call outside a `service-knowledge` repository
    returns an `isError` result that names the root and says the repository has not adopted
    service-knowledge. It does not return an empty success, and it does not create `.xtrm/` in
    that checkout.

  So on Claude the tools exist everywhere and refuse outside a consumer repo; on pi they exist
  only inside one. Either way, an empty success never means "the knowledge base says no".

### Which tool to call

| Call | When |
|---|---|
| `knowledge_search` | A free-text symptom, alert name, metric or concept. Returns a §3.2 evidence bundle. |
| `knowledge_get` | You have a specific `item_id` from a bundle, or a `skill_path` for the whole SKILL.md. |
| `knowledge_evidence_for_files` | You are about to read or change service source. Routes by territory ownership and is the cheapest first call when paths are already known. |
| `knowledge_status` | Results look empty or stale, or you need to know whether the index exists and is current in THIS checkout. |
| `knowledge_drift` | You are about to trust knowledge about recently changed code, or deciding whether to reconcile. |

**Call a tool before grep and before reading service source.** The whole point of the index is
that a keyword search over files cannot tell you which service owns a path or which claims are
verified. Concretely:

1. Paths known (`git diff --name-only`, a stack trace, a file list) → `knowledge_evidence_for_files`.
2. Only a symptom or an alert → `knowledge_search`.
3. A bundle item you need in full → `knowledge_get` with its `id`; a whole expert → `knowledge_get`
   with its `skill_path`.

Notes that change how you read the output:

- **Evidence, not conclusions.** A bundle carries citations, verification verdicts and freshness
  signals. Check a load-bearing claim against the tree before you act on it.
- **`knowledge_drift` is advisory.** It reports the pending marker and services whose
  `last_sync_ref` trails HEAD. It never blocks work and never writes.
- **Both tools are read-only.** `knowledge_status` and `knowledge_drift` never write the marker
  and never rebuild. Reconcile with `/updating-service-knowledge`, which stamps `last_sync_ref`.
- **A read may refresh the derived cache.** The index gate rebuilds
  `.xtrm/cache/service-knowledge.sqlite` when the indexed skill inputs changed. That is a derived
  cache, not consumer data.

Reach for the index/tools **before** grep whenever the symptom → service mapping is unclear, when
proposing a new SKILL that might overlap existing territory, or when routing an incident. Use the
graph (below) for structural navigation once the right expert is loaded.

---

## Verifier Gate (v0.4)

Every proposed SKILL.md update — from any flow, including a fresh Phase-2 write — is evaluated
against source-of-truth by a deterministic 13-claim-type verifier before `atomic_write` runs.
Six-tier gate lattice; only `PASS` and `PASS_WITH_ADVISORIES` are writable. Blocking verdicts
(`INVALID` / `CONFLICT` / `EVIDENCE_RACE`) halt the write; `INSUFFICIENT_EVIDENCE_HIGH_RISK` opens
a draft PR for human review. The `update` flow calls it via `scripts/reconcile.py`; the `create`
flow calls it as a Phase-3 smoke to catch bad initial content.

Concept: `service-knowledge help verifier`. Standalone invocation:
`python3 -m service_knowledge.scripts.verifier --candidate new.md --current old.md --territory 'x/**' --gate-mode`.

---

## Navigate With the Graph, Not Just Globs

The registry maps a service to its territory **globs** — enough to *find* the skill, not to
understand cross-service reach. Once an expert is active, navigate with the **GitNexus** graph:

| Question | Use |
|---|---|
| "What else breaks if I change this symbol?" | `gitnexus impact <symbol> --direction upstream` |
| "Who calls / is called by this?" | `gitnexus context <symbol>` |
| "Which service owns this execution flow?" | `gitnexus query "<concept>"` |
| "Trace the full flow end to end" | `READ gitnexus://repo/<repo>/process/<name>` |

**Fallback:** with no GitNexus index, route by registry globs + `cross_territory` hints in drift
output. The graph is an enhancement, never a hard dependency.

---

## Drift Cadence (update flow)

The sync pipeline is touches-gated and advisory: `post-merge`/`post-checkout`/`post-rewrite`
hooks write a pending marker only when the landed range touches registered territory — they
never rebuild the index and never decide merges. Freshness is Layer 1: every read compares
the index `source_ref` to HEAD and rebuilds under a budgeted single-flight lock on mismatch
(fresh clones and rebase landings heal on first query). Drift is measured **semantically**
since each service's `last_sync_ref` (committed range `last_sync_ref..HEAD`), not by file mtime
alone, and tiered `cosmetic | medium | high | unknown` with explicit provenance. See
[references/updating.md](references/updating.md).

```bash
python3 "$CLAUDE_PROJECT_DIR/.xtrm/skills/default/service-knowledge/scripts/drift_detector.py" scan
```

---

## Scripts

All machinery scripts live together under `scripts/` (no cross-skill imports):

| Script | Role |
|---|---|
| `bootstrap.py` | Path/registry resolvers (`get_project_root`, `get_pack_path`, `get_registry_path`), gitnexus helpers |
| `scaffolder.py` | Phase-1 skeleton from compose/Dockerfile/deps |
| `deep_dive.py` | Service-type classification + Phase-2 research agenda |
| `drift_detector.py` | GitNexus-aware drift scan / sync / `check-hook` |
| `skill_migrator.py` | Upgrade a pre-devops SKILL.md to the current section contract (idempotent, SEMANTIC-preserving) |
| `cataloger.py` | Session-start service catalog injection |
| `skill_activator.py` | PreToolUse territory → load-skill enforcement |
| `scope.py` | Registry read + routing footer for the scope flow |

Install machinery (hooks + settings + git-hooks) lives under `install/`; see
[install/service-knowledge-readme.md](install/service-knowledge-readme.md).

`umbrella_generator.py` renders the per-repo umbrella (below).

---

## Per-Repo Umbrella (generated)

Each repo gets **one** umbrella skill — `name: <repo>-services` — at
`.xtrm/skills/<pack>/service-knowledge/SKILL.md`. It is **generated from
`service-registry.json`** (service table + cross-service health + navigation) so it
can never drift from the registered services. The human cross-service narrative lives
in a `<!-- SEMANTIC_START -->` / `<!-- SEMANTIC_END -->` block preserved verbatim across
regeneration — edit only there.

```bash
python3 scripts/umbrella_generator.py <repo-name>   # regenerate (idempotent)
```

`install-service-knowledge.py` regenerates the umbrella on install/upgrade. Load the
umbrella first when a task spans services; it links each per-service skill.

---

## Installation

Two layers — install the CLI once per host, then bootstrap each consumer repo.

**Host-level (once):**

```bash
git clone https://github.com/xtrm-dev/xtrm ~/dev/xtrm
cd ~/dev/xtrm/packages/service-knowledge
./install.sh              # or ./install.sh --system-pipx to apt-install pipx too
```

The installer uses `pipx --editable`, auto-clones `vaultctl` if missing, and puts
`service-knowledge` on `$PATH`. See `service-knowledge help install` for details.

**Per-repo (once per consumer):**

```bash
cd <your-service-hosting-repo>
service-knowledge install
service-knowledge status                 # confirm
service-knowledge index build            # (auto-run by install; explicit is fine)
```

Idempotent — wires `settings.json` hooks (SessionStart catalog · PreToolUse activator ·
PostToolUse drift), activates git hooks, migrates already-installed skills to the current section
contract, and builds the FTS5 evidence index. Safe to re-run after upgrades (or run
`service-knowledge update`).

**Upgrading the machinery in a consumer repo** (`please upgrade the current repo sk`):

1. Baseline first: `service-knowledge status` — record package vs installed
   version and the drift-marker state before changing anything.
2. Pull the package, then in the consumer root run `service-knowledge update`
   (`--all-worktrees` when the repo uses linked worktrees). Expect a clean
   `updated to vX.Y.Z` with no `FAILED` and exit 0 — then confirm the
   `activated in <dir>` line by re-running the vendored installer
   `--hooks-only` in step 3. A loud `FAILED` + exit 1 means STOP and report —
   never claim success, never hand-edit hooks to make it pass.
3. Verify: re-run the vendored installer `--hooks-only` and quote its
   self-check verbatim; `bash -n` all five `.githooks` files; `git status`
   must show only intended files (never commit foreign telemetry, caches,
   markers, or scratch dirs — leave those uncommitted for the owner).
4. Prove freshness: `service-knowledge index query "<term>"` and confirm the
   returned `source_ref` equals HEAD (Layer 1 self-heal).
5. Never bundle reconciliation into an upgrade: drift reconcile (stamping
   `last_sync_ref`, regenerating the umbrella) is a separate
   `/updating-service-knowledge` pass with domain judgment.

**Auto-merge canary** (v0.7): disabled by default. `service-knowledge canary status` shows the
current state and enable-gate thresholds; `service-knowledge help canary` explains the policy.
