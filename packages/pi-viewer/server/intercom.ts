import type { IntercomMeta } from "../src/shared/types.ts"
import { peerLabel, resolvePeer } from "./peers.ts"

type Raw = Record<string, unknown>

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function oneLine(value: string, limit = 140): string {
  const line = value.replace(/\s+/g, " ").trim()
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => {
      if (typeof part === "string") return part
      if (!isRecord(part)) return ""
      return part.type === "text" && typeof part.text === "string" ? part.text : ""
    })
    .filter(Boolean)
    .join("\n")
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of source.matchAll(/([A-Za-z][\w-]*)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

function detailsOf(entry: Raw): {
  messageId?: string
  fromName?: string
  fromId?: string
  expectsReply?: boolean
  fallbackBody?: string
} {
  const details = isRecord(entry.details) ? entry.details : null
  if (!details) return {}
  const from = isRecord(details.from) ? details.from : null
  const message = isRecord(details.message) ? details.message : null
  const content = message && isRecord(message.content) ? message.content : null
  return {
    messageId:
      asString(details.messageId) ??
      (message ? asString(message.id) : undefined) ??
      (message ? asString(message.messageId) : undefined),
    fromName: from ? asString(from.name) : asString(details.from),
    fromId: from ? asString(from.id) : undefined,
    expectsReply:
      details.expectsReply === true ||
      (message ? message.expectsReply === true : false),
    fallbackBody: content ? asString(content.text) : undefined,
  }
}

function receivedMeta(input: {
  fromName?: string
  fromId?: string
  to: string
  body: string
  messageId?: string
  expectsReply?: boolean
  delivery?: string
  legacy?: boolean
}): IntercomMeta {
  const from = input.fromName?.trim() || peerLabel(input.fromId) || input.fromId || "peer"
  const peer = resolvePeer(input.fromId)
  return {
    direction: "received",
    from,
    to: input.to,
    fromId: input.fromId,
    messageId: input.messageId,
    expectsReply: input.expectsReply || undefined,
    summary: oneLine(input.body),
    body: input.body,
    runtime: peer?.runtime,
    delivery: input.delivery ?? "received",
    legacy: input.legacy || undefined,
  }
}

function parseEnvelope(text: string, entry: Raw, agent: { name: string }): IntercomMeta | null {
  const match =
    /^\s*(?:Another Claude session sent a message:\s*)?<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/.exec(
      text,
    )
  if (!match) return null
  const attrs = parseAttrs(match[1])
  const details = detailsOf(entry)
  const body = decodeEntities(match[2].trim())
  const fromId = attrs.from
  return receivedMeta({
    fromName: attrs["from-name"] ?? details.fromName,
    fromId: fromId ?? details.fromId,
    to: agent.name,
    body: body || details.fallbackBody || "",
    messageId: attrs["message-id"] ?? details.messageId,
    expectsReply:
      attrs["expects-reply"] === "true" ||
      attrs["expects_reply"] === "true" ||
      details.expectsReply,
  })
}

function parseLegacyHeader(text: string, entry: Raw, agent: { name: string }): IntercomMeta | null {
  const lines = text.trimStart().split("\n")
  const header = lines[0]?.trim() ?? ""
  const headerMatch = /^\*\*From ([^*]+)\*\*(?: \(([^)]*)\))?/.exec(header)
  if (!headerMatch) return null

  const metaIndex = lines.findIndex((line) => /^_id\s+/.test(line.trim()))
  if (metaIndex === -1) return null
  const metaLine = lines[metaIndex]
  const body = lines
    .slice(metaIndex + 1)
    .join("\n")
    .trim()
  const details = detailsOf(entry)
  const delivered = /broker delivered ([^·\n]+)/.exec(metaLine)?.[1]?.trim()
  const received = /receiver received ([^·\n]+)/.exec(metaLine)?.[1]?.trim()
  const injected = /injected ([^·\n]+)/.exec(metaLine)?.[1]?.trim()
  const delivery = injected ? `injected ${injected}` : received ? `received ${received}` : delivered ? `delivered ${delivered}` : "received"

  return receivedMeta({
    fromName: details.fromName ?? headerMatch[1].trim(),
    fromId: details.fromId,
    to: agent.name,
    body: body || details.fallbackBody || "",
    messageId: details.messageId ?? /_id\s+([0-9a-f-]{8,})/i.exec(metaLine)?.[1],
    expectsReply: details.expectsReply,
    delivery,
    legacy: true,
  })
}

function sentMeta(input: {
  toRaw?: string
  body: string
  messageId?: string
  expectsReply?: boolean
  summary?: string
  agentName: string
}): IntercomMeta {
  const peer = resolvePeer(input.toRaw)
  const to = peerLabel(input.toRaw) ?? input.toRaw ?? "peer"
  return {
    direction: "sent",
    from: input.agentName,
    to,
    fromId: undefined,
    toId: input.toRaw,
    messageId: input.messageId,
    expectsReply: input.expectsReply || undefined,
    summary: input.summary?.trim() || oneLine(input.body),
    body: input.body,
    runtime: peer?.runtime,
    delivery: "sent",
  }
}

function intercomCall(
  name: string,
  args: Raw,
  agent: { name: string },
): IntercomMeta | null {
  if (name === "SendMessage") {
    const body = asString(args.message)
    if (!body) return null
    return sentMeta({
      toRaw: asString(args.to),
      body,
      messageId: asString(args.messageId),
      expectsReply: args.expect_reply === true || args.expects_reply === true,
      summary: asString(args.summary),
      agentName: agent.name,
    })
  }
  if (name !== "intercom") return null
  const action = asString(args.action)
  if (action !== "send" && action !== "reply") return null
  const body = asString(args.message)
  if (!body) return null
  return sentMeta({
    toRaw:
      asString(args.to) ??
      asString(args.recipient) ??
      asString(args.target) ??
      asString(args.name),
    body,
    messageId: asString(args.messageId),
    expectsReply: args.expectsReply === true || args.expects_reply === true,
    summary: asString(args.summary),
    agentName: agent.name,
  })
}

function fromAssistantContent(content: unknown, agent: { name: string }): IntercomMeta | null {
  if (!Array.isArray(content)) return null
  for (const part of content) {
    if (!isRecord(part) || part.type !== "toolCall") continue
    const name = asString(part.name)
    if (!name) continue
    let args: Raw | null = isRecord(part.arguments) ? part.arguments : null
    if (!args) {
      const raw = asString(part.arguments)
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw)
          args = isRecord(parsed) ? parsed : null
        } catch {
          args = null
        }
      }
    }
    if (!args) continue
    const meta = intercomCall(name, args, agent)
    if (meta) return meta
  }
  return null
}

function fromCustom(entry: Raw, agent: { name: string }): IntercomMeta | null {
  const customType = asString(entry.customType)
  if (customType !== "intercom_sent" && customType !== "intercom_received") return null
  const data = isRecord(entry.data) ? entry.data : null
  const message = data && isRecord(data.message) ? data.message : null
  const body = message ? asString(message.text) : undefined
  if (!body) return null

  if (customType === "intercom_sent") {
    return sentMeta({
      toRaw: data ? asString(data.to) : undefined,
      body,
      messageId: message ? asString(message.id) : undefined,
      expectsReply: message ? message.expectsReply === true : false,
      summary: message ? asString(message.summary) : undefined,
      agentName: agent.name,
    })
  }

  return receivedMeta({
    fromName: data && typeof data.from === "string" && !/^[0-9a-f]{8,}$/i.test(data.from) ? data.from : undefined,
    fromId: data ? asString(data.from) : undefined,
    to: agent.name,
    body,
    messageId: message ? asString(message.id) : undefined,
    expectsReply: message ? message.expectsReply === true : false,
    delivery: "received",
    legacy: true,
  })
}

/**
 * Recognize every peer-message shape Pi has written:
 * - current `<cross-session-message>` envelope (Pi and Claude)
 * - legacy `**From …**` header with the `_id …` metadata line
 * - legacy custom `intercom_sent` / `intercom_received`
 * - outgoing SendMessage / intercom tool calls
 */
export function intercomFromEntry(entry: Raw, agent: { name: string }): IntercomMeta | null {
  const type = asString(entry.type)
  if (type === "custom_message") {
    return (
      parseEnvelope(contentText(entry.content), entry, agent) ??
      parseLegacyHeader(contentText(entry.content), entry, agent)
    )
  }
  if (type === "custom") return fromCustom(entry, agent)
  if (type !== "message" || !isRecord(entry.message)) return null
  const message = entry.message
  const role = asString(message.role)
  if (role === "user") {
    const text = contentText(message.content)
    return parseEnvelope(text, entry, agent) ?? parseLegacyHeader(text, entry, agent)
  }
  if (role === "assistant") return fromAssistantContent(message.content, agent)
  return null
}

export function isIntercomTool(name: string | undefined): boolean {
  return name === "SendMessage" || name === "intercom"
}
