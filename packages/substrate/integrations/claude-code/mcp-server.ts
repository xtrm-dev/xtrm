// Substrate MCP server, closeout E3 (bead xtrm-iip.3): official
// @modelcontextprotocol/server v2 over the modern stdio entry, strict
// protocol revision 2026-07-28, modern-only (legacy initialize-era
// openings are rejected). This REPLACES the handwritten initialize-era
// server: no initialize/initialized, no Mcp-Session-Id, no
// connection-scoped state.
//
// Statelessness is structural: serveStdio builds one McpServer per serving
// unit from buildServer(), every request carries its own _meta envelope
// (protocol revision + client capabilities + client info, read per request
// from ctx.mcpReq.envelope — never remembered), and each tool handler opens
// and closes its own database handle per call (the WAL store is the shared
// authority; E2 resolves explicit override else SUBSTRATE_DB else
// ~/.xtrm/state.db inside openHandles).
//
// Scope: transport/protocol layer only. Tool handlers are thin calls into
// the existing typed service; E4 (xtrm-iip.4) owns the tool surface
// content — E3 registers one thin read (issue_get) to prove the end-to-end
// path. E1 mounts this module at the contracted plugin entry
// (scripts/substrate-mcp.ts); buildServer() is the reuse seam.

import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { openHandles } from "./runtime.ts";

export const SUBSTRATE_SERVER_NAME = "substrate";
export const SUBSTRATE_SERVER_VERSION = "0.1.0";
export const SUBSTRATE_PROTOCOL_REVISION = "2026-07-28";

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: SUBSTRATE_SERVER_NAME, version: SUBSTRATE_SERVER_VERSION },
    // Static tool list: listChanged stays false (brief K — do not advertise
    // subscriptions that do not exist). E4 flips this only if it adds them.
    { capabilities: { tools: { listChanged: false } } },
  );
  server.registerTool(
    "issue_get",
    {
      description: "Resolve an issue ref to its summary via the typed service (E3 thin proof; E4 owns the full surface).",
      inputSchema: z.object({
        ref: z.string().min(1),
        dbPath: z.string().optional(),
      }),
    },
    async ({ ref, dbPath }) => {
      const handles = openHandles(dbPath);
      try {
        const i = handles.svc.resolveRef(ref);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                id: i.id,
                locator: i.locator,
                humanRef: i.humanRef,
                title: i.title,
                kind: i.kind,
                lifecycleState: i.lifecycleState,
                revision: i.currentRevision,
              }),
            },
          ],
        };
      } finally {
        handles.db.close();
      }
    },
  );
  return server;
}

// Direct execution (development, tests, and the pre-E1 plugin wiring):
// serve the modern era on process stdio, rejecting legacy openings.
const invokedAsMain =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return import.meta.url === pathToFileURL(process.argv[1]).href;
    } catch {
      return false;
    }
  })();
if (invokedAsMain) {
  serveStdio(() => buildServer(), {
    legacy: "reject",
    onerror: (err) => {
      console.error(`[substrate-mcp] ${err.message}`);
    },
  });
}
