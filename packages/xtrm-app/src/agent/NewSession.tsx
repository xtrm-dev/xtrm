import { Popover } from "@base-ui/react/popover";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import type { LaunchInput } from "../adapters/index.tsx";
import { useGo } from "../shell/ContextSidebar.tsx";
import { Icon } from "../ui/icon.tsx";
import { Tip, cx } from "../ui/primitives.tsx";
import { sessionIdFromPath } from "./AgentSidebar.tsx";
import { useAgentSession, useAgentSessions, useLaunch, useStreamState } from "./queries.ts";

/** How long the form waits for the started agent's extension to join the host registry. */
const JOIN_TIMEOUT_MS = 90_000;

const field = "h-7 w-full rounded-md border border-border-muted bg-surface px-2 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-border-strong";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1.5 text-[0.7rem] text-ink-muted">
        {label}
        {hint && <span className="text-ink-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/**
 * New session (PRD §35.4, §36.3 footer action, §31 criteria 2–3): the operator picks a working directory
 * on the agent host and a launch profile; the host starts the agent in tmux, and the app opens the
 * session as soon as its extension reports to the host.
 */
function NewSessionForm({ onDone }: { onDone: () => void }) {
  const go = useGo();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const open = useAgentSession(sessionIdFromPath(pathname));
  const sessions = useAgentSessions();
  const launch = useLaunch();
  const disconnected = useStreamState() === "disconnected";
  const [input, setInput] = useState<LaunchInput>({ cwd: "", command: "pi", name: "", model: "", role: "", bead: "" });
  const [waiting, setWaiting] = useState<{ tmuxSession: string; since: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<LaunchInput>) => setInput((v) => ({ ...v, ...patch }));

  // Default directory: the open session's cwd on the same host.
  useEffect(() => {
    if (open.data?.cwd && !input.cwd) set({ cwd: open.data.cwd });
  }, [open.data?.cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  // The session joins the registry when its extension connects; open it then.
  useEffect(() => {
    if (!waiting) return;
    const joined = sessions.data?.find((s) => s.name === waiting.tmuxSession);
    if (joined) {
      setWaiting(null);
      onDone();
      go(`/agent/${joined.id}`);
      return;
    }
    const t = setTimeout(() => {
      setWaiting(null);
      setError(`${waiting.tmuxSession} started in tmux, but no extension reported within ${JOIN_TIMEOUT_MS / 1000} s. Attach with tmux attach -t ${waiting.tmuxSession} to check it.`);
    }, waiting.since + JOIN_TIMEOUT_MS - Date.now());
    return () => clearTimeout(t);
  }, [waiting, sessions.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError(null);
    const { role, bead, ...rest } = input;
    launch.mutate(input.command === "xt pi" ? input : rest, {
      onSuccess: (r) => setWaiting({ tmuxSession: r.tmuxSession, since: Date.now() }),
      onError: (err) => setError(err.message),
    });
  };

  const busy = launch.isPending || !!waiting;
  return (
    <form onSubmit={submit} className="flex w-80 flex-col gap-2.5 p-3" aria-label="New session" data-testid="new-session">
      <div className="text-sm font-medium text-ink">New session</div>
      <Field label="Working directory" hint="on the agent host">
        <input required value={input.cwd} onChange={(e) => set({ cwd: e.target.value })} placeholder="/home/you/dev/repo" className={cx(field, "font-mono")} aria-label="Working directory" />
      </Field>
      <div className="flex flex-col gap-1">
        <span className="text-[0.7rem] text-ink-muted">Launch profile</span>
        <div className="flex items-center self-start rounded-md bg-control p-0.5 text-[0.7rem]" role="radiogroup" aria-label="Launch profile">
          {(["pi", "xt pi"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={input.command === c}
              onClick={() => set({ command: c })}
              className={cx("rounded px-2 py-0.5 font-mono outline-none", input.command === c ? "bg-surface text-ink shadow-[0_0_0_1px_var(--x-border-muted)]" : "text-ink-faint hover:text-ink-muted")}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name">
          <input value={input.name} onChange={(e) => set({ name: e.target.value })} placeholder="optional" className={field} aria-label="Name" />
        </Field>
        <Field label="Model">
          <input value={input.model} onChange={(e) => set({ model: e.target.value })} placeholder="default" className={cx(field, "font-mono")} aria-label="Model" />
        </Field>
        {input.command === "xt pi" && (
          <>
            <Field label="Role">
              <input value={input.role} onChange={(e) => set({ role: e.target.value })} placeholder="optional" className={field} aria-label="Role" />
            </Field>
            <Field label="Work item">
              <input value={input.bead} onChange={(e) => set({ bead: e.target.value })} placeholder="XTRM-123" className={cx(field, "font-mono")} aria-label="Work item" />
            </Field>
          </>
        )}
      </div>
      {waiting && (
        <p role="status" className="flex items-center gap-2 text-xs text-ink-muted" data-testid="new-session-waiting">
          <span className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
          Started {waiting.tmuxSession} in tmux · waiting for it to connect
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-danger">
          <Icon name="alert" size="xs" className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 pt-0.5">
        {disconnected && <span className="mr-auto text-[0.7rem] text-ink-faint">Agent host disconnected</span>}
        <button
          type="submit"
          disabled={busy || disconnected || !input.cwd.trim()}
          className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-medium text-white outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:bg-control disabled:text-ink-faint"
        >
          {launch.isPending ? "Starting…" : "Start session"}
        </button>
      </div>
    </form>
  );
}

export function NewSessionButton() {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tip label="New session" side="right">
        <Popover.Trigger
          aria-label="New session"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 data-[popup-open]:bg-hover data-[popup-open]:text-ink"
        >
          <Icon name="plus" size="md" />
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Positioner side="right" align="start" sideOffset={8} className="z-50">
          <Popover.Popup className="rounded-lg bg-raised shadow-float outline-none">
            <NewSessionForm onDone={() => setOpen(false)} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
