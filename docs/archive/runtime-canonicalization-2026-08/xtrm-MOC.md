---
date_created: Monday, June 1st 2026
date_modified: Monday, June 1st 2026
title: xtrm — Map of Content (MOC)
type: MOC
status: living
created: 2026-06-07T02:22
updated: 2026-06-09T01:35
---

# 🗺 xtrm — Map of Content

> **Indice unico della superficie di design dell'ecosistema xtrm.** Ogni doc ha **casa** e **stato**.
> Aggiorna qui quando aggiungi/sposti un doc. Pensiero corrente: [[ordine]] · [[chains]].

---

## 0. Regola di decisione — dove vive un doc

> **Posseduto da UN package e il codice ci implementa contro? → repo canonico.
> Cross-cutting / in deliberazione / attraversa più repo? → vault (questo posto).**

Vault = pensiero/deliberazione/cross-repo (Obsidian `[[link]]`). Repo = SSOT congelato che
CI/agenti/executor validano. **Decisione operatore:** lo spec substrate/channels/devops è
**canonico nel vault**; il repo tiene solo ciò che è eseguibile/codice (roadmap, `.formula.json`, console).

---

## 1. Decisioni canoniche (2026-06-01)

| Tema | Decisione |
|---|---|
| **Substrate** | canonico **`substrate/`[[substrate_design_it]]** (vault, IT). Copie repo eliminate. `repo:substrate.html` tenuto (operator lo aggiusta). [[substrate_design_en]] = **STALE**. |
| **Channels** | spostato in vault **`channels/`** (canonico). ⚠️ copie repo ancora presenti → vedi §7. |
| **Chain-templates** | `substrate/chain_templates.md` (vault). ⚠️ duplicato col repo (citato canonico da `kj651`) + le `.formula.json` restano repo → vedi §7. |
| **Devops** | NON 6° package. Sistema cross-cutting xt+sp+sb. canonico **`devops/`[[devops-system]]** (riconciliato, decisioni aperte §14). Fonti → `archive/`. |
| **Telemetry forensic** | specialists-owned → SSOT `telemetry/forensic-event-contract.md` (**SHIPPED**). `xtrm.forensic.v1` attivo nel repo specialists (`src/specialist/forensic-events.ts`, `FORENSIC_SCHEMA_VERSION`, tabella `specialist_forensic_events`, CLI `sp forensic`). Sezione substrate §2.7/§2.8 marcata "owned by [[forensic-event-contract]]". |
| **Chain identity** | in carico ad altro agente in `kj651`. Pensiero: [[chains]]. |
| **Roadmap esecuzione** | `repo:specialists-roadmap.md` canonico per `kj651`. |

---

## 2. Vault — struttura attuale

### root (loose)
[[xtrm-MOC]] (indice) · [[ordine]] (log decisioni) · [[chains]] (primitivo chain) · [[devjournal]] ·
[[improvements]] · [[specialists.quant]] (candidate-archive) · [[specialists.scheme]] (candidate-archive).

### `substrate/`
| Doc | Stato |
|---|---|
| [[substrate_design_it]] | **CANONICO — substrate spec** (IT) |
| [[substrate_design_en]] | **STALE** (riallineare o archiviare) |
| `chain_templates.md` | design chain-templates (⚠️ duplicato repo, §7) |

### `channels/`
| Doc | Stato |
|---|---|
| `channels.md` | canonico — channel primitive (⚠️ duplicato repo, §7) |
| `channels.html.md` | export (doppia estensione, cosmetico) |

### `devops/`
| Doc | Stato |
|---|---|
| [[devops-system]] | **CANONICO — devops system** (riconcilia tutto; §14 decisioni aperte; il module landa molto più avanti) |

### `research/`
[[sre-telemetry-patterns-for-mercury]] · [[agentops-telemetry-for-specialists]] ·
[[aws-agentcore-observability-official-docs]] · [[aws-devops-agent-official-docs]] ·
[[devops-query-surfaces-mcp-architecture]] · [[terraform-first-steps]] ·
[[post-aws-summit-research]] · [[dependencies-gate-use]] (scope da verificare).

### `archive/` — fonti devops assorbite in [[devops-system]]
[[devops-platform-engineering-prd]] · [[devops-specialists-research]] · [[devops-specialists]].

### `_repos/`
Vuoto — **a cosa serve?** (symlink ai repo?) → §7.

---

## 3. Repo `~/dev/specialists/docs/design/` — stato attuale

### Canonici in-repo (restano)
| Doc | Stato |
|---|---|
| `roadmap/specialists-roadmap.md` | **CANONICO** — piano `kj651` |
| `roadmap/chain-templates/*.formula.json` (15) | canonici (codice) |
| `sp-console-tui.md` (+ `-mock.html`) | design console live (untracked) |
| `roadmap/history/*` | archivio corretto |
| `README.md` | indice repo |

### Duplicati / da risolvere (§7)
| Doc | Problema |
|---|---|
| `substrate/channels.md` + `channels.html` | duplicato di vault `channels/` |
| `chain-templates.md` + `.html` | duplicato di vault `substrate/chain_templates.md`; citato canonico da `kj651` |
| `substrate/substrate.html` | KEEP (operator lo aggiusta) |
| `substrate/html-design-example.md` | candidate-archive (non substrate spec) |
| `darth-feedor-migration.md` | candidate-archive (vecchio) |

---

## 4. I quattro sistemi

| Sistema | Design canonico | Research | Esecuzione |
|---|---|---|---|
| **substrate** | vault [[substrate_design_it]] | vault `research/` | `repo:specialists-roadmap.md` (`kj651`) |
| **channels** | vault `channels/channels.md` | — | runtime channels package |
| **devops** | vault [[devops-system]] | vault `research/` + `archive/` | beads `eoqxp`, `infra-bnh` |
| **telemetry** | repo `telemetry/forensic-event-contract.md` (**SHIPPED**, SSOT) + sezione substrate §2.7/§2.8 owned-by-link | vault `research/*-telemetry-*` | `xtrm.forensic.v1` attivo nel repo specialists |
| **chains (primitive)** | sezione in [[substrate_design_it]] | [[chains]] | `kj651` (altro agente) |

---

## 5. Checklist — stato

- [x] Substrate canonico = vault [[substrate_design_it]]; copie repo eliminate; [[substrate_design_en]] STALE.
- [x] Devops PRD/research + brief riconciliati in [[devops-system]]; fonti → `archive/`.
- [x] Repo design ripulito (gzrx, shepherd, issuetracking, service-eval, test-writer, post-aws-summit).
- [x] 2 research devops rimessi in `research/` + wikilink in [[devops-system]] §15.
- [x] Channels + chain_templates spostati in vault.
- [ ] **Risolvere duplicati repo↔vault** (channels, chain-templates) — §7 #1 #2 (decisione operatore).
- [x] Doc-map `kj651` corretto via **note di relocation** (substrate→vault, channels→vault; chain-templates invariato per ora — §7).
- [x] `Senza nome.md` eliminato.
- [x] `_repos/` rimosso (era vuoto).
- [x] candidate-archive `specialists.quant`/`specialists.scheme`/`darth-feedor-migration`/`html-design-example` rimossi (verificato 2026-06-21).
- [ ] Verificare/archiviare `dependencies-gate-use` (research, scope?).
- [x] `telemetry/forensic-event-contract.md` SHIPPED come SSOT; `xtrm.forensic.v1` attivo nel repo specialists (`src/specialist/forensic-events.ts`, tabella `specialist_forensic_events`, CLI `sp forensic`).
- [ ] Sezione Telemetry in [[substrate_design_it]] §2.7/§2.8 con esplicito "owned by [[forensic-event-contract]]" + riassunto di correlation/identity (NON duplicare la SSOT).
- [x] **Roadmap reconciliation 2026-06-21**: `xtrm/docs/temp_roadmap.md` rimosso (era specialists-roadmap + ~885 righe garbage paste + §A premortem); §A.1–§A.5 portate in `specialists/docs/design/roadmap/specialists-roadmap.md`; `unitAI-sc03v` CLOSED. Vedi `_meta/2026-06-21-design-reconciliation.md`.
- [ ] Commit/push delete+move nel repo specialists (operator gate).

---

## 6. Decisioni aperte (di sistema)

- **`substrate_design_en.md`**: riallineare al canonico IT o archiviare.
- **Chain-templates naming**: vault usa `chain_templates` (underscore), repo `chain-templates` (hyphen) — uniformare.
- Le decisioni aperte del **devops** vivono in [[devops-system]] §14 (non si chiudono ora).

---

## 7. Drift & buchi da chiudere (verifica 2026-06-21)

1. **channels duplicato** — ✓ RISOLTO 2026-06-21: vault `channels/channels.md` (864 l, oggi) era >40% più grande della copia repo (617 l, 2026-05-26 stale). Copia repo sostituita con breadcrumb stub che punta al vault; `channels.html` rimosso.
2. **chain-templates** — ✓ NON ERA UN DUPLICATO (verifica 2026-06-21): vault `substrate/chain_templates.md` = design doc; repo `roadmap/chain-templates/` = directory con 15 `.formula.json` + README (codice). Sono complementari, non duplicati. Resta solo divergenza cosmetica di naming (`_` vs `-`), deferred. Il MOC dichiarava un `repo:chain-templates.md` che non esiste.
3. **`kj651` doc-map** — ✓ corretto via **note di relocation** (2026-06-01): substrate→vault canonico, channels→vault, chain-templates INVARIATO per ora (split irrisolto, vedi #2). La description resta com'è; la note prevale.
4. **`_repos/` vuoto** — ✓ RIMOSSO (verifica 2026-06-21).
5. **`Senza nome.md`** — ✓ ELIMINATO.
6. **`channels.html.md`** — ✓ NON ESISTE (verifica 2026-06-21: la cartella ha `channels.html` semplice — falso allarme MOC).
7. **candidate-archive** — ✓ RISOLTO 2026-06-21: `specialists.quant`/`specialists.scheme`/`darth-feedor-migration`/`html-design-example` tutti rimossi. `dependencies-gate-use` (`research/`, 2026-05-31) **verificato come research valido attivo** — propone una rule/skill/enforcement per costringere agent a fare dependency-discovery prima di scrivere implementazioni custom in domini standardizzati (calendars, datetime, auth, retry, parsing, ecc.); resta in `research/`.
8. **Bead-path** — le mandatory-reading di `eoqxp`/`60w93` ora risolvono (research ripristinato). ✓
9. **Commit/push** repo specialists non fatto (tutto recuperabile da git fino ad allora).
10. **Roadmap reconciliation (2026-06-21)** — ✓ `xtrm/docs/temp_roadmap.md` rimosso, §A portata in canonical specialists, `unitAI-sc03v` CLOSED. Vedi `_meta/2026-06-21-design-reconciliation.md`.
