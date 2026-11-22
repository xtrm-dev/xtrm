import type { ComponentProps } from "react";
import { cx } from "./primitives.tsx";

/**
 * The console's one card (XTRM-989; design doc §2, "one component per concept").
 *
 * The same framed block existed three times in two shapes. `IssueBoard.tsx` and
 * `IssueProvenance.tsx` wrote `rounded-md border border-border-muted px-3 py-2.5` beside each other
 * — the board's own comment already called it "the console's one card dialect, byte for byte" —
 * and `IssueView.tsx`'s `DetailsGrid` drew `rounded-lg border border-border-muted p-4` for the same
 * concept on the page next door. Two radii (8px / 10px) and two paddings for one record box, so an
 * issue's board card and its details card did not read as the same object.
 *
 * The chosen shape is the majority one: `rounded-md` with `px-3 py-2.5` and `gap-2`.
 * - `rounded-md` is the radius the token table already gives a row (§3.1: `--radius-sm/md/lg` 6/8/10,
 *   rows `md`), so a card is a row's radius around a stack of rows. The page's `lg` was the only
 *   place that read as a panel, and the panel role belongs to `Section` (the drawer frame with its
 *   `px-5 py-4`), not to a record box.
 * - `px-3` is the gutter a list row and a list-inset `SectionHeader` use, so the card's text starts
 *   on the same x as the rows above it; `py-2.5` is the provenance card's own measured rhythm, kept
 *   because the denser of the two is the one the record lists are built around.
 *
 * What a call site may add is state the card cannot know: the board's selection border, hover and
 * focus ring, a recessed fill (`bg-deep/40` on a closure card), a `group` hook for a row action.
 * What it may not do is re-declare the frame.
 */
export const CARD_FRAME = "flex flex-col gap-2 rounded-md border border-border-muted px-3 py-2.5";

/**
 * The props of a `div`: a card is a box, not a wrapper, and the surfaces that compose it add their
 * own handlers, states and `data-*` test hooks. A hyphenated attribute needs no declaration in TSX,
 * so `data-testid` travels without widening this type (which would lose the handler param types).
 */
export type CardProps = ComponentProps<"div">;

export function Card({ className, ...props }: CardProps) {
  return <div {...props} className={cx(CARD_FRAME, className)} />;
}
