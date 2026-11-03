import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./primitives.tsx";

/** Fixed-height virtualized list (`@tanstack/react-virtual`, the only virtualization library). */
export function VirtualList<T>({
  items,
  rowHeight,
  getKey,
  renderRow,
  label,
  header,
  widthClass = "max-w-5xl",
  flush,
  minWidth,
}: {
  items: T[];
  rowHeight: number;
  getKey: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  label: string;
  header?: ReactNode;
  widthClass?: string;
  /** Edge-to-edge rows for tables: no centring, gutters or row inset. */
  flush?: boolean;
  /** Below this width the list scrolls sideways instead of squeezing its columns. */
  minWidth?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  // A vertical scrollbar narrows the rows' box, so the header strip reserves the same gutter to
  // keep its columns over the rows'.
  const [gutter, setGutter] = useState(0);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    getItemKey: (i) => getKey(items[i]!),
    // jsdom and first paint have no layout; render a sensible first window.
    initialRect: { width: 960, height: 720 },
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setGutter(el.offsetWidth - el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The header sits above the scroller so the scrollbar starts under it; keep the two aligned
  // sideways without a re-render.
  const syncHeader = () => {
    const scroller = scrollRef.current;
    const strip = headerRef.current;
    if (scroller && strip) strip.scrollLeft = scroller.scrollLeft;
  };

  return (
    <div role="list" aria-label={label} className="flex min-h-0 flex-1 flex-col">
      {header && (
        <div ref={headerRef} className="overflow-x-hidden" style={{ paddingRight: gutter }}>
          <div style={{ minWidth }}>{header}</div>
        </div>
      )}
      <div ref={scrollRef} onScroll={syncHeader} className={cx("thin-scrollbar min-h-0 flex-1 overflow-y-auto", flush && "overflow-x-auto")}>
        <div style={{ minWidth }}>
          <div className={flush ? "relative w-full" : `relative mx-auto w-full ${widthClass} px-2 py-1`} style={{ height: virtualizer.getTotalSize() + (flush ? 0 : 8) }}>
            {virtualizer.getVirtualItems().map((v) => (
              <div key={v.key} role="listitem" className={flush ? "absolute inset-x-0" : "absolute right-2 left-2"} style={{ top: flush ? v.start : v.start + 4, height: v.size }}>
                {renderRow(items[v.index]!)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
