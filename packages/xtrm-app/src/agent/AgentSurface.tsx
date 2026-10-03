import { Popover } from "@base-ui/react/popover";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentSessionDetail, InteractionFrame } from "../adapters/index.tsx";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, IconButton, LoadingState, StatusDot, cx, relativeTime, type Tone } from "../ui/primitives.tsx";
import { ActivityThread } from "./Activity.tsx";
import { Composer, ComposerNotice } from "./Composer.tsx";
import { AgentRefChip } from "./RefChip.tsx";
import { useOpenInTerminal } from "./HostConnection.tsx";
import { ContextMeter, STATE_LABEL, STATE_TONE, contextPercent, duration, shortModel } from "./meta.tsx";
import { useAgentLive, useAgentSession, useAgentSessions, useRespond } from "./queries.ts";
import { useAgentStore, useAgentStoreVersion } from "./workspace.tsx";

const FRAME_TONE: Record<InteractionFrame["status"], Tone> = { working: "active", settled: "neutral", failed: "danger", aborted: "muted" };

const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

function toolCount(f: InteractionFrame) {
  return f.activity.filter((a) => a.kind === "tool").length;
}

function SessionHeader({ s }: { s: AgentSessionDetail }) {
  const shell = useShell();
  const [copied, setCopied] = useState<string | null>(null);
  const tmuxSession = s.tmux?.split(":")[0] || null;
  const attach = tmuxSession ? `tmux attach -t ${tmuxSession}` : null;
  const terminal = useOpenInTerminal(tmuxSession);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border-muted px-4" data-testid="session-header">
      <StatusDot tone={STATE_TONE[s.state]} label={STATE_LABEL[s.state]} />
      <h1 className="truncate text-sm font-medium text-ink">{s.name}</h1>
      {s.role && <span className="shrink-0 text-xs text-ink-faint">{s.role}</span>}
      {s.workRef && <AgentRefChip reference={{ kind: "issue", ref: s.workRef }} className="shrink-0" />}
      <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-ink-faint">
        {s.model && <span className="hidden md:inline">{[shortModel(s.model), s.thinking].filter(Boolean).join(" · ")}</span>}
        <ContextMeter percent={contextPercent(s)} />
        <span className="hidden sm:inline">{STATE_LABEL[s.state]}</span>
      </span>
      {attach && (
        <IconButton
          icon={copied ? "check" : "external"}
          label={copied ?? (terminal.remote ? "Open in terminal over ssh" : `Open in terminal · copies ${attach}`)}
          disabled={terminal.open.isPending}
          onClick={() =>
            terminal.open.mutate(undefined, {
              onSuccess: (r) => {
                copy(r.command);
                setCopied(`${r.launched ? "Started" : "Command copied"} · ${r.command}`);
                setTimeout(() => setCopied(null), 4000);
              },
              onError: (e) => setCopied(`Open in terminal failed · ${e.message}`),
            })
          }
        />
      )}
      <OptionsMenu
        label="Session options"
        header={`@session:${s.id}`}
        items={[
          { label: "Inspect in drawer", icon: "inspector", onSelect: () => shell.inspect({ kind: "session", ref: s.id }) },
          { label: "Copy reference", icon: "copy", onSelect: () => copy(`@session:${s.id}`) },
          ...(attach ? [{ label: "Copy attach command", icon: "command" as const, onSelect: () => copy(attach) }] : []),
          { label: "Fork · needs the agent host", icon: "branch", disabled: true, onSelect: () => {} },
        ]}
      />
    </header>
  );
}

function FrameView({ s, f }: { s: AgentSessionDetail; f: InteractionFrame }) {
  const store = useAgentStore();
  useAgentStoreVersion();
  const respond = useRespond(s.id);
  const expanded = store.view(s.id).expanded;
  const tools = toolCount(f);
  return (
    <article aria-label={`Frame ${f.index}: ${f.title}`} data-testid="frame" data-frame-status={f.status}>
      <header className="flex items-start gap-3">
        <span aria-hidden className={cx("mt-[0.55rem] size-2 shrink-0 rounded-full", f.status === "working" ? "bg-accent" : "bg-accent/60")} />
        <div className="min-w-0 flex-1">
          <p className="text-[0.95rem] leading-6 font-medium whitespace-pre-wrap text-ink" data-testid="frame-request">
            {f.ingress.text || <span className="font-normal text-ink-faint italic">Prompt text not reported by this session</span>}
          </p>
          {f.ingress.refs.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {f.ingress.refs.map((r) => (
                <AgentRefChip key={`${r.kind}:${r.ref}`} reference={r} />
              ))}
            </div>
          )}
        </div>
        <span className="mt-1 shrink-0 text-xs text-ink-faint tabular" title={new Date(f.ingress.at).toLocaleString()}>
          {clock(f.ingress.at)}
          <span className="ml-1.5 rounded-sm border border-border-muted px-1 text-[0.65rem]" data-testid="frame-ingress" title={f.ingress.origin === "gui" ? "Sent from the app" : "Typed in the terminal"}>
            {f.ingress.origin === "gui" ? "GUI" : "terminal"}
          </span>
        </span>
      </header>

      <div className="mt-4 ml-5">
        <ActivityThread
          activity={f.activity}
          isOpen={(id) => !!expanded[id]}
          toggle={(id) => store.commit(s.id, { expanded: { ...expanded, [id]: !expanded[id] } })}
          onAnswer={(activityId, answer) => respond.mutate({ activityId, answer })}
        />
        {respond.error && (
          <p role="alert" className="mt-1.5 flex items-center gap-1.5 pl-7 text-xs text-danger">
            <Icon name="alert" size="xs" />
            {respond.error.message}
          </p>
        )}
        {f.response && <Markdown className="mt-4 text-[0.92rem] leading-7 text-ink">{f.response}</Markdown>}
        {f.status === "working" && !f.response && (
          <p className="mt-3 flex items-center gap-2 pl-1.5 text-xs text-ink-faint" data-testid="frame-working">
            <span className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
            {s.state === "waiting" ? "Waiting for your answer" : "Working"}
          </p>
        )}
      </div>

      {f.status !== "working" && (
        <div className="mt-8 flex items-center gap-3 text-[0.7rem] text-ink-faint" data-testid="frame-settled">
          <span className="h-px flex-1 bg-border-muted" />
          <span className="tabular">
            Frame {f.index} · {f.status}
            {f.settledAt ? ` · ${duration(f.settledAt - f.startedAt)}` : ""}
            {tools ? ` · ${tools} ${tools === 1 ? "tool" : "tools"}` : ""}
          </span>
          <span className="h-px flex-1 bg-border-muted" />
        </div>
      )}
    </article>
  );
}

function HistoryPanel({ s, selected, onSelect }: { s: AgentSessionDetail; selected: string; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<"frames" | "tree">("frames");
  return (
    <div className="flex w-[26rem] flex-col">
      <div className="flex items-center gap-0.5 border-b border-border-muted px-2 py-1.5" role="tablist" aria-label="History projection">
        {(["frames", "tree"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx("rounded px-2 py-0.5 text-xs capitalize outline-none", tab === t ? "bg-hover text-ink" : "text-ink-faint hover:text-ink-muted")}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto pr-1 text-xs text-ink-faint tabular">{s.frames.length} frames</span>
      </div>
      {tab === "frames" ? (
        <ol className="thin-scrollbar max-h-80 overflow-y-auto p-1" aria-label="Frames">
          {[...s.frames].reverse().map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onSelect(f.id)}
                aria-current={f.id === selected ? "true" : undefined}
                className={cx("flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-hover focus-visible:bg-hover", f.id === selected && "bg-hover")}
              >
                <StatusDot tone={FRAME_TONE[f.status]} label={f.status} />
                <span className="w-5 shrink-0 text-xs text-ink-faint tabular">{f.index}</span>
                <span className="truncate text-sm text-ink">{f.title}</span>
                <span className="ml-auto shrink-0 pl-2 text-xs text-ink-faint tabular">{relativeTime(f.startedAt)}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-3 py-4 text-xs leading-5 text-ink-faint">
          The provider-native branch and fork tree is not projected yet. Visual branch compression never rewrites provider history (PRD §4).
        </p>
      )}
    </div>
  );
}

/** Recent-Frames dock under the composer: the session's chapter navigation (PRD §4, §36.4). */
function FrameDock({ s, selected, onSelect }: { s: AgentSessionDetail; selected: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [s.frames.length]);
  return (
    <nav className="flex h-9 items-center gap-1" aria-label="Frames" data-testid="frame-dock">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-ink-faint outline-none hover:bg-hover hover:text-ink-muted focus-visible:bg-hover data-[popup-open]:bg-hover">
          <Icon name="list" size="xs" /> History
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="top" align="start" sideOffset={6} className="z-50">
            <Popover.Popup className="rounded-lg bg-raised shadow-float outline-none">
              <HistoryPanel
                s={s}
                selected={selected}
                onSelect={(id) => {
                  onSelect(id);
                  setOpen(false);
                }}
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <span aria-hidden className="h-4 w-px shrink-0 bg-border-muted" />
      <div ref={scroller} className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {s.frames.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelect(f.id)}
            aria-current={f.id === selected ? "true" : undefined}
            aria-label={`Frame ${f.index}: ${f.title}`}
            title={f.title}
            className={cx(
              "flex h-7 max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs outline-none focus-visible:bg-hover",
              f.id === selected ? "bg-hover text-ink" : "text-ink-faint hover:bg-hover hover:text-ink-muted",
            )}
          >
            <StatusDot tone={FRAME_TONE[f.status]} label={f.status} />
            <span className="tabular">{f.index}</span>
            <span className="truncate">{f.title}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function SessionWorkspace({ s }: { s: AgentSessionDetail }) {
  const store = useAgentStore();
  useAgentStoreVersion();
  const view = store.view(s.id);
  const latest = s.frames[s.frames.length - 1] ?? null;
  const frame = s.frames.find((f) => f.id === view.frameId) ?? latest;
  const scroller = useRef<HTMLDivElement>(null);
  const following = view.frameId === null;

  // Restore scroll per session and Frame; keep a followed working Frame pinned to its end.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = following && latest?.status === "working" ? el.scrollHeight : store.view(s.id).scrollTop;
  }, [s.id, frame?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && following && latest?.status === "working" && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  });

  const select = (id: string) => store.commit(s.id, { frameId: id === latest?.id ? null : id, scrollTop: 0 });
  const canPrompt = s.capabilities.includes("prompt");

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={`Session ${s.name}`} data-testid="agent-surface">
      <SessionHeader s={s} />
      <div ref={scroller} onScroll={(e) => store.patch(s.id, { scrollTop: e.currentTarget.scrollTop })} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto" data-testid="frame-scroll">
        <div className="mx-auto w-full max-w-[46rem] px-6 pt-8 pb-10">
          {frame ? <FrameView key={frame.id} s={s} f={frame} /> : <EmptyState icon="agent" title="No Frames yet">Send the first message to open Frame 1.</EmptyState>}
        </div>
      </div>
      <div className="shrink-0 bg-surface">
        <div className="mx-auto w-full max-w-[46rem] px-6 pt-1 pb-2">
          {canPrompt ? <Composer key={s.id} session={s} /> : <ComposerNotice session={s} />}
          {s.frames.length > 0 && frame && <FrameDock s={s} selected={frame.id} onSelect={select} />}
        </div>
      </div>
    </section>
  );
}

export function AgentSessionSurface() {
  useAgentLive();
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string };
  const store = useAgentStore();
  const session = useAgentSession(sessionId ?? null);

  useEffect(() => {
    store.active = sessionId ?? null;
    return () => {
      if (store.active === sessionId) store.active = null;
    };
  }, [store, sessionId]);

  if (session.isPending) return <LoadingState label="Loading session" />;
  if (session.isError) return <ErrorState title="Agent host is unavailable" error={session.error} />;
  if (!session.data)
    return (
      <EmptyState icon="agent" title="Session not found" className="flex-1">
        The agent host does not know session {sessionId}.
      </EmptyState>
    );
  return <SessionWorkspace s={session.data} />;
}

/** `/agent`: reopen the last session, else the most recent live session of this repository. */
export function AgentIndexSurface() {
  useAgentLive();
  const { repo } = useShell();
  const store = useAgentStore();
  const sessions = useAgentSessions();
  const navigate = useNavigate();
  useEffect(() => {
    if (!sessions.data) return;
    const known = new Set(sessions.data.map((s) => s.id));
    const last = store.lastHref.agent && /^\/agent\/([^/]+)/.exec(store.lastHref.agent)?.[1];
    const pick =
      (last && known.has(last) ? last : null) ??
      [...sessions.data].filter((s) => s.repo === repo.fullName && s.state !== "history").sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]?.id ??
      sessions.data[0]?.id;
    if (pick) void navigate({ to: `/agent/${pick}`, replace: true } as never);
  }, [sessions.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (sessions.isError) return <ErrorState title="Agent host is unavailable" error={sessions.error} />;
  if (sessions.data?.length === 0)
    return (
      <EmptyState icon="agent" title="No sessions" className="flex-1">
        Start one with xt pi in a terminal; it appears here as soon as its extension connects.
      </EmptyState>
    );
  return <LoadingState label="Opening session" />;
}
