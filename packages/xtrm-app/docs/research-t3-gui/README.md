# T3 Code GUI modernization — research package

**Date:** 2026-10-12 · **Status:** investigation complete, decision proposed (not accepted)
**Workspace:** `.worktrees/research-t3-gui/t3code` (upstream remote preserved, read-only)

## Snapshot SHAs (exact reviewed revisions)

| Repo | SHA | Date | Note |
|---|---|---|---|
| XTRM (`xtrm-dev/xtrm`) | `fc8132c1d1fdedc528b0ffc752497031f2e56cea` | 2026-10-06 | main |
| Core (`xtrm-dev/core`) | `5e8fb8e534b8b47999d5fbf35ed9d32c13b5e340` | 2026-10-08 | `xt` v0.15.2 era |
| Pi (`@earendil-works/pi-coding-agent`) | `0.84.2` installed | — | `packages/xts` declares `^1.0.0` — mismatch, see decision §7 |
| T3 (`pingdotgg/t3code`) | `5753207d53362608f281738eda3a9faf4e13b6be` | 2026-10-12 | MIT, `pnpm@11.10.0`, Node 24 |

## One-paragraph verdict

**Do not fork T3 as the application.** T3's server owns every agent process it drives
(`pi --mode rpc` stdio; `--resume/--session/--fork/--mode` rejected; unsolicited work
terminated, not adopted), which contradicts XTRM's first-class requirement to observe and
control already-running tmux sessions without duplicate processes. **Reuse T3's presentation
components with adapters against the existing XTRM agent host**, port its proven patterns
(bounded snapshot + replay transport, settlement detection, owns-vs-discovers lifecycle rule),
and keep its Effect/RPC/server stack as reference only. Details: `decision.md`.

## Map

| Deliverable (mission §11) | File |
|---|---|
| 1. Executive decision + 7. risks (register inline) | `decision.md` |
| 2. Repository and component inventory | `inventory.md` |
| 3. Feature parity matrix | `parity-matrix.json` (+ §3 narrative in `decision.md`) |
| 4. Architecture diagrams | `architecture.md` (Mermaid) |
| 5. Reuse and porting inventory | `reuse-inventory.md` |
| 6. Migration plan + 9. backlog | `migration.md` |
| 8. Prototype and test results | `migration.md` §8 (spikes; full prototypes deferred with reasons) |
| Nightly delta watch | `nightly-delta.md` (re-run at each milestone start) |
| Extension rendering + native specialists | `extension-rendering.md` |
| 10. ADR proposal | `adr-draft.md` |

## Authority and precedence

This package **recommends**; it does not override: the GUI PRD
(`../xtrm-gui-prd.md`), `../console-v2-shell-architecture.md`, `../adoption-audit.md` §§10–14,
ADR-001 (`../adr/ADR-001-agent-experience-design-authority.md`, Phase 0 visuals OPEN until
XTRM-628), or Substrate work authority. Where this package conflicts with those, those win.

## Evidence trail

Four parallel code investigations (read-only, no edits) plus two network fetches:
runtime/kernel map, Pi session semantics, CLI/GUI parity inventory, T3 attach/reuse inventory,
T3 upstream brief (license/architecture intent), adjacent-project answers
(OpenCode/ACP/tmux/Happy/OpenHands/Zed). Investigators returned file paths, symbols, tests,
and open questions; conflicting readings were reconciled by spot-checking the cited files
(`mcpInjection.ts` reserved args, `adapter.ts:116` unsolicited-activity error, T3 `LICENSE`).
