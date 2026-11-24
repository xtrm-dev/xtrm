const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" })

export function clock(at: number): string {
  if (!at) return "—"
  return timeFormat.format(new Date(at))
}

export function dayLabel(at: number): string {
  const date = new Date(at)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(date, today)) return "Today"
  if (sameDay(date, yesterday)) return "Yesterday"
  return dayFormat.format(date)
}

export function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s"
  const seconds = Math.round(ms / 1000)
  if (seconds < 1) return "<1s"
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
}

export function clockWithSeconds(at: number): string {
  if (!at) return "—"
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

export function monogram(name: string): string {
  const parts = name.split(/[-_.\s]+/).filter(Boolean)
  const last = parts.length > 1 ? parts[parts.length - 1] : name
  return last.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toLowerCase() || "pi"
}
