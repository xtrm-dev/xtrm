import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { Activity, ToolActivity } from "../adapters/index.tsx";
import { ActivityThread, groupActivity, originTag, scriptResult } from "./Activity.tsx";

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
