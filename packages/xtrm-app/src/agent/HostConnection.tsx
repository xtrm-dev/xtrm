import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useAdapters, type AgentHostConnectionState, type AgentHostSettings, type TerminalLaunch } from "../adapters/index.tsx";
import { Icon } from "../ui/icon.tsx";
import { StatusDot, type Tone } from "../ui/primitives.tsx";

// Agent host connection over SSH (PRD §35.5): target, optional remote command, state, connect/disconnect.

const KEY = ["agent", "host-connection"] as const;

const button =
  "flex h-6 shrink-0 items-center gap-1 rounded-md border border-border-muted px-2 text-[0.7rem] text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:border-border-strong disabled:opacity-40";
const input = "h-7 min-w-0 rounded-md border border-border-muted bg-transparent px-2 font-mono text-[0.7rem] text-ink outline-none placeholder:text-ink-faint focus:border-border-strong";

function useConnection() {
  const { agentHost } = useAdapters();
  return useQuery({ queryKey: KEY, queryFn: () => agentHost.status(), staleTime: 30_000 });
}

function useTransition<A extends unknown[]>(fn: (...args: A) => Promise<AgentHostConnectionState>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fn(...args),
    onSuccess: (state) => {
      qc.setQueryData(KEY, state);
      void qc.invalidateQueries({ queryKey: [...KEY, "sessions"] });
    },
  });
}

const PHASE: Record<AgentHostConnectionState["phase"], { label: string; tone: Tone }> = {
  unconfigured: { label: "Not configured", tone: "muted" },
  disconnected: { label: "Disconnected", tone: "neutral" },
  connecting: { label: "Connecting", tone: "active" },
  connected: { label: "Connected", tone: "done" },
  error: { label: "Connection failed", tone: "danger" },
};

const VIA: Record<string, string> = { login: "login shell", interactive: "interactive login shell", stored: "stored remote command" };

function SettingsForm({ initial, onSaved, onCancel }: { initial: AgentHostSettings | null; onSaved: () => void; onCancel?: () => void }) {
  const { agentHost } = useAdapters();
  const save = useTransition((s: AgentHostSettings) => agentHost.save(s));
  const [target, setTarget] = useState(initial?.target ?? "");
  const [remote, setRemote] = useState(initial?.remoteCommand ?? "");
  const [advanced, setAdvanced] = useState(!!initial?.remoteCommand);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate([{ target: target.trim(), remoteCommand: remote.trim() || null }], { onSuccess: onSaved });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5" aria-label="Agent host connection">
      <input className={input} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="user@host or ssh alias" aria-label="SSH target" autoComplete="off" spellCheck={false} />
      {advanced ? (
        <input
          className={input}
          value={remote}
          onChange={(e) => setRemote(e.target.value)}
          placeholder="~/.local/bin/xt host ensure --json"
          aria-label="Remote command"
          autoComplete="off"
          spellCheck={false}
        />
      ) : (
        <button type="button" className="self-start text-[0.7rem] text-ink-faint hover:text-ink-muted" onClick={() => setAdvanced(true)}>
          Set a remote command…
        </button>
      )}
      {save.error && (
        <p role="alert" className="text-[0.7rem] text-danger">
          {save.error.message}
        </p>
      )}
      <div className="flex gap-1.5">
        <button type="submit" className={button} disabled={!target.trim() || save.isPending}>
          Save
        </button>
        {onCancel && (
          <button type="button" className={button} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function HostSessionCount() {
  const { agentHost } = useAdapters();
  const sessions = useQuery({ queryKey: [...KEY, "sessions"], queryFn: () => agentHost.sessions(), staleTime: 30_000 });
  if (!sessions.data) return null;
  const n = sessions.data.length;
  return <span data-testid="host-session-count">{`${n} session${n === 1 ? "" : "s"} on host`}</span>;
}

/** Sessions-header control: the connection phase as a dot; opens the panel. Adds no height. */
export function HostConnectionToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const conn = useConnection();
  if (!conn.data) return null;
  const meta = PHASE[conn.data.phase];
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`Agent host · ${meta.label}`}
      title={conn.data.settings ? `${conn.data.settings.target} · ${meta.label}` : "Agent host over SSH"}
      onClick={onToggle}
      className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[0.7rem] text-ink-faint outline-none hover:bg-hover hover:text-ink-muted focus-visible:ring-1 focus-visible:ring-accent/40"
      data-testid="host-connection-toggle"
    >
      <StatusDot tone={meta.tone} label={meta.label} />
      Host
    </button>
  );
}

/** Shown when opened, and always while connecting or failed so the operator sees the outcome. */
export function HostConnectionPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { agentHost } = useAdapters();
  const conn = useConnection();
  const connect = useTransition(() => agentHost.connect());
  const disconnect = useTransition(() => agentHost.disconnect());
  const [editingState, setEditing] = useState(false);
  const state = conn.data;
  if (!state) return null;
  // The request is in flight: show the transition even before the bridge reports it.
  const phase = connect.isPending ? "connecting" : state.phase;
  if (!open && phase !== "connecting" && phase !== "error") return null;
  const meta = PHASE[phase];
  const editing = editingState || !state.settings;

  return (
    <section className="mx-2 mb-2 rounded-md border border-border-muted px-2 py-1.5 text-xs" aria-label="Agent host" data-testid="host-connection" data-phase={phase}>
      <div className="flex min-w-0 items-center gap-1.5">
        <StatusDot tone={meta.tone} label={meta.label} />
        <span className="shrink-0 text-ink-muted" data-testid="host-connection-phase">
          {meta.label}
        </span>
        {state.settings && <span className="min-w-0 truncate font-mono text-[0.68rem] text-ink-faint" title={state.settings.target}>{state.settings.target}</span>}
        {state.settings && !editing && phase !== "connecting" && (
          <button type="button" className="ml-auto text-ink-faint hover:text-ink-muted" aria-label="Edit connection" onClick={() => setEditing(true)}>
            <Icon name="settings" size="xs" />
          </button>
        )}
      </div>

      {editing && (
        <div className="pt-1.5">
          <SettingsForm initial={state.settings} onSaved={() => setEditing(false)} onCancel={() => (state.settings ? setEditing(false) : onClose())} />
        </div>
      )}

      {state.settings && !editing && (
        <div className="flex flex-col gap-1 pt-1">
          {phase === "connecting" && <p className="text-[0.7rem] text-ink-faint">{state.step === "forward" ? "Forwarding the host port…" : "Running xt host ensure over ssh…"}</p>}
          {phase === "connected" && state.host && (
            <p className="flex flex-wrap gap-x-2 text-[0.7rem] text-ink-faint">
              <span>{`xt ${state.host.version} · protocol v${state.host.protocolMajor}`}</span>
              <span className="font-mono">{`127.0.0.1:${state.host.localPort} → ${state.host.port}`}</span>
              <span>{`via ${VIA[state.host.via] ?? state.host.via}`}</span>
              <HostSessionCount />
            </p>
          )}
          {phase === "error" && state.error && (
            <p role="alert" className="text-[0.7rem] text-danger" data-testid="host-connection-error">
              {state.error.message}
            </p>
          )}
          <div className="flex gap-1.5">
            {phase === "connected" ? (
              <button type="button" className={button} onClick={() => disconnect.mutate([])} disabled={disconnect.isPending}>
                Disconnect
              </button>
            ) : (
              <button type="button" className={button} onClick={() => connect.mutate([])} disabled={phase === "connecting"}>
                {phase === "error" ? "Retry" : "Connect"}
              </button>
            )}
          </div>
          {connect.error && (
            <p role="alert" className="text-[0.7rem] text-danger">
              {connect.error.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * "Open in terminal" (PRD §35.5). With an SSH connection configured the host-side process builds
 * `ssh -t <target> tmux attach -t <session>` (and starts it when a terminal is configured);
 * without one the command is the local `tmux attach -t <session>`.
 */
export function useOpenInTerminal(tmuxSession: string | null) {
  const { agentHost } = useAdapters();
  const conn = useConnection();
  const remote = !!conn.data?.settings;
  const open = useMutation({
    mutationFn: async (): Promise<TerminalLaunch> => {
      if (!tmuxSession) throw new Error("not a tmux-hosted session");
      if (remote) return agentHost.openTerminal(tmuxSession);
      const argv = ["tmux", "attach", "-t", tmuxSession];
      return { argv, command: argv.join(" "), launched: false };
    },
  });
  return { open, remote };
}
