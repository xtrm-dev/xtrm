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

## Decision (accepted 2026-11-02)

**Use `ssh` process execution as the single transport, with two protocols on it and no listener and no daemon.**

The operator accepted this decision on 2026-11-02. Stage 2 (item 1 below) is
implementation, not a proposal. Items 2 and 3 remain open and are follow-up
scope; neither is a precondition for Stage 2.

1. **CLI and hooks — argv forwarding (Stage 2, contracted).** `substrate.remote = "ssh:<host>"` makes a plain `sb` invocation run the *remote* `sb` with the same argv, stdin, stdout, stderr and exit code. Hooks stop opening the file themselves and call the same transport. **The remote needs no new Substrate code to serve CLI work** — it runs whatever `sb` it already has (measured against server `sb 0.2.2`) — **but two behaviours do need a newer server** (see “What server 0.2.2 cannot do” below). The client therefore resolves the project and the path mapping itself and passes `--project`; a capability the older server lacks is reported by `sb doctor`, never assumed and never worked around by a server upgrade.
2. **In-process consumers — one JSON-RPC stdio service (`sb serve --stdio`) launched over `ssh`, one connection per client process.** Pi handlers, the Claude hook scripts and the specialists service ports call typed operations over that connection instead of `openSubstrate`. This reuses the specialists' existing structural ports (`IssueServicePort`, `IssueStorePort` in `src/activation/workitem-store.ts`) rather than changing dispatch semantics: the remote client implements the same interfaces. This verb does not exist yet on either side; it is the follow-up that carries the largest share of the remaining work (see “Stage 2 does not unblock native dispatch”).
3. **Claude tools — the existing MCP server, executed on the server over `ssh` stdio.** Its tool handlers then construct services against the authoritative file on the host that owns it. This is option B, used as one adapter over the same transport, not as the answer to the whole problem.

   **The `ssh` command does not belong in `plugin/substrate/.mcp.json`.** That file is shared with the server checkout (the plugin is consumed on both machines), so an `ssh` command written there would turn a local session into a remote one by accident, and it would hard-code a host into a distributed artifact. The Stage 2 follow-up is a *launcher* that reads `substrate.remote` and chooses: local `node` when the setting is absent, `ssh <host> <server node> <server script>` when it is present. Placement of that launcher is decision 2; the transport is not.

Rejected as the primary transport, with reasons:

- **C (tunnel + resident service)** adds a lifecycle surface (start/restart/watchdog/version handshake) and a per-machine port forward to a single-operator, two-machine system, and buys nothing that `ssh` stdio does not already provide. Revisit if push/subscription (live feeds into a client that is not issuing calls) or multi-client fan-out becomes a requirement.
- **D (dispatch on the server)** moves the agent's workspace away from the machine the operator edits on. Worktrees would be created and modified on the server while the PC holds the working copies, reintroducing the divergence this Issue exists to remove. It remains a legitimate *operating mode* for a fully server-side session; it is not the transport decision.
- **B alone** solves the Claude tool surface and leaves CLI, hooks, Pi and specialists untouched.

### Consequences

- One transport module in `packages/substrate/src/remote/` owns host resolution, safe argv encoding, the environment allowlist, path mapping, error rendering and latency reporting. All call sites share it, so a quoting or mapping defect has one place to live and one place to fix.
- The PC's stale local store must never be opened in remote mode. Remote mode dispatches before `openSubstrate` and before the db-path default is resolved; an explicit `--db` or `SUBSTRATE_DB` forces local mode.
- Version skew is explicit: the *client* is the newer `sb`, the server may be older. `sb doctor` reports both versions and warns on mismatch; unknown flags fail verbatim from the remote.
- Option C is not foreclosed: the JSON-RPC surface is defined transport-neutrally, so a future tunneled daemon can serve the same protocol without touching consumers.

### What server 0.2.2 cannot do (verified 2026-11-02)

Measured against the live server (`ssh server`, `zsh -lic 'command -v sb'` → `/home/dawid/.nvm/versions/node/v24.15.0/bin/sb`, `sb 0.2.2`), not inferred from the repository. An earlier revision of this table claimed 0.2.2 has no `SUBSTRATE_HOLDER`; that was wrong, and a forwarded probe disproved it (row 1).

| Capability | 0.2.2 | 0.2.3 (this repo) |
|---|---|---|
| `SUBSTRATE_HOLDER` → recorded `participantId` | read as ambient identity (`dist/src/domain/execution-context.js`, `currentExecutionContext` → `ambientIdentityFallback`); **a forwarded write preserves the participant** (verified through the transport, not the shell: `sb issue note XTRM-685` recorded journal seq 9 and `sb journal append XTRM-685 --mechanical <file>` seq 10, both with `participantId: core-xt-pi-6vnw`; a throwaway probe issue recorded the same holder on its claim, note, append and close) | same, plus explicit `--participant` |
| `journal append --participant` | rejected (`unknown flag --participant`) | accepted |
| `journal checkpoint --workspace` | accepted | accepted |
| `provenance dispatch --participant --workspace` | accepted | accepted |
| `provenance bind <receipt> <sha>` | accepted | accepted |
| rewrite reconciliation verb (`reconcileRewrite`) | none | none (hook-internal only) |

Consequences that Stage 2 must state rather than hide:

1. **Participant identity survives a forwarded write.** The executor forwards `SUBSTRATE_HOLDER` in the environment and a 0.2.2 server reads it as the ambient identity, so a forwarded `issue note` / `journal append` records the holder as `participantId`. What 0.2.2 lacks is the explicit `--participant` *flag* on `journal append`; a caller that passes the flag gets `unknown flag` from the server, which is the correct fail-closed answer. The transport defect this exposed — a `--participant` value that cannot be expressed on the server must not be silently dropped — is why the capability is reported per server version in `sb doctor`.
2. **Post-rewrite cannot be forwarded.** `sb 0.2.2` exposes no CLI verb for `reconcileRewrite`, so the remote `post-rewrite` adapter reports the unreconciled pairs on stderr and leaves the bindings alone. Claiming success would record a reconciliation that never happened.
3. **The typed stdio service is not shipped on either side.** In-process consumers (Pi handlers, Claude hook scripts, specialists ports) keep their local behaviour until that follow-up lands.

### Stage 2 does not unblock native dispatch

Stage 2 gives the PC a correct CLI and hook path to the server-owned store. It does **not** unblock native specialist dispatch: dispatch runs inside the specialists service, which reaches the store through `IssueServicePort`/`IssueStorePort` rather than through `sb` argv, so it needs the typed stdio service (item 2). That follow-up — a structured store operation surface plus the specialists client — is the largest remaining piece of the remote-store work, and Stage 2 neither implements it nor shortens it. Reporting Stage 2 as “remote is done” would misstate the remaining work by that whole piece.

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

`SUBSTRATE_DB` is never forwarded, because an explicit local store makes the invocation local by definition.

### An explicit local store outranks remote everywhere
`--db <path>`, `--db=<path>` and `SUBSTRATE_DB` each select the local store for every consumer in the process: the CLI, the three git hooks, `sb doctor`, and embedded callers that pass their own `dbPath`. A hook with `SUBSTRATE_DB` set writes to that database and never opens an ssh connection — the failure this rule closes is the opposite one, where a hook inherited a remote setting and bound a commit on the server while the caller had named a local store. `sb doctor` reports which store was chosen and why (`note: SUBSTRATE_DB=… selects the local store`), and an unreadable remote configuration is reported as an error instead of silently degrading to local mode. A Journal write executed through the transport records `SUBSTRATE_HOLDER` as its participant, which is how worker identity survives the hop.

### Path mapping (cwd, workspaces, files)
- The client resolves its `repositoryKey` from the Git origin URL (`src/domain/repository-discovery.ts`, `deriveRepositoryIdentity`), which is identical on both machines for the same repository.
- **The server does not resolve that key from its store, and Stage 2 does not need it to.** Verified on `sb 0.2.2`: `sb project links --json` returns server `.git` roots only (no repository key) and `sb doctor --json` returns `repository.repositoryKey` for the directory it runs in. So the client probes each candidate server root with `sb doctor --json` and compares keys. `sb project show --json` additionally exposes `bindings[].repositoryKey` when the mapping must be cross-checked.
- Worktrees map to their repository, not to their own toplevel: the client sends the client's repository-relative subdirectory, resolved against the mapped server root.
- No mapping, or more than one match → fail closed, naming the remote host and the remedy (`--server-root` for an ambiguous case, `sb remote setup` after cloning there). Never fall back to a bash-identical path guess.
- `--project` is portable and passes through; when the caller did not pass it, the client injects the project it already resolved from the mapping.
- **Workspace identity stays the client path** where the server can record it. Journal entries and execution bindings record the worktree the operator edits in (`journal-service.ts:471`, `execution-binding.ts:26`). On `sb 0.2.2` only `provenance dispatch` and `journal checkpoint` accept the explicit `--workspace` flag; `journal append` does not, so an append issued through the transport records the ambient holder but no explicit workspace. The rule is unchanged, the coverage is partial, and `sb doctor` states which case applies.

### Local-file arguments
A document argument (`--contract`, `--mechanical`, `--semantic`, `--result`, `--refs`, `--ownership`, `--context-refs`, `journal checkpoint` documents, `issue note --file`, `plan check|apply --file`, `import --file`/`--edges-file`) may name a PC file or carry inline JSON. Only the flags the forwarded command actually reads are treated as documents, so a text token such as `sb issue note X "--file=…"` cannot upload a local file into the Journal. Both forms travel as one framed stream on stdin (`@@sb-remote-file <name>` / `@@sb-remote-end` delimiters, decoded into a temp directory the command's shell owns), never as argv bytes and never as base64 in the command line — a base64 argument is still readable in `/proc/<pid>/cmdline`, so framing is what keeps a document out of a process list. A path must be a regular file (a symlink is refused), must be under a size cap, and may not live under a secrets or kernel directory (`~/.ssh`, `~/.secrets`, `~/.gnupg`, `/proc`, `/sys`, `/dev`). The argument is rewritten to the temp path; a value that is neither an existing local file nor parseable inline JSON fails closed, naming the flag and the value, because silently reading a same-named file on the server is a defect. An argument naming stdin (`--file -`) forwards the client's stdin.

`--file` in the **write** direction is the opposite case: `sb export project --file <path>` writes on the machine the command runs on, so the transport refuses it rather than leaving the operator with an exit code and no file. Downloading the export is a follow-up; refusing is the Stage 2 answer.

### stdout
Machine-clean. `--json` output is byte-identical to the same invocation run locally on the server; no shell banner, no progress line, no rewritten payload. Transport metadata appears only in `sb doctor`.

### Offline
Unreachable host → non-zero exit, message naming the remote (`substrate.remote=ssh:server: cannot reach server`), **no local `state.db` created**, never a silent fallback to an empty local store.

### Claims across hosts
Every write executes on the server host, so SQLite WAL, `PRAGMA busy_timeout = 5000`, `synchronous = FULL` and `BEGIN IMMEDIATE` serialization behave exactly as they do for a local caller (`src/store/sqlite.ts`). Claims carry `holder`, `expiresAt` and `activationId` and no pid or host field (`src/domain/claim.ts`), so cross-host claims need no schema change. A PC session that dies leaves its claim live until the TTL (`DEFAULT_CLAIM_TTL_MS = 15 * 60 * 1000`, `src/domain/claim.ts:47`); this is unchanged behaviour and is accepted. No network filesystem is ever placed under SQLite.

### Hook latency
With ControlMaster/ControlPersist configured, a forwarded hook call costs 0.13–0.18 s (measured). Without it, 0.5 s cold. Stage 2 does **not** write ssh configuration: `sb remote setup` measures and reports the round trip, and `sb doctor` shows it; configuring multiplexing stays an operator action (a client-side ssh config decision, not a Substrate decision), and automating it is follow-up scope. Hooks stay best-effort: a transport failure is reported on stderr and git proceeds — a down network is weather, not corrupt state, so it must not block a commit.

### Configuration
Client-side only: `~/.xtrm/config/substrate.json` (`SUBSTRATE_REMOTE_CONFIG`
overrides the path). Written by `sb remote setup`, read on every invocation;
a malformed file fails closed rather than degrading to local mode.

```json
{
  "remote": "ssh:server",
  "remoteSb": "/home/dawid/.nvm/versions/node/v24.15.0/bin/sb",
  "serverVersion": "0.2.2",
  "checkouts": {
    "github.com/xtrm-dev/xtrm": { "root": "/home/dawid/dev/xtrm", "projectId": "prj_xtrm", "verifiedAt": 1762100000000 }
  }
}
```

`SUBSTRATE_REMOTE` overrides the host for tests and one-off runs. Absent the
setting, `sb` runs locally exactly as today.

### Every setting works both ways (operator rule, 2026-11-02)

A local-only user with no server must get today's behaviour, with no ssh
requirement. Remote mode is therefore opt-in, per client, and reversible:

- **Unset means fully local.** No `remote` key in the client config and no
  `SUBSTRATE_REMOTE` in the environment means every consumer runs locally: the
  CLI, the git hooks, the Pi extension, the Claude plugin hooks, and the
  launcher that starts the Claude MCP server. None of them may require ssh, or
  probe for a server, when the setting is absent. The preference is local
  first: a machine without a server configured behaves exactly as it does
  today.
- **Both ways, not one way.** `sb remote setup ssh:<host>` turns it on;
  `sb remote disable` turns it off and drops the server `sb` path, version and
  checkout cache, because those facts belonged to a server that is no longer
  configured. Nothing on the server is touched: its store stays complete and
  available to the next client that configures it, and no server state records
  which clients point at it.
- **Precedence, stated in the output.** The environment outranks the file, so
  `disable` reports an active `SUBSTRATE_REMOTE` instead of claiming a mode the
  next invocation will not use.
- **No hidden state.** The setting lives in one client-side file that a user
  can read and delete; deleting it is equivalent to `disable`. There is no
  server-side flag, no user-level default, and no consumer that infers remote
  mode from anything other than this setting.

`sb remote status` is the way to see which of the two modes is in effect
before assuming either.

## Stage 2 shape (the PR)

`packages/substrate/src/remote/`: config read, host/version resolution, encoder, executor (argv + stdin + streams + exit code), repository-key → server-cwd mapping, error model, `doctor` transport report. `cli/sb.ts` dispatches at the top of `runCli` before `ctx.dbPath` is resolved and before `openSubstrate`. Hooks (`hooks/*.ts`) route through the same executor. Tests use a fake transport (no network): byte-identical argv round-trip, exit-code and stdin passthrough, stdout equality against a local `--json` run, cwd mapping by origin URL, missing mapping error, `--contract` behaviour, offline error with no store created.

## Consumers not solved by Stage 2 → follow-up Issues

| Consumer | Follow-up | Owner |
|---|---|---|
| Pi extension (`integrations/pi/handlers.ts`) | remote client for the typed services; handlers keep their current domain logic | `packages/substrate` (this repo) |
| Claude plugin hooks (SessionStart, PreCompact, PostCompact, stop-gate, edit-gate) + MCP server execution | hooks use the JSON-RPC client; `.mcp.json` points at the server-side MCP server with a version handshake. The launcher must read `substrate.remote` and start nothing remote when it is unset (two-way rule above) | `packages/substrate` + plugin config |
| Specialists native dispatch, activation authority (`src/activation/workitem-store.ts`, `src/activation/authority-store.ts`) | remote implementations of `IssueServicePort`/`IssueStorePort`; structured activation/authority operations instead of raw SQLite over the wire | `specialists` repo |
| PC stale local store (`~/.xtrm/state.db`, 0 issues) | archive it with a marker and add a remote-mode guard so no consumer can silently open it | `packages/substrate` |

## Open questions for the operator (the gate)

1. **Transport:** accept the recommended `ssh`-exec design (no listener, no daemon), or prefer the tunneled store service (option C) because a resident service is wanted for a later multi-machine/multi-user tier? — **Answered 2026-11-02: accept `ssh`-exec, no listener, no daemon.**
2. **Claude plugin placement:** may its MCP server run from the server checkout (version-pinned, tools follow the server package), or must the PC keep its own copy and act as a client of the JSON-RPC service? — **Open; affects the follow-up launcher only.**
3. **Server-side dispatch:** is running specialist sessions on the server ever intended for this workflow? If yes, it is an operating mode to document, not a transport. — **Open; affects the follow-up only, not Stage 2.**

## Latency budget for hooks

A hook gets one deadline for the whole invocation (session, mapping and write), not one per call: per-call bounds were not a bound, and a cold session plus three calls held a commit for 24 s. A hook also never discovers candidate checkouts — it uses the mapping `sb remote setup` verified, and reports a miss instead of walking the list. Hooks are not installed anywhere yet; these rules are latent until CORE-2570 ships the installers.

## Status

Stage 1 (this decision, accepted 2026-11-02) is recorded. Stage 2 is implemented
on branch `xt/XTRM-685-sb-remote`: `packages/substrate/src/remote/` (spec,
config, ssh, session, executor, setup, doctor, render), the `remote` CLI group
(`sb remote setup`, `sb remote status`, `sb remote disable`), forwarding inside
`runCli` before the local store opens, and the three git hooks routed through
the transport with their local bodies preserved. Validation lives in
`packages/substrate/tests/remote-transport.test.ts` (fake transport, no
network). Remaining consumers are listed above and are follow-up Issues, not
gaps in Stage 2.
