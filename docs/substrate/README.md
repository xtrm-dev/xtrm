# Substrate — operator starting point

Substrate is the durable work tracker for XTRM. It owns issues, claims,
journal continuity, and provenance. Git owns code truth. This file is the
canonical human entry point (ADR §29). The full normative reference is
[`substrate-issues-v0-prd.md`](./substrate-issues-v0-prd.md).

Status legend used across `docs/substrate/`: files marked **frozen** with a
bead + date (e.g. `phase0-*`) are historical phase evidence — they may retain
period wording such as "Beads owns durable work" and must not be read as
current instructions. Unmarked files describe current operation.

## What Substrate is

An issue graph over SQLite/WAL (library-first). The `sb` CLI, the Pi
extension, and the Claude plugin all consume the typed service — never SQL,
never CLI-text parsing. Machine identity (`iss_<uuidv7>`) plus a durable
human ref (`PREFIX-NNN`) are immutable; the hierarchical locator
(`PREFIX-NNN.s1.s2`) derives from monotonic never-reused `child_slot`s and
may change on reparent (the old locator stays resolvable as history).

## Authority model

```text
Substrate owns durable work.
Git owns code truth.
A ready Issue revision is executable.
Journal records progress/continuity.
Resume Capsule restores work.
Provenance records produced execution.
Messages do not change Issue authority.
```

Never implement from a title + description issue: repair the contract first
(see "Planning / revision workflow"). `bd` is read/import compatibility only;
historical Beads IDs resolve as aliases after import.

## Installation through xt

`sb` ships as the `bin: sb` entry of `@jaggerxtrm/substrate`
(`packages/substrate/cli/sb.ts`, erasable TypeScript, Node ≥24, no build
step). Fleet bootstrap entry is `xt init` (installed `xt` CLI, verified present).
`xt`-level health reporting over the `sb --help` / `--version` / `doctor`
contract below is a named pending gate owned by A8 (core installer); this
file does not invent `xt` subcommands. Verify any install with:

```sh
sb --version   # parseable semver, exits 0, never touches state.db
sb --help      # exits 0 even with HOME=/empty (no state created)
sb doctor      # exit 0 healthy / 1 otherwise
```

## State location

One store: `--db PATH`, else `$SUBSTRATE_DB`, else `~/.xtrm/state.db`.
`sb --help` and `sb --version` never open or create it (safe under
`HOME=/empty`). `sb doctor` is the one diagnostic that opens it — to check
it. Corrupt schema or unknown migration state refuses startup/mutation
(fail-closed); migrations are append-only and landed ones are never edited.

## Project / repository linking

```sh
sb project create --prefix <PREFIX> --name <name>
sb project link [--project <id>]   # link the cwd checkout to a project
sb project unlink                  # remove the cwd checkout link
```

Single-project databases link implicitly. `sb doctor` reports the cwd
checkout → project mapping as informational only (it never flips health).

## Issue identity

Every Issue-taking command accepts all five ref forms via `resolveRef`:

1. machine ID (`iss_…`), 2. durable reference (`PREFIX-NNN`),
3. current locator (`PREFIX-184.2.3`), 4. historical locator,
5. registered alias (includes imported Beads IDs).

## Issue contracts

The executable contract is seven fields (PRD §11, hashed with sha256):

`problem, success, scope[], nonGoals[], constraints[], validation[], output[]`

Create pins the full shape at write time:

```sh
sb issue create --project <id> --title <t> --kind <epic|task|bug|decision|research|followup> \
  --contract <file|json> [--parent <ref>] [--priority <n>] [--scrutiny <s>]
```

`sb issue show <ref>` prints the header plus the contract body (human) or
the full payload with `--json` (envelope `substrate-cli/v1`, additive-only).

## Readiness

Readiness is derived, never stored (`sb issue validate <ref>`). Operational
states: `terminal → deferred → draft → blocked → claimed → ready`. Only
`blocks` edges affect readiness; a cancelled prerequisite stays unsatisfied
(abandoned work is replanned, never silently treated as done). `sb issue ready [--project <id>]` lists only `ready` issues: `dispatchable`
is true exactly when the derived state is `ready`. `claimed` records the
holder but is not itself dispatchable; the Specialists claim→binding gate
continues a correctly preclaimed Issue only after holder + activation
authority checks pass inside the binding transaction (merged A7-auth,
bead xtrm-6qu.7.2: claim, holder, activation, revision, and contract hash
are revalidated atomically before INSERT; mismatches fail closed).
Semantic sign-off
is explicit (`sb issue attest` with `--outcome`, `--policy`, and
`--attested-by`):

## Claims and leases

Lease-backed, exactly one live claim per issue, with anti-steal:

```sh
sb issue claim <ref> --holder <who> [--ttl-ms <n>] [--activation <id>]
sb issue release <ref> --holder <who> [--activation <id>]
```

A live claim held by someone else refuses (reclaim only after expiry, which
closes the old generation first). Races on contract writes use
`--expected-revision` guards.

## Issue editing

Classification matters — metadata vs execution-bearing (§24):

- `--title` / `--priority`: metadata. No revision, readiness retained.
- `--contract` / `--ownership` / `--context-refs` / `--scrutiny`:
  execution-relevant. New revision, readiness invalidated (attestation must
  be renewed).

```sh
sb issue edit <ref> [--title <t>] [--priority <n>] [--contract <file|json>] \
  [--ownership <file|json>] [--context-refs <file|json>] [--scrutiny <s>] \
  [--expected-revision <n>]
```

At least one mutation flag is required; unknown flags fail closed by name.

## Journal methodology

The Journal is continuity, never authority. Kinds: checkpoint, handoff,
milestone, decision, finding, blocker, compaction, note. Findings here never
become reusable truth without a separate promotion step (v0 has none).

```sh
sb journal append <ref> --kind <k> [--mechanical <file|json>] [--semantic <file|json>] [--refs <file|json>]
sb journal checkpoint <ref> [...]   # mechanical-first checkpoint now
sb journal show <ref> [--kind <k>] [--limit <n>]
sb journal since <ref> <cursor>     # what changed since the checkpoint
sb journal render <ref> [--sequence <n>]
```

## Notes / findings / decisions / blockers

Fast path over the journal (append-only, never bumps the revision):

```sh
sb issue note <ref> ["text"] [--kind <note|finding|decision|blocker|milestone|handoff>] [--file <path|->]
```

`--file -` reads stdin. Pass text or `--file`, not both.

## Checkpointing

`sb journal checkpoint` writes the mechanical row (everything the host
already knows: issue/revision/contract-hash/workspace/branch/commits) FIRST —
durable even if the semantic pass fails — then the bounded semantic shape.
On compaction the same ordering holds: mechanical row stays durable, host
default proceeds on semantic or SQLite failure, and compaction is never
blocked.

## Resume Capsules

```sh
sb issue resume <ref>   # derived capsule, never a mutable source of truth
```

Resume from the capsule, never from compacted chat. `sb journal since`
between checkpoints shows only what changed. Root epics aggregate children
by reference; transcripts stay out.

## Planning / revision workflow

```sh
sb plan check --file <plan.json>   # validate a plan draft
sb plan apply --file <plan.json>   # execute it
```

Revision rule: only a contract-hash change creates a revision. During
execution, an insufficient or changed Issue is repaired through planning —
new revision plus readiness attestation — never by patching missing scope
into a dispatch prompt. The Specialists dispatch gate takes no prompt text
and `requestedScope` may only narrow contract SCOPE, never widen it.

## Provenance

```sh
sb provenance dispatch|trace|commit|receipt|pr|bundle
```

`trace` renders the event-spine lineage: session/activation bindings,
receipts with artifacts, attestation, claims. Executor output never
self-certifies: checkpoints record what the host observed; the service
validates shapes fail-closed. `sb export project --project <id> [--file <p>]`
writes a project snapshot.

## Specialists integration

`src/workitems/` is the backend-neutral seam: `SubstrateIssueStore`
canonical, `BeadsWorkItemStore` temporary read-only compatibility (no
dual-write). `dispatch-gate.ts` replaces Bead dispatch authority with
Substrate readiness plus an immutable execution binding (revision +
contractHash). Conformance record:
[`phase10-conformance.md`](./phase10-conformance.md).

## Pi integration

`integrations/pi/` consumes the typed service directly (never `exec sb`):
eight model tools (`substrate_issue_get/search/claim/update`,
`substrate_journal_append/checkpoint`, `substrate_issue_resume`,
`substrate_provenance_trace`), session→issue bindings, `session_start`
resume surfacing, and a `session_before_compact` handler (mechanical
checkpoint first, secondary-model semantic, custom summary or host-default
fallback). A blocking `tool_call` edit/write gate enforces claim +
workspace-lease authority by holder + activation (unbound sessions allow;
no-claim / foreign-holder / missing-holder / activation-mismatch /
foreign-workspace-lease block). Agent doctrine:
`packages/substrate/skills/using-substrate/`.

## Claude integration

The MCP server calls the typed service in-process (never execs `sb`, never
parses CLI text). Tools (`issue_get/list/ready`, `journal_append/show`,
`provenance_trace`, `resume_capsule`) are served in stable deterministic
order. One store, resolved as explicit override, else `SUBSTRATE_DB`, else
`~/.xtrm/state.db` — the plugin ships no repo-local default (that would fork
the canonical store). Lifecycle runs as `PreCompact` (mechanical first, then
semantic) / `PostCompact` / `SessionStart(compact)` hooks. Edit, commit,
and stop gates (§38, merged A6): the edit gate enforces claim +
workspace-lease authority like the Pi side; the commit check nudges (never
blocks) when Issue / revision / contract-hash / claim / binding context is
missing — the post-commit SHA bind recovers a receipt-less commit; the stop
gate checks durable continuity (active claim, checkpoint count since the
claim, recorded blocker/handoff entry counts) and writes a mechanical
checkpoint when the session would otherwise leave none, never blocking
exit. Pending-entry, writer-lease, activation, and ask coverage are not
claimed here (routed to .7/.10). Plugin:
`packages/substrate/plugin/substrate/`; doctrine:
`plugin/substrate/skills/using-substrate/` (Authority block byte-identical
with the Pi half — `tests/plugin-packaging.test.ts` fails on drift).

## Beads migration

One-way only (no dual-write, no reverse sync):

```sh
sb import beads --file <export.jsonl> --project <id> [--edges-file <f>] \
  [--create-project <PREFIX:Name>] [--dry-run]
```

`--dry-run` reports counts without mutating. Imported Beads IDs live on as
aliases, so old refs keep resolving. Historical Beads boards stay readable;
current runtime instructions must not reference Beads authority.

## Diagnostics

```sh
sb doctor [--db PATH] [--json]
```

`--json` data carries the keys `dbPath`, `schemaHealthy`, `schemaError`,
`projects`, `link`, `linkError`, `gitRoot` — the machine contract; human
text is aid only. Text
mode prints health, state.db path, schema state, project count, and the cwd
link. Exit 0 healthy, 1 otherwise.

## Reference to full PRD

- [`substrate-issues-v0-prd.md`](./substrate-issues-v0-prd.md) — full product
  requirements (normative detail behind every section above).
- [`sbcloseout2-adr.md`](./sbcloseout2-adr.md) — migration ADR, verbatim
  source of §29 and the phase plan.
- [`sbcloseout3-adr.md`](./sbcloseout3-adr.md) — amendment A1 (journal,
  outcomes, actor identity, session lineage, provenance, documentation
  contract), accepted for implementation, with PRD cross-link.
- [`e5-acceptance-transcript.md`](./e5-acceptance-transcript.md) — recorded
  live acceptance evidence.
- [`phase10-conformance.md`](./phase10-conformance.md) — WorkItemStore /
  dispatch-gate conformance record.
- `phase0-*` — frozen pre-cutover evidence (historical wording retained
  deliberately; not current instructions).
