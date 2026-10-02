import type { AgentRef } from "../adapters/index.tsx";
import { ReferenceChip } from "../refs/references.tsx";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { cx } from "../ui/primitives.tsx";
import { REF_ICON, REF_LABEL } from "./meta.tsx";
import { formatAgentRef } from "./workspace.tsx";

const shortRef = (r: AgentRef) => (r.kind === "file" ? r.ref.split("/").pop()! : r.ref);

/**
 * One chip for every typed reference. Substrate and GitHub kinds reuse the Console chip
 * (status-aware, opens its drawer); host kinds (commit, file, session) open their drawer panels.
 */
export function AgentRefChip({ reference, onRemove, className }: { reference: AgentRef; onRemove?: () => void; className?: string }) {
  const shell = useShell();
  const body =
    reference.kind === "issue" || reference.kind === "pr" || reference.kind === "gh-issue" ? (
      <ReferenceChip reference={{ kind: reference.kind, ref: reference.ref }} />
    ) : (
      <button
        type="button"
        data-reference={formatAgentRef(reference)}
        aria-label={`${REF_LABEL[reference.kind]} ${reference.ref}`}
        title={reference.ref}
        onClick={(e) => {
          e.stopPropagation();
          shell.inspect({ kind: reference.kind, ref: reference.ref });
        }}
        className="inline-flex max-w-56 min-w-0 items-center gap-1.5 rounded-sm px-1 leading-5 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-1 focus-visible:ring-accent/40"
      >
        <Icon name={REF_ICON[reference.kind]} size="xs" className="shrink-0 text-ink-faint" />
        <span className="truncate font-mono text-xs text-accent-ink">{shortRef(reference)}</span>
      </button>
    );
  if (!onRemove) return <span className={cx("inline-flex min-w-0", className)}>{body}</span>;
  return (
    <span className={cx("group/chip inline-flex min-w-0 items-center rounded-md border border-border-muted bg-surface pr-0.5", className)} data-testid="composer-ref">
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
