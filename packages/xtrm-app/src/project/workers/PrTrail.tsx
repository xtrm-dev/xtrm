import { useState, type MouseEvent } from "react";
import { Popover } from "../../ui/popover.tsx";
import { PrKey } from "../../ui/pr-key.tsx";

/**
 * The PR trail of one Workers row (XTRM-912), in the shape `LinkedRefs` already uses:
 * the first PR stays a key, the rest collapse into a plain `+N` that opens a popover
 * listing every PR with its repository. A live node can deliver many PRs (#637, #1542,
 * #1562, #1565, …); rendering all of them ran the row off its own width, so the row
 * only ever reserves room for one key and the counter.
 */
export function PrTrail({ prs }: { prs: Array<{ number: number; repo: string | null }> }) {
  const [open, setOpen] = useState(false);
  if (prs.length === 0) return null;

  const [first, ...rest] = prs;
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <span className="flex min-w-0 flex-nowrap items-center gap-0.5 overflow-hidden whitespace-nowrap" data-testid="worker-pr-trail">
      <span className="min-w-0 truncate" title={first!.repo ? `${first!.repo}#${first!.number}` : undefined}>
        <PrKey number={first!.number} state={null} quiet />
      </span>
      {rest.length > 0 && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger
            aria-label={`${rest.length} more pull requests`}
            onClick={stop}
            onDoubleClick={stop}
            onKeyDown={(event) => {
              // The trigger sits inside a Row: its own Enter/Space must not also toggle the node.
              if (event.key === "Enter" || event.key === " ") event.stopPropagation();
            }}
            className="shrink-0 text-xs tabular text-ink-faint outline-none hover:text-ink focus-visible:text-ink"
          >
            +{rest.length}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
              <Popover.Popup className="thin-scrollbar max-h-72 max-w-sm overflow-y-auto rounded-lg bg-raised p-2 shadow-float outline-none">
                <span className="flex flex-col items-start gap-1">
                  {prs.map((pr) => (
                    <PrKey key={`${pr.repo ?? ""}#${pr.number}`} number={pr.number} repo={pr.repo ?? undefined} state={null} />
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
