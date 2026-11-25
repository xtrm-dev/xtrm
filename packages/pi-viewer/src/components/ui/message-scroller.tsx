import * as React from "react"
import { ArrowDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ScrollOptions {
  behavior?: ScrollBehavior
}

interface ScrollerContextValue {
  atBottom: boolean
  registerViewport: (element: HTMLDivElement | null) => void
  registerContent: (element: HTMLDivElement | null) => void
  sync: () => void
  handleScroll: () => void
  scrollToEnd: (options?: ScrollOptions) => void
}

const ScrollerContext = React.createContext<ScrollerContextValue | null>(null)

function useScrollerContext(): ScrollerContextValue {
  const value = React.useContext(ScrollerContext)
  if (!value) throw new Error("useMessageScroller must be used within a MessageScroller.")
  return value
}

const BOTTOM_SLACK = 8

/**
 * A thread scroller with an explicit anchor contract.
 *
 * The previous primitive moved the viewport itself: it scrolled the first new
 * child into view while the reader was scrolled up, and content-visibility
 * changed row heights during scrolling. This version moves the viewport only
 * when the reader is at the bottom, or to restore the row under the reader
 * after content above it changes height.
 */
function MessageScrollerProvider({
  children,
}: {
  children: React.ReactNode
  autoScroll?: boolean
  defaultScrollPosition?: "start" | "end" | "last-anchor"
  scrollEdgeThreshold?: number
  scrollMargin?: number
  scrollPreviousItemPeek?: number
}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const atBottomRef = React.useRef(true)
  const anchorRef = React.useRef<{ id: string; top: number } | null>(null)
  const initializedRef = React.useRef(false)
  const suppressRef = React.useRef<number | null>(null)
  const [atBottom, setAtBottom] = React.useState(true)

  const setBottom = React.useCallback((next: boolean) => {
    if (atBottomRef.current === next) return
    atBottomRef.current = next
    setAtBottom(next)
  }, [])

  const captureAnchor = React.useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const viewportTop = viewport.getBoundingClientRect().top
    let next: { id: string; top: number } | null = null
    for (const child of Array.from(content.children)) {
      if (!(child instanceof HTMLElement)) continue
      const id = child.dataset.messageId
      if (!id) continue
      const rect = child.getBoundingClientRect()
      if (rect.bottom > viewportTop + 1) {
        next = { id, top: rect.top - viewportTop }
        break
      }
    }
    anchorRef.current = next
  }, [])

  const scrollToEnd = React.useCallback(
    ({ behavior = "auto" }: ScrollOptions = {}) => {
      const viewport = viewportRef.current
      if (!viewport) return
      anchorRef.current = null
      setBottom(true)
      suppressRef.current = null
      viewport.scrollTo({ top: viewport.scrollHeight, behavior })
    },
    [setBottom],
  )

  const sync = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    if (!initializedRef.current) {
      initializedRef.current = true
      atBottomRef.current = true
      setAtBottom(true)
      viewport.scrollTop = viewport.scrollHeight
      return
    }

    if (atBottomRef.current) {
      const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      if (Math.abs(viewport.scrollTop - target) > 1) {
        suppressRef.current = target
        viewport.scrollTop = target
      }
      return
    }

    const anchor = anchorRef.current
    if (!anchor) {
      captureAnchor()
      return
    }

    const content = contentRef.current
    if (!content) return
    let element: HTMLElement | undefined
    for (const child of Array.from(content.children)) {
      if (child instanceof HTMLElement && child.dataset.messageId === anchor.id) {
        element = child
        break
      }
    }
    if (!element) {
      captureAnchor()
      return
    }

    const top = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    const delta = top - anchor.top
    if (Math.abs(delta) > 0.5) viewport.scrollTop += delta
    anchor.top = top
  }, [captureAnchor])

  const handleScroll = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    if (suppressRef.current !== null) {
      if (Math.abs(viewport.scrollTop - suppressRef.current) < 1) {
        suppressRef.current = null
        return
      }
      suppressRef.current = null
    }

    const bottom =
      viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - BOTTOM_SLACK
    setBottom(bottom)
    if (bottom) anchorRef.current = null
    else captureAnchor()
  }, [captureAnchor, setBottom])

  const registerViewport = React.useCallback((element: HTMLDivElement | null) => {
    viewportRef.current = element
  }, [])

  const registerContent = React.useCallback((element: HTMLDivElement | null) => {
    contentRef.current = element
  }, [])

  React.useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => sync())
    observer.observe(content)
    return () => observer.disconnect()
  }, [sync])

  const value = React.useMemo(
    () => ({ atBottom, registerViewport, registerContent, sync, handleScroll, scrollToEnd }),
    [atBottom, registerViewport, registerContent, sync, handleScroll, scrollToEnd],
  )

  return <ScrollerContext.Provider value={value}>{children}</ScrollerContext.Provider>
}

function MessageScroller({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-scroller"
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className,
      )}
      {...props}
    />
  )
}

function MessageScrollerViewport({ className, onScroll, ...props }: React.ComponentProps<"div">) {
  const { registerViewport, handleScroll, sync } = useScrollerContext()
  React.useLayoutEffect(() => sync())
  return (
    <div
      ref={registerViewport}
      onScroll={(event) => {
        handleScroll()
        onScroll?.(event)
      }}
      data-slot="message-scroller-viewport"
      className={cn(
        "size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain",
        className,
      )}
      {...props}
    />
  )
}

function MessageScrollerContent({ className, ...props }: React.ComponentProps<"div">) {
  const { registerContent } = useScrollerContext()
  return (
    <div
      ref={registerContent}
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col gap-8", className)}
      {...props}
    />
  )
}

function MessageScrollerItem({
  messageId,
  scrollAnchor = false,
  className,
  ...props
}: React.ComponentProps<"div"> & { messageId?: string; scrollAnchor?: boolean }) {
  return (
    <div
      data-slot="message-scroller-item"
      data-message-id={messageId}
      data-scroll-anchor={scrollAnchor ? "true" : "false"}
      className={cn("min-w-0 shrink-0", className)}
      {...props}
    />
  )
}

function MessageScrollerButton({
  className,
  children,
  onClick,
  direction: _direction = "end",
  ...props
}: React.ComponentProps<typeof Button> & { direction?: "start" | "end" }) {
  const { atBottom, scrollToEnd } = useScrollerContext()
  return (
    <Button
      data-slot="message-scroller-button"
      data-active={atBottom ? "false" : "true"}
      variant="secondary"
      size="icon-sm"
      tabIndex={atBottom ? -1 : 0}
      aria-hidden={atBottom}
      className={cn(
        "absolute inset-s-1/2 -translate-x-1/2 border-0 bg-raised text-foreground shadow-float transition-[translate,scale,opacity] duration-200 hover:bg-hover hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[active=false]:translate-y-full bottom-4",
        className,
      )}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) scrollToEnd({ behavior: "smooth" })
      }}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">Scroll to end</span>
        </>
      )}
    </Button>
  )
}

function useMessageScroller() {
  const { scrollToEnd } = useScrollerContext()
  return {
    scrollToEnd,
    scrollToStart: () => {},
    scrollToMessage: () => {},
  }
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
}
