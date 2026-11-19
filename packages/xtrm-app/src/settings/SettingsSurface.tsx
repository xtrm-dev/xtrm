import { useGithubAuthStatus, useGithubInstallations, useGithubSignOut, useStartDevice } from "../app/queries.ts";
import { useShell } from "../shell/context.tsx";
import { Fields } from "../ui/drawer.tsx";
import { Icon } from "../ui/icon.tsx";
import { EmptyState, LoadingState, SourceBadge, StatusDot, SurfaceToolbar } from "../ui/primitives.tsx";
import { useAdapters } from "../adapters/index.tsx";

// Settings destination (XTRM-400): today a single GitHub section. Connection
// state, identity, auth source, token store, installations with
// Install/Configure links, permissions, and sign in/out. Display data only:
// tokens never reach this surface.

const actionButton =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border-muted px-2 text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:border-border-strong disabled:opacity-40";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-border-muted px-4 py-4">
      <h2 className="mb-2 text-xs font-medium text-ink-faint">{title}</h2>
      {children}
    </section>
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
        <div className="mx-auto w-full max-w-3xl">
          <Section title="Connection">
            <div className="flex flex-wrap items-center gap-2">
              <StatusDot tone={status.state === "signed_in" ? "done" : status.state === "error" ? "danger" : status.state === "pending" ? "active" : "neutral"} label={`GitHub ${status.state.replace("_", " ")}`} />
              <span className="text-sm text-ink">GitHub — {status.state.replace("_", " ")}</span>
              <span className="ml-auto flex items-center gap-2">
                {status.state === "signed_in" ? (
                  <button type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending} className={actionButton}>
                    Sign out
                  </button>
                ) : (
                  <button type="button" onClick={() => inspect({ kind: "github-auth", ref: "signin" })} className={actionButton}>
                    Sign in with GitHub
                  </button>
                )}
              </span>
            </div>
            {status.state === "error" && status.error && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-sm text-danger" role="alert">
                  {status.error.message} ({status.error.code})
                </p>
                <button type="button" onClick={() => start.mutate()} disabled={start.isPending} className={actionButton}>
                  {start.isPending ? "Starting…" : "Try again"}
                </button>
              </div>
            )}
            {status.state === "not_configured" && (
              <p className="mt-2 text-sm text-ink-muted">
                The backend has no GitHub App configured. Ask the operator to configure the xtrm-console app (see the package README), then sign in here.
              </p>
            )}
          </Section>

          <Section title="Identity">
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
          </Section>

          <Section title="Installations">
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
                  <div key={inst.id} className="rounded-md border border-border-muted px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {inst.account.avatar_url ? (
                        <img src={inst.account.avatar_url} alt="" className="size-5 rounded-full" />
                      ) : (
                        <span aria-hidden className="flex size-5 items-center justify-center rounded-full border border-border-muted bg-control text-[0.65rem] text-ink-muted">
                          {inst.account.login.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="text-sm font-medium text-ink">{inst.account.login}</span>
                      <span className="text-xs text-ink-faint">{inst.repository_selection}</span>
                      <span className="ml-auto flex items-center gap-2">
                        <a href={installs.data!.install_url} target="_blank" rel="noreferrer" className={actionButton}>
                          Install <Icon name="external" size="xs" />
                        </a>
                        <a href={inst.html_url} target="_blank" rel="noreferrer" className={actionButton}>
                          Configure <Icon name="external" size="xs" />
                        </a>
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-faint">
                      Permissions: {Object.entries(inst.permissions).map(([k, v]) => `${k} ${v}`).join(", ") || "—"}
                    </p>
                  </div>
                ))}
                <div>
                  <a href={installs.data.install_url} target="_blank" rel="noreferrer" className={actionButton}>
                    Install xtrm-console on another account <Icon name="external" size="xs" />
                  </a>
                </div>
              </div>
            )}
          </Section>

          {status.state === "pending" && status.device && (
            <Section title="Pending sign-in">
              <p className="text-sm text-ink-muted">
                A device code (<span className="font-mono">{status.device.user_code}</span>) is waiting at github.com/login/device.
              </p>
              <div className="mt-2">
                <button type="button" onClick={() => inspect({ kind: "github-auth", ref: "signin" })} className={actionButton}>
                  Open device code
                </button>
              </div>
            </Section>
          )}

          {start.isError && (
            <Section title="Sign-in error">
              <p className="text-sm text-danger" role="alert">
                {start.error instanceof Error ? start.error.message : String(start.error)}
              </p>
            </Section>
          )}
        </div>
      </div>
    </section>
  );
}
