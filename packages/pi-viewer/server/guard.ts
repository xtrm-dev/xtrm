// Who may write (XTRM-1109, PR #512 review, High finding).
//
// /api/send types into a pane and /api/stop interrupts one, so both are a security boundary, not an
// ordinary read. A page on any origin can issue a `mode: "no-cors"` `text/plain` POST at
// http://127.0.0.1:<port>/api/send — the loopback bind, Vite's host check and CORS all leave that
// request intact, because none of them refuses a *simple* cross-origin write. The browser does attach
// two headers a page cannot forge to such a request: `Origin` and `Sec-Fetch-Site`. This module reads
// them, plus the body's content type, and answers only for a request that came from the viewer itself.
import type { IncomingHttpHeaders } from "node:http"

/** The hostnames a viewer page may legitimately be served from: this machine, on any port. */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1", "0.0.0.0"])

export type WriteVerdict = { ok: true } | { ok: false; reason: string }

function header(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name]
  if (Array.isArray(value)) return value.length ? value[0] : null
  return typeof value === "string" ? value : null
}

/**
 * A write request must be a JSON fetch from this machine's own viewer.
 *
 * - `Content-Type: application/json` cannot be sent by a form, an image, a link or a no-cors fetch, so
 *   a cross-site page cannot produce it without a CORS preflight the server never grants.
 * - `Sec-Fetch-Site`, when the browser sends it, must be `same-origin` or `none`. `cross-site`,
 *   `same-site` and `none` from a nested context are refused.
 * - `Origin`, when present, must name a loopback host: a page served by another machine cannot reach
 *   this listener, and a page served from here is the viewer or something the operator already runs.
 *
 * A request without an Origin and without Sec-Fetch-Site (curl, a test, a same-origin fetch from a
 * policy-stripped context) is allowed only when it also carries the JSON content type.
 */
export function writeVerdict(headers: IncomingHttpHeaders): WriteVerdict {
  const contentType = (header(headers, "content-type") ?? "").toLowerCase()
  if (!contentType.startsWith("application/json")) {
    return { ok: false, reason: "write requests must be application/json" }
  }

  const site = header(headers, "sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") {
    return { ok: false, reason: `cross-site write refused (sec-fetch-site: ${site})` }
  }

  const origin = header(headers, "origin")
  if (origin) {
    let hostname: string
    try {
      hostname = new URL(origin).hostname.toLowerCase()
    } catch {
      return { ok: false, reason: "cross-site write refused (unparsable origin)" }
    }
    if (!LOOPBACK.has(hostname)) return { ok: false, reason: `cross-site write refused (origin: ${origin})` }
  }

  return { ok: true }
}

/** Control characters a terminal would act on; tab survives because a paste may legitimately carry it. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** Strip the control characters that would turn a message into keystrokes the operator did not write. */
export function stripControls(text: string): string {
  return text.replace(CONTROL, "")
}
