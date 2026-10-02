/**
 * Claude adapter implementation notes.
 *
 * Use the CURRENT installed Anthropic Claude Agent SDK API and characterize its
 * live stream before finalizing event mapping.
 *
 * Desired mapping:
 * - SDK session listing/get messages -> app sidebar/reload;
 * - query/prompt start -> frame_started;
 * - assistant/tool stream -> normalized AppEvent activity;
 * - SDK result/settled boundary -> frame_settled;
 * - forkSession(sourceSessionId, { upToMessageId }) -> branch;
 * - resume/query against forked session -> continue branch.
 *
 * Do not assume Pi's same-file id/parentId tree semantics. Claude forks may be
 * represented by separate session IDs; the app's ConversationGraph can project
 * them as one visible tree.
 */
export {};
