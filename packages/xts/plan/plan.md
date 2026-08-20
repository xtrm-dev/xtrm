# XTS v1 — Implementation Plan (from /skill:planning)

Epic: `xtrm-nka` — XTS v1: minimal shell assistant on Pi SDK + pi-tui

## Architecture summary

XTS is a standalone ESM Node application in `packages/xts` (no build step), built on the
Pi SDK (`@earendil-works/pi-coding-agent@0.84.2`) + `@earendil-works/pi-tui@0.84.2`.

```
xts (cli.mjs)
 ├─ config.mjs            ~/.config/xtrm/xts.json ({ model: { provider, id } })
 ├─ model.mjs             ModelRuntime inventory + resolve + selector
 ├─ history/shell.mjs     silent shell hook state (cwd, lastExitCode, recent 10)
 ├─ context.mjs           ShellContext envelope
 ├─ stdin.mjs             bounded stdin + explicit truncation notice
 ├─ prompt.mjs            small system prompt + user envelope
 ├─ safety/classify.mjs   deterministic dangerous-command classifier
 ├─ safety/approve.mjs    approval flow (TUI overlay / one-shot prompt)
 ├─ runtime.mjs           createAgentSession: closed surface, bash-only, gated
 ├─ ui/app.mjs            pi-tui conversation app (header, history, input)
 └─ ui/{model-selector,approval}.mjs   overlays
```

## Key SDK decisions (verified against pi-coding-agent 0.84.2)

- Model inventory: `ModelRuntime.create({ allowModelNetwork:false, refreshOnCreate:false })` + `getAvailable()`
- Session: `createAgentSession({ model, tools:["bash"], resourceLoader: <closed loader>, sessionManager, settingsManager: SettingsManager.inMemory(...), thinkingLevel:"off" })`
- Closed surface: minimal `ResourceLoader` object returning empty collections (pattern: examples/sdk/12-full-control.ts) — never DefaultResourceLoader discovery
- Bash gate: `createBashTool(cwd, { operations: gatedOperations })` where `ops.exec` runs classify → approve → real exec; or a custom tool definition wrapping it
- Persistence: `SessionManager.create(cwd)` for interactive; `inMemory` for one-shot
- TUI: pi-tui `ProcessTerminal`, `Container`, `Text`, `Input`, `Markdown`, `Box`, `VStack`, `SelectList`
- Classifier: adapt structural matchers from `@aliou/pi-guardrails` `src/core/commands/dangerous.ts` locally (no Guardrails runtime dependency)

## Board

| # | Issue | Deps | Layer |
|---|-------|------|-------|
| 1 | Scaffold package (pkg.json, cli entry, config) | — | shell |
| 2 | Model resolution + selector + persistence | 1 | boundary |
| 3 | Shell context (hooks, redaction) | 1 | core |
| 4 | Stdin + prompt assembly | 3 | core |
| 5 | Safety classifier + approval | 1 | core |
| 6 | TUI (conversation, selector, approval overlays) | 2 | boundary |
| 7 | Runtime + CLI wiring (AgentSession, modes, persistence) | 2,3,4,5,6 | shell |
| 8 | Tests, perf, acceptance audit (27 criteria) | 7 | operational |

## Execution

- Dispatch one subagent per task in dependency order (1 → {2,3,5} → {4,6} → 7 → 8), 2 in parallel where independent.
- Each subagent reads `bd show <id>` as its contract, implements, runs `node --test`, reports OUTPUT.
- Orchestrator verifies each result, updates/claims beads, resolves failures before advancing.
- Final: audit 27 PRD §24 acceptance criteria against evidence, close beads, report.

## Exploration evidence

- GitNexus index unavailable for packages/xts (new dir); used targeted reads of SDK .d.ts/.js + docs/sdk.md + examples + guardrails source (fallback path per planning skill).
- Recent state: xtprompt (convention reference) shipped; no XTS work exists anywhere; branch is unrelated feature work (fix/agentsession-sre-pq1-4-5-diag-dump...).
