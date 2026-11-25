import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

import type { ViewerAgent, ViewerSession } from "../src/shared/types.ts"
import {
  claudeAgentName,
  claudeStatusOf,
  configDirOf,
  parseClaudeFile,
  readClaudeRegistry,
  readProcStart,
  resolveClaudeTranscripts,
  transcriptSessionId,
  type ClaudePaneQuery,
  type ClaudeTranscript,
} from "./claude.ts"
import { repoNameOf } from "./repo.ts"
import { prunePaneReads, withPaneAttention } from "./attention.ts"
import { lastWriteAt, parseSessionFile, readSessionName, sessionIdFromFile, statusOf, type AgentState } from "./session.ts"

const HOME = homedir()
const SESSIONS_ROOT = join(HOME, ".pi", "agent", "sessions")

export interface TmuxPane {
  session: string
  windowIndex: number
  windowId: string
  windowName: string
  paneIndex: number
  paneId: string
  panePid: number
  command: string
  cwd: string
  title: string
  role: string | null
  serverPid: string
  socketPath: string
}

interface Proc {
  pid: number
  ppid: number
  comm: string
  args: string
  depth: number
}

function run(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

export function listTmuxPanes(): { panes: TmuxPane[]; error?: string } {
  const format = [
    "#{session_name}",
    "#{window_index}",
    "#{window_id}",
    "#{window_name}",
    "#{pane_index}",
    "#{pane_id}",
    "#{pane_pid}",
    "#{pane_current_command}",
    "#{pane_current_path}",
    "#{pane_title}",
    "#{@agent_role}",
    "#{pid}",
    "#{socket_path}",
  ].join("\t")
  const output = run("tmux", ["list-panes", "-a", "-F", format])
  if (output === null) return { panes: [], error: "tmux is not running or not installed" }
  const panes: TmuxPane[] = []
  for (const line of output.split("\n")) {
    if (!line.trim()) continue
    const [session, windowIndex, windowId, windowName, paneIndex, paneId, panePid, command, cwd, title, role, serverPid, socketPath] =
      line.split("\t")
    if (!session || !paneId) continue
    panes.push({
      session,
      windowIndex: Number(windowIndex) || 0,
      windowId,
      windowName: windowName ?? "",
      paneIndex: Number(paneIndex) || 0,
      paneId,
      panePid: Number(panePid) || 0,
      command: command ?? "",
      cwd: cwd ?? "",
      title: title ?? "",
      role: role?.trim() || null,
      serverPid: serverPid ?? "",
      socketPath: socketPath ?? "",
    })
  }
  return { panes }
}

function processTable(): Map<number, Proc> {
  const output = run("ps", ["-eo", "pid=,ppid=,comm=,args="])
  const table = new Map<number, Proc>()
  if (!output) return table
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/, 4)
    if (parts.length < 3) continue
    const pid = Number(parts[0])
    const ppid = Number(parts[1])
    if (!pid) continue
    table.set(pid, {
      pid,
      ppid,
      comm: parts[2] ?? "",
      args: parts[3] ?? "",
      depth: 0,
    })
  }
  return table
}

function descendants(rootPid: number, table: Map<number, Proc>): Proc[] {
  const children = new Map<number, number[]>()
  for (const proc of table.values()) {
    const list = children.get(proc.ppid) ?? []
    list.push(proc.pid)
    children.set(proc.ppid, list)
  }
  const found: Proc[] = []
  const queue: Array<{ pid: number; depth: number }> = [{ pid: rootPid, depth: 0 }]
  const seen = new Set<number>()
  while (queue.length) {
    const next = queue.shift()
    if (!next || seen.has(next.pid)) continue
    seen.add(next.pid)
    for (const childPid of children.get(next.pid) ?? []) {
      const proc = table.get(childPid)
      if (!proc) continue
      proc.depth = next.depth + 1
      found.push(proc)
      queue.push({ pid: childPid, depth: next.depth + 1 })
    }
  }
  return found
}

function isPiProcess(proc: Proc): boolean {
  if (proc.comm === "pi" || proc.comm === "pi-coding-agent") return true
  const first = proc.args.trim().split(/\s+/)[0] ?? ""
  if (basename(first) === "pi") return true
  return /(?:^|\/)pi-coding-agent(?:\/|\s|$)/.test(proc.args)
}

function isClaudeProcess(proc: Proc): boolean {
  if (proc.comm === "claude") return true
  const first = proc.args.trim().split(/\s+/)[0] ?? ""
  return basename(first) === "claude"
}

function readProcCwd(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`
}

function sessionFiles(dir: string): Array<{ file: string; mtimeMs: number }> {
  if (!existsSync(dir)) return []
  const files: Array<{ file: string; mtimeMs: number }> = []
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue
      const file = join(dir, name)
      try {
        files.push({ file, mtimeMs: statSync(file).mtimeMs })
      } catch {
        // vanished during listing
      }
    }
  } catch {
    return []
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return files
}

export function resolveSessionFile(cwd: string, titleName: string | null): string | null {
  const candidates = new Set<string>([cwd])
  try {
    candidates.add(realpathSync(cwd))
  } catch {
    // cwd may have been removed
  }

  for (const candidate of candidates) {
    const files = sessionFiles(join(SESSIONS_ROOT, encodeCwd(candidate)))
    if (!files.length) continue
    if (titleName) {
      for (const entry of files.slice(0, 8)) {
        if (readSessionName(entry.file) === titleName) return entry.file
      }
    }
    return files[0].file
  }

  // The worktree may have been renamed, or pi may run with a different resolved cwd.
  // Fall back to a bounded scan of directories that mention the title or cwd basename.
  if (!existsSync(SESSIONS_ROOT)) return null
  const needle = (titleName || basename(cwd)).toLowerCase()
  if (!needle) return null
  let best: { file: string; mtimeMs: number } | null = null
  try {
    for (const dirName of readdirSync(SESSIONS_ROOT)) {
      if (!dirName.toLowerCase().includes(needle.replace(/[/\\:]/g, "-"))) continue
      for (const entry of sessionFiles(join(SESSIONS_ROOT, dirName)).slice(0, 6)) {
        if (titleName && readSessionName(entry.file) !== titleName) continue
        if (!best || entry.mtimeMs > best.mtimeMs) best = entry
      }
    }
  } catch {
    return null
  }
  return best?.file ?? null
}

export function titleName(title: string): string | null {
  const cleaned = title.replace(/^[^A-Za-z0-9.@_]+/, "").trim()
  if (!cleaned) return null
  const parts = cleaned.split(/\s+-\s+/)
  return parts.length >= 2 ? parts[1].trim() || null : cleaned
}

interface ResolvedAgent {
  agent: ViewerAgent
  parsed: ReturnType<typeof parseSessionFile> | null
  sessionName: string | null
}

function uniqueName(name: string, pane: TmuxPane, usedNames: Set<string>): string {
  if (usedNames.has(name)) {
    const suffix = pane.windowName && pane.windowName !== name ? pane.windowName : pane.paneId
    name = `${name} · ${suffix}`
  }
  usedNames.add(name)
  return name
}

function claudeQuery(pane: TmuxPane, proc: Proc): ClaudePaneQuery {
  const cwd = readProcCwd(proc.pid) ?? pane.cwd
  return {
    pid: proc.pid,
    paneId: pane.paneId,
    cwds: [cwd, pane.cwd].filter(Boolean),
    configDir: configDirOf(proc.pid),
    start: readProcStart(proc.pid),
  }
}

function resolveClaudePane(
  pane: TmuxPane,
  proc: Proc,
  usedNames: Set<string>,
  found: ClaudeTranscript,
): ResolvedAgent {
  const cwd = readProcCwd(proc.pid) ?? pane.cwd
  const configDir = configDirOf(proc.pid)
  let parsed: ReturnType<typeof parseSessionFile> | null = null
  if (found.file) {
    try {
      parsed = parseClaudeFile(found.file)
    } catch {
      parsed = null
    }
  }
  const sessionId = found.sessionId ?? (found.file ? transcriptSessionId(found.file) : null)
  const state: AgentState = parsed ? claudeStatusOf(parsed) : { status: "unknown", note: "no transcript" }
  const registry = readClaudeRegistry(configDir, proc.pid)
  const name = uniqueName(
    claudeAgentName(parsed?.sessionName ?? null, registry?.cwd ?? cwd, sessionId, pane.windowName || pane.paneId),
    pane,
    usedNames,
  )
  const agent: ViewerAgent = {
    id: pane.paneId,
    paneId: pane.paneId,
    panePid: pane.panePid,
    provider: "claude",
    piPid: proc.pid,
    tmuxSession: pane.session,
    windowIndex: pane.windowIndex,
    windowId: pane.windowId,
    windowName: pane.windowName,
    paneIndex: pane.paneIndex,
    name,
    role: pane.role,
    title: pane.title,
    cwd,
    repo: repoNameOf(cwd),
    sessionFile: found.file,
    sessionId,
    sessionName: parsed?.sessionName ?? null,
    model: parsed?.model ?? null,
    thinkingLevel: null,
    modifiedAt: parsed?.modifiedAt ?? 0,
    lastWriteAt: parsed ? lastWriteAt(parsed) : 0,
    eventCount: parsed?.events.length ?? 0,
    status: state.status,
    statusNote: state.note,
    statusDetail: state.detail ?? null,
  }
  return { agent, parsed, sessionName: parsed?.sessionName ?? null }
}

type PaneAgent = { kind: "claude"; proc: Proc } | { kind: "pi"; candidates: Proc[] }

/** The shallowest agent process owns the pane; a claude spawned under a pi pane stays hidden. */
function paneAgent(pane: TmuxPane, table: Map<number, Proc>): PaneAgent | null {
  const root = table.get(pane.panePid)
  const all = descendants(pane.panePid, table)
  if (root) all.push({ ...root, depth: 0 })
  const candidates: Proc[] = all.filter(isPiProcess)
  const claude = all.filter(isClaudeProcess).sort((a, b) => a.depth - b.depth)[0]
  const pi = candidates.length ? Math.min(...candidates.map((proc) => proc.depth)) : Infinity
  if (claude && claude.depth < pi) return { kind: "claude", proc: claude }
  return candidates.length ? { kind: "pi", candidates } : null
}

function resolvePaneAgent(
  pane: TmuxPane,
  table: Map<number, Proc>,
  usedNames: Set<string>,
  transcripts: Map<number, ClaudeTranscript>,
): ResolvedAgent | null {
  const owner = paneAgent(pane, table)
  if (!owner) return null
  if (owner.kind === "claude") {
    const found = transcripts.get(owner.proc.pid) ?? { file: null, rule: null, sessionId: null }
    return resolveClaudePane(pane, owner.proc, usedNames, found)
  }
  const candidates = owner.candidates
  candidates.sort((a, b) => a.depth - b.depth)

  const wanted = titleName(pane.title)
  let chosen: { proc: Proc; cwd: string; file: string | null } | null = null
  for (const proc of candidates) {
    const cwd = readProcCwd(proc.pid) ?? pane.cwd
    if (!cwd) continue
    const file = resolveSessionFile(cwd, wanted)
    if (!chosen || (file && !chosen.file)) chosen = { proc, cwd, file }
    if (file) break
  }
  if (!chosen) return null

  const parsed = chosen.file ? parseSessionFile(chosen.file) : null
  const state: AgentState = parsed ? statusOf(parsed) : { status: "unknown", note: "no session file" }
  const name = uniqueName(
    parsed?.sessionName || wanted || basename(chosen.cwd) || pane.windowName || pane.paneId,
    pane,
    usedNames,
  )

  const agent: ViewerAgent = {
    id: pane.paneId,
    paneId: pane.paneId,
    panePid: pane.panePid,
    provider: "pi",
    piPid: chosen.proc.pid,
    tmuxSession: pane.session,
    windowIndex: pane.windowIndex,
    windowId: pane.windowId,
    windowName: pane.windowName,
    paneIndex: pane.paneIndex,
    name,
    role: pane.role,
    title: pane.title,
    cwd: chosen.cwd,
    repo: repoNameOf(chosen.cwd),
    sessionFile: chosen.file,
    sessionId: chosen.file ? sessionIdFromFile(chosen.file) : null,
    sessionName: parsed?.sessionName ?? wanted,
    model: parsed?.model ?? null,
    thinkingLevel: parsed?.thinkingLevel ?? null,
    modifiedAt: parsed?.modifiedAt ?? 0,
    lastWriteAt: parsed ? lastWriteAt(parsed) : 0,
    eventCount: parsed?.events.length ?? 0,
    status: state.status,
    statusNote: state.note,
    statusDetail: state.detail ?? null,
  }
  return { agent, parsed, sessionName: parsed?.sessionName ?? wanted }
}

export interface Discovery {
  sessions: ViewerSession[]
  error?: string
}

function serverIdentity(panes: TmuxPane[]): string {
  const pane = panes[0]
  if (!pane) return "tmux"
  return `${pane.serverPid || "0"}:${pane.socketPath || "default"}`
}

export function discover(): Discovery {
  const { panes, error } = listTmuxPanes()
  if (error) return { sessions: [], error }
  const table = processTable()
  const bySession = new Map<string, TmuxPane[]>()
  for (const pane of panes) {
    const list = bySession.get(pane.session) ?? []
    list.push(pane)
    bySession.set(pane.session, list)
  }

  const serverId = serverIdentity(panes)
  const sessions: ViewerSession[] = []
  // Claude transcripts are paired for all panes together: one claim set across tmux
  // sessions, in a deterministic pane order (see resolveClaudeTranscripts).
  const claudeQueries: ClaudePaneQuery[] = []
  for (const pane of panes) {
    const owner = paneAgent(pane, table)
    if (owner?.kind === "claude") claudeQueries.push(claudeQuery(pane, owner.proc))
  }
  const transcripts = resolveClaudeTranscripts(claudeQueries)
  for (const [name, sessionPanes] of bySession) {
    const usedNames = new Set<string>()
    const agents: ViewerAgent[] = []
    for (const pane of sessionPanes) {
      const resolved = resolvePaneAgent(pane, table, usedNames, transcripts)
      if (resolved) agents.push(withPaneAttention(resolved.agent))
    }
    if (!agents.length) continue
    agents.sort((a, b) => a.windowIndex - b.windowIndex || a.paneIndex - b.paneIndex)
    sessions.push({ name, serverId, agents, capturedAt: Date.now() })
  }
  sessions.sort((a, b) => a.name.localeCompare(b.name))
  prunePaneReads(new Set(sessions.flatMap((session) => session.agents.map((agent) => agent.paneId))))
  return { sessions }
}

export function findAgent(session: string, paneId: string): ViewerAgent | null {
  const found = discover().sessions.find((entry) => entry.name === session)
  return found?.agents.find((agent) => agent.paneId === paneId) ?? null
}

export function defaultSession(sessions: ViewerSession[]): string | null {
  if (!sessions.length) return null
  return (sessions.find((session) => session.name === "xx") ?? sessions[0]).name
}

