import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type ReactNode } from "react";

/** Fixed-height virtualized list (`@tanstack/react-virtual`, the only virtualization library). */
export function VirtualList<T>({
  items,
  rowHeight,
  getKey,
  renderRow,
  label,
  header,
}: {
  items: T[];
  rowHeight: number;
  getKey: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  label: string;
  header?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    getItemKey: (i) => getKey(items[i]!),
    // jsdom and first paint have no layout; render a sensible first window.
    initialRect: { width: 960, height: 720 },
  });

  return (
    <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto" role="list" aria-label={label}>
      {header}
      <div className="relative mx-auto w-full max-w-5xl px-2 py-1" style={{ height: virtualizer.getTotalSize() + 8 }}>
        {virtualizer.getVirtualItems().map((v) => (
          <div key={v.key} role="listitem" className="absolute right-2 left-2" style={{ top: v.start + 4, height: v.size }}>
            {renderRow(items[v.index]!)}
          </div>
        ))}
      </div>
    </div>
  );
}
