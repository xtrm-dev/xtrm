# XTRM Agent Runtime — Adoption & Credits Ledger

This file records external projects whose mature behavior, interaction models, protocols or design guidance are intentionally adopted into the XTRM agent runtime. It is both attribution and maintenance provenance.

The rule is simple: if XTRM adopts a meaningful behavior from an upstream project, the relevant implementation PR and design update must preserve credit here and identify the XTRM-owned replacement/adapter.

## Runtime / extension sources

### `nicobailon/pi-intercom`

Repository: https://github.com/nicobailon/pi-intercom

XTRM target: `xtrm-intercom`.

Adopt substantially all mature and working communication behavior, including:

- local Pi-session discovery / presence;
- aliases and scoped routing;
- direct `send`;
- request/reply `ask` semantics;
- reply inference and pending asks;
- message identity and deduplication;
- mailbox / queued delivery behavior;
- delivery receipts and delivery-state visibility;
- cancellation and superseding;
- attachments;
- safe message injection into active sessions;
- the tested operator ergonomics around direct Pi-to-Pi collaboration.

XTRM divergence:

- transport does not become workflow authority;
- governed Chain communication still uses Channels semantics;
- same-process native Specialist children may use direct/native transport rather than forcing a broker hop;
- durable work scope remains Substrate authority.

Credit requirement: implementation documentation and release notes for `xtrm-intercom` must explicitly credit `pi-intercom` as a principal design/behavior source.

### `alonw0/pi-claude-link`

Repository: https://github.com/alonw0/pi-claude-link

XTRM target: Claude transport within `xtrm-intercom`.

Adopt mature working behavior, including:

- compatibility with Claude Code cross-session agent discovery;
- registry/socket integration;
- Pi visibility in Claude peer rosters where supported;
- two-way message delivery;
- live inbound injection;
- reply relay;
- connection lifecycle / cleanup behavior;
- the trust rule that peer-agent input is coordination input, not user authority.

XTRM divergence:

- expose the behavior behind one provider-neutral `xtrm-intercom` service instead of a separate user-facing capability;
- preserve provider-specific protocol details only inside the transport adapter.

Credit requirement: `xtrm-intercom` Claude transport documentation must explicitly credit `pi-claude-link`.

### `ismailsaleekh/pi-background-tasks`

Repository: https://github.com/ismailsaleekh/pi-background-tasks

XTRM target: `xtrm-background`.

Adopt only the mature background-process subset:

- start long-running local shell work without blocking the conversation;
- durable-enough local job identity;
- status inspection;
- bounded log/tail views;
- full output artifact/path;
- stop/kill;
- rerun where safe;
- completion events / notification;
- optional host wake/follow-up behavior.

Explicitly do **not** adopt into `xtrm-background`:

- Fusion/orchestration semantics;
- delegated-agent workflows;
- Anthropic provider override / provider-policy behavior;
- a second workflow authority.

Credit requirement: `xtrm-background` docs must state that its background process UX/behavior was informed by `pi-background-tasks`, while clearly documenting the intentionally smaller scope.

### `tintinweb/pi-tasks`

Repository: https://github.com/tintinweb/pi-tasks

XTRM target: Substrate-backed Issue Task Plan + XTRM TUI task strip / task manager.

Adopt the mature task-management interaction model where it fits XTRM:

- familiar TaskCreate / TaskList / TaskGet / TaskUpdate model-facing grammar;
- persistent task status above the prompt/editor;
- pending / in-progress / completed state;
- dependency relationships (`blocks` / `blockedBy`);
- useful active-form labels;
- active-first sorting;
- compact progress counts;
- collapsing completed tasks;
- elapsed/activity presentation metadata;
- bounded reminders that keep an execution plan current.

XTRM divergence:

- no independent `.pi/tasks` authority for claimed XTRM work;
- canonical plan state belongs to Substrate and is bound to an Issue revision;
- tasks cannot expand the Issue contract;
- work that needs independent durable scope is promoted to a real child Issue;
- task execution is not a replacement for Specialists / Chains;
- background-process state remains separate under `xtrm-background`.

Credit requirement: Task Plan / TUI task management documentation must explicitly credit `pi-tasks` as the primary interaction-model reference.

### `earendil-works/pi`

Repository: https://github.com/earendil-works/pi

XTRM target: execution engine under the XTRM-owned agent profile and UI shell.

Reuse / remain compatible with:

- AgentSession/runtime semantics;
- system-prompt composition seams;
- active tool and extension guidance;
- project context and skills loading;
- session tree / branching;
- retry / compaction lifecycle;
- provider and model support;
- `agent_settled` completion semantics;
- `pi-tui` foundations where retained.

XTRM divergence:

- `xt pi` / future `xt agent` are XTRM-managed profiles, not semantically identical to raw upstream `pi`;
- the XTRM identity/authority kernel must not be accidentally erased by a project prompt in managed mode;
- XTRM owns the first-party TUI/product behavior and may selectively port upstream interactive fixes instead of delegating product UX ownership upstream.

## Interaction / terminal design references

### `tmux/tmux`

Repository: https://github.com/tmux/tmux

Adopted concepts:

- choose-tree-like compact hierarchy browsing;
- keyboard-first navigation;
- predictable Enter / Esc / q behavior;
- strong selected-row treatment in the black-on-yellow / reverse-video family;
- minimal chrome and dense terminal information architecture.

This is interaction inspiration, not code provenance unless implementation later imports/copies specific code.

### `github/TUIKit`

Repository: https://github.com/github/TUIKit

Adopted design guidance:

- semantic theme tokens rather than scattered ANSI values;
- stable/responsive terminal regions;
- width-aware presentation;
- visible contextual hint bars;
- accessible fallback behavior;
- separating state semantics from styling.

### Command Line Interface Guidelines

Site: https://clig.dev/

Adopted guidance:

- human-first composability;
- concise but actionable feedback;
- stdout/stderr discipline;
- deliberate color use;
- safe prompt behavior;
- errors that state what failed, why, and what to do next.

### CLI Spec

Site: https://clispec.dev/

Adopted guidance:

- explicit support for humans, scripts and AI clients;
- structured machine output;
- non-interactive operation;
- retry-safe semantics;
- bounded output and deterministic automation behavior.

## Internal XTRM references that this design must remain consistent with

- `docs/substrate/sb-cli-ux-design.md` — PR #188 terminal-native `sb` UX contract.
- `docs/substrate/substrate-issues-v0-prd.md` — durable work authority, Issue revision, claims, Journal, execution and provenance.
- `packages/xtrm-tui/docs/xtrm-tui-prd.md` — XTRM TUI product contract.
- `xtrm-dev/specialists` — Specialist activation rules and APPEND-SYSTEM-style governed context.
- `xtrm-dev/core/packages/pi-extensions` — first-party Pi extension/capability ownership.

## Upstream maintenance policy

For every adopted upstream project maintain:

```text
upstream repository
last reviewed commit/tag
XTRM owner path
adopted behaviors
intentionally rejected behaviors
compatibility/protocol assumptions
open divergence
last upstream-watch result
```

The existing XTRM upstream release-watch mechanism should be extended/reconciled rather than creating a second tracker. Generic bugs discovered while reproducing upstream behavior should be contributed back upstream when appropriate.

## License/provenance rule

Behavioral inspiration and reimplementation must not be confused with copied source code. Before copying implementation code, tests, fixtures, protocol text, or substantial documentation from an upstream repository, verify the upstream license and preserve all required notices. The implementation PR must state whether it is:

- clean-room / behavior-compatible reimplementation;
- adapted code;
- copied code with modifications;
- protocol interoperability only.

This ledger is attribution provenance, not a substitute for required license notices.