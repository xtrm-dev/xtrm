# Skill Migration Acceptance Gate (SKILL-MIGRATION-GATE)

**Status:** normative definition (the gate itself is doctrine, not runtime). **Owner:** xtrm-6qu.4 (defines it here);
xtrm-6qu.5 applies it to specialist/review skills; xtrm-6qu.10 enforces it in
acceptance. **Source ADR:** sbcloseout2 §§37, 13–18, 21, 23.
Where this document and the ADR disagree, the ADR wins and this document must
be revised.

## G0 — Fail-fast (Beads-rename rejection)

**FAIL** a skill whose workflow is the previous Beads workflow with command
names substituted (`bd` → `sb`, "bead" → "Issue", "notes" → "journal").
A migrated skill teaches the Substrate-native methodology of §§13–18
(Issue → readiness → claim/lease → Resume Capsule → execution → Journal →
validation → provenance → handoff/close), not a renamed Beads lifecycle.

## The 16 checks

Each check names the doctrine, what the skill must contain, and how to verify
it. "Static" = mechanically checkable in the skill source. "Live" = exercised
against a real `sb` CLI/database during validation.

| # | Check | Doctrine | Skill must | Verify |
|---|-------|----------|------------|--------|
| G1 | Issue revision as executable authority | §2–§3, §14 | State that a **ready Issue revision** is the executable contract; name the seven contract fields (PROBLEM, SUCCESS, SCOPE, NON_GOALS, CONSTRAINTS, VALIDATION, OUTPUT) plus SCRUTINY/ownership where the skill authors or consumes contracts. | Static: `PROBLEM`…`OUTPUT` and `revision` present. Live: `sb issue show <ref>` displays the revision the worker executed. |
| G2 | Readiness before execution | §3, §16–§17 | Require validating readiness before execution and re-validating after any execution-relevant change; name `sb issue validate` and attestation (`sb issue attest --outcome ready\|reject`). | Static: `validate` + `attest` present. Live: validate/attest transcript on a scratch issue. |
| G3 | Claim / workspace-lease ownership | §2, §17, §25 | Teach atomic leased claims (`sb issue claim <ref> --holder`, `sb issue release`); state claim ≠ assignee field and that mutation requires the writer lease. | Static: `sb issue claim` present; no `assignee`-as-authority wording. Live: claim/release round-trip. |
| G4 | Journal as typed execution continuity | §15, §22 | Teach the Journal as append-only execution continuity with the landed kinds. `sb issue note <ref> --kind note\|finding\|decision\|blocker\|milestone\|handoff` (convenience) and `sb journal append\|checkpoint\|show\|since\|render` (mechanical payloads); domain kinds checkpoint/handoff/milestone/decision/finding/blocker/compaction/note. Entries never bump the revision. | Static: journal verbs present. Live: note appends without revision bump. |
| G5 | Correct kind usage | §15, §35 | Map each kind to its meaning: finding (observation), decision (choice + reason), blocker (external dependency), milestone/checkpoint (progress boundary), handoff (continuation), note (ordinary annotation). Warn against journaling every shell command. | Static: per-kind guidance present. |
| G6 | Mechanical checkpointing at durable boundaries | §17, §19 | Require a durable checkpoint (`sb journal checkpoint`) before handoff, close, compaction, or exit; mechanical state first, semantic enrichment optional and never a substitute. | Static: `checkpoint` present with mechanical-first wording. |
| G7 | Resume Capsule + Journal delta | §18 | Teach `sb issue resume <ref>` as the restart primitive and `sb journal since <ref> <cursor>` for delta reads; forbid dumping full history or reconstructing from chat. | Static: `resume` + `since` present. Live: resume capsule renders. |
| G8 | Planning on authority change | §16, §32 | On SCOPE/SUCCESS/NON_GOALS/CONSTRAINTS/VALIDATION/OUTPUT/ownership/scrutiny change: stop → `/planning` → new revision → new readiness → resume. Forbid smuggling new scope into prompts, messages, or journal entries. | Static: stop-and-revise wording present. |
| G9 | Journal ≠ Issue | §2, §14–§15 | State progress/continuity entries never modify the contract; only a planning revision changes executable authority. | Static: explicit `Journal != Issue`-class statement. |
| G10 | Journal ≠ Memory | §23 | State findings do not auto-become reusable truth; no `remember`-style capture inside the Journal. | Static: explicit `Journal != Memory` statement. |
| G11 | Messages ≠ authority | §2–§3 | State channel messages coordinate but never silently change the contract. | Static: explicit messages-are-coordination statement. |
| G12 | Provenance ≠ progress notes | §2 | State executor summaries are claims; record what execution produced via provenance (`sb provenance dispatch\|trace\|receipt`), separate from journal progress. | Static: provenance distinct from journal wording. Live (where applicable): provenance trace renders. |
| G13 | Handoff methodology | §20 | Handoff = Issue stays authority + Journal handoff/checkpoint + blockers + pending work + provenance refs; next worker uses the capsule. No long transcripts in the Journal. | Static: handoff entry shape present. |
| G14 | Close/release methodology | §17, §26 | Close via the lifecycle surface (`sb issue state <ref> done\|…` or the `close\|reopen\|defer\|cancel\|archive` aliases) after validation + provenance + checkpoint; release the claim. | Static: lifecycle + release wording. Live: state round-trip. |
| G15 | No required dependence on chat history | §18 | A fresh worker reaches the executable state from Issue revision + capsule + journal delta alone. | Static: "without previous chat / without chat history" guarantee stated. |
| G16 | No active Beads commands | §4, §30 | No active-workflow `bd …`, `bv …`, Dolt-as-Beads, `@beads/bd`, `bd prime/ready/show/update/close/note/state/dep/hooks/doctor` instructions. Historical mentions are allowed only when explicitly marked as history (e.g. "retired", "formerly", "migration"). | Static: fail on active `bd ` verb patterns; allowlist history-marked lines. |

## Per-skill applicability

- **using-xtrm** (§31): all 16. It is the doctrine spine.
- **planning** (§32): G1, G2, G8, G9, G13–G16 mandatory; G3–G7, G10–G12
  referenced via the worker lifecycle, restated only where planning touches
  them (ownership/context, overlap, plan check/apply, readiness).
- **starting-and-resuming-work** (§33): G1–G4, G6–G7, G13–G16 mandatory;
  G5, G8–G12 by reference to using-xtrm/planning (one line each, no forked
  doctrine).

A skill passes when every applicable check holds statically **and** the live
evidence for its taught verbs exists (see below). Non-applicable checks must
still not contradict the doctrine.

## Live-evidence rule (per-skill validation)

Static checks alone never pass the gate. Each migrated skill ships with a
live transcript produced in a real environment (scratch database or scratch
issue on the real service):

- using-xtrm: create → edit (metadata vs execution-bearing) → note (no bump)
  → validate → attest → claim → resume capsule → journal checkpoint →
  state/close → release.
- planning: draft → `sb plan check` (including a failing draft) →
  `sb plan apply` → readiness attestation on the created issue.
- starting-and-resuming-work: `sb issue show` (revision) → claim →
  `sb issue resume` → `sb journal since` delta → continue → checkpoint.

`packages/substrate/tests/skill-migration-gate.test.ts` executes this
evidence on scratch databases in CI.

## Generator/consumption note

This document and `docs/substrate/skills/*.md` are **normative migration
references** (ruling seq 97) — not installed or canonical runtime sources.
The operational canonical sources are Core
`.xtrm/skills/default/<skill>/SKILL.md`, applied/generated by A9 after A5
(generators: xtrm-6qu.8, §47). Do not hand-edit installed copies to pass
this gate; fix the references here, then regenerate and reinstall through
the A8→A9 path.
Service-knowledge installed skill files are out of scope entirely (O3 fence:
xtrm-56flm / xtrm-401 / xtrm-crz own that machinery).
