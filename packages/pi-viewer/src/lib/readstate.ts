/** Last-read position per thread, kept in the browser only. Every access tolerates blocked storage. */

const PREFIX = "xtrm-viewer:last-seen:"

/** A read-state key belongs to one tmux server: a reused window/pane id is not the same thread. */
export function threadReadKey(serverId: string, base: string): string {
  return `${serverId}:${base}`
}

export function loadLastSeen(key: string): number {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    const value = raw ? Number(raw) : 0
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export function dropLastSeen(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key)
  } catch {
    // Storage can be blocked; there is nothing to migrate then.
  }
}

/**
 * Read this scope's position, migrating one old key once. Old `session:agentIds` keys and
 * server-less scope keys are dropped after their value moves to the key with a tmux server id.
 */
export function migrateLastSeen(key: string, legacyKeys: readonly string[] = []): number {
  const current = loadLastSeen(key)
  if (current > 0) {
    for (const legacy of legacyKeys) dropLastSeen(legacy)
    return current
  }
  for (const legacy of legacyKeys) {
    const value = loadLastSeen(legacy)
    if (value > 0) {
      saveLastSeen(key, value)
      for (const other of legacyKeys) dropLastSeen(other)
      return value
    }
  }
  for (const legacy of legacyKeys) dropLastSeen(legacy)
  return 0
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

/** True only once the scroller has applied the remembered position and the reader is at the end. */
export function shouldSaveLastSeen(input: {
  ready: boolean
  atBottom: boolean
  visible: boolean
  newest: number
}): boolean {
  return input.ready && input.atBottom && input.visible && input.newest > 0
}

/**
 * The scroll pill counts timeline rows appended after the reader left the bottom. Rows loaded
 * with "Load earlier" are older than the leave point and do not count; presence-only updates
 * that do not add a row do not count either.
 */
export function unseenTimelineItems(
  items: readonly Timed[],
  seen: ReadonlySet<string>,
  leftAt: number,
  atBottom: boolean,
): number {
  if (atBottom) return 0
  return items.filter(
    (item) =>
      item.at >= leftAt &&
      !seen.has(item.id) &&
      item.kind !== "user" &&
      item.kind !== "optimistic",
  ).length
}

/** Rows after the divider, excluding the operator's own. */
export function newCount(items: readonly Timed[], lastSeen: number): number {
  if (lastSeen <= 0) return 0
  return items.filter((item) => item.at > lastSeen && item.kind !== "user" && item.kind !== "optimistic").length
}
