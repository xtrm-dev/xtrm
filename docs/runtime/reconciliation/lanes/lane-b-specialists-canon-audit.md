# Lane B — Specialists Canon Audit

**Repo:** `/home/dawid/dev/specialists` @ master `0253e3e4b823de419bf1acc54f07eb618e10a054`
**Scope:** roadmap + PRD + chains-prompt-evals + execution-protocol pair + history trio + design/README pair + ARCHITECTURE/architecture duplicate check + TODO.md.
**Read completeness:** every listed file read completely (chunked where >50KB). Blob SHAs, bytes, lines: `lane-b-source-register.json`.
**Bead:** xtrm-cn8.1 (child of epic xtrm-cn8).

---

## 1. Authority map (as claimed by the documents themselves)

`current-release-snapshot.md` ("Authority by claim type") and `roadmap/README.md` agree:

| Claim type | Authority |
|---|---|
| Release identity / delivered-vs-unimplemented | released packages → current code → `current-release-snapshot.md` |
| Sequencing and promotion gates | XTRM current execution plan (+ JSON) in the **xtrm** repo (external to specialists) |
| Runtime architecture, Opportunities, semantic decisions | `specialists-roadmap.md` + execution-protocol ownership decision + chain-template canon |
| Programme scope, invariants, WP gates, success criteria | `enhanced-prd.md` |
| Implementation tasks/completion | repository-local Beads + Git evidence |

The PRD adds a binding precedence list (§ Revision 2026-07-24): code → installed Beads binary → Core v0724 audit → roadmap → PRD → Jira/Beads projections. The snapshot explicitly does **not** override accepted architecture or PRD scope; it supersedes only current versions/drift/classification.

**Contradiction found:** `docs/design/audit-reconcile-v0724.md` in this repo is an **empty file** (git empty blob), yet `enhanced-prd.md` names it as canonical audit-closure evidence. The real content lives in `xtrm-dev/core/docs/design/audit-reconcile-v0724.md` per the PRD companion list. Either delete the stub or replace it with a pointer.

## 2. WP continuity

90 stable work-package identifiers exist across `enhanced-prd.md` §15 and its predecessor `chains-prompt-evals.md` §15. Full per-WP rows with titles, claimed status, delivery evidence and residual risk: `lane-b-wp-continuity.json`.

Families: G00–G03 (gates/docs), T01–T07 (telemetry), E01–E10 (eval core), P01–P09 (prompt/policy), XP01–XP07 (execution protocol), C01–C10 (chain foundation), M01–M06 (memory), S01–S08 (role suites), U01–U06 (Console), IC01–IC13 (interactive coordinator), H01–H05 (policy hooks), X01–X05 (deferred Channels). `WP-XX` / `WP-YY` are contract-template placeholders, not work packages.

Key continuity facts:

- **No WP id appears anywhere in this repo's Beads export.** `grep -o 'WP-[A-Za-z0-9]*' .beads/issues.jsonl` over 4081 issues returns zero matches. The PRD mandate ("each Bead title or metadata must retain its `WP-*` identifier", §15.1) was not applied to the local board. Traceability currently runs only doc→doc.
- **current-release-snapshot.md references no WP ids either.** Its classification is capability-level ("chain templates", "telemetry", "coordinator"), so WP-level delivery mapping is an inference, not an authoritative claim. Detailed workstream IDs were moved to the external xtrm execution plan.
- Several WPs have **divergent definitions between the two PRDs**: G02, C03, C05, M01 (enhanced-prd expands them with pool-aware claim, proxied-server matrix, Dolt tuple). enhanced-prd is the later consolidation record and is authoritative; chains-prompt-evals wording is superseded.
- Delivery state per snapshot: E-family, XP-family (released runtime), C02/C03/C05 chain spine, M-family pull model, T07/S08 telemetry-integrity-v1, Eval Core and `sp eval` are all listed as **not implemented as released runtime**. Delivered adjacent surfaces: interactive coordinator bridge persona (IC07–IC10 territory), forensic/Prometheus foundations (T05 territory), structured run/feed/result surfaces.

## 3. Current Opportunities / anchors

- Roadmap **v3.3** names exactly one Opportunity in body text: **Opportunity 19 — deterministic Specialist execution protocol** (§3), cross-referencing the protocol design doc. All other historical Opportunities live only in `history/specialists-roadmap-v3.2-2026-07-24.md` (Opps 1–18) and are referenced by the PRD as prerequisites (Opp 2 READ_ONLY path binding, 3 persisted shape, 4 composition gate, 5 step identity, 8 minimal bridge, 10 chain-driven dispatch, 11 pull memory, 16 SCRUTINY).
- Current sequencing anchors are **not** Opportunities but: R0 → DO0.1…DO0.6 (roadmap §5) and AC0 → Phases 0–11 (PRD §16). Snapshot's critical path: deterministic command outcomes → minimum specialists.execution.v1 → chain compiler/ResolvedChain → manual composition gate → evidence reducer + scheduler intents → coordinator shadow mode → Eval Core + measured authority promotion.
- Stale anchor data: `docs/design/README.md` still says "12 opportunities, 8 phases … decisions D1–D30" and "13 formula files"; reality is v3.3 baseline, 15 formulas in source (snapshot), and DO0 phases. Index needs a refresh pass.

## 4. Execution protocol invariants (quoted)

Canonical phase sequence (`specialist-execution-protocol.md` §3):

> "runtime-owned PREPARE → typed agentic PLAN → typed agentic EXECUTE → runtime-owned FINALIZE"

Normative distinction (same section):

> "agent finished ≠ protocol completed / result exists ≠ result validated / job completed ≠ chain step satisfied / mandatory rules delivered and acknowledged ≠ mandatory rules complied with"

Ownership decision invariants (`...ownership-decision.md` §Invariants, verbatim):

1. "A structurally NOK contract cannot proceed."
2. "A mandatory-rule conflict cannot proceed silently."
3. "Read-only roles cannot acquire write or commit capability through a step contract."
4. "A local execution plan cannot widen Bead scope."
5. "A model-completed job is not successful until output, evidence and Git policy validate."
6. "Result persistence precedes Bead note and parent notification."
7. "Notification failure does not alter the authoritative job verdict."
8. "Finalization side effects are idempotent."
9. "Chain satisfaction is derived from validated evidence, not self-report."
10. "Worktree cleanup remains separate from activation cleanup."

Roadmap §3.2 protocol invariants add: phase state persisted before side effects acknowledged; typed+validated evidence before satisfaction; observe mode collects without advancement authority; shadow/warn/enforce require measured promotion criteria. Fail-closed rule and precedence chain (`runtime safety invariant > mandatory rule > role capability boundary > step contract > agent local plan`) are in protocol §§5.2, 12. Status: **proposed canonical design**; snapshot confirms executable profiles/reducers are not yet shipped, so these remain forward requirements, not descriptions of shipped behavior.

## 5. Old baseline/revision material that should become history

Already history-marked: `history/specialists-roadmap-v3.2-2026-07-24.md` (banner present), `substrate-reconciliation.md`, `handoff-from-substrate-design.md`, PRD Appendix I/J (historical-disposition notice present), PRD §15.13 wave table (freshness note present), PRD embedded 24 July release table (superseded for versions/classification by snapshot per its Supersession boundary).

Still living in current files but stale and should move to history or be corrected:

- `chains-prompt-evals.md` itself — see §12.
- PRD revision sections v3.1/v3.2 headers describing releases `0.11.2/0.2.2/3.21.1` — superseded by snapshot trio `0.11.4/3.21.2/0.2.3`; keep as revision record but flag that any current-state quote must go through the snapshot.
- `docs/design/README.md` counts (12 opportunities / 13 templates) and references to `temp_roadmap.md` reconciliation via `unitAI-sc03v`.
- Empty `docs/design/audit-reconcile-v0724.md` stub (delete or point at core).
- Roadmap v3.3 §0 baseline table (Core 0.11.3 etc.) predates the snapshot's 0.11.4 — snapshot wins for current versions; roadmap §0 is now a historical verification record.

## 6. Old runner/supervisor responsibilities stated anywhere

- **ARCHITECTURE.md (current reference)**: runner injects caveman directive, GitNexus mandate, static workflow rules, keyword-filtered memories (FTS cache, MAX 600 tokens), GitNexus pre-query; supervisor owns durable lifecycle (status.json/events.jsonl/result.txt), FIFO steering, keep-alive waiting state, stall detection, crash recovery, bead auto-append/auto-close, auto-commit checkpoints, context denormalization, GitNexus accumulator.
- **History v3.2**: runner previously injected full `bd prime` + `.xtrm/memory.md` (~3.8k tokens) — replaced by the keyword-filter pipeline (Opp 11 partially realized); `sp finalize` keep-alive close ritual exists as procedural compensation (§9).
- **PRD**: runner-injected blocks (Run Context, output-style, GitNexus mandate, static Beads close checklist) are targets of WP-P04 consolidation; supervisor/event-consumer owns post-run eval enqueue (§11.4) with recursion exclusion.
- **Protocol design**: finalization (commit → result → note → notification → cleanup) must migrate from prompt/model discipline into runtime-owned FINALIZE — i.e., several current supervisor/runner responsibilities are slated to be re-owned by the protocol shell (XP06).

## 7. Chain assumptions that are template-only and must generalize to arbitrary ChainSource

The canon repeatedly hardcodes the bd-formula realization where a ChainSource abstraction is required:

- "Fifteen formula files exist in source… The semantic canon is [xtrm chain templates]" (snapshot). Formula mechanics (`bd mol pour`, `needs`→blocks edges, labels `edge:*->*`) are the *current* source, not the semantic model.
- Roadmap README: "one pure compiler emits a persisted `ResolvedChain`" — compiler input must be any declared topology source, not `bd cook` specifically.
- History v3.2 §13: catalog schema findings verified against the bd binary (`formula` key, int version, vars map, `applies_when` silently dropped) — all bd-specific; the resolved-shape JSON (Opp 3) and `<chain-context>` envelope (C06) are already source-agnostic shapes.
- PRD §2.2: molecule-as-chain-identity is described as "the formula catalog represents…" — the identity model (root child + step children + semantic edges) must survive a non-formula ChainSource; `kind:step` label-as-truth is the invariant to preserve (substrate-reconciliation §B.4), while title-pattern hints and `bd dep` command specifics are incidental.
- Coordinator doctrine (IC03/IC04) currently teaches discovery "from the canonical formula catalog"; IC13 already requires switching to resolved-shape/composition APIs — that is the generalization path; anything else referencing the catalog directly is template-coupled.

## 8. Eval entities and grader architecture (described)

Entities (PRD §9.3, identical in chains-prompt-evals §9.3): suite, case, experiment, trial, artifact, score, pairwise comparison, human annotation. SQLite schema proposed for `eval_suites/cases/experiments/trials/scores/pairwise_results/human_annotations` with field lists quoted in both docs. Forensic event catalog: 19 `eval.*` events (§9.5). Grader hierarchy: environment/state → deterministic trace → deterministic artifact → model grader → human adjudication, cheapest-reliable-first; `EvalGrader` TS interface (id/version/type/supportedRoles/requiredEvidence/grade). Hard gates before quality vector; cost reported separately; role scorecards for reviewer/executor/seconder/test-engineer/researcher/overthinker; initial suites S01–S08; promotion policy example YAML with hard_requirements. Post-run/post-chain continuous evaluation with recursion exclusion; backfill commands `sp eval backfill --repo .|--all-repos`. All of this is design-only today (snapshot: Eval Core and `sp eval` not implemented).

## 9. Prompt/memory/telemetry requirements still alive

Alive (unimplemented per snapshot):

- Prompt: P02 canonical status/verdict vocabulary + merged JSON Schema SSOT; P03 removal of duplicate handoff/output rules; P04 role-aware runner injections; P05–P08 slim prompts; P09 factorial experiments. Acceptance thresholds (schema validity ≥99.5%, false-PASS non-regression, etc., PRD §18).
- Memory: M01 provenance/ranking gap analysis precondition; M02 bounded wrapper only if Beads proves insufficient (PRD §0.5.2 #6); M03 disable eager injection behind flag — note the *shipped* runner still eagerly injects keyword-filtered memories (ARCHITECTURE.md §0), which is exactly what M03 targets; M04 recall rule; M05 telemetry/graders; M06 A/B rollout.
- Telemetry: T01 tool-call dedupe by `tool_call_id`, T02 thinking spans, T03 timing, T04 think/thinking query fix, T05 forensic→Prometheus wiring (families implemented in renderer but not fed — PRD §2.9), T06 candidate fingerprint, T07 telemetry-integrity-v1 suite (explicitly residual in snapshot).

## 10. Interactive coordinator bridge requirements still alive

Alive: two launch modes (preheated standby with `role.ready`, direct tracked `--bead` with render-before-provision), readiness handshake `starting → agent.ready → idle` and secure prompt-file pointer delivery (no argv/pane-metadata leakage), one-complete-Bead-context-exactly-once rule, coordinator four duties (entry gate / borderline judge / hygiene via peers / close-time judge), mechanical-only peer vocabulary (`role.ready`, `collision.notice`, `escalation.*`, …), conflict matrix artifact, `interactive-coordinator-v1` eval suite, parent retains vision/merge authority. Released already (snapshot): interactive bridge persona, terminal parent notifications, xtmux reply/monitor semantics. Residual (snapshot): reducer input, bounded authority, incident/close/recovery semantics; IC13 integration with resolved chain shape blocked on C02/C03.

## 11. Obsolete Substrate/Channels "future" assumptions already resolved elsewhere

| Assumption | Where stated | What claims resolution |
|---|---|---|
| Channels v0 subsumes Opp 8 `step_completed` | handoff §3, history v3.2 | PRD §13.4 + C09 retirement trigger "Channels 0.1 acceptance"; snapshot keeps Channels as future |
| Substrate arrives "in about a month"; sp→sb rename-pass migration | handoff §1/§2, history §11 | Roadmap v3.3 §4: Substrate/Channels are replacement targets behind reviewed cutover criteria; PRD §0.2 runway assumptions fixed by operator; monorepo deferred (§0.4.2) |
| Workspace identity internal/container-scoped | substrate-reconciliation §C | Adopted early as Opp 10/`--chain` (history); current dispatch semantics owned by WP-C05 native claim/pool rules |
| Dolt engine choice open | handoff Category A Q#1 | PRD §0.5.2 #7/#13: Dolt pinned for bridge runway; v2.2.0 tuple for ≥3fea705 builds; alternatives = watch item |
| Chain-coordinator transient substrate role vs bridge persona | handoff §2 | PRD §2.12 explicit lifecycle/scope distinction retained under same name during bridge |
| `opened_by: synthetic-pre-substrate:<first-job-id>` migration marker | substrate-reconciliation §C, history §11 | Still future; no container table exists; nothing resolved beyond decision record |
| Memory-as-capability eliminates curator; close-time distillation | handoff/history | Pull half alive as M-family; distillation deferred (three-lens memory unimplemented per snapshot) |

## 12. Is chains-prompt-evals.md fully superseded by enhanced-prd.md?

Method: section-by-section comparison of both fully-read documents plus the PRD's own consolidation record ("retained approximately 98.6% line-for-line, added ~1,170 lines"). Verdict: **substantively yes — treat chains-prompt-evals.md as superseded historical evidence**, with the residuals below.

Identical requirement sets (verbatim or near-verbatim): §2 background/current-state, §3 problem statement, §4 goals/principles, Workstreams A–E bodies (prompt modernization, chain context envelope, memory, telemetry corrections incl. thinking-span model and metric families, evaluation platform incl. entity/schema/grader/scorecard/promotion designs), Console product requirements, CLI/API recommendations, security/governance, decomposition contract, Appendices A–E (role prompts, chain-participant rule, memory rule, grader catalog, metrics catalog) and H (dispatcher checklist, extended in PRD).

Unique to chains-prompt-evals.md (must be carried forward or consciously dropped):

1. **Open decision #2**: whether eval tables live in every per-repo observability DB or a separate namespace within the same file (recommends same per-repo DB initially). Not restated in PRD §20.
2. **Open decision #10**: how package/installation-local skill references are resolved and fingerprinted when they are not repository files. PRD covers skill hashing generally but drops this explicit open question.
3. **Open decision #14** (which WPs the operator starts concurrently) — superseded by PRD §15.13 lane table + freshness note; safe to drop.
4. Historical deltas now superseded: narrower G02/C03/C05/M01 wordings; dated-reconciliation filename `2026-07-12-…` (PRD uses `2026-07-13-…`); parallel wave lanes A–I (PRD A–L); rollout missing Phases 2A/4A and AC0; Appendix F citing `using-specialists-v3/SKILL.md` and xtmux README (PRD cites `using-specialists/SKILL.md`, core xt-pi-role, xtmux observability-redesign).
5. Precedence list omits installed-Beads-binary layer (PRD adds it as #2).

Recommendation: mark the file historical (banner like the v3.2 archive) after porting residuals 1–2 into the PRD §20 open-decision lists or the successor requirements doc.

## 13. Duplication and contradiction register

- **Duplication**: chains-prompt-evals vs enhanced-prd (~98% content overlap, mechanically confirmed on requirement sections). ARCHITECTURE.md vs architecture.md: **not duplicates** — different blobs, different scope (runtime boundary doc vs cache-layout addendum); rename suggestion optional, no merge.
- **Contradictions**:
  - Empty `audit-reconcile-v0724.md` cited as evidence (see §1).
  - Roadmap §0 released Core `0.11.3` vs snapshot `0.11.4` — snapshot authoritative; roadmap §0 is stale-on-arrival for versions.
  - design/README opportunity/template counts vs v3.3/15-template reality.
  - PRD says Specialists parent notification starts with terminal `done|error|cancelled`; ARCHITECTURE.md documents `run_complete` emitted per turn for keep-alive — compatible only under the documented breaking-change gating rule; consumers must gate on terminal status.
  - History v3.2 Phase table vs v3.3 R0/DO0 sequence — v3.3 wins; archive banner already says so.

## 14. Unique requirements that must survive canonicalization

1. The ten ownership-decision invariants (§4 above) — quoted normative text.
2. Fail-closed + precedence chain (protocol §5.2/§12).
3. `job completed ≠ step satisfied` and evidence-derived chain satisfaction.
4. WP-* identifier stability mandate (PRD §15.1) — currently unenforced in Beads; either enforce or formally retire the mapping duty.
5. Bridge-ledger requirement (roadmap §4.2): every active bridge records failure mode, authority/target, cutover owner, instrumentation, drift check, deprecation state, retirement gate, rollback.
6. Anti-steal claim semantics: never `unclaim; claim` takeover; pools are dispatch metadata (PRD §0.5.2 #4/#11, C05, IC10).
7. Secure prompt-file pointer transport + readiness-gated delivery + no-leak acceptance criteria (PRD §12.6, §18.7).
8. One compiler / one persisted ResolvedChain / one pure reducer / one effect executor / one activation protocol (roadmap §5.1 DO0 invariants).
9. ChainSource generality (§7 above): semantic model independent of bd-formula mechanics.
10. Snapshot supersession boundary (versions/classification only; never silent redesign or scope deletion).

## 15. Suggested dispositions

| Artifact | Disposition |
|---|---|
| chains-prompt-evals.md | Move to history/ with banner; port open-decision residuals first |
| docs/design/audit-reconcile-v0724.md (empty) | Replace with pointer to core file or delete |
| docs/design/README.md | Refresh counts/index; drop unitAI-sc03v reference if closed |
| roadmap §0 baseline table | Mark as historical verification record; snapshot owns versions |
| history trio | Keep as-is; banners correct |
| ARCHITECTURE.md / architecture.md | Keep separate; optionally rename addendum to `architecture-cache-addendum.md` |
| TODO.md | Delete or populate; frontmatter stub has no function |
| WP continuity | Enforce WP-id retention in beads OR record formal abandonment of the mapping duty; G02 closure evidence needed before C01–C05 dispatch |

## 16. Open questions

1. Does the external xtrm current-execution-plan carry WP ids (restoring traceability) or did the WP namespace die with the last PRD revision? (Out of this repo; needs xtrm-side check.)
2. Was WP-G02 ever closed against the installed binary? No closure artifact found in this repo.
3. Are IC07–IC10 fully delivered, or only their released subset (snapshot lists persona + notifications as released but coordinator recovery/incident semantics as residual)? Needs code-level verification.
4. Should `specialist_id` legacy fields be renamed to participant vocabulary before or after substrate state.db (open in history Opp 18 remaining scope)?

## 17. Evidence paths

- This lane: `docs/runtime/reconciliation/lanes/lane-b-specialists-canon-audit.md`, `lane-b-wp-continuity.json`, `lane-b-source-register.json`
- Source repo: `/home/dawid/dev/specialists` @ `0253e3e4b823de419bf1acc54f07eb618e10a054` (worktree clean except `.beads.gate.lock*`)
- Beads scan: `grep -o 'WP-[A-Za-z0-9]*' .beads/issues.jsonl` → 0 matches across 4081 issues
- Tracked under: xtrm bead `xtrm-cn8.1`

**No canonical files modified.**
