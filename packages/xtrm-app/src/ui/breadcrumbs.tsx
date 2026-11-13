import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";
import { cx } from "./primitives.tsx";

export interface Crumb {
  key: string;
  label: ReactNode;
  icon?: IconName;
  /** Absent on the current page: it is rendered as plain text, not a control. */
  onClick?: () => void;
  title?: string;
}

/**
 * Trail of ancestors ending in the current object. The separator is a chevron rather than a slash
 * so it reads as structure, and the last crumb carries `aria-current` so a screen reader announces
 * where the trail ends.
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cx("flex min-w-0 items-center gap-1 text-xs text-ink-faint", className)}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <div key={item.key} className="flex min-w-0 items-center gap-1">
            {item.onClick && !last ? (
              <button
                type="button"
                onClick={item.onClick}
                title={item.title}
                className="flex min-w-0 items-center gap-1 rounded-sm px-0.5 outline-none transition-colors hover:text-ink-muted focus-visible:text-ink"
              >
                {item.icon && <Icon name={item.icon} size="xs" />}
                <span className="truncate">{item.label}</span>
              </button>
            ) : (
              <span
                aria-current={last ? "page" : undefined}
                title={item.title}
                className={cx("flex min-w-0 items-center gap-1 px-0.5", last ? "text-ink-muted" : "text-ink-faint")}
              >
                {item.icon && <Icon name={item.icon} size="xs" />}
                <span className="truncate">{item.label}</span>
              </span>
            )}
            {!last && <Icon name="chevronRight" size="xs" className="shrink-0 text-ink-faint/60" />}
          </div>
        );
      })}
    </nav>
  );
}
