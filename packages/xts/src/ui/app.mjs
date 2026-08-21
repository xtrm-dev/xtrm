// XTS conversation TUI (task xtrm-nka.6).
//
// Layout (PRD §16.1):
//   ╭─ xts ───────────── cwd · model ────╮   (header, no git branch — PRD §25)
//   │ ... conversation area ...          │   (scrollable, pinned input below)
//   │ › input line                       │
//
// The app is decoupled from the runtime: it receives events
// (appendUserMessage, appendAssistantDelta, appendAssistantComplete,
// appendToolRow) and calls back onPrompt(text) on submit. All I/O (keyboard,
// terminal) is owned by pi-tui; the app only wires callbacks.

import { Container, Input, Key, Markdown, ScrollView, Text, TuiAltScreen, VStack, matchesKey } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { ProcessTerminal } from "@earendil-works/pi-tui";
import { showApprovalOverlay } from "./approval.mjs";

const FG = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const BOLD = FG("1");
const DIM = FG("2");
const CYAN = FG("36");
const GREEN = FG("32");
const RED_BOLD = FG("1;31");

// Theme for the assistant Markdown renderer (minimal, PRD §16 NON_GOALS).
export const MD_THEME = {
  heading: (s) => BOLD(s),
  link: (s) => CYAN(s),
  linkUrl: (s) => DIM(s),
  code: (s) => CYAN(s),
  codeBlock: (s) => DIM(s),
  codeBlockBorder: (s) => DIM(s),
  quote: (s) => s,
  quoteBorder: (s) => DIM(s),
  hr: (s) => DIM(s),
  listBullet: (s) => CYAN(s),
  bold: (s) => BOLD(s),
  italic: (s) => s,
  strikethrough: (s) => s,
  underline: (s) => `\x1b[4m${s}\x1b[24m`,
};

/** Render the header line (pure, unit-tested). */
export function buildHeader({ cwd = "", model = "" }) {
  const left = `xts · ${cwd}`;
  const right = model;
  const total = visibleWidth(left) + 1 + visibleWidth(right);
  if (total <= 0) return "";
  const dots = "·";
  const inner = total;
  return `╭─ ${left}${"─".repeat(Math.max(1, inner - visibleWidth(left) - 1))}${dots} ${right} ${"─".repeat(Math.max(1, inner - visibleWidth(right) - 1))}╮`;
}

/** Collapse whitespace in a single-line tool-command label. */
export function collapseCommand(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Format a tool row: `$ command` + bounded preview (pure, unit-tested).
 * The preview is the first `maxLines` non-empty output lines, truncated.
 */
export function formatToolRow(command, output = "", maxLines = 3) {
  const label = collapseCommand(command);
  const lines = [`${GREEN("$")} ${label}`];
  const preview = String(output ?? "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (preview.length > 0) {
    const shown = preview.slice(0, maxLines);
    for (const line of shown) lines.push(`  ${DIM(line)}`);
    if (preview.length > maxLines) lines.push(`  ${DIM(`… ${preview.length - maxLines} more line(s)`)}`);
  }
  return lines;
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/** Dismiss the current streaming block, if any (returns true if there was one). */
function dismissCurrentBlock(state) {
  if (state.kind !== "streaming") return false;
  state.kind = "complete";
  return true;
}

export class ConversationView {
  constructor({ onPrompt, onAbort, onExit }) {
    this.onPrompt = onPrompt;
    this.onAbort = onAbort;
    this.onExit = onExit;
    this.streamTimer = null;
    this.streamDirty = false;
    this.promptHistory = [];
    this.historyIndex = -1;
    this.pendingHistoryValue = "";
    this.assistantPending = "";
    this.state = { kind: "idle", kind_: "idle" };
    this.busy = false;
    this.ready = false;

    this.terminal = new ProcessTerminal();
    this.ui = new TuiAltScreen(this.terminal, false, undefined, { mouse: false });

    // Header (updates via setCwd/setModelLabel).
    this.header = new Text("", 0, 0);
    this.cwd = process.cwd();
    this.model = "";
    this.header.setText(this.renderHeaderText());

    // Assistant response area: each turn gets its own Markdown child appended
    // to the transcript (never cleared on completion — retention is structural).
    this.assistant = null;
    this.assistantPending = "";
    this.activeTool = null;
    this.hydratedBash = null;

    // Conversation area: user prompts, assistant turns, tool rows, in order.
    this.body = new Container();
    this.scroll = new ScrollView(this.body, { follow: "end", primary: true });

    this.input = new Input();
    this.input.focused = true;
    this.input.onSubmit = (value) => this.submit(value);
    this.input.onEscape = () => {};

    this.root = new VStack(
      [
        { component: this.header },
        { component: this.scroll, grow: 1, minSize: 1 },
        { component: this.input, grow: 0 },
      ],
      { gap: 0 },
    );

    // Intercept ↑/↓ and Ctrl+C before they reach the Input.
    this.removeListener = this.ui.addInputListener((data) => {
      if (matchesKey(data, Key.up)) {
        this.historyPrevious();
        return { consume: true };
      }
      if (matchesKey(data, Key.down)) {
        this.historyNext();
        return { consume: true };
      }
      if (matchesKey(data, Key.ctrl("c"))) {
        this.handleCtrlC();
        return { consume: true };
      }
      return undefined;
    });
  }

  renderHeaderText() {
    return buildHeader({ cwd: this.cwd, model: this.model });
  }

  start() {
    this.ui.setLayoutRoot(this.root);
    this.ui.setFocus(this.input);
    this.ui.start();
  }

  close() {
    if (this.streamTimer) clearTimeout(this.streamTimer);
    this.removeListener();
    try {
      this.ui.stop();
    } catch {
      // ignore double-stop
    }
  }

  // -- streaming ----------------------------------------------------------

  scheduleRender() {
    this.streamDirty = true;
    if (this.streamTimer) return;
    // ~50 ms debounce while streaming (PRD §18: no full-repaint flicker).
    this.streamTimer = setTimeout(() => {
      this.streamTimer = null;
      if (this.streamDirty && !this.ui.stopped) this.ui.requestRender();
      this.streamDirty = false;
    }, 50);
  }

  ensureStreamBlock() {
    if (this.state.kind === "streaming") return;
    if (dismissCurrentBlock(this.state)) {
      this.finalizeStreamBlock();
    }
    this.state = { kind: "streaming", kind_: "streaming" };
    this.assistantPending = "";
    // A new Markdown child per turn — the transcript keeps every response.
    this.assistant = new Markdown("", 0, 0, MD_THEME);
    this.body.addChild(this.assistant);
    this.body.addChild(new Text("", 0, 0));
    this.scheduleRender();
  }

  finalizeStreamBlock() {
    if (this.state.kind !== "streaming") return;
    this.state = { kind: "idle", kind_: "idle" };
    // Keep the completed assistant text in the transcript (do NOT clear).
    this.assistant = null;
    this.scheduleRender();
  }

  appendUserMessage(text) {
    this.dismissCurrentStream();
    const t = new Text(`${CYAN("›")} ${text}`, 0, 0);
    this.body.addChild(t);
    this.body.addChild(new Text("", 0, 0));
    this.scheduleRender();
  }

  appendAssistantDelta(delta) {
    if (!delta) return;
    this.ensureStreamBlock();
    this.assistantPending += delta;
    this.assistant.setText(this.assistantPending);
    this.scheduleRender();
  }

  appendAssistantComplete() {
    this.finalizeStreamBlock();
  }

  appendAssistantError(error) {
    this.dismissCurrentStream();
    this.body.addChild(new Text(`${RED_BOLD("error:")} ${String(error ?? "Unknown assistant error")}`, 0, 0));
    this.body.addChild(new Text("", 0, 0));
    this.scheduleRender();
  }

  appendSessionMessages(messages = []) {
    for (const message of messages) {
      if (message?.role === "user") {
        this.appendUserMessage(messageText(message.content));
      } else if (message?.role === "assistant") {
        const text = messageText(message.content);
        if (text) this.appendAssistantDelta(text);
        if (message.stopReason === "error" || message.errorMessage) {
          this.appendAssistantError(message.errorMessage ?? "assistant stopped with an error");
        } else {
          this.appendAssistantComplete();
        }
      } else if (message?.role === "bashExecution") {
        this.appendToolRow(message.command ?? "bash", message.output ?? "");
        this.activeTool = null;
        this.hydratedBash = { output: message.output ?? "" };
      } else if (message?.role === "toolResult" || message?.role === "tool") {
        const output = messageText(message.content);
        const duplicateBash =
          this.hydratedBash &&
          message.toolName === "bash" &&
          output === this.hydratedBash.output;
        this.hydratedBash = null;
        if (!duplicateBash) {
          this.appendToolRow(message.toolName ?? message.name ?? "tool", output);
          this.activeTool = null;
        }
      } else {
        this.hydratedBash = null;
      }
    }
  }

  appendToolRow(command, output = "") {
    this.dismissCurrentStream();
    const t = new Text(formatToolRow(command, output).join("\n"), 0, 0);
    this.body.addChild(t);
    this.body.addChild(new Text("", 0, 0));
    this.activeTool = { command, component: t };
    this.scheduleRender();
  }

  appendToolResult(output = "") {
    if (!this.activeTool) {
      this.appendToolRow("tool", output);
      return;
    }
    this.activeTool.component.setText(formatToolRow(this.activeTool.command, output).join("\n"));
    this.activeTool = null;
    this.scheduleRender();
  }

  dismissCurrentStream() {
    if (this.state.kind === "streaming") {
      this.finalizeStreamBlock();
    }
  }

  // -- input --------------------------------------------------------------

  submit(value) {
    if (!this.ready || this.busy) return;
    const text = value.trim();
    this.input.setValue("");
    this.input.focused = true;
    if (!text) return;
    this.promptHistory.push(text);
    this.historyIndex = this.promptHistory.length;
    this.setBusy(true);
    this.pendingHistoryValue = "";
    this.appendUserMessage(text);
    if (this.onPrompt) this.onPrompt(text);
  }

  historyPrevious() {
    if (this.promptHistory.length === 0) return;
    if (this.historyIndex === -1) {
      this.pendingHistoryValue = this.input.getValue();
    }
    if (this.historyIndex === 0) return;
    this.historyIndex -= 1;
    this.input.setValue(this.promptHistory[this.historyIndex]);
    this.ui.requestRender();
  }

  historyNext() {
    if (this.historyIndex === -1) return;
    this.historyIndex += 1;
    if (this.historyIndex >= this.promptHistory.length) {
      this.historyIndex = this.promptHistory.length;
      this.input.setValue(this.pendingHistoryValue);
    } else {
      this.input.setValue(this.promptHistory[this.historyIndex]);
    }
    this.ui.requestRender();
  }

  handleCtrlC() {
    if (this.busy && typeof this.onAbort === "function") {
      this.onAbort();
      this.setBusy(false);
      this.finalizeStreamBlock();
      this.scheduleRender();
      return;
    }
    if (this.onExit) this.onExit();
  }

  setBusy(busy) {
    this.busy = Boolean(busy);
    this.scheduleRender();
  }

  setReady(ready) {
    this.ready = Boolean(ready);
    this.scheduleRender();
  }

  // -- public API (runtime wiring) ---------------------------------------

  setModelLabel(label) {
    this.model = String(label ?? "");
    this.header.setText(this.renderHeaderText());
    this.ui.requestRender();
  }

  setCwd(cwd) {
    this.cwd = String(cwd ?? process.cwd());
    this.header.setText(this.renderHeaderText());
    this.ui.requestRender();
  }

  requestApproval({ command, reason }) {
    return showApprovalOverlay({ tui: this.ui, command, reason });
  }
}

/**
 * Create the conversation TUI. Throws when stdin is not a TTY — the caller
 * (runtime, task 7) falls back to a non-interactive mode.
 *
 * @param {object} opts
 * @param {(text: string) => void} opts.onPrompt
 * @param {() => void} [opts.onAbort]
 * @param {() => void} [opts.onExit]
 * @returns {ConversationView} the app object
 */
export function createXtsApp({ onPrompt, onAbort, onExit }) {
  if (!process.stdin.isTTY) {
    throw new Error("xts: interactive session requires a TTY (stdin is not a terminal).");
  }
  const app = new ConversationView({ onPrompt, onAbort, onExit });
  app.start();
  return app;
}
