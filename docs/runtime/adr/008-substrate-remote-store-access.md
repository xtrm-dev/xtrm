# ADR-008 — One authoritative Substrate store, reached from a second machine

> Status: Stage 1 ACCEPTED 2026-11-02 · Stage 2 merged (`2d33ec76`) · Stage 3 proposed in **XTRM-690**
> Date: 2026-11-02 · Issues: **XTRM-685** rev 2 (Stages 1–2), **XTRM-690** (Stage 3)
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
3. **The typed stdio service now exists, but only where it is installed.** XTRM-690 ships `sb serve --stdio` in `packages/substrate` (protocol 1). It cannot help a server still on 0.2.2: the command must exist on the machine that owns the store, so that machine's `sb` has to reach a release carrying it. In-process consumers (Pi handlers, Claude hook scripts, specialists ports) keep their local behaviour until then, and `sb doctor` reports the service as unavailable by version rather than assuming it.

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
A document argument (`--contract`, `--mechanical`, `--semantic`, `--result`, `--refs`, `--ownership`, `--context-refs`, `journal checkpoint` documents, `issue link pr --commit-evidence`, `issue note --file`, `journal append --summary-file`, `plan check|apply --file`, `import --file`/`--edges-file`) may name a PC file or carry inline JSON. `--summary-file` is a plain text file with no inline form: its value must be a file on the client, and `-` forwards the client's stdin (XTRM-751). Only the flags the forwarded command actually reads are treated as documents, so a text token such as `sb issue note X "--file=…"` cannot upload a local file into the Journal. Both forms travel as one framed stream on stdin (`@@sb-remote-file <name>` / `@@sb-remote-end` delimiters, decoded into a temp directory the command's shell owns), never as argv bytes and never as base64 in the command line — a base64 argument is still readable in `/proc/<pid>/cmdline`, so framing is what keeps a document out of a process list. A path must be a regular file (a symlink is refused, and so is a second hard link, because a link to a key passes every path check), must be under a size cap, and may not live under a secrets or kernel directory (`~/.ssh`, `~/.secrets`, `~/.gnupg`, `~/.aws`, `~/.docker`, `~/.kube`, `~/.config/gh`, `~/.netrc`, `~/.npmrc`, `/proc`, `/sys`, `/dev`). Those roots are resolved at check time, so a symlinked `$HOME` cannot bypass them. The hard-link refusal has a usability cost worth recording: a document kept as a link (a dotfile manager, a shared checkout, a `~/notes` hard-linked into a repository) is refused, and the operator must copy it to a single-link path before forwarding it. That is accepted because the alternative — following the link — would upload an arbitrary target that no path check can see.

**The list is a guard against accidents, not a security boundary:** it closes the forms a person hits by mistake (a key path, a link, a credentials file) and cannot promise anything against an adversary who controls the filesystem the client reads. The argument is rewritten to the temp path; a value that is neither an existing local file nor parseable inline JSON fails closed, naming the flag and the value, because silently reading a same-named file on the server is a defect. An argument naming stdin (`--file -`) forwards the client's stdin.

`issue link pr --commit-evidence` is the case where the document is not the
operator's input but the client's own answer to a question the server cannot
answer (CORE-2787): T2 evidence is `git log <range>` in the running repository,
and in remote mode that repository is the server's checkout, where a PR pushed
from this machine seconds ago does not exist yet. The forwarder reads the range
in the client's repository, uploads `[{sha, message}]` as this document, and the
server reads it instead of git; when the caller already passed the flag, its
value is the document. A server that predates the flag rejects it with `unknown
flag`, and the forwarder retries once with the original argv, so an old server
degrades to the old behaviour rather than failing the link.

Two properties of the stream itself are enforced, because a truncated document decodes cleanly and would land in the shared store as if it were complete: the end marker is mandatory (a stream that stops early exits non-zero and the command never runs), and every document carries its byte count, checked against the decoded file. The unpacking shell is written for the server's login shell (`zsh` on the reference server): no `*.b64` glob, which zsh treats as a fatal error when nothing matches, and an explicit `EXIT` trap so a temp directory is removed on every failure path.

Two further refusals belong to the same class. A repository authority may not smuggle a host past the key: a query, fragment, backslash or control character in a URL authority is refused, and in scp form a `:` inside the user part means the first token is the real host, so `evil.com:path@github.com:acme/app` is not folded into `github.com/acme/app`. `sb remote setup` warns when the raw origin host and the key host differ. And a host selected by `SUBSTRATE_REMOTE` for one invocation never borrows the `remoteSb` or `serverVersion` recorded for a different host in the config file, nor persists itself there.

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
| Specialists native dispatch (work-item ports) | **landed**: `src/activation/workitem-store.ts` selects the store and reaches it through `SubstrateService`; the wire properties are recorded below | `specialists` repo |
| Specialists activation authority (`src/activation/authority-store.ts`) | structured `authority.*` operations instead of raw SQLite over the wire; the consumer switch is the authority part of SPECIALISTS-4395 | `specialists` repo |
| PC stale local store (`~/.xtrm/state.db`, 0 issues) | archive it with a marker and add a remote-mode guard so no consumer can silently open it | `packages/substrate` |

## Consumer landing: specialists work-item ports (SPECIALISTS-4398)

With `substrate.remote` configured, `openWorkItemBoundary` decides the store before
it opens anything and builds the `IssueServicePort`, `IssueStorePort`, gate,
journal and provenance ports over one `SubstrateService` connection instead of
`~/.xtrm/state.db`; with it unset the local path is unchanged
(`selectWorkItemStore`, `specialists/src/activation/workitem-store.ts`). Four
properties of this consumer are load-bearing and pinned by its tests:

- *Fail closed, with the transport code.* An unreachable server ends the call
  with `connection_lost`, `not_installed`, `spawn_failed` or `timeout` promoted
  into the message the dispatch refusal renders, and no local store is opened on
  that path: the remote adapter has no sqlite opener at all. One call is one
  attempt — the wire has no retry key, so a mutation (claim, dispatch binding,
  journal append) is never replayed by the client, and a settlement retry
  re-reads first and republishes through its own pass.
- *`store.addJournal` is one round trip.* The server resolves the ref and
  appends in a single operation, so the remote path costs one call where the
  local path costs a resolve, a read and a write.
- *`completedBlockers` answers `[]` over the wire.* No operation returns active
  `blocks` edges (XTRM-715 is the unscheduled parity draft), so the remote port
  has no `getBlockers` and the boundary reports "no blocker information" rather
  than "no blockers". The local port still walks the edges, so a remote dispatch
  renders an empty dependency context instead of a false one.
- *Project resolution sends the verified server checkout root.*
  `issue.resolveProject` matches `gitRoot` against the links of the store it
  RUNS ON, where a PC path is not evidence even when both machines use the same
  layout. The host derives the repository key locally, reads the checkout that
  `sb remote setup` verified (`checkouts[<host> <repositoryKey>]`) and sends that
  server root. A repository with no verified mapping refuses and names
  `sb remote setup <remote>` instead of guessing a project; reads still work
  without a mapping, because inline creation is the only operation that needs
  one.

## Stage 3 (XTRM-690): the typed stdio service

Stage 2 gave the PC a correct argv path to the server-owned store. Stage 3 gives
in-process consumers a typed one, because a consumer that runs inside a process
cannot pipe a CLI: the specialists service reaches the store through
`IssueServicePort`/`IssueStorePort`, the Pi extension and the Claude hooks call
the domain services directly.

**Transport.** One child process per client process, started as
`ssh -T … <host> "cd '<root>' && '<sb>' serve --stdio"`, or as `sb serve --stdio`
on this machine. Newline-delimited JSON frames: `{id, op, args}` →
`{id, ok, result}` / `{id, ok: false, error: {code, message}}`. The first frame is
`hello`, answered with the protocol number, the `sb` version and the sorted
capability list. A protocol the server does not speak is refused as
`unsupported` before any store operation, and a refusal does not open the door
for later frames. A malformed frame is answered with `id: null` and the session
continues. stdout carries frames only; diagnostics go to stderr. A server
without the verb prints CLI help instead of a frame, so the client reports the
missing capability by name (`sb serve --stdio` … 0.2.4 or newer) rather than a
generic timeout.

**Surface: structured operations, never SQL.** 60 operations across
`issue.*`, `gate.*`, `store.*`, `journal.*`, `provenance.*`, `authority.*`,
`resume.buildCapsule`, `resume.renderCapsule`
and `authority.*`. Each one is a named domain operation with typed, validated
arguments; there is no `sql`, `exec` or query-expression verb, and an unknown
operation is refused by its own name. The handlers call the same
`IssueService`/`JournalService`/`ProvenanceService`/`ResumeService` methods the
local path calls, so a remote call and a local call cannot drift into different
semantics.

**Activation authority.** `authority.record`, `authority.remove` and
`authority.list` are the only operations that name the `activations` table.
They exist because the specialists' authority writer is deliberately small —
one row per activation, written outside the issue store, read directly by the
shipped SessionStart reader — and because the general instruction is that
authority travels as structured operations. Their columns are copied from
`specialists/src/activation/authority-store.ts` verbatim
(`activation_id`, `specialist`, `state`, `bead_id`, `last_activity_at`) so the
service cannot invent a shape the reader does not understand; the schema version
constant is repeated rather than shared, and a change to either side must move
both.

**What the surface refuses, and why.** The first delivery exposed more than a
remote consumer needs, and the audit of it fixed the surface rather than
documenting the risk:

- *Frames are split before they are decoded.* Decoding each 64 KiB read on its
  own turned a character split across a read into U+FFFD and answered `ok: true`
  with corrupted text. The reader now finds `0x0A` in the byte stream and decodes
  only complete frames (a newline byte cannot occur inside a UTF-8 sequence).
- *A frame over `MAX_FRAME_BYTES` is discarded and refused*, not buffered: the
  previous reader kept whatever a caller sent and rescanned it on every read,
  which is a memory and CPU denial of service with one write.
- *An async handler is awaited inside the answer's `try`.* `journal.checkpoint`
  is async; without the await its promise was serialised as `{}` (an `ok: true`
  answer for work that never ran) and its rejection killed the process holding
  the store.
- *`journal.enrichEntry` is exposed, and only for a checkpoint that has no
  semantic layer yet.* The service method updates `semantic_json` and appends an
  audit event, which looks harmless until it is measured: enriching a `note`
  twice overwrote the first summary with the second and the entry kept no copy of
  the original. The operation therefore checks the entry before it writes —
  `kind` must be `checkpoint` or `compaction` and `semantic` must be `null`,
  otherwise it refuses with `conflict` — and the audit event is the only trace of
  the change.
- *Identity travels in the operation's arguments, from the client's own
  environment.* The serving process strips ambient identity at startup (so a
  forwarded write is never attributed to the harness that started the server),
  and the client resolves `SUBSTRATE_HOLDER`, `SUBSTRATE_ACTIVATION_ID`,
  `XTRM_SESSION_ID` and `XTRM_RUN_ID` from its own environment and sets the same
  fields a CLI flag would. Forwarding those variables over the connection was
  wrong in a way that only showed in the store: the server strips them, so a
  remote append recorded no participant where the local call recorded the
  holder. The same call now stores the same actor on both paths.
- *Numbers are bounded.* `Number.isInteger` accepts `1e300`; every numeric
  argument now has a bound (claim TTLs, priorities, revisions, cursors, list
  limits) and `lastActivityAt` additionally refuses anything beyond a five-minute
  clock skew, because a forged stamp at the top of the ordering pins a row first
  forever.
- *The surface is derived from the consumers' call sites, not from the services'
  method lists.* Every method Pi handlers, the Claude hook scripts and MCP server,
  and the specialists ports actually call has an operation; methods they never
  call are left out. Left out deliberately: `issue.trailersForCommit` (a hook on
  the commit path, which has its own remote handling and an 8 s budget),
  `provenance.generateBundle`, `provenance.closureOutcomes` and the audit
  queries (`closuresLackingProvenance`, `resultsLackingReceipts`,
  `issuesForSession`) — reporting tools that read a whole store, not operations a
  consumer performs mid-task. `issue.trailersForCommit`, `provenance.getBinding`,
  `provenance.reconcileRewrite` and `provenance.generateBundle` likewise stay
  out. Five operations exist for the specialists' own tools
  (`issue.createProject`, `issue.linkCheckout`, `issue.listLinks`,
  `provenance.findByPr`, `provenance.listArtifacts`), which is what makes the
  `sp` tools usable over the connection.
- *`issue.appendEvent` accepts only the events the client raises.* It was a way
  to write a lifecycle event by hand — a remote caller planted `issue.closed` at
  `at: 1` and the journal showed a closure nobody performed. The allowlist is
  `journal.checkpoint_degraded`, the one event a client has a reason to raise.
- *`authority.list` answers the SessionStart reader's query when asked to.* With
  `{"activeOnly": true}` it runs the same statement the shipped reader runs —
  `state NOT IN ('settled','disposed')`, newest activity first, `LIMIT ?` — so a
  remote client sees the same rows in the same order. `authority.record` accepts
  what the specialists writer accepts (an empty `issueRef`, a stamp of 0 for a
  row not touched yet) and refuses only what would poison a listing: a
  non-integer or far-future stamp, a non-identifier id, an invented state or a
  re-attributed row. Deletion is by `activationId` **and the owning specialist,
  which is required** (XTRM-700, operator ruling option A): an unnamed removal
  returns `bad_request` and leaves the row, a foreign specialist returns
  `conflict` and leaves the row, and a row that is already gone answers
  `removed: false` so the host's `stop()` stays idempotent. The optional form was
  a real hole — a caller holding the store could delete another specialist's live
  row by id alone — and there is deliberately no compatibility window and no
  warning-only shape, so the host must send its specialist or its `stop()` fails
  loudly (tracked in `specialists`).
- *Authority stays unused over the wire by schedule, not by a hidden gate.* The
  three operations are reachable as soon as a caller speaks the protocol; what
  keeps them unused is the sequencing rule that the remote host must be able to
  reach the store (`SPECIALISTS-4398`), that removal names its owner (XTRM-700,
  above), that a foreign *record* cannot rewrite a row (its sibling), and that the
  row cap and TTL exist (XTRM-701) — with the consumer-side switch landed last
  (the authority part of `SPECIALISTS-4395`). A default-off flag in the service
  was considered and rejected: it would be a second switch in a second product,
  which is exactly the drift the ownership rule removes.
- *Activation rows are validated as identifiers, not text.* The SessionStart
  reader prints `activation_id`, `specialist`, `state` and `bead_id` verbatim
  into a model's context, so a newline in a field stored a line of instructions
  that the next session read as its own. `activationId` and `specialist` must
  match `^[A-Za-z0-9_.:-]{1,128}$`, `state` must be one of the ten values the
  specialists host writes (`starting`, `running`, `waiting`, `needs_reply`,
  `escalated`, `settled`, `stopping`, `stopped`, `failed`, `uncertain` — read
  from `specialists/src/activation/types.ts` and asserted against it in a test),
  and `issueRef` must look like an issue reference. The forgery defence is the
  charset, the bounds and the rule that a row cannot be re-attributed to another
  specialist; the lifecycle itself is the host's, so a woken turn that writes
  `settled` then `running` is accepted rather than fought. **Follow-up on the
  specialists side:** the reader should strip control characters from what it
  prints, since it reads rows written by older releases too.
- *A client reads its configuration before it decides it is local.* Checking only
  `SUBSTRATE_REMOTE` gave a machine configured with `sb remote setup` a stale
  local store; the client now consults the same configuration the CLI uses and
  fails closed when a configured remote cannot be used.
- *Nothing is forwarded to the remote CLI twice.* `serve` is in the
  never-forwarded set, so `sb serve` cannot recurse through the transport.

**Costs and limits to record.** `journal.checkpoint` writes twice: the
mechanical entry, then a stamp of its cursor on the same row, exactly as the
local path does. A caller that repeats a checkpoint gets a second entry — there
is no retry key on the wire, so idempotency is the caller's job (an
`idempotencyKey` exists only on `issue.updateContract`'s options). And with a
signature the caller can reproduce, the same request can be repeated; nothing
in the service deduplicates frames.

**Local mode is the same surface.** `createLocalService` runs the identical
operation table in-process. A consumer can therefore be written once against
`SubstrateService` and remain fully local when `substrate.remote` is unset — the
two-way rule, applied to code instead of commands.

**Rollout order (the server runs `sb` 0.2.2 today).**

1. Release `packages/substrate` with `sb serve --stdio` and `src/service/`.
   `0.2.4` is published and does **not** carry it: the release that does is the
   next one. Publishing first is still step one, because every later step
   depends on a version number an operator can install.
2. Upgrade the store-owning machine's `sb` to that release and verify the
   handshake there:
   `printf '%s\n' '{"id":0,"op":"hello","args":{"protocol":1}}' | sb serve --stdio`.
3. Land the consumers — Pi handlers, Claude hooks and MCP server, specialists
   ports (XTRM-691, XTRM-692, SPECIALISTS-4398 for the work-item ports — landed —
   and the authority part of SPECIALISTS-4395). A consumer fails closed: when
   `substrate.remote` is set, a failed handshake, an `sb` without the verb or a
   dropped connection ends the call with an error naming the remote. It never
   opens the local store as a substitute, because a stale local store answers
   questions the operator did not ask. Local behaviour applies only when
   `substrate.remote` is unset — the both-ways rule is a configuration choice,
   not a runtime fallback.
4. Only then switch activation authority to the service on machines that own a
   server store.

Nothing in steps 3–4 is safe to land before step 2 in a repository whose store
lives on the server: a consumer that assumes the service would lose its
operations silently, which is the failure mode this order prevents.

**When the transport fails, it says which failure it is.** One code for every
transport problem made an unanswering `ssh` look like a version skew. The client
distinguishes `not_installed` (the far side ran an `sb` without the verb: usage on
stderr, exit 1, nothing on stdout), `spawn_failed` (the command could not be
started at all), `connection_lost` (the pipe closed or a write failed), 
`protocol_mismatch` (the server refused the protocol number) and `peer_noise`
(stdout carried something that is not a frame — a banner, a proxy, a login
prompt), and each message names the remote (`ssh:<host>`). Two consequences are
documented rather than fixed: a call that times out is **not cancelled** on the
server, and the protocol carries **no idempotency key**, so a retried mutation can
run twice.

**Verification.** `packages/substrate/tests/service-operations.test.ts` runs
every operation twice — once through a real child process with its own store, once
in process — and requires the two answers to agree on the outcome, the error code
and the result shape; it also refuses an unknown argument name on every
operation, covers each invalid argument class, and pins the transport codes above
(`not_installed`, `peer_noise`, `protocol_mismatch`, `spawn_failed`,
`connection_lost` after an EPIPE, and a timeout that cannot hang the suite).
`packages/substrate/tests/service-protocol.test.ts` drives a
real `sb serve --stdio` child over pipes with real frames, against a store the
client process never opens: the authority row is read back from the server's file
with `openSubstrate` directly, the client's file stays empty through the same
operation table, an issue round trip runs through `sb init` on a throwaway
repository, and an `ssh`-shaped shim proves the hop works over pipes. The CLI
answers both `sb serve --stdio` and `sb serve stdio`.

### Limits of the service's trust boundary (measured, not assumed)

An independent security pass attacked the service over its own protocol. These
are the limits it found that are **design**, recorded so nobody mistakes them for
guards:

- **Identity is asserted by the caller.** `issue.claimIssue`, `issue.releaseClaim`,
  `journal.appendEntry` and `store.addJournal` take `participantId`, `holder`,
  `activationId` and `sessionId` from the caller. The server validates their
  *shape* (a shell-safe label, a canonical session id) but does not authenticate
  them, because ADR-008 makes ssh access the trust boundary: whoever can run the
  service can run `sb` on that machine anyway. The client resolves these values
  from its own environment; a caller that lies about them is indistinguishable
  from one that does not.
- **A caller with the store can rewrite another activation's row of the same
  specialist.** `authority.record` keys on `activationId`, and `specialist` names
  a group, not an activation. `authority.remove` drops the ownership check when
  the caller omits `specialist`, because the specialists host forgets a row by id
  alone on `stop()`; requiring the owner would break that path.
- **Rows can bury each other.** The shipped reader asks for `LIMIT 10` ordered by
  `last_activity_at`, and `authority.record` accepts a stamp up to five minutes
  ahead (clock tolerance for a writer on another machine). Ten rows stamped
  inside that window therefore sort above real live rows. The fix belongs with
  the reader's query or the host's row lifecycle, not with input validation.
- **`linkCheckout` records any absolute path** as a checkout root, including `/`
  and paths inside `~/.ssh`. It is a bookkeeping operation, not a sandbox check.
- **Error redaction is name-based**: a store path ending in `state.db` is replaced
  with `<store>`; another store file name would pass through. Startup failures
  never reach the wire.

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

Stage 3 is implemented on branch `xt/XTRM-690-stdio-service` (PR #309), and the
audit of the first delivery is folded into the same branch — frames split before
decoding, a frame size cap, awaited async handlers, `journal.enrichEntry` is present but refuses anything except an unenriched checkpoint or compaction,
identity from the frame, bounded numbers, identifier-validated authority rows,
configuration-aware local/remote resolution, and an `ssh` program in the argv:
`packages/substrate/src/service/{protocol,ops,authority-service,serve,client}.ts`,
the `sb serve --stdio` wiring in `cli/sb.ts`, and
`packages/substrate/tests/service-protocol.test.ts` (real child process, real
frames). It is not deployed: the rollout order above governs when a consumer may
use it. The consumers stay follow-up Issues.
