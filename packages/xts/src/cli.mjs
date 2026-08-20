#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";

const USAGE = `xts — minimal terminal AI assistant for shell work

Usage:
  xts                          Interactive session
  xts "question"               One-shot question
  command | xts                Question from piped stdin
  xts run "command"            Run a command through the XTS safety gate
  xts model                    Select the model
  xts shellhook                Print the shell hook snippet
  xts --json                   Emit dev output as JSON

Options:
  -h, --help                   Show this help
  -v, --version                Show version
      --show-prompt            Print the assembled prompt envelope and exit (no model call)
`;

const NOT_IMPLEMENTED = {
  interactive: "interactive mode",
  oneShot: "one-shot questions",
  run: "xts run",
  shellhook: "xts shellhook",
};

// Handlers are stubs for now. Later tasks replace them with lazy `await import(...)`
// of the heavy SDK modules. Keep the SDK out of the top-level import graph so
// --help and --version stay instant.
const HANDLERS = {
  interactive: async () => notImplemented("interactive"),
  oneShot: async (args) => oneShot(args),
  run: async (args) => runCommand(args),
  model: async () => modelCommand(),
  modelJson: async () => modelJsonCommand(),
  shellhook: shellhook,
};

// `xts shellhook [bash|zsh]` prints the hook fragment for the requested shell
// plus install instructions. Default shell: basename of $SHELL (bash fallback).
const HOOK_FILES = {
  bash: new URL("./history/hook.bash", import.meta.url),
  zsh: new URL("./history/hook.zsh", import.meta.url),
};

function hookUsage(shell) {
  return `

Install: source this file in your shell config, then enable the hook.

  bash (in ~/.bashrc):
    source ${resolveHookPath("bash")}
    PROMPT_COMMAND="\${PROMPT_COMMAND:+\$PROMPT_COMMAND;}xts_hook"

  zsh (in ~/.zshrc):
    source ${resolveHookPath("zsh")}
    autoload -U add-zsh-hook; add-zsh-hook precmd xts_hook

State is written to \$XTS_STATE_DIR/xts/state.json (default ~/.local/state/xts/state.json).
The hook prints nothing. To uninstall, remove the two lines above and the
state directory (rm -rf ~/.local/state/xts).
`;
}
function resolveHookPath(shell) {
  return fileURLToPath(HOOK_FILES[shell]);
}

async function shellhook() {
  const requested = process.argv[process.argv.indexOf("shellhook") + 1];
  const shell = requested === "bash" || requested === "zsh" ? requested : defaultShell();
  try {
    const snippet = await readFile(resolveHookPath(shell), "utf8");
    process.stdout.write(snippet + hookUsage(shell));
  } catch {
    process.stderr.write(`xts: could not read the ${shell} hook file\n`);
    process.exitCode = 1;
  }
}

function defaultShell() {
  const name = process.env.SHELL ? path.basename(process.env.SHELL) : "";
  return name === "zsh" ? "zsh" : "bash";
}

async function notImplemented(key) {
  process.stderr.write(`xts: ${NOT_IMPLEMENTED[key]} is not implemented yet\n`);
  process.exitCode = 1;
}

// `xts run "command"`: gate then execute (PRD §7.4, §14).
// ctx has no askApprove here (no TUI overlay yet); the stdin fallback in
// approve.mjs handles one-shot mode. Model interpretation of the result is
// wired by task 7.
async function runCommand(args) {
  const { executeGuarded } = await import("./run.mjs");
  const result = await executeGuarded(args.join(" "), { ctx: {} });
  if (result.status === "denied") {
    process.stderr.write(`xts: command denied: ${result.reason}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.exitCode ?? 0;
}

function parseArgv(argv) {
  const flags = { json: false, help: false, version: false, showPrompt: false };
  const positionals = [];
  for (const arg of argv) {
    if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--version" || arg === "-v") {
      flags.version = true;
    } else if (arg === "--show-prompt") {
      flags.showPrompt = true;
    } else if (arg === "--") {
      positionals.push(...argv.slice(argv.indexOf(arg) + 1));
      break;
    } else if (arg.startsWith("-") && arg !== "-") {
      throw new Error(`unknown option ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

async function run() {
  let parsed;
  try {
    parsed = parseArgv(process.argv.slice(2));
  } catch {
    process.stderr.write("xts: invalid arguments. Run xts --help.\n");
    process.exitCode = 2;
    return;
  }

  if (parsed.flags.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (parsed.flags.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const [command, ...rest] = parsed.positionals;

  if (command === undefined) {
    await HANDLERS.interactive();
    return;
  }
  if (command === "run") {
    if (rest.length === 0) {
      process.stderr.write('xts: run requires a command. Usage: xts run "command".\n');
      process.exitCode = 2;
      return;
    }
    await HANDLERS.run(rest);
    return;
  }
  if (command === "model") {
    await (parsed.flags.json ? HANDLERS.modelJson() : HANDLERS.model(rest));
    return;
  }
  if (command in HANDLERS) {
    await HANDLERS[command]();
    return;
  }
  if (command.startsWith("-")) {
    process.stderr.write(`xts: unknown option ${command}. Run xts --help.\n`);
    process.exitCode = 2;
    return;
  }

  // A positional that is not a subcommand is a one-shot question.
  await HANDLERS.oneShot({ question: rest, showPrompt: parsed.flags.showPrompt });
}

// One-shot question (PRD §7.2, §7.3): `xts "question"` and `command | xts`.
// Task 4 wires stdin reading, shell context, and prompt assembly; the model
// call itself is owned by task 7. With --show-prompt the assembled envelope
// is printed to stdout for inspection; otherwise the handler reports that the
// model call is not wired yet and exits 1.
async function oneShot({ question, showPrompt }) {
  const [{ buildUserMessage }, { isPiped, readStdin }, { loadShellContext }] = await Promise.all([
    import("./prompt.mjs"),
    import("./stdin.mjs"),
    import("./context.mjs"),
  ]);

  const instruction = Array.isArray(question) ? question.join(" ") : "";
  const stdin = isPiped() ? await readStdin() : null;
  const shellContext = await loadShellContext();
  const envelope = buildUserMessage({ instruction, stdin, shellContext });

  if (showPrompt) {
    process.stdout.write(envelope);
    process.stdout.write("\n");
    return;
  }

  process.stderr.write("xts: the model call is not wired yet (task 7). Run with --show-prompt to inspect the assembled prompt.\n");
  process.exitCode = 1;
}

async function createRuntime() {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  return ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
}

async function modelJsonCommand() {
  const { inventoryToJson, listAvailable } = await import("./model.mjs");
  const runtime = await createRuntime();
  const models = await listAvailable(runtime);
  process.stdout.write(`${JSON.stringify(inventoryToJson(models), null, 2)}\n`);
}

async function modelCommand() {
  const [{ formatModel, inventoryToJson, listAvailable, requireAvailableModels }, { readConfig, writeConfig }] = await Promise.all([
    import("./model.mjs"),
    import("./config.mjs"),
  ]);
  const { runModelSelector } = await import("./ui/model-selector.mjs");

  const runtime = await createRuntime();

  // Non-interactive (e.g. piped stdin): print the inventory and instruct the
  // user to run in a terminal. Never silently pick a model (PRD §8.4).
  if (!process.stdin.isTTY) {
    process.stdout.write(JSON.stringify(inventoryToJson(await listAvailable(runtime)), null, 2));
    process.stdout.write("\n");
    process.stderr.write(
      "xts: model selection requires an interactive terminal. Run `xts model` in a terminal to select a model; see `xts model --json` for the inventory.\n",
    );
    process.exitCode = 1;
    return;
  }

  const config = await readConfig();

  // `xts model` explicitly reopens the selector so the user can change the
  // model, even when one is already persisted (PRD §7.5, §8). First-launch
  // auto-selection (skip when a valid model exists) is resolveOrSelectModel,
  // used by task 7's runtime wiring.
  let models;
  try {
    models = await requireAvailableModels(runtime);
  } catch (error) {
    process.stderr.write(`xts: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  let selected;
  try {
    selected = await runModelSelector({ models, title: "Select model for XTS" });
  } catch (error) {
    process.stderr.write(`xts: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (!selected) {
    process.stderr.write("xts: model selection cancelled.\n");
    process.exitCode = 1;
    return;
  }

  await writeConfig({ ...config, model: { provider: selected.provider, id: selected.id } });
  process.stdout.write(`xts: model set to ${formatModel(selected)}\n`);
}

if (import.meta.main) {
  await run();
}
