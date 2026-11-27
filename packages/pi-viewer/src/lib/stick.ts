export type FollowMode = "smooth" | "instant" | "none"

/**
 * How the scroller follows growing content.
 * Never when the reader scrolled up; smooth only while an agent works and motion is welcome;
 * instant otherwise. Mirrors the t3code rule, audit section 4.1.
 */
export function followMode(input: {
  atBottom: boolean
  working: boolean
  reducedMotion: boolean
  /** A send explicitly asks for the newest row, even when the reader had scrolled up. */
  sendPending?: boolean
}): FollowMode {
  if (input.sendPending) return "instant"
  if (!input.atBottom) return "none"
  if (input.working && !input.reducedMotion) return "smooth"
  return "instant"
}

/** One step of the smooth follow: close a quarter of the gap per frame, snap when within a pixel. */
export function smoothStep(current: number, target: number): number {
  const gap = target - current
  if (Math.abs(gap) <= 1) return target
  return current + gap * 0.25
}

export interface Remembered {
  atEnd: boolean
  anchorId: string | null
  anchorTop: number
}

const remembered = new Map<string, Remembered>()

export function remember(threadKey: string, value: Remembered): void {
  remembered.set(threadKey, value)
}

export function recall(threadKey: string): Remembered | undefined {
  return remembered.get(threadKey)
}

/** A remembered row that never appeared (pruned history) must not be searched forever. */
export const RESTORE_MS = 2_000

/** Bound a restore by wall time, not by how many renders happened. */
export function restoreExpired(now: number, deadline: number): boolean {
  return now > deadline
}
