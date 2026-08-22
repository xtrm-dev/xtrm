# Lane D — Native-Harness Documentation Audit

**Lane:** D (read-only documentation audit, XTRM runtime canonicalization programme, epic `xtrm-cn8`)
**Repos:** `/home/dawid/dev/xtrm` (main @ `4f6ac48c4e0b`), worktree `/home/dawid/dev/xtrm-wt/pr71-loader` (branch `web/full-specialist-json-loader-2026-08-18` @ `818da6553a21`)
**Date:** 2026-08-19
**Writes:** this file plus `lane-d-proven-bridge-target-matrix.json`, `lane-d-source-register.json` under `docs/runtime/reconciliation/lanes/`. No canonical files modified.

---

## 1. Documents read completely

| # | Path | Blob SHA | State |
|---|---|---|---|
| 1 | `docs/harness/README.md` | `d67d40fc843cd5c3132b47497929300a51673638` | tracked, clean |
| 2 | `docs/harness/experiments/README.md` | `04fcdde6c0ccbe35c1d0d07cbb64e480c302dc71` | tracked, clean |
| 3 | `docs/harness/experiments/agentsession-sre-chain-vertical-slice-2026-08-17.md` | `dd09a54489a170036279ad57e49c98a04c7ba7db` | tracked, clean |
| 4 | `docs/harness/xtrm-native-harness-on-pi-architecture-exploration-2026-08-09.md` | `1d98420b9defecefa9e2adcc3d862e0caf1eec29` | tracked, clean |
| 5 | `docs/harness/mercury-governed-research-harness-prd-draft-2026-08-10.md` | `cadba277891f5927aa5dc8bf750051437cd9eb76` | tracked, clean |
| 6 | `docs/shared/xtrm-native-harness-on-pi-architecture-exploration-2026-08-09.md` | `5bec00a34bca9351887a50bf60e195bf456f6627` | tracked, clean |
| 7 | `experiments/agentsession-sre-chain-vertical-slice/README.md` (worktree) | `ad9c0c7f9fed8dac6f05378665cd5167132a265b` | tracked @ HEAD 818da65, working tree clean |
| 8 | `experiments/agentsession-sre-chain-vertical-slice/full-specialist-json-loader.md` (worktree) | `75e647a3e077f6af163c8117b6d25a48b81dfc4d` | tracked @ HEAD 818da65, working tree clean |
| 9 | `experiments/agentsession-sre-chain-vertical-slice/experiment-report.md` (worktree) | `4ea24748821a55a8d621aee855114fcbbf15aef1` | tracked @ HEAD 818da65, working tree clean |

## 2. Duplication finding: the native-harness exploration exists as two divergent blobs

`docs/harness/…` (`1d98420b`) and `docs/shared/…` (`5bec00a3`) are **not byte-identical**. The `docs/shared/` copy is strictly newer and is a superset. Differing regions:

1. **Header line 9 (shared only):**
   > **Programme tracking:** `R1.6` and `GATE-HARNESS-ADR` in the canonical current execution plan; the accepted ADR may retain corrected RPC or select a native harness
2. **Line 898/899 punctuation:** harness copy reads "…evidence for these questions:" ; shared copy reads "…evidence for these questions."
3. **Entire §29 "Prime-agent code findings — exploration input" (~30 lines) exists only in the shared copy**, including its own caveat banner ("EXPLORE FURTHER AND DONT' TAKE AS AUTHORATIVE EVIDENCE", typos present in the source), dated 2026-08-12.

No content in the harness copy is absent from or contradicted by the shared copy. **The `docs/shared/` blob `5bec00a3` is newer/canonical; the `docs/harness/` blob `1d98420b` is a stale duplicate.**

### Full inventory of copies (both repos + all worktrees)

Every checked copy matches one of exactly two blobs:

| Blob (short) | Locations |
|---|---|
| `5bec00a3` (newer/canonical) | main: `docs/shared/…`; all of `.xtrm/worktrees/{xtrm-xt-pi-e6tq, xtrm-xt-pi-on12, xtrm-xt-pi-q43q, xtrm-xt-pi-board-audit-revamp, xtrm-xt-claude-tq2v-worker, xtrm-xt-pi-xcfn, xtrm-xt-claude-board-audit-review}`; `xtrm-wt/main-baseline-check`; `xtrm-wt/pr71-loader` — each under `docs/shared/` |
| `1d98420b` (stale) | main + every worktree above — each under `docs/harness/` |

That is 2 unique blobs across 20+ physical copies; no third variant exists on disk.

**Canonical-location recommendation:** keep ONE canonical evidence/provenance location for the exploration doc: `docs/shared/xtrm-native-harness-on-pi-architecture-exploration-2026-08-09.md` @ `5bec00a3` (it is the version other canon already references — e.g. Mercury PRD §22 names the `docs/shared/` path). Delete or redirect the `docs/harness/` copy to a pointer. The experiment report/spec pair belongs with the experiment (`experiments/…` in the PR branch until merged); the spec copy at `docs/harness/experiments/` is the durable home.

## 3. Worktree dirty state (pr71-loader)

`git status --porcelain -- experiments/`:
- Modified (uncommitted): `src/adapters/beads.ts`, `src/agents/bridge.ts`, `src/agents/specialist-bridge.ts`, `src/chain/scheduler.ts`, `src/chain/topology.ts`
- Untracked: `handoff/2026-08-19-real-infra-smoke/`, `src/agents/model-resolver.ts`

The three experiment markdown documents are tracked and clean at HEAD `818da65`. Source-code claims below were verified against the working tree (which includes uncommitted modifications to bridge/scheduler/topology).

## 4. Bounded source verification (worktree experiments tree)

Verified against `experiments/agentsession-sre-chain-vertical-slice/src|tests`:

- **AgentSession hosting:** `src/agents/bridge.ts` imports `createAgentSession`, `SessionManager`, `SettingsManager`, `createExtensionRuntime`, `ResourceLoader` from `@earendil-works/pi-coding-agent`; one direct session per activation; no Pi RPC spawn.
- **noTools/builtin boundary:** `noTools: "builtin"` at `src/agents/bridge.ts:161` and `src/agents/specialist-bridge.ts:148`.
- **Reducer parallelism:** `src/chain/scheduler.ts` (~lines 376–396): reducer emits both advisor dispatch intents in one batch; scheduler persists idempotency keys before dispatch and runs dispatch intents concurrently (`Promise.all` per comment).
- **Specialist JSON loader/compiler:** `src/specialists/loader.ts` (Zod schema, `.passthrough()`, SHA-256 source fingerprint, feature classification incl. "feature: metadata + source fingerprint"), `src/specialists/bindings.ts` (fail-closed drift: source sha256, name, version, skill-set and per-skill sha256 checks → "Start a new ChainRun/revision instead of mutating cognition in-place").
- **Skill fingerprinting:** host-resolved skills hashed (`loader.ts sha256()`; `bindings.ts` frozen skill path+sha256 revalidation on every activation/resume).
- **Beads hierarchy:** `tests/beads-adapter.test.ts` asserts ChainRun Epic (`issue_type == "epic"`), native `--parent` children, `blocks` edges between step beads only, close without `--force`.
- **Crash/resume:** live-tested pre-reconciliation (report §6.3: attempts=2 only on killed step, satisfied steps not re-dispatched); reconciled-topology live rerun explicitly scoped, not run (§10.4).
- **PREPARE/FINALIZE:** zero occurrences of `PREPARE`/`FINALIZE`/`ActivationSupervisor` anywhere in the experiment `src/`, `tests/`, or `scripts/` trees. These concepts have no evidence inside Lane D scope (they presumably belong to Specialists-runtime sources owned by another lane).
- **Capability adaptation:** feature matrix `native|adapted|deferred|rejected` documented in `full-specialist-json-loader.md` and implemented in loader feature reporting; scripts retained-but-deferred; capability resolver listed as remaining work.

## 5. Contradictions and authority tensions noted

1. Two divergent copies of the same exploration doc (§2) — the primary duplication defect of this lane.
2. Experiment README says "48 previously verified green" plus new loader tests; report §7 counts "19 ✅ / 0 🟡 / 2 ⚠️" acceptance criteria. Internally consistent, but test counts were not re-run by Lane D (read-only audit; not verified live).
3. Report §11.2 honestly lists what is NOT proven (capability sandbox, real Channels transport, specialist fusion, mutation journal, daemon posture, broad model parity); the loader doc's "Remaining work" list overlaps consistently.
4. Exploration doc §29 self-declares non-authoritative status; its prime-agent findings must not be cited as settled XTRM evidence.
5. Spec §19 records a live canon gap (`xtrm-dev/specialists:docs/design/chain-templates.md` unresolved) — confirmed recorded, not fabricated.

## 6. Canonical-evidence recommendation summary

- One canonical exploration doc: `docs/shared/…` @ `5bec00a3`; retire the `docs/harness/…` duplicate.
- One canonical experiment evidence package: the worktree experiment trio (README / full-specialist-json-loader / experiment-report) at the blobs in §1, merged to main via the PR #71 lineage; `docs/harness/experiments/agentsession-sre-chain-vertical-slice-2026-08-17.md` remains the durable spec home.
- PREPARE/FINALIZE and ActivationSupervisor claims must be routed to whichever lane owns the Specialists runtime sources; they are UNVERIFIED here.
