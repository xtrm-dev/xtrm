import { Markdown as MarkdownExtension } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useRef, useState } from "react";
import { Icon, type IconName } from "./icon.tsx";
import { Kbd, cx } from "./primitives.tsx";

/**
 * Jira-style rich editor with Markdown persistence.
 *
 * Round-trip note (measured on real contracts): the Markdown serializer adds escapes such as
 * `NON\_GOALS`. To keep canonical text stable, `onSave` receives the ORIGINAL string when the
 * document was not changed, and a "Markdown" tab allows exact source editing.
 */
export function MarkdownEditor({
  value,
  onSave,
  onCancel,
  placeholder = "Add a description…",
  saving,
  error,
}: {
  value: string;
  onSave: (next: string) => void;
  onCancel: () => void;
  placeholder?: string;
  saving?: boolean;
  error?: string | null;
}) {
  const [mode, setMode] = useState<"rich" | "source">("rich");
  const [source, setSource] = useState(value);
  const dirty = useRef(false);

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), MarkdownExtension, Placeholder.configure({ placeholder })],
    content: value,
    contentType: "markdown",
    autofocus: "end",
    immediatelyRender: true,
    onUpdate: () => void (dirty.current = true),
    editorProps: {
      attributes: { "aria-label": placeholder, class: "px-3 py-2.5" },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          latest.current.save();
          return true;
        }
        if (event.key === "Escape") {
          latest.current.onCancel();
          return true;
        }
        return false;
      },
    },
  });

  // Editor props are bound once; keyboard handlers read the latest callbacks through this ref.
  const latest = useRef({ save: () => {}, onCancel });

  function currentMarkdown(): string {
    if (mode === "source") return source;
    if (!editor || !dirty.current) return value;
    return editor.getMarkdown();
  }

  function save() {
    onSave(currentMarkdown());
  }

  latest.current = { save, onCancel };

  function switchMode(next: "rich" | "source") {
    if (next === mode || !editor) return;
    if (next === "source") {
      setSource(currentMarkdown());
    } else {
      editor.commands.setContent(source, { contentType: "markdown" });
      dirty.current = source !== value;
    }
    setMode(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-border bg-surface focus-within:border-border-strong">
        <div className="flex h-9 items-center gap-0.5 border-b border-border-muted px-1.5">
          {mode === "rich" && editor ? <Toolbar editor={editor} /> : <span className="px-1.5 text-xs text-ink-faint">Markdown source</span>}
          <div role="tablist" aria-label="Editor mode" className="ml-auto flex items-center gap-0.5 text-xs">
            {(["rich", "source"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={cx("rounded-sm px-2 py-1 outline-none", mode === m ? "bg-hover text-ink" : "text-ink-faint hover:text-ink-muted")}
              >
                {m === "rich" ? "Rich" : "Markdown"}
              </button>
            ))}
          </div>
        </div>
        {mode === "rich" ? (
          <EditorContent editor={editor} className="xtrm-prose thin-scrollbar max-h-[60vh] overflow-y-auto" />
        ) : (
          <textarea
            autoFocus
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
              if (e.key === "Escape") onCancel();
            }}
            aria-label="Markdown source"
            spellCheck={false}
            className="thin-scrollbar block min-h-40 w-full resize-y bg-transparent px-3 py-2.5 font-mono text-xs leading-5 text-ink outline-none"
            rows={Math.min(24, Math.max(6, source.split("\n").length + 1))}
          />
        )}
      </div>
      <EditActions saving={saving} error={error} onSave={save} onCancel={onCancel} />
    </div>
  );
}

export function EditActions({ saving, error, onSave, onCancel }: { saving?: boolean; error?: string | null; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="h-7 rounded-md bg-accent px-3 text-sm font-medium text-white outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} disabled={saving} className="h-7 rounded-md px-3 text-sm text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover">
        Cancel
      </button>
      <span className="ml-1 flex items-center gap-1 text-xs text-ink-faint">
        <Kbd>Ctrl ↵</Kbd> save <Kbd>Esc</Kbd> cancel
      </span>
      {error && <span className="ml-auto text-xs text-danger">{error}</span>}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      code: e.isActive("code"),
      h2: e.isActive("heading", { level: 2 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      codeBlock: e.isActive("codeBlock"),
      quote: e.isActive("blockquote"),
    }),
  });
  const items: Array<{ label: string; text?: string; icon?: IconName; active: boolean; run: () => void }> = [
    { label: "Bold", text: "B", active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic", text: "I", active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: "Inline code", text: "</>", active: state.code, run: () => editor.chain().focus().toggleCode().run() },
    { label: "Heading", text: "H", active: state.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Bulleted list", text: "•", active: state.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", text: "1.", active: state.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Code block", text: "{ }", active: state.codeBlock, run: () => editor.chain().focus().toggleCodeBlock().run() },
    { label: "Quote", text: "❝", active: state.quote, run: () => editor.chain().focus().toggleBlockquote().run() },
  ];
  return (
    <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          aria-label={it.label}
          aria-pressed={it.active}
          title={it.label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={it.run}
          className={cx(
            "flex h-6 min-w-6 items-center justify-center rounded-sm px-1 text-xs outline-none",
            it.label === "Bold" && "font-semibold",
            it.label === "Italic" && "italic",
            it.active ? "bg-hover text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
          )}
        >
          {it.icon ? <Icon name={it.icon} size="xs" /> : it.text}
        </button>
      ))}
    </div>
  );
}
