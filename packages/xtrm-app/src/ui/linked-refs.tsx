import { useState, type MouseEvent } from "react";
import { ReferenceChip } from "../refs/references.tsx";
import { Popover } from "./popover.tsx";

/**
 * Substrate refs for a pull request, in one cell that never wraps (§4.5). The first `max` refs stay
 * chips; the rest collapse into a plain `+N` that opens a popover listing every ref in full.
 * `onOpen` replaces the reference's own navigation, for callers that route through their own panel.
 */
export function LinkedRefs({ refs, max = 1, onOpen }: { refs: string[]; max?: number; onOpen?: (ref: string) => void }) {
  const [open, setOpen] = useState(false);
  if (refs.length === 0) return <span className="text-xs text-ink-faint">—</span>;

  const first = refs.slice(0, Math.max(1, max));
  const extra = refs.length - first.length;
  const stop = (e: MouseEvent) => e.stopPropagation();
  const route = onOpen
    ? {
        onClickCapture: (e: MouseEvent) => {
          e.stopPropagation();
          onOpen(e.currentTarget.getAttribute("data-ref") ?? "");
        },
        onDoubleClick: stop,
      }
    : { onClick: stop, onDoubleClick: stop };

  return (
    <span className="flex min-w-0 flex-nowrap items-center gap-0.5 overflow-hidden whitespace-nowrap">
      {first.map((ref) => (
        <span key={ref} data-ref={ref} className="min-w-0 truncate" {...route}>
          <ReferenceChip reference={{ kind: "issue", ref }} showAlias={false} />
        </span>
      ))}
      {extra > 0 && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger
            aria-label={`${extra} more linked issues`}
            onClick={stop}
            onDoubleClick={stop}
            onKeyDown={(event) => {
              // The trigger sits inside a Row: its own Enter/Space must not also open the inspector.
              if (event.key === "Enter" || event.key === " ") event.stopPropagation();
            }}
            className="shrink-0 text-xs tabular text-ink-faint outline-none hover:text-ink focus-visible:text-ink"
          >
            +{extra}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
              <Popover.Popup className="thin-scrollbar max-h-72 max-w-sm overflow-y-auto rounded-lg bg-raised p-2 shadow-float outline-none">
                <span className="flex flex-col items-start gap-1">
                  {refs.map((ref) => (
                    <span key={ref} data-ref={ref} {...route}>
                      <ReferenceChip reference={{ kind: "issue", ref }} showTitle />
                    </span>
                  ))}
                </span>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
    </span>
  );
}
