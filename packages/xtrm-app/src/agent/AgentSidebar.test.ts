import { describe, expect, it } from "vitest";
import type { AgentSessionSummary } from "../adapters/index.tsx";
import { acceptsLabel, buildSessionItems, outsideGroup } from "./AgentSidebar.tsx";
import { modelLabel, modelProvider } from "./meta.tsx";

const session = (over: Partial<AgentSessionSummary>): AgentSessionSummary => ({
  id: "s1",
  name: "s1",
  title: "s1",
  provider: "pi",
  state: "settled",
  role: null,
  workRef: null,
  repo: "xtrm-dev/xtrm",
  model: null,
  thinking: null,
  context: null,
  startedAt: 0,
  lastActivityAt: 0,
  parentId: null,
  childCount: 0,
  frameCount: 0,
  capabilities: [],
  origin: "terminal",
  ...over,
});

// XTRM-616: details show state and capabilities apart; the model reads the same everywhere.
describe("session details labels", () => {
  it("lists what a session accepts apart from its state", () => {
    expect(acceptsLabel(session({ state: "working", capabilities: ["prompt", "steer", "abort"] }))).toBe("prompt · steer · abort");
    expect(acceptsLabel(session({ state: "settled", capabilities: ["presence"] }))).toBe("presence only");
    expect(acceptsLabel(session({ state: "history", capabilities: [] }))).toBeNull();
  });

  it("shows the model one way, with the provider apart", () => {
    const s = session({ model: "opencode-go/deepseek-v4.1-flash", thinking: "high" });
    expect(modelLabel(s)).toBe("deepseek-v4.1-flash · high");
    expect(modelProvider(s.model)).toBe("opencode-go");
    expect(modelLabel(session({ model: "claude-opus-5-5" }))).toBe("opus 5.5");
    expect(modelProvider("claude-opus-5-5")).toBeNull();
    expect(modelProvider(null)).toBeNull();
  });
});

describe("buildSessionItems", () => {
  const here = session({ id: "a", repo: "xtrm-dev/xtrm", state: "working" });
  const elsewhere = session({ id: "b", repo: "xtrm-dev/core" });
  const unbound = session({ id: "c", repo: null });
  const groups = (items: ReturnType<typeof buildSessionItems>) => items.flatMap((i) => (i.type === "header" ? [`${i.label}:${i.count}`] : []));

  it("keeps the open session visible in repository scope when it is in another repository", () => {
    expect(outsideGroup("xtrm-dev/xtrm")).toBe("Open · not in xtrm");
    expect(groups(buildSessionItems([here, elsewhere, unbound], "repository", "xtrm-dev/xtrm", "", "b"))).toEqual(["Live:1", "Open · not in xtrm:1"]);
    expect(groups(buildSessionItems([elsewhere, unbound], "repository", "xtrm-dev/xtrm", "", "c"))).toEqual(["Open · not in xtrm:1"]);
    expect(groups(buildSessionItems([here, elsewhere], "repository", "xtrm-dev/xtrm", "", "a"))).toEqual(["Live:1"]);
    expect(buildSessionItems([elsewhere], "repository", "xtrm-dev/xtrm", "", null)).toEqual([]);
  });

  it("applies the text filter to the open session too", () => {
    expect(buildSessionItems([elsewhere], "repository", "xtrm-dev/xtrm", "nothing", "b")).toEqual([]);
  });

  it("does not add the open group in the all scope", () => {
    expect(groups(buildSessionItems([here, elsewhere], "all", "xtrm-dev/xtrm", "", "b"))).toEqual(["xtrm-dev/xtrm:1", "xtrm-dev/core:1"]);
  });
});
