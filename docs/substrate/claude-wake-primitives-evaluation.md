# Native Claude wake/event primitives: evaluation and decisions

> Bead xtrm-iip.6 (closeout E6). Non-blocking for E1–E5. Verified against live
> Claude Code docs on 2026-09-09. Constraints referenced here are stated in
> `claude-transport-constraints.md` (E7) and not repeated.

Question this bead answers: XTRM currently wakes Claude with custom machinery —
xtmux message injection, Claude-specific inbox polling, "agent forgot to wake"
recovery. Claude now ships native primitives. Which of the custom machinery can
retire?

## Summary of decisions

| Primitive | Decision | Replaces |
| --- | --- | --- |
| `asyncRewake` hook | **Adopt** | "agent forgot to wake" recovery, condition-wait polling |
| Plugin monitors | **Adopt (narrow)** | Claude-specific inbox polling against a local stream |
| Claude Channel transport | **Defer to adapter, do not adopt as load-bearing** | nothing yet; candidate for xtmux injection |
| `SendMessage` | **Adopt as transport only** | Claude↔Claude tmux hops |
| Agent SDK streaming input | **Record fit, defer** | nothing in this cutover |
| Remote Control | **Reject for coordination** | nothing — human surface |

Nothing adopted here is load-bearing for Substrate correctness.

---

## 1. `asyncRewake` — adopt

**What it is.** A command hook field. `async: true` runs in the background and
delivers output on the next conversation turn; if the session is idle that
output **waits for the next user interaction**. `asyncRewake: true` runs in the
background and **wakes Claude on exit code 2**, even when idle. The hook's
stderr — or stdout when stderr is empty — is shown to Claude as a system
reminder. `timeout` is still enforced for `asyncRewake` (it is not for plain
`async`).

Source: [Hooks reference](https://docs.claude.com/en/docs/claude-code/hooks).

**Why adopt.** This is the only documented primitive that wakes an *idle*
session from a local background condition without a preview dependency, without
a launch flag, and without a network round trip. It is the exact semantic of
XTRM's "agent forgot to wake" recovery, minus the custom machinery.

**Shape (staged as `scripts/wake-on-event.mjs` + a hook entry).**

```text
durable Substrate event exists
      ↓
bounded watcher blocks (timeout-bounded, no durable state of its own)
      ↓
watcher observes the event
      ↓
exit 2, stderr carries ONLY a reference
      ↓
Claude wakes
      ↓
Claude reads truth via resume_capsule / provenance_trace
```

**Payload rule.** stderr carries issue ref, event ID, and reason. Never the
event body, never an instruction, never anything that reads as authority.

**Live proof status: NOT YET RUN.** The proof requires a session whose settings
carry the hook. The Claude lane's session is boundary-constrained and does not
edit its own settings, so this proof is staged for the operator or the
xtrm-rooted session. Procedure, to be pasted into the bead as the proof log:

```text
1. Enable the plugin's asyncRewake hook (or a settings-level equivalent).
2. Start a session; leave it idle at the prompt.
3. From another terminal, write a durable Substrate event for a test issue.
4. Watcher observes it and exits 2.
5. Record: session woke while idle; system reminder text; that the text
   contains only a reference; that Claude then called a Substrate tool.
```

**Caveat to record.** Under `claude -p`, background async hooks are killed at
teardown and finalized as `cancelled`. Never use an in-process async hook as a
durability mechanism for work that must outlive the Claude process.

---

## 2. Plugin monitors — adopt, narrowly

**What it is.** `monitors/monitors.json` (or `experimental.monitors` in the
manifest) declares commands Claude Code starts automatically when the plugin is
active. Each stdout line becomes a session event. `when` is `"always"` or
`"on-skill-invoke:<skill-name>"`. Monitors run unsandboxed at hook trust level,
interactive CLI sessions only, and share the Monitor tool's availability limits
— unavailable on Bedrock, Google Cloud's Agent Platform, Microsoft Foundry, and
when `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set.

Source: [Plugins reference](https://docs.claude.com/en/docs/claude-code/plugins-reference),
[Tools reference](https://docs.claude.com/en/docs/claude-code/tools-reference).

**Why adopt narrowly.** Where a local durable stream already exists, a monitor
beats a polling loop. But monitor output is *notification input*, never durable
state, and the platform exclusions mean it cannot be the only path to a signal.

**Adopted use:** one `when: "on-skill-invoke:using-substrate"` monitor over a
local Substrate event feed, so a session that has engaged Substrate sees new
events without polling. Not `always` — an always-on monitor in every session is
noise for sessions doing unrelated work.

**Rejected use:** monitors as the inbox. The inbox is durable XTRM state; a
monitor is a nudge to go read it.

---

## 3. Claude Channel transport — defer as an adapter

**Decision: build no XTRM dependency on it in this cutover.** Evaluate it as
one transport behind the XTRM Channel abstraction, never as the abstraction.

Three constraints make it unsuitable as load-bearing today, all detailed in the
E7 constraints doc: research-preview status with three unsupported cloud
platforms; a **launch gate** (`--channels` / `--dangerously-load-development-channels`)
that no already-running session can satisfy; and **no delivery acknowledgement**
— a dropped event produces no error at the sender.

**Against xtmux injection specifically.** The honest comparison: xtmux injection
works on a running session and needs no flag; the Claude Channel needs the
session to have been launched correctly. For an XTRM fleet where sessions are
launched by XTRM itself, the launch gate is satisfiable and the channel is the
better mechanism — it delivers structured content into context rather than
typing into a terminal. For sessions an operator started by hand, it is not
satisfiable at all. That split is why this is an adapter and not a replacement.

**If adopted later**, the adapter owes: underscore-cased `meta` keys
(`[A-Za-z0-9_]` or silently dropped), sender identity and authorization checks
before any effect, and XTRM-side delivery state that does not confuse
sent-to-transport with consumed.

---

## 4. `SendMessage` — adopt as transport only

Native cross-session messaging delivers into another live local Claude session;
messages enqueue and drain at the receiver's next tool round, and
`notify_when_idle: true` gives a one-shot idle notice instead of polling.

**Adopt** for Claude↔Claude hops in place of tmux where both ends are Claude.
**Do not** let a native message become a work contract:

```text
native SendMessage        = transport
XTRM Channel/message row  = durable coordination state
Substrate Issue           = work authority
```

**Field note from this lane (2026-09-09):** `SendMessage` to a **Pi** peer
returned `success: true` twice while the message never arrived — the coordinator
was still reporting the read-confirm as pending hours later. Delivery was
achieved by writing to the peer's tmux pane instead. Conclusion for XTRM: native
`SendMessage` success is Claude↔Claude evidence only, and is *not* an
acknowledgement across provider boundaries. Any XTRM use must carry its own
receipt, exactly as the channel transport must.

---

## 5. Agent SDK streaming input — record fit, defer

The SDK's streaming-input mode takes an `AsyncGenerator<SDKUserMessage>` as the
prompt, so an external event loop can yield new user messages into a live agent
loop. This is the clean provider-native shape for a future hosted XTRM
participant:

```text
XTRM runtime → event queue → AsyncGenerator<SDKUserMessage> → live agent loop
```

**Deferred**, per the brief: not forced into this cutover while the Claude Code
plugin integration is sufficient. Recorded so the next hosting decision starts
from here.

Source: [Streaming input](https://docs.claude.com/en/api/agent-sdk/streaming-vs-single-mode).

---

## 6. Remote Control — rejected for coordination

Human transport. Useful operator functionality, not an inter-agent transport.
No automated coordination is designed around it.

---

## What ships in the E6 PR

1. `scripts/wake-on-event.mjs` — bounded watcher, reference-only payload, exit 2.
2. One `asyncRewake` hook entry wiring it.
3. `monitors/monitors.json` with the single `on-skill-invoke` monitor.
4. This decision record, plus the adopt/defer reasons mirrored onto the bead.

Nothing here is required for Substrate correctness, and nothing here blocks
E1–E5.
