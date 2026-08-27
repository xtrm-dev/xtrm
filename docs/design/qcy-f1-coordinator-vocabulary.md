# F1: Coordinator authored-position vocabulary (xtrm-2hn.5)

## Decision

Option (B): `coordinator` is a fourth structural authored class.
`StepClassSchema = z.enum(["step", "gate", "advisor", "coordinator"])`.
Coordinator entry/close positions author as `class: "coordinator"` and
round-trip verbatim; no loader or parity shim remaps them.

## Options weighed

- **(A) coordinator = participant role + ordinary step/gate position.** The
  runtime would infer coordinator powers from the bound specialist role
  (e.g. `chain-coordinator`). Authored roles are template-dynamic — the
  loader substitutes `role:"{{specialist}}"` from vars — so inference means a
  string-naming heuristic over dynamically-bound values. New machinery,
  drift-prone, and it would have to feed the same seams class already feeds.
- **(B) coordinator is a structural authored class.** One enum line; runtime
  consumes it already.

## Evidence

- Authority seams key on the literal `"coordinator"` class today:
  `src/channel-comm/index.ts` `COORDINATOR_CLASSES = ["coordinator","runtime"]`
  gates `control.steer`, inbox visibility and escalation routing;
  `src/finalize/index.ts` `VOID_ACTOR_CLASSES` includes `"coordinator"`;
  `src/chain/scheduler.ts` `makeIdentity` copies `step.class` into
  participant identity that feeds those checks. `ViewerClass =
  ParticipantClass | "operator"` and `ParticipantClass` already includes
  `"coordinator"` (`src/chain/types.ts`); hard-coded topology positions carry
  `class:"coordinator"`.
- Only authored-side narrowing on class is `validateInlineTopology`'s
  `gate.class !== "gate"` check — indifferent to widening. No exhaustive
  switch over `StepClassSchema` exists anywhere in EXP.
- Total diff under (B): one schema line, data file truthed, parity `mapClass`
  shim deleted — net deletion. (A) adds an inference layer plus dual
  bookkeeping while runtime semantics stay class-keyed.

## Consequences

- Authored-form equality with the hard-coded topology is now exact without
  shims (`tests/sre-data-parity.test.ts`, fingerprints equal as-authored).
- The formula-variant FORCED DEVIATION (root executor synthesis) remains:
  it concerns specialist/executor binding, not class vocabulary.
- Residual: generic-materializer implications of coordinator-class steps
  (power granting at activation) live in q99/C1.4 scope, not here.
