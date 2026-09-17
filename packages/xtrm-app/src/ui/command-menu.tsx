import { Dialog } from "@base-ui/react/dialog";
import { Command } from "cmdk";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";
import { Kbd, cx } from "./primitives.tsx";

export interface CommandEntry {
  id: string;
  label: string;
  hint?: string;
  /** Keyboard shortcut rendered with the Kbd primitive (e.g. Mod+I). Falls back to shortcut-like hints. */
  shortcut?: string;
  icon: IconName;
  keywords?: string[];
  onSelect: () => void;
}

/** Hints that are really shortcuts (Ctrl B, ⌘I, …) render as Kbd; context hints stay plain text. */
export function isShortcutHint(hint: string): boolean {
  return /^(ctrl|\u2318|cmd|mod|shift|alt|esc|enter|\u21b5)\b/i.test(hint.trim());
}

/** Token match over label + keywords; a leading `>` only selects command mode. */
export function matchEntry(value: string, search: string, keywords: string[] = []): number {
  const tokens = search.replace(/^>/, "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  const haystack = [value, ...keywords].join(" ").toLowerCase();
  return tokens.every((t) => haystack.includes(t)) ? 1 : 0;
}

export interface CommandGroupData {
  heading: string;
  entries: CommandEntry[];
}

/**
 * One `cmdk` tree for search and commands (§4.4 rule 1), inside a Base UI dialog
 * so dialogs share one primitive family.
 */
export function CommandMenu({
  open,
  onOpenChange,
  query,
  onQueryChange,
  placeholder,
  groups,
  toolbar,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (q: string) => void;
  placeholder: string;
  groups: CommandGroupData[];
  toolbar?: ReactNode;
  loading?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/20 dark:bg-black/40" />
        <Dialog.Popup
          aria-label="Search and commands"
          className="fixed top-[14vh] left-1/2 z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg bg-raised shadow-float outline-none"
        >
          <Command label="Search and commands" loop shouldFilter filter={matchEntry}>
            <div className="flex h-12 items-center gap-2 border-b border-border-muted px-4">
              <Icon name={query.startsWith(">") ? "command" : "search"} className="text-ink-faint" />
              <Command.Input autoFocus value={query} onValueChange={onQueryChange} placeholder={placeholder} className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint" />
              {toolbar}
            </div>
            <Command.List className="thin-scrollbar max-h-[min(420px,56vh)] overflow-y-auto p-1.5">
              {loading && <Command.Loading><div className="px-3 py-2 text-sm text-ink-faint">Loading…</div></Command.Loading>}
              <Command.Empty className="px-3 py-8 text-center text-sm text-ink-faint">No results</Command.Empty>
              {groups.map((g) =>
                g.entries.length ? (
                  <Command.Group key={g.heading} heading={g.heading} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-ink-faint">
                    {g.entries.map((e) => (
                      <Command.Item
                        key={e.id}
                        value={`${g.heading}:${e.id}`}
                        keywords={[e.label, ...(e.hint ? [e.hint] : []), ...(e.shortcut ? [e.shortcut] : []), ...(e.keywords ?? [])]}
                        onSelect={() => {
                          e.onSelect();
                          onOpenChange(false);
                        }}
                        className={cx("flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-muted", "data-[selected=true]:bg-hover data-[selected=true]:text-ink")}
                      >
                        <Icon name={e.icon} size="xs" className="text-ink-faint" />
                        <span className="truncate">{e.label}</span>
                        {(e.shortcut ?? (e.hint && isShortcutHint(e.hint) ? e.hint : null)) ? (
                          <span className="ml-auto shrink-0 pl-4">
                            <Kbd>{e.shortcut ?? e.hint}</Kbd>
                          </span>
                        ) : (
                          e.hint && <span className="ml-auto truncate pl-4 text-xs text-ink-faint">{e.hint}</span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ) : null,
              )}
            </Command.List>
            <div className="flex h-9 items-center gap-3 border-t border-border-muted px-4 text-xs text-ink-faint">
              <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
              <span className="flex items-center gap-1"><Kbd>&gt;</Kbd> commands</span>
              <span className="ml-auto flex items-center gap-1"><Kbd>esc</Kbd> close</span>
            </div>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
