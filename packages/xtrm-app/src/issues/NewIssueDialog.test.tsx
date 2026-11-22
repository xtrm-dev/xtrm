import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdaptersProvider, fixtureAdapters, type IssueCreate } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { FieldLabel } from "../ui/fields.tsx";
import { NewIssueDialog } from "./NewIssueDialog.tsx";

/**
 * XTRM-988: the create dialog wrote its own label — a `text-xs font-medium text-ink-faint` span inside
 * a wrapping `<label>` — while every issue field renders `FieldLabel`, which is `SectionHeader` at
 * `inset="none"` (XTRM-934). Two labels for one idea, one step apart in weight and in the document
 * outline: the dialog's labels were spans, the drawer's were h3s.
 *
 * A class assertion cannot tell delegation from a copy: the span and `SectionHeader`'s heading carried
 * the same classes. These assertions compare the rendered block to `FieldLabel`'s own output, so a
 * label that re-implements the heading — or drifts from it later — fails even while every class still
 * matches.
 */

const FIELDS: Array<{ label: string; hint?: string }> = [
  { label: "Type" },
  { label: "Priority" },
  { label: "Scrutiny" },
  { label: "Summary" },
  { label: "Parent" },
  { label: "Problem" },
  { label: "Success" },
  { label: "Scope", hint: "one per line" },
  { label: "Non-goals", hint: "one per line" },
  { label: "Constraints", hint: "one per line" },
  { label: "Validation", hint: "one per line" },
  { label: "Output", hint: "one per line" },
];

/** The label block a field renders: `FieldLabel`'s margin, then `SectionHeader`'s row, then the h3. */
const labelBlock = (label: string) => screen.getByRole("heading", { level: 3, name: label }).parentElement?.parentElement as HTMLElement;

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const createIssue = vi.fn(async (_project: string, _input: IssueCreate) => "XTRM-999");
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AdaptersProvider adapters={{ ...fixtureAdapters, substrate: { ...createFixtureSubstrate(), createIssue } }}>
        <NewIssueDialog open onOpenChange={onOpenChange} projectId="prj_x" onCreated={onCreated} />
      </AdaptersProvider>
    </QueryClientProvider>,
  );
  return { createIssue, onOpenChange, onCreated };
}

describe("the create dialog's field labels (XTRM-988)", () => {
  it("renders every label through the shared FieldLabel", () => {
    renderDialog();
    const rendered = FIELDS.map((field) => {
      const heading = screen.getByRole("heading", { level: 3, name: field.label });
      expect(heading.className).toContain("text-xs");
      expect(heading.className).toContain("text-ink-faint");
      return { label: field.label, html: labelBlock(field.label).outerHTML };
    });
    for (const field of FIELDS) {
      const reference = render(<FieldLabel aside={field.hint ? <span className="text-xs text-ink-faint">{field.hint}</span> : undefined}>{field.label}</FieldLabel>);
      expect(rendered.find((row) => row.label === field.label)?.html, `${field.label} is the shared FieldLabel, verbatim`).toBe(reference.container.firstElementChild?.outerHTML);
      reference.unmount();
    }
  });

  it("leaves no hand-written label span behind", () => {
    renderDialog();
    // The class is `SectionHeader`'s heading class, so the property is not "no element carries it" but
    // "only the shared heading carries it": a span with the label's weight and ink is the shape this
    // file wrote for itself, and the count says every field still renders one.
    const spans = [...document.body.querySelectorAll("span")].filter((el) => el.className.includes("font-medium") && el.className.includes("text-ink-faint"));
    expect(spans, "no field writes its own label span").toEqual([]);
    const headings = [...document.body.querySelectorAll("h3")].filter((el) => el.className.includes("text-xs") && el.className.includes("text-ink-faint"));
    expect(headings).toHaveLength(FIELDS.length);
  });

  it("keeps the optional hint text, in the shared aside and the shared ink", () => {
    renderDialog();
    for (const field of FIELDS.filter((candidate) => candidate.hint)) {
      const aside = labelBlock(field.label).querySelector("h3")?.nextElementSibling as HTMLElement | null;
      expect(aside, `${field.label} keeps its hint`).not.toBeNull();
      const hint = aside!.querySelector("span")!;
      expect(hint.textContent).toBe(field.hint);
      expect(hint.className).toContain("text-xs");
      expect(hint.className).toContain("text-ink-faint");
    }
    // A field without a hint renders no aside at all.
    expect(labelBlock("Parent").children[0]!.children.length, "Parent has no hint row").toBe(1);
  });

  it("still names every control after its label", () => {
    renderDialog();
    // The label is a heading now, not a wrapping <label>: the name has to be on the control itself or
    // the dialog's text fields would be named by their placeholder alone ("One item per line" x6).
    for (const name of ["Summary", "Parent", "Problem", "Success", "Scope", "Non-goals", "Constraints", "Validation", "Output"]) {
      expect(screen.getByRole("textbox", { name }), `${name} is named by its label`).toBeTruthy();
    }
    for (const name of ["Type", "Priority", "Scrutiny"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${name}:`) }), `${name} names its select`).toBeTruthy();
    }
  });

  it("submits the same payload and closes the dialog", async () => {
    const { createIssue, onOpenChange, onCreated } = renderDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), { target: { value: "Wire the label" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Problem" }), { target: { value: "label drift" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Success" }), { target: { value: "one label" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Scope" }), { target: { value: "src/issues/NewIssueDialog.tsx\nsrc/issues/NewIssueDialog.test.tsx" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("XTRM-999"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(createIssue).toHaveBeenCalledTimes(1);
    const [project, input] = createIssue.mock.calls[0]!;
    expect(project).toBe("prj_x");
    expect(input).toMatchObject({ title: "Wire the label", kind: "task", priority: 2, scrutiny: "MEDIUM" });
    expect(input.contract).toMatchObject({
      problem: "label drift",
      success: "one label",
      scope: ["src/issues/NewIssueDialog.tsx", "src/issues/NewIssueDialog.test.tsx"],
    });
  });

  it("keeps its keyboard entry: Summary focused, Escape closes", () => {
    const { onOpenChange } = renderDialog();
    const summary = screen.getByRole("textbox", { name: "Summary" });
    expect(document.activeElement, "the dialog opens on the summary field").toBe(summary);
    fireEvent.keyDown(summary, { key: "Escape" });
    // base-ui passes its event details as a second argument; the decision is the first one.
    expect(onOpenChange.mock.calls[0]?.[0], "Escape asks the owner to close").toBe(false);
  });

  it("still reports a missing required field in the footer, not in the label", () => {
    const { createIssue } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(createIssue).not.toHaveBeenCalled();
    expect(screen.getByText("Title, Problem, and Success are required.")).toBeTruthy();
  });
});
