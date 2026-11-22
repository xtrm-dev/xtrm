export * from "@base-ui/react/dialog";

import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

/**
 * The one modal frame (XTRM-944).
 *
 * Three dialogs each rebuilt the same chrome with their own numbers: the create dialog sat at 6vh,
 * 720px wide and 88vh tall; the normalize dialog at 8vh, 760px and 84vh; the command palette at
 * 14vh and 640px with a lighter backdrop. That is three copies of one string per call site, and two
 * backdrop opacities for one idea — "the page behind the dialog is out of play".
 *
 * The frame owns the scrim, the surface, the header row, the footer row and the geometry props. A
 * caller owns its body, because the bodies genuinely differ (a scrolling form, a command list).
 * Nothing outside this file renders the popup primitive: a fourth dialog should be a prop,
 * not a fourth chrome.
 *
 * `tone` names the two chromes the console has: `panel` is a card with a title header and a
 * `px-5` footer, the shape a form uses; `palette` has no title (the input is the header) and a
 * `h-9` `px-4` footer, the shape a command list uses.
 */
export type DialogFrameProps = {
  /** Accessible name; required when the frame has no `title` to be named by. */
  label?: string;
  title?: ReactNode;
  /** Replaces the title with a caller-owned header row (the palette's input). */
  header?: ReactNode;
  /**
   * Dialog width in px; the viewport guard keeps it inside a narrow window.
   * Named `frameWidth` rather than `width` on purpose: a `width` attribute carrying a bare number is
   * the units gate's px-glyph shape, and a deliberate exception would have to live in the gate. The
   * prop name says whose width it is instead.
   */
  frameWidth: number;
  /** Distance from the viewport top, in vh: a dialog's height budget, not a spacing token. */
  top: number;
  /** Height ceiling in vh, for a body that scrolls inside the frame. */
  maxHeight?: number;
  tone?: "panel" | "palette";
  children: ReactNode;
};

export function DialogFrame({ label, title, header, frameWidth, top, maxHeight, tone = "panel", children }: DialogFrameProps) {
  const palette = tone === "palette";
  return (
    <>
      {/* One scrim for every modal: two opacities for "the page is out of play" is one too many. */}
      <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 dark:bg-black/50" />
      <Dialog.Popup
        aria-label={title ? undefined : label}
        style={{ top: `${top}vh`, width: `min(${frameWidth}px, calc(100vw - 32px))`, maxHeight: maxHeight === undefined ? undefined : `${maxHeight}vh` }}
        className="fixed left-1/2 z-50 flex -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-raised shadow-float outline-none"
      >
        <div
          data-slot="dialog-header"
          className={
            palette
              ? "flex h-12 shrink-0 items-center gap-2 border-b border-border-muted px-4"
              : "flex h-12 shrink-0 items-center border-b border-border-muted px-5"
          }
        >
          {header ?? <Dialog.Title className="text-base font-medium text-ink">{title}</Dialog.Title>}
        </div>
        {children}
      </Dialog.Popup>
    </>
  );
}

/**
 * The frame's footer row, as a child slot.
 *
 * There is one way to give a frame a footer, not two: the row is a child of the frame, so the caller
 * that has a scrolling form and the caller that has a command list both write the same element.
 * A `footer` prop would be a second way to say it, and it would be the one no call site used.
 * `tone` selects the chrome — the same two rows `DialogFrame` names — and the caller owns the
 * contents. It is a prop rather than context because a footer is always written in the same JSX as
 * the frame it belongs to; nothing nests frames.
 */
DialogFrame.Footer = function DialogFrameFooter({ tone = "panel", children }: { tone?: "panel" | "palette"; children: ReactNode }) {
  return (
    <div
      data-slot="dialog-footer"
      className={
        tone === "palette"
          ? "flex h-9 shrink-0 items-center gap-3 border-t border-border-muted px-4 text-xs text-ink-faint"
          : "flex shrink-0 items-center gap-2 border-t border-border-muted px-5 py-3"
      }
    >
      {children}
    </div>
  );
};
