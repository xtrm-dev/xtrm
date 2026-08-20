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
`;

const NOT_IMPLEMENTED = {
  interactive: "interactive mode",
  oneShot: "one-shot questions",
  run: "xts run",
  model: "the model selector",
  shellhook: "xts shellhook",
};

// Handlers are stubs for now. Later tasks replace them with lazy `await import(...)`
// of the heavy SDK modules. Keep the SDK out of the top-level import graph so
// --help and --version stay instant.
const HANDLERS = {
  interactive: async () => notImplemented("interactive"),
  oneShot: async () => notImplemented("oneShot"),
  run: async (args) => runCommand(args),
  model: async () => notImplemented("model"),
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
  const flags = { json: false, help: false, version: false };
  const positionals = [];
  for (const arg of argv) {
    if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--version" || arg === "-v") {
      flags.version = true;
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
  await HANDLERS.oneShot();
}

if (import.meta.main) {
  await run();
}
