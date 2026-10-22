import type { McpToolResult, On, RenderInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { MCP_SERVER, POLL_MS, renewDue, statusOf, ttlColor } from '../hooks/register'

const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

const BAND: RenderInput<'AbovePrompt'> = {
  component: 'AbovePrompt',
  surface: 'terminal',
  requestId: 'band',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19 }, view: {} },
}

const json = (value: unknown): McpToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false })

let toasts: string[] = []

function server(on: On, answer: () => unknown) {
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = []
  on('mcp.call', ($, e) => {
    calls.push(e)
    return { value: json(answer()) }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: ['engine band'] }) as never)
  return calls
}

function textOf(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  if (!tree || typeof tree !== 'object') return ''
  return textOf(Reflect.get(tree, 'children'))
}

describe('statusOf', () => {
  test('reads plain and feedback-wrapped issue_list payloads', () => {
    const row = { ref: 'XTRM-1', title: 't', claim: { holder: 'op', expiresAt: 10, acquiredAt: 1 }, latestHandoff: { sequence: 4 } }
    expect(statusOf({ holder: 'op', issues: [row] })).toEqual({
      holder: 'op',
      claims: [{ ref: 'XTRM-1', title: 't', expiresAt: 10, acquiredAt: 1, handoffSeq: 4 }],
    })
    expect(statusOf({ data: { holder: null, rows: [{ ...row, latestHandoff: null }] } }).claims[0]?.handoffSeq).toBe(null)
  })
})

describe('ttl', () => {
  test('yellow inside the renew window, red when expired, toast once per claim generation', () => {
    const now = 1_000_000_000
    const c = { ref: 'XTRM-1', title: 't', acquiredAt: now - 50 * 60_000, expiresAt: now + 8 * 60_000, handoffSeq: null }
    expect(ttlColor(c, now)).toBe('yellow')
    expect(ttlColor({ ...c, expiresAt: now - 1 }, now)).toBe('red')
    expect(ttlColor({ ...c, expiresAt: now + 40 * 60_000 }, now)).toBe(undefined)
    const warned = new Set<string>()
    expect(renewDue({ holder: 'op', claims: [c] }, warned, now).length).toBe(1)
    warned.add(`${c.ref}@${c.expiresAt}`)
    expect(renewDue({ holder: 'op', claims: [c] }, warned, now).length).toBe(0)
  })
})

describe('register', () => {
  test('reads issue_list claimedBy=me and draws the band; empty status leaves the band to the engine', async ($, on) => {
    toasts = []
    const clock = mock.clock(on)
    let payload: unknown = { holder: 'op', issues: [] }
    const calls = server(on, () => payload)
    await $.session.start(SESSION)
    await clock.settle()
    expect(calls[0]).toEqual({ server: MCP_SERVER, tool: 'issue_list', args: { claimedBy: 'me' } })
    expect(textOf(await $.ui.render(BAND))).toBe('engine band')
    payload = {
      holder: 'op',
      issues: [{ ref: 'XTRM-7', title: 'advisor work', claim: { holder: 'op', expiresAt: Date.now() + 2 * 60_000, acquiredAt: Date.now() - 60 * 60_000 }, latestHandoff: { sequence: 9 } }],
    }
    await clock.advance(POLL_MS)
    await clock.settle()
    const band = textOf(await $.ui.render(BAND))
    expect(band).toContain('substrate')
    expect(band).toContain('XTRM-7')
    expect(band).toContain('handoff seq9')
    expect(toasts.length).toBe(1)
  })

  test('flags a session with no identity', async ($, on) => {
    const clock = mock.clock(on)
    server(on, () => ({ holder: null, issues: [] }))
    await $.session.start(SESSION)
    await clock.settle()
    expect(textOf(await $.ui.render(BAND))).toContain('no SUBSTRATE_HOLDER')
  })
})
