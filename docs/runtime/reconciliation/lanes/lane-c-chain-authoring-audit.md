# Lane C — Chain Authoring Audit (read-only documentation audit)

Programme: xtrm-cn8 — Runtime architecture doc audit + canonicalization programme.
Scope: chain-template authoring surface across xtrm, specialists, core repos plus planning/test-planning skills.
All blob SHAs and per-file detail: `lane-c-source-register.json`. Per-formula extraction: `lane-c-formula-catalog.json`. Term definitions with quotes: `lane-c-terminology-map.json`.

## 1. What was read completely

- `xtrm docs/substrate/chain_templates.md` (496 lines, full).
- All 15 `.formula.json` files under `specialists docs/design/roadmap/chain-templates/` (each read individually, full bytes).
- `specialists docs/design/roadmap/chain-templates/README.md` (157 lines).
- `~/.pi/agent/skills/planning/SKILL.md` (671 lines) and `test-planning/SKILL.md` (543 lines). **No project-local copies exist** under `/home/dawid/dev/xtrm/.agents/skills/` (that directory holds only the `beads` skill). Note a third variant location exists upstream: `~/dev/specialists/config/skills/planning/SKILL.md`, pinned by core UPSTREAM-DEPENDENCIES as the alignment target.
- Core specs: ARCHIVE-GATE, CHANGE-CONTRACT-SHAPE, SCHEMA, UPSTREAM-DEPENDENCIES, VALIDATE-JSON (all complete).
- `xtrm docs/chains.md` (complete; discovered via scope item E).

Skimmed / excerpted (declared): `chain_templates.html` (generation-check only), `current-release-snapshot.md` and `xtrm-current-execution-plan.md` §6 (relevant sections), grep-level reads of `substrate_design_en.md`/`_it.md` (background substrate canon; too large for this lane, cited by section only).

## 2. HTML vs MD

`docs/substrate/chain_templates.html` does NOT match `chain_templates.md`. It contains zero occurrences of `code-with-tests`/`test-only` and retains overlay-era headings ("§3.1 Iron — review hardening", "How overlays stack"). The md itself declares the html "not maintained going forward" — it is an old pre-restructure editorial snapshot, not a current export.

## 3. The known broken pointer — CONFIRMED

`specialists/docs/design/roadmap/chain-templates/README.md` line 5:

> **Canonical design canon** for chain templates lives in [`docs/design/chain-templates.md`](../../chain-templates.md).

The relative link resolves to `/home/dawid/dev/specialists/docs/design/chain-templates.md` — **file does not exist**. Same for `../../chain-templates.html` (line 5) and the repeated links at lines 25 (`../../chain-templates.md#3-the-template-catalog`) and 145. The real semantic canon lives cross-repo at `xtrm docs/substrate/chain_templates.md`; `roadmap/README.md` and `current-release-snapshot.md` already point to the correct GitHub URL (`https://github.com/xtrm-dev/xtrm/blob/main/docs/substrate/chain_templates.md`). The archived `iron-review-hardening-qa-chain-substrate.md` carries five more broken `../design/chain-templates.md` links (archived material, lower priority).

## 4. Terminology reconciliation (summary)

Full map with quotes in `lane-c-terminology-map.json`. Key result:

| Stratum | term | status |
|---|---|---|
| Concept | template / chain_template | canonical concept name (canon §1; substrate §6.9) |
| Artifact | formula (.formula.json) | legacy/current materialization format; explicitly not ontology |
| Materialization | molecule | bd pour product = "the chain identity"; bridge-era only |
| Runtime | chain | overloaded: worktree reuse lineage (chains.md) vs instantiated template unit (substrate §6.9) |
| Beads | root Bead / step Bead | consistent across all strata (root carries change-contract + scrutiny; step carries role labels) |
| Target ontology | ChainSource / ChainDefinition / ResolvedChain / ChainRun | ChainSource, ChainDefinition, ChainRun: **zero literal hits in either repo** — programme terms awaiting definition. ResolvedChain: defined only as a v1 residual deliverable (execution plan C1.x; completion ledger GENUINE_V1_RESIDUAL) |

## 5. Determinations (evidence-based)

1. **What remains a valid ChainSource.** Three candidate input classes exist today: (a) the 15 shipped `.formula.json` files ("Fifteen .formula.json source assets exist. They are not yet a released orchestration product." — xtrm-current-execution-plan §6); (b) spec.yaml planner beads via `<change-contract>` XML (core CHANGE-CONTRACT-SHAPE); (c) on-the-run shapes promoted per substrate §6.9.4. A defensible rule consistent with all sources: a ChainSource is any *versioned root contract* that deterministically resolves to one chain shape — i.e., formulas (legacy), spec.yaml-derived planner roots, and future user-authored JSON — while skills/reports/session transcripts are evidence, never sources.
2. **What is only legacy materialization format.** Everything bd-pour-specific: molecule identity, `needs`=blocks-on, labels-as-edge-hints + `sp chain wire-edges` post-pour helper, three search paths, extends-append semantics, pour-time-only variable substitution. README itself marks these as bridges ("substrate §22 absorbs natively").
3. **How templates stay supported without becoming the ontology.** Precedent already codified in canon §1: "When this document and a `.formula.json` disagree on step shape, the formula wins for executable shape… substrate wins post-substrate-landing." Keep semantics in the canon/ontology layer; keep formulas as compiled-from or compiled-to artifacts. current-release-snapshot.md adds the guardrail: do not report templates production-ready until compiler + persisted ResolvedChain + activation protocol exist.
4. **How user-authored JSON enters the same compiler.** The selection/compiler boundary is currently missing (execution plan gap list). The existing seam is: root contract (change-contract XML or 7-section markdown) + `recommended_template` annotation → dispatcher resolution → materialization. A pure compiler accepting both a named template reference and a user-supplied shape JSON satisfies UPSTREAM-DEPENDENCIES' "one matcher language across the system" applied at selection layer, not per artifact.
5. **How planner output becomes a ChainDefinition before Beads materialization.** Path already sketched across sources: xt spec apply emits `<change-contract>` planner bead → planner Pass-2 annotates `recommended_template` per child root (UPSTREAM-DEPENDENCIES `planning_recommends_template`) → compile step resolves template+contract into a persisted ResolvedChain → only then materialize to Beads (molecule + step beads) as a projection. Today nothing persists between resolution and pour — the exact gap C1.2/C1.3 own.

## 6. Contradictions found

1. **release-prep**: canon §3.6 (vars prev_tag/next_version; keeper bumps version + tags + pushes) vs formula (vars prev_tag/next_tag; explicit NON_GOALS no bump/tag/push; operator via /releasing). Formula wins per canon's own precedence rule; canon §3.6 stale.
2. **restitch**: canon §3.9 mermaid omits test-engineer/test-runner/obligations-scanner; formula ships the full QA tail (README agrees with formula).
3. **Catalog count**: canon md header says "13 `.formula.json` files on disk + 2 designed pending wiring" and §3.14/§3.15 "pending formula-file authoring"; 15 files ship. substrate_design_en.md says "currently thirteen" (stale vs IT rev12 "quindici"). core UPSTREAM-DEPENDENCIES says "one of 13 formulas". `_meta/2026-06-21-design-reconciliation.md` says 13.
4. **README internal**: text says 15 files ship; its catalog table lists only 13 rows (code-with-tests/test-only absent).
5. **incident_policy/failure_budget/coordinator_model**: canon §2.9/§3 claims "Every template now carries an explicit incident_policy declaration alongside coordinator_model"; NO formula file contains any of these fields. Canon describes declarations that exist nowhere executable.
6. **code-with-tests structural defect**: obligations-scanner unconditionally needs security-auditor, so a conditional (optional:sensitive) gate sits on the mandatory dependency path.
7. **premortem root type:decision** vs substrate rev9 which removed `decision` as an issue-type classifier.
8. **memory-hygiene vars**: canon scope/dry_run vs formula root_title/trigger_reason; also dry-run-first posture lost.
9. **Writer edge vocabulary inconsistent**: test-only writer uses edge:validates->root; code-with-tests writer uses edge:implements->root for the same writer→root relation.
10. **planning skill (md sections) vs core XML direction** (`planning_emits_xml_contracts`, `planning_uses_bd_swarm` pending); planning formula mandate lacks recommended_template Pass-2 entirely.
11. **test-planning skill still names `code-sanity`** as Iron seconder; role renamed `seconder`.
12. **SCRUTINY coverage holes**: doc-sync/memory-hygiene/planning/premortem/release-prep/triage/restitch carry no scrutiny label; canon's `none` tier and required-at-creation enforcement are unrepresented in artifacts.

## 7. Unique requirements to survive canonicalization (highest-value)

1. Formula-wins-for-shape precedence rule (canon §1).
2. SCRUTINY as chain property: tier set incl. `none`, floor-only-raise, auto-escalation table, quality-invariant framing.
3. Seconder dual-verdict schema; Release Checklist mandatory lines incl. findings_per_writer; ddiff delta-only loop.
4. Ambidextrous-role pattern: mode-agnostic specialist prompt + position-specific dispatch-time mandate (security-auditor ×2 classes; test-engineer ×2 positions; position:primary-writer / position:secondary-writer labels).
5. Selection/composition separation: applies_when matchers external to shapes; one matcher language at selection layer.
6. Formula/topology vs participant-lifecycle boundary (README: no workflow DSL; specialists.execution.v1 owns lifecycle).
7. Non-skippable markers (debug/restitch writers); advisory-output/operator-applies separation (triage); no-publish boundaries (release-prep).
8. ResolvedChain invariants from execution plan: deterministic compile, immutable after approval, children cannot mutate approved topology.

## 8. Dispositions

- `chain_templates.md` — keep as semantic source until substrate catalog lands; fix stale §3 header/§3.14/3.15/§3.6/§3.9 entries and incident-policy claims.
- `chain_templates.html` — archive or regenerate; current bytes misrepresent the catalog.
- `chain-templates/README.md` — keep as mechanics doc; fix broken canonical links (point at xtrm repo URL or vendor the canon); add missing table rows.
- 15 formulas — migrate into ChainDefinition corpus, then retire the format; fix code-with-tests dependency defect during migration.
- planning/test-planning skills — keep; align to XML contract + bd swarm direction; rename code-sanity→seconder.
- core specs — keep as-is except refresh formula count in UPSTREAM-DEPENDENCIES.
- `chains.md` — keep as bridge doc; honor its do-not-parse warning in any new telemetry work.

## 9. Open questions

1. Is `memory-processor` still a valid role given substrate rev10 eliminated memory-curator and moved distillation to closing judges?
2. Should ChainSource admit the `{{specialist}}` templated role (research-only) and if so what validation constrains it?
3. Which document becomes authoritative for incident_policy/failure_budget when they actually land in artifacts?
4. Does `type:bug`/`type:chore`/`type:decision` in formula roots survive substrate's class/type/role classifier split unchanged?
5. Where do the two non-.pi skill variants (`~/dev/specialists/config/skills/planning/SKILL.md`, deployed mirrors) sit relative to `~/.pi/agent/skills/` copies — which is upstream?

No canonical files were modified. Outputs written only under `docs/runtime/reconciliation/lanes/lane-c-*`.
