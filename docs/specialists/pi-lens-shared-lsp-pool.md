# Design: Shared LSP Pool for pi-lens (borrowing the serena-pool pattern)

> Status: **design proposal — not implemented**
> Author: session 2026-07-01 evaluation
> Related: `docs/specialists/specialists.scheme.md`, serena-pool extension

## TL;DR

pi-lens spawn its own LSP servers **in-process** (singleton per pi instance, keyed
`serverId:root`). Serena-pool already solves **cross-process LSP sharing** via a
hash-port daemon with lockfile + orphan cleanup. This doc evaluates whether
pi-lens can **borrow that pattern** so that N concurrent pi sessions (main +
specialists in worktrees) share **one** language server per repo root instead of
spawning N.

**Short answer:** pi-lens **cannot reuse the Serena pool directly** (protocol +
captivity barriers below), but it **can adopt the pattern** by promoting our own
`lsp-pi` library into a cross-process daemon and registering it as a pi-lens
custom LSP server. The ROI is real **only if** specialists run concurrently on the
same repo root. The orphan-cleanup concern (verified: stale pyright/ts-ls
processes accumulate today) is a separate, standalone motivation.

---

## 1. Problem statement

### 1.1 The double-LSP on the same root

When a pi session and a specialist run in the **same repo root** concurrently:

```
pi (main, pi-lens)      → spawns ts_ls #1 (in-process LSPService)
specialist (Serena)     → spawns ts_ls #2 (via serena-pool or own LSPManager)
```

Two `typescript-language-server` processes on the same workspace ≈ **600 MB RSS

+ double index build**. ts_ls is ~300 MB resident once warmed.

### 1.2 The orphan leak (verified, independent problem)

Process snapshot taken during evaluation (with empirical PID monitoring — see
§1.4 for the verified kill behaviour):

```
1586802  pyright (00:20)   ← stale
2283832  pyright (01:12)   ← stale
2614829  pyright (01:29)   ← stale
2821693  pyright (01:38)   ← stale
3314051  pyright (02:18)   ← current-ish
4124308  ts-ls  (03:38)    ← Serena's, .serena/language_servers path
2082493  pyright           ← 11 DAYS old (etime `11-04:21:16`)
```

These orphaned LSP processes are **never reaped** because pi-lens's idle-kill
only fires on a **graceful** session lifecycle: the `scheduleLSPIdleReset` timer
is `.unref()`'d, so when a session **crashes** (`kill -9`, terminal closed, OOM,
SIGKILL of the pi process) the timer dies with the parent process **without ever
firing**. The language server child is left running with no reaper. This is a
slow memory leak on long-lived dev machines with many sessions/day.

**Confirmed by monitoring** (see §1.4): the idle kill *does* fire for graceful
sessions (verified pid died exactly at 240 s post-`turn_end`), but orphans from
crashed sessions persist indefinitely — the oldest observed was 11 days old.

### 1.4 Verified lifecycle behaviour (empirical PID monitoring)

Ran a 6-minute PID monitor (`/tmp/lsp-pid-monitor.sh`, 20 s sampling) with a
controlled activity → idle transition. Results:

| pid | role | timeline | outcome |
| --- | --- | --- | --- |
| `1052668` | ts-ls spawned for this session at `03:08:26` (on `lsp_diagnostics` call) | last `turn_end` `03:11:03` → 240 s idle timer | **DEAD at `03:15:03`** — idle kill fired exactly on schedule |
| `3314283` | ts-ls from an earlier crashed session (etime 3 h 07 m) | parent pi long gone | **STILL ALIVE** — no reaper |
| `2082493` | pyright orphan | parent gone ~11 days ago (etime `11-04:21:16`) | **STILL ALIVE** — worst-case leak |

**Conclusions:**

1. The idle-kill mechanism works **correctly for graceful sessions** (240 s after
   the last `turn_end`). It is *not* a permanent keep-alive.
2. The idle-kill is **useless for crashed sessions** — the `.unref()`'d timer dies
   with the parent, and the LSP child is orphaned forever.
3. pi-lens **does not reuse** an orphaned LSP even when one exists for the same
   root — calling `lsp_diagnostics` spawned a fresh `1052668` while `3314283`
   (same `typescript-language-server --stdio` on the same root) kept running.
   Confirms §1.1: no cross-session LSP reuse.

These three points are the empirical justification for **Phase 1 (orphan
reaper)** in §7 — independent of the pool question.

### 1.3 pi-lens LSP lifecycle (verified from source)

From `dist/clients/lsp/client.js` + `index.js` + `sessionstart.log`:

| Mechanism | Detail |
| --- | --- |
| Keying | `serverId:root` (per language server × workspace root) |
| Spawn dedup | in-flight promise map (`state.spawning`) prevents double-spawn **within one process** |
| Idle reset | `scheduleLSPIdleReset` → **240 s** `setTimeout`, `.unref()`'d, **rescheduled on every `turn_end`** |
| Graceful shutdown | `shutdown` request → `SHUTDOWN_REQUEST_TIMEOUT_MS` → `exit` notification |
| Force kill | `killProcessTree`: POSIX `killPosixProcessGroup(SIGTERM)` → `killDirectChild(SIGTERM)` → 1.5 s → `SIGKILL` escalation |
| Failure cooldown | `state.broken` Map (temp) + `permanentlyBroken` Set (session) |
| Cascade TTL | `CASCADE_DIAGNOSTICS_TTL_MS = 240_000` |

**Critical:** all of the above is **in-process**. Two pi processes = two
`LSPService` singletons = two ts_ls, with zero cross-process coordination. pi-lens
has **no** lockfile, port, socket, or IPC mechanism for sharing.

**Idle-reset nuance (verified empirically):** the 240 s timer is *rescheduled*
on every `turn_end` while the session is active, so during normal use the LSP
never dies mid-session. The kill fires only after **240 s of silence following
the last `turn_end`** — and only if the session is still alive to fire the
`.unref()`'d timer. If the session dies first (crash), the timer is gone and the
LSP is orphaned. See §1.4 for the verified timeline.

---

## 2. Why we cannot borrow the Serena pool directly

Three compounding barriers, each sufficient on its own.

### Barrier 1 — Protocol mismatch (fundamental)

| Layer | Serena-pool | pi-lens |
| --- | --- | --- |
| Transport | **MCP over HTTP** (`streamable-http` on hash-port) | **LSP over stdio** (JSON-RPC on `stdin`/`stdout`) |
| Wire | MCP tool calls (`find_symbol`, `read_file`, …) | LSP messages (`textDocument/definition`, `diagnostic`, …) |

These are two different abstraction layers. MCP is agent-facing tool semantics;
LSP is editor-facing language semantics. There is no common socket.

### Barrier 2 — Diagnostics are captive in Serena (the killer)

pi-lens's **primary** value is automatic **type diagnostics** on every write/edit
(the `2322 Type 'string' is not assignable to 'number'` case we verified).

Inspection of Serena's tool surface (`serena/tools/*.py`):

+ `find_symbol`, `find_referencing_symbols`, `get_symbols_overview`, `read_file` → exposed MCP tools
+ `EditingToolWithDiagnostics` → Serena uses LSP diagnostics **internally** to validate its own symbolic edits
+ **`util/ls_diagnostics.py`** → diagnostics utility, **not** exposed as an MCP tool

**There is no `get_diagnostics` MCP tool.** Even with a perfect LSP↔MCP bridge,
pi-lens could not obtain from Serena the one thing it needs most. A bridge would
only deduplicate navigation (already redundant via pi-lens's own
`lsp_navigation`).

### Barrier 3 — Language server is a captive child

Serena spawns `ts_ls`/`pyright` as a **child process** to feed its tools. The
language server is **not** exposed as a reusable LSP endpoint — it is owned by the
Serena process, speaks stdio to Serena, and dies with it. pi-lens cannot
"attach" to Serena's ts_ls.

### Conclusion on direct reuse

Bridging all three (MCP→LSP translation + diagnostics surfacing + child
re-parenting) would be more work than building a purpose-built pool. **Do not
attempt direct Serena-pool reuse.**

---

## 3. Proposed design — "Via B": borrow the pattern, not the pool

### 3.1 Two components

```
┌─────────────────────────────────────────────────────────────┐
│  Component A: lsp-pi-daemon  (promote our lsp-pi library)   │
│  ───────────────────────────────────────────────────────    │
│  • Node process, detached, new process group (pgid == pid)  │
│  • One per repo root, port = hash(root) ∈ [40000, 44999]    │
│  • Owns the LSPManager (singleton, LRU 30, idle 60s)        │
│  • Listens on port, speaks LSP JSON-RPC over a thin TCP     │
│    framing (Content-Length headers, same as stdio)          │
│  • State file in /tmp/lsp-pi-pool/pool-<port>.json          │
│  • Lockfile in  /tmp/lsp-pi-pool/pool-<port>.lock           │
│  • Reaps orphans by process-group on takeover               │
└─────────────────────────────────────────────────────────────┘
                          ▲
            LSP-over-TCP   │   (pi-lens custom LSP server)
                          │
┌─────────────────────────┴───────────────────────────────────┐
│  Component B: pi-lens custom LSP registration               │
│  ───────────────────────────────────────────────────────    │
│  • .pi-lens/config.json → lsp.customServers                 │
│  • Adapter: opens TCP socket to lsp-pi-daemon, bridges to    │
│    stdio so pi-lens's StreamMessageReader/Writer see a local  │
│    language server — pi-lens never spawns its own ts_ls       │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 What gets reused from lsp-pi (our code)

`lsp-pi/lsp-core.ts` already has the **superior in-process hygiene** we measured:

+ `IDLE_TIMEOUT_MS = 60_000` (4× more aggressive than pi-lens's 240 s)
+ `CLEANUP_INTERVAL_MS = 30_000` reaper
+ `MAX_OPEN_FILES = 30` with **LRU eviction** (pi-lens has no file cap)
+ `unref()`'d timers → clean process exit
+ shutdown that nulls pointers *before* killing (race-safe)

We keep all of this. We only **externalize** it behind a TCP listener and add the
cross-process coordination layer.

### 3.3 What gets borrowed from serena-pool (the pattern)

| serena-pool mechanism | How lsp-pi-daemon adopts it |
| --- | --- |
| `hashToPort(root)` → `[40000, 45000)` | identical — disjoint range from serena-pool to avoid collision (e.g. `[45000, 46000)`) |
| `getProcessStartTime(pid)` via `/proc/<pid>/stat` field 22 (Linux) / `ps -o lstart=` | identical — pid reuse protection |
| `isSameProcess(pid, startTime)` | identical |
| `acquireLock(port, timeoutMs)` — `openSync(wx)` + owner-pid liveness check | identical |
| State file: `{ pid, pgid, startTime, port, spawnedAt }` | identical shape |
| Orphan reap: `findProcessesByPgid(pgid)` → SIGTERM → grace → SIGKILL | identical, **bounded to our pgid** (never touches editor/Serena/test LSPs) |
| Detached spawn: `detached: true` → own process group | identical |
| `waitForPort` polling | identical |

### 3.4 The one new piece: LSP-over-TCP framing

serena-pool transports MCP (JSON-RPC tool calls). lsp-pi-daemon must transport
**raw LSP** so pi-lens's jsonrpc reader can consume it. Standard LSP framing:

```
Content-Length: <n>\r\n\r\n<json-rpc payload>
```

This is exactly what stdio carries. A TCP socket carrying the same byte stream is
trivially bridgeable:

```ts
// adapter pseudo-code (Component B, runs inside pi-lens)
import { net } from 'node:net';
import { Duplex } from 'node:stream';

function lspSocketTransport(port: number) {
  const socket = net.connect(port, '127.0.0.1');
  const stream = Duplex.from(socket);
  // pi-lens's createMessageConnection(StreamMessageReader(stream),
  //   StreamMessageWriter(stream)) now treats this as a local LSP server.
  return { reader: new StreamMessageReader(stream),
           writer: new StreamMessageWriter(stream) };
}
```

pi-lens's `customServers` config (verified at `clients/lsp/config.js:117`) feeds
`getServersForFile`, so a custom entry pointing at the adapter makes pi-lens use
the daemon-backed connection instead of spawning.

---

## 4. Advantages

| # | Advantage | Quantification |
| --- | --- | --- |
| A1 | **N sessions → 1 language server per root** | RAM: N×300 MB → 300 MB for ts_ls. Index build: N× → 1× |
| A2 | **Warm cache shared across sessions/specialists** | First edit in session 2 is instant (no 25 s cold-start we measured) |
| A3 | **Orphan cleanup** (standalone win) | Removes the accumulating stale pyright/ts-ls processes verified in §1.2 |
| A4 | **Keeps our superior hygiene** | lsp-pi's LRU/idle-60s/reaper survive; pi-lens's weaker model is bypassed |
| A5 | **pi-lens gets automatic diagnostics from a shared server** | The §2 Barrier-2 problem is sidestepped: we own the LSP, diagnostics flow freely |
| A6 | **Serena unaffected** | Different port range; Serena pool and lsp-pi-pool coexist without collision |
| A7 | **Specialists benefit transparently** | Any tool that speaks LSP (Serena's internal LSP, pi-lens, future tools) can point at the daemon |

---

## 5. Concerns & risks

### 5.1 Correctness risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **Pid reuse** — recorded pid recycled to a different process | High if ignored | `startTime` verification (already in serena-pool pattern) — verified robust |
| **Stale lock** — holder crashed without releasing | Medium | owner-pid liveness check in `acquireLock` (already in pattern) |
| **Multi-root worktrees** — worktrees are *different roots* | Design question | Each worktree gets its own daemon (correct: tsc configs differ per worktree). Confirm `getRepoRoot` resolves worktree root, not shared common dir |
| **tsserver child processes** — ts-ls spawns tsserver workers | Medium | process-group kill covers them; verify no `setsid`-escaped grandchildren |

### 5.2 Operational risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **Daemon crashes mid-session** | High | pi-lens must fall back to its own spawn if the socket dies; implement reconnect-or-spawn |
| **Cold-start daemon not ready** | Medium | `waitForPort` polling (15 s budget, already in pattern); pi-lens already tolerates spawn latency |
| **Port range exhaustion** | Low | 1000 ports for ≤1000 concurrent repos — unrealistic limit; log + refuse if hit |
| **Resource leak if pi-lens never closes connection** | Medium | daemon idle-60s closes LSP clients; connection-drop handler in adapter |
| **Cross-machine confusion** (same hash, different host) | Low | daemon binds 127.0.0.1 only (no remote) — same as serena-pool |

### 5.3 Compatibility risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **pi-lens version skew** — custom LSP API changes | Medium | Pin pi-lens version; the custom-server surface is small and stable |
| **Serena also wants to use the pool** | Opportunity | Future: Serena could point its internal LSP at the daemon too — true unification (Via C) |
| **Specialists depend on Serena MCP tools, not raw LSP** | Non-issue | Specialists keep using Serena; they don't touch the daemon directly |

### 5.4 The honest non-starters

+ **No `get_diagnostics` over Serena MCP** (§2 Barrier 2) → dead-ends any Serena-bridge approach. Confirmed by source inspection.
+ **pi-lens has no "use external LSP" toggle beyond customServers** → we must use the custom-server path; there is no cleaner injection point.

---

## 6. Decision: when is this worth building?

### Build it (ROI positive) if ANY of

1. **Specialists run concurrently on the same repo root** (not just parallel worktrees). Today the evidence (worktree paths under `.xtrm/worktrees/`) suggests **separate roots** → low ROI. Confirm with `sp ps` over a real multi-specialist run.
2. **Orphaned LSP processes are a recurring annoyance** (the §1.2 accumulation). This alone justifies a lighter-weight "orphan reaper" even without the full pool.
3. **The 25 s cold-start on every new session is painful** enough to want a warm daemon.

### Do NOT build it if

+ Specialists are **strictly worktree-isolated** (separate roots) AND
+ The orphan leak is **tolerable** (manual `pkill` acceptable) AND
+ Cold-start is **absorbed** by session-init overhead.

In that case the status quo (pi-lens in-process + Serena-pool for specialists)
costs ~one extra ts_ls per same-root concurrent pair — likely acceptable.

---

## 7. Implementation phases (if we proceed)

### Phase 0 — Decide (prerequisite, cheap)

Monitor actual concurrent specialist topology (`sp ps`, process snapshots) to
answer §6 question 1. **This is the PID monitoring exercise in the same session
that produced this doc.**

### Phase 1 — Orphan reaper only (standalone win, low risk)

A small extension (or cron) that runs the serena-pool orphan-reap logic across
**all** orphaned LSP processes — pid+startTime+pgid bounded. Reclaims the
accumulated stale processes without any pool work. ~1 day.

### Phase 2 — lsp-pi-daemon core

Promote `lsp-core.ts`'s `LSPManager` behind a TCP listener with the
hash-port + lockfile + state-file + startTime machinery. Single-tenant first
(one consumer). ~3–5 days.

### Phase 3 — pi-lens custom-server adapter

Write the stdio↔TCP bridge; register as pi-lens custom LSP; validate that
diagnostics still flow (re-run the `"fifty-thousand"` type-error test against the
daemon-backed connection). ~2 days.

### Phase 4 — Multi-consumer + Serena unification (Via C)

Optional: point Serena's internal LSP at the same daemon. Highest value, highest
coordination cost. Defer until Phase 2–3 prove stable.

---

## 8. Open questions

1. **Does pi-lens's `customServers` support a connection-factory (function) or only static command/args?** If only static args, the TCP adapter must be a real spawned process (a thin `lsp-bridge.js` shim), not an in-process factory. Needs source check of `config.js:117` path.
2. **Does `getRepoRoot` for worktrees resolve to the worktree path or the shared `.git` common dir?** Determines whether each worktree gets its own daemon (correct) or they collide on one port.
3. **What is the real concurrent-specialist topology on this machine?** (Phase 0 question — answer before committing to Phase 2.)
4. **Does tsserver escape the process group** via any `setsid`/double-fork in its node launcher? Process-group kill assumes it does not. Verify by killing a ts-ls and checking for orphaned tsserver grandchildren.

---

## 9. Verification plan (how we'd prove it works)

1. **Orphan-reap test**: start 3 ts_ls, kill their parent pi, run reaper, confirm 0 survivors.
2. **Single-consumer test**: pi-lens with custom-server pointing at daemon; trigger the `number = "string"` type error; confirm `2322` still surfaces (diagnostics flow over TCP).
3. **Concurrency test**: 2 pi sessions same root; confirm 1 ts_ls in `ps`, not 2.
4. **Crash test**: `kill -9` the daemon mid-edit; confirm pi-lens falls back to own spawn and session continues.
5. **Cold-start test**: second session on warm daemon → first edit < 1 s (vs the 25 s baseline).
