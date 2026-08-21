# XTS v1 verification record

This record maps PRD §24 criteria 1–27 to executable evidence. Run commands from
`packages/xts/`. `✅` means verified by the current focused run or code audit;
`🔶` means the evidence requires a manual check; `⏳` means the criterion remains
open or depends on an unfinished bead.

| # | PRD §24 criterion | Evidence | Status |
|---:|---|---|:---:|
| 1 | `xts` starts a standalone minimal terminal assistant | `test/e2e.mjs`: `PTY retained final answer + restore`; `test/perf.mjs`: PTY TUI smoke | ✅ |
| 2 | Normal Pi/XTRM skills are not loaded | `test/runtime.test.mjs`: `closed loader exposes an empty, closed runtime surface`; `src/runtime.mjs:34-47` | ✅ |
| 3 | Generic Pi extension discovery is not used as the XTS feature model | `test/runtime.test.mjs`: closed loader extensions/prompts/themes/agents are empty; `src/runtime.mjs:34-47` | ✅ |
| 4 | Beads, Specialists, MCP, GitNexus, XTRM context injection, and LSP are absent | Manual audit: `grep -RInE 'beads|specialists|MCP|GitNexus|LSP|AGENTS' src`; `src/runtime.mjs` closed loader | 🔶 |
| 5 | Only the intended model-facing operational tool surface is available | `test/runtime.test.mjs`: `createXtsSession reuses the invocation ModelRuntime and exposes only bash` | ✅ |
| 6 | First launch requires explicit model selection | `test/model.test.mjs`: first-launch `resolveOrSelectModel`; `src/cli.mjs:202-210` | ✅ |
| 7 | Model selection comes from Pi's available model inventory | `test/model.test.mjs`; `test/e2e.mjs`: `model --json inventory` | ✅ |
| 8 | XTS persists the selected provider/model pair | `test/config.test.mjs`; `test/e2e.mjs`: `config round trip` | ✅ |
| 9 | XTS never silently changes models | `test/model.test.mjs`: unavailable persisted model resolves to null; no fallback in `src/model.mjs` | ✅ |
| 10 | `xts model` changes the persisted model | `test/model.test.mjs` and `test/cli.test.mjs`: model selector/config persistence | ✅ |
| 11 | Standard invocations automatically receive bounded recent shell commands | `test/shell.test.mjs`, `test/prompt.test.mjs`; `test/e2e.mjs`: shell-context redaction | ✅ |
| 12 | Current working directory is available | `test/shell.test.mjs`: `loadShellContext cwd`; `test/e2e.mjs`: `--show-prompt` envelope | ✅ |
| 13 | Previous shell command exit code is available when shell integration supports it | `test/shell.test.mjs`; `test/e2e.mjs`: state-file prompt envelope | ✅ |
| 14 | Shell integration prints nothing after normal commands | `test/e2e.mjs`: `shell integration silence`; exact manual command: `bash -c 'source src/history/hook.bash; xts_hook'` | ✅ |
| 15 | `xts "question"` works as a one-shot request | `test/e2e.mjs`: `live one-shot answer` using the configured available model | ✅ |
| 16 | `command | xts` analyzes stdin | `test/e2e.mjs`: `bare + explicit delayed pipe`; `test/cli.test.mjs`: bare-pipe prompt smoke | ✅ |
| 17 | `command | xts "question"` combines stdin with an explicit instruction | `test/e2e.mjs`: explicit delayed pipe asserts both instruction and evidence | ✅ |
| 18 | Large stdin is bounded and truncation is explicit | `test/stdin.test.mjs`; `test/e2e.mjs`: `bounded stdin truncation notice` | ✅ |
| 19 | `xts run "command"` executes through the XTS safety gate | `test/run` coverage via `test/cli.test.mjs`; `test/e2e.mjs`: safe and dangerous run paths | ✅ |
| 20 | Safe commands do not require user approval | `test/classify.test.mjs`; `test/e2e.mjs`: `xts run safe path` | ✅ |
| 21 | Dangerous commands require explicit user approval | `test/approve.test.mjs`, `test/runtime.test.mjs`; `test/e2e.mjs`: dangerous PTY approval path is covered by `xts run` gate smoke | ✅ |
| 22 | Cancelled dangerous commands are not executed | `test/approve.test.mjs`; `test/e2e.mjs`: `xts run dangerous deny + no-exec sentinel` | ✅ |
| 23 | Interactive conversation history persists correctly | `test/e2e.mjs`: `persistent conversation recall` runs two isolated persistent sessions and checks the second transcript | ✅ |
| 24 | TUI redraw remains stable in supported terminals | `test/ui.test.mjs`; `test/e2e.mjs`: PTY answer retention and alt-screen restore (`ESC[?1049l`) | ✅ |
| 25 | Startup does not initialize unrelated XTRM/Pi systems | `src/runtime.mjs:34-47` closed resource loader; lazy imports in `src/cli.mjs`; `test/perf.mjs` startup smoke | ✅ |
| 26 | Performance measurements show initialization overhead below typical model latency | `test/perf.mjs` table: cold 38.9 ms, warm mean 45.0 ms, first visible PTY TUI 177.2 ms, peak RSS 46,932 KiB | ✅ |
| 27 | Model and system prompt remain intentionally small | `test/perf.mjs`: system prompt 89 heuristic tokens, bash schema 128 heuristic tokens; `test/prompt.test.mjs` | ✅ |

## PRD §18 metrics

Measured on 2026-08-21 with Node.js 24 and the local package checkout:

| Metric | Result | Target/evidence |
|---|---:|---|
| Cold process startup (`xts --help`) | 38.9 ms | `< 1.5 s` non-model startup |
| Warm process startup (five-run mean) | 45.0 ms | `< 1.5 s` non-model startup |
| Time to first visible TUI (PTY smoke) | 177.2 ms | `< 2 s` interactive smoke |
| System prompt size | 89 tokens | 4 characters/token heuristic |
| Bash tool schema size | 128 tokens | 4 characters/token heuristic |
| Peak RSS (`xts --help`) | 46,932 KiB | recorded; `/usr/bin/time` or child `process.memoryUsage()` fallback |

The metrics are heuristic measurements, not model-tokenizer counts. The live
one-shot and PTY checks use the available local model inventory and therefore
need authenticated provider configuration. They print `SKIP` when the inventory
is empty.

## Commands

```bash
# New integrated surfaces
timeout 90 node test/perf.mjs
timeout 300 node test/e2e.mjs

# Focused existing suites
timeout 90 node --test test/cli.test.mjs
timeout 90 node --test test/runtime.test.mjs
timeout 90 node --test test/ui.test.mjs
```

The security hardening bead `xtrm-nka.7.3` was still in progress when this
record was written. Its final verification is not substituted by this smoke
record; any failed narrow security finding must remain open here until that
bead reports its result.
