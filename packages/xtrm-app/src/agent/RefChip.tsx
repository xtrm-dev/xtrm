import type { AgentRef } from "../adapters/index.tsx";
import { ReferenceChip } from "../refs/references.tsx";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { cx } from "../ui/primitives.tsx";
import { REF_ICON, REF_LABEL } from "./meta.tsx";
import { formatAgentRef } from "./workspace.tsx";

const shortRef = (r: AgentRef) => (r.kind === "file" ? r.ref.split("/").pop()! : r.ref);

/** `sha256:3f2a…` → `3f2a9c1`; a commit id → its short form; other revisions as they are. */
const shortRevision = (rev: string) => {
  const hash = /^(?:sha256:)?([0-9a-f]{12,})$/.exec(rev);
  return hash ? hash[1]!.slice(0, 7) : rev.replace(/^updated:/, "").slice(0, 24);
};

/** Drawer entity of a reference; @agent and @frame have no drawer panel yet. */
const drawerOf = (r: AgentRef) => (r.kind === "epic" ? { kind: "issue" as const, ref: r.ref } : r.kind === "agent" || r.kind === "frame" ? null : { kind: r.kind, ref: r.ref });

/** Tooltip: the ref, the revision the Frame was given, and the pointer of an excerpt. */
const describe = (r: AgentRef) => [r.ref, r.revision && `revision ${r.revision}`, r.pointer && `excerpt; full: ${r.pointer}`].filter(Boolean).join("\n");

/**
 * One chip for every typed reference. Substrate and GitHub kinds reuse the Console chip
 * (status-aware, opens its drawer); host kinds (commit, file, session) open their drawer panels.
 */
export function AgentRefChip({ reference, onRemove, className, error }: { reference: AgentRef; onRemove?: () => void; className?: string; error?: string }) {
  const shell = useShell();
  const drawer = drawerOf(reference);
  const body =
    !error && !reference.revision && (reference.kind === "issue" || reference.kind === "pr" || reference.kind === "gh-issue") ? (
      <ReferenceChip reference={{ kind: reference.kind, ref: reference.ref }} />
    ) : (
      <button
        type="button"
        data-reference={formatAgentRef(reference)}
        data-revision={reference.revision}
        data-error={error}
        aria-label={`${REF_LABEL[reference.kind]} ${reference.ref}${error ? `, unresolved: ${error.replace(/_/g, " ")}` : ""}`}
        title={error ? `${reference.ref}\nunresolved: ${error.replace(/_/g, " ")}` : describe(reference)}
        onClick={(e) => {
          e.stopPropagation();
          if (drawer) shell.inspect(drawer);
        }}
        className="inline-flex max-w-72 min-w-0 items-center gap-1.5 rounded-sm px-1 leading-5 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-1 focus-visible:ring-accent/40"
      >
        <Icon name={error ? "alert" : REF_ICON[reference.kind]} size="xs" className={cx("shrink-0", error ? "text-danger" : "text-ink-faint")} />
        <span className={cx("truncate font-mono text-xs", error ? "text-danger" : "text-accent-ink")}>{shortRef(reference)}</span>
        {reference.revision && <span className="shrink-0 font-mono text-[0.65rem] text-ink-faint">{shortRevision(reference.revision)}</span>}
        {reference.pointer && <span className="shrink-0 rounded-sm border border-border-muted px-1 text-[0.6rem] text-ink-faint">excerpt</span>}
      </button>
    );
  if (!onRemove) return <span className={cx("inline-flex min-w-0", className)}>{body}</span>;
  return (
    <span className={cx("group/chip inline-flex min-w-0 items-center rounded-md border bg-surface pr-0.5", error ? "border-danger/50" : "border-border-muted", className)} data-testid="composer-ref">
      {body}
      <button
        type="button"
        aria-label={`Remove ${formatAgentRef(reference)}`}
        onClick={onRemove}
        className="flex size-4 items-center justify-center rounded-sm text-ink-faint outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover"
      >
        <Icon name="close" size="xs" />
      </button>
    </span>
  );
}
