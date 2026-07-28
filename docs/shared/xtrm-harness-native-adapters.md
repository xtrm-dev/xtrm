# XTRM Harness-Native Coordination Adapters

## Claude MCP and Pi Native Extension Evaluation, Verification and Decomposition

**Status:** proposal for independent verification and decomposition
**Date:** 24 July 2026
**Program relationship:** independent from the Specialists modernization roadmap and from the CLI program, but blocked on a stable CLI outcome contract for production adoption
**Primary repositories:** `xtrm-dev/core`, `Jaggerxtrm/xtmux`, `xtrm-dev/specialists`
**External candidates:** MCP Tasks extension, Claude Code background behavior, `pi-background-tasks`, `@ifi/pi-background-tasks`, `@aliou/pi-processes`, other verified Pi packages
**Companion specification:** `XTRM CLI Actionable Outcomes and Deterministic Follow-up Contract`

---

## 1. Purpose

XTRM currently exposes powerful `sp`, `xt` and `xtmux` command-line surfaces. Agents still need substantial prose to:

* choose the correct command;
* provide exact session/pane addressing;
* add `--json`;
* preserve stable identifiers;
* interpret success and failure;
* launch or verify monitors;
* avoid monitoring FYI messages;
* retrieve exact messages or completed results;
* background long-running work safely;
* wake when a watched operation completes.

Harness-native tools can replace much of that prose with typed schemas and deterministic adapters.

The objective is:

```text
authoritative XTRM CLI/runtime contract
→ thin Claude MCP adapter
→ thin Pi native extension adapter
→ harness-native background/wake only where evidence supports it
```

The adapters must not become a second message store, job lifecycle, monitor registry, process authority or chain scheduler.

---

## 2. Current verified starting point

### 2.1 Specialists MCP already exists

`xtrm-dev/specialists/src/server.ts` currently starts a stdio MCP server and exposes only `use_specialist`.

The source comment and implementation state that orchestration runs through the CLI/runner, while the MCP tool executes a Specialist synchronously and waits for the result.

Implications:

* do not build a second Specialists MCP server;
* extend or refactor the existing server only after auditing its current transport and release behavior;
* do not expose a long-running `run` tool merely by holding a synchronous MCP call open;
* short read/control tools are lower risk than asynchronous dispatch.

### 2.2 Core already installs a Pi package model

Core’s Pi package inventory includes the XTRM extension package and third-party packages. The verified settings template currently includes `@aliou/pi-processes`.

The canonical source of XTRM Pi extension code is:

```text
packages/pi-extensions/extensions/**
packages/pi-extensions/src/**
```

Distribution is through `npm:@jaggerxtrm/pi-extensions`.

### 2.3 Current MCP wiring differs by harness

At the verified snapshot:

* Pi’s MCP configuration includes a lazy `specialists` stdio server;
* Claude’s core MCP configuration does not include Specialists;
* Claude can load MCP tools through its standard configuration;
* exact background and wake semantics require installed-version proof.

### 2.4 MCP Tasks status on 24 July 2026

The MCP `2026-07-28` release candidate makes Tasks an official extension. A server may respond to `tools/call` with a task handle; clients then use `tasks/get`, `tasks/update` and `tasks/cancel`.

The final specification is scheduled for 28 July 2026. As of this document’s date:

* the release is still a release candidate;
* Tasks is capability-negotiated;
* server support alone is insufficient;
* Claude Code must advertise and correctly consume the Tasks extension;
* no design may assume Claude support without a live capability-negotiation fixture.

### 2.5 Pi background candidates

The evaluation must distinguish packages with different semantics.

#### `pi-background-tasks`

Published as a Claude-Code-like explicit background task manager. It advertises:

* LLM-callable `bg_run`, `bg_status`, `bg_logs`, `bg_kill`;
* durable output files;
* bounded log reads;
* process-group kill/timeout safety;
* completion notifications that can trigger a follow-up turn;
* explicit agent-task telemetry.

This is the strongest named candidate for Claude-like semantic parity.

#### `@ifi/pi-background-tasks`

Advertises:

* explicit `bg_task`;
* reactive wakeups on output or exit;
* persistent logs;
* task dashboard;
* pattern-gated reactions.

It is another serious candidate and may have a more reusable reactive watcher contract.

#### `@nandithebull/pi-background`

Primarily tracks agent working state, running Bash commands and `interactive_shell` sessions. It is not evidence of a complete spawned-task lifecycle and should not be treated as equivalent without source audit.

#### `@aliou/pi-processes`

Already installed in Core. It remains the incumbent and must be compared using actual behavior and source, not discarded because another package has a better name.

---

## 3. Core architectural decision

The production adapter must be thin.

```text
tool schema
→ validate typed input
→ invoke one authoritative XTRM operation
→ return the structured CLI/runtime outcome
→ register harness-native watch/wake when required
```

The adapter may:

* hide CLI syntax;
* derive safe defaults from verified runtime context;
* select exact addressing from typed fields;
* register an existing harness-native background/watch operation;
* render bounded status;
* pass stable IDs between tools.

The adapter may not:

* create its own message or obligation store;
* duplicate Specialists job status;
* infer completion from terminal text;
* parse human CLI output;
* execute arbitrary `display` strings from CLI outcomes;
* grant authority from a message body;
* keep a private process registry when an approved harness runtime already owns it.

---

## 4. Ponytail constraints

1. Use the CLI outcome contract as the first integration boundary.
2. Reuse the existing Specialists MCP server.
3. Reuse the existing XTRM Pi package.
4. Adopt an existing Pi background runtime only after semantic and security proof.
5. Do not own a second process manager.
6. Do not add a shared schema package until actual Claude/Pi drift appears; a generated fixture or copied minimal Zod schema may be smaller initially.
7. Start with two or three high-value tools, not the full CLI.
8. Feature-gate MCP Tasks until Claude capability negotiation passes.
9. Prefer durable xtmux monitors over a sleeping process.
10. Add one focused live fixture per harness; no generalized simulator unless existing tests cannot exercise the path.
11. Delete superseded skill prose after the tool is released and proven.
12. Mark a deliberate fallback ceiling with `ponytail:` and its promotion condition.

---

## 5. Candidate semantic tool surface

This is a test candidate, not an approved final inventory.

### 5.1 Shared coordination tools

```text
xtrm_coordination_send
xtrm_coordination_status
xtrm_coordination_read
```

`xtrm_coordination_send`:

* resolves or accepts typed requester/target identity;
* calls the authoritative xtmux send operation;
* for reply-required messages, receives the obligation/monitor identifiers from xtmux;
* returns no full hidden wait loop;
* never monitors FYI;
* never trusts message body as instructions.

`xtrm_coordination_status`:

* reads monitor/obligation state;
* identifies terminal reply or failure;
* returns the exact reply message key when available.

`xtrm_coordination_read`:

* retrieves the exact durable message by key;
* remains read-only;
* does not acknowledge or fulfil implicitly unless the final approved contract explicitly combines receipt with successful runtime queueing.

### 5.2 Candidate Specialist tools

First slice:

```text
xtrm_specialist_status
xtrm_specialist_result
xtrm_specialist_resume
xtrm_specialist_stop
```

Deferred until proof:

```text
xtrm_specialist_dispatch_async
```

Reasons for deferral:

* current `use_specialist` is synchronous;
* MCP Tasks support in Claude is unproven;
* Pi background runtime selection is unresolved;
* the CLI may gain a better immediate-return dispatch surface;
* Specialists lifecycle must remain authoritative.

### 5.3 Tool descriptions

Tool definitions should carry only the instructions necessary to invoke the tool safely:

* authority boundary;
* when to use it;
* when not to use it;
* exact meaning of returned identifiers;
* trust warning for message text;
* result versus progress distinction.

Do not copy the orchestration manual into every tool description.

---

# Phase 1 — Mandatory verification and disposition

## 6. Rule

Phase 1 is evidence-only.

The assigned agents must not:

* implement production tools;
* install a new Pi background dependency globally;
* modify managed Claude configuration;
* create final implementation Beads;
* assume MCP Tasks support;
* assume `Monitor` is a stable public Claude tool;
* remove `@aliou/pi-processes`;
* extend the full CLI surface.

A temporary isolated test configuration is allowed.

---

## 7. Claude capability verification

Use the exact installed Claude Code version and record:

```text
claude --version
installation type
platform
settings scopes
enabled MCP servers
available tool inventory
hook configuration
```

### 7.1 Official documentation audit

Review official Anthropic documentation for:

* MCP server/tool support;
* hook event inputs and outputs;
* background Bash behavior;
* background agent behavior;
* task output/status retrieval;
* tool permissions;
* whether MCP Tasks is documented or advertised;
* whether a public `Monitor` tool contract exists.

Separate:

```text
official public contract
installed but undocumented behavior
XTRM-injected behavior
inference
```

No undocumented capability becomes a production dependency without a fixture and an explicit risk label.

### 7.2 MCP Tasks capability fixture

After the final MCP 2026-07-28 spec and relevant SDKs are available, build the smallest temporary server that:

1. advertises the Tasks extension;
2. exposes one `sleep_then_return` tool;
3. returns `resultType: "task"` only when the client advertises support;
4. supports `tasks/get`, `tasks/update` and `tasks/cancel`;
5. logs the client capability metadata;
6. has no XTRM dependency.

Run Claude Code against it and record:

* whether Claude advertises the extension;
* whether it accepts a task result;
* whether it polls;
* whether completion wakes the model, only updates UI, or requires another turn;
* cancellation behavior;
* process/restart behavior;
* permissions and transcript representation.

If capability negotiation fails, MCP Tasks is deferred with no workaround inside the MCP server.

### 7.3 Background Bash fixture

Create a bounded isolated fixture using Claude’s documented background shell path, if present in the installed version.

Test:

```text
start a finite wait command
receive native task/shell handle
continue model interaction
observe completion
retrieve bounded output
cancel a long task
restart/close behavior
```

Then test the real XTRM candidate:

```text
xtmux wait-agent ... --consume --json
```

Determine:

* whether completion triggers a new model turn;
* whether it only produces UI notification;
* whether Stop hooks see the task;
* whether XTRM needs a hook reminder;
* whether a native background task duplicates xtmux’s durable monitor.

### 7.4 Monitor fixture

Enumerate tools and transcript events.

Prove whether `Monitor` is:

* an official Claude Code tool;
* an internal but directly callable tool;
* an XTRM-generated instruction shape;
* unavailable.

Record exact tool input/output and lifecycle only if it exists.

Do not design around the name `Monitor` without this proof.

### 7.5 Hook fixture

For one temporary MCP tool, capture:

* `PreToolUse`;
* `PostToolUse`;
* `PostToolUseFailure`;
* `Stop`;
* session lifecycle hooks.

Verify:

* MCP tool naming in matchers;
* availability of tool input/result;
* whether hooks can safely queue a reminder;
* whether duplicate Stop cycles occur;
* whether a hook-spawned background process is tracked by Claude.

---

## 8. Existing XTRM MCP audit

### 8.1 Specialists

Inspect:

```text
src/server.ts
src/tools/specialist/use_specialist.tool.ts
src/specialist/runner.ts
CLI run/feed/result/resume/stop paths
package entrypoints and MCP configuration
MCP forensic events
```

Answer:

1. Is `use_specialist` actually synchronous in every path?
2. Can existing job-control/read methods be exposed without invoking `runner.run()`?
3. Which schemas already exist and can be reused?
4. Does the server remain alive correctly across long calls?
5. What stdout/stderr behavior risks stdio framing?
6. How is the server packaged and installed for Claude versus Pi?
7. Can a thin xtmux tool live in this server without violating ownership, or should xtmux own its own server?

### 8.2 xtmux

Determine the smallest adapter boundary:

* direct library import;
* compiled CLI subprocess with JSON;
* stdio bridge;
* new MCP entrypoint.

Ponytail preference:

```text
CLI subprocess with stable JSON
```

until measured latency or packaging proves it insufficient.

Do not import private SQLite modules across package boundaries.

### 8.3 Core

Inspect:

```text
.xtrm/config/claude.mcp.json
.xtrm/config/pi.mcp.json
cli MCP sync/install code
packages/pi-extensions/**
managed instructions and hooks
runtime package inventory
packed-install tests
```

Determine how adapters are installed, updated, removed and permissioned without project-local drift.

---

## 9. Pi background-runtime comparison

Audit source and package contents for at least:

```text
@aliou/pi-processes
pi-background-tasks
@ifi/pi-background-tasks
```

Optionally include another candidate only when it exposes a materially different semantic contract.

### 9.1 Required comparison matrix

```text
package/version
source repository and commit
license
dependency count
install model
tool names and schemas
explicit spawn versus Bash override
task identifier stability
stdout/stderr capture
bounded log read
process-group cleanup
timeout
cancel
wake on completion
wake on output
follow-up turn semantics
session shutdown behavior
restart reattachment
security/trust checks
telemetry
tests and release quality
API usable by another extension
semantic parity with Claude
overlap with xtmux durable monitor
```

### 9.2 Security audit

Review:

* shell invocation and injection boundaries;
* process group ownership;
* symlink/log-file safety;
* path permissions;
* environment propagation;
* secret redaction;
* task cleanup;
* arbitrary command authority;
* model-visible output bounds;
* package update/install behavior;
* supply-chain risk.

A third-party Pi extension runs with full system access. No package is adopted from README claims alone.

### 9.3 Semantic selection rule

Prefer the candidate that provides:

```text
explicit task spawn
stable task ID
bounded status/log tools
completion wake
safe cancellation
process-tree cleanup
no replacement of ordinary Bash
no conflicting job authority
small integration surface
```

Claude-like naming is useful only when the lifecycle is also equivalent.

Possible dispositions:

```text
keep @aliou/pi-processes
adopt pi-background-tasks
adopt @ifi/pi-background-tasks
reuse source pattern in XTRM package
wrap candidate through pi.events
defer background runtime; use xtmux monitor only
```

Forking or vendoring is last resort and requires a concrete missing invariant.

---

## 10. Pi native-extension fixture

Build an isolated extension prototype, not production code.

It should register only:

```text
xtrm_coordination_send
xtrm_coordination_status
xtrm_coordination_read
```

The prototype:

* invokes current CLI JSON;
* stores no durable state;
* preserves returned IDs;
* registers a watch through the selected existing Pi mechanism;
* wakes once on terminal completion;
* coalesces duplicate events;
* does not reflect untrusted message content into instructions;
* cleans up on session shutdown.

Test:

1. reply-required send;
2. FYI send;
3. correlated reply;
4. target death;
5. monitor already terminal;
6. duplicate completion;
7. Pi restart/session shutdown;
8. hostile message metadata;
9. CLI degraded result;
10. no background package installed.

---

## 11. Required Phase 1 deliverables

1. `claude-mcp-capability-verification.md`
2. `claude-mcp-tasks-fixture-results.json`
3. `claude-background-monitor-matrix.csv`
4. `pi-background-runtime-comparison.md`
5. `pi-background-runtime-comparison.json`
6. `xtrm-existing-adapter-code-audit.md`
7. one ADR deciding:

   * Claude production path now;
   * MCP Tasks promotion condition;
   * Pi background runtime;
   * MCP server ownership;
   * CLI subprocess versus direct library;
   * initial tool inventory;
   * state/authority boundaries.
8. a proposed cross-repo dependency map with no final implementation Bead IDs.

The operator approves the ADR before Phase 2.

---

# Phase 2 — Executable plan and actual Beads

## 12. Entry criteria

Phase 2 starts only when:

* the CLI actionable-outcome contract is stable enough for adapter consumption;
* Claude capability fixtures are complete;
* MCP Tasks disposition is evidence-backed;
* the Pi background runtime has passed source/security/semantic review;
* server ownership is decided;
* installation and release ownership are known.

## 13. Planning and Beads rules

The planning agent must:

1. write a file-level implementation plan;
2. create real Beads in every owning repository;
3. return the actual Bead IDs;
4. create dependency edges after verifying the installed Beads CLI;
5. link every root to the Phase 1 ADR and evidence;
6. keep cross-repository work as companion epics, not a fake shared parent tree;
7. block production adapters on the CLI contract;
8. keep MCP Tasks work feature-gated and separately promotable;
9. create no Jira tickets unless separately authorized.

## 14. Candidate decomposition to validate

### Core epic — harness installation and Pi adapter

Candidate children:

```text
ADP-C1 publish minimal native Pi coordination tools in @jaggerxtrm/pi-extensions
ADP-C2 integrate selected background runtime or pi.events bridge
ADP-C3 install/update/doctor ownership and package migration
ADP-C4 managed-instruction slimming after tool adoption
ADP-C5 packed Pi install and interactive completion-wake fixture
```

### xtmux epic — adapter-facing coordination contract

Candidate children:

```text
ADP-X1 expose stable adapter-safe send/status/read JSON contracts
ADP-X2 provide an MCP entrypoint only if ownership ADR selects xtmux
ADP-X3 add watch/wake idempotency and hostile-input fixtures
ADP-X4 document tool authority and no-private-DB boundary
```

### Specialists epic — existing MCP extension

Candidate children:

```text
ADP-S1 expose bounded status/result/resume/stop tools in existing MCP server
ADP-S2 separate synchronous use_specialist from future async dispatch
ADP-S3 add MCP Tasks support behind negotiated capability, only after Claude proof
ADP-S4 package/configure Claude MCP installation and forensic correlation
ADP-S5 add stdio framing, cancellation and release fixtures
```

The evidence may move the Claude coordination tools to Specialists, xtmux or a tiny Core-owned gateway. Choose the fewest-server option that preserves ownership.

## 15. Recommended initial production slice

Unless Phase 1 disproves it:

### Claude

```text
MCP:
  xtrm_coordination_send
  xtrm_coordination_status
  xtrm_coordination_read
  xtrm_specialist_result

Background:
  existing xtmux durable monitor
  + verified Claude hook/native task behavior
  + no long-running MCP call
```

### Pi

```text
native tools:
  xtrm_coordination_send
  xtrm_coordination_status
  xtrm_coordination_read
  xtrm_specialist_result

Background:
  selected audited Pi task runtime only when an active process is truly required
  xtmux monitor/poller for coordination waits
```

Do not use a background process merely to duplicate an existing durable monitor.

## 16. MCP Tasks rollout

```text
off
→ fixture-only
→ Claude capability detected
→ one read-only/finite experimental tool
→ cancellation/restart verified
→ asynchronous Specialist dispatch candidate
→ production promotion
```

The server must fall back to an immediate non-task result or reject clearly when the client does not advertise the extension.

Never infer support from protocol version alone.

## 17. Schema parity

Initial Ponytail approach:

* keep each adapter schema small;
* test both against the same CLI fixtures;
* compare normalized input/output snapshots;
* do not introduce a new shared package solely for four tools.

Promote a shared schema source only when:

* both adapters have drifted once; or
* the same non-trivial validation is duplicated; or
* a third consumer appears.

## 18. Acceptance criteria

The adapter program is complete when:

* Claude and Pi expose the approved minimal semantic tools;
* both consume authoritative CLI/runtime outcomes without prose parsing;
* reply-required sends return stable message/obligation/monitor IDs;
* FYI sends create no watch;
* one terminal completion produces at most one model follow-up;
* exact reply content is retrieved by key;
* no adapter owns duplicate durable state;
* no long-running MCP call is required for ordinary coordination;
* Claude MCP Tasks is used only after live capability proof;
* the selected Pi background runtime passes source/security/parity review;
* background task failure, cancellation and cleanup are observable;
* hostile metadata is never promoted into executable instructions;
* adapters degrade safely when the background runtime is unavailable;
* installation/update/doctor flows converge;
* tool definitions allow removal of superseded skill prose;
* released artifacts and live fixtures identify the final behavior.

---

## 19. Explicit non-goals

* no new message bus;
* no new Specialists job store;
* no adapter-owned monitor database;
* no generic background process manager written by XTRM without evidence;
* no full CLI-to-tool mirroring;
* no automatic execution of CLI `display` strings;
* no MCP Tasks dependency before Claude support is proven;
* no replacement of xtmux durable waits with log polling;
* no worktree or chain authority in MCP/Pi adapters;
* no coupling to the main modernization roadmap;
* no global installation of an unaudited third-party Pi package.

---

## 20. Evidence register

### Repository evidence

* `xtrm-dev/specialists/src/server.ts`
* `xtrm-dev/specialists/src/tools/specialist/use_specialist.tool.ts`
* `xtrm-dev/core/.xtrm/config/pi/settings.json.template`
* `xtrm-dev/core/.xtrm/config/pi.mcp.json`
* `xtrm-dev/core/.xtrm/config/claude.mcp.json`
* `xtrm-dev/core/packages/pi-extensions/**`
* `Jaggerxtrm/xtmux` current coordination, hooks and Pi extensions
* current local audit and Epic Plan

### Official external references, verified 24 July 2026

* MCP 2026-07-28 release candidate:
  https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
* MCP Tasks extension draft:
  https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks
* SEP-2663 Tasks Extension:
  https://modelcontextprotocol.io/seps/2663-tasks-extension
* Claude Code CLI and MCP documentation:
  https://docs.anthropic.com/en/docs/claude-code/cli-usage
  https://docs.anthropic.com/en/docs/claude-code/mcp
* Pi extension/SDK documentation:
  https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md
  https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md

### Pi candidates, to be audited from source

* `pi-background-tasks`
* `@ifi/pi-background-tasks`
* `@aliou/pi-processes`
* `@nandithebull/pi-background`, comparison-only unless source proves full lifecycle
