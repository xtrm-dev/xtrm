import { useEffect, useMemo, useRef, useState } from "react"

import { AllEventsView } from "@/components/AllEventsView"
import { ChannelView } from "@/components/ChannelView"
import { Composer } from "@/components/Composer"
import { ViewerHeader } from "@/components/ViewerHeader"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { fetchMeta, fetchSessions, fetchThread, invalidateDetails, sendPrompt } from "@/lib/api"
import { isEchoOf, type OptimisticMessage } from "@/lib/optimistic"
import type { ThreadMeta, ThreadPayload, ViewerAgent, ViewerSession } from "@/shared/types"

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function App() {
  const [sessions, setSessions] = useState<ViewerSession[]>([])
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState<string | null>(null)
  const [meta, setMeta] = useState<ThreadMeta | null>(null)
  const [branch, setBranch] = useState<ThreadPayload | null>(null)
  const [all, setAll] = useState<ThreadPayload | null>(null)
  const [view, setView] = useState<"channel" | "all">("channel")
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([])
  const [targetPaneId, setTargetPaneId] = useState<string | null>(null)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [kick, setKick] = useState(0)
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  )
  const viewRef = useRef(view)
  const scrollerKey = `${sessionName ?? "none"}:${view}`

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem("pi-viewer-theme", theme)
    } catch {
      // storage can be blocked; the current session still changes theme
    }
  }, [theme])

  useEffect(() => {
    let live = true
    async function load() {
      try {
        const payload = await fetchSessions()
        if (!live) return
        setSessions(payload.sessions)
        setDiscoveryError(
          payload.error ?? (payload.sessions.length ? null : "No tmux session with a running pi pane."),
        )
        setSessionName((current) => {
          if (current && payload.sessions.some((entry) => entry.name === current)) return current
          const preferred = payload.sessions.find((entry) => entry.name === "xx") ?? payload.sessions[0]
          return preferred?.name ?? null
        })
      } catch (error) {
        if (live) setDiscoveryError(errorText(error))
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 10_000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [kick])

  useEffect(() => {
    if (!sessionName) {
      setBranch(null)
      setAll(null)
      setMeta(null)
      return
    }
    let cancelled = false
    let known: string | null = null
    setBranch(null)
    setAll(null)
    setMeta(null)
    setThreadError(null)
    setOptimistic([])
    invalidateDetails(sessionName)

    async function tick() {
      try {
        const nextMeta = await fetchMeta(sessionName!)
        if (cancelled) return
        setMeta(nextMeta)
        if (nextMeta.version === known) return
        known = nextMeta.version
        const payload = await fetchThread(sessionName!, "branch")
        if (cancelled) return
        setBranch(payload)
        setThreadError(null)
        if (viewRef.current === "all") {
          const everything = await fetchThread(sessionName!, "all")
          if (!cancelled) setAll(everything)
        } else {
          setAll(null)
        }
      } catch (error) {
        if (!cancelled) setThreadError(errorText(error))
      }
    }

    void tick()
    const timer = window.setInterval(() => void tick(), 1_500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [sessionName, kick])

  useEffect(() => {
    if (view !== "all" || !sessionName) return
    if (all && branch && all.version === branch.version) return
    let live = true
    fetchThread(sessionName, "all")
      .then((payload) => {
        if (live) setAll(payload)
      })
      .catch((error: unknown) => {
        if (live) setThreadError(errorText(error))
      })
    return () => {
      live = false
    }
  }, [view, sessionName, all, branch])

  useEffect(() => {
    if (!branch) return
    setOptimistic((previous) => {
      const next = previous.filter((message) => {
        if (message.status === "error") return true
        return !branch.events.some((event) => isEchoOf(event, message))
      })
      return next.length === previous.length ? previous : next
    })
  }, [branch])

  const agents = useMemo<ViewerAgent[]>(
    () => branch?.agents ?? meta?.agents ?? sessions.find((entry) => entry.name === sessionName)?.agents ?? [],
    [branch, meta, sessions, sessionName],
  )

  useEffect(() => {
    if (!agents.length) {
      setTargetPaneId(null)
      return
    }
    if (targetPaneId && agents.some((agent) => agent.id === targetPaneId)) return
    const recent = [...agents].sort((a, b) => b.modifiedAt - a.modifiedAt)[0]
    setTargetPaneId(recent?.id ?? agents[0].id)
  }, [agents, targetPaneId])

  const target = agents.find((agent) => agent.id === targetPaneId) ?? null

  async function handleSend(agent: ViewerAgent, text: string) {
    const message: OptimisticMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      paneId: agent.id,
      agentName: agent.name,
      text,
      at: Date.now(),
      status: "sending",
    }
    setOptimistic((previous) => [...previous, message])
    try {
      await sendPrompt(agent.paneId, text)
      setOptimistic((previous) =>
        previous.map((entry) => (entry.id === message.id ? { ...entry, status: "sent" } : entry)),
      )
    } catch (error) {
      const text = errorText(error)
      setOptimistic((previous) =>
        previous.map((entry) =>
          entry.id === message.id ? { ...entry, status: "error", error: text } : entry,
        ),
      )
      throw error
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-deep text-ink">
      <ViewerHeader
        sessions={sessions}
        session={sessionName}
        onSessionChange={(next) => {
          setSessionName(next)
          setView("channel")
        }}
        view={view}
        onViewChange={setView}
        agentCount={agents.length}
        theme={theme}
        onToggleTheme={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
      />

      {threadError ? (
        <div className="flex shrink-0 items-center gap-2 bg-danger/5 px-4 py-1.5 text-2xs text-danger sm:px-5">
          <span className="truncate">{threadError}</span>
          <button
            type="button"
            onClick={() => setKick((value) => value + 1)}
            className="ml-auto shrink-0 text-ink-faint underline-offset-2 hover:text-ink-muted hover:underline"
          >
            Retry
          </button>
        </div>
      ) : null}

      {!sessionName ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="text-sm text-ink-muted">{discoveryError ?? "Looking for tmux sessions…"}</div>
          <div className="max-w-md text-xs text-ink-faint">
            The viewer reads pi session files from ~/.pi/agent/sessions and injects prompts with
            tmux send-keys. It never attaches to a pane.
          </div>
          <button
            type="button"
            onClick={() => setKick((value) => value + 1)}
            className="rounded-md bg-control px-2.5 py-1 text-xs text-ink-muted hover:bg-hover"
          >
            Rescan
          </button>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1">
            <MessageScrollerProvider key={scrollerKey} autoScroll defaultScrollPosition="end">
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent
                    className={
                      view === "channel"
                        ? "mx-auto w-full max-w-3xl gap-6 px-4 pt-5 pb-8 sm:px-5"
                        : "mx-auto w-full max-w-5xl gap-3 px-4 pt-0 pb-8 sm:px-5"
                    }
                  >
                    {view === "channel" ? (
                      branch ? (
                        <ChannelView
                          events={branch.events}
                          agents={branch.agents}
                          session={branch.session}
                          optimistic={optimistic}
                          onDismissOptimistic={(id) =>
                            setOptimistic((previous) => previous.filter((entry) => entry.id !== id))
                          }
                        />
                      ) : (
                        <div className="py-20 text-center text-xs text-ink-faint">Loading thread…</div>
                      )
                    ) : all ? (
                      <AllEventsView
                        key={sessionName}
                        events={all.events}
                        agents={all.agents}
                        session={all.session}
                      />
                    ) : (
                      <div className="py-20 text-center text-xs text-ink-faint">Loading events…</div>
                    )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton direction="end" />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>

          <Composer
            agents={agents}
            target={target}
            onTargetChange={(agent) => setTargetPaneId(agent.id)}
            onSend={handleSend}
            disabled={!agents.length}
          />
        </>
      )}
    </div>
  )
}
