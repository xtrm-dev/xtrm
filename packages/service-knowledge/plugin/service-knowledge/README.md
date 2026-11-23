# service-knowledge plugin (Claude Code)

Five read-only MCP tools over the per-repo service-knowledge FTS5 index, plus one advisory
`PreToolUse` hook that names the owning service before you read its source.

| Tool | Call it when |
|---|---|
| `knowledge_evidence_for_files` | you are about to read or search a service's source files — this is the first call |
| `knowledge_search` | the symptom → service mapping is unclear, before any repo-wide grep or code search |
| `knowledge_get` | a search hit needs its full text, or you are about to open a service `SKILL.md` directly |
| `knowledge_status` | results look stale or empty, or you are unsure whether this repo has adopted service-knowledge |
| `knowledge_drift` | before trusting knowledge about recently changed code, or when a nudge reports a pending drift marker |

Order of use: `knowledge_evidence_for_files` for the paths in hand, then `knowledge_get` for the
item or skill it names, and `knowledge_search` when no path is known yet. `knowledge_status` and
`knowledge_drift` answer questions about the knowledge itself and never block work.

`scripts/launch.mjs` resolves the installed `service-knowledge` CLI from `PATH`, pins
`SERVICE_KNOWLEDGE_ROOT` to this session's project checkout, and runs
`service-knowledge mcp serve` (stdio MCP JSON-RPC). Tool definitions live in the Python package;
the hook only reads the registry.

## Nudge hook (`PreToolUse`)

Claude Code runs `hooks/service-knowledge-nudge.cjs` before `Read`, `Grep`, `Glob` and `Bash`, and
the hook prints one line of context when the tool touches a file inside a registered service
territory:

```
[service-knowledge] api owns api/mcp_server.py. Next: knowledge_evidence_for_files {"paths":["api/mcp_server.py"]}, or knowledge_get with skill_path .xtrm/skills/<pack>/service-knowledge/services/api/SKILL.md.
```

The text is a contract: the pi extension appends the same string to its tool result, so both hosts
give one answer. One injection names at most three services, one line each, and services that share
a territory are all named because picking one would be wrong:

```
[service-knowledge] 2 services own these paths:
- store owns docker-compose.yml. Next: knowledge_evidence_for_files {"paths":["docker-compose.yml"]}, or knowledge_get store.
- platform owns docker-compose.yml. Next: knowledge_evidence_for_files {"paths":["docker-compose.yml"]}, or knowledge_get platform.
```

Behaviour, all of it deliberate:

- **once per service per session** — a second read in the same territory stays silent, so the
  nudge never becomes noise;
- **territory parity** — the path matcher mirrors `skill_activator.match_territory` in the Python
  package, so the hook never names a service the write gate would not also match for that path;
- **most specific owner** — the nudge names the highest-specificity territory: an exact path beats a
  named file family, which beats a directory pattern. `match_territory` also answers yes for a path
  outside a directory pattern's own tree (its suffix branch), and that is not ownership, so the hook
  stays silent in that case rather than naming a neighbour;
- **drift hint** — with `.xtrm/.service-knowledge-drift-pending` present, the nudge also names
  `knowledge_drift`;
- **cached registry** — the parsed registry is cached per session and checkout in the system temp
  directory, and the hook's declared timeout is 100 ms;
- **fail open** — unparseable stdin, a missing or corrupt registry, an unknown tool, or an
  unexpected payload produces no output and exit 0; the hook never blocks a tool call and never
  carries a permission decision;
- **silent without a registry** — a repo that has not adopted service-knowledge sees nothing;
- **defers to the repo activator** — a repo whose `.claude/settings.json` wires
  `skill_activator.py` already receives a full evidence bundle on the same events, so this hook
  stays silent there instead of answering the same read twice. The check is cached with the registry
  (one settings read per session, not per call);
- **directory inputs** — a `Grep`/`Glob` path that names a directory resolves to every service
  whose territory lies under it;
- **at most three services** — a broad call names three owners, not twenty.

Which path is authoritative in which repo:

| repo state | nudge comes from |
| --- | --- |
| `.claude/settings.json` wires `skill_activator.py` | the repo activator (full evidence bundle); this hook is silent |
| scripts installed but no `.claude/settings.json` wiring | this plugin hook |
| no service-knowledge adoption | nothing |

Both paths read the same registry with the same territory semantics. Retiring or merging the
activator is out of scope for this hook and is tracked separately.

Bash is inspected only for read-shaped commands (`cat`, `head`, `tail`, `sed`, `awk`, `rg`, `grep`,
`find`, `fd`, `ls`); a mutating command is never nudged. To silence the hook, remove the `hooks`
entry from `.claude-plugin/plugin.json` or disable the hook in `/config`.

## Requirement

`service-knowledge` **>= 0.9.0** on `PATH` (from an xtrm checkout: `packages/service-knowledge/install.sh`, which also installs the `vaultctl` dependency). The `mcp`
subcommand ships in 0.9.0. On an older CLI the launcher exits 78 with a named reason
(`cli-too-old`) on stderr instead of presenting an empty tool list.

Deploy order: upgrade the CLI first, then install the plugin.

```bash
./install.sh                        # from packages/service-knowledge; or `git pull` (editable install)
service-knowledge --version
claude plugin install service-knowledge@xtrm
```

## Layout

```
plugin/service-knowledge/
├── .claude-plugin/plugin.json   # name, version (tracks the Python package), mcpServers + hooks pointers
├── .mcp.json                    # node ${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs
├── hooks/hooks.json             # PreToolUse: Read|Grep|Glob|Bash -> the nudge script
├── hooks/service-knowledge-nudge.cjs  # advisory nudge, node, no dependencies
└── scripts/launch.mjs           # root resolution + version gate + CLI spawn
```

The tool definitions live in the Python package
(`service_knowledge.mcp.TOOL_MODULES`), never here. Claude reads them over MCP at runtime, and the
pi extension reads the same projection from a committed `tool-definitions.json`; a parity test
pins both to `tool_specs()`.
