import { useGithubAuthStatus, useGithubInstallations, useGithubSignOut, useStartDevice } from "../app/queries.ts";
import { useShell } from "../shell/context.tsx";
import { Fields } from "../ui/drawer.tsx";
import { Icon } from "../ui/icon.tsx";
import { EmptyState, LoadingState, SourceBadge, StatusDot, SurfaceToolbar, TOOLBAR_CONTROL, TOOLBAR_GHOST, cx } from "../ui/primitives.tsx";
import { Section } from "../ui/section.tsx";
import { ToolbarButton } from "../ui/toolbar.tsx";
import { useAdapters } from "../adapters/index.tsx";

// Settings destination (XTRM-400): today a single GitHub section. Connection
// state, identity, auth source, token store, installations with
// Install/Configure links, permissions, and sign in/out. Display data only:
// tokens never reach this surface.

/** The shared `Section` owns the frame and the heading; this wrapper only keeps the section's
 * accessible name, which `aria-labelledby` would otherwise have to repeat at every call site. */
function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={title} className="border-t border-border-muted first:border-t-0">
      <Section title={title} level={2}>
        {children}
      </Section>
    </div>
  );
}

/** ToolbarButton renders a button; the install links are anchors, so they take the same control
 * classes through `cx` rather than a second bordered-button style of their own. */
function ActionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cx(TOOLBAR_CONTROL, TOOLBAR_GHOST, "shrink-0")}>
      {children}
    </a>
  );
}

export function SettingsSurface() {
  const { inspect } = useShell();
  const { githubAuth } = useAdapters();
  const auth = useGithubAuthStatus();
  const installs = useGithubInstallations(!!auth.data && auth.data.state === "signed_in");
  const start = useStartDevice();
  const signOut = useGithubSignOut();

  if (auth.isPending) return <LoadingState label="Loading settings" />;
  if (auth.isError || !auth.data)
    return (
      <section className="flex min-h-0 flex-1 flex-col" aria-label="Settings">
        <SurfaceToolbar />
        <EmptyState icon="alert" title="Settings are unavailable" />
      </section>
    );
  const status = auth.data;

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Settings">
      <SurfaceToolbar>
        <span className="text-xs text-ink-faint">GitHub</span>
        <SourceBadge source={githubAuth.source} />
      </SurfaceToolbar>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <SettingsSection title="Connection">
            <div className="flex flex-wrap items-center gap-2">
              <StatusDot tone={status.state === "signed_in" ? "done" : status.state === "error" ? "danger" : status.state === "pending" ? "active" : "neutral"} label={`GitHub ${status.state.replace("_", " ")}`} />
              <span className="text-sm text-ink">GitHub — {status.state.replace("_", " ")}</span>
              <span className="ml-auto flex items-center gap-2">
                {status.state === "signed_in" ? (
                  <ToolbarButton onClick={() => signOut.mutate()} disabled={signOut.isPending}>
                    Sign out
                  </ToolbarButton>
                ) : (
                  <ToolbarButton onClick={() => inspect({ kind: "github-auth", ref: "signin" })}>Sign in with GitHub</ToolbarButton>
                )}
              </span>
            </div>
            {status.state === "error" && status.error && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-sm text-danger" role="alert">
                  {status.error.message} ({status.error.code})
                </p>
                <ToolbarButton onClick={() => start.mutate()} disabled={start.isPending}>
                  {start.isPending ? "Starting…" : "Try again"}
                </ToolbarButton>
              </div>
            )}
            {status.state === "not_configured" && (
              <p className="mt-2 text-sm text-ink-muted">
                The backend has no GitHub App configured. Ask the operator to configure the xtrm-console app (see the package README), then sign in here.
              </p>
            )}
          </SettingsSection>

          <SettingsSection title="Identity">
            {status.user ? (
              <Fields
                rows={[
                  ["Login", status.user.login],
                  ["Name", status.user.name ?? <span className="text-ink-faint">—</span>],
                  ["Auth source", status.auth_source],
                  ["Token store", status.store ?? <span className="text-ink-faint">—</span>],
                ]}
              />
            ) : (
              <Fields
                rows={[
                  ["Auth source", status.auth_source],
                  ["Token store", <span className="text-ink-faint">—</span>],
                ]}
              />
            )}
            {status.auth_source === "shared" && <p className="mt-2 text-sm text-ink-muted">Reads use the shared workspace token and are read-only. Sign in to attribute actions to yourself.</p>}
            {status.auth_source === "none" && status.state === "signed_out" && (
              <p className="mt-2 text-sm text-ink-muted">No shared token is available. Sign in to load GitHub data.</p>
            )}
          </SettingsSection>

          <SettingsSection title="Installations">
            {status.state !== "signed_in" ? (
              <p className="text-sm text-ink-muted">Sign in to see where the xtrm-console GitHub App is installed.</p>
            ) : installs.isPending ? (
              <LoadingState rows={2} label="Loading installations" />
            ) : installs.isError || !installs.data ? (
              <p className="text-sm text-danger">Could not load installations.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {installs.data.installations.length === 0 && <p className="text-sm text-ink-muted">The app is not installed on any account you can access.</p>}
                {installs.data.installations.map((inst) => (
                  <div key={inst.id} className="border-t border-border-muted pt-3 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {inst.account.avatar_url ? (
                        <img src={inst.account.avatar_url} alt="" className="size-5 rounded-full" />
                      ) : (
                        <span aria-hidden className="flex size-5 items-center justify-center rounded-full border border-border-muted bg-control text-2xs text-ink-muted">
                          {inst.account.login.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="text-sm font-medium text-ink">{inst.account.login}</span>
                      <span className="text-xs text-ink-faint">{inst.repository_selection}</span>
                      <span className="ml-auto flex items-center gap-2">
                        <ActionLink href={installs.data!.install_url}>
                          Install <Icon name="external" size="xs" />
                        </ActionLink>
                        <ActionLink href={inst.html_url}>
                          Configure <Icon name="external" size="xs" />
                        </ActionLink>
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-faint">
                      Permissions: {Object.entries(inst.permissions).map(([k, v]) => `${k} ${v}`).join(", ") || "—"}
                    </p>
                  </div>
                ))}
                <div>
                  <ActionLink href={installs.data.install_url}>
                    Install xtrm-console on another account <Icon name="external" size="xs" />
                  </ActionLink>
                </div>
              </div>
            )}
          </SettingsSection>

          {status.state === "pending" && status.device && (
            <SettingsSection title="Pending sign-in">
              <p className="text-sm text-ink-muted">
                A device code (<span className="font-mono">{status.device.user_code}</span>) is waiting at github.com/login/device.
              </p>
              <div className="mt-2">
                <ToolbarButton onClick={() => inspect({ kind: "github-auth", ref: "signin" })}>Open device code</ToolbarButton>
              </div>
            </SettingsSection>
          )}

          {start.isError && (
            <SettingsSection title="Sign-in error">
              <p className="text-sm text-danger" role="alert">
                {start.error instanceof Error ? start.error.message : String(start.error)}
              </p>
            </SettingsSection>
          )}
        </div>
      </div>
    </section>
  );
}
