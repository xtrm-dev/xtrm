# XTS v1 — PRD §24 acceptance criteria audit worksheet

Map each criterion to evidence. Status: ✅ automated test / 🔶 manual check / ⏳ pending.

| # | Criterion (PRD §24) | Evidence | Status |
|---|---|---|---|
| 1 | `xts` starts a standalone minimal terminal assistant | interactive via pty smoke (task 7) | ⏳ |
| 2 | Normal Pi/XTRM skills not loaded | closed loader getSkills()=[] (runtime.mjs) + unit test | ✅ |
| 3 | Generic Pi extension discovery not the feature model | closed loader getExtensions()=[] (runtime.mjs) + unit test | ✅ |
| 4 | Beads/Specialists/MCP/GitNexus/XTRM context/LSP absent | no such imports in src/ (grep audit); startup code path | ✅/🔶 |
| 5 | Only intended model-facing tool surface available | session.getActiveToolNames()==['bash'] (runtime unit test) | ✅ |
| 6 | First launch requires explicit model selection | resolveOrSelectModel: no config -> selector (model.test.mjs) | ✅ |
| 7 | Model selection from Pi's available inventory | ModelRuntime.getAvailable() (model.test.mjs) | ✅ |
| 8 | Persists selected provider/model pair | config writeConfig round-trip (config.test.mjs) | ✅ |
| 9 | Never silently changes models | resolveModel returns null when unavailable; no fallback (model.test.mjs) | ✅ |
| 10 | `xts model` changes persisted model | cli model --json + selector persist (model.test.mjs / cli.test.mjs) | ✅ |
| 11 | Standard invocations receive bounded recent shell commands | loadShellContext (shell.test.mjs) + envelope (prompt.test.mjs) | ✅ |
| 12 | Current working directory available | loadShellContext cwd (shell.test.mjs) | ✅ |
| 13 | Previous exit code available when shell integration supports it | loadShellContext lastExitCode (shell.test.mjs) | ✅ |
| 14 | Shell integration prints nothing after commands | hook silence smoke (bash/zsh) | 🔶 |
| 15 | `xts "question"` works as one-shot | live one-shot smoke (task 7) | ⏳ |
| 16 | `command | xts` analyzes stdin | pipe smoke (task 7) | ⏳ |
| 17 | `command | xts "question"` combines stdin + instruction | pipe + instruction smoke (task 7) | ⏳ |
| 18 | Large stdin bounded, truncation explicit | stdin.test.mjs (8 tests) + envelope notice | ✅ |
| 19 | `xts run` executes through safety gate | run.mjs executeGuarded (approve/classify tests + cli) | ✅ |
| 20 | Safe commands need no approval | classify tests (safe cases) + cli run safe | ✅ |
| 21 | Dangerous commands require explicit approval | gate integration (proto + cli run deny) | ✅ |
| 22 | Cancelled dangerous commands not executed | deny path evidence (dir still exists) | ✅ |
| 23 | Interactive conversation history persists | SessionManager.create persistence smoke (task 7) | ⏳ |
| 24 | TUI redraw stable in supported terminals | pty smoke + resize (task 7/6) | 🔶 |
| 25 | Startup doesn't initialize unrelated systems | code-path audit (lazy imports, closed loader) + perf | ✅ |
| 26 | Perf measured; init overhead << model latency | perf.mjs (task 8) + proto timings (11ms runtime, 8ms session) | ⏳ |
| 27 | Model + system prompt small; feels faster/simpler | SYSTEM_PROMPT ~200 tokens (prompt.test.mjs) | ✅ |

## Perf targets (PRD §18)
- cold `xts --help`: 47ms (task 1) — target <300ms
- ModelRuntime.create: 11ms; createAgentSession: 8ms (proto)
- `xts "q"` full non-model startup: measure in task 8
- SYSTEM_PROMPT tokens: ~50 (task 4)
