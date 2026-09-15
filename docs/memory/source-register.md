# XTRM Native Memory System — source and authority register

Status: current audit register  
Last audited: 2026-09-15  
Primary design: [`xtrm-native-memory-system-prd-v0.2.md`](./xtrm-native-memory-system-prd-v0.2.md)

This register records the documents, source paths and historical artifacts that materially constrain the Native Memory System. It exists to prevent design drift and accidental revival of retired Beads-era behavior.

## 1. Canonical XTRM memory artifacts

| Artifact | Location | Status | Role |
|---|---|---|---|
| Native Memory System PRD v0.2 | `docs/memory/xtrm-native-memory-system-prd-v0.2.md` | CANONICAL DESIGN | Implementation contract for history, semantic memory, temporal correctness, retrieval, Python workbench and roadmap. |
| Native Memory System visual v0.2 | `docs/memory/xtrm-native-memory-system-visual-design-v0.2.html` | CANONICAL EXPLAINER | Visual rendering of the same architecture; not an independent source of authority. |
| Memory docs index | `docs/memory/README.md` | CANONICAL INDEX | Entry point and precedence rules. |
| This register | `docs/memory/source-register.md` | CANONICAL REGISTER | Exact source map and historical disposition. |

Initial canonicalization: XTRM PR #191, merge `12e71d743a32c7b27af6c3e792574cfa08e7b81a`.

## 2. Substrate authority and implementation constraints

These are not duplicated into `docs/memory`; they remain canonical in their owning areas.

| Source | Location | Memory relevance |
|---|---|---|
| Substrate design, Italian | `docs/substrate/substrate_design_it.md` | Defines Memory as a Substrate domain capability, keeps herd/workgroup/identity as query lenses rather than stores, and establishes coordinator close-time distillation. |
| Substrate design, English | `docs/substrate/substrate_design_en.md` | English counterpart for the current Substrate architecture. |
| Console product contract | `docs/console/console-product-contract.md` | Locked distinction: Evidence is per-entity proof; Memory is durable cross-task knowledge. |
| Skill migration gate | `docs/substrate/skill-migration-gate.md` | Explicit `Journal != Memory` invariant. |
| Substrate closeout ADR | `docs/substrate/sbcloseout2-adr.md` | Reinforces `Journal != Issue`, `Journal != Memory`, and message != authority. |
| Current Substrate package | `packages/substrate/` | Runtime/domain implementation that the memory subsystem must extend rather than bypass. |
| Core state boundary documentation | `docs/monorepo-migration.md` | `xt daemon`, `state.db`, Unix socket and `StateClient` are the single local authority boundary. Domain packages do not open the DB directly. |

The memory implementation must respect the current Substrate closeout state landed through XTRM PR #189 and the one-state authority architecture. Any stale Beads-era examples elsewhere are historical unless current source proves otherwise.

## 3. Runtime and harness constraints

| Source | Location | Status / relevance |
|---|---|---|
| Current execution plan | `docs/shared/xtrm-current-execution-plan.md` | Current sequencing says three-lens memory comes only after retrieval/pollution can be measured. Supports MEM-0 / MEM-0B before semantic promotion machinery. |
| Native harness exploration | `docs/shared/xtrm-native-harness-on-pi-architecture-exploration-2026-08-09.md` | Research evidence for persistent Python/IPython as an execution profile, not universal production authority. Useful for the PythonExecutionSession boundary. |
| Runtime reconciliation | `docs/shared/xtrm-v1-runtime-reconciliation-and-termination-2026-08-09.md` | Establishes persistent IPython as execution profile and governed learning as candidates rather than silent self-modification. |
| q99 runtime PR | GitHub PR #109 | OPEN / NON-CANONICAL UNTIL MERGED. Contains compatible distinctions: Skill / Memory / Knowledge / Context remain separate; PythonKernel is optional adapter; PREPARE must not bulk-preload memory. Do not treat its branch state as merged authority. |

## 4. Core / Python-kernel implementation evidence

The current Python kernel is owned by `xtrm-dev/core`, not copied into this repository. The memory design should consume its proven mechanics without turning the kernel into memory authority.

| Source | Repository / path | Relevance |
|---|---|---|
| Python kernel implementation | `xtrm-dev/core/packages/pi-extensions/extensions/python-kernel/index.ts` | Persistent per-session CPython, JSON-lines RPC, bounded output, skillbridge, audit seam, `preflight()` prelude. Target architecture replaces direct `bd memories` with host capability proxies. |
| Python kernel README | `xtrm-dev/core/packages/pi-extensions/extensions/python-kernel/README.md` | Documents current `preflight(repo,path,n=4)` and progressive-retrieval doctrine. |
| Python-kernel verification | `xtrm-dev/core/scripts/verify-python-kernel-v2.mjs` | Deterministic checks for preflight binding and kernel v2 behavior. |
| Core extension docs | `xtrm-dev/core/docs/pi-extensions.md` | Current packaged extension surface. |
| Archived memory research | `xtrm-dev/core/docs/design/memory-system-r6g.md` | ARCHIVED RESEARCH. Important failure-mode and retrieval research; explicitly not plan of record since bd-memory retirement on 2026-09-09. |

The v0.2 PRD deliberately preserves the useful lessons from these sources: progressive retrieval, narrow tools, bounded output, Git history as episodic memory, and no universal `answer()` monolith. It rejects the retired bd store, memory gate, `.xtrm/memory.md` synthesis and Beads write paths.

## 5. Historical XTRM artifacts at repository root

### `show-me-memory-doctrine.html`

Status: **HISTORICAL / SUPERSEDED**.

Still useful:

- progressive retrieval, never bulk;
- `git log --follow` with full commit bodies;
- read current diff together with history;
- keep large corpora in the persistent Python process and print only bounded digests;
- use targeted triggers instead of session-start corpus injection.

Superseded:

- `bd memories` and `bd recall` as the semantic-memory layer;
- `bd remember` write-back;
- `bd prime` as the comparison baseline for current architecture;
- `0 commits == wrong path` as a hard rule;
- mandatory preflight before every edit/implementation;
- Beads memory-gate assumptions.

Target replacement: PRD §12 `preflight v2`, using provider-neutral `history.*` and `memory.*` capabilities plus workspace state.

### `show-me-python-kernel-v2.html`

Status: **HISTORICAL IMPLEMENTATION EXPLAINER**.

Still useful:

- persistent CPython namespace;
- bounded cell output and temp-file spill;
- importable Python-backed skills;
- visible mutation/audit seam;
- long-lived analysis state outside model context.

Not future authority:

- provider session ID as the final kernel identity;
- report-only audit seam as sufficient mutation governance;
- direct subprocess access as the final memory API;
- using the interactive kernel as a durable index worker.

Target replacement: PRD §§6–11 and §21: `PythonExecutionSession`, host-owned capability bridge, bounded result objects, and a separate `MemoryIndexWorker` if dense indexing is later justified.

These root HTML files remain in place for historical-link compatibility. Their current knowledge is represented in the canonical PRD/register; implementation must not treat them as normative.

## 6. Research conclusions that are now part of the design

The research pass supporting v0.2 converged on these decisions:

- Git commit history is valuable episodic memory, but commit messages alone are incomplete; issue/review/journal/receipt provenance must be retrievable with the commit when needed.
- Stale memories are a first-class correctness risk; supersession and temporal validity belong in the initial semantic model.
- Repository workloads need exact/lexical retrieval for paths, SHAs, identifiers and symbols; SQLite FTS5 is the baseline.
- Dense retrieval is eval-gated. If enabled, `sqlite-vec` exact KNN is the local candidate; experimental ANN behavior is not a baseline dependency.
- Hybrid retrieval can underperform when one branch is weak. FTS5, dense and their fusion must be evaluated independently before production promotion.
- A graph database is not justified for v0. Relations such as `supports`, `supersedes`, `contradicts` and `invalidates` fit the existing relational authority.

## 7. Implementation file placement target

The exact filenames may change during implementation, but ownership should stay within the current package boundaries.

Expected Substrate/Core surfaces:

```text
packages/substrate/src/domain/memory.ts
packages/substrate/src/service/memory-service.ts
packages/substrate/src/service/history-query-service.ts
packages/substrate/src/service/memory-index-service.ts
packages/substrate/src/service/memory-consolidation-service.ts
packages/substrate/src/store/... migrations / projections

Core / harness bridge:
  typed capability contracts
  HostCapabilityBridge
  execution-scoped PythonExecutionSession integration

Core Python client surface:
  xtrm.history
  xtrm.memory
  bounded HistoryPage / MemoryPage objects
  preflight v2 composition
```

Do not create a second state database, second daemon, provider-specific memory authority, or direct Python SQLite path.

## 8. Documentation definition of done for implementation

Every implementation phase must update documentation when it changes a public or authority-bearing contract.

Minimum evidence per phase:

1. exact issue/Jira key;
2. PR and merge commit;
3. implementation paths;
4. tests/evals and result;
5. schema or protocol version if introduced;
6. PRD/source-register update when semantics changed;
7. explicit disposition of superseded docs or examples;
8. no unresolved Beads/bd memory path presented as current behavior.

When implementation closes, `docs/memory/README.md` should remain the cold-start entry point and this register should list the shipped source paths rather than speculative targets.