# Local worker dispatch — xtrm-app v0

Build the first real Linux vertical in `xtrm-dev/xtrm/packages/xtrm-app`. Treat this package as the canonical implementation root for the Episode-based human↔agent desktop app.

Read `docs/implementation-packet.md` and the starter provider/event interfaces.

Before implementation:
1. resolve the current default head of `earendil-works/pi`;
2. record installed versions of `@earendil-works/pi-coding-agent`,
   `@earendil-works/pi-agent-core`, Node and Bun;
3. verify `createAgentSessionRuntime`, `AgentSessionEvent.agent_settled`,
   `SessionManager.getTree`, `navigateTree`, `fork`, and compaction against the
   exact installed/source API;
4. characterize the current Claude Agent SDK TypeScript API from official docs
   and the installed package before writing the Claude adapter.

Do not start with Claude. Land the Pi vertical first.

The runtime contract is:

```text
idle Send -> episode_started
turn_start/end -> activity
tool_execution_* -> activity
message_update.text_delta -> streamed response
agent_end -> informational only
agent_settled -> episode_settled
```

Do not close an Episode on `agent_end`.

Use a Tauri 2 React/TypeScript shell with a Node 24 sidecar unless local evidence
shows that this choice creates unacceptable packaging/runtime friction. If so,
document the evidence and use Electron as the bounded fallback.

The first accepted milestone is:
- Linux app launches;
- cwd selection;
- real Pi session;
- two real prompts produce two thin horizontal episode tabs;
- click switches episodes;
- Activity contains real turn/tool data and is collapsed by default;
- Zoom Out shows episode cards and can navigate back;
- session tree/fork renders in sidebar;
- UI-only branch compression works;
- restart reconstructs sessions/episodes;
- abort works;
- tests prove agent_end retry does not prematurely close an Episode.

Preserve the provider transcript as source of truth. Add only a small app-owned
SQLite metadata/index layer where necessary.

Do not introduce Specialists/XTRM chain runtime concepts in this v0.

Do not move the implementation into Core. Core may remain a dependency/provider of XTRM-owned runtime or UI primitives, but `packages/xtrm-app` owns this product surface.
