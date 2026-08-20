# PRD — XTS: XTRM Slim Terminal Assistant

**Status:** Proposed  
**Date:** 2026-08-20  
**Product:** XTS — XTRM Slim Terminal Assistant  
**Primary repository:** `xtrm-dev/core`  
**Command:** `xts`  
**Target runtime:** Pi SDK / `AgentSession` + `@earendil-works/pi-tui`  
**Initial product stage:** minimal v1

## 1. Product summary

XTS is a lightweight terminal-native AI assistant for shell work.

The user invokes:

```bash
xts
```

and receives a small interactive terminal assistant that understands the immediate shell context, can reason about recent commands, can inspect the current environment, and can execute shell commands when necessary.

XTS is not a general-purpose coding agent.

It must remain substantially smaller and faster than a normal Pi session or the full XTRM runtime.

The intended interaction model is closer to a minimal shell copilot:

```text
shell
  ↓
xts
  ↓
small context + one model + bash
  ↓
answer / inspect / execute
```

The primary design objective is:

> The assistant must be sufficiently lightweight that invoking it for a small terminal problem has negligible cognitive and runtime friction.

## 2. Problem

Normal coding agents carry more runtime and cognitive machinery than is required for common shell assistance.

Examples include:

```text
"Why did this command fail?"

"What is currently listening on port 8080?"

"My git state is a mess. What happened?"

"Can I safely pull here?"

"Which process owns this file?"

"Why is this service restarting?"

"Explain this command output."

"Run this command and tell me what went wrong."
```

A full Pi/XTRM session may load or expose:

```text
skills
extensions
project context
Beads
specialist tooling
MCP
repository workflows
multiple tools
settings
memory/context systems
```

Those facilities are useful for coding and orchestration, but unnecessary for shell assistance.

XTS must provide a separate runtime surface optimized for terminal work.

## 3. Product principles

### 3.1 XTS is not a Pi profile

XTS must not be implemented as:

```text
pi + configuration that disables many things
```

The target is:

```text
small application
  using Pi SDK
  using Pi TUI
  with a closed runtime surface
```

This prevents accidental inheritance of Pi resource discovery, skills, settings, extension packages, or XTRM orchestration behavior.

Pi's SDK explicitly supports embedding `AgentSession` into custom applications and selecting the session tools and runtime behavior. 

### 3.2 Explicit is better than automatic

XTS should automatically obtain useful shell context.

It should not automatically:

```text
invoke itself after failures
change models
approve dangerous commands
load arbitrary project intelligence
discover skills
load generic extensions
```

### 3.3 Small context first

The model should receive only enough context to understand the immediate shell session.

Anything else should be inspected with `bash` on demand.

### 3.4 Expand from observed usage

The initial command surface must remain intentionally small.

New commands should be introduced only after real usage demonstrates a recurring need.

## 4. Goals

XTS v1 must provide:

```text
fast startup
explicit persistent model selection
automatic bounded shell-history context
current working directory awareness
previous command exit-status awareness
interactive conversation
one-shot questions
stdin/pipe analysis
guarded shell execution
conversation history
minimal terminal UI
```

The user should be able to invoke XTS for both trivial and moderately ambiguous shell problems without starting a full coding-agent workflow.

## 5. Non-goals

XTS v1 does not provide:

```text
skills
Specialists
Beads integration
XTRM workflow orchestration
MCP
GitNexus
LSP
repository indexing
agent delegation
subagents
RLM
memory promotion
generic Pi extension discovery
generic Pi settings UI
XTRM project-context injection
file-editing tools
code-editing workflows
session tree management UI
provider authentication management
automatic model selection
automatic model fallback
automatic invocation after shell failures
```

XTS is not intended to replace:

```text
pi
xt
sp
xtmux
```

## 6. Product positioning

```text
xt
  XTRM runtime and operator CLI

sp
  Specialists workflow / chain execution

pi
  full coding-agent environment

xts
  minimal shell assistant
```

The conceptual distinction is:

| Capability | XTS | Pi |
|---|---:|---:|
| Terminal questions | Yes | Yes |
| Shell execution | Yes | Yes |
| Pipe analysis | Yes | Yes |
| Shell-session context | Native product behavior | Possible |
| Dangerous-command approval | Yes | Extension-dependent |
| File editing | No | Yes |
| Skills | No | Yes |
| General extensions | No | Yes |
| MCP | No | Optional |
| XTRM context | No | Via XTRM |
| Specialists | No | Via XTRM |
| Primary use | shell assistant | coding agent |

## 7. CLI surface

The initial CLI surface is intentionally limited to:

```bash
xts
xts "question"
command | xts
command | xts "question"
xts run "command"
xts model
```

No additional top-level commands are required for v1.

### 7.1 `xts`

Starts the interactive assistant.

Example:

```bash
xts
```

XTS automatically receives bounded shell context.

If the immediately preceding command failed, the failure is available as context, but XTS must not assume the user wants diagnosis unless the user asks.

### 7.2 `xts "question"`

Runs a one-shot request using current shell context.

Example:

```bash
xts "why did that pull fail?"
```

XTS may inspect the environment using `bash`.

### 7.3 Pipe mode

Examples:

```bash
git status | xts
```

```bash
npm test 2>&1 | xts
```

```bash
journalctl -u api -n 200 | xts "why did this restart?"
```

```bash
git diff | xts "summarize this"
```

stdin becomes first-class model context.

### 7.4 `xts run`

Runs a command through XTS.

Example:

```bash
xts run "git pull --rebase"
```

The command passes through the deterministic command-safety gate before execution.

The assistant receives the result and may explain failures.

### 7.5 `xts model`

Opens the model selector.

Example:

```bash
xts model
```

The selected model becomes the persisted XTS model.

## 8. Model selection

Model selection must be explicit.

XTS must never silently use whatever model Pi currently considers its default.

### 8.1 First launch

If XTS has no persisted model:

```text
xts
  ↓
load Pi model inventory
  ↓
filter available models
  ↓
show model selector
  ↓
user selects model
  ↓
persist provider + model ID
```

Example UI:

```text
Select model for XTS

  Anthropic
    Claude Sonnet
    Claude Haiku

  OpenAI
  › GPT-5.6
    GPT-5.6 Codex

  OpenRouter
    ...

↑↓ select   Enter confirm   Esc cancel
```

### 8.2 Model inventory authority

XTS must use Pi's model runtime.

It must not implement an independent provider registry.

Pi's current `ModelRuntime` already loads and reconciles:

```text
built-in providers
models.json
stored credentials
authenticated providers
model availability
```

and exposes an `available` model set. 

Therefore:

```text
Pi owns:
  provider definitions
  models.json
  auth
  model availability

XTS owns:
  selected model preference
```

### 8.3 Persistence

Conceptual configuration:

```json
{
  "model": {
    "provider": "openai",
    "id": "..."
  }
}
```

Suggested location:

```text
~/.config/xtrm/xts.json
```

This file should remain intentionally small.

### 8.4 Missing model

If the selected model becomes unavailable:

```text
selected model unavailable
  ↓
model selector
  ↓
explicit replacement
```

XTS must not automatically choose another model.

## 9. Shell awareness

XTS should automatically understand a bounded amount of current shell context.

### 9.1 Context envelope

Every standard invocation should provide approximately:

```text
ShellContext
├── cwd
├── shell
├── lastExitCode
└── recentCommands[-N:]
```

Recommended initial history size:

```text
N = 10
```

The exact value may be tuned after usage testing.

### 9.2 Recent commands

Recent command history should be automatically included.

The user should not need:

```bash
xts --history
```

or:

```bash
xts --last
```

for ordinary usage.

Example:

```bash
git status
git checkout main
git pull
xts "why did that fail?"
```

The model receives those recent commands and may inspect repository state using `bash`.

### 9.3 No automatic transcript capture

XTS should not continuously record terminal stdout/stderr.

Default shell context is:

```text
commands
exit status
cwd
```

not:

```text
complete terminal transcript
```

This reduces:

```text
token usage
privacy exposure
latency
storage
context noise
```

Explicit pipe mode remains the mechanism for providing command output.

## 10. Shell integration

A minimal shell integration may be used to reliably communicate:

```text
current working directory
previous command
previous exit code
recent history
shell identity
```

The integration must remain silent.

It must never print a post-command hint such as:

```text
Run xts to diagnose
```

because that would contaminate terminal output and interfere with copying commands or output.

### 10.1 Desired behavior

```text
command executes
  ↓
shell hook records compact state
  ↓
nothing is printed
  ↓
user later invokes xts
  ↓
xts reads state
```

### 10.2 Supported shells

Initial target:

```text
bash
zsh
```

Other shells may be added later.

## 11. Pipe semantics

Pipe mode is a first-class XTS feature.

```text
producer command
    │
    ▼
  stdin
    │
    ▼
   xts
    │
    ├── stdin content
    ├── cwd
    ├── recent commands
    └── user instruction
```

Example:

```bash
docker compose logs api | xts "find the root cause"
```

XTS should understand that stdin is primary evidence.

Recent shell context remains available because it may explain why that output exists.

### 11.1 Large stdin

XTS must bound large input.

The initial implementation should define:

```text
maximum bytes or lines
truncation strategy
visible truncation notice
```

The model must be told when stdin has been truncated.

Silent truncation is not acceptable.

## 12. Agent runtime

XTS should use Pi programmatically.

Pi exposes `createAgentSession()` and supports an embedded application choosing the model, tools, session manager, and runtime behavior. 

The conceptual runtime is:

```text
xts
  createModelRuntime()
  resolveSelectedModel()
  createSlimAgentSession()
  attachBashTool()
  attachSafetyGate()
  attachHistory()
  startTui()
```

### 12.1 Resource discovery

Normal Pi resource discovery must not become the XTS runtime boundary.

XTS must avoid loading:

```text
skills
prompt-template directories
project extensions
global extensions
themes not owned by XTS
AGENTS instructions
XTRM extensions
MCP adapters
```

The implementation should use an explicit or empty resource-loader path.

## 13. Tool surface

The model should initially receive exactly one operational tool:

```text
bash
```

Do not provide separate:

```text
read
write
edit
grep
find
ls
```

tools in v1.

Rationale:

```text
fewer tool definitions
→ lower tool-selection entropy
→ smaller prompt
→ faster model decisions
→ clearer product behavior
```

The assistant may use normal shell commands for inspection.

### 13.1 Mutation behavior

The system prompt should bias toward inspection before mutation.

XTS may execute safe shell commands when required.

Dangerous shell commands require explicit approval.

## 14. Safety model

Safety must remain deterministic and small.

The safety path is:

```text
bash tool call
  ↓
command classifier
  ├── safe
  │     ↓
  │   execute
  │
  └── dangerous
        ↓
      approval UI
        ├── approve
        │     ↓
        │   execute
        │
        └── cancel
```

### 14.1 Dangerous-command detection

The classifier should identify high-risk patterns such as:

```text
recursive destructive deletion
filesystem formatting
raw disk writes
privileged destructive commands
dangerous permission changes
process-wide destructive actions
clearly destructive git operations
other explicitly configured high-risk patterns
```

The existing Pi Guardrails permission-gate is a useful reference implementation: it detects dangerous bash commands and supports interactive approval or denial. 

However, XTS should not load the complete Guardrails product.

The complete package currently includes:

```text
guardrails
path-access
permission-gate
```

plus configuration/settings behavior. 

XTS should adopt only the minimal command-permission concept.

### 14.2 Approval UX

Example:

```text
$ rm -rf build-cache/

This command recursively deletes files.

[Enter] approve once    [Esc] cancel
```

The default is no approval.

There is no requirement for v1 to implement:

```text
always allow
session allow
policy editor
custom rule UI
```

## 15. System prompt

The system prompt should remain intentionally small.

Conceptual content:

```text
You are XTS, a fast terminal assistant.

Help the user operate the current shell environment.

Prefer direct, concise answers.

Use bash when inspection or execution is necessary.

Inspect before mutating when state is unclear.

Do not modify files unless the user's request requires it.

Do not explain routine shell commands unless explanation is useful.
```

The final prompt should be measured for token size and performance.

## 16. TUI

XTS should use `@earendil-works/pi-tui`.

Pi TUI is independently packaged and designed for differential terminal rendering. 

It provides suitable primitives including:

```text
Input
Editor
Text
Markdown
Box
Container
keyboard handling
overlays
differential redraw
```

and supports custom terminal UI components. 

### 16.1 Visual target

The interface should remain compact.

Example:

```text
╭─ xts ─────────────────────────────────────────────╮
│ ~/src/core · main                     GPT-5.6    │
╰───────────────────────────────────────────────────╯

› why did that pull fail?

  You have local modifications that overlap with upstream.
  I'll inspect the current state.

  $ git status --short
  M src/runtime.ts

  The pull is blocked by an uncommitted modification to
  src/runtime.ts.

› _
```

### 16.2 Reuse from XTRM UI

The existing XTRM Pi UI has already established:

```text
compact command rows
bounded output previews
professional restrained presentation
minimal metadata
```

and does so without modifying tool execution or model-facing results. 

XTS may reuse or extract presentation helpers.

It should not load the entire `xtrm-ui` extension.

## 17. History

XTS should support conversation history.

Two different concepts must remain separate:

```text
shell history
conversation history
```

### 17.1 Shell history

Used as automatic bounded environmental context.

### 17.2 Conversation history

Used to continue XTS interactions.

Initial persistence may use:

```text
Pi session manager
or
small local JSONL session representation
```

Prefer reuse of Pi session primitives where possible.

Pi `AgentSession` already manages message history and supports session persistence through its session-management layer. 

### 17.3 UI

Initial navigation requirements:

```text
↑ / ↓
  prompt history where appropriate

interactive session
  retains prior XTS turns
```

Searchable global history can be deferred.

## 18. Performance requirements

Performance is a primary product requirement.

XTS should avoid all unnecessary startup work.

Forbidden startup work includes:

```text
repository indexing
GitNexus initialization
skill discovery
MCP discovery
Beads subprocesses
Specialists initialization
XTRM context loading
AGENTS scanning
package inventory scanning
LSP startup
Python kernel startup
generic extension loading
```

Target startup path:

```text
process startup
  ↓
read tiny XTS config
  ↓
load Pi ModelRuntime
  ↓
resolve selected model
  ↓
load bounded shell context
  ↓
render TUI
```

### 18.1 Performance metrics

Measure at minimum:

```text
cold process startup
warm process startup
time to first visible TUI
time from Enter to model request
system-prompt token count
tool-schema token count
peak resident memory
```

### 18.2 UX target

The interface should appear effectively immediately relative to network inference latency.

Model latency should dominate total perceived response time, not XTS initialization.

## 19. Proposed package layout

Recommended initial structure:

```text
packages/
└── xts/
    ├── package.json
    └── src/
        ├── main.ts
        ├── cli.ts
        ├── runtime.ts
        ├── prompt.ts
        ├── config.ts
        ├── model.ts
        ├── stdin.ts
        ├── history/
        │   ├── shell.ts
        │   └── conversation.ts
        ├── safety/
        │   ├── classify.ts
        │   └── approve.ts
        └── ui/
            ├── app.ts
            ├── conversation.ts
            ├── model-selector.ts
            └── approval.ts
```

This is illustrative rather than normative.

Avoid unnecessary abstraction in the initial implementation.

## 20. Runtime flow

### 20.1 Interactive

```text
xts
  load config
  resolve model
  load shell context
  start AgentSession
  render TUI
  read user prompt
  stream model response
  execute guarded bash calls
  persist conversation
```

### 20.2 One-shot

```text
xts "question"
  load model
  load shell context
  create session
  send question
  execute guarded bash if needed
  print result
  exit
```

### 20.3 Pipe

```text
command | xts "question"
  read bounded stdin
  load shell context
  load model
  create session
  send stdin + question
  print answer
  exit
```

### 20.4 Run

```text
xts run "command"
  classify
  if dangerous
    request approval
  execute
  provide result to model if interpretation needed
  display result
```

## 21. Error behavior

### Model unavailable

```text
selected model unavailable
→ open selector
```

Never silently substitute.

### Missing authentication

Show the model as unavailable.

Authentication remains Pi-owned.

XTS should tell the user to configure/authenticate through Pi rather than adding a second auth system.

### Shell integration unavailable

XTS should still work with:

```text
cwd
stdin
manual question
bash inspection
```

and clearly omit recent-shell context.

### stdin too large

Truncate according to explicit policy and tell the model and user.

### Dangerous command denied

Do not execute.

Return control to the conversation.

### Tool execution failure

Return exact shell evidence to the model.

Do not report success.

## 22. Security and privacy

XTS should minimize automatically collected information.

Automatic context should be restricted to:

```text
cwd
shell identity
recent command strings
last exit code
```

Do not automatically capture:

```text
full stdout
full stderr
environment variables
credentials
shell scrollback
clipboard
unrelated files
```

Sensitive command-history handling may require later filtering.

This remains an open security design item before release.

## 23. Implementation phases

### Phase 0 — runtime spike

Prove:

```text
standalone binary
Pi ModelRuntime
explicit model
minimal AgentSession
bash-only tool surface
Pi TUI
no normal Pi resource discovery
```

### Phase 1 — core interaction

Implement:

```text
xts
xts "question"
conversation streaming
local conversation persistence
```

### Phase 2 — shell context

Implement silent shell integration:

```text
cwd
last exit code
recent -N commands
```

Validate Bash and Zsh.

### Phase 3 — pipe mode

Implement:

```text
command | xts
command | xts "question"
```

with bounded stdin.

### Phase 4 — guarded execution

Implement:

```text
xts run "command"
```

and the dangerous-command approval overlay.

### Phase 5 — stabilization

Measure:

```text
startup
memory
model-context size
TUI behavior
shell compatibility
risk-classifier false positives
```

Remove unnecessary code and dependencies before v1.

## 24. Acceptance criteria

XTS v1 is complete when all of the following are verified.

1. `xts` starts a standalone minimal terminal assistant.

2. Normal Pi/XTRM skills are not loaded.

3. Generic Pi extension discovery is not used as the XTS feature model.

4. Beads, Specialists, MCP, GitNexus, XTRM project-context injection, and LSP are absent.

5. Only the intended model-facing operational tool surface is available.

6. First launch requires explicit model selection.

7. Model selection comes from Pi's available model inventory.

8. XTS persists the selected provider/model pair.

9. XTS never silently changes models.

10. `xts model` changes the persisted model.

11. Standard invocations automatically receive bounded recent shell commands.

12. The current working directory is available.

13. The previous shell command exit code is available when shell integration supports it.

14. Shell integration prints nothing after normal commands.

15. `xts "question"` works as a one-shot request.

16. `command | xts` analyzes stdin.

17. `command | xts "question"` combines stdin with an explicit instruction.

18. Large stdin is bounded and truncation is explicit.

19. `xts run "command"` executes commands through the XTS safety gate.

20. Safe commands do not require user approval.

21. Dangerous commands require explicit user approval.

22. Cancelled dangerous commands are not executed.

23. Interactive conversation history persists correctly.

24. TUI redraw remains stable in supported terminals.

25. Startup does not initialize unrelated XTRM/Pi systems.

26. Performance measurements are recorded and show initialization overhead substantially below typical model inference latency.

27. The model and system prompt remain intentionally small enough that XTS feels materially faster and simpler than a normal coding-agent session.

## 25. Open questions

The following questions should be resolved during implementation rather than expanded into additional product surface prematurely.

### History size

Initial proposal:

```text
10 commands
```

Determine whether 8, 10, or another small value performs better.

### Shell-history transport

Determine whether the most reliable mechanism is:

```text
small shell hook state file
environment transfer
shell-specific history APIs
combination
```

The implementation must remain silent and cheap.

### Conversation persistence

Evaluate whether native Pi session persistence already provides the desired lightweight UX without exposing unnecessary session-management concepts.

### Command classifier source

Determine whether to:

```text
extract/adapt patterns from pi-guardrails
implement a minimal XTS classifier
share a small reusable safety package
```

Avoid adopting the full Guardrails configuration product.

### Sensitive command filtering

Determine whether obvious secret-bearing command forms should be redacted from automatic recent history.

Examples may include commands containing:

```text
tokens
password arguments
inline API keys
```

This should be deterministic and conservative.

### Git metadata in header

Current XTRM presentation may expose branch metadata cheaply.

Determine whether the XTS header should show:

```text
cwd · branch · model
```

or only:

```text
cwd · model
```

Git inspection must not add measurable startup latency.

## 26. Future candidates

These are explicitly not v1 requirements.

Potential future additions may include:

```text
searchable XTS conversation history
better shell-specific context
small command-output capture helper
additional safe deterministic context helpers
optional model switch shortcut
fish support
PowerShell support
cross-platform packaging
```

Each addition should be driven by actual repeated usage.

Do not pre-build these features.

## 27. Final product invariant

The XTS architecture should preserve:

```text
small executable
+ explicit model
+ bounded shell context
+ bash
+ deterministic dangerous-command gate
+ minimal TUI
```

while excluding:

```text
coding-agent framework complexity
workflow orchestration
project intelligence
agent ecosystems
configuration surfaces
```

The intended user experience is:

```text
I encounter a terminal problem
        ↓
      xts
        ↓
the assistant already knows
what I was just doing
        ↓
it inspects only what it needs
        ↓
it answers or safely executes
        ↓
I return to the shell
```

XTS succeeds if using an AI assistant for a five-second terminal problem feels proportionate to the problem itself.
