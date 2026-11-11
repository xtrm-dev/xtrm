# xtrm-tui reuse map — Pi 1.5.2 (spike, TUI-SPIKE-1/2 reduced)

Source: `@earendil-works/pi-coding-agent 1.5.2`, pi-tui bundled at the same
version (verified in `packages/xtrm-tui/node_modules`, single deduped
`pi-tui@1.5.2`). Written against 1.3.0 and revalidated on 1.5.2 (XTRM-743):
every surface below is still exported with the same shape.

## Runtime / session (all DEPEND — public SDK)

| Surface | Status | Use |
|---|---|---|
| `createAgentSessionRuntime` + `CreateAgentSessionRuntimeFactory` | public export, `dist/core/agent-session-runtime.d.ts` | DEPEND — live binding (`src/live.ts`), mirrors `examples/sdk/13-session-runtime.ts` |
| `createAgentSessionServices` / `createAgentSessionFromServices` | public export | DEPEND — runtime factory services |
| `AgentSession` (`prompt`, `subscribe`, `abort`, `waitForIdle`, `bindExtensions`, `dispose`) | public, `dist/core/agent-session.d.ts` | DEPEND |
| `AgentSessionEvent` (`message_update`/`text_delta`, `tool_execution_*`, `agent_end{willRetry}`, `agent_settled`, `queue_update`) | public type | DEPEND — settle rule: `agent_end` ignored, `agent_settled` closes exactly once |
| `SessionManager` (`create`, `inMemory`) | public export | DEPEND — spike uses `inMemory(cwd)` for isolation |
| `DefaultResourceLoader` | public export | DEPEND — standard discovery, no parallel system |
| `getAgentDir` | public export (used by example 13) | DEPEND |

## Interactive components (all present in 1.5.2 `dist/modes/interactive/components/`)

| Component | File | Disposition |
|---|---|---|
| `TreeSelectorComponent` | `tree-selector.d.ts` | REFERENCE (spike) — conversation-tree overlay is a stub; ADAPT later for `Ctrl+B` |
| `SessionSelectorComponent` | `session-selector.d.ts` | REFERENCE — resume/picker UI deferred |
| `ModelSelectorComponent` | `model-selector.d.ts` | REFERENCE — `Ctrl+L` model picker deferred |
| `ScopedModelsSelectorComponent` | `scoped-models-selector.d.ts` | REJECT for v0 — no scoped-model UI in spike |
| `ToolExecutionComponent` | `tool-execution.d.ts` | REFERENCE — XTRM tri-state policy differs (`compressed → normal → expanded` vs stock collapsed/expanded); ADAPT later, do not wrap now |
| `AssistantMessageComponent` | `assistant-message.d.ts` | REFERENCE — spike renders `Markdown` directly |
| `Editor` / `Input` (pi-tui) | `editor.ts` / `input.ts` | DEPEND — composer is stock `Input`, focus propagated |
| `VStack` / `ScrollView` / `Text` / `Markdown` | pi-tui `dist` | DEPEND — shell layout + selected-frame viewport |
| `TuiAltScreen` + `ProcessTerminal` | pi-tui `dist/tui-alt-screen.d.ts` | DEPEND — alt-screen host, proven by `packages/xts/src/ui/app.mjs` |
| `OverlayHandle` / `ctx.ui.custom({overlay:true})` | pi-tui `dist/tui.d.ts` | REFERENCE — no overlays in spike |

## License / provenance

Pi packages are the operator's installed npm distribution; no source copied.
`packages/xts/src/ui/app.mjs` (in-repo, MIT-era Pi usage) is the bootstrap
reference: alt-screen construction, `addInputListener` key interception,
50 ms streaming render debounce. No Pi interactive-mode code forked.
