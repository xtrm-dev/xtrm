import { describe, expect, it } from "vitest";
import type { AgentSessionSummary } from "../adapters/index.tsx";
import { findTarget, parseMessageCommand } from "./message.ts";

const session = (id: string, name: string, state: AgentSessionSummary["state"]) => ({ id, name, state }) as AgentSessionSummary;

describe("parseMessageCommand", () => {
  it("is null for anything but /message", () => {
    expect(parseMessageCommand("hello @session:peer", [])).toBeNull();
    expect(parseMessageCommand("/messages x", [])).toBeNull();
  });

  it("takes the first typed @session or @agent target and the remaining text", () => {
    expect(parseMessageCommand("/message @session:peer please rerun the tests", [])).toEqual({ target: { kind: "session", ref: "peer" }, text: "please rerun the tests" });
    expect(parseMessageCommand("/message see @issue:XTRM-1 @agent:quant-reviewer, now", [])).toEqual({ target: { kind: "agent", ref: "quant-reviewer" }, text: "see @issue:XTRM-1 now" });
  });

  it("falls back to an attached session chip", () => {
    expect(parseMessageCommand("/message ship it", [{ kind: "issue", ref: "XTRM-1" }, { kind: "session", ref: "peer" }])).toEqual({ target: { kind: "session", ref: "peer" }, text: "ship it" });
  });

  it("reports a missing target or empty text", () => {
    expect(parseMessageCommand("/message hi", [])).toEqual({ error: expect.stringContaining("needs a target") });
    expect(parseMessageCommand("/message @session:peer", [])).toEqual({ error: expect.stringContaining("has no text") });
  });
});

describe("findTarget", () => {
  it("matches by id or name and prefers a live session", () => {
    const list = [session("old", "peer", "history"), session("new", "peer", "settled"), session("x", "other", "working")];
    expect(findTarget(list, { kind: "session", ref: "peer" })?.id).toBe("new");
    expect(findTarget(list, { kind: "session", ref: "x" })?.name).toBe("other");
    expect(findTarget(list, { kind: "session", ref: "none" })).toBeNull();
  });
});
