// SSH connection to a remote XTRM agent host (PRD §35.5, §35.8 item 2). The host-side process
// (server/agent-host-ssh.ts in the Vite dev bridge; the desktop shell later) runs ssh; the WebView
// only reads state and asks for transitions.
import type { DataSource } from "../types.ts";
import type { HostDeviceSummary } from "./host-auth.ts";

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
  /** Direct mode (HTTPS front + pairing, PRD §35.5). Used while no SSH connection is up. */
  direct: DirectConnectionState;
}

/**
 * Direct mode as the page sees it. The device token stays in the host-side process (bridge file,
 * mode 0600) and is never sent to the page.
 * - `unpaired`: no device for this app.
 * - `paired`: requests to the front carry the device token.
 * - `repair`: the front refused the token (revoked, or the host lost the device); pair again.
 */
export interface DirectConnectionState {
  phase: "unpaired" | "paired" | "repair";
  /** HTTPS front URL, for example `https://machine.tailnet.ts.net:8443`. */
  url: string | null;
  device?: HostDeviceSummary;
  error?: { code: string; message: string };
}

export interface DirectPairInput {
  url: string;
  /** One-time `xtp_…` token from `xt host pair` on the agent host. */
  pairingToken: string;
  deviceName: string;
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
  /** Exchange a pairing token at the front for a device token (POST /v1/pair), kept host-side. */
  pair(input: DirectPairInput): Promise<AgentHostConnectionState>;
  /** Delete the stored device token and front URL. The host keeps the device until `xt host revoke`. */
  forget(): Promise<AgentHostConnectionState>;
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
  pair: (input) => call("/direct/pair", { body: input }),
  forget: () => call("/direct/forget", { body: {} }),
};

const UNPAIRED: DirectConnectionState = { phase: "unpaired", url: null };

/**
 * Fixture with every connection state. Targets: `mismatch.example` answers protocol v2,
 * `offline.example` fails in ssh, any other target connects. Connect takes `delayMs`.
 * Direct mode: any `xtp_…` token pairs once (a replay is refused like the host does); `direct`
 * sets the initial direct state, for example `repair`.
 */
export function createFixtureAgentHost(
  opts: { delayMs?: number; sessions?: HostSessionRow[]; initial?: AgentHostSettings | null; direct?: DirectConnectionState } = {},
): AgentHostConnectionAdapter {
  const delay = opts.delayMs ?? 600;
  const direct = opts.direct ?? UNPAIRED;
  let state: AgentHostConnectionState = opts.initial ? { phase: "disconnected", settings: opts.initial, direct } : { phase: "unconfigured", settings: null, direct };
  const used = new Set<string>();
  const snapshot = () => Promise.resolve(structuredClone(state));
  return {
    source: "fixture",
    status: snapshot,
    save: (settings) => {
      state = { phase: "disconnected", settings, direct: state.direct };
      return snapshot();
    },
    connect: async () => {
      const settings = state.settings;
      if (!settings) return snapshot();
      state = { phase: "connecting", settings, step: "bootstrap", direct: state.direct };
      await new Promise((r) => setTimeout(r, delay));
      if (settings.target === "mismatch.example") {
        state = {
          phase: "error",
          settings,
          direct: state.direct,
          error: { code: "protocol_mismatch", message: `The agent host on ${settings.target} (xt 2.0.0) speaks protocol v2; this app speaks v1. Update xtrm-app.` },
        };
      } else if (settings.target === "offline.example") {
        state = { phase: "error", settings, direct: state.direct, error: { code: "ssh_failed", message: `ssh ${settings.target} failed: Permission denied (publickey).` } };
      } else {
        state = { phase: "connected", settings, direct: state.direct, host: { version: "0.9.0", protocolMajor: 1, port: 41234, pid: 4242, localPort: 52345, via: "login" } };
      }
      return snapshot();
    },
    disconnect: () => {
      if (state.settings) state = { phase: "disconnected", settings: state.settings, direct: state.direct };
      return snapshot();
    },
    sessions: () => Promise.resolve(state.phase === "connected" || state.direct.phase === "paired" ? (opts.sessions ?? []) : []),
    openTerminal: (tmuxSession) => {
      const argv = ["ssh", "-t", state.settings?.target ?? "", "tmux", "attach", "-t", tmuxSession];
      return Promise.resolve({ argv, command: argv.join(" "), launched: false });
    },
    pair: async ({ url, pairingToken, deviceName }) => {
      await new Promise((r) => setTimeout(r, delay / 2));
      if (!/^xtp_[A-Za-z0-9_-]+$/.test(pairingToken) || used.has(pairingToken)) {
        throw new Error("The pairing token is unknown, used or expired. Run `xt host pair` on the agent host for a new one.");
      }
      used.add(pairingToken);
      state = { ...state, direct: { phase: "paired", url, device: { deviceId: `dev-${used.size}`, name: deviceName || "device", createdAt: Date.UTC(2026, 9, 3, 12) } } };
      return snapshot();
    },
    forget: () => {
      state = { ...state, direct: UNPAIRED };
      return snapshot();
    },
  };
}

export const fixtureAgentHost = createFixtureAgentHost({
  sessions: [
    { sessionId: "pi-main", provider: "pi", state: "working", name: "pi-main", tmux: { session: "xtrm-main", paneId: "%12" } },
    { sessionId: "test-engineer", provider: "pi", state: "settled", name: "test-engineer", tmux: { session: "xtrm-main", paneId: "%14" } },
  ],
});
