import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AdaptersProvider, fixtureAdapters } from "../adapters/index.tsx";
import { NewIssueDialog } from "../issues/NewIssueDialog.tsx";
import { CommandMenu } from "./command-menu.tsx";
import { Dialog, DialogFrame } from "./dialog.tsx";

// XTRM-944 review finding 1: the frame's chrome is the PR's largest structural claim and nothing
// could fail on it. Grepping `DialogFrame` over the suite found no test and no spec named the dialog
// role, so removing `data-slot="dialog-header"` or changing the palette header's `h-12` to `h-10`
// left every test green. These assertions are the ones those two mutations have to break.
//
// The chrome is read from the slot's class list because the tests run in jsdom, which resolves no
// layout: "the header is 48px" is a browser question, "the header asks for h-12 and the palette
// gutter" is the question a unit test can answer, and it is the question the mutation changes.

function frame(node: ReactNode, open = true) {
  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>{node}</Dialog.Portal>
    </Dialog.Root>
  );
}

const slot = (name: string) => document.querySelector(`[data-slot="${name}"]`) as HTMLElement | null;

describe("DialogFrame", () => {
  it("marks the header and the footer rows it owns", () => {
    render(
      frame(
        <DialogFrame title="New issue" frameWidth={720} top={6}>
          <div>body</div>
          <DialogFrame.Footer>
            <button type="button">Save</button>
          </DialogFrame.Footer>
        </DialogFrame>,
      ),
    );
    // The slot names are the contract: a caller styles or selects nothing else.
    expect(slot("dialog-header"), "the frame must own a header row").not.toBeNull();
    expect(slot("dialog-footer"), "the frame must own a footer row").not.toBeNull();
    expect(screen.getByRole("dialog", { name: "New issue" })).toBeTruthy();
    expect(within(slot("dialog-footer")!).getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("takes the panel chrome by default and the palette chrome for a command list", () => {
    const { unmount } = render(
      frame(
        <DialogFrame title="Normalize" frameWidth={760} top={8}>
          <div>body</div>
        </DialogFrame>,
      ),
    );
    // A panel header is a title row in the section gutter; an input row needs its own gap instead.
    const panelHeader = slot("dialog-header")!;
    expect(panelHeader.className).toContain("h-12");
    expect(panelHeader.className).toContain("px-5");
    expect(panelHeader.className).not.toContain("gap-2");
    unmount();

    render(
      frame(
        <DialogFrame tone="palette" label="Search and commands" frameWidth={640} top={14} header={<input aria-label="query" />}>
          <div>body</div>
          <DialogFrame.Footer tone="palette">
            <kbd>esc</kbd>
          </DialogFrame.Footer>
        </DialogFrame>,
      ),
    );
    const paletteHeader = slot("dialog-header")!;
    expect(paletteHeader.className).toContain("h-12");
    expect(paletteHeader.className).toContain("px-4");
    expect(paletteHeader.className).toContain("gap-2");
    // The palette's footer is a hint row, not an action row: shorter, tighter, micro text.
    const paletteFooter = slot("dialog-footer")!;
    expect(paletteFooter.className).toContain("h-9");
    expect(paletteFooter.className).toContain("px-4");
    expect(paletteFooter.className).toContain("text-xs");
    expect(screen.getByRole("dialog", { name: "Search and commands" })).toBeTruthy();
  });

  it("lets a caller own the header row instead of the title", () => {
    render(
      frame(
        <DialogFrame label="Search and commands" frameWidth={640} top={14} header={<input aria-label="query" />}>
          <div>body</div>
        </DialogFrame>,
      ),
    );
    // The palette's input is its header: the frame must not also render a title row above it.
    const header = slot("dialog-header")!;
    expect(within(header).getByRole("textbox", { name: "query" })).toBeTruthy();
    expect(within(header).queryByRole("heading")).toBeNull();
    // And with a header and no title, the popup is named by `label`.
    expect(screen.getByRole("dialog", { name: "Search and commands" })).toBeTruthy();
  });
});

describe("DialogFrame call sites", () => {
  it("renders the New issue dialog with its title and its action footer", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AdaptersProvider adapters={fixtureAdapters}>
          <NewIssueDialog open onOpenChange={() => {}} projectId="prj_x" onCreated={() => {}} />
        </AdaptersProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("dialog", { name: "New issue" })).toBeTruthy();
    const footer = slot("dialog-footer");
    expect(footer, "the create dialog's actions live in the frame's footer").not.toBeNull();
    expect(within(footer!).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(within(footer!).getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("renders the command palette with its label and its hint footer", () => {
    render(
      <CommandMenu
        open
        onOpenChange={() => {}}
        query=""
        onQueryChange={() => {}}
        placeholder="Search…"
        groups={[{ heading: "Pages", entries: [{ id: "issues", label: "Issues", icon: "issues", onSelect: () => {} }] }]}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Search and commands" })).toBeTruthy();
    const footer = slot("dialog-footer");
    expect(footer, "the palette's key hints live in the frame's footer").not.toBeNull();
    // Three hints, and the close hint is pushed to the trailing edge by its own margin.
    expect(within(footer!).getAllByText(/open|commands|close/).length).toBe(3);
    expect(within(footer!).getByText("close").className).toContain("ml-auto");
  });
});
