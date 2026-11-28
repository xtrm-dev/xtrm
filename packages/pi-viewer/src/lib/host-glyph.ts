/**
 * The sidebar's host glyph: whether an agent runs on the machine that serves this viewer or on
 * another host, in a form the tree can draw and speak.
 *
 * XTRM-1139 stage 1 gives every agent a host id (`ViewerAgent.host`). Until discovery reports it, an
 * absent host means this machine, so every row draws the monitor today and the server glyph lights
 * up the moment the field arrives. The viewer's own host id is optional for the same reason: once a
 * payload names the local host, the caller passes it and a matching value still reads local.
 */

/** The lucide glyphs this rule chooses between; both names are in the shell registry. */
export type HostGlyphName = "monitor" | "server"

/** The words a row's accessible name and tooltip use for the machine that serves the viewer. */
export const LOCAL_HOST_LABEL = "this machine"

/** A host value that names no host (`undefined`, `null` or empty) is this machine. */
export function isLocalHost(host: string | null | undefined, localHost?: string | null): boolean {
  if (!host) return true
  return Boolean(localHost) && host === localHost
}

export function hostGlyph(host: string | null | undefined, localHost?: string | null): HostGlyphName {
  return isLocalHost(host, localHost) ? "monitor" : "server"
}

/** The host in words, for a row that shows one agent's host. */
export function hostLabel(host: string | null | undefined, localHost?: string | null): string {
  return isLocalHost(host, localHost) ? LOCAL_HOST_LABEL : `host ${host}`
}

export interface HostRef {
  host?: string | null
}

export interface WindowHost {
  /**
   * The single glyph a window row draws. Null when the window mixes hosts: the row cannot speak for
   * the whole window, so each pane row carries its own glyph instead.
   */
  glyph: HostGlyphName | null
  /** The host in words, for the row's accessible name and tooltip. */
  label: string
  mixed: boolean
}

/**
 * The host of a whole window. A tmux window lives on one tmux server, so a real window is uniform;
 * the mixed branch is kept because the tree may one day group panes whose reported host differs, and
 * this is the rule that decides whether the glyph belongs on the window row or on the pane rows.
 *
 * No agents at all means no window row to draw (the tree omits empty windows): the result then claims
 * no host, draws nothing and says "mixed hosts" so a caller can never mistake it for local.
 */
export function windowHost(agents: readonly HostRef[], localHost?: string | null): WindowHost {
  const identities = new Set(agents.map((agent) => (isLocalHost(agent.host, localHost) ? "" : agent.host)))
  if (identities.size === 0) return { glyph: null, label: "mixed hosts", mixed: true }
  if (identities.size > 1) return { glyph: null, label: "mixed hosts", mixed: true }
  const [identity] = identities
  if (identity === "") return { glyph: "monitor", label: LOCAL_HOST_LABEL, mixed: false }
  return { glyph: "server", label: `host ${identity}`, mixed: false }
}
