import type { SessionsPayload, ThreadMeta, ThreadPayload, ViewerEvent } from "@/shared/types"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } })
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body: unknown = await response.json()
      if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
        message = body.error
      }
    } catch {
      // keep the status line
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

export function fetchSessions(): Promise<SessionsPayload> {
  return request<SessionsPayload>("/api/sessions")
}

export function fetchMeta(session: string): Promise<ThreadMeta> {
  return request<ThreadMeta>(`/api/thread?session=${encodeURIComponent(session)}&meta=1`)
}

export interface ThreadRequest {
  scope: "branch" | "all"
  limit?: number
  before?: number | null
  since?: number | null
  revision?: string | null
  /** The pane (%N) or window (@N, or an index) the thread is cut to; none means the whole session. */
  pane?: string | null
  window?: string | null
  signal?: AbortSignal
}

// One thread request at a time, across sessions and views. A slow poll delays the next one
// instead of stacking a second request on an overloaded server.
let threadQueue: Promise<unknown> = Promise.resolve()

export function fetchThread(session: string, options: ThreadRequest | "branch" | "all"): Promise<ThreadPayload> {
  const requestOptions: ThreadRequest =
    typeof options === "string" ? { scope: options } : options
  const params = new URLSearchParams({
    session,
    scope: requestOptions.scope,
  })
  if (requestOptions.limit != null) params.set("limit", String(requestOptions.limit))
  if (requestOptions.before != null) params.set("before", String(requestOptions.before))
  if (requestOptions.since != null) params.set("since", String(requestOptions.since))
  if (requestOptions.revision) params.set("revision", requestOptions.revision)
  if (requestOptions.pane) params.set("p", requestOptions.pane)
  else if (requestOptions.window) params.set("w", requestOptions.window)
  const signal = requestOptions.signal
  const run = threadQueue.then(
    () => {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError")
      return request<ThreadPayload>(`/api/thread?${params.toString()}`, { signal })
    },
    () => {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError")
      return request<ThreadPayload>(`/api/thread?${params.toString()}`, { signal })
    },
  )
  threadQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

const detailCache = new Map<string, Promise<ViewerEvent>>()

export function fetchEvent(session: string, paneId: string, seq: number): Promise<ViewerEvent> {
  const key = `${session}:${paneId}:${seq}`
  const cached = detailCache.get(key)
  if (cached) return cached
  const pending = request<ViewerEvent>(
    `/api/event?session=${encodeURIComponent(session)}&paneId=${encodeURIComponent(paneId)}&seq=${seq}`,
  )
  detailCache.set(key, pending)
  pending.catch(() => detailCache.delete(key))
  return pending
}

export function invalidateDetails(session: string): void {
  for (const key of detailCache.keys()) {
    if (key.startsWith(`${session}:`)) detailCache.delete(key)
  }
}

export async function sendPrompt(paneId: string, text: string): Promise<void> {
  await request<{ ok: boolean }>("/api/send", {
    method: "POST",
    body: JSON.stringify({ paneId, text }),
  })
}

/**
 * Stop one agent: the server sends a single Escape to that pane (XTRM-1088). The turn state in the
 * thread reports the result; the viewer never fakes an abort.
 */
export async function stopAgent(paneId: string): Promise<void> {
  await request<{ ok: boolean }>("/api/stop", {
    method: "POST",
    body: JSON.stringify({ paneId }),
  })
}
