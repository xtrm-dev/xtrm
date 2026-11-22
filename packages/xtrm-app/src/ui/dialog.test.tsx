import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AdaptersProvider, fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
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

  it("takes the panel chrome by default", () => {
    render(
      frame(
        <DialogFrame title="Normalize" frameWidth={760} top={8}>
          <div>body</div>
          <DialogFrame.Footer>
            <button type="button">Save</button>
          </DialogFrame.Footer>
        </DialogFrame>,
      ),
    );
    // A panel header is a title row in the section gutter, with no trailing gap: the title is the row.
    const header = slot("dialog-header")!;
    expect(header.className).toContain("h-12");
    expect(header.className).toContain("px-5");
    expect(header.className).not.toContain("gap-2");
    // And a panel footer is an action row in the same gutter, not the palette's fixed-height hint row.
    // This is the third chrome string, and until the review it was the one nothing pinned: `px-4 py-2`
    // in place of `px-5 py-3` left every test green.
    const footer = slot("dialog-footer")!;
    expect(footer.className).toContain("px-5");
    expect(footer.className).toContain("py-3");
    expect(footer.className).not.toContain("h-9");
  });

  it("takes the palette chrome for a command list", () => {
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
    // The palette header holds an input, so it carries the inter-control gap the panel has no use for.
    const header = slot("dialog-header")!;
    expect(header.className).toContain("h-12");
    expect(header.className).toContain("px-4");
    expect(header.className).toContain("gap-2");
    // The palette's footer is a hint row, not an action row: shorter, tighter, micro text.
    const footer = slot("dialog-footer")!;
    expect(footer.className).toContain("h-9");
    expect(footer.className).toContain("px-4");
    expect(footer.className).toContain("text-xs");
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

  it("puts the geometry a call site passes into the popup's inline style", () => {
    // The frame's three numbers are a CONSTRAINT in XTRM-944's contract (760 / 8 / 84 for the
    // normalize dialog) and nothing asserted them: moving them to 800 / 4 / 40 left every test green.
    // jsdom cannot resolve layout, but it reads an inline style string perfectly well.
    render(
      frame(
        <DialogFrame title="Normalize" frameWidth={760} top={8} maxHeight={84}>
          <div>body</div>
        </DialogFrame>,
      ),
    );
    const popup = screen.getByRole("dialog", { name: "Normalize" }) as HTMLElement;
    expect(popup.style.top).toBe("8vh");
    expect(popup.style.maxHeight).toBe("84vh");
    // jsdom's CSSOM re-serialises the guard (`calc(100vw - 32px)` comes back as `-32px + 100vw`), so
    // the width is asserted on the number the caller passed and the viewport term, not on the exact
    // string: the exact string would pin the test to jsdom's arithmetic order rather than to the frame.
    expect(popup.style.width).toContain("760px");
    expect(popup.style.width).toContain("100vw");
    expect(popup.style.width).toContain("min(");
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

  it("renders the normalize dialog from its own call site, at the geometry the contract names", async () => {
    // XTRM-944's CONSTRAINT names three numbers for this dialog (760 wide, 8vh down, 84vh tall) and the
    // review's mutation was at the call site, not in the frame: `frameWidth={800} top={4} maxHeight={40}`
    // in `src/issues/IssueView.tsx` left the suite at 31 files / 297 tests passed. Rendering the frame
    // with those props would not catch that, so this opens the real dialog through the route.
    const history = createMemoryHistory({ initialEntries: ["/rep/xtrm-dev/xtrm/work/issues/XTRM-302"] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate() }, history, queryClient });
    render(<RouterProvider router={router} />);
    // XTRM-302 is the fixture's imported contract: its sections sit inside Problem, so the banner renders.
    fireEvent.click(await screen.findByRole("button", { name: "Review mapping" }));
    const popup = (await screen.findByRole("dialog", { name: /^Normalize XTRM-302 contract$/ })) as HTMLElement;
    expect(popup.style.top).toBe("8vh");
    expect(popup.style.maxHeight).toBe("84vh");
    expect(popup.style.width).toContain("760px");
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
