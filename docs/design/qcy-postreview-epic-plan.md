# xtrm-qcy post-review remediation packet (pre-q99 quality gate)

Source: operator code-level review of merged programme xtrm-qcy (PRs #91–#101), 2026-08-26.
Verdict: **PARTIAL — repair before xtrm-q99 runtime wiring.** Architecture direction sound;
no reset required. Execution truth lives on the bd board (`xtrm-2hn` + children); this doc is
durable context only.

## Scope split

Single repo, audit-closure track (no new features). One cross-repo touchpoint: R1 consumes
`~/dev/specialists/docs/design/roadmap/chain-templates/*.formula.json` read-only.

## Verified defect index (checked against HEAD 688ea97)

| # | Defect | Anchors |
|---|--------|---------|
| R1 | Loader drops `gate:*` labels (`advisor:*→advisor`, else step); imported mandatory/final gates compile as ordinary steps; test asserts the bug | `experiments/agentsession-sre-chain-vertical-slice/src/chain-loader/index.ts` L23–48; `tests/chain-loader.test.ts:91`; corpus of 15 assets (code-standard: seconder/test-runner/obligations-scanner `gate:mandatory`, reviewer `gate:final`) |
| R2 | FINALIZE early-returns `clear` when no mandatory bindings, before inspecting uncertainty ⇒ non-mandatory + pending external observation finalizes CLEAR | `src/finalize/index.ts` L107–124 |
| R3 | `voidObligation` appends durable void event before evidence store validation; missing-evidence caller mutates then throws; #100 reload reconciliation is backstop only | `src/obligation/index.ts` append L341–345; reconcileOnLoad L320–339 |
| R4 | Participant-wide `last_read_seq` compared against channel-local `seq` ⇒ cross-channel contamination; `canSee` returns `true` for chain/node, no membership model | `src/channel-comm/index.ts` L126, L447, L188–196 |
| R5 | F1: authored `StepClassSchema = step|gate|advisor`; coordinator positions force-mapped to `step` (documented deviation) | `src/chain-contracts/chain-source.ts:161`; loader deviation note; `tests/sre-data-parity.test.ts` |
| R6 | Compiler emits `capability_grants` = requests ∩ operator allowlist — compile-time bound posing as ADR-004 `ResolvedCapabilityGrant` | `src/chain-compiler/index.ts` L105, L178, L233 |
| R7 | Hygiene regression from PR #91 (+ stray lockfile line in #95): tracked `.pyc` under `packages/{arena-top,mcpq}`, no cache ignores, machine-specific paths in `.claude/settings.json` | `git ls-files \| grep pycache`; `.gitignore`; `.claude/settings.json` |

## Bead layout (one bead ≈ one PR)

```
xtrm-2hn qcy post-review remediation packet (discovered-from xtrm-qcy)
├── xtrm-2hn.1 R1 gate-class preservation in import ......... blocks xtrm-q99
├── xtrm-2hn.2 R2 FINALIZE uncertainty over mandatory ....... blocks xtrm-q99
├── xtrm-2hn.3 R3 voidObligation two-journal safety ......... blocks xtrm-q99
├── xtrm-2hn.4 R4 cursor/membership seam repair ............. blocks xtrm-q99
├── xtrm-2hn.5 R5 coordinator vocabulary decision (F1) ...... blocks xtrm-q99
├── xtrm-2hn.6 R6 CompiledCapabilityBounds naming ........... blocks xtrm-q99
├── xtrm-2hn.7 R7 repository hygiene ........................ independent (land before next large PR)
└── xtrm-2hn.8 R8 adversarial suite expansion ............... discovered-from xtrm-1xn
```

Adversarial-case placement: non-mandatory+pending→UNCERTAIN → R2; void-zero-mutation +
evidence-failure-after-mutation → R3; channel A/B contamination + non-member visibility → R4;
formula gate-label survival → R1; service-instance idempotency pair + waiting-cycle mutual
writers → R8 (sequenced after R2–R4 semantics land).

Fan-out suggestion: R1–R4 as parallel specialist chains (executor → reviewer, test-engineer
for the folded regressions). R5–R6 single-pane small design-bound edits. R7 solo chore.
R8 last within the packet.

Cross-repo release gate: none. R1 must not edit the specialists repo.

## DoD

- All R1–R6 closed ⇒ `xtrm-q99` dependency-unblocked (C1.4/C1.5/I1.3/E1.4 gates remain independently binding).
- `bun test tests/` green inside the experiment vertical after each PR.
- R7 proven: zero tracked bytecode on main, ignores present, settings.json disposition decided.
- Every folded adversarial case asserts repaired semantics, not incidentally-current behavior.
