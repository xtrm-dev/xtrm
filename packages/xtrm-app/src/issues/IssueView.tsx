import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import { Card } from "../ui/card.tsx";
import { Dialog, DialogFrame } from "../ui/dialog.tsx";
import { Fields, PART_LABEL_COLUMN } from "../ui/drawer.tsx";
import { SectionHeader } from "../ui/section.tsx";
import { ToolbarButton, ToolbarTabs } from "../ui/toolbar.tsx";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { IssueDetail, IssueLink } from "../adapters/index.tsx";
import { planNormalization, type NormalizationPlan } from "../adapters/substrate/contract.ts";
import { FieldLabel, InlineTitle, ListField, ProseField, SelectField } from "../ui/fields.tsx";
import { Icon } from "../ui/icon.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { EditActions } from "../ui/markdown-editor.tsx";
import { Row, StatusDot, ago, cx } from "../ui/primitives.tsx";
import { JournalTab } from "./IssueJournal.tsx";
import { PullRequestsBlock } from "./PullRequestsBlock.tsx";
import { ClosureCard, ProvenanceTab } from "./IssueProvenance.tsx";
import { useIssueActions } from "./actions.ts";
import { useAdapters } from "../adapters/index.tsx";
import { useJiraBinding } from "../app/queries.ts";
import { JiraChip, useJiraIssueIndex } from "../project/jira/JiraChip.tsx";
import { useShell } from "../shell/context.tsx";
import {
  LIFECYCLES,
  TERMINAL,
  formatDate,
  kindIcon,
  lifecycleLabel,
  lifecycleOptions,
  lifecycleTone,
  priorityOptions,
  scrutinyOptions,
} from "./meta.tsx";
import { IssueKeyPill } from "../ui/issue-key-pill.tsx";
import { IssueStatusBadge } from "./IssueStatusBadge.tsx";
import { ReferenceActionsProvider, ReferenceChip, type ContextReference } from "../refs/references.tsx";

type Variant = "page" | "panel";

interface Nav {
  /** Inspect a related issue (drawer traversal or page navigation, decided by the host). */
  onOpenIssue: (ref: string) => void;
  /** Inspect a related pull request in the drawer (drawer-first: no PR page). */
  onOpenPull: (ref: string) => void;
}

export function IssueView({ issue, canWrite, variant, nav }: { issue: IssueDetail; canWrite: boolean; variant: Variant; nav: Nav }) {
  const actions = useIssueActions(issue);
  const { substrate } = useAdapters();
  const loadOlderJournal = useCallback((before: number) => substrate.readJournal(issue.ref, { before }), [substrate, issue.ref]);
  const [tab, setTab] = useState<Tab>("journal");
  const [focusSequence, setFocusSequence] = useState<number | null>(null);
  const plan = useMemo(() => planNormalization(issue.contract), [issue.contract]);
  const c = issue.contract;

  const main = (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <IssueBreadcrumb issue={issue} nav={nav} />
        {/* The status sits beside the title (2026-11-27 ruling): the same chip the list row shows, one
            size up, so the drawer and the board can never name a different state. */}
        <div className="flex min-w-0 items-baseline gap-2" data-testid="issue-title-row">
          <InlineTitle value={issue.title} canEdit={canWrite} onSave={actions.setTitle} className={cx("min-w-0 flex-1", variant === "page" ? "text-xl leading-snug font-semibold" : "text-base leading-snug font-semibold")} />
          <IssueStatusBadge issue={issue} size="sm" />
        </div>
        <IssueGaps issue={issue} />
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

      <PullRequestsBlock links={issue.pullRequests} gate={issue.linkGate} />

      <ClosureCard closure={issue.closure} issue={issue} />

      <section className="flex flex-col gap-3 border-t border-border-muted pt-4">
        <ToolbarTabs
          label="Issue activity"
          value={tab}
          onChange={(id) => {
            setTab(id as Tab);
            setFocusSequence(null);
          }}
          tabs={[
            { id: "journal", label: "Journal", count: issue.journalTotal || undefined },
            { id: "lineage", label: "Lineage", count: issue.children.length + issue.blockers.length + (issue.parent ? 1 : 0) || undefined },
            {
              id: "provenance",
              label: "Provenance",
              count:
                issue.provenance.claims.length +
                  issue.provenance.bindings.length +
                  issue.provenance.receipts.length +
                  issue.provenance.commits.length +
                  issue.provenance.prs.length || undefined,
            },
          ]}
        />
        {tab === "journal" && <JournalTab issue={issue} canWrite={canWrite} onAdd={actions.addNote} focusSequence={focusSequence} onLoadOlder={loadOlderJournal} />}
        {tab === "lineage" && <LineageTab issue={issue} nav={nav} />}
        {tab === "provenance" && (
          <ProvenanceTab
            issue={issue}
            onJumpToJournal={(sequence) => {
              setFocusSequence(sequence);
              setTab("journal");
            }}
          />
        )}
      </section>
    </div>
  );

  const body =
    variant === "panel" ? (
      <div className="px-5 pt-4 pb-8">{main}</div>
    ) : (
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {main}
        <aside aria-label="Details" className="lg:sticky lg:top-4 lg:self-start">
          <DetailsGrid issue={issue} canWrite={canWrite} nav={nav} />
        </aside>
      </div>
    );

  return (
    <ReferenceActionsProvider open={(r: ContextReference) => (r.kind === "pr" ? nav.onOpenPull(r.ref) : nav.onOpenIssue(r.ref))}>
      {body}
    </ReferenceActionsProvider>
  );
}

function IssueBreadcrumb({ issue, nav }: { issue: IssueDetail; nav: Nav }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
      <Breadcrumbs
        items={[
          ...(issue.parent
            ? [
                {
                  key: "parent",
                  icon: kindIcon(issue.parent.kind ?? "epic"),
                  label: <IssueKeyPill locator={issue.parent.locator} humanRef={issue.parent.ref} />,
                  title: issue.parent.locator ?? issue.parent.ref,
                  onClick: () => nav.onOpenIssue(issue.parent!.ref),
                },
              ]
            : []),
          { key: "self", icon: kindIcon(issue.kind), label: <IssueKeyPill locator={issue.locator} humanRef={issue.ref} /> },
        ]}
      />
      <span>·</span>
      <span>{issue.kind}</span>
      <span className="ml-auto tabular">rev {issue.revision}</span>
    </div>
  );
}

/** The three activity tabs; `ToolbarTabs` reports ids as plain strings. */
type Tab = "journal" | "lineage" | "provenance";

/**
 * The bound Jira issue for this Substrate issue (ADR-002 D6) as a `Fields` row: an unbound
 * repository yields no row at all, so a page never promises a Jira issue that does not exist.
 */
function useJiraRow(issueRef: string): [ReactNode, ReactNode] | null {
  const { repo } = useShell();
  const binding = useJiraBinding(repo.fullName);
  const bound = binding.data?.configured === true;
  const index = useJiraIssueIndex(repo.fullName, bound);
  const jira = index.byIssueRef.get(issueRef);
  if (!bound || jira === undefined) return null;
  return ["Jira", <JiraChip issue={jira} showStatusText />];
}

function IssueChip({ link }: { link: IssueLink }) {
  return <ReferenceChip reference={{ kind: "issue", ref: link.ref }} showTitle fallback={`${link.locator ?? link.ref} ${link.title}`} className="-mx-1" />;
}

/**
 * What keeps an open issue from dispatch, under the title. It replaces the Readiness row, which
 * repeated the status in Substrate's raw vocabulary and could disagree with the chip beside the title.
 */
function IssueGaps({ issue }: { issue: IssueDetail }) {
  const [open, setOpen] = useState(false);
  if (issue.reasons.length === 0 || TERMINAL.has(issue.lifecycle)) return null;
  const count = `${issue.reasons.length} ${issue.reasons.length === 1 ? "gap" : "gaps"} before dispatch`;
  return (
    <div className="flex flex-col gap-1" data-testid="issue-gaps">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="-mx-1 flex h-6 items-center gap-1 self-start rounded-md px-1 text-xs text-ink-faint outline-none hover:bg-hover hover:text-ink-muted focus-visible:bg-hover"
      >
        <Icon name={open ? "chevronDown" : "chevronRight"} size="micro" />
        {count}
      </button>
      {open && (
        <ul className="flex flex-col gap-1 text-xs text-ink-muted">
          {issue.reasons.map((r) => (
            <li key={r} className="flex gap-1.5">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-faint" />
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DetailsGrid({ issue, canWrite, nav, compact }: { issue: IssueDetail; canWrite: boolean; nav: Nav; compact?: boolean }) {
  const actions = useIssueActions(issue);
  const jira = useJiraRow(issue.ref);
  const progress = issue.release ?? (issue.childCount ? { childrenDone: issue.childrenDone, childrenTotal: issue.childCount } : null);
  const rows: Array<[ReactNode, ReactNode]> = [
    [
      "Lifecycle",
      <SelectField
        label="Lifecycle"
        value={LIFECYCLES.some((l) => l.value === issue.lifecycle) ? (issue.lifecycle as (typeof LIFECYCLES)[number]["value"]) : null}
        options={lifecycleOptions}
        canEdit={canWrite}
        onChange={actions.setLifecycle}
      />,
    ],
    [
      "Priority",
      <SelectField label="Priority" value={issue.priority} options={priorityOptions} canEdit={canWrite && issue.priority !== null} onChange={actions.setPriority} empty="Not exposed" />,
    ],
    [
      "Scrutiny",
      <SelectField
        label="Scrutiny"
        value={(issue.scrutiny as "LOW" | null) ?? ((issue.contract.raw.scrutiny as "LOW" | undefined) ?? null)}
        options={scrutinyOptions}
        canEdit={canWrite}
        onChange={actions.setScrutiny}
      />,
    ],
    ["Parent", issue.parent ? <IssueChip link={issue.parent} /> : <span className="text-ink-faint">None</span>],
    ...(jira ? [jira] : []),
    ...(progress
      ? [
          [
            "Children" as ReactNode,
            <div className="flex items-center gap-2">
              <div className="h-1 w-20 overflow-hidden rounded-full bg-control">
                <div className="h-full bg-ink-muted" style={{ width: `${(progress.childrenDone / Math.max(1, progress.childrenTotal)) * 100}%` }} />
              </div>
              <span className="text-xs text-ink-muted tabular">
                {progress.childrenDone}/{progress.childrenTotal} done
              </span>
            </div>,
          ] as [ReactNode, ReactNode],
        ]
      : []),
    ...(issue.blockers.length > 0
      ? [
          [
            "Blocked by" as ReactNode,
            <div className="flex flex-col">
              {issue.blockers.map((b) => (
                <IssueChip key={b.ref} link={b} />
              ))}
            </div>,
          ] as [ReactNode, ReactNode],
        ]
      : []),
    ["Claim", issue.claim ? `${issue.claim.holder}` : <span className="text-ink-faint">Unclaimed</span>],
    ...(compact
      ? []
      : ([
          ["Created", formatDate(issue.createdAt)],
          ["Updated", issue.updatedAt ? ago(issue.updatedAt) : "—"],
          ...(issue.closure.closed ? [["Closed", issue.closure.closedAt ? ago(issue.closure.closedAt) : (issue.closure.outcome ?? "closed")]] : []),
        ] as Array<[ReactNode, ReactNode]>)),
  ];
  // The page's details block is a card like every other record box (XTRM-989). The drawer's
  // `compact` mode is not a card: the drawer section owns the frame there, so it keeps the bare
  // stack it had.
  const body = (
    <>
      {!compact && <FieldLabel>Details</FieldLabel>}
      <Fields labelWidth={PART_LABEL_COLUMN} rows={rows} />
      {!canWrite && <p className="mt-2 text-xs text-ink-faint">Read-only: Substrate writes are disabled for this source.</p>}
    </>
  );
  return compact ? <div className="flex flex-col gap-1">{body}</div> : <Card data-testid="details-card">{body}</Card>;
}

function NormalizeBanner({ plan, issue, canWrite, onApply }: { plan: NormalizationPlan; issue: IssueDetail; canWrite: boolean; onApply: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const FIELD_LABEL: Record<string, string> = { success: "Success", scope: "Scope", nonGoals: "Non-goals", constraints: "Constraints", validation: "Validation", output: "Output", references: "References" };
  return (
    <div className="flex items-start gap-3 border-l border-border-strong pl-3">
      <Icon name="alert" size="sm" className="mt-0.5 shrink-0 text-ink-faint" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm text-ink">This contract was imported with its sections inside Problem.</p>
        <p className="text-xs text-ink-muted">{plan.mapped.length} sections can move into typed fields: {plan.mapped.map((m) => FIELD_LABEL[m.field]).join(", ")}.</p>
      </div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className="h-7 shrink-0 rounded-md border border-border px-2.5 text-sm text-ink outline-none hover:bg-hover focus-visible:bg-hover">Review mapping</Dialog.Trigger>
        <Dialog.Portal>
          <DialogFrame title={`Normalize ${issue.ref} contract`} frameWidth={760} top={8} maxHeight={84}>
            <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
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
            <DialogFrame.Footer>
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
            </DialogFrame.Footer>
          </DialogFrame>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function PreviewBlock({ title, markdown }: { title: string; markdown: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* The dialog title is the h2, so a preview inside its body is an h3 (XTRM-987). */}
      <SectionHeader title={title} inset="none" level={3} />
      <div className="thin-scrollbar max-h-56 overflow-y-auto rounded-md border border-border-muted px-3 py-2">
        <Markdown>{markdown}</Markdown>
      </div>
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
            <SectionHeader title={title} count={items.length} inset="none" level={4} />
            {items.map((l) => (
              <Row key={l.ref} density="sidebar" onActivate={() => nav.onOpenIssue(l.ref)}>
                <StatusDot tone={lifecycleTone(l.lifecycle)} label={lifecycleLabel(l.lifecycle)} />
                <IssueKeyPill locator={l.locator} humanRef={l.ref} className="shrink-0" />
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
