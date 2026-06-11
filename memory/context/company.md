# Context — org, stack, tools

## Organization
- GitHub org: **`xtrm-dev`** (closed-source). Work via branches in-repo; no public forks of private repos.
- Permission tiers: `Admin` > `Maintain` > `Write` > `Triage` > `Read`. Default org-wide = read.
- Teams gate write access: `core-team`, `console-team`, `specialists-team`, … (per package).
- 2FA expected. Onboarding canonical doc: `CONTRIBUTING.md`. Security policy: `SECURITY.md`.

## People
- **Dawid** — operator / product. "Operator" throughout the docs = Dawid. Jira: Dawid Jagger (jagger.xtrm@gmail.com).
- **Federico Della Savia** — the one human collaborator. Nickname **"rico"** (e.g. KAN-92 "setup doltlab per rico").
- "Other agents" referenced (e.g. the agent carrying `kj651`) are AI specialists, not humans.

## Task tracking — two systems, by actor
- **Beads (`bd`)** — agent/robot work only.
- **Jira** — human work, for Dawid + Federico. System of record for people.
  - Site: **`xtrmxt.atlassian.net`** · cloudId `ef32e587-9bef-4079-9c6b-be7f7e49b041`.
  - Project **`KAN`** (name "xtrm", software/next-gen) = the real board (~49 open as of 2026-06-11).
  - Project **`IMPDI`** = Jira product-discovery sample board; its "Ideas" (Express checkout, VR travel, rewards…) are **Atlassian demo data**, not real work.
  - Statuses are Italian: **Da completare** = To Do, **In corso** = In Progress, **In revisione** = In Review.
  - Issue types: Epic, Story, Task, Subtask, Bug.
- Don't merge the two. When asked about "my tasks" / "our work", that means **Jira KAN**.
- **Read-only by default; propose before any write** (see CLAUDE.md working norms). Relevant meta-issue: **KAN-93** "stabilire regole su gestione jira" (assigned to Dawid).

## Stack
- **Bun** ≥ 1.0 (runtime; `packages/core` will declare it), **pnpm** workspaces, **TypeScript**.
- **git** ≥ 2.40, **gh** CLI. Bead/`bd` task tracker + gitnexus (code intelligence).
- Specialist runtime source (upstream): `src/specialist/{chain-identity,supervisor,runner,worktree,control}.ts`,
  `src/cli/{run,finalize}.ts`.

## Process / conventions
- **SSOT rule:** package-owned + code implements against it → repo; cross-cutting / in deliberation → vault.
- Docs carry a **status** (canonical / STALE / candidate-archive). The MOC tracks each doc's home + status.
- Decisions are logged (`ordine`); roadmaps mark closed decisions explicitly (see `temp_roadmap.md` §0).
- Bilingual: design writing is frequently Italian; code/contracts in English.

## Adjacent: Mercury (Dawid's other product — xtrm's test bed)
Dawid **owns Mercury**, a market-data product — many containers: `ext-mercury-api`, `econ-*`,
`mmd-*`, `treasury-*`, `doltlab-*`, `infra-*` (prometheus/grafana/loki/traefik/redis/postgres stack).
**xtrm is being tested/dogfooded on Mercury**: Mercury's real repos and work are where xtrm's daemon,
specialists, and telemetry get exercised. The Mercury connectors/skills (Cowork) are a separate surface.

## Tooling note (Cowork)
Installed plugins: product-management, design, productivity, product-tracking-skills. Connectors wired:
Amplitude, Figma, Fireflies, Intercom, Pendo, SimilarWeb, Asana, Atlassian/Jira, ClickUp, Linear,
Monday, Notion, Slack. **Human work tracker = Jira** (via the Atlassian connector); beads/`bd` is the
agent-work tracker.
