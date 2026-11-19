import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icon.tsx";
import { Tip } from "./primitives.tsx";

const DONE_MS = 1200;

/** `false` (or a rejection) means the act failed; `undefined`/`true` mean it succeeded. */
export type RowActionOutcome = boolean | void | Promise<boolean | void>;

/**
 * The one row action (§4.3): a 20px button with a text-size glyph, a required label and a tooltip.
 * `Row`'s `actions` wrapper reveals it on hover and on keyboard focus (`focus-within`), then gives it
 * back to the row; the action itself never reflows the row.
 *
 * `doneLabel` turns the button into a confirmation: the glyph becomes `check` for 1.2s and a polite
 * live region announces the word (`Copied`). A failed act gets no confirmation — the glyph stays and
 * `failLabel` is announced instead — so the wording never claims a write that did not happen.
 */
export function RowAction({
  icon,
  label,
  onAct,
  doneLabel,
  failLabel,
}: {
  icon: IconName;
  label: string;
  onAct: () => RowActionOutcome;
  doneLabel?: string;
  failLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const act = async () => {
    let outcome: RowActionOutcome;
    try {
      outcome = await onAct();
    } catch {
      outcome = false;
    }
    if (!doneLabel) return;
    setState(outcome === false ? "failed" : "done");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), DONE_MS);
  };

  return (
    <>
      <Tip label={label}>
        <button
          type="button"
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            void act();
          }}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:bg-hover"
        >
          <Icon name={state === "done" ? "check" : icon} size="text" />
        </button>
      </Tip>
      {doneLabel && (
        <span className="sr-only" aria-live="polite">
          {state === "done" ? doneLabel : state === "failed" ? (failLabel ?? `${label} failed`) : ""}
        </span>
      )}
    </>
  );
}
