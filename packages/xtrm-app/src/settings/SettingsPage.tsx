import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useAdapters } from "../adapters/index.tsx";
import { SECTION_ORDER, SETTINGS_SECTIONS, type SettingsSection, type Source } from "../lib/settings/index.ts";
import { useShell } from "../shell/context.tsx";
import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import { Fields } from "../ui/drawer.tsx";
import { StatusDot, SurfaceToolbar, TOOLBAR_CONTROL, TOOLBAR_GHOST, cx } from "../ui/primitives.tsx";
import { ToolbarButton } from "../ui/toolbar.tsx";
import { GithubAccountBlock } from "./GithubAccountBlock.tsx";
import { useSettingRows, type SettingRow } from "./model.ts";
import { ThemeChoice } from "./ThemeChoice.tsx";

// The /settings route tree (XTRM-1103): six sections from the shared label record, one row per
// setting with its own anchor, the value's source, and a reset where the value differs from the
// default and the console can put it back. Placement: docs/design/settings-placement.md.

export const sectionHref = (id: SettingsSection) => `/settings/${id}`;

const SOURCE_TEXT: Record<Source, string> = { default: "Default", device: "This device", host: "Host", project: "Project override" };

/** Row controls the console already has; every other row shows its value and where to change it. */
const CONTROLS: Partial<Record<SettingRow["key"], () => ReactNode>> = {
  "appearance.theme": () => <ThemeChoice variant="page" />,
};

function Row({ row }: { row: SettingRow }) {
  const control = CONTROLS[row.key];
  const labelId = `${row.anchor}-label`;
  return (
    <div
      id={row.anchor}
      role="group"
      aria-labelledby={labelId}
      data-setting={row.key}
      className="flex scroll-mt-4 flex-col gap-1 border-t border-border-muted px-1 py-2.5 first:border-t-0 target:bg-hover"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span id={labelId} className="text-sm text-ink">
          {row.label}
        </span>
        <span className="text-2xs text-ink-faint" data-testid="setting-source">
          {row.unknown ? "Unknown: the host did not answer" : SOURCE_TEXT[row.source]}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {!control && (
            <span className="truncate text-sm text-ink-muted" data-testid="setting-value">
              {row.unknown ? "Unknown" : row.value}
            </span>
          )}
          {control?.()}
          {row.resettable && row.reset && (
            <ToolbarButton onClick={row.reset} aria-label={`Reset ${row.label}`}>
              Reset
            </ToolbarButton>
          )}
        </span>
      </div>
      {row.note && <p className="text-xs text-ink-faint">{row.note}</p>}
    </div>
  );
}

function Rows({ rows }: { rows: SettingRow[] }) {
  return (
    <div className="flex flex-col" data-testid="setting-rows">
      {rows.map((row) => (
        <Row key={row.key} row={row} />
      ))}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-6 flex flex-col gap-2">
      <h2 className="text-xs font-medium tracking-wide text-ink-faint uppercase">{title}</h2>
      {children}
    </section>
  );
}

function GeneralBody() {
  const { repo } = useShell();
  const adapters = useAdapters();
  const sources = [
    ["Agent host", adapters.agent.source],
    ["GitHub", adapters.github.source],
    ["Substrate", adapters.substrate.source],
    ["Research", adapters.research.source],
  ] as const;
  return (
    <Fields
      rows={[
        ["Repository", repo.fullName],
        ...sources.map(([label, source]) => [
          label,
          <span key={label} className="flex items-center gap-1.5">
            <StatusDot tone={source === "live" ? "done" : "muted"} label={source} />
            {source}
          </span>,
        ] as [ReactNode, ReactNode]),
      ]}
    />
  );
}

/** The agent host's status read failed: its values are unknown, not defaults. */
function HostError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <div role="alert" aria-label="Agent host unavailable" className="mb-2 rounded-md border border-border-muted px-3 py-2 text-sm text-danger">
      The agent host did not answer ({message}). Its values are unknown.
    </div>
  );
}

function SectionBody({ id, rows }: { id: SettingsSection; rows: SettingRow[] }) {
  const navigate = useNavigate();
  const { repo } = useShell();
  if (id === "general") return <GeneralBody />;
  if (id === "connections")
    return (
      <>
        <Rows rows={rows} />
        <div className="mt-2">
          <ToolbarButton onClick={() => void navigate({ to: "/agent", search: { host: 1 } } as never)}>Change host target…</ToolbarButton>
        </div>
        <Block title="Account">
          <GithubAccountBlock />
        </Block>
      </>
    );
  if (id === "project")
    return (
      <>
        <Rows rows={rows} />
        <Block title="Integration">
          <p className="text-sm text-ink-muted">
            The binding facts for {repo.fullName}, and how each one was resolved, are on the{" "}
            <a href={`/rep/${repo.owner}/${repo.name}/project/settings`} className={cx(TOOLBAR_CONTROL, TOOLBAR_GHOST, "inline-flex")}>
              Integration page
            </a>
            .
          </p>
        </Block>
      </>
    );
  return <Rows rows={rows} />;
}

export function SettingsPage({ section }: { section: SettingsSection }) {
  const navigate = useNavigate();
  const hash = useRouterState({ select: (s) => s.location.hash });
  const { rows: all, hostError } = useSettingRows();
  const rows = all[section];
  const hasHostRows = rows.some((r) => r.unknown);
  const meta = SETTINGS_SECTIONS[section];
  const resettable = rows.filter((r) => r.resettable && r.reset);

  // A deep link to `#<anchor>` brings its row into view (`target:` highlights it).
  useEffect(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [hash, section]);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Settings">
      <SurfaceToolbar>
        <Breadcrumbs
          items={[
            { key: "settings", label: "Settings", icon: "settings", onClick: () => void navigate({ to: sectionHref(SECTION_ORDER[0]!) } as never) },
            { key: section, label: meta.label },
          ]}
        />
      </SurfaceToolbar>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings sections" className="flex w-48 shrink-0 flex-col gap-px px-2 py-2">
          {SECTION_ORDER.map((id) => {
            const current = id === section;
            return (
              <a
                key={id}
                href={sectionHref(id)}
                aria-current={current ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  void navigate({ to: sectionHref(id) } as never);
                }}
                className={cx(
                  "flex h-7 items-center rounded-md px-2 text-sm outline-none hover:bg-hover focus-visible:bg-hover",
                  current ? "bg-hover text-ink" : "text-ink-muted",
                )}
              >
                {SETTINGS_SECTIONS[id].label}
              </a>
            );
          })}
        </nav>
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-4">
            <header className="mb-2 flex items-start gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h1 className="text-base font-medium text-ink">{meta.label}</h1>
                <p className="text-sm text-ink-muted">{meta.summary}</p>
              </div>
              {resettable.length > 0 && (
                <span className="ml-auto shrink-0">
                  <ToolbarButton onClick={() => resettable.forEach((r) => r.reset!())} aria-label={`Reset ${meta.label}`}>
                    Reset section
                  </ToolbarButton>
                </span>
              )}
            </header>
            <HostError message={hasHostRows ? hostError : null} />
            <SectionBody id={section} rows={rows} />
          </div>
        </div>
      </div>
    </section>
  );
}
