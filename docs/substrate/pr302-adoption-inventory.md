# PR #302 (XTRM-668) — Phase 1 inventory: CLI/core (A) vs old plugin surface (B)

Issue: XTRM-724. Worker: adopt-302. Date: 2026-11-11. Phase 1 produced this document and no code.
This copy is the durable record; the inventory drove PRs A1-A4 of the adoption plan.
Source: `gh pr view 302 --json files` (80 files, +4,869 / −1,671), branch `origin/xt/sb-improve`
(4 commits on base `1fc9ff55`), compared against `origin/main` at `08e9ee9` (0.2.6).

## Method

1. `gh pr view 302 --json files` — the authoritative file list (80 paths).
2. For every path: blob at `origin/xt/sb-improve` vs blob at `origin/main` (absent / identical /
   differs) and the commits main made on that path since the base.
3. Rebase probe in a throwaway worktree (`/tmp/adopt302-probe`, removed): `git rebase origin/main`
   on the branch, then one `git cherry-pick -n` per commit, recording unmerged paths. Nothing was
   pushed; `origin/xt/sb-improve` was only read.
4. Feature comparison against main's 49 commits since the base, `packages/substrate/CHANGELOG.md`
   0.2.4–0.2.6, and XTRM-679 / CORE-2536 / CORE-2581.

## Headline findings

1. **None of #302 is on main.** No commit since the base mentions XTRM-668…679. XTRM-679 is marked
   `DONE` in Substrate, but its work exists only on `xt/sb-improve`: main's
   `packages/substrate/skills/using-substrate/SKILL.md` still has no frontmatter, still differs from
   the plugin copy (`fea75ec` vs `9adafc0`), and `package.json` still has no `pi.skills`. The DONE
   status records work done, not work landed — the adoption is the only path to production.
2. **Main moved the architecture underneath #302's integration layer.** XTRM-690 (`sb serve --stdio`,
   60 named operations in `src/service/ops.ts`), XTRM-691 (Pi tools through the typed service,
   `integrations/pi/backing.ts`), XTRM-692 (Claude plugin chooses its store at launch), XTRM-711/712
   (one connection per session, fail-closed gate) and XTRM-685 (remote store) all postdate the base.
   #302's `integrations/tool-core.ts` opens a **local DB handle** and runs tools in-process, and its
   `integrations/pi/extension.ts` deletes `SessionBacking`, `StoreCall`, `isTransportFailure` and
   `transportCode`. Landing that as-is regresses remote mode and the fail-closed gate. This is why
   part (B) must wait for step 12 and be rebuilt on the typed service.
3. **XTRM-722 supersedes #302's holder derivation.** `src/domain/claim.ts` on main owns
   `resolveClaimHolder` (flag, then `SUBSTRATE_HOLDER`, else fail closed) and states that no other
   source may produce a holder. #302 adds `resolveIdentity` (env → worktree name → none) and a
   CLI-local `resolveHolder` with a warning. Substrate must not derive a holder from a worktree:
   CORE-2536 (DONE) put derivation in core's `xt attach`
   (`holderFromWorktreePath`, directory slug). The advisory *code* (`identity_missing`,
   `holder_mismatch`) can land; the *derivation* must not.
4. **Three files would silently revert main if applied whole.** `docs/substrate/cli.md` deletes the
   `remote` and `serve` sections main now documents; `src/domain/claim.ts` deletes
   `resolveClaimHolder`; `packages/substrate/README.md` deletes the (now correct) holder paragraph.
   Each needs a hand-merged hunk, not a cherry-pick.
5. **34 files are part (A), 46 are part (B).** Nothing from (B) is required for (A) to be useful;
   most (B) tests fail without `integrations/tool-surface.ts`, so they move with (B).

## Part A — CLI and core library (34 files, land on current main)

| File | What it does | Main today | Conflict | Risk |
|---|---|---|---|---|
| `docs/substrate/cli.md` | CLI reference for the verbs #302 adds/changes (renew, help contract|kinds|identity, strict parsing). | Branch base predates XTRM-685/690: the branch DELETES the `remote` and `serve` sections main now documents. | DIFFERS, 2 main commits (264468e, 2d33ec7); wholesale apply reverts main docs. | HIGH if applied whole; take additions only. |
| `docs/substrate/journal.md` | Documents the 20,000-char journal summary limit and --summary-file. | Absent (main caps only MCP appends at 2000). | None. | LOW. |
| `packages/substrate/CHANGELOG.md` | Unreleased entries for XTRM-668..679; branch header is 0.2.3-era. | main is at 0.2.6 with 0.2.4/0.2.5/0.2.6 sections. | DIFFERS, 6 main commits. | MEDIUM: never take the version headers, only new Unreleased bullets for landed A items. |
| `packages/substrate/README.md` | Nine-tool list, skills line, and REMOVES the holder paragraph. | Holder paragraph is correct after XTRM-722; tool list is 8 tools. | DIFFERS, 1 main commit (08e9ee9). | MEDIUM: the holder-paragraph removal is now wrong; only A-facing edits should land. |
| `packages/substrate/cli/sb-ux.ts` | Adds `renew` and the new read-only verb set to the UX dispatcher. | main has claim/release only. | None (2 added lines). | LOW. |
| `packages/substrate/cli/sb.ts` | The A backbone: strict arg parsing (merged flags, valueless flags, dropped positionals, arity caps), `issue renew`, `sb help contract|kinds|identity`, unsupported-flag reasons, ISO times, claim/release feedback, draft/attest hints, journal quality warnings, --summary-file. | main already has resolveClaimHolder + holderSource (XTRM-722), remote dispatch (XTRM-685) and serve wiring (XTRM-690). | DIFFERS, 3 main commits; rebase probe = CONFLICT. | HIGH: branch-local resolveHolder duplicates and regresses XTRM-722; remote/serve hunks must be preserved. |
| `packages/substrate/docs/advisories.md` | New: the advisory catalogue, identity order, rule/cooldown tables. | Absent. | New file (modify/delete in probe only because commit 1 was skipped). | MEDIUM: its identity rule (env -> worktree name) contradicts merged XTRM-722 and must be rewritten before landing. |
| `packages/substrate/docs/cli.md` | Adds the new CLI surface to the operator doc (renew, help groups, strict errors, journal limit). | Absent. | None for the file, but must not describe unlanded B behaviour. | LOW after review. |
| `packages/substrate/package.json` | preloads tests/hermetic-env.ts for npm test; also (commit 2) declares pi.skills. | main: `node --test tests/*.test.ts`, no pi.skills. | DIFFERS, 3 main commits (version 0.2.6). | MEDIUM: take the --import change only; the pi.skills line is B and was removed again by commit 4. |
| `packages/substrate/src/compatibility/beads/import.ts` | Splits imported bead text at the summary limit instead of truncating. | Absent. | None (no main commits). | LOW; depends on journal.ts constant. |
| `packages/substrate/src/domain/claim.ts` | Adds isoTime(); DELETES resolveClaimHolder (branch base predates XTRM-722). | main HAS resolveClaimHolder + ClaimHolderSource. | DIFFERS, 1 main commit; take isoTime only. | HIGH if applied whole: it deletes the merged holder resolution. |
| `packages/substrate/src/domain/contract.ts` | contractShapeHints(): actionable hints for malformed validation/output entries. | Absent. | None. | LOW. |
| `packages/substrate/src/domain/issue.ts` | displayRef(locator, humanRef): locator first, durable ref in parentheses. | Absent (main has formatHumanRef only). | None. | LOW. |
| `packages/substrate/src/domain/journal.ts` | JOURNAL_SUMMARY_MAX=16000 (as shipped on the branch; A1 landed 20000, the value #339 had already published), summaryLimitProblem, previewText, clipWithMarker, assessJournalEntry (empty/placeholder/short-summary rules), unknownJournalKindMessage. | Absent (main caps MCP appends at 2000 inline). | None (no main commits). | LOW: the cleanest A landing in the PR. |
| `packages/substrate/src/index.ts` | Exports presentation/advisories.ts. | Absent. | None. | LOW. |
| `packages/substrate/src/presentation/advisories.ts` | NEW 273-line deterministic advisory catalogue: 11 codes, tuning, cooldowns, snapshotIssue, formatAdvisory. | Absent; main has no advisory system. | New file. | LOW-MEDIUM: resolveIdentity() must not become a second holder source (XTRM-722/CORE-2536 own that). |
| `packages/substrate/src/presentation/operation-feedback.ts` | withWarnings(), richer journal/claim detail and next hints. | main has XTRM-722 holderSource detail. | DIFFERS, 1 main commit. | MEDIUM: overlaps the merged holder feedback lines. |
| `packages/substrate/src/presentation/terminal.ts` | feedbackForCommand table rewritten (ref/kind/actor/next), ISO times, warnings, JOURNAL_SUMMARY_MAX=360, draft/attest hints. | main has XTRM-722 claim feedback. | DIFFERS, 1 main commit; probe CONFLICT. | MEDIUM. |
| `packages/substrate/src/service/closure-service.ts` | Already-terminal error names the ref and the reopen command. | main has an older message. | None. | LOW. |
| `packages/substrate/src/service/integration-service.ts` | Imported comments clipped with a visible marker instead of slice(0,2000). | Absent. | None. | LOW. |
| `packages/substrate/src/service/issue-service.ts` | 54/12: locator resolution through issue_locator_history, refOf in errors, readiness remediation text, claim/renew plumbing. | main has XTRM-722 holder resolution and 2 other commits in this file. | DIFFERS, 2 main commits (ac7f344, 63639fa touch this path). | MEDIUM: rebase needed; the resolveRef rewrite is the risky hunk. |
| `packages/substrate/src/service/journal-service.ts` | Enforces assessJournalEntry (errors reject, warnings surface) and the summary limit on append. | main changed this file for XTRM-690. | DIFFERS, 1 main commit (264468e). | MEDIUM: ops.ts journal operations must keep working. |
| `packages/substrate/src/service/resume-service.ts` | Capsule gains LATEST HANDOFF, claim expiry line, bounded delta/siblings, open-children cap. | main has a capsule without those. | None. | LOW. |
| `packages/substrate/src/workitems/store.ts` | addJournal accepts semantic + result payloads. | Absent. | None. | LOW. |
| `packages/substrate/src/workitems/substrate-store.ts` | Passes semantic/result through addJournal. | Absent. | None. | LOW. |
| `packages/substrate/tests/advisories.test.ts` | NEW: rule catalogue, cooldowns, identity order. | Absent. | New file. | LOW (src-only imports). |
| `packages/substrate/tests/hermetic-env.ts` | NEW 6-line preload clearing SUBSTRATE_HOLDER, SUBSTRATE_ACTIVATION_ID, XTRM_SESSION_*. | Absent. | New file. | LOW, and it is what makes the suite pass inside an xt shell. |
| `packages/substrate/tests/journal-kinds.test.ts` | 1/1: note append now carries a summary (required by XTRM-670). | main allows an empty note. | None. | LOW (pairs with journal quality rules). |
| `packages/substrate/tests/journal.test.ts` | 2/2: summary limit in the service path. | main has the older assertions. | None. | LOW. |
| `packages/substrate/tests/locator-display.test.ts` | NEW: displayRef, advisory labels, locator resolution. | Absent. | New file. | LOW (src-only). |
| `packages/substrate/tests/sb-improve-p1.test.ts` | NEW 399-line CLI contract tests: runCli/runUxCli, arity, merged flags, renew, feedback, contract hints, journal quality. | Absent. | New file. | LOW-MEDIUM: heavy on cli/sb.ts, so it lands with the CLI PR. |
| `packages/substrate/tests/session-precedence.test.ts` | 1/1: note append carries a summary. | main allows an empty note. | None. | LOW. |
| `packages/substrate/tests/workitems.test.ts` | 1/1: addJournal passes semantic content. | main passes none. | None. | LOW. |
| `packages/substrate/tests/xtrm94-surface-alignment.test.ts` | 17/15: help-text alignment, runUxCli only. | main has the older alignment expectations. | None. | LOW. |
Landing order note: the domain/summary layer (`src/domain/journal.ts`, `contract.ts`, `issue.ts`,
`claim.ts` isoTime) has no conflicts and carries most of the behaviour; the presentation and CLI
layer sits on top of it; `cli/sb.ts` and `src/presentation/terminal.ts` are the only genuinely
contended files.

## Part B — old plugin surface and integration adapters (46 files, hold for step 12 / CORE-2391)

| File | What it does | Main today | Conflict | Risk |
|---|---|---|---|---|
| `packages/substrate/docs/claude.md` | Rewrites the Claude tool table to the nine-tool shared surface. | main documents the 8/13-tool MCP surface. | None (file untouched on main). | B: documents the surface step 12 reshapes. |
| `packages/substrate/docs/pi.md` | Nine-tool Pi table, skill-is-installed-by-xt claim, advisor/widget notes. | main documents 8 tools and a package-shipped skill. | None. | B: the "xt installs using-substrate" claim is not true today (~/.xtrm/skills/default has no using-substrate). |
| `packages/substrate/integrations/advisor.ts` | NEW host-neutral advisor: applies the catalogue to session start, tool result, stop; cooldowns. | Absent. | New file. | B. Also reads the DB directly (openHandles) rather than the typed service. |
| `packages/substrate/integrations/claude-code/advisor.ts` | Claude mapping of AdvisorOutput -> hook JSON; combineStopOutputs. | Absent. | New file. | B. |
| `packages/substrate/integrations/claude-code/commit-check.ts` | Hook emits the documented output schema; warnings. | main has an older variant. | DIFFERS, no main commits. | B. |
| `packages/substrate/integrations/claude-code/edit-gate.ts` | Deny-with-remedy schema, identity via advisories. | main has XTRM-692 store selection in this path. | DIFFERS, rebase probe = CONFLICT. | B: would drop the remote decision. |
| `packages/substrate/integrations/claude-code/mcp-server.ts` | -770 lines: tool handlers move to tool-core; 9 tools registered from tool-surface. | main is 878 lines with TOOL_DEFS, typed-service handlers, XTRM-692/XTRM-722 wiring. | DIFFERS, 2 main commits; probe CONFLICT. | B: a full rewrite of a file main changed underneath. |
| `packages/substrate/integrations/claude-code/postcompact.ts` | PostCompact reads compact_summary, stores readable text. | main has an older variant. | DIFFERS, no main commits. | B. |
| `packages/substrate/integrations/claude-code/semantic-service.ts` | Transcript gist / summarizeMechanical changes. | main has an older variant. | DIFFERS, no main commits. | B. |
| `packages/substrate/integrations/claude-code/stop-gate.ts` | Stop gate output schema + advisor merge. | main has an older variant. | DIFFERS, no main commits. | B. |
| `packages/substrate/integrations/pi-load-check.ts` | EXPECTED_SUBSTRATE_TOOLS -> the 9 shared names. | main expects 8 names. | DIFFERS, no main commits. | B (pairs with tool-surface). |
| `packages/substrate/integrations/pi/advisor.ts` | NEW Pi mapping: notify, tool-result append, status widget. | Absent. | New file. | B. |
| `packages/substrate/integrations/pi/extension.ts` | Replaces main's typed-service backing with openServices + runTool on a local DB path. | main routes every Pi call and gate through the typed service (XTRM-691/692/711/712). | DIFFERS, 4 main commits; probe CONFLICT. | B AND REGRESSION: dropping SessionBacking/StoreCall/transportCode removes remote support and fail-closed. |
| `packages/substrate/integrations/pi/handlers.ts` | 375 lines vs main 552; tool handlers delegate to tool-core. | main holds SessionBindings + typed-service handlers + compaction lifecycle. | DIFFERS, 4 main commits; probe CONFLICT. | B: same regression risk as extension.ts. |
| `packages/substrate/integrations/pi/parameters.ts` | NEW TypeBox schemas generated from the shared ParamSpec. | Absent. | New file. | B. |
| `packages/substrate/integrations/setup.ts` | 1-line change. | main has XTRM-692 variant. | DIFFERS, no main commits. | B/LOW. |
| `packages/substrate/integrations/tool-core.ts` | NEW 418-line shared tool behaviour: runTool() over services + DB for both adapters. | main has the equivalent behaviour split across mcp-server.ts handlers and pi/handlers.ts over the typed service, plus src/service/ops.ts (60 named operations). | New file. | B, and the design is superseded by the typed service: an in-process DB handle bypasses remote mode. |
| `packages/substrate/integrations/tool-surface.ts` | NEW 162-line single source for the 9 tool names, param specs, descriptions (2,311 chars total). | Absent; names and docs live in mcp-server.ts, Pi defineTool calls and docs/claude.md. | New file. | B, but the CONTENT (9-tool vocabulary, param docs, text budget) is the highest-value artefact of #302 and should be the basis of step 12. |
| `packages/substrate/plugin/substrate/hooks/hooks.json` | Adds SessionStart advisor + PostToolUse advisor hooks and a `modules: ["./register.tsx"]` block. | main hooks.json has 8 hook entries, no advisor, no modules. | DIFFERS, no main commits. | B: this is the old plugin surface step 12 replaces. |
| `packages/substrate/plugin/substrate/hooks/register.tsx` | NEW 175-line TSX status band module (claim TTL rows). | Absent. | New file. | B. |
| `packages/substrate/plugin/substrate/monitors/monitors.json` | Monitor gate becomes the bare skill name. | main pins `on-skill-invoke:substrate:using-substrate`. | DIFFERS, no main commits. | B, and the bare-name change is unproven on a live rig (the PR says so). |
| `packages/substrate/plugin/substrate/scripts/advisor-post-tool.mjs` | NEW hook entry for PostToolUse. | Absent. | New file. | B. |
| `packages/substrate/plugin/substrate/scripts/advisor-session.mjs` | NEW hook entry for SessionStart. | Absent. | New file. | B. |
| `packages/substrate/plugin/substrate/scripts/commit-check.mjs` | Hook output schema. | main has an older variant. | DIFFERS, no main commits. | B. |
| `packages/substrate/plugin/substrate/scripts/edit-gate.mjs` | Hook output schema + advisor identity. | main has XTRM-692 remote-hook variant. | DIFFERS, 1 main commit; probe CONFLICT. | B: conflicts with remote hook. |
| `packages/substrate/plugin/substrate/scripts/stop-gate.mjs` | Stop gate + advisor merge. | main has XTRM-692 remote-hook variant. | DIFFERS, 1 main commit; probe CONFLICT. | B. |
| `packages/substrate/plugin/substrate/skills/using-substrate/SKILL.md` | DELETED (0/134): plugin copy removed, skill becomes xt-installed. | main ships the plugin copy. | DIFFERS, 1 main commit. | B: deletion depends on an xt-side change that does not exist in this repo. |
| `packages/substrate/plugin/substrate/tests/register.test.ts` | NEW 99-line test for the TSX status module. | Absent. | New file. | B. |
| `packages/substrate/plugin/substrate/tsconfig.json` | 1-line: include the .tsx module. | Absent. | New file. | B. |
| `packages/substrate/skills/using-substrate/SKILL.md` | 117/58: one host-neutral skill with frontmatter, 9 tools, Pi prefix rule, hooks-vs-events table. | main has a Pi-facing half that differs from the plugin copy; XTRM-679 is marked DONE but nothing from it is on main. | DIFFERS, 1 main commit (08e9ee9). | B, and the "xt installs it" half is not backed by an xt change. |
| `packages/substrate/tests/advisor-parity.test.ts` | NEW: Claude and Pi advisors produce identical output for identical state. | Absent. | New file. | B. |
| `packages/substrate/tests/claude-advisor.test.ts` | NEW: Claude hook JSON per event. | Absent. | New file. | B (imports integrations/claude-code/advisor.ts). |
| `packages/substrate/tests/claude-lifecycle.test.ts` | 4/1: lifecycle hook expectations. | main has the older expectations. | None (no main commits). | B. |
| `packages/substrate/tests/docs-drift-gate.test.ts` | 17/30: reads TOOL_NAMES from tool-surface.ts, drops the plugin skill dir, gates against docs/claude.md. | main reads TOOL_DEFS from mcp-server.ts and gates against docs/cli.md. | None (no main commits). | B: cannot land before tool-surface.ts. |
| `packages/substrate/tests/entrypoint-flush.test.ts` | Adds the two advisor scripts to the flush/exit-code matrix. | main has no advisor scripts. | None. | B. |
| `packages/substrate/tests/execution-context.test.ts` | 15/10: openServices/runBeforeCompact signatures. | main uses the typed-service handler signatures. | DIFFERS, 1 main commit (8ff21b7); probe CONFLICT. | B. |
| `packages/substrate/tests/journal-text-limit.test.ts` | NEW: 16k limit across CLI/MCP/Pi. | Absent. | New file. | B (imports the Pi extension and MCP server), though the domain half is A. |
| `packages/substrate/tests/m1-tool-surface.test.ts` | 23/49: table read from tool-surface.ts, text budget. | main asserts the TOOL_DEFS table. | None. | B. |
| `packages/substrate/tests/mcp-cli-decoupling.test.ts` | 5/3: adds tool-core.ts to the decoupling boundary. | main asserts mcp-server.ts boundaries only. | None. | B. |
| `packages/substrate/tests/mcp-protocol.test.ts` | 59/43: nine-tool inventory, description budget. | main asserts the 13-tool inventory. | None. | B. |
| `packages/substrate/tests/pi-integration.test.ts` | 30/40: discoverIssueRef and tool registration expectations. | main changed this for XTRM-691. | DIFFERS, 1 main commit (8ff21b7); probe CONFLICT. | B. |
| `packages/substrate/tests/pi-load.test.ts` | 5/5: expected tool names -> 9 shared names. | main expects 8. | None. | B. |
| `packages/substrate/tests/pi-run.ts` | NEW 17-line helper: run a tool through tool-core with a Pi context. | Absent. | New file. | B. |
| `packages/substrate/tests/plugin-packaging.test.ts` | 11/24: bare monitor gate, drops the plugin-skill equality tests. | main pins the namespaced gate and the byte-identical Authority block. | None. | B: silently weakens two live gates. |
| `packages/substrate/tests/sb-improve-p0.test.ts` | NEW 163-line P0 hook-output tests (edit gate deny+remedy, commit check, stop gate, PostCompact, transcript gist). | Absent. | New file. | B. |
| `packages/substrate/tests/tool-surface.test.ts` | NEW 238-line shared-surface contract test. | Absent. | New file. | B. |
Part B is coherent on its own terms: one catalogue (`src/presentation/advisories.ts`), one advisor
engine (`integrations/advisor.ts`), two thin host mappings, one tool surface for both adapters.
It is also the part that (i) rewrites files main changed for remote mode, and (ii) assumes the
Claude plugin is replaced by an xt-installed skill — an xt-side change that does not exist in this
repository (`~/.xtrm/skills/default/` has no `using-substrate`). Preserve, do not merge.

## Overlaps with the named issues

| Issue | Status | Relation to #302 | Consequence for the adoption |
|---|---|---|---|
| CORE-2536 worktree identity / holder derivation | DONE | Core derives a holder from the worktree *directory slug* in `xt attach` (`holderFromWorktreePath`), overriding an inherited value. #302 derives it inside Substrate from `.xtrm/worktrees/<repo>-xt-<runtime>-<name>`. | Do not port `resolveIdentity`'s worktree branch. Substrate keeps reading `SUBSTRATE_HOLDER` only (XTRM-722). Keep `identity_missing`/`holder_mismatch` advisories as *diagnostics*. |
| CORE-2581 Substrate recall (design, READY) | OPEN | Its single query surface is `sb recall "<terms>"` plus an MCP tool. #302's `tool-surface.ts` is the only landed-on-branch catalogue of model-facing tool names, parameters and text budget. | #302's tool surface is the natural place to register `recall`; note it in CORE-2581 and land `recall` through the same table at step 12, not ad-hoc. |
| XTRM-679 one using-substrate skill | DONE (unmerged) | Its two commits are inside #302 (frontmatter, `pi.skills`, plugin copy deletion, "xt installs it"). | Split: the frontmatter + host-neutral content is landable once (B); the plugin-copy deletion and `pi.skills` removal need the xt change. Do not treat DONE as landed. |
| XTRM-685 / XTRM-690 / XTRM-691 / XTRM-692 / XTRM-711 / XTRM-712 | merged | Postdate #302's base; they own the store-access path #302 predates. | Part (A) lands unchanged in principle; part (B) must be rebuilt on `createLocalService` / `StoreCall`. |
| XTRM-722 claim holder | merged | Owns holder resolution (`resolveClaimHolder`, `holderSource`). | #302's `resolveHolder` + `claimData` are replaced by it; the `issue renew` verb and the strict parser remain A. |

## Proposed Phase 2 PR sequence (part A only)

| PR | Contents | Why this order | Risk |
|---|---|---|---|
| A1 — journal text limit and entry quality | `src/domain/journal.ts`, `src/service/journal-service.ts`, `src/service/integration-service.ts`, `src/compatibility/beads/import.ts`, `src/workitems/{store,substrate-store}.ts`, `docs/substrate/journal.md`, tests `journal`, `journal-kinds`, `session-precedence`, `workitems`, `hermetic-env` | Zero conflicts; self-contained; unlocks `--summary-file`. | LOW |
| A2 — advisory catalogue (core only) | `src/presentation/advisories.ts`, `src/index.ts`, `docs/advisories.md` (identity section rewritten to XTRM-722 policy), test `advisories` | Pure library, no adapter; keeps the biggest artefact of #302 reviewable on its own. | LOW-MED |
| A3 — CLI contract: strict parsing, renew, help, feedback | `cli/sb.ts`, `cli/sb-ux.ts`, `src/presentation/terminal.ts`, `src/presentation/operation-feedback.ts`, `src/domain/{claim,contract,issue}.ts`, `src/service/{issue,closure,resume}-service.ts`, `docs/cli.md`, `docs/substrate/cli.md` (additions only), tests `sb-improve-p1`, `locator-display`, `xtrm94-surface-alignment` | Depends on A1+A2; the only conflicted PR, so it is isolated. | HIGH |
| A4 — CHANGELOG + README (A-facing parts) | `packages/substrate/CHANGELOG.md` Unreleased bullets, `README.md` non-B lines | Last so the entries name what actually landed. | LOW |

Do **not** include in any A PR: `integrations/**`, `plugin/**`, `skills/**`, `package.json`'s
`pi.skills`, `docs/claude.md`, `docs/pi.md`, or the branch's version headers.

## Phase 3 (for the record, not this phase)

Part (B) is preserved as `xt/sb-improve-plugin` (branch from `e7a17d6`, or keep `xt/sb-improve`
untouched and add the new branch as a pointer) and referenced from CORE-2391 and XTRM-668 before
#302 is closed. Nothing in phase 1 or 2 may force-push or delete `xt/sb-improve`.

## Risks and open questions

1. **Cherry-pick hazard.** Three commits delete code main added (`resolveClaimHolder`, the remote
   docs, the holder paragraph). Any mechanical `cherry-pick` of `7087974` is unsafe; A3 must be
   hand-merged hunk by hunk.
2. **`sb-improve-p1.test.ts` (399 lines) is the acceptance gate for A3** and it was written against
   the branch's `runCli` signature. Expect edits where main's XTRM-722 output (`holderSource`,
   `claimData`) wins.
3. **`issue renew`** needs `FLAG_ALLOWLIST`, `sb help` text and `sb-ux.ts` READ_ONLY to agree; the
   test `xtrm94-surface-alignment` is the drift gate.
4. **Advisory identity** must be documented as a diagnostic, not a holder source; otherwise the
   next reader re-introduces worktree derivation into Substrate.
5. **Open question for core-85:** whether `docs/advisories.md` (A) should describe the hook wiring
   that only lands in phase 3, or stay catalogue-only. Recommendation: catalogue-only.
6. **Open question for core-85:** whether part (A) should also carry
   `tests/journal-text-limit.test.ts` split into a CLI-only half (currently it imports the Pi
   extension and the MCP server, so it is classified B).
