import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NavRail, NavRailItem } from "./nav-rail.tsx";
import { SidebarRow, SidebarSection } from "./sidebar.tsx";

describe("SidebarSection", () => {
  it("keeps the chevron visible and reflects the collapsed state in aria-expanded", () => {
    render(
      <SidebarSection label="Workspace">
        <span>child row</span>
      </SidebarSection>,
    );
    const toggle = screen.getByRole("button", { name: "Workspace" });
    expect(toggle.className).toContain("text-xs");
    expect(toggle.className).toContain("font-semibold");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // Hover reveals nothing new: the chevron is part of the resting state.
    const chevron = toggle.querySelector("svg")!;
    expect(chevron.getAttribute("class")).toContain("opacity-70");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(chevron.getAttribute("class")).toContain("-rotate-90");
  });
});

describe("SidebarRow", () => {
  it("renders the 30px sidebar geometry: 16px icon at stroke 2, 600 label", () => {
    const onActivate = vi.fn();
    const { container } = render(<SidebarRow icon="program" label="Project" onActivate={onActivate} />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("h-[30px]");

    const icon = row.querySelector("svg")!;
    expect(icon.getAttribute("width")).toBe("16");
    // 2.25 is the app weight (docs/mocks/sidebar-weight-connection-activity.html, A1).
    expect(icon.getAttribute("stroke-width")).toBe("2.25");

    const label = screen.getByText("Project");
    expect(label.className).toContain("font-semibold");

    fireEvent.click(label);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("exposes a disclosure chevron that toggles without activating the row", () => {
    const onActivate = vi.fn();
    const onToggle = vi.fn();
    const { container, rerender } = render(
      <SidebarRow icon="program" label="Project" expanded onToggle={onToggle} onActivate={onActivate} />,
    );
    const toggle = screen.getByRole("button", { name: "Collapse Project" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onActivate).not.toHaveBeenCalled();

    rerender(<SidebarRow icon="program" label="Project" expanded={false} onToggle={onToggle} onActivate={onActivate} />);
    const collapsed = screen.getByRole("button", { name: "Expand Project" });
    expect(collapsed.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("svg.lucide-chevron-down")).toBeTruthy();
  });

  it("expands on ArrowRight and collapses on ArrowLeft, and only when a disclosure exists", () => {
    const onToggle = vi.fn();
    const { container, rerender } = render(<SidebarRow icon="program" label="Project" expanded={false} onToggle={onToggle} onActivate={() => {}} />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.getAttribute("role")).toBe("button");

    // Collapsed: ArrowRight opens, ArrowLeft does nothing.
    fireEvent.keyDown(row, { key: "ArrowRight" });
    expect(onToggle).toHaveBeenCalledOnce();
    const afterOpen = fireEvent.keyDown(row, { key: "ArrowLeft" });
    expect(onToggle).toHaveBeenCalledOnce();
    expect(afterOpen).toBe(true); // not prevented: there was nothing to collapse

    rerender(<SidebarRow icon="program" label="Project" expanded onToggle={onToggle} onActivate={() => {}} />);
    fireEvent.keyDown(container.firstElementChild as HTMLElement, { key: "ArrowLeft" });
    expect(onToggle).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(container.firstElementChild as HTMLElement, { key: "ArrowRight" });
    expect(onToggle).toHaveBeenCalledTimes(2); // already open: no toggle

    // A row without a disclosure keeps its plain Enter/Space activation: no toggle, nothing prevented.
    rerender(<SidebarRow icon="program" label="Project" onActivate={() => {}} />);
    const plain = container.firstElementChild as HTMLElement;
    expect(fireEvent.keyDown(plain, { key: "ArrowLeft" })).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("keeps deferred rows at readable ink and marks them with data-deferred", () => {
    render(<SidebarRow icon="ci" label="CI/CD" deferred onActivate={() => {}} />);
    const label = screen.getByText("CI/CD");
    // ink-faint is 2.74:1 light / 2.93:1 dark on the sidebar: below 4.5:1 for 13px text (lead ruling).
    expect(label.className).not.toContain("text-ink-faint");
    expect(label.className).toContain("font-semibold");
    expect(label.closest("[role='button']")?.getAttribute("data-deferred")).toBe("true");
  });
});

describe("NavRail", () => {
  it("hangs children on a hairline rail aligned to the parent icon, with no child icons", () => {
    const onActivate = vi.fn();
    render(
      <SidebarRow icon="program" label="Project" expanded onToggle={() => {}}>
        <NavRailItem label="Overview" onActivate={onActivate} />
        <NavRailItem label="Timeline" count={4} onActivate={onActivate} />
      </SidebarRow>,
    );
    const rail = screen.getByRole("group", { name: "Project" });
    // The rail x is the centre of the 16px parent icon (8px padding + 8px) and it is one hairline.
    expect(rail.className).toContain("ml-[var(--x-rail-indent)]");
    expect(rail.className).toContain("border-l");
    expect(rail.className).toContain("border-border-muted");

    const overview = screen.getByText("Overview").closest("[role='button']") as HTMLElement;
    // No icon on a child row, and the label sits at the parent label's x (the aligned column).
    expect(overview.querySelector("svg")).toBeNull();
    expect(overview.className).toContain("pl-[var(--x-rail-gutter)]");
    expect(overview.className).toContain("text-ink-muted");

    fireEvent.click(screen.getByText("Overview"));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("marks the active child on the rail and keeps the marker decorative", () => {
    render(
      <NavRail label="Project">
        <NavRailItem label="Overview" selected onActivate={() => {}} />
        <NavRailItem label="Timeline" deferred onActivate={() => {}} />
      </NavRail>,
    );
    const overview = screen.getByText("Overview").closest("[role='button']") as HTMLElement;
    // A 2px accent bar at -left-px covers the hairline on this row only.
    expect(overview.className).toContain("before:-left-px");
    expect(overview.className).toContain("before:w-[var(--x-rail-marker)]");
    expect(overview.className).toContain("before:bg-accent");
    expect(overview.className).toContain("bg-hover");
    // The state is also carried without colour: weight, ink and aria-current.
    expect(overview.className).toContain("font-semibold");
    expect(overview.className).toContain("text-ink");
    expect(overview.getAttribute("aria-current")).toBe("page");

    const deferred = screen.getByText("Timeline").closest("[role='button']") as HTMLElement;
    // Inactive children keep ink-muted in both themes (5.75:1 light, 6.05:1 dark on --x-sidebar);
    // deferred is a data fact, not ink-faint, which is 2.74:1 / 2.93:1 and fails for 13px text.
    expect(deferred.className).toContain("text-ink-muted");
    expect(deferred.className).not.toContain("text-ink-faint");
    expect(deferred.getAttribute("data-deferred")).toBe("true");
    expect(deferred.className).not.toContain("before:bg-accent");
    expect(deferred.getAttribute("aria-current")).toBeNull();
  });

  it("renders the count right-aligned at text-xs and no rail of its own", () => {
    render(
      <NavRail label="Research">
        <NavRailItem label="Experiments" count={12} onActivate={() => {}} />
      </NavRail>,
    );
    const count = screen.getByText("12");
    expect(count.className).toContain("ml-auto");
    expect(count.className).toContain("text-xs");
    expect(count.className).toContain("tabular");
    expect(screen.getByRole("group", { name: "Research" }).querySelector("[role='group']")).toBeNull();
  });
});
