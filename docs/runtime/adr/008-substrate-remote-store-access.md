# ADR-008 — One authoritative Substrate store, reached from a second machine

> Status: PROPOSED (gate decision pending) · Date: 2026-11-02 · Issue: **XTRM-685** rev 2
> Scope: how every Substrate consumer reaches the one `~/.xtrm/state.db` when the operator works on a PC and the store lives on the server.
> Evidence: `packages/substrate/cli/sb.ts`, `packages/substrate/src/store/{sqlite,database}.ts`, `packages/substrate/hooks/*.ts`, `packages/substrate/integrations/claude-code/{runtime,mcp-server}.ts`, `packages/substrate/integrations/pi/handlers.ts`, `packages/substrate/plugin/substrate/{.mcp.json,scripts/*.mjs}`, specialists `src/substrate/services.ts`, `src/activation/workitem-store.ts`, `src/activation/authority-store.ts`; measured SSH costs on 2026-11-02 (below).

## Context

There is exactly one authoritative store: the server's `~/.xtrm/state.db` (223 MB + 3 MB WAL on 2026-11-02). The PC has `sb` 0.2.2 from npm and a stale local store with **0 issues** (290 KB, 2026-10-31). The live symptom is `issue_get SPECIALISTS-4393` → `unresolvable ref` from the PC plugin, and no native specialist dispatch on the PC can claim server work.

The forwarding problem is larger than the CLI. Five consumers exist, and three of them open the SQLite file directly, never through `sb`:

| # | Consumer | Entry point | How it reaches the store today |
|---|---|---|---|
| 1 | `sb` CLI | `cli/sb.ts:968 runCli` → `openSubstrate(ctx.dbPath)` at `cli/sb.ts:988` | opens the file named by `--db`, `SUBSTRATE_DB`, else `~/.xtrm/state.db` |
| 2 | Git hooks | `hooks/post-commit.ts:84`, `hooks/prepare-commit-msg.ts:34`, `hooks/post-rewrite.ts:33` | each imports `openSubstrate` and opens the file directly |
| 3 | Claude Code plugin | tools: `integrations/claude-code/mcp-server.ts` (`openHandles()` per tool call, `integrations/claude-code/runtime.ts:26`); hooks: `plugin/substrate/scripts/{session-start,precompact,postcompact,stop-gate,edit-gate}.mjs` via `resolve-substrate.mjs` | MCP tool handlers and hook scripts construct the typed services against the local file |
| 4 | Pi extension | `integrations/pi/handlers.ts` → `openServices(dbPath)` → `openSubstrate` | in-process typed services against the local file |
| 5 | Specialists native dispatch | `src/substrate/services.ts` (dynamic `require('@jaggerxtrm/substrate')`, `open(resolveAuthorityDbPath())`); activation authority in `src/activation/workitem-store.ts` (`openSubstrateDb`) and `src/activation/authority-store.ts` (raw `bun:sqlite`/`node:sqlite`) | opens the same file directly, twice, through two different openers |

Forwarding only the CLI therefore leaves consumers 3, 4 and 5 unresolved. The ADR must decide one transport for all five.

### Measured transport costs (2026-11-02, PC → `server`)

| Path | Wall time |
|---|---|
| `ssh server true` cold | 0.43–0.53 s |
| `ssh server true` with ControlMaster/ControlPersist warm | 0.05–0.06 s |
| warm ssh + absolute `sb --version` | 0.13–0.18 s |
| `ssh server 'zsh -lic "sb --version"'` (cold login shell) | 1.05–1.40 s |
| `ssh server 'command -v sb'` (non-interactive shell) | empty — `sb` is not on the non-interactive PATH |
| resolved server `sb` | `/home/dawid/.nvm/versions/node/v24.15.0/bin/sb`, version 0.2.2 (repo package 0.2.3) |

Two facts matter: a login shell is required only to *discover* `sb`, never to *run* it; and with connection multiplexing a forwarded call costs about a tenth of a second.

## Options

Required comparison, from the Issue contract. "Covers" counts consumers 1–5.

| Option | Covers | Listener / daemon | Per-call cost | Principal failure mode | Change size |
|---|---|---|---|---|---|
| **A. Per-call `ssh` forwarding** of `sb` argv | 1, 2 | none | 0.13–0.18 s warm; 0.5 s cold | argv re-quoting; login-shell noise; local-file arguments | small, one transport module |
| **B. Plugin MCP server on the server over ssh stdio** | 3 | none (ssh stdio) | one persistent connection | version skew between plugin copy and server package | config only, plus a version handshake |
| **C. Store service behind an ssh tunnel** (loopback listener + `ssh -L`) | 1–5 (via one client library) | **yes**: a resident service on the server, a forwarded port on every client | RTT per call after one connection | service lifecycle (start/restart/watchdog/reconnect), port configuration per machine, silent staleness when the tunnel drops | large: new daemon, wire protocol, client in every consumer |
| **D. Run native specialist dispatch on the server** | 5 | none | n/a (dispatch is local to the store) | the agent's workspace becomes server-side while the operator edits on the PC; server worktrees diverge from PC working copies | small in code, large in operating model |

A and B each solve a subset. C solves everything through one abstraction at the price of a resident process and a forwarded port. D avoids a transport but relocates the work.

## Decision (recommended for the gate)

**Use `ssh` process execution as the single transport, with two protocols on it and no listener and no daemon.**

1. **CLI and hooks — argv forwarding (Stage 2, contracted).** `substrate.remote = "ssh:<host>"` makes a plain `sb` invocation run the *remote* `sb` with the same argv, stdin, stdout, stderr and exit code. Hooks stop opening the file themselves and call the same transport. The remote needs no new Substrate code: it runs whatever `sb` it already has.
2. **In-process consumers — one JSON-RPC stdio service (`sb serve --stdio`) launched over `ssh`, one connection per client process.** Pi handlers, the Claude hook scripts and the specialists service ports call typed operations over that connection instead of `openSubstrate`. This reuses the specialists' existing structural ports (`IssueServicePort`, `IssueStorePort` in `src/activation/workitem-store.ts`) rather than changing dispatch semantics: the remote client implements the same interfaces.
3. **Claude tools — the existing MCP server, executed on the server over `ssh` stdio** (`plugin/substrate/.mcp.json` points at an `ssh` command instead of a local `node`). Its tool handlers then construct services against the authoritative file on the host that owns it. This is option B, used as one adapter over the same transport, not as the answer to the whole problem.

Rejected as the primary transport, with reasons:

- **C (tunnel + resident service)** adds a lifecycle surface (start/restart/watchdog/version handshake) and a per-machine port forward to a single-operator, two-machine system, and buys nothing that `ssh` stdio does not already provide. Revisit if push/subscription (live feeds into a client that is not issuing calls) or multi-client fan-out becomes a requirement.
- **D (dispatch on the server)** moves the agent's workspace away from the machine the operator edits on. Worktrees would be created and modified on the server while the PC holds the working copies, reintroducing the divergence this Issue exists to remove. It remains a legitimate *operating mode* for a fully server-side session; it is not the transport decision.
- **B alone** solves the Claude tool surface and leaves CLI, hooks, Pi and specialists untouched.

### Consequences

- One transport module in `packages/substrate/src/remote/` owns host resolution, safe argv encoding, the environment allowlist, path mapping, error rendering and latency reporting. All call sites share it, so a quoting or mapping defect has one place to live and one place to fix.
- The PC's stale local store must never be opened in remote mode. Remote mode dispatches before `openSubstrate` and before the db-path default is resolved; an explicit `--db` or `SUBSTRATE_DB` forces local mode.
- Version skew is explicit: the *client* is the newer `sb`, the server may be older. `sb doctor` reports both versions and warns on mismatch; unknown flags fail verbatim from the remote.
- Option C is not foreclosed: the JSON-RPC surface is defined transport-neutrally, so a future tunneled daemon can serve the same protocol without touching consumers.

## Correctness constraints the transport must preserve

These are requirements, not suggestions; each one maps to a validation check in XTRM-685.

### argv encoding
`ssh` joins its arguments into one remote shell string. Every forwarded argument must be encoded by one POSIX single-quote encoder (`'` → `'\''`), never by concatenation. One argument in, one argument out, byte-identical, for: empty strings, spaces, single and double quotes, newlines, backslashes, `$`, backticks, glob characters, and JSON payloads. stdin is forwarded as a byte stream, not re-encoded.

### Resolving the remote `sb`
Non-interactive `ssh` does not find `sb` (verified empty for `command -v sb`; `sb` lives under nvm/fnm on a login-shell PATH). Steady state must not pay 1.05–1.40 s for a login shell:

- `sb remote setup ssh:<host>` resolves the absolute path once and stores it in the client config.
- Fallback resolution runs `zsh -lic 'command -v sb'`, accepts the result only if it is a single absolute path (any other stdout is discarded as rc noise), and caches it.
- Every forwarded invocation runs the absolute path in a plain `sh -c`; no login shell, no banner on stdout.

### Environment
`ssh` does not forward the environment and server `AcceptEnv` cannot be assumed. An explicit allowlist is passed as a quoted `env NAME=VALUE` prefix:

`SUBSTRATE_HOLDER`, `SUBSTRATE_ISSUE_REF`, `SUBSTRATE_ISSUE`, `SUBSTRATE_ACTIVATION_ID`, `XTRM_SESSION_ID`, `XTRM_SESSION_NAME`, `SUBSTRATE_PROJECT`, `LANG`, `TZ`.

`SUBSTRATE_DB` is never forwarded: when it is set, the invocation is local by definition. A Journal append executed through the transport must record `SUBSTRATE_HOLDER` as its participant, which is how worker identity survives the hop.

### Path mapping (cwd, workspaces, files)
- The client resolves its `repositoryKey` from the Git origin URL (`src/domain/repository-discovery.ts`, `deriveRepositoryIdentity`), which is identical on both machines for the same repository.
- The server resolves that key against the store's `repository_bindings` and `checkout_links` rows to a **server** checkout root, then applies the client's repository-relative subdirectory. Worktrees map to their repository, not to their own toplevel.
- No mapping → fail closed, naming the remote host and the remedy (`sb project link` on the server). Never fall back to a bash-identical path guess.
- `--project` is portable and passes through unchanged.
- **Workspace identity stays the client path.** Journal entries and execution bindings record the worktree the operator edits in (`journal-service.ts:471`, `execution-binding.ts:26`), not the server cwd the process happens to run in. The transport sends the client workspace explicitly; the server-side process must not substitute its own.

### Local-file arguments
`--contract <file>` names a PC path. Two acceptable outcomes: stream the file to a remote temp path and rewrite the argument, or fail closed with a message that names the flag and the file. Silent reading of a different server file is a defect. `--file` in the write direction (e.g. `export --file`) is not supported in Stage 2: fail closed and name the follow-up.

### stdout
Machine-clean. `--json` output is byte-identical to the same invocation run locally on the server; no shell banner, no progress line, no rewritten payload. Transport metadata appears only in `sb doctor`.

### Offline
Unreachable host → non-zero exit, message naming the remote (`substrate.remote=ssh:server: cannot reach server`), **no local `state.db` created**, never a silent fallback to an empty local store.

### Claims across hosts
Every write executes on the server host, so SQLite WAL, `PRAGMA busy_timeout = 5000`, `synchronous = FULL` and `BEGIN IMMEDIATE` serialization behave exactly as they do for a local caller (`src/store/sqlite.ts`). Claims carry `holder`, `expiresAt` and `activationId` and no pid or host field (`src/domain/claim.ts`), so cross-host claims need no schema change. A PC session that dies leaves its claim live until the TTL (`DEFAULT_CLAIM_TTL_MS = 15 * 60 * 1000`, `src/domain/claim.ts:47`); this is unchanged behaviour and is accepted. No network filesystem is ever placed under SQLite.

### Hook latency
With ControlMaster/ControlPersist configured, a forwarded hook call costs 0.13–0.18 s (measured). Without it, 0.5 s cold. Requirements: `sb remote setup` configures multiplexing on the client, and `sb doctor` reports whether the master is live together with the round-trip time. Hooks must stay best-effort in the sense they already are: a transport failure is reported, never turned into a blocked commit.

### Configuration
Client-side only, under `~/.xtrm/config/`:

```json
{ "remote": "ssh:server", "remoteSb": "/home/dawid/.nvm/versions/node/v24.15.0/bin/sb" }
```

`SUBSTRATE_REMOTE` overrides it for tests and one-off runs. Absent the setting, `sb` runs locally exactly as today.

## Stage 2 shape (the PR)

`packages/substrate/src/remote/`: config read, host/version resolution, encoder, executor (argv + stdin + streams + exit code), repository-key → server-cwd mapping, error model, `doctor` transport report. `cli/sb.ts` dispatches at the top of `runCli` before `ctx.dbPath` is resolved and before `openSubstrate`. Hooks (`hooks/*.ts`) route through the same executor. Tests use a fake transport (no network): byte-identical argv round-trip, exit-code and stdin passthrough, stdout equality against a local `--json` run, cwd mapping by origin URL, missing mapping error, `--contract` behaviour, offline error with no store created.

## Consumers not solved by Stage 2 → follow-up Issues

| Consumer | Follow-up | Owner |
|---|---|---|
| Pi extension (`integrations/pi/handlers.ts`) | remote client for the typed services; handlers keep their current domain logic | `packages/substrate` (this repo) |
| Claude plugin hooks (SessionStart, PreCompact, PostCompact, stop-gate, edit-gate) + MCP server execution | hooks use the JSON-RPC client; `.mcp.json` points at the server-side MCP server with a version handshake | `packages/substrate` + plugin config |
| Specialists native dispatch, activation authority (`src/activation/workitem-store.ts`, `src/activation/authority-store.ts`) | remote implementations of `IssueServicePort`/`IssueStorePort`; structured activation/authority operations instead of raw SQLite over the wire | `specialists` repo |
| PC stale local store (`~/.xtrm/state.db`, 0 issues) | archive it with a marker and add a remote-mode guard so no consumer can silently open it | `packages/substrate` |

## Open questions for the operator (the gate)

1. **Transport:** accept the recommended `ssh`-exec design (no listener, no daemon), or prefer the tunneled store service (option C) because a resident service is wanted for a later multi-machine/multi-user tier?
2. **Claude plugin placement:** may its MCP server run from the server checkout (version-pinned, tools follow the server package), or must the PC keep its own copy and act as a client of the JSON-RPC service?
3. **Server-side dispatch:** is running specialist sessions on the server ever intended for this workflow? If yes, it is an operating mode to document, not a transport.

## Status

No implementation has started. Stage 2 begins only after the coordinator relays the operator's transport decision.
