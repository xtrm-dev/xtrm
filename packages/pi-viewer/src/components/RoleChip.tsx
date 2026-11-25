import { cn } from "@/lib/utils"

const SOLID: Record<string, string> = {
  manager: "bg-role-manager text-white",
  lead: "bg-role-lead text-white",
  worker: "bg-role-worker text-white",
}

function toneOf(role: string): "manager" | "lead" | "worker" | "specialist" {
  const key = role.trim().toLowerCase()
  if (key === "manager" || key === "coordinator") return "manager"
  if (key === "lead") return "lead"
  if (key === "worker") return "worker"
  return "specialist"
}

function labelOf(role: string): string {
  const clean = role.trim()
  const key = clean.toLowerCase()
  if (key === "lead") return "Lead"
  if (key === "worker") return "Worker"
  if (key === "manager") return "Manager"
  if (key === "coordinator") return "Coordinator"
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

export function RoleChip({ role, className }: { role: string | null | undefined; className?: string }) {
  if (!role?.trim()) return null
  const tone = toneOf(role)
  return (
    <span
      title={`Role: ${role}`}
      aria-label={`Role: ${role}`}
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded-[4px] px-1.5 font-mono text-2xs font-semibold tracking-normal normal-case",
        tone === "specialist" ? "bg-control text-ink-muted" : SOLID[tone],
        className,
      )}
    >
      {labelOf(role)}
    </span>
  )
}
