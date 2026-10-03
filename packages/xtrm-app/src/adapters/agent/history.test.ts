import { describe, expect, it } from "vitest";
import { historyEvents, mergeFrames, projectHistory } from "./history.ts";
import { AgentProjector } from "./projector.ts";
import type { HostEventPayload } from "./protocol.ts";

const SID = "s1";
let n = 0;
const entry = (message: Record<string, unknown>) => ({ type: "message", id: `e${++n}`, parentId: null, timestamp: new Date(1_000 + n).toISOString(), message });
const user = (text: string, timestamp: number) => entry({ role: "user", content: [{ type: "text", text }], timestamp });
const assistant = (text: string, timestamp: number, calls: Array<[string, string]> = []) =>
  entry({
    role: "assistant",
    content: [{ type: "text", text }, ...calls.map(([id, name]) => ({ type: "toolCall", id, name, arguments: { path: `${id}.txt` } }))],
    stopReason: calls.length ? "toolUse" : "stop",
    timestamp,
  });
const result = (toolCallId: string, timestamp: number, isError = false) => entry({ role: "toolResult", toolCallId, toolName: "read", content: [{ type: "text", text: `out ${toolCallId}` }], isError, timestamp });

/** Three Frames: a read, a steered run with two calls, and a plain answer. */
function journal() {
  n = 0;
  return [
    user("first", 10),
    assistant("", 11, [["t1", "read"]]),
    result("t1", 12),
    assistant("one", 13),
    user("second", 20),
    assistant("", 21, [["t2", "read"]]),
    result("t2", 22),
    user("also this", 23),
    assistant("", 24, [["t3", "bash"]]),
    result("t3", 25, true),
    assistant("two", 26),
    { type: "compaction", id: "c1", parentId: null, timestamp: new Date(2_000).toISOString(), summary: "s" },
    user("third", 30),
    assistant("three", 31),
  ];
}

describe("session history projection (XTRM-604)", () => {
  it("projects each journal Frame with its calls, results, steer and response", () => {
    const h = projectHistory(SID, journal(), false);
    expect(h.frames.map((f) => [f.title, f.status, f.response])).toEqual([
      ["first", "settled", "one"],
      ["second", "settled", "two"],
      ["third", "settled", "three"],
    ]);
    const second = h.frames[1]!;
    expect(second.activity.map((a) => [a.kind, a.id.startsWith("s1:") ? "note" : a.id])).toEqual([
      ["tool", "t2"],
      ["steer", "note"],
      ["tool", "t3"],
      ["compaction", "note"],
    ]);
    expect(second.activity[2]).toMatchObject({ kind: "tool", name: "bash", subject: "t3.txt", status: "error", output: "out t3" });
    expect([...h.keys.values()]).toEqual([[10], [20, 23], [30]]);
  });

  it("leaves a run that still asks for tools open, and closes it as aborted once the session stopped", () => {
    n = 0;
    const entries = [user("go", 1), assistant("", 2, [["t1", "read"]])];
    expect(projectHistory(SID, entries, false).frames[0]!.status).toBe("working");
    expect(projectHistory(SID, entries, true).frames[0]!.status).toBe("aborted");
    expect(historyEvents(SID, [], true)).toEqual([]);
  });
});

describe("merging history with the stream (XTRM-604)", () => {
  let cursor = 0;
  const ev = (payload: HostEventPayload) => ({ schema: "xtrm.agent-host-api.v1" as const, kind: "event" as const, cursor: String(++cursor), frame: { schema: "xtrm.agent-event.v1" as const, seq: cursor, sessionId: SID, at: 5_000 + cursor, payload } });
  const msg = (role: string, text: string, timestamp: number) => ({ role, content: [{ type: "text", text }], timestamp });

  /** The stream after the replay buffer cut into Frame 2: its t3 call, then Frame 3, then a new Frame 4. */
  function stream() {
    cursor = 0;
    const p = new AgentProjector();
    p.apply(ev({ type: "tool_execution_start", toolCallId: "t3", toolName: "bash", args: { command: "ls" }, origin: { class: "native" } }));
    p.apply(ev({ type: "tool_execution_end", toolCallId: "t3", toolName: "bash", result: { content: "live out" }, isError: true }));
    p.apply(ev({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "two" }], stopReason: "stop", timestamp: 26 } }));
    p.apply(ev({ type: "agent_settled" }));
    for (const [text, at] of [["third", 30], ["fourth", 40]] as const) {
      p.apply(ev({ type: "before_agent_start", prompt: text, ingress: { origin: "gui" } }));
      p.apply(ev({ type: "message_end", message: msg("user", text, at) }));
      p.apply(ev({ type: "message_end", message: { ...msg("assistant", `${text} done`, at + 1), stopReason: "stop" } }));
      p.apply(ev({ type: "agent_settled" }));
    }
    return p.sessions.get(SID)!;
  }

  it("shows every Frame once across the buffer boundary, numbered from 1", () => {
    const live = stream();
    expect(live.frames).toHaveLength(3);
    const merged = mergeFrames(projectHistory(SID, journal(), false), live.frames, live.keys);
    expect(merged.map((f) => [f.index, f.title, f.ingress.origin])).toEqual([
      [1, "first", "terminal"],
      [2, "second", "terminal"],
      [3, "third", "gui"],
      [4, "fourth", "gui"],
    ]);
    // The cut Frame keeps its history calls and the live call (with its origin) once.
    const second = merged[1]!;
    expect(second.activity.filter((a) => a.kind === "tool").map((a) => [a.id, a.kind === "tool" ? a.class : null])).toEqual([
      ["t2", "extension"],
      ["t3", "native"],
    ]);
    expect(second.response).toBe("two");
    expect(merged[2]!.response).toBe("third done");
  });

  it("keeps history Frames when the stream has none, and live Frames when the journal has none yet", () => {
    const h = projectHistory(SID, journal(), true);
    expect(mergeFrames(h, [], new Map()).map((f) => f.title)).toEqual(["first", "second", "third"]);
    const live = stream();
    expect(mergeFrames({ frames: [], keys: new Map(), truncated: false }, live.frames, live.keys)).toHaveLength(3);
  });
});

// XTRM-601: a stopped session's tokens, cost and last context come from the usage its journal recorded.
describe("journal usage", () => {
  const used = (text: string, timestamp: number, usage: Record<string, unknown>) => ({ ...assistant(text, timestamp), message: { ...assistant(text, timestamp).message, model: "deepseek-v4.1-flash", usage } });

  it("sums tokens and cost and keeps the context of the last response", () => {
    n = 0;
    const h = projectHistory(SID, [user("a", 1), used("x", 2, { input: 100, output: 10, cacheRead: 900, totalTokens: 1010, cost: { total: 0.01 } }), user("b", 3), used("y", 4, { input: 50, output: 5, cacheRead: 1100, totalTokens: 1155, cost: { total: 0.02 } })], true);
    expect(h.tokens).toEqual({ input: 2150, output: 15 });
    expect(h.costUsd).toBeCloseTo(0.03);
    expect(h.contextTokens).toBe(1155);
    expect(h.model).toBe("deepseek-v4.1-flash");
  });

  it("knows no context after a compaction until the next response", () => {
    n = 0;
    const h = projectHistory(SID, [user("a", 1), used("x", 2, { input: 100, output: 10, totalTokens: 110 }), { type: "compaction", id: "c", parentId: null, timestamp: new Date(5).toISOString(), summary: "s" }], true);
    expect(h.contextTokens).toBeNull();
  });
});
