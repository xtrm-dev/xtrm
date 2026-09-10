# E5 acceptance transcript (bead xtrm-iip.5)

Run 2026-09-09 by the Claude lane against the merged plugin. This is the
execution record for the runbook; legs 1–2 were proven pre-landing and re-proven
here as part of leg 3.

## Environment recorded

```text
Claude Code            2.1.266
node                   24.15.0
plugin source          main cef47a3 (git archive, not a working copy)
plugin location        /tmp/e5-run2/substrate  — outside any git checkout
                       (`git rev-parse` there: "not a repository")
resolution path        SUBSTRATE_HOME=<xtrm>/packages/substrate
                       (installed-package path NOT used — leg-6 record)
database               ~/.xtrm/state.db via default resolution, no SUBSTRATE_DB
MCP SDK                @modelcontextprotocol/server ^2.0.0
protocol negotiated    2026-07-28
```

## Leg 3 — plugin loads: PASS, with a precondition

Skill registration, from outside the checkout:

```text
$ echo 'List the exact names of any skills whose name contains "substrate".' \
  | claude -p --plugin-dir /tmp/e5-run2/substrate
`substrate:using-substrate`
```

MCP server, **default session** — FAILS:

```json
{"error":"Server stderr: [substrate-mcp] Rejected 2025-era request on a modern-only stdio connection (modern-only-missing-envelope): Unsupported protocol version: 2025-11-25\n"}
{"error":"Connection failed (-32022): Unsupported protocol version: 2025-11-25"}
```

MCP server, **with `MCP_SDK_GENERATION=v2 MCP_PROTOCOL_NEGOTIATION=auto`** —
succeeds:

```json
{"debug":"Successfully connected (transport: stdio) in 974ms"}
{"debug":"Connection established with capabilities: {...}"}
{"debug":"Calling MCP tool: issue_get"}
{"debug":"Tool 'issue_get' completed successfully in 19ms"}
{"debug":"MCP server process exited cleanly"}
```

Only `2026-07-28` appears in the successful connection log. Brief §R called this
risk correctly.

## Leg 5 — one database: PASS

Through the plugin's MCP server, no `SUBSTRATE_DB` set:

```text
$ claude -p --plugin-dir /tmp/e5-run2/substrate --allowedTools mcp__substrate__issue_get
  (prompt: call issue_get with ref XTRM-3, print only the title)
reviewer: verify published PR3 target branch and PR
```

Same row through the CLI against the canonical store:

```text
$ node cli/sb.ts issue show XTRM-3
XTRM-3 · XTRM-3 · reviewer: verify published PR3 target branch and PR [terminal rev1]
```

Byte-identical title. Claude and `sb` read one database.

## Leg 6 — outside the checkout: PASS

The plugin ran from `/tmp/e5-run2`, resolving substrate through `SUBSTRATE_HOME`.
Recorded as required: **SUBSTRATE_HOME**, not the installed-package path. The
installed-package leg remains unexercised and should not be claimed.

## Leg 4 — hooks: PASS (coordinator rig, live interactive session)

Run against the merged plugin on main, Claude Code 2.1.266. Five checks:

| # | Check | Result |
| --- | --- | --- |
| 1 | No `Duplicate hooks file` after `xtrm-iip.10` | **PASS** — zero errors |
| 2 | Hooks fire | **PASS** — SessionStart entries run; PreCompact ×3 + PostCompact on `/compact`; `session-start.mjs` on compact resume |
| 3 | Monitor starts on skill invoke | **FAIL** — skill invoked and doctrine recited, but zero monitor lines under `--debug` and no `tail-events` process. Filed as `xtrm-iip.12` |
| 4 | `asyncRewake` wake | **PASS**, with mechanism |
| 5 | Compaction lifecycle | **PASS** — checkpoint → PostCompact → SessionStart(compact) capsule, completion logged |

**Check 4 mechanism chain**, which is what makes it a proof rather than a
correlation: journal `seq4` written on `PROOF-1` → watcher PID exited within the
poll window → the session's next turn read `sb issue show PROOF-1` **and**
`resume_capsule` through the plugin's MCP server → identified the record as a
synthetic probe and declined to act. That exercises every link the E6 design
claims: durable event, bounded watcher, exit path, reference-only payload, and
truth read back through a tool rather than from the payload.

The coordinator's first attempt at this leg was rebuilt after they judged their
own initial result to be correlation rather than mechanism proof — the rerun
added `--debug`, confirmed watcher arming in the log, then fired the event. That
is the right instinct and it is why check 4 is trustworthy.

**Check 3 confirms the flag raised during the E6 review.** Monitors were the
third component documented as "default path *or* manifest key," and `.mcp.json`
had already proved that wording unreliable. `monitors/monitors.json` at its
default path is not picked up; the fix is presumably `experimental.monitors` in
the manifest, which is `xtrm-iip.12`'s to determine. The E6 adoption of plugin
monitors is therefore **recorded but unproven in situ** — which is exactly why
E6's doctrine says adopted primitives must not be load-bearing.

### What this lane proved earlier (standalone, still valid)

Proven — each entry script, run standalone with no issue ref:

```text
precompact.mjs   exit 0, 1 line: {"continue":true,...,"reason":"no issue ref ...; compaction proceeds"}
postcompact.mjs  exit 0, 1 line: {"ok":true,"entryId":null,"reason":"no issue ref; audit skipped"}
session-start.mjs exit 0, 1 line: {"additionalContext":null,"hookSpecificOutput":{...},"reason":"non-compact source; no injection"}
```

Exactly one JSON line each confirms the `.mjs` choice prevents the
double-execution it was made for, and each degrades correctly with no bound
issue.

**Superseded:** the compaction lifecycle is now proven by the coordinator's rig
(leg 4, check 5 above). The paragraphs below record what this lane could and
could not establish on its own, and stay because the negative result is worth
keeping.

**Not proven from this lane:** the in-session compaction lifecycle. `-p` mode cannot trigger
PreCompact, PostCompact, or SessionStart(compact). This leg needed an interactive
session, which is why it was reassigned to the coordinator rather than dropped.

**Headless workaround attempted and ruled out (2026-09-09).** Before conceding
the leg, `/compact` was tried as a headless prompt against the merged plugin
(`eba4b2b`), with `SUBSTRATE_DB` and `SUBSTRATE_ISSUE_REF` pointed at a seeded
throwaway database (`LEG-1`) so nothing touched the canonical store:

```text
$ echo '/compact' | claude -p --plugin-dir /tmp/leg4run/substrate
Error: No messages returned from query

journal entries: 0
events: 1          # the issue creation only — no checkpoint written
```

A fresh print-mode session has no history to compact, so PreCompact never fires.
This is a negative result worth recording: it closes the question of whether the
compaction leg could be shortcut headlessly. It cannot. An interactive session
with accumulated history is required, which is why the leg sits with the
coordinator's tmux rig rather than with this lane.

## Fail-condition sweep (brief §S)

```text
initialize required                     NO  (modern-only; discover-first)
notifications/initialized required      NO
2024/2025 protocol negotiated           NO  under the v2 runtime; see precondition
legacy fallback occurs                  NO  (legacy:"reject" refuses it outright)
server/discover unsupported             NO  (returns supportedVersions ["2026-07-28"])
required request _meta absent           NO  (envelope enforced; absence is rejected)
tools capability absent                 NO  (tools.listChanged:false advertised)
tools/list connection assumptions       NO  (stateless; per-request envelope)
tool call depends on connection state   NO  (handle opened/closed per call)
Mcp-Session-Id required                 NO  (stdio; no session header exists)
repo-local Substrate DB read            NO  (leg 5 proves the canonical store)
```

## Blocking finding

**The packaged plugin's MCP server is unusable in a default Claude Code 2.1.266
session.** Claude Code opens at 2025-11-25; `legacy: "reject"` refuses it. The
user sees a plugin whose skill loads and whose tools simply are not there, and
the connection failure is cached for ~15 minutes, so it reads as intermittent
rather than as a configuration error.

This is not an E1 defect — E1 packaged what was specified. It is a deployment
precondition invisible to `validate --strict` and to the unit suite, because
neither opens a real session. It took a live install to surface.

Decisions owed (coordinator):

1. Document the two variables as a hard precondition, in the E7 constraints doc
   and in the plugin's own skill.
2. Rule on `legacy: "reject"` for a shipped plugin. Rejecting is correct protocol
   hygiene; the cost is that a version mismatch degrades to a silent, tool-less
   session rather than an explicit error the user can act on.
3. Assign the interactive compaction proof (leg 4).

## Watch items added after the first run

**1. Install-state discipline applies to proof rigs.** An MCP spawn failure in the
coordinator's interactive session was that worktree missing `npm install` after
E3 — the SDK was absent from `node_modules`. Not an E1 defect; the repo-relative
seam works once installed. A proof rig in an unbuilt tree produces findings about
the rig, not the artifact.

**2. Manifest key asymmetry (bead xtrm-iip.10) — the obvious fix is wrong.**
The shipped manifest names `hooks: "./hooks/hooks.json"` while the file also sits
at the auto-scanned default path, so it loads twice ("Duplicate hooks file").
Docs are explicit: *Location: `hooks/hooks.json` in plugin root, **or** inline in
plugin.json.*

The instinct is to drop both pointer keys and get the minimal manifest the bead
asked for. Measured on a scratch copy, that is wrong:

| Manifest | `validate --strict` | Skill | MCP server |
| --- | --- | --- | --- |
| both keys (as shipped) | pass | loads | works, hooks load twice |
| **both keys removed** | pass | loads | **never spawned** — no log dir created |
| `hooks` removed, `mcpServers` kept | pass | loads | works |

`.mcp.json` at the plugin root is **not** auto-discovered the way
`hooks/hooks.json` is, at least under `--plugin-dir` on 2.1.266. Removing both
keys therefore trades a duplicate-load warning for a silently dead tool surface —
the same failure shape as the env-var precondition: skill present, tools gone,
nothing in the output saying why.

**Correct fix: remove only `hooks`; keep `mcpServers`.** Verified: `issue_get
XTRM-3` still returns the expected title with `mcpServers` retained.

**Severity — RETRACTED, and worth reading as a lesson.** This section previously
recorded the duplicate as *fatal*: a negative control from the coordinator's rig
showed `wake-on-event` spawning zero times, which was read as the whole hook set
being dropped. The coordinator later retracted that control — the zero-spawn
observation came from **log-file confusion across sessions**, not from the
plugin; watchers armed in every session, with PIDs observed.

So the duplicate declaration was a real defect worth fixing (it is gone, and
pinned), but the "entire hook set dropped" severity claim was **not supported**.
Both of us propagated it: they measured it, I escalated it into this record and
onto the bead. The lesson is the same one this document keeps repeating in the
other direction — a single observation that fits the expected story is not
proof, and a *negative* observation is the easiest kind to misattribute.

**Unproven from `-p`:** that hooks still load once the key is gone. Hooks fire
only on compaction. The interactive leg-4 rig should confirm both halves at once —
no duplicate error, and all three hooks registered and firing. If the
default-path file turns out not to be picked up either, the fix inverts (keep the
manifest key, remove the default-path file) and that log should be seen before
anything lands.

A cheap mitigation worth considering under (1): the plugin's SessionStart hook
already runs on every matching session and can emit `additionalContext`. It could
check for the two variables and say so when they are unset, turning a silent
failure into one visible line. That is a small, testable addition — but it is a
change to E1's shipped hook surface, so it needs your ruling before anyone writes
it.

## Record complete

All six legs are closed: 1, 2, 3, 5 and 6 by this lane, 4 by the coordinator's
interactive rig. One check inside leg 4 failed — monitor start — and is owned by
`xtrm-iip.12`. Nothing else in the chain is outstanding.

Open items born from this run, none blocking E5:

| Bead | Item |
| --- | --- |
| `xtrm-iip.12` | Plugin monitors do not start from the default path |
| `xtrm-iip.11` | SessionStart hook warns when the MCP env precondition is unmet |
| `xtrm-iip.9` | Env-name convergence — ruled: alias both, prefer `_REF` |
| `xtrm-iip.8` | `tools/list` `ttlMs` is 0 |
