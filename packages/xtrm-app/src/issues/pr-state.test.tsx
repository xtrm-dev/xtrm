import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrStateBadge } from "./pr-state.tsx";
import { PrStateChip } from "../ui/pr-key.tsx";

describe("PrStateBadge", () => {
  it("is the §4.4 chip under its old name, so no caller needed a rename in this slice", () => {
    expect(PrStateBadge).toBeDefined();
    expect(PrStateChip).toBeDefined();
    render(<PrStateBadge state="merged" />);
    expect(screen.getByText("Merged")).toBeTruthy();
  });
});
