import { useState, type ReactNode } from "react";
import type { Activity, CoordinationActivity, ExtensionUiRequest, ToolActivity } from "../adapters/index.tsx";
import { Icon, type IconName } from "../ui/icon.tsx";
import { ContentPanel, cx } from "../ui/primitives.tsx";
import { AgentRefChip } from "./RefChip.tsx";
import { duration } from "./meta.tsx";

// Tool taxonomy rendering (PRD §36.7): the class comes from the activity's origin, never the tool name.

type Block = { type: "native"; key: string; tools: ToolActivity[] } | { type: "single"; key: string; activity: Activity };

/** Consecutive native tools collapse into one group; scripts and every other activity stand alone. */
export function groupActivity(activity: Activity[]): Block[] {
  const out: Block[] = [];
  for (const a of activity) {
    const last = out[out.length - 1];
    if (a.kind === "tool" && a.class === "native" && a.script === undefined && !a.children?.length) {
      if (last?.type === "native") last.tools.push(a);
      else out.push({ type: "native", key: a.id, tools: [a] });
    } else out.push({ type: "single", key: a.id, activity: a });
  }
  return out;
}

/**
 * A coordination-class tool call (the host classed it from its coordination table, §36.7 rule 1) as the
 * semantic activity of §14: the tool name picks the action within the class, the arguments name the peer
 * and the work item, and the transport (MCP server or extension, and the tool) stays for the detail view.
 */
export function coordinationOf(t: ToolActivity): CoordinationActivity {
  const a = (t.args ?? {}) as Record<string, unknown>;
  const str = (...keys: string[]) => keys.map((k) => a[k]).find((v): v is string => typeof v === "string" && v.trim() !== "")?.trim();
  const name = t.name.toLowerCase();
  const action: CoordinationActivity["action"] = /review/.test(name) ? "review" : /reply|result/.test(name) ? "reply" : /dispatch|resume|retry|steer|spawn|run/.test(name) ? "dispatch" : "message";
  const via = t.origin.server ? `MCP ${t.origin.server}` : (t.origin.extension ?? "extension");
  const outcome = t.output?.split("\n").find((l) => l.trim())?.trim();
  return {
    kind: "coordination",
    id: t.id,
    action,
    peer: str("specialist", "to", "target", "agent", "session", "peer", "name") ?? "unknown peer",
    summary: str("prompt", "message", "text", "summary") ?? outcome ?? t.subject,
    workRef: str("issue", "bead", "workItem", "work_item"),
    status: t.status === "running" ? "running" : "done",
    transport: `${via} · ${t.name}${t.status === "error" ? " · failed" : ""}${outcome ? ` · ${outcome}` : ""}`,
  };
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

/** How an extension UI request ended, from this app's answer and the host's extension_ui_resolved. */
export function promptOutcome(ui: ExtensionUiRequest): string | null {
  if (ui.resolved?.outcome === "cancelled") return ui.resolved.by === "local" ? "Cancelled in the terminal" : "Cancelled";
  if (ui.resolved?.by === "local") return "Answered in the terminal";
  if (ui.answer !== null) return `Answered ${ui.answer}`;
  // Answered from an app (this one before a reload, or another client): the host does not carry the value.
  if (ui.resolved) return "Answered from the app";
  return null;
}

/** An extension UI request (PRD §20, §35.3): confirm and select as buttons, input as a text field. */
export function ExtensionPrompt({ ui, label, onAnswer }: { ui: ExtensionUiRequest; label: string; onAnswer: (answer: string | null) => void }) {
  const [value, setValue] = useState("");
  const outcome = promptOutcome(ui);
  if (outcome)
    return (
      <p className="flex items-center gap-1.5 pl-7 text-xs text-ink-faint" data-testid="extension-request-outcome" data-resolved-by={ui.resolved?.by ?? ""}>
        <Icon name={ui.answer === "Deny" || ui.resolved?.outcome === "cancelled" ? "close" : "check"} size="xs" />
        {outcome}
      </p>
    );
  const button = (primary: boolean) =>
    cx(
      "h-7 rounded-md px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
      primary ? "bg-accent text-white hover:brightness-110" : "border border-border text-ink-muted hover:bg-hover hover:text-ink",
    );
  return (
    <div role="group" aria-label={label} data-testid="extension-request" className="mt-1 ml-7 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-accent/30 bg-accent-soft/60 px-3 py-2">
      <span className="min-w-0 flex-1 text-sm text-ink">
        {ui.prompt.replace(/`/g, "")}
        {ui.detail && <span className="block text-xs text-ink-muted">{ui.detail}</span>}
      </span>
      {ui.type === "input" ? (
        <form
          className="flex shrink-0 gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onAnswer(value);
          }}
        >
          <input value={value} onChange={(e) => setValue(e.target.value)} aria-label={ui.prompt} className="h-7 w-48 rounded-md border border-border bg-surface px-2 text-xs text-ink outline-none focus:border-border-strong" />
          <button type="submit" className={button(true)} disabled={!value.trim()}>
            Answer
          </button>
        </form>
      ) : (
        <span className="flex shrink-0 gap-1.5">
          {ui.options.map((o, i) => (
            <button key={o} type="button" onClick={() => onAnswer(o)} className={button(i === 0)}>
              {o}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

/** Provenance tag text: `MCP github`, `pi-guardrails 0.4.1`, `native`. MCP without a known server shows `MCP` only (§36.7). */
export function originTag(t: ToolActivity): string {
  if (t.class === "mcp") return `MCP ${t.origin.server ?? ""}`.trim();
  if (t.class === "native") return "native";
  const ext = [t.origin.extension, t.origin.version].filter(Boolean).join(" ");
  if (t.class === "coordination") return ext ? `coordination · ${ext}` : "coordination";
  return ext || "extension";
}

/** Calls a tool or script made through `ctx.executeTool()`, in start order; each keeps its own origin (§36.7). */
function NestedCalls({ calls, isOpen, toggle }: { calls: ToolActivity[]; isOpen: (id: string) => boolean; toggle: (id: string) => void }) {
  if (calls.length === 0) return null;
  return (
    <ol className="mt-1 ml-[0.85rem] flex flex-col border-l border-border-muted pl-2" aria-label="Nested calls" data-testid="nested-calls">
      {calls.map((c) => (
        <li key={c.id} data-testid="nested-call" data-class={c.class}>
          <button
            type="button"
            aria-expanded={isOpen(c.id)}
            aria-label={`${originTag(c)} ${c.name} ${c.subject}`}
            onClick={() => toggle(c.id)}
            className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left outline-none hover:bg-hover focus-visible:bg-hover"
          >
            <OriginTag>{originTag(c)}</OriginTag>
            <span className="shrink-0 font-mono text-xs text-ink">{c.name}</span>
            <span className={cx("truncate font-mono text-xs", c.status === "error" ? "text-danger" : "text-ink-faint")}>{c.subject}</span>
            <span className="ml-auto shrink-0 pl-2 text-xs text-ink-faint tabular">{c.status === "running" ? <Running /> : duration(c.durationMs)}</span>
          </button>
          {isOpen(c.id) && (
            <div className="flex flex-col gap-2 pt-0.5 pb-1.5 pl-7">
              {c.args && <Fields args={c.args} />}
              <Output text={c.output} />
            </div>
          )}
          {c.children && c.children.length > 0 && <NestedCalls calls={c.children} isOpen={isOpen} toggle={toggle} />}
        </li>
      ))}
    </ol>
  );
}

/** `Script completed` / `Script failed`, the wall time, and the output after `Output:` (Pi codemode result text). */
export function scriptResult(t: ToolActivity): { verdict: string | null; wall: string | null; output: string | undefined } {
  const text = t.output;
  if (!text) return { verdict: null, wall: null, output: undefined };
  const m = /^(Script completed|Script failed)\n(?:Wall time ([^\n]+)\n)?(?:Output:\n)?([\s\S]*)$/.exec(text);
  return m ? { verdict: m[1]!, wall: m[2] ?? null, output: m[3] } : { verdict: null, wall: null, output: text };
}

/** The built-in codemode tool as a script block: collapsed source, output, verdict, nested calls (PRD §36.7). */
function ScriptBlock({ t, isOpen, toggle }: { t: ToolActivity; isOpen: (id: string) => boolean; toggle: (id: string) => void }) {
  const { verdict, wall, output } = scriptResult(t);
  const failed = t.status === "error" || verdict === "Script failed";
  const label = t.status === "running" ? "Running script" : (verdict ?? (failed ? "Script failed" : "Script completed"));
  const sourceId = `src:${t.id}`;
  const calls = t.children ?? [];
  return (
    <li data-activity="script" data-testid="activity-script" data-script-status={t.status}>
      <div className="flex min-h-8 min-w-0 items-center gap-2 px-1.5 text-sm">
        <Glyph icon="command" />
        <span className={cx("shrink-0", failed ? "text-danger" : "text-ink-muted")} data-testid="script-verdict">
          {label}
        </span>
        <span className="truncate font-mono text-xs text-ink-faint">{t.subject}</span>
        <span className="ml-auto shrink-0 pl-2 text-xs text-ink-faint tabular">
          {t.status === "running" ? <Running /> : [wall, `${calls.length} ${calls.length === 1 ? "call" : "calls"}`].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div className="ml-[1.85rem] flex flex-col gap-1.5">
        <button
          type="button"
          aria-expanded={isOpen(sourceId)}
          onClick={() => toggle(sourceId)}
          className="flex h-6 w-fit items-center gap-1 rounded-md px-1 text-xs text-ink-faint outline-none hover:bg-hover hover:text-ink-muted focus-visible:bg-hover"
        >
          <Caret open={isOpen(sourceId)} />
          Script source
        </button>
        {isOpen(sourceId) && (
          <ContentPanel mono className="max-h-64 whitespace-pre" data-testid="script-source">
            {t.script}
          </ContentPanel>
        )}
        <NestedCalls calls={calls} isOpen={isOpen} toggle={toggle} />
        {output !== undefined && output !== "" && <Output text={output} />}
      </div>
    </li>
  );
}

function ClassTool({
  t,
  open,
  toggle,
  isOpen,
  toggleId,
  onAnswer,
}: {
  t: ToolActivity;
  open: boolean;
  toggle: () => void;
  isOpen: (id: string) => boolean;
  toggleId: (id: string) => void;
  onAnswer: (activityId: string, answer: string | null) => void;
}) {
  const mcp = t.class === "mcp";
  const tag = originTag(t);
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
          <p className="text-[0.7rem] text-ink-faint">
            {mcp ? `MCP server ${t.origin.server ?? "unknown"} · ${t.origin.transport ?? "transport unknown"}` : t.class === "native" ? "Built-in tool" : `Pi extension ${tag}`}
          </p>
        </div>
      )}
      {t.children && t.children.length > 0 && <NestedCalls calls={t.children} isOpen={isOpen} toggle={toggleId} />}
      {t.ui && <ExtensionPrompt ui={t.ui} label={`${t.origin.extension ?? "Extension"} request`} onAnswer={(a) => onAnswer(t.id, a)} />}
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
  onAnswer: (activityId: string, answer: string | null) => void;
}) {
  if (activity.length === 0) return null;
  return (
    <ol className="flex flex-col gap-0.5" aria-label="Activity">
      {groupActivity(activity).map((b) => {
        if (b.type === "native") return <NativeGroup key={b.key} tools={b.tools} isOpen={isOpen} toggle={toggle} />;
        const a = b.activity;
        if (a.kind === "tool" && a.script !== undefined) return <ScriptBlock key={b.key} t={a} isOpen={isOpen} toggle={toggle} />;
        if (a.kind === "tool" && a.class === "coordination") {
          const c = coordinationOf(a);
          return <Coordination key={b.key} c={c} open={isOpen(a.id)} toggle={() => toggle(a.id)} />;
        }
        if (a.kind === "tool") return <ClassTool key={b.key} t={a} open={isOpen(a.id)} toggle={() => toggle(a.id)} isOpen={isOpen} toggleId={toggle} onAnswer={onAnswer} />;
        if (a.kind === "coordination") return <Coordination key={b.key} c={a} open={isOpen(a.id)} toggle={() => toggle(a.id)} />;
        if (a.kind === "prompt")
          return (
            <li key={b.key} data-activity="prompt" data-testid="activity-prompt" className="py-0.5">
              <div className="flex min-h-7 items-center gap-2 px-1.5 text-xs text-ink-faint">
                <Glyph icon="comment" />
                Extension request · {a.ui.type}
              </div>
              <ExtensionPrompt ui={a.ui} label="Extension request" onAnswer={(answer) => onAnswer(a.id, answer)} />
            </li>
          );
        return <Note key={b.key} a={a} />;
      })}
    </ol>
  );
}

