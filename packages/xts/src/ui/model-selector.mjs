// Minimal TUI model selector using pi-tui.
//
// Renders a title, a provider-grouped list, and a footer. ↑/↓ move,
// Enter confirms, Esc cancels. Uses SelectList for the list itself and a
// custom Container for the title/footer/group separators.

import {
  Box,
  Container,
  ProcessTerminal,
  SelectList,
  Text,
  TuiMainScreen,
} from "@earendil-works/pi-tui";

const FG = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const BOLD = FG("1");
const DIM = FG("2");
const CYAN = FG("36");
const REVERSE = FG("7");

function buildItems(models) {
  const groups = new Map();
  for (const m of models) {
    if (!groups.has(m.provider)) groups.set(m.provider, []);
    groups.get(m.provider).push(m);
  }
  const items = [];
  for (const [provider, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const m of [...group].sort((a, b) => a.id.localeCompare(b.id))) {
      items.push({ value: `${provider}/${m.id}`, label: m.id, description: provider });
    }
  }
  return items;
}

class ModelSelectorApp {
  constructor({ models, title }) {
    this.models = models;
    this.title = title ?? "Select model for XTS";
    this.items = buildItems(models);
    this.result = null; // { provider, id } | null
    this.cancelled = false;
    this.done = null; // resolve() from the runModelSelector promise
    this.list = null;
    this.terminal = null;
    this.ui = null;
  }

  run() {
    this.terminal = new ProcessTerminal();
    this.ui = new TuiMainScreen(this.terminal);

    const theme = {
      selectedPrefix: (s) => REVERSE(s),
      selectedText: (s) => CYAN(BOLD(s)),
      description: (s) => DIM(s),
      scrollInfo: (s) => DIM(s),
      noMatch: (s) => DIM(s),
    };
    this.list = new SelectList(this.items, 12, theme);
    this.list.onSelect = (item) => this.confirm(item);
    this.list.onCancel = () => this.cancel();

    const body = new Container();
    body.addChild(new Text(this.title, 0, 0));
    body.addChild(new Text("", 0, 0));
    body.addChild(this.list);
    body.addChild(new Text("", 0, 0));
    body.addChild(new Text(`${DIM("↑↓")} select   ${DIM("Enter")} confirm   ${DIM("Esc")} cancel`, 0, 0));

    const frame = new Box(1, 1);
    frame.addChild(body);
    this.ui.addChild(frame);
    this.ui.setFocus(this.list);
    this.ui.start();

    return new Promise((resolve) => {
      this.done = resolve;
    });
  }

  confirm(item) {
    // Model ids may contain "/" (e.g. commandcode/deepseek/deepseek-v4-flash),
    // so split on the FIRST slash only.
    const slash = item.value.indexOf("/");
    const provider = item.value.slice(0, slash);
    const id = item.value.slice(slash + 1);
    this.result = { provider, id };
    this.close();
  }

  cancel() {
    this.cancelled = true;
    this.close();
  }

  close() {
    this.ui.stop();
    const resolve = this.done;
    this.done = null;
    resolve(this.result);
  }
}

/**
 * Open the model selector UI.
 *
 * @param {object} opts
 * @param {Array<{provider:string,id:string,name:string}>} opts.models
 * @param {string} [opts.title]
 * @returns {Promise<{provider:string,id:string}|null>} selected model or null on cancel
 * @throws {Error} when stdin is not a TTY (caller should fall back to a message)
 */
export async function runModelSelector({ models, title }) {
  if (!process.stdin.isTTY) {
    throw new Error("Model selector requires an interactive terminal (stdin is not a TTY).");
  }
  const app = new ModelSelectorApp({ models, title });
  return app.run();
}
