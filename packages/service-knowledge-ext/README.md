# service-knowledge extension

Self-gating service-knowledge surface for repos that carry a service registry: five read-only
knowledge tools, a registry/drift context note, and a `/service-knowledge:status` command.
Replaces the retired `service-skills` extension (which was blind to the canonical layout).

## Tools (v1.1, CORE-2714)

With a registry present, the extension registers five tools. They are at parity with the Claude
Code plugin's MCP tools: the same names, schemas and descriptions, generated from one Python
source of truth.

| Tool | Use it when |
|---|---|
| `knowledge_search` | the symptom → service mapping is unclear; before grep |
| `knowledge_get` | one item by `item_id`, or one full `SKILL.md` by `skill_path` |
| `knowledge_evidence_for_files` | before reading service source; routes by territory ownership |
| `knowledge_status` | results look stale or empty; is the index installed, indexed and current? |
| `knowledge_drift` | before trusting knowledge about recently changed code |

Reach for a tool **before** grep or source reading. Results are evidence with citations, not
conclusions: verify a load-bearing claim against the tree before acting on it. `knowledge_drift`
is advisory — it never blocks work.

The names are bare (`knowledge_search`, not `service_knowledge_search`). If another extension
already holds a name, this extension skips that tool with a notice and keeps the rest: a flat pi
namespace must never break a session.

### How parity is enforced

`tool-definitions.json` beside this file is generated from the Python package:

```bash
service-knowledge mcp specs --json > packages/service-knowledge-ext/tool-definitions.json
```

The extension renders those definitions verbatim — it never authors a description or a schema.
Two tests pin the arrangement, one on each side:

- pytest (`index/tests/test_mcp_jsonrpc.py`) asserts `tool_specs() == tool-definitions.json["tools"]`
- bun (`tests/service-knowledge.test.ts`) asserts the extension registers exactly that set

Edit a tool in `packages/service-knowledge/src/service_knowledge/mcp/`, then regenerate. The
`service-knowledge tests` workflow fails if you forget.

### Execution path and root resolution

Each call runs `service-knowledge mcp call <tool>` — the same code the Claude plugin serves over
MCP. `SERVICE_KNOWLEDGE_ROOT` is set explicitly, per call, to the git toplevel of the session cwd.
That matters: the Python resolver trusts `$CLAUDE_PROJECT_DIR` before git, and a pi worker
launched from a Claude session inherits it. Without an explicit root, a worker could silently read
its parent's repository.

A missing or too-old CLI is returned as a named error result, never thrown: the session keeps
working and the message says what to install.

## Self-gating

At extension init, the session cwd is scanned with the exact semantics of the
service-knowledge package's `find_umbrella_packs`
(`packages/service-knowledge/src/service_knowledge/cli/common.py`):

- candidate pack roots: `[<cwd>/.xtrm/skills, <cwd>/.xtrm/skills/user/packs]`
- reserved pack names are skipped: `default`, `optional`, `user`, `active`,
  `local-legacy`
- the NEW umbrella `service-knowledge` wins over the LEGACY `service-skills`
  per pack
- a pack counts only if `<pack>/<umbrella>/service-registry.json` exists

**No registry found → the extension registers NOTHING**: no tool, no command,
no event handlers. Zero surface. Legacy layouts (`.claude/service-registry.json`,
flat repo-root registries, registries under reserved pack names) are
deliberately ignored — only the canonical per-pack umbrella layout counts.

## Surface (registry present)

### Context note (`before_agent_start`)

Every turn gets a custom message injected:

```
<service_knowledge_context>
service registry: 1 pack(s), 2 service(s)
- service-knowledge@infra (2 services)
drift: none detected
</service_knowledge_context>
```

With a pending drift marker — either the canonical
`.xtrm/.service-knowledge-drift-pending` or the legacy wave-1
`.xtrm/.service-skills-drift-pending` (canonical wins when both exist):

```
drift: PENDING marker present (.xtrm/.service-knowledge-drift-pending) — reconcile with /updating-service-knowledge
```

### `/service-knowledge:status` command

Prints via `ctx.ui.notify`:

```
service-knowledge status
pack: service-knowledge@infra
  umbrella: service-knowledge (registry: /path/.xtrm/skills/infra/service-knowledge/service-registry.json)
  services: 2
  - db-expert: last_sync_ref abc12345
  - auth-svc: last_sync_ref (never)
git HEAD: 296be429
drift marker: absent
suggested action: run /updating-service-knowledge to reconcile + stamp last_sync_ref
```

`suggested action` is `none — registry is in sync with HEAD` when every service
`last_sync_ref` matches git HEAD and no drift marker is present.

## Reconciliation

Drift is reconciled with `/updating-service-knowledge` (the
`service-knowledge-sync` specialist) — NOT `/updating-service-skills`. This
extension only surfaces drift; it never auto-updates or rebuilds the index.

## When knowledge is absent or stale

A drift marker (`drift: PENDING` in the context note, or a `last_sync_ref`
behind git HEAD) is **advisory** — it never blocks work. Memory priority:

1. **service-knowledge, if present** — use the registry and skill bodies as-is;
   never grep-hunt for `service-registry.json` speculatively.
2. **Commit corpus — always available** — fall back to `git log -p --follow --
   <file>` for per-file history, `git log --grep`/`--oneline` for corpus, and
   diffs vs `last_sync_ref` when a registry states one. Commits do not go stale.
3. **bd memories** — `bd memories <topic>` / `bd recall <key>` before
   workflow-sensitive questions; write findings back with `bd remember`.

Suggest the reconcile, proceed with current knowledge + commit corpus in
parallel; stamp `last_sync_ref` only after a successful reconcile, and rebuild
the index only after that.

## Requirements

`service-knowledge` **>= 0.9.0** on `PATH` (from an xtrm checkout: `packages/service-knowledge/install.sh`, which also installs the `vaultctl` dependency). The `mcp`
subcommand, which every tool call uses, ships in 0.9.0. Without it each call returns a named error
result and the rest of the session is unaffected.

## Non-goals (v1)

- no auto-update execution
- no index rebuild trigger
- no enforcement — drift is surfaced, never acted on automatically

---

## Relocation (xtrm-6z6.5)

This extension moved out of `core/packages/pi-extensions` (where it was
`extensions/service-knowledge/`) into this standalone npm pi-package
`@jaggerxtrm/pi-service-knowledge`, co-located with the service-knowledge
Python package in the xtrm repo. The core bundle no longer ships it
(`src/manifest.json.disabled`). python-kernel stays bundled in core
`@jaggerxtrm/pi-extensions`. Install/enroll:

```bash
pi install npm:@jaggerxtrm/pi-service-knowledge   # or add this folder to ~/.pi/agent/settings.json "packages"
```

The extension calls the `service-knowledge` CLI (>= 0.9.0), which must be on `PATH`. The full
install sequence for a machine (CLI, Claude plugin, pi extension, per-repo registry, update and
troubleshooting) is in [`../service-knowledge/README.md`](../service-knowledge/README.md#install).
