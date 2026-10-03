import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AgentRef, RefKind } from "../adapters/index.tsx";

/** Per-session view state kept across session and half switches (PRD §36.4). */
export interface SessionView {
  frameId: string | null;
  scrollTop: number;
  draft: string;
  refs: AgentRef[];
  expanded: Record<string, boolean>;
}

const emptyView = (): SessionView => ({ frameId: null, scrollTop: 0, draft: "", refs: [], expanded: {} });

/** UI-only store; one instance per shell, never a module singleton (§9.2). */
export class AgentViewStore {
  private views = new Map<string, SessionView>();
  private listeners = new Set<() => void>();
  private version = 0;
  active: string | null = null;
  lastHref: { console: string | null; agent: string | null } = { console: null, agent: null };

  view(id: string): SessionView {
    let v = this.views.get(id);
    if (!v) {
      v = emptyView();
      this.views.set(id, v);
    }
    return v;
  }

  /** Silent write (scroll, draft keystrokes): no re-render fan-out. */
  patch(id: string, p: Partial<SessionView>) {
    Object.assign(this.view(id), p);
  }

  /** Write that subscribers must see (refs, selected Frame). */
  commit(id: string, p: Partial<SessionView>) {
    this.views.set(id, { ...this.view(id), ...p });
    this.emit();
  }

  /** Drawer "Attach to composer": adds a typed reference to the active session's composer. */
  attach(ref: AgentRef): boolean {
    if (!this.active) return false;
    const v = this.view(this.active);
    if (!v.refs.some((r) => r.kind === ref.kind && r.ref === ref.ref)) this.commit(this.active, { refs: [...v.refs, ref] });
    return true;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}

const Ctx = createContext<AgentViewStore | null>(null);

export function AgentWorkspaceProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new AgentViewStore());
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useAgentStore(): AgentViewStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAgentStore outside AgentWorkspaceProvider");
  return v;
}

/** Re-renders on committed store changes. */
export function useAgentStoreVersion(): number {
  const store = useAgentStore();
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

// --- typed reference tokens --------------------------------------------------

export const REF_KINDS: readonly RefKind[] = ["issue", "epic", "gh-issue", "pr", "commit", "file", "session", "agent", "frame"];

const TOKEN_RE = /@(gh-issue|issue|epic|pr|commit|file|session|agent|frame):(\S+)/g;

/** Literal `@kind:ref` tokens in composer text (PRD §36.6). Trailing sentence punctuation is not part of a ref. */
export function parseRefTokens(text: string): AgentRef[] {
  const out: AgentRef[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const ref = m[2]!.replace(/[.,;:!?)\]]+$/, "");
    if (ref) out.push({ kind: m[1] as RefKind, ref });
  }
  return out;
}

/** The `@query` being typed at the caret, if any: `@` at a word start, no whitespace after it. */
export function activeMention(text: string, caret: number): { start: number; query: string; kind: RefKind | null } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) return null;
  const raw = m[2]!;
  const start = caret - raw.length - 1;
  const colon = raw.indexOf(":");
  if (colon > 0) {
    const kind = raw.slice(0, colon) as RefKind;
    if (REF_KINDS.includes(kind)) return { start, query: raw.slice(colon + 1), kind };
  }
  return { start, query: raw, kind: null };
}

export const formatAgentRef = (r: AgentRef) => `@${r.kind}:${r.ref}`;
