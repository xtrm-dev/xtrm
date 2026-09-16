# Local worker dispatch — xtrm-app v0

> **Historical (2026-09-16).** This brief predates the Console v2 baseline and uses the superseded `Episode` term (read as `Frame`). Do not dispatch work from it. Canonical documents: `docs/README.md`.

Build the first real Linux vertical in `xtrm-dev/xtrm/packages/xtrm-app`. Treat this package as the canonical implementation root for the Episode-based human↔agent desktop app.

Read, in order:

1. `docs/adoption-audit.md`;
2. `docs/implementation-packet.md`;
3. the starter provider/event interfaces.

## Adoption-first rule

Do not start by implementing commodity agent-client infrastructure from scratch.

Before writing the corresponding production code, execute the bounded adoption spikes from `docs/adoption-audit.md` for:

```text
APP-SPIKE-1  acp-components
APP-SPIKE-2  ACP Kit
APP-SPIKE-3  native Pi versus Pi-over-ACP
APP-SPIKE-4  long-session projection/lazy hydration
```

For every evaluated dependency/component, record:

```text
DEPEND / ADAPT / REFERENCE / REJECT
exact repository/package + version/commit
license
what XTRM can delete/not implement because of the adoption
integration friction
product-identity constraints
```

Do not silently vendor or copy source.

The default target after research is:

```text
XTRM-owned product layer
  EpisodeWorkspace
  EpisodeTabStrip
  EpisodeOverview
  ConversationGraph
  branch compression

reused/adapted interaction primitives
  composer
  markdown
  tool/diff/file UI
  permissions

runtime
  PiNativeAdapter -> AgentSessionRuntime
  AcpAdapter -> ACP Kit -> ACP-speaking agents
```

Do not force Pi through ACP merely for uniformity. Native Pi remains preferred until semantic parity is proven for the Episode requirements.

## Product identity rule

Reuse machinery, not another application's identity.

The final application must remain recognizably XTRM through:

- Episode-based interaction rather than an endless chat transcript;
- thin horizontal Episode tabs;
- zoomed-out Episode-card navigation;
- first-class conversation/fork topology;
- visual non-destructive branch compression;
- restrained monochrome/graphite visual language with one accent family;
- XTRM terminology and later XTRM runtime projections.

Do not adopt an upstream `WorkbenchShell`, theme, navigation hierarchy, or chat-first layout wholesale if it makes Episodes secondary.

## Runtime cold start

Before implementation:

1. resolve the current default head of `earendil-works/pi`;
2. record installed versions of `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core`, Node and Bun;
3. verify `createAgentSessionRuntime`, `AgentSessionEvent.agent_settled`, `SessionManager.getTree`, `navigateTree`, `fork`, and compaction against the exact installed/source API;
4. characterize the current Claude Agent SDK TypeScript API only if a direct Claude path remains necessary after the ACP adoption spike;
5. re-verify licenses and current versions of any adopted external dependency.

Land the Pi vertical first. Generic non-Pi provider work should prefer one ACP adapter/runtime over one custom adapter per provider.

The native Pi runtime contract is:

```text
idle Send -> episode_started
turn_start/end -> activity
tool_execution_* -> activity
message_update.text_delta -> streamed response
agent_end -> informational only
agent_settled -> episode_settled
```

Do not close an Episode on `agent_end`.

Use a Tauri 2 React/TypeScript shell with a Node 24 sidecar unless local evidence shows that this choice creates unacceptable packaging/runtime friction. If so, document the evidence and use Electron as the bounded fallback.

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
- tests prove `agent_end` retry does not prematurely close an Episode;
- adoption report proves which commodity components/runtime pieces were reused and which remained XTRM-specific.

Preserve the provider transcript as source of truth. Add only a small app-owned SQLite metadata/index layer where necessary.

Do not introduce Specialists/XTRM chain runtime concepts in this v0.

Do not move the implementation into Core. Core may remain a dependency/provider of XTRM-owned runtime or UI primitives, but `packages/xtrm-app` owns this product surface.
