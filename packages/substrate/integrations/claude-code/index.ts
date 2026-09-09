// Claude integration surface: MCP server + hook adapters + plugin manifest.
// Library-first (§6.1): every entry point below calls the typed service
// in-process. The only spawned processes are read-only git inspections
// inside git-provenance.ts; no adapter execs `sb` or parses CLI text.

export { handlePreCompact } from "./precompact.ts";
export type { PreCompactInput, PreCompactResult } from "./precompact.ts";
export { handlePostCompact } from "./postcompact.ts";
export type { PostCompactInput, PostCompactResult } from "./postcompact.ts";
export { handleSessionStart } from "./session-start.ts";
export type { SessionStartInput, SessionStartResult } from "./session-start.ts";
export { buildServer, SUBSTRATE_SERVER_NAME, SUBSTRATE_SERVER_VERSION, SUBSTRATE_PROTOCOL_REVISION } from "./mcp-server.ts";
export { collectGitContext, commitsSince } from "./git-provenance.ts";
export type { GitContext } from "./git-provenance.ts";
export { summarizeMechanical, createSemanticSummarizer, readTranscriptTail } from "./semantic-service.ts";
export { openHandles, resolveDbPath, discoverIssueRef } from "./runtime.ts";
