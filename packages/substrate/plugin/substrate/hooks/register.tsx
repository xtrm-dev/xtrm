/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { EngineInterface, McpToolResult, On } from 'claude-code'

// Live Substrate status above the prompt (XTRM-675): who this session is, the
// claims it holds, their TTL and latest handoff — the Claude twin of the Pi
// `substrate` widget (integrations/pi/advisor.ts statusLines). Presentation
// only: every read goes through the plugin's own MCP server, and the module
// keeps nothing but the last read (reload reconstructs from Substrate).

export const MCP_SERVER = 'plugin:substrate:substrate'
export const COMMAND = 'substrate'
export const POLL_MS = 60_000
export const BAND_ROWS = 3
/** Toast once when a claim enters the last fifth of its TTL, like the claim_renew advisory. */
export const RENEW_FRACTION = 0.2
export const RENEW_FLOOR_MS = 5 * 60_000

export type Claim = { ref: string; title: string; expiresAt: number; acquiredAt: number | null; handoffSeq: number | null }
export type Status = { holder: string | null; claims: Claim[] }

type State = {
  status: Status | null
  error: string | null
  visible: boolean
  polling: boolean
  timer: { cancel(): void } | null
  warned: Set<string>
}

function textOf(result: McpToolResult): string {
  return (result.content ?? [])
    .map((c: { type?: string; text?: string }) => (c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('')
}

/** Accepts the issue_list claimedBy payload in its plain or feedback-wrapped form. */
export function statusOf(value: Record<string, unknown>): Status {
  const data = (value.data && typeof value.data === 'object' ? value.data : value) as Record<string, unknown>
  const rows = (['issues', 'rows', 'items'].map(k => data[k]).find(Array.isArray) ?? []) as Array<Record<string, unknown>>
  const claims: Claim[] = []
  for (const r of rows) {
    const claim = (r.claim ?? {}) as Record<string, unknown>
    const handoff = (r.latestHandoff ?? null) as Record<string, unknown> | null
    const ref = String(r.ref ?? r.humanRef ?? '')
    if (!ref || typeof claim.expiresAt !== 'number') continue
    claims.push({
      ref,
      title: String(r.title ?? ''),
      expiresAt: claim.expiresAt,
      acquiredAt: typeof claim.acquiredAt === 'number' ? claim.acquiredAt : null,
      handoffSeq: handoff && typeof handoff.sequence === 'number' ? handoff.sequence : null,
    })
  }
  const holder = typeof data.holder === 'string' && data.holder ? data.holder : null
  return { holder, claims }
}

export function ttlText(c: Claim, now: number): string {
  const left = Math.round((c.expiresAt - now) / 60000)
  return left < 0 ? `EXPIRED ${-left}m ago` : `expires in ${left}m`
}

export function ttlColor(c: Claim, now: number): string | undefined {
  const left = c.expiresAt - now
  if (left < 0) return 'red'
  const ttl = c.acquiredAt !== null ? c.expiresAt - c.acquiredAt : 0
  return left < Math.max(RENEW_FLOOR_MS, ttl * RENEW_FRACTION) ? 'yellow' : undefined
}

/** Claims that just entered the renew window (or expired) and were not toasted yet. */
export function renewDue(status: Status, warned: Set<string>, now: number): Claim[] {
  return status.claims.filter(c => ttlColor(c, now) !== undefined && !warned.has(`${c.ref}@${c.expiresAt}`))
}

async function refresh($: EngineInterface, s: State): Promise<void> {
  if (s.polling) return
  s.polling = true
  try {
    let result: McpToolResult
    try {
      result = await $.mcp.call(MCP_SERVER, 'issue_list', { claimedBy: 'me' })
    } catch (cause) {
      s.error = cause instanceof Error ? cause.message : String(cause)
      return
    }
    if (result.isError) {
      s.error = textOf(result).slice(0, 120) || 'issue_list failed'
      return
    }
    try {
      s.status = statusOf(JSON.parse(textOf(result)) as Record<string, unknown>)
      s.error = null
    } catch {
      s.error = 'issue_list returned non-JSON'
      return
    }
    const now = Date.now()
    for (const c of renewDue(s.status, s.warned, now)) {
      s.warned.add(`${c.ref}@${c.expiresAt}`)
      $.ui.toast(`Substrate · ${c.ref} claim ${ttlText(c, now)} — sb issue renew ${c.ref} --ttl-ms <ms>`, { timeoutMs: 15_000 })
    }
  } finally {
    s.polling = false
    $.ui.invalidate('ui.render')
  }
}

export function register(on: On) {
  const s: State = { status: null, error: null, visible: true, polling: false, timer: null, warned: new Set() }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Substrate status: claims held by this session, TTL, latest handoff',
        argumentHint: '[status|show|hide]',
        immediate: true,
      })
    } catch {
      // another surface may already serve the command
    }
    s.timer?.cancel()
    s.timer = $.clock.every(POLL_MS, () => void refresh($, s))
    void refresh($, s)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const verb = e.args.trim()
    if (verb === 'hide' || verb === 'show') {
      s.visible = verb === 'show'
      $.ui.invalidate('ui.render')
      return { text: `Substrate band ${verb === 'show' ? 'shown' : 'hidden'}` }
    }
    await refresh($, s)
    if (s.error) return { text: `Substrate status unavailable: ${s.error}` }
    const now = Date.now()
    const st = s.status ?? { holder: null, claims: [] }
    const lines = [`holder: ${st.holder ?? '(none — set SUBSTRATE_HOLDER)'}`]
    for (const c of st.claims) lines.push(`${c.ref} ${c.title} · ${ttlText(c, now)} · ${c.handoffSeq !== null ? `handoff seq${c.handoffSeq}` : 'no handoff'}`)
    if (st.claims.length === 0) lines.push('no live claims')
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !s.visible || e.props.hasSurvey) return next(e)
    const st = s.status
    const noIdentity = st !== null && st.holder === null
    if (!s.error && !noIdentity && (!st || st.claims.length === 0)) return next(e)
    const { Box, Text } = await $.ui.resolve(e)
    const now = Date.now()
    const claims = st?.claims ?? []
    return (
      <Box flexDirection="column">
        <Box>
          <Text>  </Text>
          <Text bold>substrate</Text>
          {noIdentity ? <Text color="red"> no SUBSTRATE_HOLDER: writes are anonymous</Text> : <Text> {st?.holder ?? ''}</Text>}
        </Box>
        {s.error ? <Text color="yellow" wrap="truncate-end">    status unavailable · {s.error}</Text> : null}
        {claims.slice(0, BAND_ROWS).map(c => (
          <Box key={c.ref}>
            <Text>    {c.ref} </Text>
            <Text dimColor wrap="truncate-end">{c.title.slice(0, 48)} </Text>
            <Text color={ttlColor(c, now)}>· {ttlText(c, now)}</Text>
            <Text dimColor> · {c.handoffSeq !== null ? `handoff seq${c.handoffSeq}` : 'no handoff'}</Text>
          </Box>
        ))}
        {claims.length > BAND_ROWS ? <Text dimColor>    +{claims.length - BAND_ROWS} more · /substrate</Text> : null}
      </Box>
    )
  })
}
