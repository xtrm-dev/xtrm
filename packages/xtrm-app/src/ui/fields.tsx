import { Menu } from "./menu.tsx";
import { useState, type ReactNode } from "react";
import { Icon } from "./icon.tsx";
import { Markdown } from "./markdown.tsx";
import { EditActions, MarkdownEditor } from "./markdown-editor.tsx";
import { cx } from "./primitives.tsx";

// Jira-style fields: read view by default, click to edit, explicit Save/Cancel, errors inline.

export function useSaver() {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    editing,
    saving,
    error,
    start: () => {
      setError(null);
      setEditing(true);
    },
    cancel: () => {
      setError(null);
      setEditing(false);
    },
    async run(task: () => Promise<void>) {
      setSaving(true);
      setError(null);
      try {
        await task();
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
  };
}

/** Grow a textarea to its content so list items are never clipped. */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
}

/** Hover affordance around a read-only value that opens its editor. */
function EditTarget({ canEdit, onEdit, label, children, className }: { canEdit: boolean; onEdit: () => void; label: string; children: ReactNode; className?: string }) {
  if (!canEdit) return <div className={className}>{children}</div>;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Edit ${label}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) return;
        onEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        }
      }}
      className={cx("-mx-2 cursor-text rounded-md px-2 py-1 outline-none transition-colors hover:bg-hover focus-visible:bg-hover", className)}
    >
      {children}
    </div>
  );
}

export function FieldLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <h3 className="text-xs font-medium text-ink-faint">{children}</h3>
      {aside}
    </div>
  );
}

export function InlineTitle({ value, canEdit, onSave, className }: { value: string; canEdit: boolean; onSave: (next: string) => Promise<void>; className?: string }) {
  const s = useSaver();
  const [draft, setDraft] = useState(value);
  if (s.editing) {
    const commit = () => (draft.trim() && draft !== value ? s.run(() => onSave(draft.trim())) : s.cancel());
    return (
      <div className="flex flex-col gap-2">
        <textarea
          autoFocus
          value={draft}
          rows={Math.max(1, Math.ceil(draft.length / 60))}
          onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            }
            if (e.key === "Escape") s.cancel();
          }}
          aria-label="Issue title"
          className={cx("-mx-2 w-[calc(100%+1rem)] resize-none rounded-md border border-border-strong bg-surface px-2 py-1 text-ink outline-none", className)}
        />
        <EditActions saving={s.saving} error={s.error} onSave={() => void commit()} onCancel={s.cancel} />
      </div>
    );
  }
  return (
    <EditTarget
      canEdit={canEdit}
      label="title"
      onEdit={() => {
        setDraft(value);
        s.start();
      }}
    >
      <h1 className={cx("text-pretty text-ink", className)}>{value}</h1>
    </EditTarget>
  );
}

export function ProseField({ label, value, canEdit, onSave, placeholder }: { label: string; value: string; canEdit: boolean; onSave: (next: string) => Promise<void>; placeholder: string }) {
  const s = useSaver();
  return (
    <section aria-label={label}>
      <FieldLabel>{label}</FieldLabel>
      {s.editing ? (
        <MarkdownEditor value={value} placeholder={placeholder} saving={s.saving} error={s.error} onCancel={s.cancel} onSave={(next) => (next === value ? s.cancel() : void s.run(() => onSave(next)))} />
      ) : (
        <EditTarget canEdit={canEdit} onEdit={s.start} label={label}>
          {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-ink-faint">{canEdit ? placeholder : "—"}</p>}
        </EditTarget>
      )}
    </section>
  );
}

export function ListField({
  label,
  items,
  canEdit,
  onSave,
  placeholder,
  numbered,
}: {
  label: string;
  items: string[];
  canEdit: boolean;
  onSave: (next: string[]) => Promise<void>;
  placeholder: string;
  numbered?: boolean;
}) {
  const s = useSaver();
  const [draft, setDraft] = useState<string[]>(items);
  const visible = items.filter((i) => i.trim());

  if (s.editing) {
    const update = (i: number, v: string) => setDraft((d) => d.map((x, j) => (j === i ? v : x)));
    const commit = () => {
      const next = draft.map((d) => d.trim()).filter(Boolean);
      return JSON.stringify(next) === JSON.stringify(visible) ? s.cancel() : s.run(() => onSave(next));
    };
    return (
      <section aria-label={label}>
        <FieldLabel>{label}</FieldLabel>
        <div className="flex flex-col gap-1.5">
          {draft.map((item, i) => (
            <div key={i} className="group/item flex items-start gap-2">
              <span className="mt-2 w-4 shrink-0 text-right text-xs text-ink-faint tabular">{numbered ? `${i + 1}.` : "•"}</span>
              <textarea
                autoFocus={i === draft.length - 1}
                value={item}
                ref={autoGrow}
                onInput={(e) => autoGrow(e.currentTarget)}
                rows={1}
                onChange={(e) => update(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commit();
                  else if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    setDraft((d) => [...d.slice(0, i + 1), "", ...d.slice(i + 1)]);
                  } else if (e.key === "Backspace" && !item && draft.length > 1) {
                    e.preventDefault();
                    setDraft((d) => d.filter((_, j) => j !== i));
                  } else if (e.key === "Escape") s.cancel();
                }}
                placeholder={placeholder}
                aria-label={`${label} item ${i + 1}`}
                className="min-w-0 flex-1 resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-border-strong"
              />
              <button
                type="button"
                aria-label={`Remove ${label} item ${i + 1}`}
                onClick={() => setDraft((d) => (d.length > 1 ? d.filter((_, j) => j !== i) : [""]))}
                className="mt-1 flex size-6 items-center justify-center rounded-sm text-ink-faint outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover"
              >
                <Icon name="close" size="xs" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDraft((d) => [...d, ""])}
            className="ml-6 flex h-7 w-fit items-center gap-1.5 rounded-md px-2 text-sm text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover"
          >
            <Icon name="plus" size="xs" /> Add item
          </button>
          <EditActions saving={s.saving} error={s.error} onSave={() => void commit()} onCancel={s.cancel} />
        </div>
      </section>
    );
  }

  const List = numbered ? "ol" : "ul";
  return (
    <section aria-label={label}>
      <FieldLabel aside={visible.length > 0 && <span className="text-xs text-ink-faint tabular">{visible.length}</span>}>{label}</FieldLabel>
      <EditTarget
        canEdit={canEdit}
        label={label}
        onEdit={() => {
          setDraft(visible.length ? visible : [""]);
          s.start();
        }}
      >
        {visible.length ? (
          <List className={cx("xtrm-prose pl-5", numbered ? "list-decimal" : "list-disc")}>
            {visible.map((item, i) => (
              <li key={i}>
                <Markdown inline>{item}</Markdown>
              </li>
            ))}
          </List>
        ) : (
          <p className="text-sm text-ink-faint">{canEdit ? placeholder : "—"}</p>
        )}
      </EditTarget>
    </section>
  );
}

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  adornment?: ReactNode;
}

/** Jira-style property select: the trigger shows the current value; changes save immediately. */
export function SelectField<T extends string | number>({
  label,
  value,
  options,
  canEdit,
  onChange,
  empty = "None",
}: {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  canEdit: boolean;
  onChange: (next: T) => Promise<void>;
  empty?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = options.find((o) => o.value === value);
  const face = (
    <span className="flex min-w-0 items-center gap-2">
      {current?.adornment}
      <span className={cx("truncate", current ? "text-ink" : "text-ink-faint")}>{saving ? "Saving…" : (current?.label ?? empty)}</span>
    </span>
  );
  if (!canEdit) return <div className="flex h-7 items-center text-sm">{face}</div>;
  return (
    <div className="flex flex-col">
      <Menu.Root>
        <Menu.Trigger
          aria-label={`${label}: ${current?.label ?? empty}`}
          className="-mx-2 flex h-7 min-w-0 items-center justify-between gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-hover focus-visible:bg-hover data-[popup-open]:bg-hover"
        >
          {face}
          <Icon name="chevronDown" size="xs" className="shrink-0 text-ink-faint" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="start" sideOffset={4} className="z-50">
            <Menu.Popup className="min-w-44 rounded-lg bg-raised p-1 text-sm shadow-float outline-none">
              <Menu.RadioGroup
                value={value}
                onValueChange={(next: T) => {
                  if (next === value) return;
                  setSaving(true);
                  setError(null);
                  onChange(next)
                    .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setSaving(false));
                }}
              >
                {options.map((o) => (
                  <Menu.RadioItem
                    key={String(o.value)}
                    value={o.value}
                    className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-ink-muted outline-none data-[highlighted]:bg-hover data-[highlighted]:text-ink"
                  >
                    {o.adornment}
                    <span className="flex-1">{o.label}</span>
                    <Menu.RadioItemIndicator>
                      <Icon name="check" size="xs" className="text-accent-ink" />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
