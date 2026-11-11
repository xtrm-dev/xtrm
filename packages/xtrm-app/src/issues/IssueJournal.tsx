import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { IssueDetail, JournalEntry, JournalIdentity } from "../adapters/index.tsx";
import { Icon } from "../ui/icon.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { MarkdownEditor } from "../ui/markdown-editor.tsx";
import { LinkEvents } from "./PullRequestsBlock.tsx";
import { ago, cx } from "../ui/primitives.tsx";

const NOTE_KINDS = ["note", "finding", "decision", "blocker", "milestone", "handoff", "result"] as const;
const CHECKPOINT_KINDS = new Set(["checkpoint", "compaction"]);
export const JOURNAL_PAGE = 50;

const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

export const journalAnchor = (sequence: number) => `journal-entry-${sequence}`;

export function Timestamp({ at, className }: { at: number | null; className?: string }) {
  if (at == null) return <span className={cx("text-ink-faint", className)}>—</span>;
  return (
    <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()} className={cx("tabular", className)}>
      {ago(at)}
    </time>
  );
}

/** Verbatim identifier, truncated, copied on click. */
export function IdValue({ label, value, className }: { label: string; value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`${label}: ${value} — click to copy`}
      aria-label={`Copy ${label} ${value}`}
      onClick={() => {
        copy(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={cx("inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm font-mono text-xs text-ink-muted outline-none hover:text-ink focus-visible:text-ink", className)}
    >
      <span className="truncate">{value}</span>
      <Icon name={copied ? "check" : "copy"} size="xs" className="shrink-0 opacity-60" />
    </button>
  );
}

const IDENTITY_FIELDS: Array<[keyof JournalIdentity, string]> = [
  ["participantId", "participant"],
  ["sessionId", "session"],
  ["activationId", "activation"],
  ["runId", "run"],
];

export function IdentityLine({ identity }: { identity: JournalIdentity }) {
  const present = IDENTITY_FIELDS.filter(([key]) => identity[key]);
  if (!present.length) return <span className="text-xs text-ink-faint">No recorded identity</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
      {present.map(([key, label]) => (
        <span key={key} className="flex min-w-0 items-center gap-1 text-xs">
          <span className="shrink-0 text-ink-faint">{label}</span>
          <IdValue label={label} value={identity[key]!} className="max-w-[16rem]" />
        </span>
      ))}
    </span>
  );
}

/** Collapsible structured block; values stay verbatim. */
export function DataBlock({ title, data }: { title: string; data: Record<string, unknown> }) {
  return (
    <details className="group rounded-md border border-border-muted">
      <summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 px-2 text-xs text-ink-muted outline-none select-none hover:text-ink focus-visible:text-ink">
        <Icon name="forward" size="xs" className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        {title}
        <span className="text-ink-faint tabular">{Object.keys(data).length} fields</span>
      </summary>
      <dl className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-border-muted px-3 py-2 text-xs">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-faint">{k}</dt>
            <dd className="min-w-0 break-words text-ink">{renderValue(v)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function renderValue(v: unknown): ReactNode {
  if (v == null) return <span className="text-ink-faint">null</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="text-ink-faint">empty</span>;
    if (v.every((x) => typeof x !== "object" || x === null))
      return (
        <ul className="flex flex-col gap-0.5">
          {v.map((x, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-faint" />
              <span className="min-w-0">{String(x)}</span>
            </li>
          ))}
        </ul>
      );
  }
  if (typeof v === "object") return <pre className="thin-scrollbar max-h-60 overflow-auto font-mono whitespace-pre-wrap">{JSON.stringify(v, null, 2)}</pre>;
  return typeof v === "string" && v.length > 80 ? <span className="whitespace-pre-wrap">{v}</span> : String(v);
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

function JournalItem({ entry, highlighted }: { entry: JournalEntry; highlighted: boolean }) {
  const checkpoint = CHECKPOINT_KINDS.has(entry.kind);
  const { summary: _s, ...resultRest } = entry.result ?? {};
  return (
    <li id={journalAnchor(entry.sequence)} data-testid="journal-entry" data-kind={entry.kind} className="relative flex scroll-mt-4 gap-3 pb-5 last:pb-0">
      <span aria-hidden className="absolute top-5 bottom-0 left-[5px] w-px bg-border-muted" />
      <span className={cx("mt-1.5 size-[11px] shrink-0 rounded-full border", checkpoint ? "border-accent bg-accent" : "border-border-strong bg-surface")} />
      <div className={cx("-mx-2 flex min-w-0 flex-1 flex-col gap-1.5 rounded-md px-2 transition-colors motion-reduce:transition-none", highlighted && "bg-hover")}>
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <span className={cx("rounded-sm px-1.5 py-px", checkpoint ? "bg-accent/15 text-accent-ink" : "bg-control text-ink-muted")}>{entry.kind}</span>
          <span className="tabular">#{entry.sequence}</span>
          <span className="tabular">rev {entry.revision}</span>
          <Timestamp at={entry.createdAt} className="ml-auto" />
        </div>
        <IdentityLine identity={entry.identity} />
        {entry.summary ? <JournalBody text={entry.summary} /> : <span className="text-sm text-ink-faint">No summary recorded</span>}
        {(entry.result || entry.semantic || entry.mechanical || entry.executionContext) && (
          <div className="flex flex-col gap-1">
            {entry.result && Object.keys(resultRest).length > 0 && <DataBlock title="Result" data={resultRest} />}
            {entry.semantic && <DataBlock title="Checkpoint" data={entry.semantic} />}
            {entry.mechanical && <DataBlock title="Mechanical" data={entry.mechanical} />}
            {entry.executionContext && <DataBlock title="Execution context" data={entry.executionContext} />}
          </div>
        )}
      </div>
    </li>
  );
}

export function JournalTab({
  issue,
  canWrite,
  onAdd,
  focusSequence,
  onLoadOlder,
}: {
  issue: IssueDetail;
  canWrite: boolean;
  onAdd: (text: string, kind: string) => Promise<void>;
  /** Sequence to reveal and highlight (set by a provenance jump). */
  focusSequence: number | null;
  /** Fetch the page that ends before this sequence; omitted when the backend cannot page. */
  onLoadOlder?: (before: number) => Promise<JournalEntry[]>;
}) {
  const [composing, setComposing] = useState(false);
  const [kind, setKind] = useState<(typeof NOTE_KINDS)[number]>("note");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ponytail: paging, not virtualization; entries render lazily 50 at a time.
  const [visible, setVisible] = useState(JOURNAL_PAGE);
  const [older, setOlder] = useState<JournalEntry[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pagingError, setPagingError] = useState<string | null>(null);
  // Read pages arrive newest-first and are appended at the bottom, so loading
  // older entries never moves what the reader is looking at.
  const entries = useMemo(() => {
    const seen = new Set(issue.journal.map((j) => j.id));
    return [...issue.journal, ...older.filter((o) => !seen.has(o.id))].sort((a, b) => b.sequence - a.sequence);
  }, [issue.journal, older]);
  const oldest = entries.length > 0 ? entries[entries.length - 1]!.sequence : 0;
  const missing = Math.max(0, issue.journalTotal - entries.length);
  // A newest-first page starts above sequence 1 whenever the journal is bigger
  // than one page; an ascending read starts exactly at 1. That is the only
  // observable difference, and it decides whether paging can continue.
  const legacyRead = missing > 0 && oldest === 1;
  const index = focusSequence == null ? -1 : entries.findIndex((j) => j.sequence === focusSequence);
  const shown = Math.max(visible, index + 1);

  const loadOlder = () => {
    if (!onLoadOlder || loadingOlder) return;
    setLoadingOlder(true);
    setPagingError(null);
    onLoadOlder(oldest)
      .then((page) => setOlder((prev) => [...prev, ...page]))
      .catch((e: unknown) => setPagingError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingOlder(false));
  };

  useEffect(() => {
    if (index < 0) return;
    document.getElementById(journalAnchor(focusSequence!))?.scrollIntoView({ block: "center" });
  }, [index, focusSequence]);

  return (
    <div className="flex flex-col gap-4">
      <LinkEvents events={issue.linkEvents} />
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
      {issue.journalError ? (
        <p role="status" className="text-sm text-danger">
          Could not read the journal: {issue.journalError}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-ink-faint">No journal entries yet.</p>
      ) : (
        <>
          <ol className="flex flex-col">
            {entries.slice(0, shown).map((j) => (
              <JournalItem key={j.id} entry={j} highlighted={j.sequence === focusSequence} />
            ))}
          </ol>
          <div className="flex items-center gap-3 text-xs text-ink-faint">
            <span className="tabular">
              Showing {Math.min(shown, entries.length)} of {issue.journalTotal} entries
            </span>
            {shown < entries.length && (
              <button type="button" onClick={() => setVisible(shown + JOURNAL_PAGE)} className="rounded-sm text-ink-muted outline-none hover:text-ink focus-visible:text-ink">
                Show {Math.min(JOURNAL_PAGE, entries.length - shown)} older
              </button>
            )}
            {missing > 0 && !legacyRead && onLoadOlder && (
              <button type="button" onClick={loadOlder} disabled={loadingOlder} className="rounded-sm text-ink-muted outline-none hover:text-ink focus-visible:text-ink disabled:text-ink-faint">
                {loadingOlder ? "Loading older entries…" : `Load ${Math.min(JOURNAL_PAGE * 4, missing)} older`}
              </button>
            )}
            {legacyRead && <span>Unread entries 1–{entries.length} of {issue.journalTotal}; paging needs substrate 0.3.1 or newer.</span>}
            {pagingError && <span role="alert" className="text-danger">could not load older entries: {pagingError}</span>}
          </div>
        </>
      )}
    </div>
  );
}
