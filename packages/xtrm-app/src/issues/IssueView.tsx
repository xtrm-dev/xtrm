import { Dialog } from "@base-ui/react/dialog";
import { useMemo, useState, type ReactNode } from "react";
import type { IssueDetail, IssueLink } from "../adapters/index.tsx";
import { planNormalization, type NormalizationPlan } from "../adapters/substrate/contract.ts";
import { FieldLabel, InlineTitle, ListField, ProseField, SelectField } from "../ui/fields.tsx";
import { Icon } from "../ui/icon.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { EditActions, MarkdownEditor } from "../ui/markdown-editor.tsx";
import { Row, StatusDot, ago, cx } from "../ui/primitives.tsx";
import { useIssueActions } from "./actions.ts";
import {
  LIFECYCLES,
  TERMINAL,
  formatDate,
  kindIcon,
  lifecycleLabel,
  lifecycleOptions,
  lifecycleTone,
  priorityOptions,
  readinessLabel,
  scrutinyOptions,
} from "./meta.tsx";

type Variant = "page" | "panel";

interface Nav {
  /** Inspect a related issue (drawer traversal or page navigation, decided by the host). */
  onOpenIssue: (ref: string) => void;
}

export function IssueView({ issue, canWrite, variant, nav }: { issue: IssueDetail; canWrite: boolean; variant: Variant; nav: Nav }) {
  const actions = useIssueActions(issue);
  const [tab, setTab] = useState<"activity" | "lineage" | "provenance">("activity");
  const plan = useMemo(() => planNormalization(issue.contract), [issue.contract]);
  const c = issue.contract;

  const main = (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <IssueBreadcrumb issue={issue} nav={nav} />
        <InlineTitle value={issue.title} canEdit={canWrite} onSave={actions.setTitle} className={variant === "page" ? "text-xl leading-snug font-semibold" : "text-base leading-snug font-semibold"} />
      </div>

      {variant === "panel" && <DetailsGrid issue={issue} canWrite={canWrite} nav={nav} compact />}

      {plan && <NormalizeBanner plan={plan} issue={issue} canWrite={canWrite} onApply={() => actions.patchContract(plan.patch)} />}

      <ProseField label="Problem" value={c.problem} canEdit={canWrite} placeholder="Describe the problem this work solves" onSave={(problem) => actions.patchContract({ problem })} />
      <ProseField label="Success" value={c.success} canEdit={canWrite} placeholder="Describe the observable outcome" onSave={(success) => actions.patchContract({ success })} />
      <ListField label="Scope" items={c.scope} canEdit={canWrite} placeholder="Add scope" onSave={(scope) => actions.patchContract({ scope })} />
      <ListField label="Non-goals" items={c.nonGoals} canEdit={canWrite} placeholder="Add a non-goal" onSave={(nonGoals) => actions.patchContract({ nonGoals })} />
      <ListField label="Constraints" items={c.constraints} canEdit={canWrite} placeholder="Add a constraint" onSave={(constraints) => actions.patchContract({ constraints })} />
      <ListField label="Validation" numbered items={c.validation.map((v) => v.text)} canEdit={canWrite} placeholder="Add a validation check" onSave={(validation) => actions.patchContract({ validation })} />
      <ListField label="Output" items={c.output.map((o) => o.text)} canEdit={canWrite} placeholder="Add an expected artifact" onSave={(output) => actions.patchContract({ output })} />
      <ListField label="References" items={c.references} canEdit={canWrite} placeholder="Add a reference" onSave={(references) => actions.patchContract({ references })} />

      <section className="flex flex-col gap-3 border-t border-border-muted pt-4">
        <div role="tablist" aria-label="Issue activity" className="flex items-center gap-1">
          {(
            [
              ["activity", "Activity", issue.journal.length],
              ["lineage", "Lineage", issue.children.length + issue.blockers.length + (issue.parent ? 1 : 0)],
              ["provenance", "Provenance", issue.provenance.commits.length + issue.provenance.prs.length + issue.provenance.receipts],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cx("flex h-7 items-center gap-1.5 rounded-md px-2 text-sm outline-none focus-visible:bg-hover", tab === id ? "bg-hover text-ink" : "text-ink-faint hover:text-ink-muted")}
            >
              {label}
              {count > 0 && <span className="text-xs text-ink-faint tabular">{count}</span>}
            </button>
          ))}
        </div>
        {tab === "activity" && <ActivityTab issue={issue} canWrite={canWrite} onAdd={actions.addNote} />}
        {tab === "lineage" && <LineageTab issue={issue} nav={nav} />}
        {tab === "provenance" && <ProvenanceTab issue={issue} />}
      </section>
    </div>
  );

  if (variant === "panel") return <div className="px-5 pt-4 pb-8">{main}</div>;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-10 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      {main}
      <aside aria-label="Details" className="lg:sticky lg:top-4 lg:self-start">
        <DetailsGrid issue={issue} canWrite={canWrite} nav={nav} />
      </aside>
    </div>
  );
}

function IssueBreadcrumb({ issue, nav }: { issue: IssueDetail; nav: Nav }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
      {issue.parent && (
        <>
          <button type="button" onClick={() => nav.onOpenIssue(issue.parent!.ref)} className="flex min-w-0 items-center gap-1 rounded-sm outline-none hover:text-ink-muted focus-visible:text-ink">
            <Icon name={kindIcon(issue.parent.kind ?? "epic")} size="xs" />
            <span className="font-mono">{issue.parent.ref}</span>
          </button>
          <span>/</span>
        </>
      )}
      <Icon name={kindIcon(issue.kind)} size="xs" />
      <span className="font-mono text-ink-muted">{issue.ref}</span>
      <span>·</span>
      <span>{issue.kind}</span>
      <span className="ml-auto tabular">rev {issue.revision}</span>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-7 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3">
      <span className="text-sm text-ink-faint">{label}</span>
      <div className="min-w-0 text-sm text-ink">{children}</div>
    </div>
  );
}

function IssueChip({ link, nav }: { link: IssueLink; nav: Nav }) {
  return (
    <button type="button" onClick={() => nav.onOpenIssue(link.ref)} className="-mx-1 flex max-w-full min-w-0 items-center gap-1.5 rounded-sm px-1 text-left outline-none hover:bg-hover focus-visible:bg-hover">
      <StatusDot tone={lifecycleTone(link.lifecycle)} label={lifecycleLabel(link.lifecycle)} />
      <span className="shrink-0 font-mono text-xs text-ink-muted">{link.ref}</span>
      <span className="truncate text-ink">{link.title}</span>
    </button>
  );
}

function DetailsGrid({ issue, canWrite, nav, compact }: { issue: IssueDetail; canWrite: boolean; nav: Nav; compact?: boolean }) {
  const actions = useIssueActions(issue);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const progress = issue.release ?? (issue.childCount ? { childrenDone: issue.childrenDone, childrenTotal: issue.childCount } : null);
  return (
    <div className={cx("flex flex-col gap-1", !compact && "rounded-lg border border-border-muted p-4")}>
      {!compact && <FieldLabel>Details</FieldLabel>}
      <Detail label="Status">
        <SelectField label="Status" value={LIFECYCLES.some((l) => l.value === issue.lifecycle) ? (issue.lifecycle as (typeof LIFECYCLES)[number]["value"]) : null} options={lifecycleOptions} canEdit={canWrite} onChange={actions.setLifecycle} />
      </Detail>
      <Detail label="Readiness">
        <button type="button" disabled={!issue.reasons.length} onClick={() => setReasonsOpen((v) => !v)} className="-mx-2 flex h-7 items-center gap-2 rounded-md px-2 outline-none enabled:hover:bg-hover focus-visible:bg-hover">
          <StatusDot tone={issue.dispatchable ? "accent" : TERMINAL.has(issue.lifecycle) ? "done" : "neutral"} label={issue.readinessState} />
          <span className={issue.dispatchable ? "text-accent-ink" : "text-ink"}>{readinessLabel(issue.readinessState)}</span>
          {issue.reasons.length > 0 && <span className="text-xs text-ink-faint">{issue.reasons.length} {issue.reasons.length === 1 ? "gap" : "gaps"}</span>}
        </button>
      </Detail>
      {reasonsOpen && (
        <ul className="mb-1 ml-[7.25rem] flex flex-col gap-1 text-xs text-ink-muted">
          {issue.reasons.map((r) => (
            <li key={r} className="flex gap-1.5">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-faint" />
              {r}
            </li>
          ))}
        </ul>
      )}
      <Detail label="Priority">
        <SelectField label="Priority" value={issue.priority} options={priorityOptions} canEdit={canWrite && issue.priority !== null} onChange={actions.setPriority} empty="Not exposed" />
      </Detail>
      <Detail label="Scrutiny">
        <SelectField label="Scrutiny" value={(issue.scrutiny as "LOW" | null) ?? ((issue.contract.raw.scrutiny as "LOW" | undefined) ?? null)} options={scrutinyOptions} canEdit={canWrite} onChange={actions.setScrutiny} />
      </Detail>
      <Detail label="Parent">{issue.parent ? <IssueChip link={issue.parent} nav={nav} /> : <span className="text-ink-faint">None</span>}</Detail>
      {progress && (
        <Detail label="Children">
          <div className="flex items-center gap-2">
            <div className="h-1 w-20 overflow-hidden rounded-full bg-control">
              <div className="h-full bg-ink-muted" style={{ width: `${(progress.childrenDone / Math.max(1, progress.childrenTotal)) * 100}%` }} />
            </div>
            <span className="text-xs text-ink-muted tabular">
              {progress.childrenDone}/{progress.childrenTotal} done
            </span>
          </div>
        </Detail>
      )}
      {issue.blockers.length > 0 && (
        <Detail label="Blocked by">
          <div className="flex flex-col">
            {issue.blockers.map((b) => (
              <IssueChip key={b.ref} link={b} nav={nav} />
            ))}
          </div>
        </Detail>
      )}
      <Detail label="Claim">{issue.claim ? `${issue.claim.holder}` : <span className="text-ink-faint">Unclaimed</span>}</Detail>
      {!compact && (
        <>
          <Detail label="Created">{formatDate(issue.createdAt)}</Detail>
          <Detail label="Updated">{issue.updatedAt ? ago(issue.updatedAt) : "—"}</Detail>
          {issue.closure.closed && <Detail label="Closure">{issue.closure.reason ?? "closed"}</Detail>}
        </>
      )}
      {!canWrite && <p className="mt-2 text-xs text-ink-faint">Read-only: Substrate writes are disabled for this source.</p>}
    </div>
  );
}

function NormalizeBanner({ plan, issue, canWrite, onApply }: { plan: NormalizationPlan; issue: IssueDetail; canWrite: boolean; onApply: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const FIELD_LABEL: Record<string, string> = { success: "Success", scope: "Scope", nonGoals: "Non-goals", constraints: "Constraints", validation: "Validation", output: "Output", references: "References" };
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border-muted bg-deep/50 px-4 py-3">
      <Icon name="alert" size="sm" className="mt-0.5 shrink-0 text-ink-faint" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm text-ink">This contract was imported with its sections inside Problem.</p>
        <p className="text-xs text-ink-muted">{plan.mapped.length} sections can move into typed fields: {plan.mapped.map((m) => FIELD_LABEL[m.field]).join(", ")}.</p>
      </div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className="h-7 shrink-0 rounded-md border border-border px-2.5 text-sm text-ink outline-none hover:bg-hover focus-visible:bg-hover">Review mapping</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30" />
          <Dialog.Popup className="thin-scrollbar fixed top-[8vh] left-1/2 z-50 flex max-h-[84vh] w-[min(760px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-raised shadow-float outline-none">
            <div className="flex h-12 shrink-0 items-center border-b border-border-muted px-5">
              <Dialog.Title className="text-base font-medium text-ink">Normalize {issue.ref} contract</Dialog.Title>
            </div>
            <div className="thin-scrollbar flex flex-col gap-5 overflow-y-auto px-5 py-4">
              <Dialog.Description className="text-sm text-ink-muted">
                Saving writes one new contract revision. Sections move only into fields that are empty or still carry the import placeholder; readiness is re-evaluated by Substrate.
              </Dialog.Description>
              <div className="flex flex-col gap-1">
                {plan.mapped.map((m) => (
                  <div key={m.heading} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-ink-faint">## {m.heading}</span>
                    <Icon name="forward" size="xs" className="text-ink-faint" />
                    <span className="text-ink">{FIELD_LABEL[m.field]}</span>
                    <span className="text-xs text-ink-faint">{m.field === "success" ? "prose" : `${m.items} items`}</span>
                  </div>
                ))}
              </div>
              <PreviewBlock title="Problem after normalization" markdown={plan.patch.problem ?? ""} />
              {plan.patch.success && <PreviewBlock title="Success" markdown={plan.patch.success} />}
              {(["scope", "nonGoals", "constraints", "validation", "output", "references"] as const).map((f) =>
                plan.patch[f]?.length ? <PreviewBlock key={f} title={FIELD_LABEL[f]!} markdown={plan.patch[f]!.map((x) => `- ${x.replace(/\n/g, "\n  ")}`).join("\n")} /> : null,
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-border-muted px-5 py-3">
              {canWrite ? (
                <EditActions
                  saving={saving}
                  error={error}
                  onCancel={() => setOpen(false)}
                  onSave={() => {
                    setSaving(true);
                    setError(null);
                    onApply()
                      .then(() => setOpen(false))
                      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                      .finally(() => setSaving(false));
                  }}
                />
              ) : (
                <span className="text-sm text-ink-faint">Writes are disabled for this source.</span>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function PreviewBlock({ title, markdown }: { title: string; markdown: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-faint">{title}</span>
      <div className="thin-scrollbar max-h-56 overflow-y-auto rounded-md border border-border-muted px-3 py-2">
        <Markdown>{markdown}</Markdown>
      </div>
    </div>
  );
}

const NOTE_KINDS = ["note", "finding", "decision", "blocker", "milestone", "handoff", "result"] as const;

function ActivityTab({ issue, canWrite, onAdd }: { issue: IssueDetail; canWrite: boolean; onAdd: (text: string, kind: string) => Promise<void> }) {
  const [composing, setComposing] = useState(false);
  const [kind, setKind] = useState<(typeof NOTE_KINDS)[number]>("note");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {canWrite &&
        (composing ? (
          <div className="flex flex-col gap-2">
            <div role="radiogroup" aria-label="Journal entry kind" className="flex flex-wrap items-center gap-1">
              {NOTE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={cx("h-6 rounded-sm px-2 text-xs outline-none", kind === k ? "bg-hover text-ink" : "text-ink-faint hover:text-ink-muted")}
                >
                  {k}
                </button>
              ))}
            </div>
            <MarkdownEditor
              value=""
              placeholder="Add a journal entry…"
              saving={saving}
              error={error}
              onCancel={() => setComposing(false)}
              onSave={(text) => {
                if (!text.trim()) return setComposing(false);
                setSaving(true);
                setError(null);
                onAdd(text, kind)
                  .then(() => setComposing(false))
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSaving(false));
              }}
            />
          </div>
        ) : (
          <button type="button" onClick={() => setComposing(true)} className="flex h-9 items-center rounded-md border border-border-muted px-3 text-left text-sm text-ink-faint outline-none hover:border-border hover:text-ink-muted focus-visible:border-border-strong">
            Add a journal entry…
          </button>
        ))}
      {issue.journal.length === 0 ? (
        <p className="text-sm text-ink-faint">No journal entries yet.</p>
      ) : (
        <ol className="flex flex-col">
          {issue.journal.map((j) => (
            <li key={j.id} className="relative flex gap-3 pb-5 last:pb-0">
              <span aria-hidden className="absolute top-5 bottom-0 left-[5px] w-px bg-border-muted" />
              <span className="mt-1.5 size-[11px] shrink-0 rounded-full border border-border-strong bg-surface" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2 text-xs text-ink-faint">
                  <span className="rounded-sm bg-control px-1.5 py-px text-ink-muted">{j.kind}</span>
                  <span>#{j.sequence}</span>
                  <span>rev {j.revision}</span>
                  <span className="ml-auto" title={new Date(j.createdAt).toLocaleString()}>
                    {ago(j.createdAt)}
                  </span>
                </div>
                {j.summary ? <JournalBody text={j.summary} /> : <span className="text-sm text-ink-faint">No summary</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function JournalBody({ text }: { text: string }) {
  const long = text.length > 700;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-1">
      <div className={cx("relative w-full", long && !open && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}>
        <Markdown>{text}</Markdown>
      </div>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-sm text-xs text-ink-muted outline-none hover:text-ink focus-visible:text-ink">
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function LineageTab({ issue, nav }: { issue: IssueDetail; nav: Nav }) {
  const groups: Array<[string, IssueLink[]]> = [
    ["Parent", issue.parent ? [issue.parent] : []],
    ["Blocked by", issue.blockers],
    ["Children", issue.children],
  ];
  if (groups.every(([, items]) => items.length === 0)) return <p className="text-sm text-ink-faint">No parent, children, or blockers.</p>;
  return (
    <div className="flex flex-col gap-4">
      {groups.map(([title, items]) =>
        items.length ? (
          <div key={title} className="flex flex-col">
            <span className="mb-1 text-xs font-medium text-ink-faint">
              {title} <span className="tabular">{items.length}</span>
            </span>
            {items.map((l) => (
              <Row key={l.ref} density="sidebar" onActivate={() => nav.onOpenIssue(l.ref)}>
                <StatusDot tone={lifecycleTone(l.lifecycle)} label={lifecycleLabel(l.lifecycle)} />
                <span className="w-24 shrink-0 font-mono text-xs text-ink-muted">{l.ref}</span>
                <span className={cx("min-w-0 flex-1 truncate", TERMINAL.has(l.lifecycle) ? "text-ink-muted" : "text-ink")}>{l.title}</span>
                <span className="text-xs text-ink-faint">{lifecycleLabel(l.lifecycle)}</span>
              </Row>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}

function ProvenanceTab({ issue }: { issue: IssueDetail }) {
  const p = issue.provenance;
  return (
    <div className="flex flex-col gap-1">
      <Detail label="Attestation">{p.attestation ? `${p.attestation.outcome} · ${p.attestation.policy} · ${p.attestation.attestedBy}` : <span className="text-ink-faint">None</span>}</Detail>
      <Detail label="Claims">{p.claims}</Detail>
      <Detail label="Bindings">{p.bindings}</Detail>
      <Detail label="Receipts">{p.receipts}</Detail>
      <Detail label="Commits">{p.commits.length ? <span className="font-mono text-xs">{p.commits.map((s) => s.slice(0, 10)).join(", ")}</span> : <span className="text-ink-faint">None</span>}</Detail>
      <Detail label="Pull requests">{p.prs.length ? p.prs.join(", ") : <span className="text-ink-faint">None</span>}</Detail>
    </div>
  );
}
