import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { AllEventsView } from "@/components/AllEventsView"
import { ChannelView } from "@/components/ChannelView"
import { Composer } from "@/components/Composer"
import { PresenceLine } from "@/components/presence/PresenceLine"
import { Sidebar } from "@/components/sidebar/Sidebar"
import { ConsoleShell } from "@/shell/ConsoleShell"
import { useSidebarLayout } from "@/shell/layout"
import { ViewerHeader } from "@/components/ViewerHeader"
import { laneValue, loadWidth, saveWidth } from "@/lib/chat-width"
import {
  MessageScroller,
  MessageScrollerApi,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { fetchSessions, fetchThread, invalidateDetails, sendPrompt } from "@/lib/api"
import { isEchoOf, type OptimisticMessage } from "@/lib/optimistic"
import { splitPresence } from "@/lib/presence"
import { replyBarAgent, replyIdFor } from "@/lib/reply"
import { channelTimeline } from "@/lib/thread"
import {
  agentsInScope,
  defaultTarget,
  describeScope,
  eventsInScope,
  hasAgents,
  identicalScope,
  parseScope,
  sameScope,
  sameScopeState,
  SCOPE_GRACE,
  scopeFromUrl,
  scopeRowKey,
  serialiseScope,
  trackScope,
  type Scope,
  type ScopeTrack,
} from "@/lib/scope"
import { threadReadKey } from "@/lib/readstate"
import { mergeLive } from "@/lib/tree"
import type { ThreadMeta, ThreadPayload, ViewerAgent, ViewerEvent, ViewerSession } from "@/shared/types"

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function mergeEvents(previous: ViewerEvent[], incoming: ViewerEvent[]): ViewerEvent[] {
  const byId = new Map(previous.map((event) => [event.id, event]))
  for (const event of incoming) byId.set(event.id, event)
  return [...byId.values()].sort(
    (a, b) => a.at - b.at || a.agentId.localeCompare(b.agentId) || a.seq - b.seq,
  )
}

/** Incremental polls carry new/changed events; the window and its earlier boundary stay put. */
function mergePayload(previous: ThreadPayload | null, incoming: ThreadPayload): ThreadPayload {
  if (!previous || previous.revision !== incoming.revision) return incoming
  return {
    ...previous,
    ...incoming,
    events: mergeEvents(previous.events, incoming.events),
    hasEarlier: previous.hasEarlier,
    earlier: previous.earlier,
    earlierTurns: previous.earlierTurns,
  }
}

export default function App() {
  const shell = useSidebarLayout()
  const [sessions, setSessions] = useState<ViewerSession[]>([])
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope | null>(null)
  const [targetPaneId, setTargetPaneId] = useState<string | null>(null)
  // The agent a Reply click aimed the composer at (XTRM-1045); the composer shows its bar.
  const [replyPaneId, setReplyPaneId] = useState<string | null>(null)
  const [meta, setMeta] = useState<ThreadMeta | null>(null)
  const [branch, setBranch] = useState<ThreadPayload | null>(null)
  const [all, setAll] = useState<ThreadPayload | null>(null)
  const [view, setView] = useState<"channel" | "all">("channel")
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([])
  const sendScrollRef = useRef<{ requestSendScroll: () => void } | null>(null)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [earlierLoading, setEarlierLoading] = useState(false)
  const [kick, setKick] = useState(0)
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  )
  const [chatWidth, setChatWidth] = useState(loadWidth)
  // One root variable carries the lane width to the thread, the composer and the presence line.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--chat-lane", laneValue(chatWidth))
    saveWidth(chatWidth)
  }, [chatWidth])
  const sessionName = scope?.session ?? null
  // Remount keys use the scope's identity, not its URL: a pane scope with or without its window is one scope.
  const scopeKey = scope ? scopeRowKey(scope) : "none"
  const scrollerKey = `${scopeKey}:${view}`
  // The scope of a fresh page comes from the URL. It is a request, read only until a scope has
  // resolved; after that the user's selection is never replaced by the page-open URL.
  const requestedScope = useRef<Scope | null>(parseScope(window.location.search))
  // The scope as polls see it: the last good scope plus how long its target has been absent.
  const track = useRef<ScopeTrack>({ scope: null, absent: 0 })
  const sessionsRef = useRef<ViewerSession[]>([])
  // Consecutive discovery polls that found no agent at all.
  const emptyPolls = useRef(0)
  // How the next URL write is made: a click on the sidebar adds a history entry (Back works);
  // a fallback or a first resolution replaces the current one.
  const urlMode = useRef<"push" | "replace">("replace")

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem("pi-viewer-theme", theme)
    } catch {
      // storage can be blocked; the current session still changes theme
    }
  }, [theme])

  // The URL follows the scope: ?s=<session>[&w=<window>[&p=<pane>]].
  useEffect(() => {
    if (!scope) return
    const search = serialiseScope(scope)
    if (search !== window.location.search) {
      window.history[urlMode.current === "push" ? "pushState" : "replaceState"](null, "", search)
    }
    urlMode.current = "replace"
  }, [scope])

  function applyTrack(next: ScopeTrack) {
    track.current = next
    if (next.scope) requestedScope.current = null
    setScope((current) => (sameScopeState(current, next.scope) ? current : next.scope))
  }

  // One observation of what exists now (a discovery or a thread poll) advances the scope.
  function observe(view: ViewerSession[]) {
    applyTrack(trackScope(track.current, view, requestedScope.current))
  }

  // Back and Forward: read the URL again, resolve it against what exists now, and write the
  // resolved URL back, so a stale or invalid address never stays in the bar.
  useEffect(() => {
    function onPop() {
      const resolved = scopeFromUrl(window.location.search, track.current.scope, sessionsRef.current)
      urlMode.current = "replace"
      // A history step within the same scope (the presence sheet's own entry) keeps the
      // composer target; only a scope change resets it.
      if (!resolved || !sameScope(resolved, track.current.scope)) {
        setTargetPaneId(null)
        setReplyPaneId(null)
      }
      if (!resolved) return
      applyTrack({ scope: resolved, absent: 0 })
      const search = serialiseScope(resolved)
      if (search !== window.location.search) window.history.replaceState(null, "", search)
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyTrack only touches refs and a state setter
  }, [])

  useEffect(() => {
    let live = true
    async function load() {
      try {
        const payload = await fetchSessions()
        if (!live) return
        setDiscoveryError(
          payload.error ?? (payload.sessions.length ? null : "No tmux session with a running pi or claude pane."),
        )
        // One empty poll is a hiccup, not an empty tmux: the last good list stays for a few polls,
        // so the sidebar does not blank, and the scope is kept (see trackScope).
        emptyPolls.current = hasAgents(payload.sessions) ? 0 : emptyPolls.current + 1
        if (hasAgents(payload.sessions) || emptyPolls.current >= SCOPE_GRACE) {
          setSessions(payload.sessions)
          sessionsRef.current = payload.sessions
        }
        observe(payload.sessions)
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
    const activeScope: "branch" | "all" = view === "all" ? "all" : "branch"
    const setPayload = activeScope === "all" ? setAll : setBranch
    const controller = new AbortController()
    let cancelled = false
    let revision: string | null = null
    let cursor: number | null = null
    let delay = 1_500
    let timer: number | undefined
    setPayload(null)
    setThreadError(null)
    setEarlierLoading(false)
    setOptimistic([])
    invalidateDetails(sessionName)

    async function tick() {
      const started = performance.now()
      try {
        const payload = await fetchThread(
          sessionName!,
          cursor == null || revision == null
            ? { scope: activeScope, limit: 150, signal: controller.signal }
            : { scope: activeScope, since: cursor, revision, signal: controller.signal },
        )
        if (cancelled) return
        if (cursor == null || revision == null || payload.reset) {
          setPayload(payload)
        } else if (!payload.unchanged) {
          setPayload((previous) => mergePayload(previous, payload))
        }
        cursor = payload.cursor
        revision = payload.revision
        const nextMeta: ThreadMeta = {
          session: payload.session,
          serverId: payload.serverId,
          version: payload.version,
          agents: payload.agents,
          capturedAt: payload.capturedAt,
        }
        setMeta(nextMeta)
        observe(mergeLive(sessionsRef.current, payload.session, nextMeta))
        setThreadError(null)
        delay = 1_500
      } catch (error) {
        if (cancelled) return
        setThreadError(errorText(error))
        delay = Math.min(10_000, Math.max(1_500, delay * 2))
      }
      const elapsed = performance.now() - started
      if (elapsed > 2_000) delay = Math.max(delay, 10_000)
      else if (elapsed > 800) delay = Math.max(delay, 5_000)
      if (!cancelled) timer = window.setTimeout(() => void tick(), delay)
    }

    void tick()
    return () => {
      cancelled = true
      controller.abort()
      if (timer != null) window.clearTimeout(timer)
    }
  }, [sessionName, view, kick])

  async function loadEarlier() {
    const active = view === "all" ? all : branch
    if (!sessionName || !active || active.earlier == null || earlierLoading) return
    setEarlierLoading(true)
    try {
      const payload = await fetchThread(sessionName, {
        scope: view === "all" ? "all" : "branch",
        before: active.earlier,
        revision: active.revision,
        limit: 150,
      })
      if (payload.reset) {
        setKick((value) => value + 1)
        return
      }
      const merge = (previous: ThreadPayload | null): ThreadPayload | null =>
        previous
          ? {
              ...previous,
              events: mergeEvents(previous.events, payload.events),
              hasEarlier: payload.hasEarlier,
              earlier: payload.earlier,
              earlierTurns: payload.earlierTurns,
            }
          : previous
      if (view === "all") setAll(merge)
      else setBranch(merge)
    } catch (error) {
      setThreadError(errorText(error))
    } finally {
      setEarlierLoading(false)
    }
  }

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

  // A thread payload belongs to one session. Right after a cross-session select the previous
  // payload is still in state; it is used only while it names the session being read.
  const freshAgents = useMemo(() => {
    if (meta && meta.session === sessionName) return { session: meta.session, agents: meta.agents }
    if (branch && branch.session === sessionName) return { session: branch.session, agents: branch.agents }
    return null
  }, [meta, branch, sessionName])

  // The sidebar lists every session; the one being read refreshes with the thread poll, the
  // rest with the 10 s discovery poll.
  const liveSessions = useMemo<ViewerSession[]>(
    () => mergeLive(sessions, sessionName, freshAgents),
    [sessions, sessionName, freshAgents],
  )

  // The agents of the scope, in tree order, and the events they wrote. The payload carries the
  // whole tmux session; the scope filters it here, so no server change is needed.
  // While a target is absent for a poll or two its last agents stay on screen, so one poll that
  // drops a pane does not blank the thread.
  const lastAgents = useRef<{ key: string; agents: ViewerAgent[] } | null>(null)
  const agents = useMemo<ViewerAgent[]>(() => {
    const fresh = freshAgents ? mergeLive(sessions, sessionName, freshAgents) : sessions
    const inScope = agentsInScope(fresh, scope)
    const found = inScope.length ? inScope : agentsInScope(sessions, scope)
    const key = scope ? scopeRowKey(scope) : ""
    if (found.length) {
      lastAgents.current = { key, agents: found }
      return found
    }
    return lastAgents.current?.key === key ? lastAgents.current.agents : found
  }, [freshAgents, sessions, sessionName, scope])

  const scopeEvents = useMemo<ViewerEvent[]>(() => eventsInScope(branch?.events ?? [], agents), [branch, agents])
  const scopeAllEvents = useMemo<ViewerEvent[]>(() => eventsInScope(all?.events ?? [], agents), [all, agents])
  const scopeOptimistic = useMemo(() => {
    const ids = new Set(agents.map((agent) => agent.id))
    return optimistic.filter((message) => ids.has(message.paneId))
  }, [optimistic, agents])

  // The composer addresses one agent of the scope: the one picked, else the pane itself or the
  // most recently active agent of the window or session.
  const target = useMemo(
    () => agents.find((agent) => agent.id === targetPaneId) ?? defaultTarget(agents, scope),
    [agents, targetPaneId, scope],
  )
  const label = useMemo(() => describeScope(scope, agents), [scope, agents])

  // The running agents of the scope, shown by the presence line above the composer (XTRM-1035).
  const presence = useMemo(
    () => splitPresence(channelTimeline(scopeEvents, scopeOptimistic), agents).presence,
    [scopeEvents, scopeOptimistic, agents],
  )

  function messageAgent(agent: ViewerAgent) {
    setTargetPaneId(agent.id)
    setReplyPaneId(null)
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus()
    })
  }

  function replyToAgent(agent: ViewerAgent) {
    messageAgent(agent)
    setReplyPaneId(scope ? replyIdFor(scope.kind, agent.id) : null)
  }

  function select(next: Scope) {
    if (sameScope(next, scope)) {
      // The same target: no history entry. A pane opened without its window learns it quietly.
      if (!identicalScope(next, scope)) {
        urlMode.current = "replace"
        applyTrack({ scope: next, absent: 0 })
      }
      return
    }
    if (next.session !== sessionName) setView("channel")
    urlMode.current = "push"
    setTargetPaneId(null)
    setReplyPaneId(null)
    applyTrack({ scope: next, absent: 0 })
  }

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
    // A send is an explicit request for the newest row; the scroller keeps it pinned until a gesture.
    sendScrollRef.current?.requestSendScroll()
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
    <ConsoleShell
      layout={shell}
      sidebar={
        <Sidebar
          sessions={liveSessions}
          scope={scope}
          onSelect={(next) => {
            select(next)
            if (shell.narrow) shell.setOpen(false)
          }}
          onCollapse={() => shell.setOpen(false)}
        />
      }
    >
      <ViewerHeader
        label={label}
        view={view}
        onViewChange={setView}
        theme={theme}
        onToggleTheme={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
        chatWidth={chatWidth}
        onChatWidthChange={setChatWidth}
        sidebarOpen={shell.open}
        onOpenSidebar={() => shell.setOpen(true)}
      />

      {threadError ? (
        <div className="flex shrink-0 items-center gap-2 bg-danger/5 px-4 py-1.5 text-2xs text-danger sm:px-5">
          <span className="truncate">{threadError}</span>
          <button
            type="button"
            onClick={() => setKick((value) => value + 1)}
            className="ml-auto shrink-0 text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Retry
          </button>
        </div>
      ) : null}

      {!sessionName ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="text-sm text-ink-muted">{discoveryError ?? "Looking for tmux sessions…"}</div>
          <div className="max-w-md text-xs text-ink-muted">
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
            <MessageScrollerProvider key={scrollerKey} threadKey={scrollerKey}>
              <MessageScrollerApi onReady={(api) => (sendScrollRef.current = api)} />
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent
                    className={
                      view === "channel"
                        ? "xtrm-lane-padded mx-auto w-full gap-6 px-3 pt-5 pb-8 sm:px-12"
                        : "mx-auto w-full max-w-5xl gap-3 px-4 pt-0 pb-8 sm:px-5"
                    }
                  >
                    {view === "channel" ? (
                      branch ? (
                        <ChannelView
                          events={scopeEvents}
                          agents={agents}
                          session={branch.session}
                          readKey={threadReadKey(branch.serverId, scope ? scopeRowKey(scope) : branch.session)}
                          legacyReadKeys={[
                            scope ? scopeRowKey(scope) : branch.session,
                            `${branch.session}:${agents
                              .map((agent) => agent.id)
                              .sort()
                              .join(",")}`,
                          ]}
                          optimistic={scopeOptimistic}
                          onDismissOptimistic={(id) =>
                            setOptimistic((previous) => previous.filter((entry) => entry.id !== id))
                          }
                          hasEarlier={branch.hasEarlier}
                          earlierTurns={branch.earlierTurns}
                          earlierLoading={earlierLoading}
                          onLoadEarlier={() => void loadEarlier()}
                          onReply={replyToAgent}
                        />
                      ) : (
                        <div className="py-20 text-center text-xs text-ink-muted">Loading thread…</div>
                      )
                    ) : all ? (
                      <AllEventsView
                        key={scopeKey}
                        events={scopeAllEvents}
                        agents={agents}
                        session={all.session}
                        hasEarlier={all.hasEarlier}
                        earlierTurns={all.earlierTurns}
                        earlierLoading={earlierLoading}
                        onLoadEarlier={() => void loadEarlier()}
                      />
                    ) : (
                      <div className="py-20 text-center text-xs text-ink-muted">Loading events…</div>
                    )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton direction="end" />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>

          <div className="shrink-0 bg-canvas px-3 pt-1 sm:px-12">
            <PresenceLine
              entries={presence}
              session={branch?.session ?? sessionName ?? ""}
              onMessage={messageAgent}
              onOpenPane={(agent) =>
                select({
                  kind: "pane",
                  session: agent.tmuxSession,
                  window: agent.windowIndex,
                  windowId: agent.windowId,
                  paneId: agent.paneId,
                })
              }
            />
          </div>

          <Composer
            agents={agents}
            target={target}
            onTargetChange={(agent) => {
              setTargetPaneId(agent.id)
              setReplyPaneId(null)
            }}
            replyTo={replyBarAgent(replyPaneId, target)}
            onClearReply={() => setReplyPaneId(null)}
            onSend={handleSend}
            disabled={!agents.length}
          />
        </>
      )}
    </ConsoleShell>
  )
}
