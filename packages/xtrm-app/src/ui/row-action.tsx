import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icon.tsx";
import { Tip } from "./primitives.tsx";

const DONE_MS = 1200;

/**
 * The one row action (§4.3): a 20px button with a text-size glyph, a required label and a tooltip.
 * `Row`'s `actions` wrapper reveals it on hover and on keyboard focus (`focus-within`), then gives it
 * back to the row; the action itself never reflows the row.
 *
 * `doneLabel` turns the button into a confirmation: the glyph becomes `check` for 1.2s and a polite
 * live region announces the word (`Copied`). The state is a word, not a colour swap.
 */
export function RowAction({
  icon,
  label,
  onAct,
  doneLabel,
}: {
  icon: IconName;
  label: string;
  onAct: () => void;
  doneLabel?: string;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const act = () => {
    onAct();
    if (!doneLabel) return;
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), DONE_MS);
  };

  return (
    <>
      <Tip label={label}>
        <button
          type="button"
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            act();
          }}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:bg-hover disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name={done ? "check" : icon} size="text" />
        </button>
      </Tip>
      {doneLabel && (
        <span className="sr-only" aria-live="polite">
          {done ? doneLabel : ""}
        </span>
      )}
    </>
  );
}
