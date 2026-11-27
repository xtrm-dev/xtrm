# Threads across hosts

Status: proposal for operator review (XTRM-1077). Author: worker `hosts`. Date: 2026-11-27.
Agreed with the settings agent (XTRM-1101) for the settings placement in section 7.

## 1. Problem and decision summary

Threads (packages/pi-viewer) reads one tmux server and the transcripts of one machine. The operator runs
agents on a laptop, a desktop and a server (159.195.49.110, tailnet name `v2202602340735437128`). Pane ids
such as `%3` are counters of one tmux server, so agents from two hosts cannot be merged by pane id.

Recommendation, in one paragraph: each host runs its own threads server, which is the only reader and the
only writer of its own tmux and transcripts. The browser connects to each chosen host directly, over
Tailscale, with one push stream (SSE) per host. An agent's identity is `(host, tmux server, pane)`
everywhere. A write (send, stop) goes only to the owning host's endpoint and is never relayed. Substrate
stays the one authority on the server, reached through the existing `sb` remote path; threads shows the
claim from Substrate and the `@agent_issue` hint from the owning host's tmux, and marks a disagreement.
The per-host endpoint uses the same API shape as the console's agent host, so the two can merge later
into one process per machine (console rule, PRD §35.5).

## 2. Evidence

### 2.1 Verified facts (measured or read on 2026-11-27)

| # | Fact | Source |
|---|---|---|
| F1 | Discovery runs one `tmux list-panes -a` on the default socket only. Other tmux servers on the same host are not seen. | `server/discover.ts:91`, `:122`, `:495`, `:502` |
| F2 | The tmux server identity is `serverPid:socketPath`, taken from the first pane. It changes when tmux restarts. | `server/discover.ts:448-452` |
| F3 | An agent's `id` is its bare pane id. | `server/discover.ts:280`, `:312-313`, `:412-413`; `src/shared/types.ts:12-14` |
| F4 | The server has three tmux sockets (`default`, `CORE2443`, `pktest`); the laptop has more than 100 (test servers included). | `ls /tmp/tmux-1000` on both hosts |
| F5 | Pane id ranges overlap between hosts: local `%0..%18`, server `%1`, `%330..%1569`. Both hosts have a tmux session named `xx`. | spike output, `tmux list-panes -a` on both |
| F6 | Local discovery, warm, 9 agents, load 15 on 8 cores: p50 82 ms wall, max 239 ms, 40.6 ms node CPU per pass; `tmux list-panes` 20 ms, `ps` 30 ms. Cold first pass: 3.3 s and 568 MB RSS peak (transcript parse), 317 MB after. Sessions payload 7.5 kB. | `~/.cache/XTRM-1077/measure-discovery.ts` |
| F7 | The discovery timer runs every 2 s while a client asked within 60 s, and stops when idle. One snapshot serves every client. | `server/api.ts:310-362` |
| F8 | The browser polls `/api/sessions` every 10 s and `/api/thread` every 1.5 s (backs off to 5-10 s when slow). | `src/App.tsx:203`, `:268-278` |
| F9 | ssh to the server, no ControlMaster on this laptop: 0.65-0.68 s per `ssh true`, same over the public IP and the tailnet IP. | `ssh -G` shows `controlmaster false`; `/usr/bin/time` |
| F10 | Spike: the real discovery code, bundled (67 kB) and piped to `node -` on the server over ssh, reads 12 agents in one tmux server, cold, in 5.8 s (server load 17 on 12 cores); 6.85 s wall with ssh. Output 4.5 kB. Nothing is written on the server. | section 9 |
| F11 | The server runs `xt host` (agent host 0.15.3) for 27 days, 257 MB RSS. `GET /v1/sessions` answers on loopback in 93 ms with 3.8 MB: 4790 sessions, most of them ended. Its `tmux` field is `{session, paneId}` with no server or host. | `~/.xtrm/run/agent-host.json`; curl on the server |
| F12 | On the laptop `~/.xtrm/run/agent-host.json` names pid 599983, which is not running (stale file). | `ps -p 599983` |
| F13 | `sb` remote mode forwards every command group except `help, version, doctor, remote, serve` as one `ssh -T -o BatchMode=yes -o ConnectTimeout=10` process per call. An unreachable server is an error, never a local fallback. | `packages/substrate/src/remote/executor.ts:101`, `:175-181`, `:521-529`; `remote/ssh.ts:28-41` |
| F14 | `sb serve --stdio` is a per-client-process service over one ssh connection with a closed operation table (issue, gate, store, journal, provenance, resume, authority). ADR-008 decided: no listener, no daemon; a tunneled daemon (option C) is not foreclosed. | `packages/substrate/src/service/serve.ts:1-12`, `service/ops.ts:129-301`; `docs/runtime/adr/008-substrate-remote-store-access.md:50-75`, `:513` |
| F15 | `sb` claim sets `@agent_issue` on the claimer's own pane in the LOCAL tmux, after the remote result. Release and close unset matching panes on the local tmux server only; another host keeps the stale option. | `packages/substrate/src/domain/pane-issue-sync.ts:17-21`, `:85-93`, `:110-131` |
| F16 | Claims carry `holder`, `expiresAt`, `activationId`; no host or pid. Default TTL 15 min. | ADR-008 "Claims across hosts" (`:171-172`) |
| F17 | The console reaches one agent host at a time: ssh forward, else direct pairing, else loopback. Session keys are bare `sessionId`; a change of host resets the projector. | `packages/xtrm-app/server/agent-host-ssh.ts:509-520`; `src/adapters/agent/live.ts:316-323` |
| F18 | Console rules: one agent host per machine (PRD `docs/xtrm-gui-prd.md:1760`); "one API for local and remote clients" (`:1773`); a host level appears in the tree only when more than one host is connected (`docs/design/agent-experience/brief.md:176`); remote use must show connection state and never wait on the network for layout (ADR-001:34). | as cited |
| F19 | The agent-host reporter (`core/.xtrm/hooks/agent-host-reporter.mjs`, 247 lines) pushes Claude hook events to the local agent host socket with a 300 ms budget. Claude sessions are presence-only producers (no assistant text). | reporter header lines 1-37 |

### 2.2 Assumptions (not verified)

- A1. Discovery cost grows about linearly with agent count; 15 agents ≈ 70 ms CPU per warm pass.
- A2. `tailscale serve` can expose a second loopback port per host, and the `Tailscale-User-Login` header is
  available to the backend for authorisation (the console already uses `tailscale serve`, `docs/tailnet-deploy.md:10`).
- A3. The laptop and the desktop each run their own tmux and their own agents; no host reads another host's
  transcript files.
- A4. The operator is the only tailnet user (one account `dawid.jgg@`, per `tailscale status`).

### 2.3 Open questions for the operator

- Q1. Which tmux servers per host count? Default socket only (today), or a configured list per host? The
  server's `CORE2443` and `pktest` sockets look like test servers.
- Q2. Should threads and the console's agent host become one process per machine now (stage 7 first), or
  after threads multi-host works on its own?
- Q3. Is direct browser-to-host (CORS between tailnet origins) acceptable, or must one origin serve the UI
  and proxy reads (reads only; writes stay direct)?

## 3. Single-tmux-server assumptions today (validation inventory)

Kind: IDENTITY = a key built from a pane, window or session id without a host; READ = a read of the local
tmux, process table or files; WRITE = keys into a pane.

### 3.1 packages/pi-viewer

| file:line | Kind | What assumes one tmux server / one host |
|---|---|---|
| server/discover.ts:26-27 | READ | Pi transcripts from `~/.pi/agent/sessions` of this machine |
| server/discover.ts:76-91, 122, 495, 502 | READ | `tmux list-panes -a` on the default socket; `ps` of this machine |
| server/discover.ts:266-272 | IDENTITY | Duplicate names get a pane-id suffix |
| server/discover.ts:280, 312-313, 412-413 | IDENTITY | `id = paneId` |
| server/discover.ts:448-452, 467, 486 | IDENTITY | One `serverId` for all sessions, from the first pane |
| server/discover.ts:489 | IDENTITY | Attention reads pruned by bare pane id |
| server/discover.ts:508-516 | IDENTITY | `findAgent(session, paneId)`; default session `xx` |
| server/claude.ts:57, 106-109, 178 | READ | Claude config dir and `sessions/<pid>.json` of this machine |
| server/claude.ts:288-316 | IDENTITY | Transcript pairing ordered by pane number |
| server/peers.ts:16 | READ | `~/.claude/sessions/<pid>.json` of this machine |
| server/attention.ts:147-157 | READ | `tmux capture-pane -p -J -t <paneId>` on the default socket |
| server/attention.ts:181-244 | IDENTITY | Generation, last-read and in-flight maps keyed by bare pane id |
| server/thread-cache.ts:106, 170, 199 | IDENTITY | `agentCache` keyed by `agent.id` (= pane id) |
| server/thread-cache.ts:181, 192 | IDENTITY | `sessionCache` keyed by tmux session name |
| server/api.ts:146 | IDENTITY | Session version string from pane ids |
| server/api.ts:270, 276 | IDENTITY | Scope filters by bare pane id and window |
| server/api.ts:406-413 | IDENTITY | Session lookup by name, default `xx` |
| server/api.ts:527-575 | IDENTITY | Thread frame cache key starts with the session name |
| server/api.ts:579-582 | IDENTITY | `/api/event?session&paneId` |
| server/api.ts:599-617 | WRITE | `/api/send`: `/^%\d+$/` check, then `tmux send-keys -t <paneId>` on the default socket |
| server/api.ts:641-646; server/stop.ts:23-29 | WRITE | `/api/stop`: `send-keys -t <paneId>` on the default socket |
| src/shared/types.ts:12-22, 59, 162, 194 | IDENTITY | `ViewerAgent.id/paneId/tmuxSession`, `ViewerSession.serverId`, `ThreadMeta.serverId`, `SendPayload.paneId` |
| src/lib/scope.ts:17-41, 59, 76, 102, 114-135 | IDENTITY | URL `?s=&w=&p=`, scope equality and keys by bare pane id |
| src/lib/tree.ts:61, 66-87, 96, 106 | IDENTITY | Tree keys `p:<paneId>`, duplicate-pane check per id |
| src/lib/readstate.ts:5-7, 30 | IDENTITY | Read-state key `serverId:base` (has a server, no host) |
| src/lib/api.ts:77-109 | IDENTITY/WRITE | `fetchEvent`, `sendPrompt`, `stopAgent` by bare pane id, relative URLs to one origin |
| src/lib/optimistic.ts:5, 34; src/lib/thread.ts:724 | IDENTITY | Optimistic rows matched by bare pane id |
| src/lib/details.ts:14-35 | IDENTITY | Detail fetch key `session:paneId:seq` |
| src/App.tsx:108, 203, 254-262, 361, 429-457, 535, 584-587 | IDENTITY/WRITE | Scope pane, one sessions poll, `serverId` compare, send/stop by pane id |
| src/components/sidebar/SessionTree.tsx:165, 186 | IDENTITY | Pane selection by bare id; tree labelled "tmux sessions" |
| src/components/presence/PresenceDetail.tsx:155 | IDENTITY | "Place" shows session, window, pane, no host |
| src/components/ChannelView.tsx:310 | IDENTITY | `readKey` prefixed by tmux server id only |

### 3.2 packages/xtrm-app (the console)

The console never runs tmux; `xt host` does (F17). Its single-host assumptions:

| file:line | Kind | What |
|---|---|---|
| server/agent-host-ssh.ts:509-520 | IDENTITY | One active endpoint: ssh, else direct, else local |
| server/agent-host-ssh.ts:366, 644-652 | IDENTITY | One connection settings file |
| server/agent-host-ssh.ts:454; server/agent-host-live.ts:49-55 | IDENTITY | Host id `ssh:<target>:<pid>` / `local:<port>:<pid>` (the only host qualifier) |
| server/agent-host-ssh.ts:540-555; agent-host-live.ts:69-71, 103 | READ | `/api/v1/sessions` and SSE proxied with no host segment |
| server/agent-host-ssh.ts:579-600 | WRITE | submit, resolve, launch forwarded to the active endpoint by bare `sessionId` |
| server/agent-host-ssh.ts:89-92, 627-633 | WRITE | Terminal handoff `ssh -t <target> tmux attach -t <session>` |
| src/adapters/agent/protocol.ts:32-34, 53, 236 | IDENTITY | `HostTmux {session, paneId}`, no server or host |
| src/adapters/agent/types.ts:40-41; live.ts:532 | IDENTITY | `tmux` string `"session:pane"` |
| src/adapters/agent/live.ts:94-110, 278, 316-323, 420-458 | IDENTITY | Names, histories by bare `sessionId`; host change resets the projector |
| src/adapters/agent/live.ts:488-489, 539-564 | WRITE | submit, abort, respond by bare `sessionId` |
| src/adapters/agent/projector.ts:117, 125, 224 | IDENTITY | Sessions map and frame id by `sessionId` |
| src/agent/queries.ts:38, 43, 83; src/app/router.tsx:88, 176 | IDENTITY | Query keys and route `/agent/$sessionId` without a host |
| src/agent/NewSession.tsx:53 | IDENTITY | Launch joined by tmux session name |
| src/agent/HostConnection.tsx:370-379; AgentSurface.tsx:31-33; Composer.tsx:404 | WRITE | Attach command derived from `tmux.split(":")[0]` and "remote if settings exist" (can pick the wrong host in direct mode, inferred) |

`sessionId` (a UUID) is already globally unique, so the console needs a host qualifier for routing and
display, not for uniqueness. Threads keys by pane id, so it needs the qualifier for uniqueness too.

## 4. Host model and identity

### 4.1 Declaring hosts

- `hosts.peers` (device-scoped): a list of `{id, label, address, transport}`. `address` is a tailnet name
  (MagicDNS) or `ssh:<target>`. The compiled default is empty.
- Discovery: at runtime, threads reads `tailscale status --json` on the device and proposes online Linux
  peers that answer `GET /api/host` on the threads port. A proposed peer is shown, not connected, until the
  operator adds it. Offline peers (`fedora-1`, last seen 8 h ago) stay listed with their last-seen time.
- `hosts.connectTo` (device-scoped): `this` | `chosen` (with ids) | `all`.
- `hosts.endpoint` (host-scoped, on each host): bind address (loopback), port, `acceptRemoteReaders`.

### 4.2 Identity

```
HostId     = stable host name: the tailnet MagicDNS name, else the machine hostname
ServerId   = tmux socket path (e.g. /tmp/tmux-1000/default)      -- stable across tmux restarts
ServerEpoch= tmux server pid                                     -- changes on restart
AgentKey   = "<HostId>/<ServerId>/<paneId>"                      e.g. server//tmp/tmux-1000/default/%1553
```

- Every place in section 3.1 that keys by `paneId`, `id`, session name or `serverId` keys by `AgentKey`
  (agents) or `"<HostId>/<ServerId>/<session>"` (sessions). Routing uses `HostId`; uniqueness uses all three.
- Read state keeps today's rule (a restarted tmux is a new thread) by using `HostId/ServerId@ServerEpoch`
  as its prefix (today `serverPid:socket`, `src/lib/readstate.ts:6-7`).
- The URL gains `h=<HostId>`: `?h=server&s=market-data&w=%4073&p=%251553`. A URL without `h` means "this host".
- `ViewerAgent` gains `host`, `tmuxServer`, `key`; `paneId` stays the local tmux target. Only the owning
  host interprets `paneId`.
- Console mapping: an agent-host session `{sessionId, tmux:{session,paneId}}` maps to the same `AgentKey`
  once the agent host reports its socket path (stage 7). `sessionId` stays the console's primary key.

## 5. Transport

### 5.1 Options

| Option | Per-host process | Latency | Cost on the observed host | Auth | Unreachable host | Verdict |
|---|---|---|---|---|---|---|
| A. ssh-exec per read (the spike's shape) | none | 0.65 s handshake per call (F9); cold discovery 5.8 s per call on the server (F10) | full cold parse on every call: seconds of CPU and hundreds of MB | ssh keys | ssh exit 255 after ConnectTimeout | Rejected for live use. It cannot meet a 2 s refresh, and each call pays the cold cost. Kept as the spike and as a one-shot "is this host alive" probe. |
| B. Threads server on each host, one SSE stream per host to the browser | one threads server (exists) | one connection; push latency = discovery tick (2 s) or file change | one warm discovery shared by all viewers: ~40 ms CPU per 2 s (F6), 0 when idle (F7) | Tailscale (`tailscale serve`, tailnet identity), or ssh `-L` with a loopback token | stream drops → host row "offline since t", last snapshot kept read-only, reconnect with backoff 1 s → 30 s | **Recommended now** |
| C. Reuse the console's `xt host` as the per-host endpoint | `xt host` (exists on the server) | SSE exists (`/v1/events`) | agent host already resident (257 MB, F11); Claude events pushed by the reporter, no polling (F19) | same as the console | same as B | **Target, later**: today `/v1/sessions` returns 3.8 MB of mostly ended sessions, has no tmux server id, and Claude sessions are presence-only (no transcript text), so threads would still need its own transcript reader. |
| D. Carry agent data over `sb serve --stdio` | none | ssh per client process | — | ssh | `RemoteError unreachable` | Rejected. The service is a closed table of Substrate operations on one store (F14); tmux and transcript reads are not Substrate state, and widening the table is what its design forbids. It is also not a resident daemon. |

### 5.2 Recommendation

Option B now, built to the agent-host API shape so that stage 7 can move it into `xt host` (option C)
without a client change:

- Each host's threads server adds a host-qualified API: `GET /api/host` (HostId, version, servers,
  status), `GET /api/stream` (SSE: one `snapshot` event, then `agents` diffs and `thread` deltas keyed by
  `AgentKey`), and keeps `/api/thread` and `/api/event` for history pages.
- The browser is the aggregator: one `EventSource` per connected host. No host proxies another host's
  reads or writes. The same SSE replaces today's local 1.5 s thread poll, so the local case gets cheaper too.
- Exposure: loopback bind plus `tailscale serve` on a fixed tailnet port per host. Authorisation: the
  backend accepts only the operator's tailnet login (A2, A4). Fallback for a host without `tailscale
  serve`: an ssh `-L` forward started by the device (the console's existing pattern), with a bearer token
  kept in the host's credential store, never in settings (settings agent condition).
- Discovery stays on the owning host. Only the owning host reads its tmux, `/proc` and transcripts.

### 5.3 Performance budget (bar: no sluggish laptop or server at ~15 agents per host)

| Item | Budget | Basis |
|---|---|---|
| Discovery on a host while viewed | ≤ 5 % of one core at 15 agents (≈ 70 ms per 2 s pass) | F6, A1 |
| Discovery on a host while not viewed | 0 (timer stops after 60 s idle) | F7 |
| Cold start of a host's threads server | once per process; never per viewer or per request | F6, F10 |
| Connections per viewer | 1 per connected host | B |
| Steady network per host | snapshot once (~12 kB at 15 agents), then diffs; target ≤ 5 kB/s per host while agents work | F6 payload 7.5 kB / 9 agents |
| Viewer reconnect | backoff 1 s → 30 s, jittered; one probe per host per interval | — |
| Agent host session list (if used in stage 7) | must be pruned to live sessions before threads consumes it | F11 |

The measured local cold pass (3.3 s, 568 MB peak RSS) is the largest single cost. It is outside the
multi-host change, but stage 3 records it as a finding because a second host doubles the chance that a
viewer meets it.

## 6. Write path

- Send and stop go from the browser to the owning host's endpoint, chosen by `AgentKey.host`. The owning
  host checks that the `AgentKey` is in its own live discovery (today's check, `server/api.ts:604-607`,
  extended to the server id) and runs `tmux -S <ServerId> send-keys -t <paneId>`.
- No host relays a write. A host refuses a key whose `HostId` is not its own (400).
- An offline host's agents show a disabled composer with "host offline". Nothing is queued for later.
- Terminal handoff (console) stays `ssh -t <target> tmux -S <ServerId> attach`; the target comes from the
  agent's host, not from "the" connection (fixes the inferred defect at `HostConnection.tsx:370-379`).

## 7. Settings placement (agreed with XTRM-1101)

| Key | Scope | Where it is edited |
|---|---|---|
| `hosts.peers` | device | /settings → Connections |
| `hosts.connectTo` | device | threads popover (picker and per-host status), link to /settings Connections |
| `hosts.endpoint` (bind, port, acceptRemoteReaders) | host | /settings → Connections |
| endpoint token | secret in the host credential store; not a setting, never in `GET /settings` | — |
| `hosts.substrateRemote` | project scope in the settings model: host layer supplies it, a project override stored on the host may replace it | /settings → Connections |
| existing console `connections.*` (hostMode, sshTarget, remoteCommand, directUrl, deviceName) | host, unchanged | /settings → Connections |

The console's System & settings drop-up shows one line, "Connected: N hosts, M offline", which opens the
Connections section.

## 8. Substrate

- One authority: the store on the server. The laptop and the desktop already reach it through `sb` remote
  mode (F13). Threads adds no channel for Substrate data.
- Threads reads claims through the same path: one `sb serve --stdio` service per threads server
  (`issue.getActiveClaim`, `issue.get`), opened once and reused, not one ssh per question. On the server it
  runs in-process (`createLocalService`). Threads only reads Substrate.
- `@agent_issue` stays a hint written by the agent's own host (F15). Threads reads it from the owning
  host's discovery, which keeps it consistent with that host's tmux.
- Known gap (F15): a release or close run on host B leaves `@agent_issue` set on host A's pane. Threads
  shows the Substrate claim as the truth and marks a pane whose hint disagrees ("hint stale"). The fix
  belongs to each host: a periodic sweep on the owning host that unsets `@agent_issue` on its own panes
  when Substrate has no live claim for that holder (stage 6). The sweep writes only its own tmux, so it
  respects the write rule.
- Claims need no host field (F16): the holder names the agent, and the holder-to-pane binding
  (`@agent_holder`) lives on the owning host's tmux.
- When the Substrate server is unreachable, threads shows claims as "unknown (Substrate offline)" and keeps
  the hints; it never falls back to a local store (same rule as `sb`, F13).

## 9. Spike (read-only, one remote host)

`~/.cache/XTRM-1077/spike-entry.ts` imports the unchanged `server/discover.ts`, bundles it with esbuild into
`spike.mjs` (67 kB) and prints each agent with its `AgentKey`. It is piped to the server:

```
ssh -o BatchMode=yes dawid@159.195.49.110 'unset TMUX TMUX_PANE; SPIKE_HOST=server nice -n 19 node --input-type=module -' < spike.mjs
```

The program reads `tmux list-panes`, `ps`, `/proc`, `git rev-parse` and transcript files; the bundle has no
file-write call (checked by grep). Result: 12 agents, one tmux server, for example
`server/1129:/tmp/tmux-1000/default/%1553 pi waiting market-data-xt-pi-board-helper` and
`server/1129:/tmp/tmux-1000/default/%1569 claude working market-data-xt-claude-MMD-5300`. The same
program on the laptop: 9 agents as `fedora/1698477:/tmp/tmux-1000/default/%0 …`. The spike's ids use
today's `serverId` (pid:socket); section 4.2 drops the pid from the routing key.

What the spike proves: discovery must run on the owning host (it needs `/proc`, `ps` and local files), and
ssh-exec per read is too slow for live use (F10), so a resident per-host endpoint is required (option B or C).

## 10. UI

- The sidebar tree becomes host > tmux session > window > pane when more than one host is connected; with
  one host it stays as today (console rule F18).
- Host row: label, status (connected, connecting, offline since t, auth refused), agent count and the
  number that need the operator. Collapsed by default when offline.
- Offline host: last snapshot stays visible, dimmed, read-only; composer disabled; "last seen" time.
- The Channel and pane views show the host in "Place" (`PresenceDetail.tsx:155`) and in the header when
  more than one host is connected.
- The threads popover holds the host picker (`hosts.connectTo`) and per-host status.

## 11. Staged build plan (proposed issues, not filed)

| Stage | Proposed issue | Scope | Depends on |
|---|---|---|---|
| 1 | Host-qualified identity in threads, single host | `AgentKey`, `ViewerAgent.host/tmuxServer/key`, caches and URL `h=` (all rows of 3.1); no behaviour change | — |
| 2 | Discovery per configured tmux server | read the sockets named for the host (Q1); `tmux -S` for reads and writes | 1 |
| 3 | Push stream per host | `GET /api/host`, `GET /api/stream` (snapshot + diffs); the browser drops the 1.5 s thread poll; record cold-start cost | 1 |
| 4 | Connect to peers | `hosts.peers`, `hosts.connectTo`, Tailscale discovery, `tailscale serve` exposure, tailnet-login auth, CORS (Q3); host tier in the tree; offline states | 3, XTRM-1101 settings model |
| 5 | Writes to the owning host only | send and stop routed by `AgentKey.host`; refuse foreign keys; disabled composer offline | 4 |
| 6 | Substrate claim truth and hint sweep | threads reads claims through one `sb` service; "hint stale" marker; per-host `@agent_issue` sweep (substrate `pane-issue-sync`) | 1 |
| 7 | Converge with the console agent host | `xt host` prunes ended sessions, reports tmux socket, serves threads history; threads and console read one endpoint per machine (Q2) | 3, core |

## 12. Scratch files

Under `~/.cache/XTRM-1077/`: `measure-discovery.ts`, `spike-entry.ts`, `spike.mjs`, `spike-local.json`,
`spike-server.json`, `spike-server.err`.
