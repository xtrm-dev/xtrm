import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PR_STATES, PrKey, PrStateChip, prStateOf } from "./pr-key.tsx";

describe("prStateOf", () => {
  it("resolves the four states and treats a draft as its own state", () => {
    expect(prStateOf("open", false)).toBe("open");
    expect(prStateOf("open", true)).toBe("draft");
    expect(prStateOf("merged")).toBe("merged");
    expect(prStateOf("closed")).toBe("closed");
  });

  it("renders an unknown state instead of dropping it", () => {
    expect(prStateOf(null)).toBe("unknown");
    expect(prStateOf("queued")).toBe("unknown");
  });
});

describe("PrKey", () => {
  const key = (state: string, draft?: boolean) => {
    render(<PrKey number={42} state={state} draft={draft} />);
    return screen.getByLabelText(new RegExp("^Pull request #42"));
  };

  it("carries each state as a colour token, a glyph and an aria-label", () => {
    const cases: Array<[string, boolean | undefined, string, string]> = [
      ["open", undefined, "text-success", "Pull request #42, open"],
      ["open", true, "text-ink-muted", "Pull request #42, draft"],
      ["merged", undefined, "text-accent-ink", "Pull request #42, merged"],
      ["closed", undefined, "text-danger", "Pull request #42, closed"],
    ];
    for (const [state, draft, token, label] of cases) {
      const el = key(state, draft);
      expect(el.className).toContain(token);
      expect(el.querySelector("svg")).not.toBeNull();
      expect(el.getAttribute("aria-label")).toBe(label);
      expect(el.textContent).toContain("#42");
      document.body.innerHTML = "";
    }
  });

  it("drops the glyph only where the caller asks, and keeps the state in words", () => {
    render(<PrKey number={7} state="merged" glyph={false} repo="xtrm-dev/xtrm" />);
    const el = screen.getByLabelText("Pull request #7, merged");
    expect(el.querySelector("svg")).toBeNull();
    expect(el.getAttribute("title")).toContain("Merged");
    expect(el.textContent).toContain("xtrm-dev/xtrm");
  });

  it("goes quiet in a row that already shows a coloured status", () => {
    render(<PrKey number={9} state="open" quiet />);
    const el = screen.getByLabelText("Pull request #9, open");
    expect(el.className).toContain("text-ink-muted");
    expect(el.className).not.toContain("text-success");
  });
});

describe("PrStateChip", () => {
  it("renders the state word in its tone, with the glyph", () => {
    render(<PrStateChip state="open" />);
    const badge = screen.getByText("Open").closest("[data-slot='badge']") as HTMLElement;
    expect(badge.className).toContain("bg-chip-success");
    expect(badge.querySelector("svg")).not.toBeNull();
  });

  it("names the assumption where there is room for it", () => {
    render(<PrStateChip state="open" stateSource="assumed" showSource />);
    expect(screen.getByText("assumed").getAttribute("title")).toContain("not yet confirmed");
    expect(screen.getByText("Open").closest("[data-slot='badge']")!.getAttribute("title")).toContain("assumed");
  });

  it("renders an unknown state as a word, never an empty cell", () => {
    render(<PrStateChip state={null} />);
    const badge = screen.getByText("Unknown").closest("[data-slot='badge']") as HTMLElement;
    expect(badge.getAttribute("title")).toContain("no pull_requests row");
  });

  it("keeps a reported state it does not know in its own words", () => {
    render(<PrStateChip state="queued" />);
    const badge = screen.getByText("Queued").closest("[data-slot='badge']") as HTMLElement;
    expect(badge.getAttribute("title")).toContain("State reported by the source: queued");
    expect(screen.queryByText("Unknown")).toBeNull();
  });
});

describe("PR_STATES", () => {
  it("keeps a distinct glyph for every state, so colour is never the only cue", () => {
    const glyphs = Object.values(PR_STATES).map((meta) => meta.icon);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});
