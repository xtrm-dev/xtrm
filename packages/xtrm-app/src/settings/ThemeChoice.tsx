import type { KeyboardEvent } from "react";
import type { Theme as ThemePreference } from "../lib/settings/index.ts";
import { useShell } from "../shell/context.tsx";
import { cx } from "../ui/primitives.tsx";

const THEME_CHOICES: readonly { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Three-way theme control (System | Light | Dark) as a radio group: a screen reader announces the
 * choice and its state, and the page changes theme in place.
 *
 * - `page` (the /settings row): one tab stop on the checked radio, and every arrow key moves and
 *   selects, as native radios do.
 * - `menu` (the sidebar drop-up): out of the tab order like the drop-up's status rows, because Base
 *   UI focuses the first tabbable element on open and the drop-up is read with Up/Down. Up/Down
 *   therefore stay with the drop-up's row navigation; Left/Right move the choice.
 */
export function ThemeChoice({ variant }: { variant: "page" | "menu" }) {
  const { themePreference, setThemePreference } = useShell();
  const menu = variant === "menu";
  const keys = menu ? ["ArrowLeft", "ArrowRight"] : ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  const step = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const at = THEME_CHOICES.findIndex((c) => c.value === themePreference);
    const next = THEME_CHOICES[(at + (forward ? 1 : -1) + THEME_CHOICES.length) % THEME_CHOICES.length]!;
    setThemePreference(next.value);
    e.currentTarget.querySelector<HTMLElement>(`[data-theme-choice="${next.value}"]`)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={step}
      className={cx("flex gap-px rounded-md p-px", menu ? "bg-strip-rule" : "w-64 bg-border-muted")}
      data-testid="theme-choice"
    >
      {THEME_CHOICES.map((c) => {
        const on = c.value === themePreference;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-theme-choice={c.value}
            tabIndex={menu || !on ? -1 : 0}
            onClick={() => setThemePreference(c.value)}
            className={cx(
              "h-6 flex-1 rounded-[5px] text-xs outline-none",
              menu
                ? cx("focus-visible:ring-1 focus-visible:ring-strip-ink-faint", on ? "bg-strip-open font-medium text-strip-ink-strong" : "bg-strip text-strip-ink hover:text-strip-ink-strong")
                : cx("focus-visible:ring-1 focus-visible:ring-border-strong", on ? "bg-raised font-medium text-ink" : "bg-surface text-ink-muted hover:text-ink"),
            )}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
