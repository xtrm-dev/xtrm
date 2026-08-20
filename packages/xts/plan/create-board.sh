#!/usr/bin/env bash
# Create the XTS v1 bd board: epic + child tasks with 7-section contracts.
set -euo pipefail
cd /home/dawid/dev/xtrm

EPIC=$(bd create \
  --title="XTS v1 — minimal shell assistant on Pi SDK + pi-tui" \
  --type=epic \
  --priority=2 \
  --description="$(cat <<'EOF'
## PROBLEM

Normal coding agents (Pi/XTRM) carry far more runtime and cognitive machinery than a small terminal problem requires: skills, extensions, Beads, specialists, MCP, GitNexus, repository workflows. A user who just wants "why did that pull fail?" or "what is listening on 8080?" should not pay that startup and context cost. XTS must be a separate, closed-runtime terminal assistant that starts fast, carries bounded shell context automatically, exposes exactly one operational tool (bash) behind a deterministic safety gate, and stays materially smaller than a normal Pi session. PRD: packages/xts/xts-prd-0.1.0.md.

## SUCCESS

An `xts` binary in packages/xts that satisfies all 27 PRD acceptance criteria (PRD §24): standalone startup with no Pi/XTRM resource discovery; explicit persisted model selection from Pi's ModelRuntime inventory; bounded shell context (cwd, last exit code, last 10 commands); one-shot `xts "question"`; stdin pipe mode with explicit bounded truncation; `xts run` through the deterministic dangerous-command gate; interactive conversation with streaming, prompt history, and persisted conversation history; compact TUI built on @earendil-works/pi-tui; startup overhead substantially below model latency.

## SCOPE

- packages/xts/ — new package (package.json, src/, test/, README.md, shell hook installer)
- PRD contract: packages/xts/xts-prd-0.1.0.md (read-only reference)
- Read-only dependencies (do NOT modify): @earendil-works/pi-coding-agent@0.84.2 (global SDK), @earendil-works/pi-tui@0.84.2, @aliou/pi-guardrails@0.16.1 (classifier reference)

## NON_GOALS

- No skills, Specialists, Beads, MCP, GitNexus, LSP, repository indexing, subagents, RLM, memory promotion, extension discovery, file-editing tools (PRD §5)
- No automatic model switching/fallback; no automatic invocation after shell failures
- No "always allow" / session-allow / policy editor / custom rule UI for the safety gate (PRD §14.2)
- No full terminal transcript capture (PRD §9.3)
- No fish/PowerShell support, no searchable global history, no model-switch shortcut (PRD §26)
- Do NOT modify the Pi SDK, pi-tui, or pi-guardrails packages

## CONSTRAINTS

- Plain ESM JavaScript (.mjs) following packages/xtprompt convention; no build step, no TypeScript compile
- node >= 24; tests via `node --test` (see test/README.md)
- Startup must not initialize: skills, extensions, MCP, Beads subprocesses, GitNexus, AGENTS scanning, package inventory scanning, LSP, Python kernels (PRD §18)
- Tool surface = bash only (PRD §13); guard via createAgentSession({ tools: ["bash"], ... }) with custom bash tool (createBashTool with operations/spawnHook)
- Model selection explicit; persist { provider, id } in ~/.config/xtrm/xts.json; never silently substitute (PRD §8)
- Shell integration must be silent (no post-command hints) (PRD §10)
- Config location: ~/.config/xtrm/xts.json (small file)
- Conversation persistence via Pi SessionManager (default ~/.pi/agent/sessions or per-PRD evaluation); PRD §17
- Logging/telemetry contract: XTS may log to stderr (one-shot) or a debug env flag XTS_DEBUG=1; log lines: timestamp, level, component, event, duration_ms, redacted context. Never log credentials or command output payloads.

## VALIDATION

- [ ] All 27 PRD §24 acceptance criteria verified with concrete evidence
- [ ] `node --test` suite green in packages/xts
- [ ] Startup timing measured: cold process startup and time-to-TUI recorded in test/perf notes
- [ ] Smoke run: `xts model` lists inventory, one-shot `echo hi | xts "say hi"` style checks work against authenticated models
- [ ] Shell integration silent (no stdout pollution after a command)
- [ ] Safety gate: dangerous command requires approval, denied commands not executed
- [ ] No XTS startup path initializes skills/extensions/MCP/Beads (verified by code inspection + perf)
- [ ] Per-task OUTPUT sections populated in bead close reasons

## OUTPUT

Orchestrator reports: per-child handoff summary referencing each bead's OUTPUT, integration evidence (smoke + tests), performance measurements, residual risks (open questions from PRD §25).

## REFERENCES

- PRD: packages/xts/xts-prd-0.1.0.md
- SDK docs: /home/dawid/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md
- TUI docs: .../pi-tui/dist/index.d.ts (Container/Input/Markdown/Box/VStack/SelectList)
- Classifier reference: .../pi-guardrails/extensions/permission-gate/rules.ts + src/core/commands/dangerous.ts
- Convention reference: packages/xtprompt/src/*.mjs
EOF
)" \
  --silent)
echo "EPIC=$EPIC"

# Child 1: Scaffold package (created first -> $EPIC.1)
bd create \
  --title="Scaffold XTS package — package.json, entrypoints, config types" \
  --type=task \
  --priority=2 \
  --parent "$EPIC" \
  -d "$(cat <<'EOF'
## PROBLEM

The PRD requires a standalone binary `xts` in packages/xts (PRD §19) with a closed runtime surface and no build step. Nothing exists yet in packages/xts beyond the PRD markdown and empty docs/ and .pi/ directories. This task establishes the package skeleton every other task builds on: package.json with bin entry, the module entrypoints, and the tiny config module that all startup paths read.

## SUCCESS

- packages/xts/package.json exists with: name @xtrm/xts, type module, bin { "xts": "src/cli.mjs" }, engines node >=24, scripts.test = "node --test", files = [src, README.md]
- src/cli.mjs is the executable entrypoint that parses argv (xts / xts "question" / xts run "cmd" / xts model) and dispatches; must not import the SDK at module top level (lazy-load inside handlers to keep startup fast)
- src/config.ts-style module (plain .mjs) reading ~/.config/xtrm/xts.json: { model: { provider, id } }, with atomic write helper and tolerant read (missing/corrupt file => default)
- README.md with usage, install, and dev notes
- No build step; package runs directly under node 24

## SCOPE

- packages/xts/package.json (new)
- packages/xts/src/cli.mjs (new, entrypoint)
- packages/xts/src/config.mjs (new)
- packages/xts/README.md (new)
- Reference convention: packages/xtprompt/package.json, packages/xtprompt/src/cli.mjs

## NON_GOALS

- No CLI logic implementation beyond dispatch stubs (model selection, session, stdin, safety are separate tasks)
- No TUI work
- No dependency installation beyond the SDK package

## CONSTRAINTS

- Plain ESM .mjs; no build step; follow xtprompt package.json shape
- cli.mjs must lazy-import heavy modules (pi-coding-agent) only inside command handlers so `xts --help` stays instant
- Config file permissions: create ~/.config/xtrm/ with mode 0700 if missing
- Do not touch packages outside packages/xts

## VALIDATION

- [ ] `node packages/xts/src/cli.mjs --help` exits 0 fast (<300ms) without loading the SDK
- [ ] `node --check` passes on all new .mjs files
- [ ] config module round-trip test: write {model:{provider,id}}, read back; corrupt file -> default; missing file -> default
- [ ] `npm test` (node --test) green in packages/xts
- [ ] package.json bin points at executable cli.mjs

## LIBRARIES

- Reuse in repo: packages/xtprompt/package.json + cli.mjs (convention)
- Installed deps: @earendil-works/pi-coding-agent@0.84.2 (declared as dependency)
- Stdlib: node:fs, node:path, node:os, node:url (import.meta.main pattern from xtprompt)
- New dep candidate: none
- Roll it: yes — package skeleton is the foundation

## OUTPUT

Changed files list, `node --check` + `npm test` evidence, `--help` timing measurement, config round-trip test output.
EOF
)" \
  --silent

# Child 2: Model resolution + selection (depends on 1)
bd create \
  --title="Model resolution — Pi ModelRuntime inventory + xts model selector + persistence" \
  --type=task \
  --priority=2 \
  --parent "$EPIC" \
  --deps "$EPIC.1" \
  -d "$(cat <<'EOF'
## PROBLEM

PRD §8 requires explicit, persisted model selection sourced from Pi's model inventory — never Pi's default, never silent substitution. First launch must show a selector of available (authenticated) models; `xts model` reopens it; the selected provider/model pair persists to ~/.config/xtrm/xts.json.

## SUCCESS

- src/model.mjs: `resolveModel(runtime, config)` returns the persisted model if available; `listAvailable(runtime)` returns models from ModelRuntime.getAvailable() grouped by provider; `pickModel` runs the selector
- Model inventory authority is Pi's ModelRuntime (built-ins + models.json + auth); XTS stores only the preference (PRD §8.2)
- `xts model` opens a keyboard-navigable model selector (up/down, enter confirm, esc cancel) and persists selection; `xts model --json` (dev flag) prints the inventory for tests
- First launch with no persisted model opens the selector; if selection cancelled -> exit 1 with clear message
- Selected model unavailable (auth missing/removed): `xts` shows message + reopens selector; never auto-falls-back (PRD §8.4, §21)
- Non-interactive fallback: when stdin is not a TTY and no model persisted, error clearly (no selector possible)

## SCOPE

- packages/xts/src/model.mjs (new)
- packages/xts/src/config.mjs (extend read/write if needed)
- packages/xts/src/ui/model-selector.mjs (new, minimal TUI selector using pi-tui)
- packages/xts/src/cli.mjs (wire `xts model` and first-launch selector)

## NON_GOALS

- No model auto-cycle/fallback (PRD §8.4)
- No OAuth login UI (auth stays Pi-owned; error message tells user to run `pi` to authenticate)
- No settings UI

## CONSTRAINTS

- ModelRuntime.create() with default authPath/modelsPath (~/.pi/agent) so Pi auth + models.json are authoritative; allowModelNetwork: false, refreshOnCreate: false (startup must stay fast — snapshot + lazy refresh only)
- Persist exactly { model: { provider, id } } in ~/.config/xtrm/xts.json (config.mjs owns file I/O)
- If runtime.getAvailable() is empty: error message instructs configuring auth through Pi (`pi`) — no second auth system
- Selector uses pi-tui (ProcessTerminal + Input/SelectList-style list or minimal custom component); keyboard: ↑↓ select, Enter confirm, Esc cancel
- Must NOT silently choose a different model at session start

## VALIDATION

- [ ] `xts model --json` prints inventory JSON from ModelRuntime (grep test)
- [ ] Config write/read round trip of selected model
- [ ] First-launch path (no config) yields selector; cancel -> exit 1 with message
- [ ] Missing/unavailable model -> clear error, no fallback substitution (unit test with stub runtime)
- [ ] node --test green for model module tests

## LIBRARIES

- Reuse in repo: config.mjs from task 1; pi-tui selector pattern: pi-coding-agent dist/modes/interactive/components/model-selector.d.ts (read-only reference)
- Installed deps: @earendil-works/pi-coding-agent (ModelRuntime), @earendil-works/pi-tui (ProcessTerminal, Container, Text, Input)
- Stdlib: node:fs/promises
- New dep candidate: none — reuse Pi inventory
- Roll it: yes

## OUTPUT

model.mjs + selector implementation, test output, `xts model --json` sample, config file sample, evidence that unavailable model does not auto-fallback.
EOF
)" \
  --silent

# Child 3: Shell context (depends on 1)
bd create \
  --title="Shell context — silent shell integration, cwd/lastExitCode/recent commands" \
  --type=task \
  --priority=2 \
  --parent "$EPIC" \
  --deps "$EPIC.1" \
  -d "$(cat <<'EOF'
## PROBLEM

PRD §9/§10: standard invocations must automatically receive bounded shell context (cwd, shell identity, last exit code, last 10 commands) via a silent shell integration. The integration must print nothing after commands and must not capture stdout/stderr/transcripts.

## SUCCESS

- src/history/shell.mjs: reads bounded shell context — cwd, shell identity, last exit code, last N=10 commands — from a compact state file written by a silent shell hook
- src/history/hook.sh: bash hook fragment + src/history/hook.zsh (or one generator with both) that writes the state file after each command; emits zero stdout/stderr
- `xts shellhook` (dev command) prints the hook snippet for the current shell and instructions (source it in ~/.bashrc / ~/.zshrc); supports bash and zsh (PRD §10.2)
- Context unavailable (no hook installed): XTS still works with cwd + stdin + manual question; recent-shell context clearly omitted (PRD §21)
- Sensitive command filtering: commands containing obvious secret forms (token=, password=, api[_-]?key=, BEGIN PRIVATE KEY blocks, `key=...` assignment with long value) are redacted from the recent-command list (PRD §25 open item — implement deterministically and conservatively)

## SCOPE

- packages/xts/src/history/shell.mjs (new: state read + redaction)
- packages/xts/src/history/hook.bash / hook.zsh (new)
- packages/xts/src/cli.mjs (wire `xts shellhook` + context assembly)
- packages/xts/src/context.mjs (new: assemble ShellContext envelope for the model prompt)

## NON_GOALS

- No transcript capture, no environment-variable capture, no scrollback capture (PRD §9.3, §22)
- No fish/PowerShell hooks (PRD §26)
- No auto-install of hooks into user shell config

## CONSTRAINTS

- Hook writes state to a fixed path: $XDG_STATE_HOME/xts/state.json or ~/.local/state/xts/state.json; format: { cwd, shell, lastExitCode, recentCommands: [...] } (last 10)
- Hook must be silent: no echo, no ANSI output, no errors visible; failures must not affect the shell
- Redaction: deterministic conservative patterns only (see SUCCESS); redacted entries replaced with "[redacted]"
- ShellContext envelope rendered into the model prompt (prompt.mjs task 5 consumes it); this task provides the data module only
- Do not touch model/prompt/safety/UI modules

## VALIDATION

- [ ] Unit tests: redaction patterns (secret forms redacted, normal commands intact), bounded N=10, corrupt/missing state -> graceful empty context
- [ ] Manual smoke: install hook in bash, run commands, verify state file content and zero hook output
- [ ] zsh hook syntax check (zsh -n if available)
- [ ] `xts shellhook` prints snippet and instructions
- [ ] node --test green

## LIBRARIES

- Reuse in repo: none beyond task 1 config
- Installed deps: none new (hook is pure shell; state read uses node:fs)
- Stdlib: node:fs, node:os
- New dep candidate: none
- Roll it: yes

## OUTPUT

shell.mjs + hooks + context.mjs, test evidence, sample state file, redaction test output, shellhook output sample.
EOF
)" \
  --silent

# Child 4: stdin + prompt assembly (depends on 1,3)
bd create \
  --title="Stdin pipe mode + bounded truncation + system prompt assembly" \
  --type=task \
  --priority=2 \
  --parent "$EPIC" \
  --deps "$EPIC.3" \
  -d "$(cat <<'EOF'
## PROBLEM

PRD §7.3/§11: `command | xts` and `command | xts "question"` must treat stdin as first-class evidence with bounded input and an explicit truncation notice. PRD §15: the system prompt must be intentionally small. Both feed the same prompt builder.

## SUCCESS

- src/stdin.mjs: reads stdin asynchronously; bounds input — max bytes (e.g. 64KB) and max lines (e.g. 2000); when truncated, records truncation metadata (original bytes/lines, what was kept) — silent truncation never happens (PRD §11.1)
- src/prompt.mjs: builds the small XTS system prompt (PRD §15 conceptual content, tuned) + per-run user message envelope that includes: user instruction (if any), ShellContext (cwd, shell, lastExitCode, recentCommands from task 3), stdin evidence block (with visible "stdin truncated" notice when applicable), and the guarded-execution context marker
- The envelope renders into the first user message sent to the model; system prompt stays fixed and small
- Prompt builder is pure (no I/O) and unit-testable

## SCOPE

- packages/xts/src/stdin.mjs (new)
- packages/xts/src/prompt.mjs (new)
- packages/xts/src/context.mjs (consume; owned by task 3)
- test/stdin.test.mjs, test/prompt.test.mjs (new)

## NON_GOALS

- No streaming stdin processing; no partial-read heuristics
- No transcript capture

## CONSTRAINTS

- Truncation policy constants exported: MAX_STDIN_BYTES=65536, MAX_STDIN_LINES=2000; strategy: keep head, then head-of-tail marker "[... stdin truncated: X of Y bytes (Z lines) ...]" visible to model and user
- System prompt token budget: keep under ~200 tokens; measured via prompt.mjs test asserting approximate length
- ShellContext rendered compactly (one block, no prose) so tokens stay small
- Do not emit secrets: stdin content is user-provided evidence (allowed), but the envelope must not auto-include env vars or credentials

## VALIDATION

- [ ] Unit tests: small stdin passes through whole; huge stdin truncated with visible notice; truncation metadata exact; prompt envelope contains cwd/exit code/recent commands/notice
- [ ] System prompt size assert (< 200 tokens by heuristic char count)
- [ ] node --test green

## LIBRARIES

- Reuse in repo: context.mjs (task 3), config.mjs (task 1)
- Installed deps: none new
- Stdlib: node:stream, node:buffer
- New dep candidate: none
- Roll it: yes

## OUTPUT

stdin.mjs + prompt.mjs + tests, sample built prompt (with and without stdin/truncation), token-size measurement.
EOF
)" \
  --silent

# Child 5: Safety classifier + gate (depends on 1)
bd create \
  --title="Safety gate — dangerous-command classifier + approval flow" \
  --type=task \
  --priority=2 \
  --parent "$EPIC" \
  --deps "$EPIC.1" \
  -d "$(cat <<'EOF'
## PROBLEM

PRD §14: the bash tool must sit behind a deterministic, small safety gate. Dangerous commands (recursive destructive deletes, formatting, raw disk writes, privileged destructive ops, dangerous permission changes, destructive git ops, configured high-risk patterns) require explicit user approval before execution. Denied commands must not execute.

## SUCCESS

- src/safety/classify.mjs: command classifier returning { safe: true } or { safe: false, reason, pattern } for dangerous commands; adopts the minimal concept from pi-guardrails permission-gate (structural matchers for rm -rf, shred, sudo/doas/pkexec, dd of=, mkfs/wipefs/blkdiscard/fdisk/parted, chmod -R 777, chown -R, docker/podman dangerous flags) — implemented locally, not by loading the Guardrails package (PRD §14.1)
- src/safety/approve.mjs: approval flow — interactive overlay/prompt (Enter approve once, Esc cancel) shown in the TUI; in one-shot (non-TTY) mode, approval prompts on stdin with clear y/n; default is deny (PRD §14.2)
- Gate is integrated with the bash tool execution path so EVERY bash call goes through it: safe -> execute; dangerous -> approval -> execute or block; blocked -> model receives a clear "command denied" result, conversation continues (PRD §21)
- `xts run "command"` uses the same gate (PRD §7.4): classify first, approve if dangerous, execute, pass result to model for interpretation when needed
- Cancelled/denied commands are not executed (PRD §21)

## SCOPE

- packages/xts/src/safety/classify.mjs (new)
- packages/xts/src/safety/approve.mjs (new)
- packages/xts/src/runtime.mjs (integrate gate into bash tool via createBashTool operations/spawnHook or tool wrapper; owned by task 7 wiring — this task provides classify+approve and a `gateCommand(command, ctx)` function)
- packages/xts/src/cli.mjs (wire `xts run`)

## NON_GOALS

- No "always allow"/session-allow/policy editor/custom rule UI (PRD §14.2)
- No file-access policies (Guardrails policies/path-access are out of scope)
- No loading the full @aliou/pi-guardrails package at runtime

## CONSTRAINTS

- Classifier is deterministic pure logic (no I/O); unit-testable
- Structural matching: parse command words (simple tokenizer adequate for v1; full AST not required) and match command+flags; also support configured extra patterns from XTS config optional array
- Default deny on approval timeout/EOF; one-shot mode must never execute a dangerous command without explicit user yes
- Gate must run BEFORE any execution; wrap the bash tool so the gate sees every command (including chained `&&`/`|` segments — classify the whole string, conservative)
- Redaction: do not log full command payloads in gate failure logs

## VALIDATION

- [ ] Unit tests: each dangerous pattern family classified dangerous with reason; benign variants (rm file, git pull, ls, npm test) classified safe; false-positive guards (rm -rf denied, rm -f file allowed, mkdir -p allowed)
- [ ] Integration: `xts run "rm -rf /tmp/x"` prompts, deny -> not executed (evidence: temp dir still exists)
- [ ] Integration: `xts run "echo hi"` executes without approval
- [ ] Approved dangerous command executes
- [ ] node --test green

## LIBRARIES

- Reuse in repo: none
- Installed deps: none new at runtime (classifier implemented locally, adapted from @aliou/pi-guardrails@0.16.1 src/core/commands/dangerous.ts patterns — read-only reference)
- Stdlib: none
- New dep candidate: none — local implementation keeps XTS small and dependency-free
- Roll it: yes

## OUTPUT

classify.mjs + approve.mjs + tests, pattern coverage list, integration evidence for the three `xts run` scenarios above.
EOF
)" \
  --silent

# Child 6: TUI app (depends on 1,2)
bd create \
  --title="TUI — conversation view, input, model selector overlay, approval overlay" \
  --type=task \
  --priority=2 \
  --parent "$EPIC" \
  --deps "$EPIC.2" \
  -d "$(cat <<'EOF'
## PROBLEM

PRD §16: XTS needs a minimal compact terminal UI built on @earendil-works/pi-tui: header (cwd · model), conversation history, input line, streaming assistant output, and overlays for model selection and dangerous-command approval. The UI must redraw stably and stay compact.

## SUCCESS

- src/ui/app.mjs: main TUI — header bar (cwd · model, per PRD §16.1 visual target), scrollable conversation area (user prompts + assistant markdown-ish text + tool rows like `$ git status`), input line with ↑/↓ prompt history, streaming delta updates from AgentSession events (message_update text_delta), graceful Ctrl+C/exit
- src/ui/model-selector.mjs: overlay listing available models grouped by provider (from model.mjs), ↑↓ select, Enter confirm, Esc cancel (used by first launch and `xts model`)
- src/ui/approval.mjs: overlay for dangerous command approval — shows the command and reason, Enter approve once / Esc cancel
- Rendering uses pi-tui primitives (Container, Text, Input, Markdown, Box) with differential redraw; stable on resize
- The TUI module never touches model/safety logic directly — it receives callbacks

## SCOPE

- packages/xts/src/ui/app.mjs (new)
- packages/xts/src/ui/model-selector.mjs (new)
- packages/xts/src/ui/approval.mjs (new)
- packages/xts/src/ui/input.mjs (if a thin Input wrapper is needed)
- Reference: pi-tui dist/index.d.ts (Container, Input, Markdown, Text, Box, VStack), pi-coding-agent examples/extensions for component patterns

## NON_GOALS

- No session-tree UI, no settings UI, no theme editor (PRD §5)
- No fancy formatting beyond minimal Markdown rendering
- No image rendering

## CONSTRAINTS

- pi-tui only — do not import pi's interactive mode component tree; build compact components (reuse presentation helpers by reference, not by loading xtrm-ui)
- Keyboard: ↑/↓ prompt history in input; Enter sends; Esc in overlays cancels; Ctrl+C exits (confirm if streaming)
- Streamed assistant text renders incrementally without full re-paint flicker
- Tool execution rows render as `$ command` + bounded preview (borrow bounded-output-preview idea from XTRM UI presentation; no file/mutation of model results)
- All UI code pure-render; I/O only through callbacks/handlers provided by runtime/app wiring

## VALIDATION

- [ ] Component unit tests where feasible (pure render functions produce expected lines)
- [ ] Manual smoke in a terminal: interactive session renders header, prompt, answer, tool row, prompt history up/down
- [ ] Overlay flows: model selector opens/cancels/confirms; approval overlay approves/cancels
- [ ] Resize stability: resize terminal mid-session, no crash (documented manual check)
- [ ] node --test green

## LIBRARIES

- Reuse in repo: none
- Installed deps: @earendil-works/pi-tui@0.84.2 (Container, Input, Text, Markdown, Box, VStack, ProcessTerminal)
- Stdlib: none
- New dep candidate: none
- Roll it: yes

## OUTPUT

ui modules + tests, manual smoke notes (header, streaming, history, overlays), sample rendered frame.
EOF
)" \
  --silent

# Child 7: Runtime + CLI integration (depends on 1,2,3,4,5,6)
bd create \
  --title="Runtime + CLI wiring — AgentSession integration, modes, persistence" \
  --type=task \
  --priority=2 \
  --parent "$EPIC" \
  --deps "$EPIC.1" \
  -d "$(cat <<'EOF'
## PROBLEM

PRD §12/§20: the pieces (model, context, stdin, prompt, safety, TUI) must integrate into a slim AgentSession runtime behind the four CLI modes (interactive, one-shot, pipe, run) with conversation persistence and a closed resource surface. This is the final wiring task.

## SUCCESS

- src/runtime.mjs: `createXtsSession({ model, cwd, tools })` — createAgentSession with: explicit model, tools: ["bash"] (+ custom bash tool through the safety gate), closed resource loader (no extensions/skills/prompt templates/context files), SettingsManager.inMemory or minimal, SessionManager persistence (per-PRD §17.2 evaluation; default SessionManager.create(cwd) for conversation history continuity), thinkingLevel off (fast) or settings-based
- Closed surface verified: resourceLoader returns empty extensions/skills/prompts/themes/agentsFiles; system prompt = XTS prompt (PRD §12.1, acceptance 2/3/4)
- src/cli.mjs wires all four modes:
  - `xts` interactive: TUI + streaming + guarded bash + prompt history + conversation persistence
  - `xts "question"` one-shot: print answer, exit (PRD §20.2)
  - `command | xts ["question"]`: stdin evidence + answer, exit (PRD §20.3)
  - `xts run "command"`: gate -> execute -> result to model for interpretation -> display (PRD §20.4)
- Conversation persistence: interactive sessions continue previous turns; `SessionManager` handles message history save (PRD §17.2); one-shot uses in-memory or named session
- Model unavailable at session start -> selector (from task 2) or clear error in non-TTY
- All events wired: message streaming to TUI/stdout, tool execution rows, errors returned to model with exact shell evidence (PRD §21)

## SCOPE

- packages/xts/src/runtime.mjs (new)
- packages/xts/src/cli.mjs (extend)
- packages/xts/src/main.ts-style entry (if needed)
- test/runtime.test.mjs, test/cli.test.mjs (integration tests with stubbed SDK where needed)

## NON_GOALS

- No RPC mode, no server mode, no extensions, no skills, no MCP wiring
- No multi-session tree UI
- No automatic model fallback

## CONSTRAINTS

- Lazy imports: the SDK (pi-coding-agent) imported only when a model-requiring mode runs, keeping `xts --help` and `xts shellhook` instant
- ResourceLoader: implement minimal explicit loader returning empty collections (pattern: examples/sdk/12-full-control.ts resourceLoader object) — do NOT call DefaultResourceLoader discovery
- SessionManager: default SessionManager.create(cwd) for interactive (conversation history); one-shot may use SessionManager.inMemory(cwd)
- Bash tool: createBashTool with operations wrapping the safety gate (classify -> approve -> exec) so every model bash call is gated; `xts run` calls the same gate directly
- Thinking level: off for fast answers (configurable later); auto-retry off to keep behavior deterministic
- Errors: model/tool failures surface exact evidence; never report success on failure
- All user-facing messages concise; exit codes: 0 success, 1 errors, 2 usage

## VALIDATION

- [ ] Integration test (stubbed SDK or live if auth available): one-shot returns answer text; pipe mode includes stdin evidence in prompt
- [ ] Closed-surface assertion test: resourceLoader.getExtensions()/getSkills()/getPrompts()/getThemes()/getAgentsFiles() all empty; system prompt is the XTS prompt
- [ ] Interactive smoke: start `xts` in a pty, send prompt, receive streamed answer, conversation persists to session file
- [ ] `xts run` safe command executes; dangerous command gated
- [ ] Perf: cold `xts --help` <300ms; `xts "q"` startup (model load + context) measured and reported
- [ ] node --test green

## LIBRARIES

- Reuse in repo: tasks 1-6 modules
- Installed deps: @earendil-works/pi-coding-agent@0.84.2 (createAgentSession, ModelRuntime, SessionManager, SettingsManager, createBashTool), @earendil-works/pi-tui@0.84.2
- Stdlib: node:child_process (spawn for run mode), node:readline (one-shot approval fallback)
- New dep candidate: none
- Roll it: yes — final integration task

## OUTPUT

runtime.mjs + cli.mjs wiring, integration test output, closed-surface evidence, interactive smoke notes, perf measurements, sample session file path.
EOF
)" \
  --silent

# Child 8: Tests + perf + acceptance audit (depends on 7)
bd create \
  --title="Tests, performance measurement, and acceptance-criteria audit" \
  --type=task \
  --priority=2 \
  --parent "$EPIC" \
  --deps "$EPIC.7" \
  -d "$(cat <<'EOF'
## PROBLEM

PRD §18 requires performance metrics (cold/warm startup, time-to-TUI, prompt/tool token counts, peak RSS) and PRD §24 lists 27 acceptance criteria that must each be verifiable. The per-task tests cover seams; this task owns the integrated verification surface.

## SUCCESS

- test/perf.mjs: measures cold process startup, warm startup, time to first visible TUI (interactive smoke via pty), system-prompt token count (heuristic), tool-schema token count, peak RSS (process.memoryUsage / /usr/bin/time); prints a table; assertions: startup overhead substantially below typical model latency (target: full non-model startup < 1.5s, interactive TUI < 2s)
- test/acceptance.md: checklist mapping each of the 27 PRD §24 criteria to its verification evidence (test name / smoke command / manual check), with status per criterion
- test/e2e.mjs (or shell script): smoke suite — xts --help, xts shellhook output, config round trip, model inventory json, one-shot answer (live model if available, else documented skip), pipe mode, truncation notice, xts run safe/dangerous/deny paths, redaction checks; skips live-model checks when no authenticated model
- Every acceptance criterion has either automated evidence or a documented manual check with exact commands

## SCOPE

- packages/xts/test/perf.mjs (new)
- packages/xts/test/acceptance.md (new)
- packages/xts/test/e2e.mjs (new)
- packages/xts/README.md (update: verification section)

## NON_GOALS

- No CI wiring beyond the package test script (repo has no per-package CI requirement)
- No publishing setup

## CONSTRAINTS

- Perf script must not require network/auth (measures only XTS initialization); uses child_process spawn + process.hrtime
- Acceptance doc must map criteria 1-27 exactly (PRD §24) and mark each verified / not-verified / manual with evidence path
- e2e smoke must exit non-zero on failure; live-model steps skip gracefully with SKIP reason when no model available
- Do not modify implementation modules except fixing bugs found (report via OUTPUT)

## VALIDATION

- [ ] perf.mjs runs and prints metrics table; numbers recorded in acceptance.md
- [ ] acceptance.md covers all 27 criteria with evidence
- [ ] e2e.mjs passes on this machine (live-model steps SKIP or pass)
- [ ] `npm test` green (all suites)
- [ ] README verification section updated

## LIBRARIES

- Reuse in repo: none new
- Installed deps: none new
- Stdlib: node:child_process, node:process, node:fs
- New dep candidate: none
- Roll it: yes — final verification task

## OUTPUT

perf metrics table, acceptance.md with 27/27 status, e2e smoke output, README verification section.
EOF
)" \
  --silent

echo "=== board verification ==="
bd children "$EPIC"
bd graph "$EPIC" 2>/dev/null | head -40 || true
bd dep cycles 2>/dev/null | head -10 || true
echo "EPIC=$EPIC"
