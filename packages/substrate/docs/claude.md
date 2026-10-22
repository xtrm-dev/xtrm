---
status: current
owner: substrate
source_of_truth_for:
  - Claude plugin and MCP integration reference
last_verified_against: 3f3e3cbfbbd03de8fc0926599d6797f4b7eab79f
---

# Claude integration

The packaged `substrate` Claude Code plugin starts the MCP server through
`${CLAUDE_PLUGIN_ROOT}/scripts/substrate-mcp.mjs`; it ships no repo-local DB
default.

## Live MCP tools

```text
issue_get
issue_list
issue_claim
issue_update
issue_close
journal_append
journal_read
resume_capsule
provenance
```

| Tool (Pi: `substrate_` prefix) | Purpose |
|---|---|
| `issue_get {ref}` | Contract, readiness, claim, attestation |
| `issue_list {project?, status?, query?, kind?, limit?, claimedBy?}` | Replaces `issue_list`/`issue_ready`/`issue_search`; `claimedBy` (holder or `me`) lists held issues with the latest handoff |
| `issue_claim {ref, op?, holder?, ttlMs?, activationId?}` | `op` claim\|renew\|release; `holder` defaults to `SUBSTRATE_HOLDER`, else the xt worktree name |
| `issue_update {ref, title?, priority?, contract?}` | Metadata or revision-bearing change |
| `issue_close {ref, outcome, reason, *Refs?, participant?}` | Warns when `completed` cites no refs; `participant` defaults to the resolved identity |
| `journal_append {ref, kind, summary?, next?, details?, result?}` | All writable kinds; `checkpoint` takes the mechanical path; Pi entries now carry the summary |
| `journal_read {ref, mode, kind?, cursor?, limit?}` | `mode` latest\|since\|timeline\|show, full bodies |
| `resume_capsule {ref}` | Derived continuation capsule |
| `provenance {ref? \| sessionId? \| activationId?}` | Exactly one selector |

The Pi extension registers the same nine tools with the same parameter keys
(prefix `substrate_`). Names, descriptions and parameter docs are defined once
in `integrations/tool-surface.ts` and total under 5000 characters; behaviour
lives in `integrations/tool-core.ts`. The journal kind glossary is `sb help
kinds`. The DB comes from `SUBSTRATE_DB` and the project from
`SUBSTRATE_PROJECT`; the tools take no `dbPath` or `project` write parameter.
Every mutation returns structured `feedback` with `participantId` and
`warnings`.

Repository project resolution is explicit project → `SUBSTRATE_PROJECT` →
repository binding/checkout alias → fail closed with `sb init` guidance. There
is no single-project default.

## Hooks

```text
PreCompact              mechanical checkpoint first
PostCompact             compaction occurrence
SessionStart(compact)   Resume Capsule head as additionalContext
SessionStart(*)         XTRM primer as additionalContext: excerpts of the global
                        using-xtrm and multiplexing skills (~/.xtrm/skills/default),
                        never a project copy; no global skill, no output
```

Other packaged gates protect edit/write authority, provenance commit binding and
stop-time continuity. Provider feedback is presentation over the typed service
result, not another state machine.


Journal MCP writes fill unstated participant/activation from the ambient host
contract; explicit arguments win. PreCompact and stop checkpoint envelopes also
carry stated or ambient holder/activation. PostCompact intentionally remains a
provider-session-only audit event. See [Integrations](integrations.md#identity-propagation).

Edit/write fencing is per-Issue claim authority, not a Substrate workspace
lease. Workspace exclusion is owned by the Specialists activation layer.

## Distribution and updates

The repository root carries a Claude Code marketplace, `.claude-plugin/marketplace.json`,
named `substrate`. It offers the `substrate` plugin from
`packages/substrate/plugin/substrate`.

Install, one time. The repository is private, so the user needs read access and git
credentials:

```bash
claude plugin marketplace add xtrm-dev/xtrm
claude plugin install substrate@substrate
```

Update:

```bash
claude plugin update substrate@substrate
```

Claude Code detects an update from the plugin **version string**, not from commits. A plugin
change with an unchanged version is not delivered to anyone. The rules are:

- The version lives in `plugin/substrate/.claude-plugin/plugin.json` only. A version in the
  marketplace entry is silently overridden by `plugin.json`, so the entry carries none.
- `plugin.json` equals `package.json`. `npm version <x>` runs the `version` script
  (`scripts/sync-plugin-version.mjs`) and stages the manifest. `tests/marketplace-distribution.test.ts`
  fails when the two differ.
- A merge that changes the plugin needs a version bump to reach users.

Auto-update is off by default for marketplaces that are not Anthropic's. A user turns it on
under `/plugin`, then Marketplaces, or registers the marketplace with `autoUpdate` in
settings (`~/.claude/settings.json`, or `.claude/settings.json` committed in a project):

```json
{
  "extraKnownMarketplaces": {
    "substrate": {
      "source": { "source": "github", "repo": "xtrm-dev/xtrm" },
      "autoUpdate": true
    }
  }
}
```

A running session keeps the old version until `/reload-plugins` or the next start.

A user registers one marketplace per name. In a checkout, keep the local marketplace
(`claude plugin marketplace add <checkout>/packages/substrate`, which loads the plugin in
place) and do not add the GitHub one on the same machine.

The plugin scripts resolve Substrate modules through `SUBSTRATE_HOME` or the installed
`@jaggerxtrm/substrate` package, so install the package version that matches the plugin
(`npm install -g @jaggerxtrm/substrate@<plugin version>`). The XTRM primer hook is
self-contained and does not need the package.
