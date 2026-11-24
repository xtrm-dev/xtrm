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

export function fetchThread(session: string, scope: "branch" | "all"): Promise<ThreadPayload> {
  return request<ThreadPayload>(
    `/api/thread?session=${encodeURIComponent(session)}&scope=${scope}`,
  )
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
