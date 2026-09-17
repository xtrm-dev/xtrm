import type {
  DataSource,
  GithubAuthAdapter,
  GithubAuthState,
  GithubAuthStatus,
  GithubCapabilities,
  GithubInstallations,
} from "../types.ts";

// GitHub login adapter (XTRM-400 UI; backend XTRM-404, not merged yet).
// Shapes are exactly the XTRM-404 SUCCESS contract. The browser never receives
// or stores tokens: every method resolves to status/capability data only.
// No direct api.github.com calls; no token literals anywhere in this module.

export const GITHUB_APP_NAME = "xtrm-console";
export const GITHUB_APP_INSTALL_URL = `https://github.com/apps/${GITHUB_APP_NAME}/installations/new`;
export const GITHUB_DEVICE_URL = "https://github.com/login/device";

const STATES: readonly GithubAuthState[] = ["not_configured", "signed_out", "pending", "signed_in", "expired", "error"];

/** Tolerate an empty 2xx or a status object from the mutating endpoints. */
function isAuthStatus(value: unknown): value is GithubAuthStatus {
  if (!value || typeof value !== "object") return false;
  const state = (value as { state?: unknown }).state;
  return typeof state === "string" && (STATES as readonly string[]).includes(state);
}

async function getStatus(path: string): Promise<Response> {
  return fetch(`/api/github${path}`);
}

// --- live -------------------------------------------------------------------

/** Pre-XTRM-404 backend: no auth routes (404) means no per-user login exists. */
const NOT_CONFIGURED: GithubAuthStatus = { state: "not_configured", auth_source: "none" };

async function liveStatus(): Promise<GithubAuthStatus> {
  let res: Response;
  try {
    res = await getStatus("/auth/status");
  } catch (e) {
    return { state: "error", auth_source: "none", error: { code: "network", message: e instanceof Error ? e.message : String(e) } };
  }
  if (res.status === 404) return NOT_CONFIGURED;
  if (!res.ok) return { state: "error", auth_source: "none", error: { code: `http_${res.status}`, message: `GitHub backend /auth/status returned ${res.status}` } };
  try {
    const body = (await res.json()) as unknown;
    return isAuthStatus(body) ? body : { state: "error", auth_source: "none", error: { code: "bad_shape", message: "GitHub backend /auth/status returned an unexpected shape" } };
  } catch {
    return { state: "error", auth_source: "none", error: { code: "bad_json", message: "GitHub backend /auth/status returned invalid JSON" } };
  }
}

/** POST one of the mutating endpoints, then settle on a fresh status read.
 * A non-404 failure (e.g. 400 from device/start, 502 from GitHub) carries
 * `{ error, message }`: merge it onto the fresh status as an error state so
 * the operator sees it, instead of silently returning the plain status read.
 * A 400 `not_configured` means no per-user login exists: return that status. */
async function postAuth(path: "/auth/device/start" | "/auth/device/cancel" | "/auth/signout"): Promise<GithubAuthStatus> {
  try {
    const res = await fetch(`/api/github${path}`, { method: "POST" });
    if (res.status === 404) return liveStatus();
    if (!res.ok) {
      let code = `http_${res.status}`;
      let message = `GitHub backend ${path} returned ${res.status}`;
      try {
        const body = (await res.json()) as { error?: unknown; message?: unknown };
        if (typeof body.error === "string" && body.error) code = body.error;
        if (typeof body.message === "string" && body.message) message = body.message;
      } catch {
        // Non-JSON failure body: keep the http_* fallback.
      }
      if (res.status === 400 && code === "not_configured") return NOT_CONFIGURED;
      const fresh = await liveStatus();
      return { ...fresh, state: "error", error: { code, message } };
    }
    // Success (200/202): a status object, or an empty body meaning "refetch".
    try {
      const body = (await res.json()) as unknown;
      if (isAuthStatus(body)) return body;
    } catch {
      // Empty 2xx: fall through to the fresh status read.
    }
  } catch {
    // Network failure: the status read below reports it as an error state.
  }
  return liveStatus();
}

export const liveGithubAuth: GithubAuthAdapter = {
  source: "live",
  status: liveStatus,
  startDevice: () => postAuth("/auth/device/start"),
  cancelDevice: () => postAuth("/auth/device/cancel"),
  signOut: () => postAuth("/auth/signout"),
  async installations(): Promise<GithubInstallations> {
    try {
      const res = await getStatus("/auth/installations");
      if (res.status === 404) return { installations: [], install_url: GITHUB_APP_INSTALL_URL };
      if (!res.ok) throw new Error(`GitHub backend /auth/installations returned ${res.status}`);
      const body = (await res.json()) as Partial<GithubInstallations>;
      return { installations: body.installations ?? [], install_url: body.install_url ?? GITHUB_APP_INSTALL_URL };
    } catch {
      return { installations: [], install_url: GITHUB_APP_INSTALL_URL };
    }
  },
  async capabilities(repo: string): Promise<GithubCapabilities> {
    // 404 (pre-XTRM-404 backend): installation scoping is unknown, so assume
    // installed and show no misleading Install CTA; the auth notice still applies.
    const fallback: GithubCapabilities = {
      auth_source: "none",
      installed: true,
      permissions: {},
      can: { read_pulls: true, read_checks: true, read_contents: true, read_issues: true, read_actions: true },
    };
    try {
      const res = await getStatus(`/capabilities?repo=${encodeURIComponent(repo)}`);
      if (res.status === 404) return fallback;
      if (!res.ok) throw new Error(`GitHub backend /capabilities returned ${res.status}`);
      const body = (await res.json()) as Partial<GithubCapabilities>;
      return {
        auth_source: body.auth_source ?? "none",
        installed: body.installed ?? true,
        permissions: body.permissions ?? {},
        can: { read_pulls: true, read_checks: true, read_contents: true, read_issues: true, read_actions: true, ...body.can },
      };
    } catch {
      return fallback;
    }
  },
};

// --- fixture ------------------------------------------------------------------

export interface FixtureGithubAuthInit {
  status?: GithubAuthStatus;
  installations?: GithubInstallations;
  /** Per-repo capability overrides; repos absent here report installed with full reads. */
  capabilities?: Record<string, GithubCapabilities>;
}

const SIGNED_IN: GithubAuthStatus = {
  state: "signed_in",
  auth_source: "user",
  user: { login: "Jaggerxtrm", name: "Jagger Gordon", avatar_url: null },
  store: "keychain",
};

const SIGNED_OUT_SHARED: GithubAuthStatus = { state: "signed_out", auth_source: "shared" };

export function installedCapabilities(authSource: GithubAuthStatus["auth_source"] = "user"): GithubCapabilities {
  return {
    auth_source: authSource,
    installed: true,
    permissions: { pull_requests: "read", issues: "read", contents: "read", checks: "read", actions: "read", metadata: "read" },
    can: { read_pulls: true, read_checks: true, read_contents: true, read_issues: true, read_actions: true },
  };
}

/**
 * Controllable fixture covering every served state. Tests build one per state
 * via `status`, or drive the device flow: startDevice() -> pending, then
 * __resolve("signed_in" | "error" | "expired") simulates the backend poll
 * completing. Holds display data only — never tokens.
 */
export function createFixtureGithubAuth(init: FixtureGithubAuthInit = {}): GithubAuthAdapter & {
  __resolve: (state: "signed_in" | "error" | "expired") => void;
} {
  let current: GithubAuthStatus = init.status ?? SIGNED_IN;
  const installations: GithubInstallations = init.installations ?? {
    installations: [
      {
        id: 1,
        account: { login: "xtrm-dev", avatar_url: null, html_url: "https://github.com/xtrm-dev" },
        repository_selection: "selected",
        permissions: { pull_requests: "read", issues: "read", contents: "read", checks: "read", metadata: "read" },
        html_url: "https://github.com/organizations/xtrm-dev/settings/installations/1",
      },
    ],
    install_url: GITHUB_APP_INSTALL_URL,
  };
  const overrides = init.capabilities ?? {};

  const adapter: GithubAuthAdapter & { __resolve: (state: "signed_in" | "error" | "expired") => void } = {
    source: "fixture" as DataSource,
    async status() {
      return current;
    },
    async startDevice() {
      current = {
        state: "pending",
        auth_source: current.auth_source === "user" ? "user" : "none",
        device: {
          user_code: "WDJC-8F39",
          verification_uri: GITHUB_DEVICE_URL,
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          interval: 5,
        },
      };
      return current;
    },
    async cancelDevice() {
      current = { ...SIGNED_OUT_SHARED };
      return current;
    },
    async signOut() {
      current = { ...SIGNED_OUT_SHARED };
      return current;
    },
    async installations() {
      return installations;
    },
    async capabilities(repo: string) {
      return overrides[repo] ?? installedCapabilities(current.auth_source === "user" ? "user" : current.auth_source);
    },
    __resolve(state: "signed_in" | "error" | "expired") {
      if (state === "signed_in") current = { ...SIGNED_IN };
      else if (state === "expired") current = { state: "expired", auth_source: current.auth_source };
      else current = { state: "error", auth_source: current.auth_source, error: { code: "authorization_pending", message: "Authorization is still pending on GitHub." } };
    },
  };
  return adapter;
}

/** Default fixture behind `fixtureAdapters`: signed in, app installed. */
export const fixtureGithubAuth: GithubAuthAdapter = createFixtureGithubAuth();
