# Architecture diagrams

## 1. Current XTRM (verified)

```mermaid
flowchart TD
  subgraph TMUX["tmux (authoritative)"]
    P1["Pi pane (GUI-launched)"]
    P2["Pi pane (hand-started)"]
    P3["orphan pane (no extension)"]
  end
  P1 <-->|"xtrm-agent-host extension<br/>xtrm.agent-event.v1"| HOST["agent host (core)<br/>registry · journal · SSE<br/>launch · submit · topology"]
  P2 <-->|"same extension,<br/>no GUI action needed"| HOST
  P3 -.->|"invisible (no registry push)"| HOST
  HOST <-->|"SSH fwd → direct front → loopback"| BRIDGE["Vite dev bridge<br/>server/agent-host-*.ts"]
  BRIDGE <-->|"AgentAdapter (live+fixture)"| GUI["Console v2 GUI<br/>AgentProjector → Frames<br/>bounded 200-frame projection"]
  CLI["xt / sb CLIs"] <--> HOST
  SB[("Substrate<br/>typed service")] <--> GUI
  SB <--> CLI
```

## 2. T3 (verified in clone)

```mermaid
flowchart TD
  TSERVER["T3 environment server<br/>owns: provider procs · PTYs · Git · files<br/>orchestration-v2 + SQLite event log"]
  TSERVER -->|"spawns, owns, kills"| PI["pi --mode rpc child<br/>(reserved args enforced)"]
  PI -.->|"unsolicited agent_start<br/>→ TERMINATE"| TSERVER
  TSERVER <-->|"RPC contracts<br/>snapshot + afterSequence"| WEB["web / desktop / mobile<br/>client-runtime + UI"]
  EXT["manual tmux Pi"] -.->|"never live;<br/>file resume into NEW proc only"| TSERVER
```

## 3. Converged proposal (Option B + C sequencing)

```mermaid
flowchart TD
  subgraph KEEP["unchanged XTRM control plane"]
    HOST2["agent host<br/>+ agent-host-client package<br/>(api/ssh/auth/references)"]
    TMUX2["tmux authority<br/>registry-push discovery"]
    PROJ["AgentProjector + history merge<br/>(+ ported settle/snapshot patterns)"]
  end
  TMUX2 <--> HOST2
  HOST2 <--> PROJ
  PROJ <--> ADAPT["adapter seam<br/>(Frame/activity contracts)"]
  ADAPT <--> T3UI["vendored T3 components<br/>composer · timeline · cards<br/>approvals · diff · files"]
  HOST2 <--> CLI2["xt / sb (unchanged)"]
  GATES["parity gates<br/>matrix.spec + real-host 601"] -.->|"enforce"| ADAPT
```

## 4. Session-control flows (local + remote)

- **Case 1 (Pi in XTRM) / 2 (manual tmux + extension):** extension connects → registry
  push → `GET /v1/sessions` lists it → SSE live + journal backfill → submit/steer/abort
  via `agent-command.v1`. GUI and TUI are co-surfaces of one process. No duplicate process.
- **Case 3 (no extension):** pane invisible; UI shows nothing (never history-as-live).
  Explicit upgrade path: run with extension.
- **Case 4 (history only):** journal via `GET …/history` (+ `get_entries` cursor,
  `get_tree` for branches); `history_only`, no composer; `ingress.origin=terminal` inferred
  and labeled as such.
- **Cases 5–6 (other CLIs / remote):** Claude via hooks presence (read-only, §36.11-4);
  remote via SSH-forwarded/direct endpoints with identical routes; per-host identity header
  resets projector state on switch.
- **Cases 7–8 (detached/unreachable/exit):** `disconnected` is first-class shown state;
  working Frames read "state unknown until reconnect"; reconnect resyncs summaries +
  histories (generation++); missed settle past buffer healed by history merge;
  in-flight deltas in the gap are lost (only `message_end`/journal survives).

## 5. Event ingestion, normalization, persistence, recovery

```mermaid
flowchart LR
  PI["Pi AgentSession<br/>(JSONL journal + wire events)"] -->|"subscribe (host-side emitter)"| NORM["Pi → canonical map<br/>(adapter; frame opens on<br/>before_agent_start/agent_start;<br/>closes ONLY on agent_settled)"]
  NORM -->|"xtrm.agent-event.v1"| HOST3["host: registry +<br/>journal + SSE<br/>(Last-Event-ID cursor)"]
  HOST3 -->|"live stream"| LP["AgentProjector<br/>(ephemeral deltas)"]
  HOST3 -->|"history route"| HP["history merge<br/>(authoritative ends)"]
  LP --> GUI2["Frames + Activity"]
  HP --> GUI2
  DISC["disconnect"] -->|"shown, never guessed"| GUI2
```

Rules: `message_end` + journal authoritative; deltas view-only; answer values local-only;
`editor` prompts excluded by contract; recovery via since-cursor + leafId + bounded replay.

## 6. CLI/GUI capability-sharing model

```mermaid
flowchart TD
  CORE["core authorities<br/>xt launch · host registry<br/>sb typed service · gh/gh-proxy"]
  SVC["agent-host-client (new)<br/>api · ssh · auth · references<br/>importable by BOTH"]
  CORE <--> SVC
  SVC <--> GC["GUI adapters<br/>(view-model mapping only)"]
  SVC <--> CC["CLI commands"]
  GATES2["parity-matrix.json<br/>+ matrix.spec + 601"] -.->|"CI gate"| GC
```

Non-goals: no GUI launch-resolution duplication, no second specialist dispatcher, no direct
`state.db`/journal reads, no direct `api.github.com` calls.
