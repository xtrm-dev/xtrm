import { NewSessionButton } from "./NewSession.tsx";
import { useRouterState } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import type { AgentSessionSummary } from "../adapters/index.tsx";
import { useGo } from "../shell/ContextSidebar.tsx";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { SIDEBAR_LABEL_COLUMN } from "../ui/drawer.tsx";
import { Row, StatusDot, cx, relativeTime } from "../ui/primitives.tsx";
import { HostConnectionPanel, HostConnectionToggle } from "./HostConnection.tsx";
import { ContextMeter, STATE_LABEL, STATE_TONE, contextLabel, modelLabel, modelProvider } from "./meta.tsx";
import { useAgentSession, useAgentSessions, useShownState } from "./queries.ts";

export type SessionScope = "repository" | "all";

const PROVIDER_LABEL: Record<AgentSessionSummary["provider"], string> = { pi: "Pi", claude: "Claude Code", codex: "Codex" };

type Item = { type: "header"; key: string; label: string; count: number } | { type: "session"; key: string; session: AgentSessionSummary; depth: number; group: string };

const HEADER_H = 30;
const ROW_H = 46;
const SCOPE_KEY = "xtrm.agent.scope.v1";
/** Repository-scope group holding the open session when it belongs to another repository. */
export const outsideGroup = (repo: string) => `Open · not in ${repo.split("/").pop()}`;

export const sessionIdFromPath = (pathname: string) => /^\/agent\/([^/?#]+)/.exec(pathname)?.[1] ?? null;

function readScope(): SessionScope {
  try {
    return sessionStorage.getItem(SCOPE_KEY) === "all" ? "all" : "repository";
  } catch {
    return "repository";
  }
}

/** Roots by last activity, each followed by its children (PRD §36.3 grouping by parent). */
function threaded(sessions: AgentSessionSummary[]): Array<{ session: AgentSessionSummary; depth: number }> {
  const byParent = new Map<string | null, AgentSessionSummary[]>();
  const ids = new Set(sessions.map((s) => s.id));
  for (const s of sessions) {
    const p = s.parentId && ids.has(s.parentId) ? s.parentId : null;
    byParent.set(p, [...(byParent.get(p) ?? []), s]);
  }
  const out: Array<{ session: AgentSessionSummary; depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const s of (byParent.get(parent) ?? []).sort((a, b) => b.lastActivityAt - a.lastActivityAt)) {
      out.push({ session: s, depth });
      walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * List items by scope and text filter. In repository scope the open session stays visible when it
 * belongs to another repository (or none): it gets its own group instead of disappearing.
 */
export function buildSessionItems(sessions: AgentSessionSummary[], scope: SessionScope, repo: string, filter: string, openId: string | null = null): Item[] {
  const q = filter.trim().toLowerCase();
  const match = (s: AgentSessionSummary) => !q || [s.name, s.title, s.role, s.workRef, s.model].some((v) => v?.toLowerCase().includes(q));
  const visible = sessions.filter(match);
  const groups: Array<[string, AgentSessionSummary[]]> =
    scope === "repository"
      ? [
          ["Live", visible.filter((s) => s.repo === repo && s.state !== "history")],
          ["History", visible.filter((s) => s.repo === repo && s.state === "history")],
          [outsideGroup(repo), visible.filter((s) => s.id === openId && s.repo !== repo)],
        ]
      : [
          ...[...new Set(visible.map((s) => s.repo).filter((r): r is string => !!r))]
            .sort((a, b) => (a === repo ? -1 : b === repo ? 1 : a.localeCompare(b)))
            .map((r): [string, AgentSessionSummary[]] => [r, visible.filter((s) => s.repo === r)]),
          ["Other", visible.filter((s) => !s.repo)],
        ];
  return groups
    .filter(([, list]) => list.length > 0)
    .flatMap(([label, list]): Item[] => [
      { type: "header", key: `h:${label}`, label, count: list.length },
      ...threaded(list).map(({ session, depth }): Item => ({ type: "session", key: session.id, session, depth, group: label })),
    ]);
}

function SessionRow({ s, depth, selected, onOpen }: { s: AgentSessionSummary; depth: number; selected: boolean; onOpen: () => void }) {
  const meta = [s.role, s.workRef, modelLabel(s)].filter(Boolean);
  const state = useShownState(s.state);
  return (
    <Row
      density="sidebar"
      selected={selected}
      onActivate={onOpen}
      aria-label={`${s.name} · ${STATE_LABEL[state]}`}
      data-testid="session-row"
      className={cx("h-full items-start gap-2 py-1.5", depth > 0 && "pl-6")}
    >
      {selected && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-accent" />}
      {depth > 0 && <span aria-hidden className="absolute top-0 bottom-0 left-3.5 w-px bg-border-muted" />}
      <span className="mt-0.5">
        <StatusDot tone={STATE_TONE[state]} label={STATE_LABEL[state]} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={cx("truncate text-sm", selected ? "text-ink" : s.state === "history" ? "text-ink-muted" : "text-ink")}>{s.name}</span>
          {s.provider === "claude" && <span className="shrink-0 text-[0.65rem] text-ink-faint">claude</span>}
          <span className="ml-auto shrink-0 text-[0.7rem] text-ink-faint tabular">{relativeTime(s.lastActivityAt)}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[0.7rem] text-ink-faint">
          <span className="truncate">{meta.join(" · ") || STATE_LABEL[state]}</span>
          {s.context && <ContextMeter context={s.context} className="ml-auto shrink-0" />}
        </span>
      </span>
    </Row>
  );
}

/** What the session accepts: `prompt · steer · abort`, `presence only`; null for history or none. */
export function acceptsLabel(s: Pick<AgentSessionSummary, "state" | "capabilities">): string | null {
  if (s.state === "history" || s.capabilities.length === 0) return null;
  return s.capabilities.includes("presence") ? "presence only" : s.capabilities.join(" · ");
}

/** One details row; `wrap` rows break instead of truncating (short values whose meaning a cut would lose). */
function Detail({ label, value, mono, wrap }: { label: string; value: string | number | null | undefined; mono?: boolean; wrap?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <>
      <dt className="text-ink-faint">{label}</dt>
      <dd className={cx("min-w-0 text-ink-muted", wrap ? "break-words" : "truncate", mono && "font-mono text-[0.68rem]")} title={String(value)}>
        {value}
      </dd>
    </>
  );
}

function SessionDetails({ id }: { id: string }) {
  const session = useAgentSession(id);
  const [open, setOpen] = useState(true);
  const s = session.data;
  const state = useShownState(s?.state ?? "settled");
  if (!s) return null;
  const tokens = s.tokens ? `${Math.round(s.tokens.input / 1000)}k in · ${Math.round(s.tokens.output / 1000)}k out` : null;
  return (
    <section className="thin-scrollbar min-h-0 shrink overflow-y-auto border-t border-border-muted px-1 pt-1" aria-label="Session details">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group/sec flex h-7 w-full items-center gap-1 rounded-md px-2 text-xs font-medium text-ink-faint outline-none hover:text-ink-muted focus-visible:bg-hover"
      >
        Details
        <Icon name="chevronDown" size="xs" className={cx("ml-auto transition", !open && "-rotate-90")} />
      </button>
      {open && (
        <dl
          className="grid gap-x-2 gap-y-1 px-2 pt-0.5 pb-2 text-xs"
          style={{ gridTemplateColumns: `${SIDEBAR_LABEL_COLUMN} minmax(0,1fr)` }}
          data-testid="session-details"
        >
          {/* The sidebar class, and the one label grid that does not use `Fields`: its rows mix
              wrapping and truncating values, and every value carries `title=`, which `Fields` has no
              knob for. It takes the sidebar step from the ladder and the tighter `gap-x-2` gutter
              (the label gutter is `gap-x-3` everywhere else); at 264px the 4px goes to the value.
              Failing case for a wider column: "Provider" (49px) is the widest label here, so 4.5rem
              fits it with 23px of slack, and a 7.5rem step would spend 48px of the sidebar's 264px
              on empty space in rows that truncate. */}
          <Detail label="Agent" value={PROVIDER_LABEL[s.provider]} />
          <Detail label="State" value={STATE_LABEL[state]} wrap />
          <Detail label="Accepts" value={acceptsLabel(s)} wrap />
          <Detail label="Model" value={modelLabel(s)} wrap />
          <Detail label="Provider" value={modelProvider(s.model)} />
          <Detail label="Context" value={s.context ? `${contextLabel(s.context)} · ${Math.round(s.context.used / 1000)}k / ${Math.round(s.context.window / 1000)}k` : null} />
          <Detail label="Tokens" value={tokens} />
          <Detail label="Cost" value={s.costUsd !== null ? `$${s.costUsd.toFixed(2)}` : null} />
          <Detail label="Cwd" value={s.cwd} mono />
          <Detail label="Branch" value={s.branch} mono />
          <Detail label="tmux" value={s.tmux} mono />
          <Detail label="Origin" value={s.origin === "terminal" ? "started in a terminal" : "started from the app"} />
          <Detail label="Frames" value={s.frames.length} />
          <Detail label="Started" value={`${relativeTime(s.startedAt)} ago`} />
        </dl>
      )}
    </section>
  );
}

export function AgentSidebar() {
  const { repo } = useShell();
  const go = useGo();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const selectedId = sessionIdFromPath(pathname);
  const sessions = useAgentSessions();
  const [scope, setScopeState] = useState<SessionScope>(readScope);
  const [filter, setFilter] = useState("");
  const [hostOpen, setHostOpen] = useState(false);
  const setScope = (next: SessionScope) => {
    setScopeState(next);
    try {
      sessionStorage.setItem(SCOPE_KEY, next);
    } catch {
      // storage unavailable
    }
  };

  const items = useMemo(
    () =>
      buildSessionItems(sessions.data ?? [], scope, repo.fullName, filter, selectedId),
    [sessions.data, scope, repo.fullName, filter, selectedId],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i]!.type === "header" ? HEADER_H : ROW_H),
    getItemKey: (i) => items[i]!.key,
    overscan: 8,
    initialRect: { width: 260, height: 720 },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="agent-sidebar">
      <div className="flex items-center gap-1 px-3 pt-1 pb-2">
        <span className="text-sm font-medium text-ink">Sessions</span>
        <span className="text-xs text-ink-faint tabular">{items.filter((i) => i.type === "session").length || ""}</span>
        <span className="ml-auto flex items-center gap-0.5">
          <NewSessionButton />
          <HostConnectionToggle open={hostOpen} onToggle={() => setHostOpen((v) => !v)} />
        </span>
        <div className="flex items-center rounded-md bg-control p-0.5 text-[0.7rem]" role="radiogroup" aria-label="Session scope">
          {(
            [
              ["repository", repo.name],
              ["all", "All"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              onClick={() => setScope(value)}
              className={cx(
                "max-w-20 truncate rounded px-1.5 py-0.5 outline-none focus-visible:ring-1 focus-visible:ring-accent/40",
                scope === value ? "bg-surface text-ink shadow-[0_0_0_1px_var(--x-border-muted)]" : "text-ink-faint hover:text-ink-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <HostConnectionPanel open={hostOpen} onClose={() => setHostOpen(false)} />
      <div className="px-2 pb-1">
        <label className="flex h-7 items-center gap-2 rounded-md border border-border-muted px-2 text-ink-faint focus-within:border-border-strong">
          <Icon name="search" size="xs" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter sessions"
            aria-label="Filter sessions"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
      </div>
      <div ref={scrollRef} className="thin-scrollbar min-h-36 flex-1 overflow-y-auto px-1" role="list" aria-label="Sessions">
        {sessions.isPending && <p className="px-3 py-2 text-xs text-ink-faint">Loading sessions…</p>}
        {sessions.data && items.length === 0 && <p className="px-3 py-2 text-xs text-ink-faint">{filter ? "No session matches the filter." : `No sessions in ${repo.name}.`}</p>}
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const item = items[v.index]!;
            return (
              <div key={v.key} role="listitem" className="absolute inset-x-0" style={{ top: v.start, height: v.size }} data-group={item.type === "session" ? item.group : undefined}>
                {item.type === "header" ? (
                  <div className="flex h-full items-end gap-1.5 px-2 pb-1 text-xs font-medium text-ink-faint">
                    <span className="truncate">{item.label}</span>
                    <span className="tabular">{item.count}</span>
                  </div>
                ) : (
                  <SessionRow s={item.session} depth={item.depth} selected={item.session.id === selectedId} onOpen={() => go(`/agent/${item.session.id}`)} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {selectedId && <SessionDetails id={selectedId} />}
    </div>
  );
}
