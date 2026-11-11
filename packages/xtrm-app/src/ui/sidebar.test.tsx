import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarRow, SidebarSection } from "./sidebar.tsx";

describe("SidebarSection", () => {
  it("keeps the chevron visible and reflects the collapsed state in aria-expanded", () => {
    render(
      <SidebarSection label="Workspace">
        <span>child row</span>
      </SidebarSection>,
    );
    const toggle = screen.getByRole("button", { name: "Workspace" });
    expect(toggle.className).toContain("text-[11px]");
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
  it("renders the 30px sidebar geometry: 16px icon at stroke 2, 600 label, 20px indent", () => {
    const onActivate = vi.fn();
    const { container } = render(<SidebarRow icon="program" label="Project" indent onActivate={onActivate} />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("h-[30px]");
    expect(row.style.paddingLeft).toBe("1.25rem");

    const icon = row.querySelector("svg")!;
    expect(icon.getAttribute("width")).toBe("16");
    expect(icon.getAttribute("stroke-width")).toBe("2");

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

  it("dims deferred rows without changing their weight", () => {
    render(<SidebarRow icon="ci" label="CI/CD" deferred onActivate={() => {}} />);
    const label = screen.getByText("CI/CD");
    expect(label.className).toContain("text-ink-faint");
    expect(label.className).toContain("font-semibold");
  });
});
