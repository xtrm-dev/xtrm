# Tasks

> Working glance over **xtrm**. Two real trackers: **agent/robot work → beads (`bd`)**, **human work →
> Jira (project KAN @ xtrmxt.atlassian.net)**. This file mirrors Jira read-only — it is NOT the source
> of truth; don't edit Jira from here without Dawid's explicit approval. Synced 2026-06-11.

## Human work — Jira KAN (mine + Federico's)

### 🔧 In progress (In corso)
- [ ] **KAN-95** (Epic, *Dawid*) — xt-console e database materializer
- [ ] **KAN-97** — pulizia repo: eliminare vecchi asset in `/apps` e `/packages`, lasciare solo `/apps/console`
- [ ] **KAN-61** — integrare sezione Telemetry in `substrate_design_it` (dopo forensic contract)
- [ ] **KAN-66** — ricerca: AgentOps interno per sorvegliare xt/sb/sp/ch/console
- [ ] **KAN-8** (Epic) — Devops system (cross-cutting)

### 👀 In review (In revisione)
- [ ] **KAN-93** (Story, *Dawid*) — stabilire regole su gestione Jira (bozza-regole commentata; → In revisione 2026-06-11)
- [ ] **KAN-91** (Story, *Dawid*) — modifica install `xt`: rimuovere bloat in CLAUDE.md, skill/template per bootstrap agente
- [ ] **KAN-85** (*Federico*) — Shipped v0: testare la CLI + collegamento con `/planning` e `/test-planning`
- [ ] **KAN-84** (Epic) — `xt spec` — bd-and-sp-native spec compiler
- [ ] **KAN-72** — Telemetria v0 forensica (additiva, prima di substrate)
- [ ] **KAN-70** — creare `telemetry/forensic-event-contract.md`
- [ ] **KAN-9** (Epic) — Telemetry / Forensic event contract
- [ ] **KAN-10** (Epic) — Vault & doc-map hygiene

### 📋 To do — assigned / decisions (Da completare)
- [ ] **KAN-65** — ⚖️ DECISIONE: **substrate vs channels — chi landa prima?** (priorità **High**; blocks KAN-6 & KAN-7)
- [ ] **KAN-90** (Story, *Federico*) — creazione user config `~/.xtrm/` per specialists + altre config
- [ ] **KAN-92** (Story) — setup doltlab per rico (share beads)

### 📋 To do — backlog (Da completare, unassigned — selected)
- [ ] **KAN-5** (Epic) Specialists Runtime V4 · **KAN-6** (Epic) Substrate design spec · **KAN-7** (Epic) Channels primitive · **KAN-11** (Epic) Research & adoption backlog · **KAN-86** (Epic) XTRM-01 · **KAN-99** (Epic) task-varie
- [ ] Migration: **KAN-89** xtrm-tools → package `core`; **KAN-88** spostamento specialists + git history + pnpm; **KAN-77** commit/push delete+move (operator gate); **KAN-94** spostare docs/design/canonical in `docs/`
- [ ] Vault hygiene: **KAN-78** pulire metriche container da `temp_roadmap.md`; **KAN-76** chiarire scopo `_repos/`; **KAN-75** archiviare candidate-archive; **KAN-62** uniformare naming chain-templates
- [ ] Telemetry/devops: **KAN-73** proiezione metrics; **KAN-71** adattatore pulse su evento esterno; **KAN-68** chiudere decisioni aperte devops-system §14; **KAN-67** infra/cloud esterni
- [ ] Research backlog (Epic KAN-11): **KAN-82** SkillOpt · **KAN-83** hexstrike-ai · **KAN-81** agent-browser · **KAN-80** AutoScientists/quant (*Federico*, ora include ex-KAN-102) · **KAN-100** idee langchain/arxiv · **KAN-101** gitignore user artifact
- [ ] Misc: **KAN-96** in lavorazione design

> Full board: ~49 open issues in KAN. `IMPDI` project = Jira demo data, ignored.

## Agent/robot work — beads (`bd`)
- [ ] **`xtrm-h9hqg`** (P0, IN_PROGRESS) — bd auto-stage config flip + pre-commit shim (B-A1/A2/A3); hooksPath cases; bd/gitnexus version+migration verify
- [ ] **`60w93.1`** — create forensic event contract → forensic v0 (mirrors KAN-70/72)
- [ ] **`kj651`** — specialists-runtime cleanup + substrate alignment (canonical `repo:specialists-roadmap.md`) — carried by another agent
- [ ] **`eoqxp` / `infra-bnh`** — devops beads (later)

## Done
- [x] Bootstrap Cowork project memory for xtrm (CLAUDE.md + memory/) — 2026-06-11
- [x] Connect Jira + record collaborator (Federico) and KAN coordinates — 2026-06-11
- [x] KAN board cleanup (approved) — 2026-06-11: KAN-93→In revisione; forensic KAN-70/72/61 sotto Epic KAN-9; research KAN-80/81/82/83/100 sotto Epic KAN-11; KAN-65 High + blocks KAN-6/KAN-7; KAN-98 chiusa (junk); KAN-102 chiusa come duplicato di KAN-80 (info consolidate, owner Federico mantenuto)
