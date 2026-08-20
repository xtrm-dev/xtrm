#!/usr/bin/env node

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
  run: async () => notImplemented("run"),
  model: async () => notImplemented("model"),
  shellhook: async () => notImplemented("shellhook"),
};

async function notImplemented(key) {
  process.stderr.write(`xts: ${NOT_IMPLEMENTED[key]} is not implemented yet\n`);
  process.exitCode = 1;
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
    await HANDLERS.run();
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
