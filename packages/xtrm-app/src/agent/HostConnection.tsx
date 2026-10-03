import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useAdapters, type AgentHostConnectionState, type AgentHostSettings, type DirectPairInput, type TerminalLaunch } from "../adapters/index.tsx";
import { Icon } from "../ui/icon.tsx";
import { StatusDot, type Tone } from "../ui/primitives.tsx";

// Agent host connection (PRD §35.5), two modes:
// - SSH: target, optional remote command, state, connect/disconnect.
// - Direct (XTRM-600): HTTPS front URL + one-time pairing token from `xt host pair`. The host-side
//   bridge exchanges the token for a device token and keeps it; this page only sees the device
//   summary. A refused device token shows as a re-pair prompt.

const KEY = ["agent", "host-connection"] as const;

const button =
  "flex h-6 shrink-0 items-center gap-1 rounded-md border border-border-muted px-2 text-[0.7rem] text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:border-border-strong disabled:opacity-40";
const input = "h-7 min-w-0 rounded-md border border-border-muted bg-transparent px-2 font-mono text-[0.7rem] text-ink outline-none placeholder:text-ink-faint focus:border-border-strong";

function useConnection() {
  const { agentHost } = useAdapters();
  return useQuery({
    queryKey: KEY,
    queryFn: () => agentHost.status(),
    staleTime: 30_000,
    // While a direct device is in use, re-read the bridge's state so a revoked device turns into a
    // re-pair prompt. This reads the bridge only; the host is not polled.
    refetchInterval: (q) => (q.state.data?.direct.phase === "paired" && q.state.data.phase !== "connected" ? 5_000 : false),
  });
}

function useTransition<A extends unknown[]>(fn: (...args: A) => Promise<AgentHostConnectionState>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fn(...args),
    onSuccess: (state) => {
      qc.setQueryData(KEY, state);
      void qc.invalidateQueries({ queryKey: [...KEY, "sessions"] });
      void qc.invalidateQueries({ queryKey: ["agent", "sessions"] });
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

/** What the sidebar shows: the SSH connection while it is in use, else the direct device. */
type Shown = { label: string; tone: Tone; mode: "ssh" | "direct" };
function shown(state: AgentHostConnectionState, connecting: boolean): Shown {
  const ssh = connecting ? "connecting" : state.phase;
  if (ssh === "connecting" || ssh === "connected" || ssh === "error") return { ...PHASE[ssh], mode: "ssh" };
  if (state.direct.phase === "paired") return { label: "Paired", tone: "done", mode: "direct" };
  if (state.direct.phase === "repair") return { label: "Pair again", tone: "danger", mode: "direct" };
  return { ...PHASE[ssh], mode: "ssh" };
}

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
  const meta = shown(conn.data, false);
  const where = meta.mode === "direct" ? conn.data.direct.url : conn.data.settings?.target;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`Agent host · ${meta.label}`}
      title={where ? `${where} · ${meta.label}` : "Agent host over SSH or a direct front"}
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
  const [modeChoice, setMode] = useState<"ssh" | "direct" | null>(null);
  const state = conn.data;
  if (!state) return null;
  // The request is in flight: show the transition even before the bridge reports it.
  const phase = connect.isPending ? "connecting" : state.phase;
  const repair = state.direct.phase === "repair";
  if (!open && phase !== "connecting" && phase !== "error" && !repair) return null;
  const auto = shown(state, connect.isPending);
  const mode = modeChoice ?? auto.mode;
  const meta = mode === auto.mode ? auto : mode === "ssh" ? PHASE[phase] : shown({ ...state, phase: "disconnected" }, false);
  const editing = editingState || !state.settings;

  return (
    <section
      className="mx-2 mb-2 rounded-md border border-border-muted px-2 py-1.5 text-xs"
      aria-label="Agent host"
      data-testid="host-connection"
      data-phase={phase}
      data-direct={state.direct.phase}
    >
      <div className="mb-1.5 flex gap-1" role="group" aria-label="Connection mode">
        {(["ssh", "direct"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`h-5 rounded px-1.5 text-[0.68rem] outline-none focus-visible:ring-1 focus-visible:ring-accent/40 ${mode === m ? "bg-hover text-ink" : "text-ink-faint hover:text-ink-muted"}`}
            data-testid={`host-mode-${m}`}
          >
            {m === "ssh" ? "SSH" : "Direct"}
          </button>
        ))}
      </div>
      {mode === "direct" ? (
        <DirectPanel state={state} meta={meta} />
      ) : (
        <SshPanel state={state} phase={phase} meta={meta} editing={editing} setEditing={setEditing} onClose={onClose} connect={connect} disconnect={disconnect} />
      )}
    </section>
  );
}

type Transition = ReturnType<typeof useTransition<[]>>;

function SshPanel({
  state,
  phase,
  meta,
  editing,
  setEditing,
  onClose,
  connect,
  disconnect,
}: {
  state: AgentHostConnectionState;
  phase: AgentHostConnectionState["phase"];
  meta: { label: string; tone: Tone };
  editing: boolean;
  setEditing: (v: boolean) => void;
  onClose: () => void;
  connect: Transition;
  disconnect: Transition;
}) {
  return (
    <>
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
    </>
  );
}

/** Direct mode: the paired device, or the pairing form (with the reason when the host refused the device). */
function DirectPanel({ state, meta }: { state: AgentHostConnectionState; meta: { label: string; tone: Tone } }) {
  const { agentHost } = useAdapters();
  const forget = useTransition(() => agentHost.forget());
  const [pairing, setPairing] = useState(false);
  const direct = state.direct;
  const sshInUse = state.phase === "connected" || state.phase === "connecting";
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <StatusDot tone={direct.phase === "unpaired" ? "muted" : meta.tone} label={meta.label} />
        <span className="shrink-0 text-ink-muted" data-testid="host-direct-phase">
          {direct.phase === "unpaired" ? "Not paired" : direct.phase === "paired" ? "Paired" : "Pair again"}
        </span>
        {direct.url && (
          <span className="min-w-0 truncate font-mono text-[0.68rem] text-ink-faint" title={direct.url}>
            {direct.url}
          </span>
        )}
      </div>
      {direct.phase === "paired" && direct.device && !pairing ? (
        <div className="flex flex-col gap-1 pt-1">
          <p className="flex flex-wrap gap-x-2 text-[0.7rem] text-ink-faint" data-testid="host-direct-device">
            <span>{`as ${direct.device.name}`}</span>
            <span className="font-mono" title="Revoke on the agent host with xt host revoke <id>">{`device ${direct.device.deviceId}`}</span>
            {!sshInUse && <HostSessionCount />}
          </p>
          {sshInUse && <p className="text-[0.7rem] text-ink-faint">The SSH connection is in use; disconnect it to use this device.</p>}
          <div className="flex gap-1.5">
            <button type="button" className={button} onClick={() => setPairing(true)}>
              Pair again
            </button>
            <button type="button" className={button} onClick={() => forget.mutate([])} disabled={forget.isPending}>
              Forget device
            </button>
          </div>
        </div>
      ) : (
        <div className="pt-1.5">
          {direct.phase === "repair" && (
            <p role="alert" className="mb-1.5 text-[0.7rem] text-danger" data-testid="host-direct-repair">
              {direct.error?.message ?? "The agent host no longer accepts this device. Pair again."}
            </p>
          )}
          <PairForm initialUrl={direct.url} initialName={direct.device?.name} onPaired={() => setPairing(false)} onCancel={pairing ? () => setPairing(false) : undefined} />
        </div>
      )}
    </>
  );
}

function PairForm({ initialUrl, initialName, onPaired, onCancel }: { initialUrl: string | null; initialName?: string; onPaired: () => void; onCancel?: () => void }) {
  const { agentHost } = useAdapters();
  const pair = useTransition((input: DirectPairInput) => agentHost.pair(input));
  const [url, setUrl] = useState(initialUrl ?? "");
  const [token, setToken] = useState("");
  const [name, setName] = useState(initialName ?? "xtrm-app");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // The pairing token is single use: clear it whatever the outcome.
    pair.mutate([{ url: url.trim(), pairingToken: token.trim(), deviceName: name.trim() }], { onSuccess: onPaired, onSettled: () => setToken("") });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5" aria-label="Pair with an agent host">
      <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://machine.tailnet.ts.net" aria-label="Front URL" autoComplete="off" spellCheck={false} />
      <input
        className={input}
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="xtp_… from xt host pair"
        aria-label="Pairing token"
        autoComplete="off"
        spellCheck={false}
      />
      <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="device name" aria-label="Device name" autoComplete="off" spellCheck={false} />
      {pair.error && (
        <p role="alert" className="text-[0.7rem] text-danger" data-testid="host-direct-error">
          {pair.error.message}
        </p>
      )}
      <div className="flex gap-1.5">
        <button type="submit" className={button} disabled={!url.trim() || !token.trim() || pair.isPending}>
          {pair.isPending ? "Pairing…" : "Pair"}
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
