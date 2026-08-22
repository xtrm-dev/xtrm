# ADR-001 — Chain authoring and compilation

> Status: ACCEPTED · Date: 2026-08-22 · Supersedes: template-only C1 model in execution plan §C1
> Evidence: [runtime-decision-matrix.md](../reconciliation/runtime-decision-matrix.md) Q1/Q2/Q3/Q5/Q24/Q25/Q26; lanes C/H/P.

## Decision

All workflows enter the runtime through one pipeline regardless of origin:

```
template ─┐
user JSON ├─→ ChainLoader ─→ ChainDefinition ─→ compiler/policy/scrutiny ─→ ResolvedChain ─→ ChainRun
agent composition ┘            (persisted, versioned)      (capability binding)   (frozen)
imported formula ┘
```

1. **ChainSource** is any versioned root contract that deterministically resolves to one chain shape: shipped `.formula.json` templates, user-authored JSON, persisted ad-hoc typed compositions, imported external formulas. Skills/reports/transcripts are evidence, never sources.
2. **ChainDefinition** is the normalized authored form (AST-like). No physical job/session IDs belong in it. It is persisted and reviewable before freeze; drafts use the existing `contract:draft` intake convention until the authoring UX lands (core `issuetracking.md` validator-verdict model ≈ freeze gate).
3. **ResolvedChain** is approved immutable compiler output. Structural change = new reviewed revision. Children cannot mutate approved topology at runtime.
4. **Materialization**: Beads materializes only after freeze (root Epic native parent, step beads children with `blocks` between steps). The materializer projects; it never invents a second dependency graph. Planner output becomes ChainDefinition *before* materialization (`xt spec` change-contract → Pass-2 `recommended_template` annotation → compile → freeze → pour).
5. **Template compatibility**: the 15 formula assets remain executable ChainSource compatibility assets under the canon precedence rule ("formula wins executable shape" until the substrate catalog lands). Formulas are not the ontology and migrate into the ChainDefinition corpus over time; the code-with-tests obligations-scanner unconditional-`needs` defect is fixed during that migration.

## Consequences

- C1 workstreams restated as ChainLoader→ChainDefinition→compiler→ResolvedChain→durable run (plan update W5).
- Compiler determinism and invalid-topology rejection become Eval Core subjects.
- Selection/composition stay separated: `applies_when` matchers live outside shapes; one matcher language at the selection layer.

## Rejected alternatives

- Keeping Template→ResolvedChain as the only path (breaks user-authored chains; Q24 acceptance impossible).
- Letting planners mutate Beads directly as the only representation (loses reviewability/freeze).
