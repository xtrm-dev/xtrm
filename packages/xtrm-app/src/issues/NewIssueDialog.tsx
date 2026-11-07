import { Dialog } from "../ui/dialog.tsx";
import { useState } from "react";
import type { Scrutiny } from "../adapters/index.tsx";
import { SelectField } from "../ui/fields.tsx";
import { EditActions } from "../ui/markdown-editor.tsx";
import { useCreateIssue } from "./actions.ts";
import { KIND_ICON, priorityOptions, scrutinyOptions } from "./meta.tsx";

const kindOptions = Object.keys(KIND_ICON).map((k) => ({ value: k, label: k[0]!.toUpperCase() + k.slice(1) }));

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);

/** Jira-style create dialog. Every field maps to a `WorkContract` field; nothing lands in Problem by accident. */
export function NewIssueDialog({ open, onOpenChange, projectId, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; onCreated: (ref: string) => void }) {
  const create = useCreateIssue(projectId);
  const [form, setForm] = useState({ kind: "task", title: "", priority: 2, scrutiny: "MEDIUM" as Scrutiny, parent: "", problem: "", success: "", scope: "", nonGoals: "", constraints: "", validation: "", output: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    if (!form.title.trim() || !form.problem.trim() || !form.success.trim()) return setError("Title, Problem, and Success are required.");
    setSaving(true);
    setError(null);
    create({
      title: form.title.trim(),
      kind: form.kind,
      priority: form.priority,
      scrutiny: form.scrutiny,
      parent: form.parent.trim() || undefined,
      contract: {
        problem: form.problem.trim(),
        success: form.success.trim(),
        scope: lines(form.scope),
        nonGoals: lines(form.nonGoals),
        constraints: lines(form.constraints),
        validation: lines(form.validation).map((check) => ({ check })),
        output: lines(form.output).map((artifact) => ({ artifact })),
      },
    })
      .then((ref) => {
        onOpenChange(false);
        if (ref) onCreated(ref);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  const input = "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-border-strong";
  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-faint">
        {label}
        {hint && <span className="ml-1.5 font-normal">{hint}</span>}
      </span>
      {node}
    </label>
  );
  const area = (key: "problem" | "success" | "scope" | "nonGoals" | "constraints" | "validation" | "output", placeholder: string, rows = 3) => (
    <textarea value={form[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} rows={rows} className={`${input} resize-y`} />
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 dark:bg-black/50" />
        <Dialog.Popup className="fixed top-[6vh] left-1/2 z-50 flex max-h-[88vh] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-raised shadow-float outline-none">
          <div className="flex h-12 shrink-0 items-center border-b border-border-muted px-5">
            <Dialog.Title className="text-base font-medium text-ink">New issue</Dialog.Title>
          </div>
          <div className="thin-scrollbar flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-3 gap-4">
              {field("Type", <SelectField label="Type" value={form.kind} options={kindOptions} canEdit onChange={async (v) => set("kind", v)} />)}
              {field("Priority", <SelectField label="Priority" value={form.priority} options={priorityOptions} canEdit onChange={async (v) => set("priority", v)} />)}
              {field("Scrutiny", <SelectField label="Scrutiny" value={form.scrutiny} options={scrutinyOptions} canEdit onChange={async (v) => set("scrutiny", v)} />)}
            </div>
            {field("Summary", <input autoFocus value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="What needs to happen" className={input} />)}
            {field("Parent", <input value={form.parent} onChange={(e) => set("parent", e.target.value)} placeholder="e.g. XTRM-252 (optional)" className={`${input} font-mono text-xs`} />)}
            {field("Problem", area("problem", "Markdown supported", 4))}
            {field("Success", area("success", "Observable outcome", 2))}
            <div className="grid grid-cols-2 gap-4">
              {field("Scope", area("scope", "One item per line"), "one per line")}
              {field("Non-goals", area("nonGoals", "One item per line"), "one per line")}
            </div>
            {field("Constraints", area("constraints", "One item per line"), "one per line")}
            <div className="grid grid-cols-2 gap-4">
              {field("Validation", area("validation", "One check per line"), "one per line")}
              {field("Output", area("output", "One artifact per line"), "one per line")}
            </div>
          </div>
          <div className="shrink-0 border-t border-border-muted px-5 py-3">
            <EditActions saving={saving} error={error} onSave={submit} onCancel={() => onOpenChange(false)} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
