import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { followMode, recall, remember, restoreExpired, smoothStep } from "@/lib/stick"
import { cn } from "@/lib/utils"

interface ScrollOptions {
  behavior?: ScrollBehavior
}

interface ScrollerContextValue {
  atBottom: boolean
  /** False until the first sync has applied, or given up on, the remembered position. */
  ready: boolean
  /** Rows that arrived while the reader was scrolled away from the end. */
  newCount: number
  setWorking: (working: boolean) => void
  /** The thread reports how many rows arrived while the reader was away from the end. */
  reportNew: (count: number) => void
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
  threadKey,
}: {
  children: React.ReactNode
  /** Names the thread; its scroll position is remembered per key. */
  threadKey?: string
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
  // A programmatic scroll-to-end owns the viewport until it reaches the bottom.
  // Without this, the first smooth-scroll event reads a mid-flight position,
  // clears the pin, and records a half-way anchor.
  const pinRef = React.useRef(false)
  const pinTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [atBottom, setAtBottom] = React.useState(true)
  const [ready, setReady] = React.useState(false)
  const [newCount, setNewCount] = React.useState(0)
  const workingRef = React.useRef(false)
  const glidingRef = React.useRef(false)
  const frameRef = React.useRef<number | null>(null)
  const restoreRef = React.useRef<{ id: string; top: number } | null>(null)
  const restoreSyncsRef = React.useRef(0)
  const restoreDeadlineRef = React.useRef(0)
  const restoreFrameRef = React.useRef(0)
  const threadKeyRef = React.useRef(threadKey)
  threadKeyRef.current = threadKey

  const handleScrollRef = React.useRef<() => void>(() => {})

  const stopGlide = React.useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    glidingRef.current = false
  }, [])

  /** Follow growing content smoothly while an agent works: a quarter of the gap per frame. */
  const glide = React.useCallback(() => {
    if (frameRef.current !== null) return
    glidingRef.current = true
    let wrote: number | null = null
    const tick = () => {
      const viewport = viewportRef.current
      if (!viewport || !atBottomRef.current) {
        stopGlide()
        return
      }
      // Someone else moved the viewport (scrollbar, script, restore): the reader wins.
      // The scroll events were ignored while gliding, so re-read the position now.
      if (wrote !== null && Math.abs(viewport.scrollTop - wrote) > 2) {
        stopGlide()
        handleScrollRef.current()
        return
      }
      const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      const next = smoothStep(viewport.scrollTop, target)
      viewport.scrollTop = next
      wrote = viewport.scrollTop
      if (next === target) {
        frameRef.current = null
        glidingRef.current = false
        return
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [stopGlide])

  const reportNew = React.useCallback((count: number) => setNewCount(count), [])

  const setWorking = React.useCallback((working: boolean) => {
    workingRef.current = working
  }, [])

  const setBottom = React.useCallback((next: boolean) => {
    if (atBottomRef.current === next) return
    atBottomRef.current = next
    setAtBottom(next)
    if (next) setNewCount(0)
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
      stopGlide()
      pinRef.current = true
      setBottom(true)
      suppressRef.current = null
      if (pinTimerRef.current) clearTimeout(pinTimerRef.current)
      viewport.scrollTo({ top: viewport.scrollHeight, behavior })
      if (behavior !== "smooth") {
        pinRef.current = false
      } else {
        // Native smooth scrolling has no guaranteed end event. The pin is a
        // safety net, not a second animation: it only spans this gesture.
        pinTimerRef.current = setTimeout(() => {
          pinTimerRef.current = null
          if (!pinRef.current) return
          pinRef.current = false
          viewport.scrollTop = viewport.scrollHeight
        }, 900)
      }
    },
    [setBottom, stopGlide],
  )

  const sync = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    if (!initializedRef.current) {
      initializedRef.current = true
      atBottomRef.current = true
      setAtBottom(true)
      viewport.scrollTop = viewport.scrollHeight
      // A thread the reader left mid-way reopens where they were, once its rows exist.
      const saved = threadKeyRef.current ? recall(threadKeyRef.current) : undefined
      if (saved && !saved.atEnd && saved.anchorId) {
        restoreRef.current = { id: saved.anchorId, top: saved.anchorTop }
        restoreSyncsRef.current = 0
        // The rows may never contain that id (a pruned history). Do not search forever.
        restoreDeadlineRef.current = performance.now() + 2_000
        return
      }
      setReady(true)
      return
    }

    if (restoreRef.current) {
      const wanted = restoreRef.current
      const content = contentRef.current
      restoreSyncsRef.current += 1
      if (restoreExpired(restoreSyncsRef.current, performance.now(), restoreDeadlineRef.current)) {
        restoreRef.current = null
        setReady(true)
      } else {
        // The row may not be rendered yet (an earlier page is still arriving). Try again next
        // frame: this effect does not re-run by itself while the restore is pending.
        if (restoreFrameRef.current === 0) {
          restoreFrameRef.current = requestAnimationFrame(() => {
            restoreFrameRef.current = 0
            if (restoreRef.current) sync()
          })
        }
        const element = content
          ? Array.from(content.children).find(
              (child): child is HTMLElement => child instanceof HTMLElement && child.dataset.messageId === wanted.id,
            )
          : undefined
        if (element) {
          restoreRef.current = null
          const delta = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - wanted.top
          viewport.scrollTop += delta
          anchorRef.current = { id: wanted.id, top: wanted.top }
          atBottomRef.current = false
          setAtBottom(false)
          setReady(true)
          return
        }
      }
    }

    if (atBottomRef.current) {
      // The glide is the only scrollTop writer while it runs; it re-reads the target each frame.
      if (glidingRef.current) return
      const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      if (Math.abs(viewport.scrollTop - target) > 1) {
        const mode = followMode({
          atBottom: true,
          working: workingRef.current,
          reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        })
        if (mode === "smooth") {
          glide()
        } else {
          stopGlide()
          suppressRef.current = target
          viewport.scrollTop = target
        }
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
    if (Math.abs(delta) > 0.5) {
      viewport.scrollTop += delta
      // Store the offset after the correction; scrollTop assignment can land on
      // a fractional device pixel, and the pre-correction value would drift.
      anchor.top = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    } else {
      anchor.top = top
    }
  }, [captureAnchor, glide, stopGlide])

  const handleScroll = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (glidingRef.current) return

    if (suppressRef.current !== null) {
      if (Math.abs(viewport.scrollTop - suppressRef.current) < 1) {
        suppressRef.current = null
        if (pinRef.current) {
          pinRef.current = false
          setBottom(true)
          anchorRef.current = null
        }
        return
      }
      suppressRef.current = null
    }

    const bottom =
      viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - BOTTOM_SLACK
    if (pinRef.current) {
      // Keep the pin through the animation; growth during it is handled by sync().
      if (bottom) {
        pinRef.current = false
        setBottom(true)
        anchorRef.current = null
      } else {
        setBottom(true)
        anchorRef.current = null
      }
      return
    }
    setBottom(bottom)
    if (bottom) anchorRef.current = null
    else captureAnchor()
  }, [captureAnchor, setBottom])

  handleScrollRef.current = handleScroll

  const registerViewport = React.useCallback((element: HTMLDivElement | null) => {
    viewportRef.current = element
  }, [])

  const registerContent = React.useCallback((element: HTMLDivElement | null) => {
    contentRef.current = element
  }, [])

  // Leaving a thread remembers where the reader was and ends any glide or pin timer.
  React.useEffect(() => {
    return () => {
      if (pinTimerRef.current) clearTimeout(pinTimerRef.current)
      stopGlide()
      const key = threadKeyRef.current
      if (!key) return
      const anchor = anchorRef.current
      remember(key, {
        atEnd: atBottomRef.current,
        anchorId: anchor?.id ?? null,
        anchorTop: anchor?.top ?? 0,
      })
    }
  }, [stopGlide])

  React.useEffect(() => {
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => sync())
    observer.observe(content)
    // A composer growth or window resize changes only the viewport height. At the
    // bottom the reader must follow; mid-thread the anchor must survive.
    if (viewport) observer.observe(viewport)
    return () => observer.disconnect()
  }, [sync])

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const cancel = () => {
      // A reader gesture ends a pending restore: their position wins over the remembered one.
      restoreRef.current = null
      if (restoreFrameRef.current) cancelAnimationFrame(restoreFrameRef.current)
      restoreFrameRef.current = 0
      setReady(true)
      stopGlide()
      pinRef.current = false
      if (pinTimerRef.current) {
        clearTimeout(pinTimerRef.current)
        pinTimerRef.current = null
      }
    }
    viewport.addEventListener("wheel", cancel, { passive: true })
    viewport.addEventListener("touchstart", cancel, { passive: true })
    viewport.addEventListener("pointerdown", cancel)
    viewport.addEventListener("keydown", cancel)
    return () => {
      viewport.removeEventListener("wheel", cancel)
      viewport.removeEventListener("touchstart", cancel)
      viewport.removeEventListener("pointerdown", cancel)
      viewport.removeEventListener("keydown", cancel)
    }
  }, [stopGlide])

  const value = React.useMemo(
    () => ({
      atBottom,
      ready,
      newCount,
      setWorking,
      reportNew,
      registerViewport,
      registerContent,
      sync,
      handleScroll,
      scrollToEnd,
    }),
    [atBottom, ready, newCount, setWorking, reportNew, registerViewport, registerContent, sync, handleScroll, scrollToEnd],
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
        "size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain [overflow-anchor:none]",
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
}: React.ComponentProps<"button"> & { direction?: "start" | "end" }) {
  const { atBottom, newCount, scrollToEnd } = useScrollerContext()
  return (
    <button
      type="button"
      data-slot="message-scroller-button"
      data-active={atBottom ? "false" : "true"}
      tabIndex={atBottom ? -1 : 0}
      aria-hidden={atBottom}
      // Keep the composer's focus: the pill must not steal it.
      onPointerDown={(event) => event.preventDefault()}
      className={cn(
        "absolute inset-s-1/2 bottom-4 flex h-6 -translate-x-1/2 items-center gap-1 rounded-full bg-raised px-2.5 text-xs text-ink shadow-float transition-[translate,scale,opacity] duration-200 hover:bg-hover data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[active=false]:translate-y-full",
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
          <ChevronDownIcon className="size-3.5" />
          <span>Scroll to end</span>
          {newCount > 0 ? <span className="text-ink-muted tabular">· {newCount} new</span> : null}
        </>
      )}
    </button>
  )
}

function useMessageScroller() {
  const { scrollToEnd, setWorking, reportNew, atBottom, ready } = useScrollerContext()
  return {
    scrollToEnd,
    setWorking,
    reportNew,
    atBottom,
    ready,
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
