---
date_created: Monday, June 1st 2026
date_modified: Monday, June 1st 2026
title: xtrm — Map of Content (MOC)
type: MOC
status: living
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
| **Telemetry forensic** | specialists-owned → repo `telemetry/forensic-event-contract.md` (DA CREARE, bead `60w93.1`, 4 fix annotati). Sezione substrate DOPO. |
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
| **telemetry** | repo `telemetry/forensic-event-contract.md` (DA CREARE) + sezione substrate (dopo) | vault `research/*-telemetry-*` | bead `60w93.1` → forensic v0 |
| **chains (primitive)** | sezione in [[substrate_design_it]] | [[chains]] | `kj651` (altro agente) |

---

## 5. Checklist — stato

- [x] Substrate canonico = vault [[substrate_design_it]]; copie repo eliminate; [[substrate_design_en]] STALE.
- [x] Devops PRD/research + brief riconciliati in [[devops-system]]; fonti → `archive/`.
- [x] Repo design ripulito (gzrx, shepherd, issuetracking, service-eval, test-writer, post-aws-summit).
- [x] 2 research devops rimessi in `research/` + wikilink in [[devops-system]] §15.
- [x] Channels + chain_templates spostati in vault.
- [ ] **Risolvere duplicati repo↔vault** (channels, chain-templates) — §7.
- [x] Doc-map `kj651` corretto via **note di relocation** (substrate→vault, channels→vault; chain-templates invariato per ora — §7).
- [x] `Senza nome.md` eliminato (resta da chiarire `_repos/`).
- [ ] Verificare/archiviare `specialists.quant`, `specialists.scheme`, `darth-feedor-migration`, `html-design-example`, `dependencies-gate-use`.
- [ ] Creare `telemetry/forensic-event-contract.md` (bead `60w93.1`).
- [ ] Sezione Telemetry in [[substrate_design_it]] (DOPO il forensic contract).
- [ ] Commit/push delete+move nel repo specialists (operator gate).

---

## 6. Decisioni aperte (di sistema)

- **`substrate_design_en.md`**: riallineare al canonico IT o archiviare.
- **Chain-templates naming**: vault usa `chain_templates` (underscore), repo `chain-templates` (hyphen) — uniformare.
- Le decisioni aperte del **devops** vivono in [[devops-system]] §14 (non si chiudono ora).

---

## 7. Drift & buchi da chiudere (verifica 2026-06-01)

1. **channels duplicato** — vault `channels/` (canonico) vs `repo:docs/design/substrate/{channels.md,channels.html}`. Consigliato: eliminare/archiviare le copie repo (coerente con substrate). *Non tocco senza tuo via.*
2. **chain-templates duplicato + canonico conteso** — vault `substrate/chain_templates.md` vs `repo:chain-templates.md` (+`.html`). Il repo è citato **CANONICO dal doc-map di `kj651`**; le `.formula.json` (codice) restano repo. Decidere: vault canonico (design) + repo mantiene formula.json + aggiornare doc-map `kj651`; oppure repo resta canonico e il vault è copia.
3. **`kj651` doc-map** — ✓ corretto via **note di relocation** (2026-06-01): substrate→vault canonico, channels→vault, chain-templates INVARIATO per ora (split irrisolto, vedi #2). La description resta com'è; la note prevale.
4. **`_repos/` vuoto** — scopo? (symlink ai repo per navigazione Obsidian?).
5. **`Senza nome.md`** — ✓ ELIMINATO.
6. **`channels.html.md`** — doppia estensione (cosmetico).
7. **candidate-archive ancora sparsi** — `specialists.quant`/`specialists.scheme` (vault root), `darth-feedor-migration`/`html-design-example` (repo), `dependencies-gate-use` (research, scope?).
8. **Bead-path** — le mandatory-reading di `eoqxp`/`60w93` ora risolvono (research ripristinato). ✓
9. **Commit/push** repo specialists non fatto (tutto recuperabile da git fino ad allora).
