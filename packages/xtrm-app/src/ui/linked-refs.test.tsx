import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LinkedRefs } from "./linked-refs.tsx";

/** The connected cases (chips, +N popover, keyboard) live in src/github/pulls.test.tsx. */
describe("LinkedRefs", () => {
  it("renders an em dash when nothing is linked", () => {
    render(<LinkedRefs refs={[]} />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});
