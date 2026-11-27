import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface PeerIdentity {
  name: string
  runtime: "pi" | "claude"
  id?: string
  cwd?: string
}

const CACHE_TTL = 30_000
const cache = new Map<string, { expiresAt: number; value: PeerIdentity | null }>()

function readPeer(pid: string): PeerIdentity | null {
  const path = join(homedir(), ".claude", "sessions", `${pid}.json`)
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (typeof parsed !== "object" || parsed === null) return null
    const record = parsed as Record<string, unknown>
    if (typeof record.name !== "string" || !record.name.trim()) return null
    return {
      name: record.name,
      runtime: record.entrypoint === "pi" ? "pi" : "claude",
      id: typeof record.sessionId === "string" ? record.sessionId : undefined,
      cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Resolve an intercom address to a readable peer. Only the Claude session
 * registry is consulted; the viewer never talks to the socket.
 */
export function resolvePeer(address: string | undefined): PeerIdentity | null {
  if (!address) return null
  const match = /(?:^|\/)cc-socks\/(\d+)\.sock$/.exec(address)
  if (!match) return null
  const pid = match[1]
  const cached = cache.get(pid)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const value = readPeer(pid)
  cache.set(pid, { expiresAt: Date.now() + CACHE_TTL, value })
  return value
}

export function peerLabel(address: string | undefined): string | undefined {
  if (!address) return undefined
  const peer = resolvePeer(address)
  if (peer) return peer.name
  if (address.startsWith("uds:")) {
    const pid = /cc-socks\/(\d+)\.sock$/.exec(address)?.[1]
    return pid ? `claude · ${pid}` : "claude peer"
  }
  return address
}
