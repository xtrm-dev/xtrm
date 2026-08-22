# Lane J — Cross-Reference / Link / Duplication Audit

Bead: xtrm-cn8.4 (parent epic xtrm-cn8). Read-only audit; no canonical files modified.
Method: scripted extraction (Python walker + regex link/path extraction, dual file-relative and
repo-root resolution), git SHA per node, difflib similarity for candidate pairs, targeted greps
for authority/version/feature claims. Machine outputs: `lane-j-reference-graph.json`
(437 nodes, 1322 edges), `lane-j-broken-links.json` (165 mechanical misses).

Corpus: xtrm/docs (113 files), specialists/docs (84), core/docs (77, excluding reference/**),
xtmux/docs (14), pr71-loader/experiments md (149 after node_modules exclusion).

---

## 1. Broken relative links (markdown links to nonexistent targets)

48 real broken mdlinks (2 false-positive placeholders excluded, see below). Highest-value items:

| Source | Line | Target | Note |
|---|---|---|---|
| specialists/docs/design/roadmap/chain-templates/README.md | 5, 25, 43, 45, 145 | `../../chain-templates.md` | **The file this README calls "Canonical design canon" does not exist** (see §8) |
| specialists/docs/design/roadmap/chain-templates/README.md | 145 | `../../chain-templates.html` | companion snapshot missing |
| docs/tether.md | 10, 403, 404 | `./conversations.md` | pre-channels-rename name; superseded by channels/ |
| core/docs/design/memory-system-r6g.md | 7, 9, 158, 216, 452, 453 | `./knowledgebasecerebras.md`, `./openwiki.md` | deleted everywhere in corpus |
| core/docs/design/memory-system-r6g.md | 79 | `file.md` | template artifact left in prose |
| specialists/docs/design/README.md | 16–18 | `gzrx-tool-catalog.md`, `gzrx-completion-critique.md`, `gzrx-research-notes.md` | all three deleted |
| specialists/docs/manifest.md | 182–183 | `design/gzrx-tool-catalog.md`, `design/gzrx-completion-critique.md` | index still lists deleted files |
| specialists/docs/archive/iron-review-hardening-qa-chain-substrate.md | 6–10 | `../design/chain-templates.md` | archive doc pointing at deleted canon (5×) |
| specialists/docs/design/darth-feedor-migration.md | 49, 49, 77 | `authoring.md`, `specialists-service.md`, `examples/mercury-atomic-summarizer.specialist.json` | links resolve one directory too low from design/ |
| core/docs/plans/orchestration-implementation.md | 191, 203 | `aws-cao-integration-analysis.md` | never materialized / deleted |
| docs/archive/devops-platform-engineering-prd.md | 307–309 | `~/second-mind/inbox/transcripts/*.analysis.md` | external home-dir paths, unresolvable in repo (same trio duplicated in the substrate PRD copy, lines 376–378) |
| xtmux/docs/INSTALL.md | 123, 126 | `...` | FALSE POSITIVE — placeholder links inside a fenced example block |

Remaining misses are concentrated in deprecated/historical trees
(core/docs/plans/deprecated/*, core/docs/plans/complete/*, roadmap history/) — mechanically valid
findings, low reconciliation priority.

## 2. References to deleted/nonexistent files (path mentions)

114 pathmention misses. Top stale targets by frequency:

| Missing target | Mentions |
|---|---|
| `docs/design/chain-templates.md` (xtrm) | 19 |
| `docs/temp_roadmap.md` (xtrm) | 9 |
| `docs/architecture/console-architecture.md` (pre-move path) | 8 |
| `docs/design/substrate/substrate.md` (historical Substrate location) | 6 |
| `docs/deployment.md` | 4 |
| `docs/plans/brainstorming-state.json` / `-results.md/.json` (core) | 4+3+2 |
| `chain-templates/README.md` (relative from xtrm docs/substrate) | 3 |
| `docs/AGENT_MONITORING.md`, `docs/xtrm-console-visual-contract.md`, `docs/xtrm-observability-prd.md`, `docs/backend.md` | 3 each |

Verified deletion example: `docs/design/chain-templates.md` was removed from xtrm in commit
`092c0462` ("Track B triage — declutter docs/ for xtrm monorepo migration") yet is still the
most-referenced missing file in the corpus. The console architecture pair moved to
`docs/console/architecture/` but old paths are still cited 8+2 times.

## 3. Duplicated documents

| Pair | Similarity | Verdict |
|---|---|---|
| `xtrm/docs/specialists/specialists-execution-protocol.md` vs `specialists/docs/design/execution-protocol-design/specialist-execution-protocol.md` | **1.000 body** (whitespace-only diff) | Exact duplicate. Same last-touch date 2026-07-24 both repos (`2d91be9` / `a11d5bcd`). |
| `xtrm/docs/specialists/agentops-suite.md` vs `specialists/docs/design/specialist-agentops-suite.md` | 0.994 | Near-exact duplicate; differs only in frontmatter/blank lines. xtrm copy newer (2026-06-11 vs 06-05). |
| `xtrm/docs/shared/xtrm-native-harness-on-pi-architecture-exploration-2026-08-09.md` vs `xtrm/docs/harness/<same basename>` | 0.900 | shared/ copy (2026-08-12) is a superset: adds programme-tracking note + entire §29 "Prime-agent code findings". harness/ copy (2026-08-10) is a stale subset. |
| `xtrm/docs/archive/devops-platform-engineering-prd.md` vs `specialists/docs/design/substrate/devops-platform-engineering-prd.md` | 0.938 | Diverged near-duplicate, 262 diff lines. specialists copy newer (2026-07-25 vs 06-11). xtrm archive copy carries no superseded banner. |
| `specialists/docs/design/audit-reconcile-v0724.md` vs `core/docs/design/audit-reconcile-v0724.md` | n/a | specialists copy is **0 bytes**; core copy is 116 KB. Empty name-squatting stub. |
| `specialists/docs/design/substrate/channels.md` vs `xtrm/docs/channels/channels.md` | n/a (14-line stub vs 864) | HEALTHY: stub is an explicit redirect declaring itself non-canonical and naming the canonical home. Model pattern for dispositions. |
| `specialists/docs/architecture.md` vs `specialists/docs/ARCHITECTURE.md` | n/a | NOT duplicates: addendum on benchmark/probe cache layout (11 lines) vs main architecture doc (1168 lines). Name collision only. |
| `xtmux/docs/design/adr/adr001-navigation-design.md` vs `adr001-xtmux-nav.md` | 0.046 | NOT duplicates: operator nav design vs ADR-0001 it references. Prefix collision only. |
| pr71 handoff run artifacts (24 exact-SHA groups) | identical | Benign: handoff snapshot copies of `.chain-runs/` inputs/evidence/cursors. |

No cross-repo exact SHA duplicates among prose markdown.

## 4. Duplicate canonical claims (same subject claimed authoritative twice)

1. **Specialist execution protocol** — both duplicate copies claim canonicality:
   - `xtrm/docs/specialists/specialists-execution-protocol.md:14` "This document is the canonical design…"
   - `specialists/docs/design/execution-protocol-design/specialist-execution-protocol.md:3` "**Status:** proposed canonical design" and `:14` same sentence.
   Identical text asserting authority in two repos; neither defers to the other.
2. **Chain templates** — `xtrm/docs/substrate/chain_templates.md:17` declares itself "the source of truth"
   for the chain pipeline/catalog, while `specialists/.../chain-templates/README.md:5` still names a
   different (deleted) file as "Canonical design canon". Authority migrated without updating the pointer;
   consumers of the README currently have no reachable canon.
3. **Console surface** — `xtrm/docs/console/console-product-contract.md:20` claims "single source of truth
   for the xtrm console surface", absorbing earlier docs; the absorbed-era
   `docs/console/architecture/console-architecture.md` and `console-observability-spec.md` still exist and
   are still referenced elsewhere. Potential competing surfaces; flag for Lane E/G adjudication.
4. Non-conflicting (deferral chains intact): channels (stub defers to vault), forensic telemetry
   (`forensic-event-contract.md:57` sole claimant), console mock HTML (`console-product-contract.md:30`
   explicitly subordinates the mock).

## 5. Stale path names (already-nonexistent targets)

Covered by §1/§2 frequency table. Dominant clusters: pre-monorepo-migration flat paths
(`docs/design/*`, `docs/temp_roadmap.md`, `docs/deployment.md`, `docs/backend.md`),
pre-console-move paths (`docs/architecture/console-*`), and the pre-channels rename
(`conversations.md`). Per scope instruction, docs/shared targets were not validated here beyond
existence (Lane F owns those).

## 6. `using-specialists-v3` / `v4` / `v5` references vs local skill targets

Local target check: **no versioned skill directories exist** in `~/.pi/agent/skills/` or
`~/.claude/skills/`. Installed: `using-specialists`, `using-specialists-auto`,
`using-script-specialists`, plus `specialists/config/skills/{using-specialists,using-specialists-auto}`.
The repo-shipped skill is unversioned.

References found (files → versions): `xtrm/docs/substrate/chain_templates.md` (v3 ×5 incl. L13/L284/L418/L476/L493; v4 ×7 incl. L47/L446/L456/L475; L476 cites literal path `config/skills/using-specialists-v3/SKILL.md` which does not exist),
`xtrm/docs/telemetry/forensic-event-contract.md` (L623, L912 v3),
`xtrm/docs/tether.md` (L337 v2),
`xtrm/docs/channels/channels.md` + `.html` (v3),
`xtrm/docs/_meta/2026-06-21-design-reconciliation.md` (v3),
`xtrm/docs/specialists/xt-pi-role-context-integration-brief.md` (×5),
`specialists/docs/design/roadmap/history/specialists-roadmap-v3.2-2026-07-24.md` (v3/v4/v5 — L74 defines D28 "v4 as new canonical… future v5"),
`specialists/docs/design/roadmap/chains-prompt-evals.md`, `chain-templates/README.md`, `archive/iron-review-hardening-qa-chain-substrate.md`,
`core/docs/design/issuetracking.md`, `core/docs/proposals/using-specialists-v3-improvements-2026-05-09.md`, `core/docs/specs/UPSTREAM-DEPENDENCIES.md`.
Also: project-level AGENTS.md routing table says "prefer `/using-specialists-v3`" — no such named skill exists locally.

Interpretation (mechanical only): versioned skill names are roadmap vocabulary (D28 froze v3,
defined v4, reserved v5) that never shipped under those filenames; every live reference resolves to
nothing.

## 7. Historical Substrate locations

- `docs/design/substrate/substrate.md` — referenced 6× (`xtrm/docs/substrate/chain_templates.md:19,478`;
  `xtrm/docs/archive/devops-platform-engineering-prd.md:48`; specialists PRD `:49`;
  `specialists/.../chain-templates/README.md:9,150`). Path does not exist anywhere in scope; current
  substrate design lives at `xtrm/docs/substrate/substrate_design_en.md`.
- `conversations.md` → renamed **channels** (per substrate_design_en.md:1729 revision-2 note);
  `tether.md` still links the old name 3×.
- `specialists/docs/design/chain-templates.md` — deleted; still cited as canon (see §8).
- `iron-review-hardening-qa-chain-substrate.md` survives only under specialists/docs/archive/ while
  chain_templates.md:13 describes absorbing it — consistent as history, but its outbound links are dead.

## 8. Chain-template canon pointers

- `specialists/docs/design/roadmap/chain-templates/README.md:5` — "Canonical design canon … lives in
  [`docs/design/chain-templates.md`](../../chain-templates.md)" → resolves to `specialists/docs/chain-templates.md`: **missing**, as are `../../chain-templates.html` (L145) and all four section anchors (L25, L43 ×2, L45).
- `xtrm/docs/substrate/chain_templates.md` holds the actual source-of-truth claim (L17) and is reachable.
- `specialists/docs/design/roadmap/chain-templates/doc-sync.formula.json:8` — default `doc_path:
  "docs/README.md"` → `specialists/docs/README.md` **missing** (formula default points at nothing).
- The 16 `.formula.json` templates themselves all exist alongside the README.

## 9. Package/release versions asserted in docs vs package.json

Actual: `@jaggerxtrm/specialists` **3.21.5** · `xtrm-tools` (core) **0.11.6** · `@jaggerxtrm/xtmux` **0.2.4** (tag v0.2.4 = HEAD release commit) · xtrm root has no package.json.

- `xtmux/docs/RELEASE-CHECKLIST.md:46` — "Semver target: `v0.3.0`. Minor bump. Additive over `v0.2.3`" — baseline already superseded: v0.2.4 released (#113). Mildly stale baseline.
- `xtmux/docs/codex-characterization-k1.md:5,20` — pins "xtmux `v0.2.3`, commit `12d670e`" — accurate point-in-time characterization; no action needed.
- `specialists/docs/*/md` frontmatter `version:` fields (e.g. cli-reference `2.9.0`, features `2.5.0`, ARCHITECTURE `3.4.2`, specialists-service `3.1.2`) are per-document revisions, not package versions — flagged as ambiguity risk only; none asserts a package version contradicting 3.21.5.
- No doc asserts a concrete `@jaggerxtrm/*` or `xtrm-tools` version number.

## 10. Stale "future" claims spot-check

- **xtmux SQLite V2 — VERIFIED SHIPPED.** `ts-sqlite.md` §27 explicitly records shipped status ("Rung C");
  code confirms: `src/db/migrations/0001_bootstrap.ts` … `0015_agent_turns_source_key.ts` exist;
  `XTMUX_OBS_V2` flag present in `src/cli-messages.ts:4,59` and `src/benchmarks/messages.ts:74`;
  domains migration `0003_domains_4_7_8.ts` matches the follow-up epic doc. Docs describing V2 as
  future-tense would be stale; ts-sqlite.md already carries the shipped-status override.
- **Specialist JSON loader — VERIFIED SHIPPED (production entry point exists).**
  `specialists/src/lib.ts:20` exports `SpecialistLoader` from `src/specialist/loader.ts`.
  The pr71 experiment doc (`experiments/agentsession-sre-chain-vertical-slice/full-specialist-json-loader.md:37`)
  correctly states the production source is `@jaggerxtrm/specialists/lib:SpecialistLoader` and labels its
  own local resolver experimental-only — no stale future claim found in the experiment docs checked.

---

## Contract (12 points)

1. **Files scanned:** 437 md/json nodes — xtrm/docs 113, specialists/docs 84, core/docs 77, xtmux/docs 14, pr71-loader/experiments 149. Each node carries git HEAD SHA or blob hash (`lane-j-reference-graph.json`).
2. **Method:** Python walker + regex extraction of md links, angle links, bare path mentions; dual resolution (file-relative, then repo-root, then cross-repo-root, %20-decoded); SHA via `git rev-parse HEAD:<path>` falling back to hash-object; difflib full-text similarity for candidate pairs; targeted grep for canonical/version/feature claims; git-history confirmation for key deletions.
3. **Discovered transitively:** execution-protocol exact cross-repo duplicate (not in the brief's candidate list); audit-reconcile empty-stub pair; gzrx deleted-doc cluster still indexed in manifest.md; `doc_path: docs/README.md` formula default pointing at a missing file; unversioned-vs-versioned skill-name mismatch across all live references.
4. **Excluded + why:** `core/docs/reference/**` (17 md/json — third-party copies, per scope; noted, not scanned for internal integrity); `pr71-loader/experiments/**/node_modules/**` (552 vendored md/json); premortem-substrate `out-*/reason-*/err-*` logs (per scope; `synthesis.md`, `report.html`, prompts, brief/result included); lane output files under reconciliation/lanes/ (own artifacts, prevent self-reference).
5. **Authority claims encountered:** ~154 files contain canonical/source-of-truth vocabulary; hard conflicts: execution protocol (dual identical claimants), chain-template canon (claimant vs dead pointer), console surface (contract vs surviving absorbed-era specs). Healthy deferral exemplar: channels stub.
6. **Duplications found:** 2 near/exact cross-repo prose duplicates (execution protocol 1.000, agentops-suite 0.994); 1 superset/stale pair (native-harness 0.900); 1 diverged pair (devops PRD 0.938); 1 empty-stub pair (audit-reconcile); 24 benign exact-SHA run-artifact groups in pr71 handoff; 2 non-duplicate name collisions (architecture addendum; adr001 pair).
7. **Contradictions found:** chain-template authority claimed by existing doc vs README pointer to deleted canon; using-specialists v2–v5 referenced as shipped/production artifacts while only unversioned skills exist; RELEASE-CHECKLIST baseline v0.2.3 behind released v0.2.4; both execution-protocol copies assert canonicality with neither deferring.
8. **Notable unique references:** `config/skills/using-specialists-v3/SKILL.md` literal path (chain_templates.md:476); `~/second-mind/inbox/transcripts/*.analysis.md` external-home trio (PRD copies); prime-agent fork analysis unique to shared/ harness copy §29 (absent from stale twin — content-loss risk if wrong copy is kept); SpecialistLoader production export verified at specialists/src/lib.ts:20.
9. **Suggested dispositions (mechanical only):** repoint chain-templates README canon link to `xtrm/docs/substrate/chain_templates.md`; fix darth-feedor relative links one level up; delete or redirect tether.md conversations links to channels/; update gzrx entries out of manifest.md/design README or restore files; mark xtrm harness/ exploration copy as stale-superseded-by-shared/; choose single execution-protocol home and make the other a channels-stub-style redirect; give audit-reconcile specialists stub the channels-stub treatment or delete it; update RELEASE-CHECKLIST baseline to v0.2.4; replace versioned skill names with unversioned equivalents or add alias note. All are edits — none executed here.
10. **Open questions:** which repo should own the execution-protocol canon (xtrm vault vs specialists)? Is the specialists devops PRD copy (newer) now the live one, and should the xtrm archive copy gain a superseded banner? Should `using-specialists-vN` references be rewritten or preserved as roadmap vocabulary? Are the `~/second-mind` transcripts expected to remain external? Console-surface conflict adjudication belongs to Lane E/G.
11. **Evidence paths:** `docs/runtime/reconciliation/lanes/lane-j-reference-graph.json` (nodes+edges), `lane-j-broken-links.json` (165 misses with line numbers), `lane-j-scan.py` (reproducible scanner); greps and diffs cited inline above by file:line.
12. **No canonical files modified.** Writes confined to `docs/runtime/reconciliation/lanes/lane-j-*`; bead xtrm-cn8.4 claimed and tracked.
