<!-- NORMATIVE MIGRATION REFERENCE (ruling: docs/substrate/skill-migration-gate.md generator note).
     Not an installed or canonical runtime source. The operational canonical sources are Core
     `.xtrm/skills/default/<skill>/SKILL.md` (engineering-quality review reference) and
     Specialists canonical config assets (reviewer/seconder dispatch guidance), applied/generated
     by A9 after A5 (generators: xtrm-6qu.8, §47; promotion path A8→A9 per
     docs/substrate/skills/canonical-promotion-map.md). This xtrm doc alone changes no installed behavior.
     Do not hand-edit installed copies to pass the gate; fix the reference here, then regenerate
     and reinstall through the A8→A9 path. Service-knowledge skill files are out of scope
     entirely (O3 fence: xtrm-56flm / xtrm-401 / xtrm-crz own that machinery).
     Gate: SKILL-MIGRATION-GATE as defined by xtrm-6qu.4 (fenced reference; ADR wins). -->

# Review (canonical Substrate-native doctrine)

Review judges a pinned Issue revision against what execution actually produced. It
does not re-author the contract in a comment thread.

If Substrate reports this repository is uninitialized: run `sb init`.

```text
sb init
```

Never guess the only project, invent a project id, or manually create/link
during normal work.

## What the reviewer consumes (§36)

```text
Issue revision
PROBLEM
SUCCESS
SCOPE
NON_GOALS
CONSTRAINTS
VALIDATION
OUTPUT
provenance
implementation diff
relevant Journal findings / decisions
```

Live reads:

```text
sb issue show <ref>                 # exact revision under review
sb issue validate <ref>             # revision still structurally valid
sb issue attest <ref> --outcome ready|reject   # readiness attestation state
sb provenance trace <ref>           # what execution produced (not what it claimed)
sb journal since <ref> <cursor>     # findings/decisions after the last checkpoint
sb journal show <ref>               # bounded history when the delta is insufficient
```

Read the contract first, then the actual diff and relevant current source, then
provenance and journal evidence, then existing review/automation findings —
verifying each against the pinned revision. Prioritize correctness, state and
resource safety, compatibility, migrations, failure behavior, security
boundaries, observability, rollback/recovery, and missing behavioral evidence.
Bot and model findings are leads: confirm the cited line, symbol, and mechanism
before blocking. A useful finding states location, problem, failure mechanism,
evidence, and the required correction or contract conflict.

## Authority rules for reviewers

- The executable contract is the ready Issue revision (PROBLEM, SUCCESS, SCOPE,
  NON_GOALS, CONSTRAINTS, VALIDATION, OUTPUT, plus SCRUTINY/ownership/context).
  A fresh reviewer reaches the reviewable state from Issue revision + Resume Capsule +
  journal delta alone, **without previous chat history**.
- A review finding that changes authorized requirements (SCOPE, SUCCESS,
  NON_GOALS, CONSTRAINTS, VALIDATION, OUTPUT, ownership, or scrutiny) causes a
  planning/revision cycle: stop → `/planning` → new Issue revision
  → new readiness attestation → execution resumes. The old readiness
  is invalid on the new revision.
- **A reviewer comment does not silently mutate the task contract.**
  **Journal != Issue**: neither the review thread nor a journal entry changes
  executable authority.
- **Journal != Memory**: review observations do not auto-become reusable truth.
- **Messages != authority**: review discussion coordinates; it never silently
  changes the contract.
- **Provenance != progress notes**: the implementation summary is a claim;
  the reviewer checks `sb provenance trace` and the live tree/tests/runtime,
  not the author's narrative.
- Test and security gates are enforced, not reinterpreted: never downgrade a
  valid failing gate to advisory because the diff looks plausible. Classify
  failures (in-scope regression / pre-existing / infrastructure) before
  redirecting the fix.

## Verdict and fix loop

Distinguish blocking findings, non-blocking follow-ups, and external blocks.
Valid blocking findings require a fix loop in the owning implementation role and
a re-run of the affected gate — not a summary dismissal. If rejecting a material
finding, record why it is invalid with evidence.

Record the review where durable continuity warrants it
(`sb issue note <ref> "…" --kind finding|decision`, checkpoint at the review
boundary), keep entries bounded, and never put long transcripts in the Journal.
Notes are append-only and never bump the revision; do not journal every shell
command — record findings with evidence, not a command log. Kind meanings
(finding/decision/blocker/milestone/handoff/note) are owned by the implementation
reference; the reviewer consumes findings and decisions, never redefines them.

Canonical kind mapping (ADR §73):

```text
material fact
→ finding

architectural choice
→ decision

blocked condition
→ blocker

progress boundary
→ milestone

handoff
→ handoff

completed bounded run
→ result

ordinary useful annotation
→ note


authorized work changed
→ STOP
→ /planning
→ new Issue revision
```

Reviewers and validators are actors. Their durable output may include a Journal
result, Journal findings, validation refs, and receipt/evidence refs. Example
outcome `PASS_WITH_NOTES` with findings listed plus evidence refs. No commit
required. Ordinary workers journal high-signal durable facts only: a material
finding, an important decision, an external blocker, a meaningful milestone, a
handoff, a result, and a checkpoint. Do not journal every shell command, every
tool call, chain-of-thought, transient speculation, or routine exploration.

## Handoff, close, and compaction around review (§§19–20)

Review handoff = Issue stays authority + bounded Journal handoff/checkpoint
entry (`sb issue note <ref> "…" --kind handoff`) + blockers + known pending work + provenance refs;
the next worker restarts from `sb issue resume <ref>`. Before exit, closeout, or compaction,
write the mechanical checkpoint first (`sb journal checkpoint <ref>`), then
continue from the capsule. If any summary disagrees with Issue/Journal/
provenance state, durable Substrate state wins.

Review lanes close through the lifecycle surface
(`sb issue state <ref> done`, or the `close|reopen|defer|cancel|archive`
aliases; `sb issue close <ref> --outcome <o> --reason <r>` writes the structured
Closure with result, receipt, validation, artifact refs) after validation + provenance + checkpoint, with the claim released
(`sb issue claim <ref> --holder <who>` to acquire, `sb issue release <ref> --holder <who>`
to release). A claim is an atomic lease, not an assignee label, and review-lane
mutation requires a live claim on the Issue. Substrate provides no
workspace-exclusion guarantee: the Specialists activation layer owns workspace
exclusion.

Before closure: SUCCESS satisfied, VALIDATION complete, required OUTPUT exists,
material result durable, important decisions/findings durable, provenance
sufficient, and no incompatible blocker remains. Do not close solely because a
commit exists. Contract changes use only `sb issue edit` and `sb plan apply`;
progress uses the Journal.

Coordinator workflows periodically inspect children, claims, pending asks, new
results, blockers, provenance, and release gates, and journal only material
root-level state. No giant rewritten root description. No child transcript
duplication.

No active Beads commands. Historical Beads references, where unavoidable, are
explicitly marked as history ("retired", "formerly", "migration") and never as
live workflow. Contract repair always routes through `/planning`; missing scope
is never smuggled into prompts, messages, or journal entries.
