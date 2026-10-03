import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { Activity, ToolActivity } from "../adapters/index.tsx";
import { ActivityThread, coordinationOf, groupActivity, originTag, promptOutcome, scriptResult } from "./Activity.tsx";

const tool = (id: string, over: Partial<ToolActivity> = {}): ToolActivity => ({ kind: "tool", id, class: "native", name: "read", subject: "notes.txt", status: "done", durationMs: 5, origin: {}, ...over });

const script = tool("s", {
  name: "codemode",
  subject: "const r = await tools.mcp__demo__echo({})",
  script: "const r = await tools.mcp__demo__echo({});\nreturn r;",
  output: "Script completed\nWall time 0.1 seconds\nOutput:\n{\"ok\":true}",
  children: [tool("s/1", { class: "mcp", name: "mcp__demo__echo", subject: "hi", origin: { server: "demo" } }), tool("s/2")],
});

function Thread({ activity }: { activity: Activity[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return <ActivityThread activity={activity} isOpen={(id) => !!open[id]} toggle={(id) => setOpen((o) => ({ ...o, [id]: !o[id] }))} onAnswer={() => {}} />;
}

describe("tool activity rendering (PRD §36.7)", () => {
  it("never groups scripts or calls with nested calls into native groups", () => {
    expect(groupActivity([tool("a"), script, tool("b")]).map((b) => b.type)).toEqual(["native", "single", "native"]);
  });

  it("renders codemode as a script block with its nested calls in order, each with its own origin", () => {
    render(<Thread activity={[script]} />);
    const block = screen.getByTestId("activity-script");
    expect(within(block).getByTestId("script-verdict").textContent).toBe("Script completed");
    expect(block.textContent).toContain("0.1 seconds · 2 calls");
    const calls = within(block).getAllByTestId("nested-call");
    expect(calls.map((c) => [c.getAttribute("data-class"), c.textContent?.slice(0, 22)])).toEqual([
      ["mcp", "MCP demomcp__demo__ech"],
      ["native", "nativereadnotes.txt5ms"],
    ]);
    expect(within(block).queryByTestId("script-source")).toBeNull();
    fireEvent.click(within(block).getByRole("button", { name: "Script source" }));
    expect(within(block).getByTestId("script-source").textContent).toContain("return r;");
    expect(block.textContent).toContain('{"ok":true}');
  });

  it("keeps a failed script's partial output and its calls", () => {
    const failed = { ...script, status: "error" as const, output: "Script failed\nWall time 0.2 seconds\nOutput:\npartial\nScript error: boom" };
    expect(scriptResult(failed)).toEqual({ verdict: "Script failed", wall: "0.2 seconds", output: "partial\nScript error: boom" });
    render(<Thread activity={[failed]} />);
    expect(screen.getByTestId("script-verdict").textContent).toBe("Script failed");
    expect(screen.getAllByTestId("nested-call")).toHaveLength(2);
  });

  it("labels origins from the host fields only", () => {
    expect(originTag(tool("x", { class: "mcp", origin: {} }))).toBe("MCP");
    expect(originTag(tool("x", { class: "extension", origin: { extension: "pi-guardrails", version: "0.4.1" } }))).toBe("pi-guardrails 0.4.1");
    expect(originTag(tool("x", { class: "coordination", origin: { extension: "specialists" } }))).toBe("coordination · specialists");
  });
});

describe("extension UI requests (XTRM-597)", () => {
  const ui = (over: object = {}) => ({ type: "confirm" as const, prompt: "Probe", detail: "Allow the probe?", options: ["Yes", "No"], answer: null, ...over });

  it("renders an open request with its choices and sends the chosen answer", () => {
    const answers: Array<[string, string | null]> = [];
    render(<ActivityThread activity={[{ kind: "prompt", id: "u1", ui: ui() }]} isOpen={() => false} toggle={() => {}} onAnswer={(id, a) => answers.push([id, a])} />);
    const req = screen.getByTestId("extension-request");
    expect(req.textContent).toContain("Allow the probe?");
    fireEvent.click(within(req).getByRole("button", { name: "Yes" }));
    expect(answers).toEqual([["u1", "Yes"]]);
  });

  it("closes the block whoever answered", () => {
    expect(promptOutcome(ui())).toBeNull();
    expect(promptOutcome(ui({ answer: "Yes", resolved: { by: "host", outcome: "answered" } }))).toBe("Answered Yes");
    expect(promptOutcome(ui({ resolved: { by: "host", outcome: "answered" } }))).toBe("Answered from the app");
    expect(promptOutcome(ui({ resolved: { by: "local", outcome: "answered" } }))).toBe("Answered in the terminal");
    expect(promptOutcome(ui({ resolved: { by: "local", outcome: "cancelled" } }))).toBe("Cancelled in the terminal");
    render(<ActivityThread activity={[{ kind: "prompt", id: "u1", ui: ui({ resolved: { by: "local", outcome: "answered" } }) }]} isOpen={() => false} toggle={() => {}} onAnswer={() => {}} />);
    expect(screen.queryByTestId("extension-request")).toBeNull();
    expect(screen.getByTestId("extension-request-outcome").getAttribute("data-resolved-by")).toBe("local");
  });

  it("takes text for an input request", () => {
    const answers: Array<string | null> = [];
    render(<ActivityThread activity={[{ kind: "prompt", id: "u2", ui: { type: "input", prompt: "Name", options: [], answer: null } }]} isOpen={() => false} toggle={() => {}} onAnswer={(_, a) => answers.push(a)} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "probe" } });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(answers).toEqual(["probe"]);
  });
});

// XTRM-601 (§36.11 criterion 14): a coordination-class tool renders as the §14 semantic activity.
describe("coordination-class tools", () => {
  const dispatch = tool("d", {
    class: "coordination",
    name: "mcp__specialists__specialist_dispatch",
    subject: "executor",
    origin: { server: "specialists" },
    args: { specialist: "executor", issue: "XTRM-601", prompt: "Run the acceptance checks" },
    output: "Dispatched executor on XTRM-601 as act:1",
  });

  it("maps the call to a dispatch with peer, work item and transport", () => {
    expect(coordinationOf(dispatch)).toMatchObject({
      action: "dispatch",
      peer: "executor",
      workRef: "XTRM-601",
      summary: "Run the acceptance checks",
      status: "done",
      transport: "MCP specialists · mcp__specialists__specialist_dispatch · Dispatched executor on XTRM-601 as act:1",
    });
    expect(coordinationOf(tool("m", { class: "coordination", name: "intercom", origin: { extension: "pi-intercom" }, args: { to: "peer", message: "hi" } }))).toMatchObject({ action: "message", peer: "peer", transport: "pi-intercom · intercom" });
  });

});
