#!/usr/bin/env node
// Test-only MCP server named "specialists" for the real-host acceptance run (XTRM-601, §36.11 criterion 14).
// It exposes `specialist_dispatch` with the input shape of the real Specialists MCP tool and answers with
// a job receipt, but starts no job: a real dispatch would write to the operator's Substrate board. The
// host classifies `specialists` / `specialist_dispatch` as coordination from its coordination table,
// so the rendering path under test is the real one. Every call is appended to $SPECIALISTS_STUB_LOG.
// Transport: MCP stdio, newline-delimited JSON-RPC 2.0.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const tool = {
  name: "specialist_dispatch",
  description: "Dispatch a specialist role against a Substrate issue. Returns the activation id.",
  inputSchema: {
    type: "object",
    properties: { specialist: { type: "string", description: "Specialist role, e.g. executor" }, issue: { type: "string", description: "Substrate issue ref" }, prompt: { type: "string" } },
    required: ["specialist", "issue"],
  },
};

const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
const fail = (id, code, message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // notifications
  switch (msg.method) {
    case "initialize":
      return reply(msg.id, { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "specialists", version: "0.0.0-acceptance-stub" } });
    case "tools/list":
      return reply(msg.id, { tools: [tool] });
    case "tools/call": {
      if (msg.params?.name !== tool.name) return fail(msg.id, -32602, `unknown tool ${msg.params?.name}`);
      const args = msg.params.arguments ?? {};
      if (process.env.SPECIALISTS_STUB_LOG) appendFileSync(process.env.SPECIALISTS_STUB_LOG, `${JSON.stringify(args)}\n`);
      const job = `act:acc-${Date.now().toString(36)}`;
      return reply(msg.id, { content: [{ type: "text", text: `Dispatched ${args.specialist} on ${args.issue} as ${job} (acceptance stub: no job was started).` }] });
    }
    case "ping":
      return reply(msg.id, {});
    default:
      return fail(msg.id, -32601, `method ${msg.method} not found`);
  }
});
