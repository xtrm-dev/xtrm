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
  interactive: async () => interactiveCommand(),
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

// `xts` interactive session (PRD §7.1, §16, §20.1): TUI + streamed model
// responses + guarded bash + conversation persistence.
async function interactiveCommand() {
  const [{ loadShellContext }, { readConfig }] = await Promise.all([
    import("./context.mjs"),
    import("./config.mjs"),
  ]);
  const { buildUserMessage } = await import("./prompt.mjs");

  if (!process.stdin.isTTY) {
    process.stderr.write("xts: interactive session requires a TTY (stdin is not a terminal). Use a question or pipe instead.\n");
    process.exitCode = 1;
    return;
  }

  const { createXtsApp } = await import("./ui/app.mjs");
  const { makeTuiApprovalHandler } = await import("./ui/approval.mjs");
  const { resolveOrSelectModel } = await import("./model.mjs");
  const { runModelSelector } = await import("./ui/model-selector.mjs");
  const { createXtsSession } = await import("./runtime.mjs");

  const runtime = await (async () => {
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    return ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  })();

  const config = await readConfig();
  const select = (models) => runModelSelector({ models, title: "Select model for XTS" });
  const resolved = await resolveOrSelectModel(runtime, config, select);
  if (!resolved.model) {
    process.stderr.write(`xts: ${resolved.error ?? "no model selected"}\n`);
    process.exitCode = 1;
    return;
  }
  const model = resolved.model;

  let session;
  let exiting = false;
  const app = createXtsApp({
    onPrompt: async (text) => {
      if (!session || exiting) return;
      const shellContext = await loadShellContext();
      const envelope = buildUserMessage({ instruction: text, stdin: null, shellContext });
      try {
        await session.prompt(envelope);
      } catch (error) {
        app.appendToolRow("session", error?.message ?? String(error));
      }
    },
    onAbort: async () => {
      try {
        await session?.abort();
      } catch {
        // session may already be idle
      }
    },
    onExit: async () => {
      exiting = true;
      app.close();
      session?.dispose();
      process.exit(0);
    },
  });

  const askApprove = makeTuiApprovalHandler(app);
  const created = await createXtsSession({
    model,
    cwd: process.cwd(),
    sessionMode: "persistent",
    askApprove,
  });
  session = created.session;

  app.setModelLabel(`${model.provider}/${model.id}`);
  app.setCwd(process.cwd());

  session.subscribe((event) => {
    if (event.type === "message_update") {
      const se = event.assistantMessageEvent;
      if (se?.type === "text_delta") app.appendAssistantDelta(se.delta);
    } else if (event.type === "tool_execution_start") {
      const cmd = event.toolName === "bash" ? event.args?.command : event.toolName;
      app.appendToolRow(cmd ?? event.toolName);
    } else if (event.type === "tool_execution_end") {
      if (event.isError) {
        const text =
          typeof event.result === "string"
            ? event.result
            : JSON.stringify(event.result ?? "").slice(0, 300);
        app.appendToolRow(`blocked: ${event.toolName}`, text);
      }
    } else if (event.type === "agent_end") {
      app.appendAssistantComplete();
    } else if (event.type === "turn_end") {
      app.appendAssistantComplete();
    }
  });

  // keep the process alive; onExit / Ctrl+C drives shutdown
  await new Promise(() => {});
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
  // The first positional is part of the question, not a subcommand name.
  await HANDLERS.oneShot({ question: [command, ...rest], showPrompt: parsed.flags.showPrompt });
}

// One-shot question (PRD §7.2, §7.3): `xts "question"` and `command | xts`.
// Builds the envelope from stdin (bounded), shell context, and the question;
// with --show-prompt prints the envelope and exits. Otherwise resolves the
// model, creates an in-memory session, streams the answer to stdout, exits.
async function oneShot({ question, showPrompt }) {
  const [{ buildUserMessage }, { readStdin }, { loadShellContext }] = await Promise.all([
    import("./prompt.mjs"),
    import("./stdin.mjs"),
    import("./context.mjs"),
  ]);

  const instruction = Array.isArray(question) ? question.join(" ") : "";
  const stdin = await maybeReadStdin(readStdin);
  // Empty or absent stdin adds no evidence block (buildUserMessage checks truthiness).
  const stdinForPrompt = stdin && stdin.content ? stdin : null;
  const shellContext = await loadShellContext();
  const envelope = buildUserMessage({ instruction, stdin: stdinForPrompt, shellContext });

  if (showPrompt) {
    process.stdout.write(envelope);
    process.stdout.write("\n");
    return;
  }

  const { readConfig } = await import("./config.mjs");
  const { resolveModel, requireAvailableModels } = await import("./model.mjs");
  const { createXtsSession } = await import("./runtime.mjs");

  const config = await readConfig();
  const runtime = await (async () => {
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    return ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  })();

  let model = await resolveModel(runtime, config);
  if (!model) {
    // No persisted/valid model: cannot select interactively in one-shot.
    const available = await requireAvailableModels(runtime).catch(() => []);
    if (available.length > 0) {
      process.stderr.write(
        "xts: no model configured. Run `xts model` in a terminal to select one, or pass `xts model --json` to inspect the inventory.\n",
      );
    } else {
      process.stderr.write("xts: no available models. Configure Pi auth first (`pi`).\n");
    }
    process.exitCode = 1;
    return;
  }

  const { session } = await createXtsSession({
    model,
    cwd: process.cwd(),
    sessionMode: "inMemory",
    askApprove: null, // non-interactive: approve.mjs stdin fallback (default deny)
  });

  let answer = "";
  session.subscribe((event) => {
    if (event.type === "message_update") {
      const se = event.assistantMessageEvent;
      if (se?.type === "text_delta") {
        answer += se.delta;
        process.stdout.write(se.delta);
      }
    }
  });

  try {
    await session.prompt(envelope);
  } catch (error) {
    process.stderr.write(`\nxts: request failed: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  } finally {
    if (answer && !answer.endsWith("\n")) process.stdout.write("\n");
    session.dispose();
  }
}

// Pipe-mode detection that does not block when stdin is an open-but-idle pipe
// (e.g. under execFile / CI, where stdin is never closed). Real pipe usage
// delivers data within a short window; an interactive terminal never does
// (it waits for keystrokes).
function maybeReadStdin(readStdin) {
  if (process.stdin.isTTY) return Promise.resolve(null);
  // If data is already buffered or the pipe is already closed, read it.
  if (process.stdin.readableLength > 0 || process.stdin.readableEnded) {
    return readStdin();
  }
  // Otherwise wait briefly for the first chunk; if none arrives, treat as no pipe.
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      process.stdin.removeListener("readable", onReadable);
      process.stdin.removeListener("data", onData);
      // Release the open pipe handle so the process can exit; the 150ms
      // window already decided there is no real pipe to read.
      process.stdin.destroy();
      resolve(null);
    }, 150);
    const finish = () => {
      clearTimeout(timer);
      process.stdin.removeListener("readable", onReadable);
      process.stdin.removeListener("data", onData);
      resolve(readStdin());
    };
    const onReadable = () => finish();
    const onData = () => finish();
    process.stdin.once("readable", onReadable);
    process.stdin.once("data", onData);
  });
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
