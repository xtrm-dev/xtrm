# Phase 0 — Beads authority surfaces census (frozen)

**Bead:** `xtrm-7wc.1` · **PRD freeze:** `ca3ae04` (merge #121) · **Date:** 2026-09-09
**Lane:** A, native explorer on `opencode/muse-spark-1.3-contributor-free`, read-only.
**Format:** `path | kind | authority assumption`.

## 1. Skills

- `.agents/skills/beads/SKILL.md` | skill | `bd` CLI is the durable shared task/memory authority; agent-local plans are ephemeral execution checklists only.
- `.agents/skills/beads/agents/openai.yaml` | extension (agent interface) | Beads exposed as project task tracking in the OpenAI agent interface.

## 2. Hooks (config + scripts)

- `.codex/hooks.json` | hook-config (Codex) | `bd codex-hook SessionStart/UserPromptSubmit/PreCompact/PostCompact` is the authority for Beads context load/refresh across compaction.
- `.claude/settings.json` | hook-config (Claude) | Beads gates own session lifecycle: SessionStart `beads-compact-restore.mjs` + `bd prime --hook-json`; PreCompact `beads-compact-save.mjs`; PreToolUse `beads-edit-gate.mjs` + `beads-commit-gate.mjs`; PostToolUse `beads-claim-sync.mjs`; Stop `beads-stop-gate.mjs` + `beads-memory-gate.mjs`.
- `scripts/install-beads-hooks.sh` | script (installer) | `bd hooks install` + versioned `.bd-sync` chaining is the authoritative install path.
- `scripts/hooks/pre-push.bd-sync` | git hook | Push blocked unless `bd dolt commit` → `pull` → `push` (refs/dolt/data) all succeed.
- `scripts/hooks/post-merge.bd-sync` | git hook | Post-merge pulls the Dolt remote; failure marks Beads data stale.
- **Gap:** `.claude/settings.json` references `.xtrm/hooks/*.mjs`, but `.xtrm/` contains only `board-audit/`, `reports/`, `session-meta.json` — hook scripts are absent in this worktree. Gate evidence is config-only.

## 3. Managed instruction blocks

- `AGENTS.md` (Task Tracking two-tier block) | managed block | Beads owns durable ownership/dependencies/closure; native task system mirrors in-flight work only.
- `AGENTS.md` (Session start + Operating rules) | managed block | `bd prime` / `bd memories` / `bd ready` / `bd show` / `--claim` sequence and memory-ack-before-commit mandatory.
- `AGENTS.md` (Agent Instructions + Quick Reference) | managed block | Issues live in `.beads/dolt/`; `bd dolt push/pull` over `refs/dolt/data` is the sync wire protocol; `issues.jsonl` is passive export.
- `AGENTS.md` (Beads Integration v:1, profile minimal) | managed block | `bd` owns all task tracking; no TodoWrite/markdown TODOs, no MEMORY.md files.
- `AGENTS.md` (Beads Codex Setup) | managed block | Codex resolves Beads via `.agents/skills/beads/SKILL.md` + `bd` CLI + `/hooks`.
- `CLAUDE.md` (two-tier block, xtrm block, Beads Integration v:1) | managed blocks | Same durable-Beads / ephemeral-local-plans authority as AGENTS.md.

## 4. Gates

- `AGENTS.md` + `CLAUDE.md` (memory-ack rule) | gate (policy) | `bd kv set memory-acked:<id>` must precede `bd close` and commit.
- `.claude/settings.json` (Stop hooks) | gate (hook ref) | Stop blocked until memory-ack satisfied (scripts absent; config is the evidence).
- `.claude/settings.json` (PreToolUse hooks) | gate (hook ref) | Edits and Bash-commit paths require Beads claim/commit-gate clearance.
- `docs/devops/service-knowledge-verifier-gate.md` | **excluded** | SKILL-write lattice gate, not a Beads gate.

## 5. bd-CLI usage by file

- `.agents/skills/beads/SKILL.md` | `bd prime/where/ready/list/show/update --claim/create/close/remember` + `--json` rule + `bd edit` prohibition.
- `AGENTS.md` | adds `bd memories/recall`, `bd kv set`, `bd dolt push`, `bv --robot-*` triage adjunct.
- `CLAUDE.md` | same surface as AGENTS.md plus `bd dolt` sync architecture line.
- `.codex/hooks.json` | `bd codex-hook <SessionStart|UserPromptSubmit|PreCompact|PostCompact>`.
- `.claude/settings.json` | `bd prime --hook-json` SessionStart injection.
- `scripts/install-beads-hooks.sh` | `bd hooks install` refresh authority.
- `scripts/hooks/pre-push.bd-sync` + `post-merge.bd-sync` | `bd where` presence probe, `bd dolt commit/pull/push`.
- `docs/devops/mercury-devops-collaborator.md` | `bd` canonical tracker; `bd remember` memories; `bd ready/note/create` operator protocol.
- `docs/devops/agent-observability-pattern.md` | `.beads` symlink squash-merge hazard; Mercury related-beads linkage.
- `docs/devops/dependency-bump-policy.md` | `bd` edges do not cross DBs; follow-up beads for multi-phase work.
- `docs/devops/devops-system.md` | Recommendation.spec → `bd` bead routing; linked-beads section.
- `docs/devops/service-knowledge-index.md` | deferred probes/conflicts land in follow-up beads (advisory).
- `packages/board-audit/board-audit-core` | `bd export --all` canonical snapshot; `bd stats/version` metadata.
- `packages/board-audit/ROUNDTRIP.md` (+ roundtrip script) | `bd import` upsert; removals compile to `bd dep remove` / `bd update --remove-label` / `bd comments add`; `bd dep cycles --json` baseline.
- `packages/board-audit/board-audit-transport.py` | `bd worktree remove` HEAD-comparison semantics.
- `packages/service-knowledge-ext/README.md` | `bd memories/recall` pre-read; `bd remember` write-back.
- `docs/research/*` | `bd remember/memories/recall/forget/kv/show/close` cited as current truth slated for migration — inventoried only.
