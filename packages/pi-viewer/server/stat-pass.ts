import { readdirSync, statSync, type Stats } from "node:fs"

/**
 * One discovery pass looks at the same transcript files from several places: the directory
 * listing of every pane that shares a cwd, the name probe, the parser, the Claude pairing.
 * Inside a pass each file is stat'ed once and each directory listed once; outside a pass
 * these calls are plain `statSync` and `readdirSync`.
 */
interface Pass {
  stats: Map<string, Stats | Error>
  listings: Map<string, string[] | Error>
}

let active: Pass | null = null

/** Run `fn` with the memo active. Synchronous: a pass never spans an await. */
export function withStatPass<T>(fn: () => T): T {
  if (active) return fn()
  active = { stats: new Map(), listings: new Map() }
  try {
    return fn()
  } finally {
    active = null
  }
}

export function statOnce(file: string): Stats {
  if (!active) return statSync(file)
  let found = active.stats.get(file)
  if (found === undefined) {
    try {
      found = statSync(file)
    } catch (error) {
      found = error instanceof Error ? error : new Error(String(error))
    }
    active.stats.set(file, found)
  }
  if (found instanceof Error) throw found
  return found
}

export function listOnce(dir: string): string[] {
  if (!active) return readdirSync(dir)
  let found = active.listings.get(dir)
  if (found === undefined) {
    try {
      found = readdirSync(dir)
    } catch (error) {
      found = error instanceof Error ? error : new Error(String(error))
    }
    active.listings.set(dir, found)
  }
  if (found instanceof Error) throw found
  return found
}
