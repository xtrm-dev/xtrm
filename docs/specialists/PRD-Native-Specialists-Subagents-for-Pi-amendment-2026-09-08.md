# Amendment — Native Specialist UI, inspection surface, and operator vocabulary

**Status:** Normative amendment to `PRD—Native-Specialist-Subagents-for-Pi.md`  
**Date:** 2026-09-08  
**Scope:** Pi-extension presentation and operator interaction only  
**Does not change:** `NativeActivationHost`, Specialist activation semantics, participant protocol, workspace lease, observability, model override, Claude transport, or future Chain integration

This amendment supersedes any conflicting wording in the current native-Specialists PRD concerning `/fleet`, Fleet placement, arrow-key navigation in the stock Pi extension, and immediate full child-chat attachment.

## 1. Operator vocabulary: `/specialists`, not `/fleet`

The public operator concept is **Specialists**.

`Fleet` remains an internal/presentation term for the collection of currently hosted Specialist activations, but users and coordinators should not need to learn a separate `/fleet` command vocabulary.

The current commands:

```text
/fleet
/fleet:reply
/fleet:stop
```

should migrate to a `/specialists` surface.

The preferred public shape is conceptually:

```text
/specialists
/specialists inspect <activation>
/specialists reply <message-id> <answer>
/specialists resume <activation> <instruction>
/specialists stop <activation> [reason]
```

Whether the Pi extension implements these as one command with subcommands or several registered slash commands is an implementation detail. The visible vocabulary remains `/specialists`.

Model-facing tools remain explicitly named Specialist operations, for example:

```text
specialist_list
specialist_dispatch
specialist_status
specialist_reply
specialist_resume
specialist_stop_activation
```

No runtime semantic change is implied by the command rename.

## 2. Fleet placement: below the XTRM statusline

The intended terminal hierarchy is:

```text
conversation / transcript

› coordinator editor

<XTRM statusline>
<Specialist Fleet>
```

The Specialist Fleet must **not** render above the editor.

A naive Pi `belowEditor` widget is also insufficient if it renders before the existing XTRM footer/statusline. The existing XTRM custom footer remains the single owner of `ctx.ui.setFooter()`.

The preferred implementation is therefore a small generic footer-composition seam owned by the existing XTRM custom-footer extension:

```text
XTRM footer
├─ statusline
└─ registered footer section: specialist-fleet
```

The Specialists extension owns the Fleet content and lifecycle; Core owns only the reusable footer-section registration seam.

Do not introduce two extensions competing for `setFooter()` ownership.

## 3. Collapsed Fleet information hierarchy

The permanently visible Fleet should behave like an operational status surface, not a debug dump.

The current style:

```text
Specialists — 2 activation(s), 0 pending ask(s)
  running   researcher ISSUE-58 [read] act:...
  running   executor   ISSUE-92 [write] act:...
```

is too implementation-oriented for persistent display.

The collapsed presentation should follow the information-density pattern proven by `pi-subagents`: active participant count, attention state, aggregate usage where available, and an inspection hint.

Examples:

```text
2 active specialists · 18k window · 7.2k spent · /specialists to inspect
```

or, when coordinator attention is required:

```text
2 active specialists · 1 needs reply · 18k window · 7.2k spent · /specialists to inspect
```

Attention-worthy states such as `needs_reply`, `escalated`, `failed`, or `uncertain` outrank routine running state in the collapsed summary.

The collapsed line should not carry:

```text
activation_id
participant_id
attempt_id
pi_session_id
full forensic identifiers
```

Those remain available through inspect/status/observability surfaces.

## 4. Expanded `/specialists` view

The expanded operator view should prioritize the same information `pi-subagents` makes useful while preserving XTRM-specific identity.

Per Specialist, show where available:

```text
Specialist role/name
model + thinking level
work item / Bead / future Substrate issue
meaningful state
elapsed time
context-window / token usage
current meaningful activity
READ / WRITE authority when operationally relevant
attention marker
```

Preferred one-row shape when terminal width permits:

```text
● researcher (gpt-5.6-sol high) · ISSUE-92  · researching transport   47s · 7.8k window · 2.1k spent
● executor   (opus-4.6 high)     · ISSUE-115 · implementing fence   2m14s · 12k window · 5.6k spent
! reviewer   (gpt-5.6-sol high)  · ISSUE-92  · needs reply            31s
```

Use bounded rows and explicit overflow instead of allowing the Fleet to consume the terminal.

Activation IDs and full result/forensic detail belong in the inspector, not the persistent Fleet.

## 5. Interim inspection before `xtrm-tui`

The stock Pi extension is not required to provide full keyboard-native coordinator↔child session switching.

Instead, the initial Pi extension may use a command-driven **Specialist inspector/feed overlay**.

XTRM already has a useful reference implementation in Core:

`packages/pi-extensions/extensions/sp-terminal-overlay`

Its legacy `/sp-feed` command opens `sp feed -f` in a centered, fixed-height, scrollable overlay with throttled redraw and safe terminal color handling.

The native Specialist inspector should reuse/adapt this overlay UX, but it must consume the **native retained Specialist activation / AgentSession transcript and events**, not shell out to legacy `sp feed` for native activations.

Conceptual surface:

```text
/specialists inspect <activation>
```

Example overlay:

```text
┌ researcher · ISSUE-92 ─────────────────────────────────────┐
│ gpt-5.6-sol high · running · 1m32s                         │
│                                                            │
│ USER                                                       │
│ ...                                                        │
│                                                            │
│ ASSISTANT                                                  │
│ ...                                                        │
│                                                            │
│ TOOL                                                       │
│ ...                                                        │
│                                                            │
├────────────────────────────────────────────────────────────┤
│ Esc close · reply/resume/stop available through commands   │
└────────────────────────────────────────────────────────────┘
```

The first implementation may be read-only transcript inspection. Reply, resume, and stop may remain command-driven.

This is sufficient for the stock Pi extension stopping point.

## 6. Full attach/navigation belongs to `xtrm-tui`

Any earlier PRD wording that requires the stock Pi extension to support:

```text
arrow-key participant navigation
Enter to replace/focus the coordinator editor with the child chat
Esc to navigate parent/child session hierarchy
nested Specialist session traversal
```

is deferred to `xtrm-tui`.

The native runtime must preserve everything `xtrm-tui` will need:

```text
stable activation identity
retained AgentSession
transcript/history access
persistent participant state
resume/steer/follow-up capability
parent/child lineage
attention state
result state
```

but the stock Pi extension does not need to emulate a full session browser before the dedicated TUI exists.

Prime Agent's agent/session attach model is a useful UX reference for the future `xtrm-tui`: a participant registry, explicit attach, live transcript/input, detach, and return. `pi-subagents` is the preferred immediate reference for compact Fleet presentation and inspector behavior.

## 7. Revised implementation split

### Native Specialists Pi extension — now

```text
compact Fleet below XTRM statusline
/specialists operator vocabulary
bounded expanded Specialist listing
command-driven inspect/reply/resume/stop
native transcript/feed overlay
attention/wake notifications
persistent retained AgentSessions
```

### `xtrm-tui` — later

```text
keyboard-native Fleet navigation
selected participant focus
true coordinator↔child chat attachment
nested participant navigation
session-tree UX
```

## 8. Acceptance amendments

The Pi-extension UI is considered compliant when:

1. the Fleet no longer renders `aboveEditor`;
2. the XTRM statusline renders before the Specialist Fleet;
3. `/fleet` is replaced by `/specialists` as the public operator vocabulary;
4. the collapsed Fleet does not expose activation IDs by default;
5. the collapsed Fleet surfaces active count and coordinator-attention state;
6. expanded Specialist rows surface role, work item, state, elapsed time, model/thinking and usage where available;
7. the Fleet is bounded and has overflow behavior;
8. `/specialists inspect <activation>` or an equivalent command opens a native activation/session feed or transcript overlay;
9. the native inspector does not depend on a legacy `sp feed` subprocess for native AgentSessions;
10. reply/resume/stop remain possible while the inspector is closed;
11. no PRD acceptance test requires arrow-key child-session navigation in the stock Pi extension;
12. the runtime remains attach-capable for future `xtrm-tui` without architectural changes.

## 9. No change to activation semantics

This amendment is intentionally presentation-only.

The following existing invariants remain unchanged:

```text
SpecialistLoader is authoritative.
Tracked work is durable and gated.
Specialist AgentSessions are persistent.
InteractionMessage and ActivationResult are distinct.
Many readers may coexist.
Exactly one writer may mutate a workspace.
The coordinator obeys the writer lease.
observability.db remains authoritative forensics.
Claude and Pi frontends share the same NativeActivationHost.
Future Chains reuse the same activation runtime.
```
