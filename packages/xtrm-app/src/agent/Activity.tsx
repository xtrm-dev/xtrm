import type { ReactNode } from "react";
import type { Activity, CoordinationActivity, ToolActivity } from "../adapters/index.tsx";
import { Icon, type IconName } from "../ui/icon.tsx";
import { ContentPanel, cx } from "../ui/primitives.tsx";
import { AgentRefChip } from "./RefChip.tsx";
import { duration } from "./meta.tsx";

// Tool taxonomy rendering (PRD §36.7): the class comes from the activity's origin, never the tool name.

type Block = { type: "native"; key: string; tools: ToolActivity[] } | { type: "single"; key: string; activity: Activity };

/** Consecutive native tools collapse into one group; every other activity stands alone. */
export function groupActivity(activity: Activity[]): Block[] {
  const out: Block[] = [];
  for (const a of activity) {
    const last = out[out.length - 1];
    if (a.kind === "tool" && a.class === "native") {
      if (last?.type === "native") last.tools.push(a);
      else out.push({ type: "native", key: a.id, tools: [a] });
    } else out.push({ type: "single", key: a.id, activity: a });
  }
  return out;
}

const VERBS: Record<string, [string, string, string]> = {
  read: ["Read", "file", "files"],
  write: ["Wrote", "file", "files"],
  edit: ["Edited", "file", "files"],
  bash: ["Ran", "command", "commands"],
  grep: ["Searched", "pattern", "patterns"],
  find: ["Listed", "path", "paths"],
  ls: ["Listed", "directory", "directories"],
};

export function nativeSummary(tools: ToolActivity[]): string {
  const counts = new Map<string, number>();
  for (const t of tools) {
    const key = t.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, n], i) => {
      const [verb, one, many] = VERBS[name] ?? ["Used", name, name];
      const phrase = `${verb} ${n} ${n === 1 ? one : many}`;
      return i === 0 ? phrase : phrase[0]!.toLowerCase() + phrase.slice(1);
    })
    .join(" · ");
}

function Caret({ open }: { open: boolean }) {
  return <Icon name="chevronDown" size="xs" className={cx("shrink-0 text-ink-faint transition-transform duration-150", !open && "-rotate-90")} />;
}

function Glyph({ icon }: { icon: IconName }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center text-ink-faint">
      <Icon name={icon} size="xs" />
    </span>
  );
}

/** Hairline provenance tag: `MCP github`, `pi-guardrails 0.4.1`. Ink only, no colour. */
function OriginTag({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded-sm border border-border-muted px-1 text-[0.65rem] leading-4 text-ink-faint">{children}</span>;
}

function RowButton({ open, onToggle, label, children, meta }: { open: boolean; onToggle: () => void; label: string; children: ReactNode; meta?: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={onToggle}
      className="group/act flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-sm text-ink-muted outline-none hover:bg-hover focus-visible:bg-hover"
    >
      <Caret open={open} />
      {children}
      {meta && <span className="ml-auto shrink-0 pl-2 text-xs text-ink-faint tabular">{meta}</span>}
    </button>
  );
}

function Running() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-faint">
      <span className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
      running
    </span>
  );
}

function Fields({ args }: { args: Record<string, unknown> }) {
  return (
    <dl className="grid grid-cols-[minmax(4rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      {Object.entries(args).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-faint">{k}</dt>
          <dd className="min-w-0 font-mono break-all text-ink-muted">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Output({ text }: { text?: string }) {
  if (!text) return <p className="text-xs text-ink-faint">No output captured.</p>;
  return (
    <ContentPanel mono className="max-h-48 whitespace-pre-wrap">
      {text}
    </ContentPanel>
  );
}

function NativeLine({ t, open, onToggle }: { t: ToolActivity; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${t.name} ${t.subject}`}
        onClick={onToggle}
        className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left outline-none hover:bg-hover focus-visible:bg-hover"
      >
        <span className="w-10 shrink-0 font-mono text-[0.7rem] text-ink-faint">{t.name.toLowerCase()}</span>
        <span className={cx("truncate font-mono text-xs", t.status === "error" ? "text-danger" : "text-ink-muted")}>{t.subject}</span>
        <span className="ml-auto shrink-0 pl-2 text-xs text-ink-faint tabular">{t.status === "running" ? <Running /> : duration(t.durationMs)}</span>
      </button>
      {open && (
        <div className="pt-0.5 pb-1.5 pl-12">
          <Output text={t.output} />
        </div>
      )}
    </li>
  );
}

function NativeGroup({ tools, isOpen, toggle }: { tools: ToolActivity[]; isOpen: (id: string) => boolean; toggle: (id: string) => void }) {
  const groupId = `g:${tools[0]!.id}`;
  const running = tools.some((t) => t.status === "running");
  const open = isOpen(groupId) || running;
  const total = tools.reduce((n, t) => n + (t.durationMs ?? 0), 0);
  return (
    <li data-activity="native" data-testid="activity-native">
      <RowButton open={open} onToggle={() => toggle(groupId)} label={nativeSummary(tools)} meta={running ? <Running /> : duration(total)}>
        <span className="truncate">{nativeSummary(tools)}</span>
      </RowButton>
      {open && (
        <ul className="mt-0.5 ml-[0.85rem] border-l border-border-muted pl-2">
          {tools.map((t) => (
            <NativeLine key={t.id} t={t} open={isOpen(t.id)} onToggle={() => toggle(t.id)} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ExtensionPrompt({ t, onAnswer }: { t: ToolActivity; onAnswer: (answer: string) => void }) {
  const ui = t.ui!;
  if (ui.answer !== null)
    return (
      <p className="flex items-center gap-1.5 pl-7 text-xs text-ink-faint">
        <Icon name={ui.answer === "Deny" ? "close" : "check"} size="xs" />
        Answered {ui.answer}
      </p>
    );
  return (
    <div role="group" aria-label={`${t.origin.extension ?? "Extension"} request`} data-testid="extension-request" className="mt-1 ml-7 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-accent/30 bg-accent-soft/60 px-3 py-2">
      <span className="min-w-0 flex-1 text-sm text-ink">{ui.prompt.replace(/`/g, "")}</span>
      <span className="flex shrink-0 gap-1.5">
        {ui.options.map((o, i) => (
          <button
            key={o}
            type="button"
            onClick={() => onAnswer(o)}
            className={cx(
              "h-7 rounded-md px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              i === 0 ? "bg-accent text-white hover:brightness-110" : "border border-border text-ink-muted hover:bg-hover hover:text-ink",
            )}
          >
            {o}
          </button>
        ))}
      </span>
    </div>
  );
}

function ClassTool({ t, open, toggle, onAnswer }: { t: ToolActivity; open: boolean; toggle: () => void; onAnswer: (activityId: string, answer: string) => void }) {
  const mcp = t.class === "mcp";
  const tag = mcp ? `MCP ${t.origin.server ?? ""}`.trim() : [t.origin.extension, t.origin.version].filter(Boolean).join(" ");
  return (
    <li data-activity={t.class} data-testid={`activity-${t.class}`}>
      <RowButton open={open} onToggle={toggle} label={`${tag} ${t.name}`} meta={t.status === "running" && !t.ui ? <Running /> : duration(t.durationMs)}>
        <OriginTag>{tag}</OriginTag>
        <span className="shrink-0 font-mono text-xs text-ink">{t.name}</span>
        <span className={cx("truncate text-xs", t.status === "error" ? "text-danger" : "text-ink-faint")}>{t.subject}</span>
      </RowButton>
      {open && (
        <div className="flex flex-col gap-2 pt-1 pb-2 pl-7">
          {t.args && <Fields args={t.args} />}
          {t.output !== undefined && <Output text={t.output} />}
          <p className="text-[0.7rem] text-ink-faint">{mcp ? `MCP server ${t.origin.server} · ${t.origin.transport ?? "transport unknown"}` : `Pi extension ${tag}`}</p>
        </div>
      )}
      {t.ui && <ExtensionPrompt t={t} onAnswer={(a) => onAnswer(t.id, a)} />}
    </li>
  );
}

const COORD: Record<CoordinationActivity["action"], { icon: IconName; verb: string }> = {
  message: { icon: "comment", verb: "Messaged" },
  reply: { icon: "comment", verb: "Reply from" },
  dispatch: { icon: "agents", verb: "Dispatched" },
  review: { icon: "done", verb: "Requested review from" },
};

function Coordination({ c, open, toggle }: { c: CoordinationActivity; open: boolean; toggle: () => void }) {
  const { icon, verb } = COORD[c.action];
  const quote = c.action === "message" || c.action === "reply";
  return (
    <li data-activity="coordination" data-testid="activity-coordination" className="py-0.5">
      <div className="flex min-h-8 min-w-0 items-center gap-2 px-1.5 text-sm">
        <Glyph icon={icon} />
        <span className="shrink-0 text-ink-muted">{verb}</span>
        <AgentRefChip reference={{ kind: "session", ref: c.peer }} />
        {c.workRef && <AgentRefChip reference={{ kind: "issue", ref: c.workRef }} />}
        <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-xs text-ink-faint">
          {c.progress && (
            <span className="inline-flex items-center gap-1.5 tabular" title={`${c.progress.done} of ${c.progress.total} checks`}>
              <span className="relative h-1 w-10 overflow-hidden rounded-full bg-border">
                <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${(c.progress.done / c.progress.total) * 100}%` }} />
              </span>
              {c.progress.done}/{c.progress.total}
            </span>
          )}
          {c.status === "running" ? <Running /> : c.status === "waiting" ? <span>waiting</span> : null}
          <button type="button" aria-expanded={open} aria-label="Transport details" onClick={toggle} className="flex size-5 items-center justify-center rounded-sm outline-none hover:bg-hover focus-visible:bg-hover">
            <Icon name="more" size="xs" />
          </button>
        </span>
      </div>
      <p className={cx("ml-[1.85rem] text-sm", quote ? "border-l-2 border-border pl-3 text-ink-muted italic" : "text-ink-muted")}>{c.summary}</p>
      {open && <p className="mt-1 ml-[1.85rem] text-[0.7rem] text-ink-faint">via {c.transport}</p>}
    </li>
  );
}

function Note({ a }: { a: Extract<Activity, { kind: "retry" | "compaction" | "steer" }> }) {
  const icon: IconName = a.kind === "steer" ? "forward" : a.kind === "retry" ? "restore" : "list";
  return (
    <li className="flex min-h-7 items-center gap-2 px-1.5 text-xs text-ink-faint" data-activity={a.kind}>
      <Glyph icon={icon} />
      {a.text}
    </li>
  );
}

export function ActivityThread({
  activity,
  isOpen,
  toggle,
  onAnswer,
}: {
  activity: Activity[];
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  onAnswer: (activityId: string, answer: string) => void;
}) {
  if (activity.length === 0) return null;
  return (
    <ol className="flex flex-col gap-0.5" aria-label="Activity">
      {groupActivity(activity).map((b) => {
        if (b.type === "native") return <NativeGroup key={b.key} tools={b.tools} isOpen={isOpen} toggle={toggle} />;
        const a = b.activity;
        if (a.kind === "tool") return <ClassTool key={b.key} t={a} open={isOpen(a.id)} toggle={() => toggle(a.id)} onAnswer={onAnswer} />;
        if (a.kind === "coordination") return <Coordination key={b.key} c={a} open={isOpen(a.id)} toggle={() => toggle(a.id)} />;
        return <Note key={b.key} a={a} />;
      })}
    </ol>
  );
}

