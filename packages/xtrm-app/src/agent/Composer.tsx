import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { blockReason } from "../adapters/agent/references.ts";
import { BusyError, type AgentRef, type AgentSessionDetail, type RefCandidate } from "../adapters/agent/types.ts";
import { Icon } from "../ui/icon.tsx";
import { Kbd, cx } from "../ui/primitives.tsx";
import { AgentRefChip } from "./RefChip.tsx";
import { REF_ICON } from "./meta.tsx";
import { useAbort, useReferenceCandidates, useResolveForSubmit, useSubmit, type PickerKind } from "./queries.ts";
import { activeMention, formatAgentRef, parseRefTokens, useAgentStore, useAgentStoreVersion } from "./workspace.tsx";

const TABS: Array<[PickerKind, string]> = [
  ["all", "All"],
  ["session", "Sessions"],
  ["issue", "Issues"],
  ["pr", "PRs"],
  ["file", "Files"],
  ["commit", "Commits"],
  ["gh-issue", "GitHub"],
];

const sameRef = (a: AgentRef, b: AgentRef) => a.kind === b.kind && a.ref === b.ref;

function Picker({
  items,
  active,
  kind,
  onKind,
  onPick,
  onHover,
}: {
  items: RefCandidate[];
  active: number;
  kind: PickerKind;
  onKind: (k: PickerKind) => void;
  onPick: (c: RefCandidate) => void;
  onHover: (i: number) => void;
}) {
  return (
    <div className="absolute right-0 bottom-full left-0 z-30 mb-2 overflow-hidden rounded-lg bg-raised shadow-float" data-testid="reference-picker">
      <div className="flex gap-0.5 border-b border-border-muted px-1.5 py-1" role="tablist" aria-label="Reference kind">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onKind(k)}
            className={cx("rounded px-1.5 py-0.5 text-xs outline-none", kind === k ? "bg-hover text-ink" : "text-ink-faint hover:text-ink-muted")}
          >
            {label}
          </button>
        ))}
      </div>
      <ul role="listbox" aria-label="References" className="thin-scrollbar max-h-72 overflow-y-auto p-1">
        {items.length === 0 && <li className="px-2 py-2 text-xs text-ink-faint">No matching reference.</li>}
        {items.map((c, i) => (
          <li
            key={`${c.kind}:${c.ref}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(c)}
            className={cx("flex h-8 cursor-default items-center gap-2 rounded-md px-2", i === active && "bg-hover")}
          >
            <Icon name={REF_ICON[c.kind]} size="xs" className="shrink-0 text-ink-faint" />
            <span className="max-w-40 shrink-0 truncate font-mono text-xs text-accent-ink">{c.kind === "file" ? c.ref.split("/").pop() : c.ref}</span>
            <span className="truncate text-sm text-ink">{c.title}</span>
            {c.detail && <span className="ml-auto shrink-0 pl-2 text-xs text-ink-faint">{c.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Composer({ session }: { session: AgentSessionDetail }) {
  const store = useAgentStore();
  useAgentStoreVersion();
  const refs = store.view(session.id).refs;
  const [text, setText] = useState(() => store.view(session.id).draft);
  const [caret, setCaret] = useState(text.length);
  const [kindOverride, setKindOverride] = useState<PickerKind | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"steer" | "follow-up">("steer");
  /** The host answered busy to a normal submit (PRD §35.8 item 5): offer Steer or Follow-up explicitly. */
  const [busy, setBusy] = useState(false);
  /** Unresolved references of the last attempt, by `@kind:ref`: marked on their chips (§36.6 rule 5). */
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const submit = useSubmit(session.id);
  const abort = useAbort(session.id);
  const resolveRefs = useResolveForSubmit(session.id);

  const working = session.state === "working" || session.state === "waiting";
  const mention = activeMention(text, caret);
  const pickerOpen = !!mention && dismissed !== mention.start;
  const kind: PickerKind = kindOverride ?? mention?.kind ?? "all";
  const candidates = useReferenceCandidates(mention?.query ?? "", kind, pickerOpen, session.id).filter((c) => !refs.some((r) => sameRef(r, c)));
  const index = Math.min(active, Math.max(0, candidates.length - 1));

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [text]);

  const update = (value: string, pos: number) => {
    setText(value);
    setCaret(pos);
    setError(null);
    setBusy(false);
    setActive(0);
    store.patch(session.id, { draft: value });
  };

  const setRefs = (next: AgentRef[]) => store.commit(session.id, { refs: next });

  const pick = (c: RefCandidate) => {
    if (!mention) return;
    const next = text.slice(0, mention.start) + text.slice(caret);
    update(next, mention.start);
    setKindOverride(null);
    if (!refs.some((r) => sameRef(r, c))) setRefs([...refs, { kind: c.kind, ref: c.ref }]);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(mention.start, mention.start);
    });
  };

  const send = async (explicit?: "steer" | "follow-up") => {
    const body = text.trim();
    if (!body || submit.isPending || resolving) return;
    const all = [...refs];
    for (const t of parseRefTokens(body)) if (!all.some((r) => sameRef(r, t))) all.push(t);
    try {
      // Every reference resolves at submit, so the Frame records the revision it was given (§36.6 rule 2).
      setResolving(true);
      const check = await resolveRefs(all).finally(() => setResolving(false));
      setFailed(Object.fromEntries(check.unresolved.map((r) => [r.raw, r.error ?? "unresolved"])));
      const blocked = blockReason(check);
      if (blocked) {
        setBusy(false);
        setError(blocked);
        return;
      }
      await submit.mutateAsync({ text: body, refs: all, references: check.references, mode: explicit ?? (working ? mode : "prompt") });
      update("", 0);
      store.commit(session.id, { refs: [], frameId: null, scrollTop: 0 });
    } catch (e) {
      if (e instanceof BusyError) {
        setBusy(true);
        setError("The session is working. Send this as a steer or a follow-up instead.");
      } else setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen && candidates.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((index + (e.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(candidates[index]!);
        return;
      }
    }
    if (pickerOpen && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(mention!.start);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const openPicker = () => {
    const before = text.slice(0, caret);
    const insert = before.length === 0 || /\s$/.test(before) ? "@" : " @";
    const next = before + insert + text.slice(caret);
    const pos = caret + insert.length;
    update(next, pos);
    setDismissed(null);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative">
      {pickerOpen && (
        <Picker
          items={candidates}
          active={index}
          kind={kind}
          onKind={(k) => {
            setKindOverride(k);
            setActive(0);
            area.current?.focus();
          }}
          onPick={pick}
          onHover={setActive}
        />
      )}
      <div className={cx("rounded-lg border bg-surface transition-colors focus-within:border-border-strong", error ? "border-danger/50" : "border-border")} data-testid="composer">
        {refs.length > 0 && (
          <div className="flex flex-wrap gap-1 px-2.5 pt-2" aria-label="Attached references">
            {refs.map((r) => (
              <AgentRefChip key={`${r.kind}:${r.ref}`} reference={r} error={failed[formatAgentRef(r)]} onRemove={() => setRefs(refs.filter((x) => !sameRef(x, r)))} />
            ))}
          </div>
        )}
        <textarea
          ref={area}
          rows={1}
          value={text}
          aria-label={`Message ${session.name}`}
          placeholder={working ? `${mode === "steer" ? "Steer" : "Queue a follow-up for"} ${session.name}…` : `Message ${session.name} — @ to reference work, files, and sessions`}
          onChange={(e) => update(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          className="block max-h-48 min-h-11 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm leading-6 text-ink outline-none placeholder:text-ink-faint"
        />
        <div className="flex h-9 items-center gap-1 px-1.5 pb-0.5">
          <button
            type="button"
            onClick={openPicker}
            aria-label="Add reference"
            className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-ink-faint outline-none hover:bg-hover hover:text-ink-muted focus-visible:bg-hover"
          >
            <span className="font-mono text-sm leading-none">@</span> Reference
          </button>
          <span className="ml-1 hidden items-center gap-1 text-[0.7rem] text-ink-faint lg:flex">
            <Kbd>Enter</Kbd> send <Kbd>Shift Enter</Kbd> newline
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            {working && session.capabilities.includes("abort") && (
              <button
                type="button"
                onClick={() => abort.mutate(undefined, { onError: (e) => setError(`Stop failed: ${e.message}`) })}
                disabled={abort.isPending}
                className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 disabled:text-ink-faint"
              >
                <Icon name="close" size="xs" />
                Stop
              </button>
            )}
            {working && (
              <span className="flex items-center rounded-md bg-control p-0.5 text-[0.7rem]" role="radiogroup" aria-label="Delivery while working">
                {(["steer", "follow-up"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={cx("rounded px-1.5 py-0.5 outline-none", mode === m ? "bg-surface text-ink shadow-[0_0_0_1px_var(--x-border-muted)]" : "text-ink-faint hover:text-ink-muted")}
                  >
                    {m === "steer" ? "Steer" : "Follow-up"}
                  </button>
                ))}
              </span>
            )}
            <button
              type="button"
              onClick={() => void send()}
              disabled={!text.trim() || submit.isPending || resolving}
              className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-medium text-white outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:bg-control disabled:text-ink-faint"
            >
              {working ? (mode === "steer" ? "Steer" : "Follow up") : "Send"}
              <Icon name="forward" size="xs" />
            </button>
          </span>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 px-1 text-xs text-danger">
          <Icon name="alert" size="xs" />
          {error}
          {busy && (
            <span className="ml-1 flex gap-1.5">
              {(["steer", "follow-up"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => void send(m)}
                  disabled={submit.isPending}
                  className="h-6 rounded-md border border-border px-2 text-xs font-medium text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {m === "steer" ? "Send as steer" : "Send as follow-up"}
                </button>
              ))}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export function ComposerNotice({ session }: { session: AgentSessionDetail }) {
  const presence = session.capabilities.includes("presence");
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-ink-muted" data-testid="composer-notice">
      <Icon name={presence ? "live" : "list"} size="sm" className="shrink-0 text-ink-faint" />
      <span className="min-w-0 flex-1">
        {presence
          ? "Claude Code session · presence only in v0. Status and tool activity stream here; prompt it from its terminal."
          : "History only · no live extension is connected. Resume the session in a terminal to continue it."}
      </span>
      {session.tmux && <code className="shrink-0 rounded-sm bg-control px-1.5 py-0.5 font-mono text-xs text-ink-muted">tmux attach -t {session.tmux.split(":")[0]}</code>}
    </div>
  );
}

