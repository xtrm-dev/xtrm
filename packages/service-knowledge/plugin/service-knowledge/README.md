# service-knowledge plugin (Claude Code)

Five read-only MCP tools over the per-repo service-knowledge FTS5 index:

| Tool | Use it when |
|---|---|
| `knowledge_search` | the symptom → service mapping is unclear; before grep |
| `knowledge_get` | one item by id, or one full SKILL.md by path |
| `knowledge_evidence_for_files` | before reading service source; routes by territory |
| `knowledge_status` | results look stale or empty; is the index installed and current? |
| `knowledge_drift` | before trusting knowledge about recently changed code |

The plugin carries no code of its own. `scripts/launch.mjs` resolves the installed
`service-knowledge` CLI from `PATH`, pins `SERVICE_KNOWLEDGE_ROOT` to this session's project
checkout, and runs `service-knowledge mcp serve` (stdio MCP JSON-RPC).

## Requirement

`service-knowledge` **>= 0.9.0** on `PATH` (`pipx install service-knowledge`). The `mcp`
subcommand ships in 0.9.0. On an older CLI the launcher exits 78 with a named reason
(`cli-too-old`) on stderr instead of presenting an empty tool list.

Deploy order: upgrade the CLI first, then install the plugin.

```bash
pipx upgrade service-knowledge      # >= 0.9.0
service-knowledge --version
claude plugin install service-knowledge@xtrm
```

## Layout

```
plugin/service-knowledge/
├── .claude-plugin/plugin.json   # name, version (tracks the Python package), mcpServers pointer
├── .mcp.json                    # node ${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs
└── scripts/launch.mjs           # root resolution + version gate + CLI spawn
```

The tool definitions live in the Python package
(`service_knowledge.mcp.TOOL_MODULES`), never here. Claude reads them over MCP at runtime, and the
pi extension reads the same projection from a committed `tool-definitions.json`; a parity test
pins both to `tool_specs()`.
