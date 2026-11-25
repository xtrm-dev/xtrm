/** Last-read position per thread, kept in the browser only. Every access tolerates blocked storage. */

const PREFIX = "xtrm-viewer:last-seen:"

export function loadLastSeen(key: string): number {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    const value = raw ? Number(raw) : 0
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export function saveLastSeen(key: string, at: number): void {
  try {
    window.localStorage.setItem(PREFIX + key, String(Math.floor(at)))
  } catch {
    // Storage can be blocked or full; the divider then simply does not persist.
  }
}

interface Timed {
  id: string
  at: number
  kind: string
}

/**
 * Index of the first row that arrived after `lastSeen` and was not written by the operator,
 * or -1 when there is nothing new, nothing was ever read, or the new row is first on the page
 * (a divider above the first row marks nothing).
 */
export function newSinceIndex(items: readonly Timed[], lastSeen: number): number {
  if (lastSeen <= 0) return -1
  const index = items.findIndex(
    (item) => item.at > lastSeen && item.kind !== "user" && item.kind !== "optimistic",
  )
  return index > 0 ? index : -1
}

/** Rows after the divider, excluding the operator's own. */
export function newCount(items: readonly Timed[], lastSeen: number): number {
  if (lastSeen <= 0) return 0
  return items.filter((item) => item.at > lastSeen && item.kind !== "user" && item.kind !== "optimistic").length
}
