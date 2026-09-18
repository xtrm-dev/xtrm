# Authority audit: deterministic boundaries (XTRM-504, criterion 9)

## Scope

- Question: does any System One or research-platform backend reach a path that decides a verdict, writes state, or performs a side effect in the three areas below? The backends in scope are `xtrm_research`, TypeSafe, Jev, System One, Noul, rerankers, and any probabilistic model call.
- Area 1: board-audit (`packages/board-audit`).
- Area 2: service-knowledge verification (`packages/service-knowledge`, `packages/service-knowledge-ext`).
- Area 3: production mutation paths (`packages/substrate` write, claim, and close paths; the `sre-ops` skill at `~/.xtrm/skills/optional/sre-ops`).
- Commit: `78006cf4b39588852dda2dfdb971560c8debc579` (branch `xt/hguv`, clean tree). The `sre-ops` skill is not under git. It was audited as installed on 2026-09-18.
- Research platform start: `b0bc90a` (2026-09-17, "feat(research): package skeleton", XTRM-426). The history window below starts at 2026-09-01, which is earlier than that commit.

All commands run from the repository root. The term set `T` and the client set `N` are defined as follows:

```sh
T='(?i)xtrm_research|typesafe|\bjev\b|system[_ -]?one|\bnoul\b|rerank'
N='(?i)\b(import|from)\s+(requests|httpx|aiohttp|anthropic|openai|urllib\.request|http\.client|socket|exa_py)\b|urlopen\(|\bfetch\(|from ["'"'"'](node:)?(https?|net|undici|axios|openai|@anthropic-ai/[\w-]+)["'"'"']|require\(["'"'"'](node:)?(https?|net|axios)["'"'"']\)|\b(curl|wget)\s|api\.anthropic|api\.openai|exa\.ai'
M='modelRegistry|\.complete\(|summarizer|streamSimple|completeSimple|getModel\('
R='xtrm_research|typesafe|jev|system_?one|noul|rerank|anthropic|openai|httpx|requests|urllib|aiohttp'   # filter on AST-extracted import sources
```

## Searches

| # | Check | Command |
|---|---|---|
| S1 | Forbidden terms (text, all tracked and untracked non-ignored files) | `rg -c -P "$T" <path>` |
| S2 | Network and model clients (text) | `rg -c -P "$N" <path>` |
| S3 | Host-model calls, which S2 misses | `rg -c -P "$M" <path>` |
| S4 | Python imports (AST) | `bunx @ast-grep/cli run -p 'from $M import $$$N' -l python --json=stream <path> \| jq -r '.metaVariables.single.M.text' \| grep -ciE "$R"`, and the same with `-p 'import $M'` |
| S5 | TS imports (AST, kind rule) | `bunx @ast-grep/cli scan --inline-rules $'id: imp\nlanguage: ts\nrule: {kind: string, inside: {kind: import_statement}}' --json=stream <path> \| jq -r .text \| grep -ciE "$R"` |
| S6 | History since 2026-09-01 | `git log --since=2026-09-01 --oneline --perl-regexp -G '(xtrm_research\|[Tt]ype[Ss]afe\|typesafe\|\b[Jj]ev\b\|[Ss]ystem[_ ]?[Oo]ne\|\bnoul\b\|rerank\|anthropic\|openai\|httpx)' -- <paths>` |

## Positive controls

Each check was run against a target that contains the terms. A check that cannot fire proves nothing.

| Check | Target | Result |
|---|---|---|
| S1 terms | `packages/research` | 549 hits in 69 files (fires) |
| S2 clients | `packages/research` | 12 hits (fires) |
| S4 Python AST | `packages/research` | 165 `from` hits (163 of them `xtrm_research.*`), 6 `import` hits (fires) |
| S4 Python AST | synthetic `c.py` (`from xtrm_research.runner import ...`, `import httpx`) | 1/1 and 1/1 (fires) |
| S5 TS AST | synthetic `c.ts` (`import { judge } from "@typesafe/jev"`, `import Anthropic from "@anthropic-ai/sdk"`) | 2/2 (fires) |
| S5 TS AST | `packages/substrate` | 806 import sources extracted (so the rule parses the tree) |
| S6 history | `packages/research` since 2026-09-01 | 13 commits (fires) |

Note: the first TS pattern tried, `import $$$A from $S`, matched only 1 of 2 synthetic imports. The audit uses the kind rule in S5, which matched both.

## Results per area

### Area 1: board-audit

Decision and mutation entry points:
- `board-audit-roundtrip.py`: `cmd_validate`, `cmd_diff`, `cmd_compile`, `cmd_apply` (board writes), `cmd_verify`.
- `board-audit-pr.py`: `cmd_pr_checkpoint`, `write_projection`, `cmd_doctor`.
- `board-audit-flow.py`: `cmd_handoff`, `cmd_reconcile`.
- Shell entry points: `board-audit`, `board-audit-core`, `board-audit-fanout`, `board-audit-export-wt`, `board-audit-pr-adapter.sh`.

| Check | Hits | Detail |
|---|---|---|
| S1 terms | 0 | none |
| S2 clients | 1 | `tests/test_gitleaks_transport.py:36 import urllib.request`. The test downloads the gitleaks binary. It is not on a decision path. |
| S3 host model | 0 | none |
| S4/S5 AST | 1 | the same test import |
| S6 history | 0 commits | no area commits since 2026-09-01 |

Verdict: CONFIRMED UNCHANGED.

### Area 2: service-knowledge verification

Decision and mutation entry points:
- `src/service_knowledge/scripts/verifier/gate.py:compute_gate` returns the `GateVerdict`.
- `src/service_knowledge/scripts/verifier/__main__.py:main`, `claim_extractor.py:extract_claims`, `structural_validator.py:validate_structure`/`has_errors`, `closure_markers.py:detect_closure`.
- `src/service_knowledge/scripts/reconcile.py:gated_write` and `reconcile` write skill files.
- `service-knowledge-ext/index.ts` registers `service-knowledge:status`, which is read-only. Its only subprocess is `execFileSync("git", ["rev-parse", ...])`.

| Check | Hits | Detail |
|---|---|---|
| S1 terms | 1 | `src/service_knowledge/index/query.py:10` is a docstring that says "no reranker". It is a negation, not a usage. |
| S2 clients | 1 | `src/service_knowledge/scripts/reconcile.py:148 import httpx` inside `call_nano_gpt` |
| S3 host model | 0 | none |
| S4/S5 AST | 1 (+`urllib.parse`) | the same `httpx` import. `urllib.parse` is a URL parser only. |
| S6 history | 0 commits | no area commits since 2026-09-01 |

`call_nano_gpt` is a model call, so it was reviewed separately:
- It was introduced in `2d91be9` on 2026-07-24 (`git log -S call_nano_gpt`). That date is before the research platform existed.
- It sends requests to a nano-gpt.com drafter. That drafter is not System One.
- It only drafts candidate text.
- The write decision is deterministic. In `gated_write` (reconcile.py:282-294), `compute_gate(manifest)` decides, and only a PASS or PASS_WITH_ADVISORIES verdict reaches `atomic_write`.
- The header comment at reconcile.py:27 states "deterministic only — no residual LLM critic".

Verdict: CONFIRMED UNCHANGED. The verdict authority is deterministic. The pre-existing LLM drafter is outside the verdict authority.

### Area 3: production mutation paths

Decision and mutation entry points (Substrate):
- `src/service/issue-service.ts`: `createIssue`, `claimIssue`, `releaseClaim`, `addEdge`.
- `src/service/closure-service.ts`: `closeIssue`, `reopenIssue`.
- `src/service/journal-service.ts`: `appendEntry`, `checkpoint`.
- `src/workitems/substrate-store.ts`: `claim`, `close`.
- CLI `cli/sb.ts`.

Entry points in `sre-ops`:
- `scripts/alert_history.py` and `scripts/alert_investigator.py` send only Prometheus `GET /api/v1/{rules,query_range}` requests through `_HTTP_OPENER.open(url)`.
- The `references/*.md` files describe rollback and restart steps as prose for the operator. No script runs them.

| Check | Hits | Detail |
|---|---|---|
| S1 terms, substrate | 1 | `tests/fixtures/beads-parse-blind-dependencies.jsonl:5` is fixture data that contains "no LLM reranker". |
| S1 terms, sre-ops | 0 | none |
| S2 clients, substrate | 1 | the same fixture file, line 7 (text about the mcpq client) |
| S2 clients, sre-ops | 2 | `urllib.request` in the two read-only Prometheus scripts |
| S3 host model, substrate | src 10, integrations 20, plugin 1, cli 0, hooks 0 | All hits belong to the journal checkpoint summarizer. See below. |
| S4/S5 AST | substrate 0/806 TS imports; sre-ops 4 (`urllib.parse`/`urllib.request`) | none on the forbidden list |
| S6 history | 2 commits | `a6fb21a` (2026-09-17) adds the fixture text "no LLM reranker". `91a285c` (2026-09-09) adds `@anthropic-ai/sdk` to `package-lock.json` as a transitive dependency of the Pi packages. Neither commit adds a coupling. |

The S3 hits were reviewed separately:
- The optional `summarizer` in `JournalService.checkpoint` runs only after the mechanical journal row is committed (journal-service.ts:503-545).
- The summarizer writes only the descriptive SEMANTIC enrichment. If it fails, the service records `journal.checkpoint_degraded`, and the mechanical row is kept.
- The Pi integration provides the summarizer through the host `ctx.modelRegistry.complete` (integrations/pi/extension.ts:236). This path was introduced in `91a285c` on 2026-09-09, which is before the research platform.
- Nothing in `issue-service.ts`, `closure-service.ts`, or `workitems/` calls the summarizer. A search for `summarizer` in these files found only a comment at store.ts:10. Claim, close, create, and edge writes therefore stay deterministic.

History: 109 area commits since 2026-09-01. Seven of them come after the first research commit `b0bc90a`: `641f30b`, `e2c7a39`, `3f3e3cb`, `986324c`, `bfab245`, `4240bb0`, `c1c5e74`. All seven are substrate identity, provenance, or release commits. The S6 pickaxe matched none of them.

Verdict: CONFIRMED UNCHANGED.

## Summary

| Area | Forbidden-backend hits on decision/mutation paths | Verdict |
|---|---|---|
| board-audit | 0 | CONFIRMED UNCHANGED |
| service-knowledge verification | 0 (the pre-existing nano-gpt drafter is gated by deterministic `compute_gate`) | CONFIRMED UNCHANGED |
| Production mutation (Substrate, sre-ops) | 0 (the pre-existing host-model summarizer only enriches committed checkpoints; sre-ops scripts are GET-only) | CONFIRMED UNCHANGED |

## Validation

- `cd packages/research && uv run pytest -q`: 547 passed.
- `uvx ruff@0.15.4 check .`: all checks passed.
- This change adds only this document.

## Limits

- The searches are static. They cannot see dynamic dispatch, runtime-configured endpoints, or models that a host selects at run time. For example, the Pi summarizer model comes from the operator's Pi `modelRegistry`, and `NANO_GPT_API_URL` comes from the environment. That URL is validated to use https and the host nano-gpt.com (reconcile.py:126).
- Code outside this repository is not covered: other repositories, installed CLIs (`sb`, `bd`, `gh`, `mcpq`), `node_modules`, and Python site-packages. The `@anthropic-ai/sdk` package in `node_modules` is present only as a transitive dependency. The audit found no import of it in the Substrate sources.
- The `sre-ops` skill has no git history. It was checked only as installed on 2026-09-18. Its rollback and restart steps are prose that a human operator or agent runs. No code enforces their content.
- `rg` respects `.gitignore`, so ignored and generated files were not searched.
- The term list is finite. A backend with a new name, or a model call routed through a generic HTTP helper under another name, would be missed. S2 and S3 reduce this risk but do not remove it.
