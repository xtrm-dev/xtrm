/**
 * Sidebar geometry, copied from the console (packages/xtrm-app). The viewer does not import
 * across packages, so each value names where it came from. Lengths are rem so the sidebar
 * follows the root font size, as the console's unit rule requires (console-ui-system.md §3.3).
 */

/** One tree indent step. xtrm-app src/issues/issue-table.ts INDENT_REM; design doc §4.3. */
export const INDENT_REM = 1.25

/** Sidebar plane width: 264px at a 16px root (xtrm-app AgentSidebar comment, "at 264px"). */
export const SIDEBAR_WIDTH = "w-[16.5rem]"

/** Icon rail width: a size-7 control plus the px-2 gutter of a sidebar row (design doc §4.2). */
export const RAIL_WIDTH = "w-11"

/** Disclosure box: a fixed 20px (size-5) hit box that does not move with depth (§4.3 WorkerRow). */
export const DISCLOSURE = "size-5"

/**
 * Row classes, from `Row` in xtrm-app src/ui/primitives.tsx: the shared anatomy
 * (gap-2.5, min-w-0, rounded-md, hover and focus fill) and the `sidebar` density (px-2).
 */
export const ROW_BASE =
  "group/row relative flex min-w-0 items-center gap-2.5 rounded-md px-2 outline-none transition-colors cursor-default hover:bg-hover focus-visible:bg-hover"

/** Sidebar density height: h-7, 28px (design doc §4.2). Session and window rows are one line. */
export const ROW_ONE_LINE = "h-7"

/**
 * A two-line pane row is the ruled exception to the 32px list density (§4.2): the second line
 * is text-2xs. The row grows to its content, 1.25rem + 0.875rem of line height + py-1 = 2.625rem.
 */
export const ROW_TWO_LINE = "items-start py-1"

/** Selected row: --x-hover fill (§3.1) plus the 2px accent marker of AgentSidebar's SessionRow. */
export const ROW_SELECTED = "bg-hover text-ink"
export const MARKER = "absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-accent"

/** Marker and rail x positions: row px-2 plus the centre of the 20px disclosure box. */
export const RAIL_ORIGIN_REM = 0.5 + 1.25 / 2
