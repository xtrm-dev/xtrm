import { useRef, useState, type ComponentProps } from "react"

import { Tooltip } from "radix-ui"

import { cn } from "@/lib/utils"

import { Icon, type IconName } from "./icon"

/**
 * Console `IconButton` (packages/xtrm-app/src/ui/primitives.tsx, XTRM-1044): a 28px square, glyph at the
 * `sm` size (16px, the refactored console; main still uses `text`, 13px), `text-ink-muted` with the hover and pressed fills. The tooltip is the console's label
 * plus a keyboard hint; it uses the viewer's Radix tooltip because the console's base-ui one is not a dependency here.
 */
export function IconButton({
  icon,
  label,
  shortcut,
  className,
  tooltipSide = "bottom",
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  icon: IconName
  label: string
  shortcut?: string
  /** Where the tooltip opens. The sidebar's collapse button uses "right" so it never lands on the "Sessions" heading below it. */
  tooltipSide?: "top" | "right" | "bottom" | "left"
}) {
  // Focus moved by the shell (the overlay opening, a toggle by click) must not pop the tooltip: only the
  // pointer or keyboard focus (:focus-visible) opens it.
  const ref = useRef<HTMLButtonElement>(null)
  const pointer = useRef(false)
  const [open, setOpen] = useState(false)
  return (
    <Tooltip.Root
      open={open}
      onOpenChange={(next) => {
        if (next && !pointer.current && !ref.current?.matches(":focus-visible")) return
        setOpen(next)
      }}
    >
      <Tooltip.Trigger asChild>
        <button
          ref={ref}
          onPointerEnter={() => { pointer.current = true }}
          onPointerLeave={() => { pointer.current = false }}
          type="button"
          aria-label={label}
          {...props}
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover active:bg-pressed disabled:pointer-events-none disabled:opacity-40",
            className,
          )}
        >
          <Icon name={icon} size="sm" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={tooltipSide} sideOffset={6} className="z-50 flex items-center gap-2 rounded-md bg-raised px-2 py-1 text-xs text-ink shadow-float">
        {label}
        {shortcut ? <kbd className="rounded-sm border border-border px-1 font-sans text-2xs text-ink-faint">{shortcut}</kbd> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
