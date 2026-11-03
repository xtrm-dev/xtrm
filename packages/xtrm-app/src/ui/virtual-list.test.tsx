import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VirtualList } from "./virtual-list.tsx";

function rows(count: number) {
  return Array.from({ length: count }, (_, i) => `row-${i}`);
}

function renderList({ header }: { header?: boolean } = {}) {
  return render(
    <VirtualList
      label="Probe"
      items={rows(3)}
      rowHeight={32}
      flush
      minWidth="60rem"
      getKey={(r) => r}
      header={header ? <div data-testid="probe-header" /> : undefined}
      renderRow={(r) => <div data-testid="probe-row">{r}</div>}
    />,
  );
}

/** The scroll container the virtualizer binds to, found from a row upwards. */
function scrollerOf(row: HTMLElement): HTMLElement {
  let node = row.parentElement;
  while (node && !node.className.includes("overflow-y-auto")) node = node.parentElement;
  if (!node) throw new Error("no vertical scroller above the row");
  return node;
}

// The scrollbar is drawn by the vertical scroll container, so a header inside that container puts
// the rail through the header (XTRM-694). The header belongs above the scroller, still inside the
// horizontal one so the columns stay aligned when the table scrolls sideways.
describe("VirtualList header placement", () => {
  it("renders the header outside the vertical scroll container", () => {
    renderList({ header: true });
    const header = screen.getByTestId("probe-header");
    const scroller = scrollerOf(screen.getAllByTestId("probe-row")[0]!);
    expect(scroller.contains(header)).toBe(false);
    expect(header.parentElement?.parentElement?.parentElement).toBe(scroller.parentElement);
  });

  it("keeps the header strip at the rows' horizontal offset", () => {
    renderList({ header: true });
    const header = screen.getByTestId("probe-header");
    const strip = header.parentElement!.parentElement!;
    const scroller = scrollerOf(screen.getAllByTestId("probe-row")[0]!);
    scroller.scrollLeft = 120;
    fireEvent.scroll(scroller);
    expect(strip.scrollLeft).toBe(120);
  });

  it("renders a headerless list as one flat scroller", () => {
    renderList();
    const scroller = scrollerOf(screen.getAllByTestId("probe-row")[0]!);
    expect((scroller.firstElementChild as HTMLElement).style.minWidth).toBe("60rem");
    expect(screen.queryByTestId("probe-header")).toBeNull();
  });
});
