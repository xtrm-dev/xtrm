# Runtime wiring — verified prototype evidence (orchestrator)

Prototyped against the real SDK (`@earendil-works/pi-coding-agent@0.84.2`), live model
(`commandcode/google/gemini-3.7-flash`). Source: /tmp/xts-proto/proto4.mjs

## Verified facts (do not re-derive)

1. **Closed surface + bash-only tools**: `createAgentSession({ model, thinkingLevel:"off",
   modelRuntime, settingsManager: SettingsManager.inMemory({...}), resourceLoader: <empty loader>,
   tools: ["bash"], sessionManager: SessionManager.inMemory(cwd) })` →
   `session.getActiveToolNames()` returns exactly `['bash']`. System prompt comes from the
   loader's `getSystemPrompt()`.
   - Startup: `ModelRuntime.create({ allowModelNetwork:false, refreshOnCreate:false })` = **11ms**,
     `createAgentSession` = **8ms** (in-memory session).
   - The empty loader (from examples/sdk/12-full-control.ts) is the correct closed surface:
     getExtensions/getSkills/getPrompts/getThemes/getAgentsFiles all empty; extensions result
     comes back empty.

2. **Safety gate via custom bash tool operations**: `createBashTool(cwd, { operations: gatedOps })`
   where `gatedOps.exec` runs the classifier → approval → real `createLocalBashOperations().exec`.
   Pass as `customTools: [bashTool]` with `tools: ["bash"]` — the custom tool overrides the
   builtin bash (same name) AND is the only active tool.
   - Verified: model's `echo safe-ok` went through `gatedOps.exec` (gate log) and streamed output.
   - Verified deny: `rm -rf /tmp/x` → gate threw → `tool_execution_end isError: true` with
     result text "Command blocked by XTS safety gate: recursive force delete"; the model
     reported the block to the user. No execution happened.
   - Chained commands (`echo safe-ok && rm -rf ...`) are a single bash call → single gate check
     on the whole string (conservative: classified dangerous → whole call denied).

3. **executeBash passthrough**: `session.executeBash("echo hi", onChunk)` works and returns
   { output, exitCode, cancelled, truncated }.

4. **Events for the TUI**: `message_update` with `assistantMessageEvent.type === "text_delta"`
   streams text; `tool_execution_start/end` give tool name/args/result/isError; `agent_end`
   marks run completion.

## Wiring recipe for task xtrm-nka.7 (runtime.mjs)

```js
const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
const settings = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: false },          // deterministic, fast
  autoCompact: { enabled: false },
});
const loader = { /* empty loader as above, getSystemPrompt: () => SYSTEM_PROMPT */ };
const bashTool = createBashTool(cwd, { operations: makeGatedOperations({ classifier, approver }) });
const { session } = await createAgentSession({
  model, thinkingLevel: "off", modelRuntime: runtime,
  settingsManager: settings, resourceLoader: loader,
  customTools: [bashTool], tools: ["bash"],
  sessionManager: SessionManager.create(cwd),   // interactive: persistence
});
```

Approver signature for the gate: the gated ops `exec` is async; for dangerous commands it must
await the approval promise (TUI overlay from ui/approval.mjs, or deny in non-TTY). The prototype
threw immediately on deny; production should await `approve({command, reason})` and only throw if
denied, so approved dangerous commands still execute.

One-shot (`xts "q"` / pipe): same construction but `SessionManager.inMemory(cwd)` (no cross-run
history pollution) — or a dedicated named session if PRD §17.2 evaluation favors it.

## Caveats
- `executeBash` bypasses the gated tool (it uses the agent's bash executor directly) — XTS should
  use the custom-tool path for all model-driven bash, and `run.mjs` for `xts run`.
- TUI events for tool rows come from `tool_execution_start/end` subscriptions, not the bash tool
  render hooks.

## Task-7 verification (orchestrator, live)

- One-shot: `node src/cli.mjs "Reply with exactly: XTS-OK"` → `XTS-OK`, exit 0.
- Pipe: `echo "pipe data here" | xts "Reply with exactly the last two words"` → `data here`.
- Dangerous gate via live model: model asked to `rm -rf /tmp/xts-gate-test` → tool result
  "Command blocked by XTS safety gate: recursive force delete"; sentinel survived. (AC 19/21/22)
- Interactive pty: header `╭─ xts · <cwd> ─· <model>`, user prompt, streamed answer `PTY-OK`,
  Ctrl+C clean restore. (AC 1/24)
- Conversation persistence: `SessionManager.continueRecent(cwd, ~/.local/state/xts/sessions)`;
  run1 stored `2026-08-21T13-18-29-031Z_...jsonl`, run2 restored 2 messages and recalled
  codeword BLUEBERRY. XTS uses its OWN session dir (never Pi's). (AC 23)
- Model resolution fix: resolveModel now returns the runtime's Model object (plain
  {provider,id} produced empty model responses).
- UI fix: ConversationView constructor no longer shadows the setCwd method.
- stdin fix: maybeReadStdin destroys the idle pipe handle so execFile/CI exits (no hang).
