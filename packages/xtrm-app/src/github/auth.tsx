import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { GITHUB_APP_INSTALL_URL } from "../adapters/github/auth.ts";
import type { GithubAuthStatus } from "../adapters/index.tsx";
import {
  useCancelDevice,
  useGithubAuthStatus,
  useGithubCapabilities,
  useGithubInstallations,
  useGithubSignOut,
  useStartDevice,
} from "../app/queries.ts";
import { useGo } from "../shell/ContextSidebar.tsx";
import { useShell } from "../shell/context.tsx";
import { Fields, InspectorSection } from "../ui/drawer.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, LoadingState, StatusDot, cx, type Tone } from "../ui/primitives.tsx";

const actionButton =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border-muted px-2 text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:border-border-strong disabled:opacity-40";

// --- shared bits ---------------------------------------------------------------

function useNow(stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Notice({
  tone,
  label,
  state,
  children,
  alert,
}: {
  tone: Tone;
  label: string;
  state: string;
  children: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <div
      data-testid="github-notice"
      data-state={state}
      role={alert ? "alert" : undefined}
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border-muted px-4 py-2 text-sm"
    >
      <StatusDot tone={tone} label={label} />
      <div className="flex min-w-40 flex-1 flex-wrap items-baseline gap-x-2">{children}</div>
    </div>
  );
}

function SettingsLink({ children }: { children: React.ReactNode }) {
  const go = useGo();
  return (
    <button type="button" onClick={() => go("/settings")} className={cx(actionButton, "border-0 px-1 text-accent-ink hover:bg-transparent hover:underline")}>
      {children}
    </button>
  );
}

// --- inline notice for GitHub surfaces -------------------------------------------
// Actionable and inline, never a modal alert. Read paths are untouched: this only
// reads auth status + installation capability alongside the surface's own queries.

function AuthNotice({ status, onSignin }: { status: GithubAuthStatus; onSignin: () => void }) {
  switch (status.state) {
    case "signed_in":
      return null;
    case "not_configured":
      return (
        <Notice tone="muted" label="GitHub not configured" state="not_configured">
          <span className="text-ink">GitHub is not configured in this workspace.</span>
          <span className="text-ink-faint">Connect the xtrm-console GitHub App to load pull requests and activity.</span>
          <SettingsLink>Open Settings</SettingsLink>
        </Notice>
      );
    case "signed_out":
      return (
        <Notice tone="neutral" label={status.auth_source === "shared" ? "Read-only via shared token" : "Signed out of GitHub"} state="signed_out">
          <span className="text-ink">{status.auth_source === "shared" ? "Read-only via shared token." : "Sign in to load GitHub data."}</span>
          <span className="text-ink-faint">
            {status.auth_source === "shared" ? "Sign in to attribute actions to yourself." : "Pull requests and activity need a GitHub sign-in."}
          </span>
          <button type="button" onClick={onSignin} className={actionButton}>
            Sign in with GitHub
          </button>
        </Notice>
      );
    case "pending":
      return (
        <Notice tone="active" label="GitHub sign-in in progress" state="pending">
          <span className="text-ink">Sign-in in progress.</span>
          <span className="text-ink-faint">Enter the code at github.com/login/device to finish.</span>
          <button type="button" onClick={onSignin} className={actionButton}>
            Enter code
          </button>
        </Notice>
      );
    case "expired":
      return (
        <Notice tone="accent" label="GitHub sign-in expired" state="expired">
          <span className="text-ink">GitHub sign-in expired.</span>
          <button type="button" onClick={onSignin} className={actionButton}>
            Sign in again
          </button>
        </Notice>
      );
    case "error":
      return (
        <Notice tone="danger" label="GitHub sign-in error" state="error" alert>
          <span className="text-ink">GitHub sign-in failed{status.error ? `: ${status.error.message}` : "."}</span>
          <button type="button" onClick={onSignin} className={actionButton}>
            Try again
          </button>
        </Notice>
      );
  }
}

function InstallNotice({ repo }: { repo: string }) {
  const auth = useGithubAuthStatus();
  const caps = useGithubCapabilities(repo, !!auth.data);
  const installs = useGithubInstallations(!!auth.data && caps.data?.installed === false);
  if (!auth.data || !caps.data || caps.data.installed) return null;
  const installUrl = installs.data?.install_url ?? GITHUB_APP_INSTALL_URL;
  return (
    <Notice tone="accent" label="GitHub App not installed on this repository" state="not-installed">
      <span className="text-ink">xtrm-console is not installed on {repo}.</span>
      <a href={installUrl} target="_blank" rel="noreferrer" className={actionButton}>
        Install xtrm-console <Icon name="external" size="xs" />
      </a>
      <SettingsLink>Open Settings</SettingsLink>
    </Notice>
  );
}

export function GithubNotice({ repo }: { repo?: string }) {
  const { inspect } = useShell();
  const auth = useGithubAuthStatus();
  // The live adapter maps transport failures to an error state, so a query
  // error here is only the fixture path misbehaving; stay silent either way.
  if (auth.isPending || auth.isError || !auth.data) return null;
  const openSignin = () => inspect({ kind: "github-auth", ref: "signin" });
  return (
    <>
      <AuthNotice status={auth.data} onSignin={openSignin} />
      {repo ? <InstallNotice repo={repo} /> : null}
    </>
  );
}

// --- top-bar account control -------------------------------------------------------
// Signed out (or never configured / expired / errored): a Sign in with GitHub
// button. Signed in: an avatar menu with Settings and Sign out. Pending: a
// compact entry back into the device-code drawer.

export function AccountControl() {
  const { inspect } = useShell();
  const navigate = useNavigate();
  const auth = useGithubAuthStatus();
  const signOut = useGithubSignOut();
  if (auth.isPending || auth.isError || !auth.data) return null;
  const status = auth.data;
  const openSignin = () => inspect({ kind: "github-auth", ref: "signin" });

  if (status.state === "signed_in" && status.user) {
    const { login, avatar_url } = status.user;
    return (
      <OptionsMenu
        label={`${login} — GitHub account`}
        header={login}
        trigger={
          <button
            type="button"
            aria-label={`${login} — GitHub account`}
            title={login}
            className="flex size-7 items-center justify-center rounded-full text-xs font-medium text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:border-border-strong"
          >
            {avatar_url ? (
              <img src={avatar_url} alt="" className="size-6 rounded-full" />
            ) : (
              <span aria-hidden className="flex size-6 items-center justify-center rounded-full border border-border-muted bg-control">
                {login.slice(0, 1).toUpperCase()}
              </span>
            )}
          </button>
        }
        items={[
          { label: "Settings", icon: "settings", onSelect: () => void navigate({ to: "/settings" } as never) },
          { label: "Sign out", onSelect: () => signOut.mutate() },
        ]}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={openSignin}
      className="flex h-7 items-center rounded-md border border-border-muted px-2 text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:border-border-strong"
    >
      {status.state === "pending" ? "Enter GitHub code" : "Sign in with GitHub"}
    </button>
  );
}

// --- device-code drawer panel ----------------------------------------------------------
// Canonical drawer panel (§7): the backend polls GitHub itself, the UI polls
// auth/status while pending. No tokens, no api.github.com calls from here.

function PendingView({ status }: { status: GithubAuthStatus }) {
  const device = status.device!;
  const cancel = useCancelDevice();
  const auth = useGithubAuthStatus();
  const codeRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const now = useNow();
  const remaining = Date.parse(device.expires_at) - now;
  const codeExpired = remaining <= 0;

  // Accessibility: focus lands on the device code when the panel opens.
  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  const copy = async () => {
    setCopied(false);
    setCopyFailed(false);
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(device.user_code);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1.5 px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <StatusDot tone="active" label="Waiting for GitHub authorization" />
          <span>GitHub sign-in</span>
        </div>
        <h2 className="text-base leading-snug font-medium text-pretty text-ink">Enter this code on GitHub</h2>
      </div>

      <InspectorSection title="Device code">
        <div className="flex items-center gap-2">
          <div
            ref={codeRef}
            tabIndex={-1}
            className="rounded-md border border-border-muted bg-deep/60 px-4 py-2 font-mono text-2xl tracking-[0.2em] text-ink outline-none focus-visible:border-border-strong"
          >
            <span className="sr-only">Device code: </span>
            {device.user_code}
          </div>
          <button type="button" onClick={() => void copy()} className={actionButton} aria-label="Copy device code">
            <Icon name="copy" size="xs" /> Copy
          </button>
        </div>
        <span role="status" className="text-xs text-ink-faint">
          {copied ? "Code copied." : copyFailed ? "Copy failed — select the code manually." : ""}
        </span>
        <a
          href={device.verification_uri}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-accent-ink hover:underline"
        >
          Open github.com/login/device <Icon name="external" size="xs" />
        </a>
      </InspectorSection>

      <InspectorSection title="Status">
        {codeExpired ? (
          <p className="text-sm text-ink">This code expired before it was authorized.</p>
        ) : (
          <p className="text-sm text-ink-muted" aria-label={`This code expires in ${Math.max(1, Math.ceil(remaining / 60000))} minutes`}>
            Waiting for authorization — checking automatically. Code expires in{" "}
            <span aria-hidden="true" className="tabular">
              {formatCountdown(remaining)}
            </span>
            .
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={() => void auth.refetch()} className={actionButton}>
            Check now
          </button>
          <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending} className={actionButton}>
            Cancel
          </button>
        </div>
      </InspectorSection>
    </>
  );
}

function StartView({ title, body }: { title: string; body: string }) {
  const start = useStartDevice();
  return (
    <>
      <div className="flex flex-col gap-1.5 px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <StatusDot tone="neutral" label="GitHub sign-in" />
          <span>GitHub sign-in</span>
        </div>
        <h2 className="text-base leading-snug font-medium text-pretty text-ink">{title}</h2>
        <p className="text-sm text-ink-muted">{body}</p>
      </div>
      <InspectorSection title="Device sign-in">
        <div>
          <button type="button" onClick={() => start.mutate()} disabled={start.isPending} className={actionButton}>
            {start.isPending ? "Starting…" : "Sign in with GitHub"}
          </button>
        </div>
        <p className="text-xs text-ink-faint">GitHub shows a code here; entering it on github.com/login/device links this workspace to your account.</p>
      </InspectorSection>
    </>
  );
}

export function DevicePanel() {
  const { dispatch } = useShell();
  const [watch, setWatch] = useState(true);
  const query = useGithubAuthStatus(watch);
  const start = useStartDevice();
  const state = query.data?.state;
  useEffect(() => {
    // Poll only while the backend reports a pending flow; stop on settle.
    if (state && state !== "pending") setWatch(false);
    else if (state === "pending") setWatch(true);
  }, [state]);

  if (query.isPending) return <LoadingState rows={4} label="Loading GitHub sign-in state" />;
  if (query.isError || !query.data) return <EmptyState icon="alert" title="GitHub sign-in state is unavailable" />;
  const status = query.data;

  if (status.state === "pending" && status.device) return <PendingView key={status.device.user_code} status={status} />;

  if (status.state === "signed_in" && status.user) {
    return (
      <>
        <div className="flex flex-col gap-1.5 px-5 pt-4 pb-3">
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            <StatusDot tone="done" label="Signed in to GitHub" />
            <span>GitHub sign-in</span>
          </div>
          <h2 className="text-base leading-snug font-medium text-pretty text-ink">Signed in as {status.user.login}</h2>
        </div>
        <InspectorSection title="Identity">
          <Fields
            rows={[
              ["Login", status.user.login],
              ["Name", status.user.name ?? <span className="text-ink-faint">—</span>],
              ["Auth source", "user"],
              ["Token store", status.store ?? <span className="text-ink-faint">—</span>],
            ]}
          />
        </InspectorSection>
        <InspectorSection title="Done">
          <div>
            <button type="button" onClick={() => dispatch({ type: "drawer/close" })} className={actionButton}>
              Close
            </button>
          </div>
        </InspectorSection>
      </>
    );
  }

  if (status.state === "error") {
    return (
      <>
        <div className="flex flex-col gap-1.5 px-5 pt-4 pb-3">
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            <StatusDot tone="danger" label="GitHub sign-in error" />
            <span>GitHub sign-in</span>
          </div>
          <h2 className="text-base leading-snug font-medium text-pretty text-ink">Sign-in failed</h2>
          <p className="text-sm text-ink-muted" role="alert">
            {status.error?.message ?? "The backend reported an error."}
          </p>
        </div>
        <InspectorSection title="Retry">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => start.mutate()} disabled={start.isPending} className={actionButton}>
              {start.isPending ? "Starting…" : "Try again"}
            </button>
            <button type="button" onClick={() => void query.refetch()} className={actionButton}>
              Check status
            </button>
          </div>
        </InspectorSection>
      </>
    );
  }

  if (status.state === "expired")
    return <StartView title="Sign-in expired" body="Your GitHub sign-in expired. Start again to get a fresh device code." />;
  if (status.state === "not_configured")
    return <StartView title="GitHub is not configured" body="The backend has no GitHub App configured yet. You can still start a sign-in; it will fail until the app is configured." />;
  return <StartView title="Sign in with GitHub" body="Attribute pull requests and activity to yourself instead of the shared token." />;
}
