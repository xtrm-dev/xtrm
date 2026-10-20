/**
 * FrameShell — minimal first-party shell over stock pi-tui.
 *
 * Layout: status stub / thin frame tabs / selected-frame viewport / composer / hints.
 * The viewport rebuilds from the SELECTED frame only: previous frames are never
 * left above it. Reference bootstrap: packages/xts/src/ui/app.mjs.
 */

import {
  Container,
  Input,
  Key,
  Markdown,
  ProcessTerminal,
  ScrollView,
  Text,
  TuiAltScreen,
  VStack,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { FrameStore, type InteractionFrame } from "./frame.js";

/** Identity Markdown theme: plain text, no chrome (spike). */
export const PLAIN_MARKDOWN_THEME: MarkdownTheme = {
  heading: (s) => s,
  link: (s) => s,
  linkUrl: (s) => s,
  code: (s) => s,
  codeBlock: (s) => s,
  codeBlockBorder: (s) => s,
  quote: (s) => s,
  quoteBorder: (s) => s,
  hr: (s) => s,
  listBullet: (s) => s,
  bold: (s) => s,
  italic: (s) => s,
  strikethrough: (s) => s,
  underline: (s) => s,
};

export interface ShellCallbacks {
  onPrompt: (text: string) => void;
  onAbort: () => void;
  onExit: () => void;
}

/** Build the selected-frame viewport content (headless-renderable). */
export function buildFrameViewport(frame: InteractionFrame): Container {
  const body = new Container();
  body.addChild(new Text(`› ${frame.ingress}`, 0, 0));
  body.addChild(new Text("", 0, 0));
  if (frame.bodyText) {
    body.addChild(new Markdown(frame.bodyText, 0, 0, PLAIN_MARKDOWN_THEME));
    body.addChild(new Text("", 0, 0));
  }
  for (const row of frame.toolRows) {
    body.addChild(new Text(row, 0, 0));
  }
  if (frame.status === "settled") {
    body.addChild(new Text("", 0, 0));
    body.addChild(new Text(`— settled · ${frame.toolRows.length} tools —`, 0, 0));
  }
  return body;
}

export class FrameShell {
  private store = new FrameStore();
  /** Ordered frame ids (path order) — the store owns state, this owns order view. */
  private order: number[] = [];
  private cwd: string;
  private modelLabel = "";
  private busy = false;

  private terminal = new ProcessTerminal();
  private ui = new TuiAltScreen(this.terminal, false, undefined, { mouse: false });
  private statusLine = new Text("", 0, 0);
  private tabLine = new Text("", 0, 0);
  private viewportBody = new Container();
  private scroll = new ScrollView(this.viewportBody, { follow: "end", primary: true });
  private input = new Input();
  private hintLine = new Text(
    "Enter send · Ctrl+Left/Right frame · Ctrl+C abort/exit",
    0,
    0,
  );
  private root: VStack;
  private removeListener: () => void;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private renderDirty = false;

  constructor(
    private callbacks: ShellCallbacks,
    cwd = process.cwd(),
  ) {
    this.cwd = cwd;
    this.input.focused = true;
    this.input.onSubmit = (value) => this.submit(value);

    this.root = new VStack(
      [
        { component: this.statusLine },
        { component: this.tabLine },
        { component: this.scroll, grow: 1, minSize: 1 },
        { component: this.input, grow: 0 },
        { component: this.hintLine },
      ],
      { gap: 0 },
    );

    this.removeListener = this.ui.addInputListener((data) => {
      if (matchesKey(data, Key.ctrl(Key.left))) {
        this.store.previous();
        this.refresh();
        return { consume: true };
      }
      if (matchesKey(data, Key.ctrl(Key.right))) {
        this.store.next();
        this.refresh();
        return { consume: true };
      }
      if (matchesKey(data, Key.ctrl("c"))) {
        if (this.busy) this.callbacks.onAbort();
        else this.callbacks.onExit();
        return { consume: true };
      }
      return undefined;
    });
    this.refresh();
  }

  // -- state ---------------------------------------------------------------

  frameCount(): number {
    return this.store.count();
  }

  selectedId(): number {
    return this.store.current()?.id ?? -1;
  }

  settledCount(): number {
    return this.store.settledCount();
  }

  setModelLabel(label: string): void {
    this.modelLabel = label;
    this.refresh();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.refresh();
  }

  /** Open a frame for a new accepted ingress. Call only on idle submit. */
  newFrame(ingress: string): InteractionFrame {
    const frame = this.store.create(ingress);
    this.order.push(frame.id);
    this.refresh();
    return frame;
  }

  appendDelta(delta: string): void {
    const frame = this.store.current();
    if (!frame || frame.status !== "open" || !delta) return;
    frame.bodyText += delta;
    this.refreshViewport();
    this.scheduleRender();
  }

  appendToolRow(row: string): void {
    const frame = this.store.current();
    if (!frame || frame.status !== "open") return;
    frame.toolRows.push(truncateToWidth(row, 200));
    this.refreshViewport();
    this.scheduleRender();
  }

  /**
   * Settle the open frame. True only on the real open → settled transition
   * (agent_settled exactly once); agent_end never calls this.
   */
  settleFrame(): boolean {
    const done = this.store.settleCurrent();
    this.refresh();
    return done;
  }

  selectFrame(id: number): void {
    this.store.select(id);
    this.refresh();
  }

  // -- render ----------------------------------------------------------------

  /** Ids of settled frames, for the tab strip (store owns status; this is a view cache). */
  private settled = new Set<number>();

  private tabText(): string {
    const selected = this.selectedId();
    return this.order
      .map((id) => {
        const n = this.order.indexOf(id) + 1;
        const label = `${n}${this.settled.has(id) ? "✓" : ""}`;
        return id === selected ? `[${label}]` : ` ${label} `;
      })
      .join("");
  }

  private refresh(): void {
    const current = this.store.current();
    if (current && current.status === "settled") this.settled.add(current.id);
    this.statusLine.setText(
      truncateToWidth(`XTRM · ${this.cwd}${this.modelLabel ? ` · ${this.modelLabel}` : ""}`, 500),
    );
    this.tabLine.setText(this.order.length > 0 ? `Frames:${this.tabText()}` : "Frames: —");
    this.refreshViewport();
    this.scheduleRender();
  }

  private refreshViewport(): void {
    const frame = this.store.current();
    const fresh = frame ? buildFrameViewport(frame) : new Container();
    // Swap scroll content by replacing children (ScrollView wraps the container).
    this.viewportBody = fresh;
    this.scroll = new ScrollView(this.viewportBody, { follow: "end", primary: true });
    this.root = new VStack(
      [
        { component: this.statusLine },
        { component: this.tabLine },
        { component: this.scroll, grow: 1, minSize: 1 },
        { component: this.input, grow: 0 },
        { component: this.hintLine },
      ],
      { gap: 0 },
    );
    try {
      this.ui.setLayoutRoot(this.root);
    } catch {
      // Headless / pre-start: layout applies on start().
    }
  }

  private scheduleRender(): void {
    this.renderDirty = true;
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      if (this.renderDirty) {
        this.renderDirty = false;
        try {
          this.ui.requestRender();
        } catch {
          // Pre-start: nothing to render yet.
        }
      }
    }, 50);
  }

  // -- lifecycle ---------------------------------------------------------------

  start(): void {
    this.ui.setLayoutRoot(this.root);
    this.ui.setFocus(this.input);
    this.ui.start();
  }

  close(): void {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.removeListener();
    try {
      this.ui.stop();
    } catch {
      // ignore double-stop
    }
  }

  private submit(value: string): void {
    const text = value.trim();
    this.input.setValue("");
    this.input.focused = true;
    if (!text || this.busy) return;
    this.callbacks.onPrompt(text);
  }
}
