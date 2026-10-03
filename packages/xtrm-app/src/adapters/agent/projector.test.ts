import { describe, expect, it } from "vitest";
import { AgentProjector, frameTitle, resultText, toolSubject } from "./projector.ts";
import type { HostEventMessage, HostEventPayload } from "./protocol.ts";

// Payload shapes follow a real xt host 0.14.0 + Pi 1.0.0 run (read, direct MCP, codemode script).
const SID = "01a100cb";
let cursor = 0;
const ev = (payload: HostEventPayload, at = 1_000 + cursor * 10): HostEventMessage => {
  cursor += 1;
  return { schema: "xtrm.agent-host-api.v1", kind: "event", cursor: String(cursor), frame: { schema: "xtrm.agent-event.v1", seq: cursor, sessionId: SID, at, payload } };
};
const builtin = (name: string) => ({ sourceInfo: { path: `builtin:${name}`, source: "builtin" } });
const assistant = (text: string, extra: Record<string, unknown> = {}) => ({ role: "assistant", content: [{ type: "text", text }], ...extra });
const CODE = "// @options: {\"timeout_ms\": 1000}\nconst [echo, file] = await Promise.all([\n  tools.mcp__demo_script__echo({ message: 'from script' }),\n  tools.read({ path: 'notes.txt' }),\n]);\nreturn { echo, file };";

function run(): AgentProjector {
  cursor = 0;
  const p = new AgentProjector();
  const P = "call_7c";
  const events: HostEventPayload[] = [
    { type: "session_identity", capabilities: ["presence", "stream", "prompt"] },
    { type: "before_agent_start", prompt: "Read notes.txt, echo, then run a script.\nSecond line.", ingress: { origin: "terminal" } },
    { type: "agent_start" },
    { type: "tool_execution_start", toolCallId: "call_r", toolName: "read", args: { path: "notes.txt" }, tool: builtin("read"), origin: { class: "native" } },
    { type: "tool_execution_end", toolCallId: "call_r", toolName: "read", result: { content: [{ type: "text", text: "hello from the probe\n" }] }, isError: false, origin: { class: "native" } },
    { type: "tool_execution_start", toolCallId: "call_m", toolName: "mcp__demo_direct__echo", args: { message: "direct hello" }, origin: { class: "mcp", server: "demo_direct" } },
    { type: "tool_execution_end", toolCallId: "call_m", toolName: "mcp__demo_direct__echo", result: { content: [{ type: "text", text: "Echo: direct hello" }] }, isError: false, origin: { class: "mcp", server: "demo_direct" } },
    { type: "tool_execution_start", toolCallId: P, toolName: "codemode", args: { code: CODE }, tool: builtin("codemode"), origin: { class: "native" } },
    { type: "tool_execution_update", toolCallId: P, toolName: "codemode", partialResult: { content: [], details: { calls: [] } }, origin: { class: "native" } },
    { type: "tool_execution_start", toolCallId: `${P}/1`, parentToolCallId: P, toolName: "mcp__demo_script__echo", args: { message: "from script" }, origin: { class: "mcp", server: "demo_script" } },
    { type: "tool_execution_start", toolCallId: `${P}/2`, parentToolCallId: P, toolName: "read", args: { path: "notes.txt" }, tool: builtin("read"), origin: { class: "native" } },
    { type: "tool_execution_end", toolCallId: `${P}/2`, parentToolCallId: P, toolName: "read", result: { content: [{ type: "text", text: "hello" }] }, isError: false, origin: { class: "native" } },
    { type: "tool_execution_end", toolCallId: `${P}/1`, parentToolCallId: P, toolName: "mcp__demo_script__echo", result: { content: [{ type: "text", text: "Echo: from script" }] }, isError: false, origin: { class: "mcp", server: "demo_script" } },
    { type: "tool_execution_end", toolCallId: P, toolName: "codemode", result: { content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }, { type: "text", text: "{\"echo\":1}" }] }, isError: false, origin: { class: "native" } },
    { type: "message_update", message: assistant("Done") },
    { type: "message_end", message: assistant("Done: all three steps.", { model: "deepseek-v4.1-flash", thinkingLevel: "high", stopReason: "stop", usage: { input: 200, cacheRead: 1000, output: 40, cost: { total: 0.001 } } }) },
    { type: "agent_end", messages: [] },
  ];
  for (const e of events) p.apply(ev(e));
  return p;
}

describe("AgentProjector", () => {
  it("opens a Frame on before_agent_start and keeps it open through agent_end", () => {
    const p = run();
    const [f] = p.snapshot(SID);
    expect(p.snapshot(SID)).toHaveLength(1);
    expect(f!.status).toBe("working");
    expect(f!.settledAt).toBeNull();
    expect(f!.title).toBe("Read notes.txt, echo, then run a script.");
    expect(f!.ingress).toMatchObject({ origin: "terminal", text: expect.stringContaining("Second line.") });
    expect(f!.response).toBe("Done: all three steps.");
  });

  it("closes the Frame only on agent_settled, once", () => {
    const p = run();
    p.apply(ev({ type: "agent_settled" }, 9_000));
    p.apply(ev({ type: "agent_settled" }, 9_500));
    const frames = p.snapshot(SID);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ status: "settled", settledAt: 9_000 });
  });

  it("takes tool class and server from the host origin and nests calls inside their parent", () => {
    const [f] = run().snapshot(SID);
    const tools = f!.activity.filter((a) => a.kind === "tool");
    expect(tools.map((t) => [t.name, t.class, t.origin.server])).toEqual([
      ["read", "native", undefined],
      ["mcp__demo_direct__echo", "mcp", "demo_direct"],
      ["codemode", "native", undefined],
    ]);
    const script = tools[2]!;
    expect(script.script).toBe(CODE);
    expect(script.subject).toBe("const [echo, file] = await Promise.all([");
    expect(script.output).toBe("Script completed\nWall time 0.1 seconds\nOutput:\n{\"echo\":1}");
    // Nested calls keep start order and their own origin, not the order they ended in.
    expect(script.children!.map((c) => [c.id, c.class, c.origin.server, c.status])).toEqual([
      ["call_7c/1", "mcp", "demo_script", "done"],
      ["call_7c/2", "native", undefined, "done"],
    ]);
    expect(tools[0]).toMatchObject({ subject: "notes.txt", status: "done", output: "hello from the probe\n" });
  });

  it("records model, thinking, tokens and cost from assistant messages", () => {
    const s = run().sessions.get(SID)!;
    expect(s).toMatchObject({ model: "deepseek-v4.1-flash", thinking: "high", tokens: { input: 1200, output: 40 }, costUsd: 0.001 });
  });

  it("opens a Frame on agent_start for producers that report no prompt (Claude hooks)", () => {
    cursor = 0;
    const p = new AgentProjector();
    p.apply(ev({ type: "agent_start" }));
    p.apply(ev({ type: "tool_execution_start", toolCallId: "toolu_1", toolName: "Bash", args: { command: "ls" }, origin: { class: "native" } }));
    p.apply(ev({ type: "tool_execution_end", toolCallId: "toolu_1", toolName: "Bash", result: null, isError: false, origin: { class: "native" } }));
    p.apply(ev({ type: "agent_end", messages: [] }));
    p.apply(ev({ type: "agent_settled" }));
    const [f] = p.snapshot(SID);
    expect(f).toMatchObject({ title: "Prompt text not reported", status: "settled" });
    expect(f!.activity[0]).toMatchObject({ name: "Bash", subject: "ls", status: "done" });
    expect(f!.activity[0]).not.toHaveProperty("output");
  });

  it("marks a Frame failed when the last assistant message stopped on error", () => {
    cursor = 0;
    const p = new AgentProjector();
    p.apply(ev({ type: "before_agent_start", prompt: "x", ingress: { origin: "gui" } }));
    p.apply(ev({ type: "message_end", message: assistant("", { stopReason: "error" }) }));
    p.apply(ev({ type: "agent_settled" }));
    expect(p.snapshot(SID)[0]!.status).toBe("failed");
  });

  it("numbers retained Frames against the host Frame count", () => {
    const p = run();
    expect(p.snapshot(SID, 7)[0]!.index).toBe(7);
  });

  it("shows calls without a host origin as extension calls", () => {
    cursor = 0;
    const p = new AgentProjector();
    p.apply(ev({ type: "before_agent_start", prompt: "x", ingress: { origin: "gui" } }));
    p.apply(ev({ type: "tool_execution_start", toolCallId: "t", toolName: "mystery", args: {} }));
    expect(p.snapshot(SID)[0]!.activity[0]).toMatchObject({ class: "extension", origin: {} });
  });
});

describe("write path projection (XTRM-597)", () => {
  const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });

  it("renders extension UI requests in the open Frame and closes them on extension_ui_resolved", () => {
    cursor = 0;
    const p = new AgentProjector();
    p.apply(ev({ type: "before_agent_start", prompt: "probe", ingress: { origin: "gui", commandId: "c1" } }));
    p.apply(ev({ type: "extension_ui_request", id: "u1", method: "confirm", title: "Probe", message: "Allow?" }));
    p.apply(ev({ type: "extension_ui_request", id: "u2", method: "select", title: "Pick", options: ["a", "b"] }));
    p.apply(ev({ type: "extension_ui_request", id: "u3", method: "editor", title: "Edit" }));
    let f = p.snapshot(SID)[0]!;
    expect(f.ingress.origin).toBe("gui");
    expect(f.activity).toEqual([
      { kind: "prompt", id: "u1", ui: { type: "confirm", prompt: "Probe", detail: "Allow?", options: ["Yes", "No"], answer: null } },
      { kind: "prompt", id: "u2", ui: { type: "select", prompt: "Pick", options: ["a", "b"], answer: null } },
    ]);
    expect(p.sessions.get(SID)!.prompts.size).toBe(2);
    p.apply(ev({ type: "extension_ui_resolved", id: "u1", resolvedBy: "host", outcome: "answered" }));
    p.apply(ev({ type: "extension_ui_resolved", id: "u2", resolvedBy: "local", outcome: "cancelled" }));
    f = p.snapshot(SID)[0]!;
    expect(f.activity.map((a) => (a.kind === "prompt" ? a.ui.resolved : null))).toEqual([
      { by: "host", outcome: "answered" },
      { by: "local", outcome: "cancelled" },
    ]);
    expect(p.sessions.get(SID)!.prompts.size).toBe(0);
  });

  it("closes an aborted Frame as aborted, also when the abort surfaces as an AbortError", () => {
    cursor = 0;
    const p = new AgentProjector();
    p.apply(ev({ type: "before_agent_start", prompt: "sleep", ingress: { origin: "gui" } }));
    p.apply(ev({ type: "message_end", message: assistant("", { stopReason: "error", errorMessage: "This operation was aborted" }) }));
    p.apply(ev({ type: "agent_settled" }));
    p.apply(ev({ type: "before_agent_start", prompt: "again", ingress: { origin: "gui" } }));
    p.apply(ev({ type: "message_end", message: assistant("", { stopReason: "error", errorMessage: "401 unauthorized" }) }));
    p.apply(ev({ type: "agent_settled" }));
    expect(p.snapshot(SID).map((f) => f.status)).toEqual(["aborted", "failed"]);
  });

  it("shows user messages after the Frame request as delivered steers", () => {
    cursor = 0;
    const p = new AgentProjector();
    p.apply(ev({ type: "before_agent_start", prompt: "count", ingress: { origin: "gui" } }));
    p.apply(ev({ type: "message_end", message: user("count") }));
    p.apply(ev({ type: "message_end", message: user("stop at 3") }));
    p.apply(ev({ type: "agent_settled" }));
    p.apply(ev({ type: "before_agent_start", prompt: "next", ingress: { origin: "terminal" } }));
    p.apply(ev({ type: "message_end", message: user("next") }));
    const [a, b] = p.snapshot(SID);
    expect(a!.activity).toEqual([{ kind: "steer", id: `${SID}:3`, text: "Delivered while working: stop at 3" }]);
    expect(b!.activity).toEqual([]);
    expect(b!.ingress.origin).toBe("terminal");
  });
});

describe("projection helpers", () => {
  it("derives subjects, results and titles", () => {
    expect(toolSubject({ command: "npm test" })).toBe("npm test");
    expect(toolSubject({ other: 1, note: "first string" })).toBe("first string");
    expect(resultText({ content: [{ type: "text", text: "a" }, { type: "image", data: "" }, { type: "text", text: "b" }] })).toBe("ab");
    expect(resultText({ exit: 0 })).toBe('{"exit":0}');
    expect(resultText(null)).toBeUndefined();
    expect(frameTitle("x".repeat(100))).toHaveLength(80);
  });
});
