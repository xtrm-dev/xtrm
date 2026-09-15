# XTRM Memory documentation

This directory is the canonical documentation home for the XTRM Native Memory System.

## Canonical design

- [`xtrm-native-memory-system-prd-v0.2.md`](./xtrm-native-memory-system-prd-v0.2.md) — current implementation PRD. It defines authority, History vs Memory vs Knowledge vs Context, `MemoryCandidate` / `MemoryRecord`, temporal correctness, query lenses, retrieval, Python-kernel integration, the future harness boundary, implementation phases MEM-0..MEM-6, evaluation and acceptance criteria.
- [`xtrm-native-memory-system-visual-design-v0.2.html`](./xtrm-native-memory-system-visual-design-v0.2.html) — self-contained visual explainer for the same v0.2 architecture.
- [`source-register.md`](./source-register.md) — audited source/authority register. Use it to locate the exact XTRM, Substrate, runtime and Core/Python-kernel documents and code that constrain implementation.

The design became canonical in XTRM through PR [#191](https://github.com/xtrm-dev/xtrm/pull/191), merged as `12e71d743a32c7b27af6c3e792574cfa08e7b81a`.

## Authority order

When documents disagree, use this order for the memory programme:

1. current executable source and tests on the relevant default branch;
2. current Substrate authority contracts and `state.db` / `StateClient` boundaries;
3. this directory's current Native Memory System PRD;
4. current runtime/console contracts that explicitly constrain memory;
5. research, historical diagrams, archived Core designs and superseded Beads-era material.

A historical document is evidence for why a decision exists; it is not automatically a current implementation contract.

## Important semantic boundaries

The memory programme must preserve these distinctions:

- **History**: durable record of what happened, primarily Git plus Substrate evidence/provenance.
- **Memory**: sparse, promoted, evidence-backed reusable meaning.
- **Knowledge**: current subject truth, such as current source, docs, runtime state or Service Knowledge.
- **Context**: bounded material selected for one execution.
- **Journal**: continuity/progress evidence; Journal entries do not automatically become Memory.
- **Python kernel state**: disposable investigation state, never durable XTRM authority.

The compact invariant is:

```text
Git remembers the change.
Substrate remembers the work and evidence.
Memory remembers the lesson.
Retrieval decides what is useful now.
The agent reasons over the result.

Python remembers the investigation.
Substrate remembers the truth.
```

## Historical artifacts outside `docs/`

Two old self-contained HTML explainers still exist at repository root:

- `show-me-memory-doctrine.html`
- `show-me-python-kernel-v2.html`

They are retained as historical evidence only. They describe the pre-cutover Beads/bd memory doctrine and the earlier Python-kernel v2 implementation and therefore contain assumptions that are intentionally superseded by the v0.2 PRD. Do not copy their Beads-era write paths, memory gate or `bd memories` behavior into the native implementation.

Their current and superseded parts are called out explicitly in [`source-register.md`](./source-register.md).

## Implementation tracking

Implementation work should be tracked in Jira in the XTRM project, with each work item linking back to this directory and to exact source paths/commits where behavior is implemented. Documentation updates are part of the implementation definition of done: changes to authority, capability contracts, lifecycle, retrieval semantics or Python/harness integration must update the PRD/source register in the same programme.