export function EarlierTurns({
  count,
  loading,
  onLoad,
}: {
  count: number
  loading: boolean
  onLoad: () => void
}) {
  const label = loading
    ? "Loading earlier turns…"
    : count > 0
      ? `Show ${count.toLocaleString()} earlier ${count === 1 ? "turn" : "turns"}`
      : "Show earlier turns"
  return (
    <div className="flex justify-center pt-1 pb-2">
      <button
        type="button"
        onClick={onLoad}
        disabled={loading}
        className="rounded-md px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:cursor-wait disabled:opacity-60"
      >
        {label}
      </button>
    </div>
  )
}
