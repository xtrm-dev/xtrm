# xtrm-app

Linux-first desktop application workspace for XTRM's Episode-based human ↔ agent interface.

This package is the canonical home for the GUI concept and its implementation assets. The current contents are a design/starter checkpoint, not a claim that the desktop application is build-complete.

## Product boundary

```text
human input
  ↓
provider session (Pi first, Claude second)
  ↓
Episode projection
  ├─ ingress
  ├─ turns / tools / retries / compaction
  └─ settled agent response
  ↓
xtrm-app
  ├─ thin horizontal Episode tabs
  ├─ selected-Episode view
  ├─ zoomed-out Episode cards
  └─ conversation branch/fork tree
```

Provider transcript/session state remains authoritative. The app owns presentation metadata and projections only.

## Current assets

```text
xtrm-app/
├── docs/
│   ├── implementation-packet.md
│   └── local-worker-dispatch.md
├── prototype/
│   └── index.html
└── src/
    ├── episode/model.ts
    └── runtime/
        ├── provider.ts
        └── providers/
            ├── pi.ts
            └── claude.ts
```

Open `prototype/index.html` directly in a browser to inspect the interactive GUI mock.

## Initial implementation direction

- Linux desktop shell: Tauri 2 unless local packaging evidence rejects it.
- UI: React/TypeScript.
- Agent host: Node sidecar using direct Pi `AgentSessionRuntime` first.
- Claude Agent SDK adapter follows after the Pi vertical is proven.
- `agent_settled`, not `agent_end`, closes an Episode.
- UI branch compression is non-destructive.

See `docs/implementation-packet.md` before implementation.
