# Substrate plugin hooks

Claude lifecycle wiring (PRD §§24, 38, 54). Every entry is type command: PreCompact supports command/HTTP/MCP-tool hooks, not prompt or agent hooks. Paths resolve through ${CLAUDE_PLUGIN_ROOT} so the plugin works from any install location — never ${CLAUDE_PROJECT_DIR}/packages/substrate/..., which only exists inside the xtrm checkout. Exec form (command + args) is used because each entry references a path placeholder: args elements are passed verbatim with no shell quoting. Scripts are .mjs on purpose: the integration modules self-invoke on process.argv[1].endsWith("precompact.ts"), so a .ts entry script here would double-execute the handler.

Kept here, not as a `$comment` key: Claude Code warns on unknown keys in `hooks.json`.
