// MCP server entry for the packaged plugin (bead xtrm-iip.1, closeout E1).
//
// This is the path .mcp.json names, exactly as contracted:
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/substrate-mcp.ts
//
// Two lines by design: resolve the server module through the seam, then run
// its serveMain(). The entry never imports @modelcontextprotocol/server
// itself — substrate's own ESM graph supplies the single SDK build, which
// keeps the CJS/ESM dual-instance hazard (crashed modern requests) dead.
//
// .ts is safe here: the server module gates its own direct execution on an
// exact URL match (import.meta.url === pathToFileURL(process.argv[1]).href),
// not on a filename suffix, so mounting it from this file does not
// double-serve.

import { resolveSubstrate } from "./resolve-substrate.mjs";

const { serveMain } = await resolveSubstrate("mcp-server.ts");
serveMain();
