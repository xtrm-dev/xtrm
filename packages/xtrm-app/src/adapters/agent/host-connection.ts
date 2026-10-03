// SSH connection to a remote XTRM agent host (PRD §35.5, §35.8 item 2). The host-side process
// (server/agent-host-ssh.ts in the Vite dev bridge; the desktop shell later) runs ssh; the WebView
// only reads state and asks for transitions.
import type { DataSource } from "../types.ts";

export interface AgentHostSettings {
  /** `user@host` or a `~/.ssh/config` alias. */
  target: string;
  /** Operator-set remote command for hosts where neither login shell finds `xt`. */
  remoteCommand: string | null;
}

/** Which bootstrap command produced the ensure line. */
export type BootstrapAttempt = "login" | "interactive" | "stored";

export interface AgentHostConnectionState {
  phase: "unconfigured" | "disconnected" | "connecting" | "connected" | "error";
  settings: AgentHostSettings | null;
  step?: "bootstrap" | "forward";
  host?: { version: string; protocolMajor: number; port: number; pid: number; localPort: number; via: BootstrapAttempt };
  error?: { code: string; message: string };
}

/** Open in terminal: the exact argv, its display form, and whether a configured terminal was started. */
export interface TerminalLaunch {
  argv: string[];
  command: string;
  launched: boolean;
}

/** One row of the host's `session_list` (xtrm.agent-host-api.v1); only the fields read here. */
export interface HostSessionRow {
  sessionId: string;
  provider: string;
  state: string;
  name?: string;
  tmux?: { session: string; paneId: string };
}

export interface AgentHostConnectionAdapter {
  readonly source: DataSource;
  status(): Promise<AgentHostConnectionState>;
  save(settings: AgentHostSettings): Promise<AgentHostConnectionState>;
  connect(): Promise<AgentHostConnectionState>;
  disconnect(): Promise<AgentHostConnectionState>;
  /** The session list read through the forwarded port. */
  sessions(): Promise<HostSessionRow[]>;
  openTerminal(tmuxSession: string): Promise<TerminalLaunch>;
}

const BASE = "/xtrm-api/agent-host";

async function call<T>(path: string, init?: { body: unknown }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : undefined);
  const body = (await res.json().catch(() => null)) as (T & { ok?: false; error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `agent host bridge answered ${res.status}`);
  return body;
}

export const liveAgentHost: AgentHostConnectionAdapter = {
  source: "live",
  status: () => call("/connection"),
  save: (settings) => call("/settings", { body: settings }),
  connect: () => call("/connect", { body: {} }),
  disconnect: () => call("/disconnect", { body: {} }),
  sessions: () => call<{ sessions: HostSessionRow[] }>("/api/v1/sessions").then((r) => r.sessions),
  openTerminal: (tmuxSession) => call("/terminal", { body: { tmuxSession } }),
};

/**
 * Fixture with every connection state. Targets: `mismatch.example` answers protocol v2,
 * `offline.example` fails in ssh, any other target connects. Connect takes `delayMs`.
 */
export function createFixtureAgentHost(opts: { delayMs?: number; sessions?: HostSessionRow[]; initial?: AgentHostSettings | null } = {}): AgentHostConnectionAdapter {
  const delay = opts.delayMs ?? 600;
  let state: AgentHostConnectionState = opts.initial ? { phase: "disconnected", settings: opts.initial } : { phase: "unconfigured", settings: null };
  const snapshot = () => Promise.resolve(structuredClone(state));
  return {
    source: "fixture",
    status: snapshot,
    save: (settings) => {
      state = { phase: "disconnected", settings };
      return snapshot();
    },
    connect: async () => {
      const settings = state.settings;
      if (!settings) return snapshot();
      state = { phase: "connecting", settings, step: "bootstrap" };
      await new Promise((r) => setTimeout(r, delay));
      if (settings.target === "mismatch.example") {
        state = {
          phase: "error",
          settings,
          error: { code: "protocol_mismatch", message: `The agent host on ${settings.target} (xt 2.0.0) speaks protocol v2; this app speaks v1. Update xtrm-app.` },
        };
      } else if (settings.target === "offline.example") {
        state = { phase: "error", settings, error: { code: "ssh_failed", message: `ssh ${settings.target} failed: Permission denied (publickey).` } };
      } else {
        state = { phase: "connected", settings, host: { version: "0.9.0", protocolMajor: 1, port: 41234, pid: 4242, localPort: 52345, via: "login" } };
      }
      return snapshot();
    },
    disconnect: () => {
      if (state.settings) state = { phase: "disconnected", settings: state.settings };
      return snapshot();
    },
    sessions: () => Promise.resolve(state.phase === "connected" ? (opts.sessions ?? []) : []),
    openTerminal: (tmuxSession) => {
      const argv = ["ssh", "-t", state.settings?.target ?? "", "tmux", "attach", "-t", tmuxSession];
      return Promise.resolve({ argv, command: argv.join(" "), launched: false });
    },
  };
}

export const fixtureAgentHost = createFixtureAgentHost({
  sessions: [
    { sessionId: "pi-main", provider: "pi", state: "working", name: "pi-main", tmux: { session: "xtrm-main", paneId: "%12" } },
    { sessionId: "test-engineer", provider: "pi", state: "settled", name: "test-engineer", tmux: { session: "xtrm-main", paneId: "%14" } },
  ],
});
