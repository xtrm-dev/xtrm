import { parseArgs } from "node:util";

import { writeClipboard } from "./clipboard.mjs";
import { completeOnce, createRuntime, selectModel } from "./model.mjs";
import {
  INTENTS,
  buildClarifiedDraft,
  buildPromptRequest,
  buildRefinementRequest,
  detectIntent,
  extractAssistantText,
  isClarificationOnly,
  isVagueDraft,
  normalizeContext,
  parseSentinel,
  retryRequest,
} from "./prompt.mjs";

const VERSION = "0.1.0";

const USAGE = `Usage: xtprompt [options] "prompt"
       command | xtprompt [options]

Options:
  --model <provider/model>  Pi model to use (default: Pi setting, then first authenticated)
  --intent <intent>         auto, planning, analysis, development, refactor, generic
  --context <text|@file>    Add bounded advisory context
  --no-clarify              Reject vague prompts instead of asking once
  --json                    Emit { prompt, intent, model }
  --copy                    Also copy the improved prompt through OSC 52
  -i, --interactive         Refine until :accept or :quit
  -h, --help                Show help
  -v, --version             Show version
`;

export async function runCli(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let parsed;
  try {
    parsed = parseCliArgs(options.argv ?? process.argv.slice(2));
  } catch {
    stderr.write("xtprompt: invalid arguments. Run xtprompt --help.\n");
    return 2;
  }

  if (parsed.values.help) {
    stdout.write(USAGE);
    return 0;
  }
  if (parsed.values.version) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }

  const intentOption = parsed.values.intent ?? "auto";
  if (!INTENTS.includes(intentOption)) {
    stderr.write(`xtprompt: invalid intent "${intentOption}".\n`);
    return 2;
  }
  if (parsed.values.interactive && (parsed.values.json || parsed.values.copy)) {
    stderr.write("xtprompt: --interactive cannot be combined with --json or --copy.\n");
    return 2;
  }
  if (parsed.values.interactive && !(options.isInputTTY ?? process.stdin.isTTY)) {
    stderr.write("xtprompt: interactive mode requires a TTY.\n");
    return 2;
  }

  const draft = await readDraft(parsed.positionals, options);
  if (!draft) {
    stderr.write("xtprompt: provide a prompt as an argument or through stdin.\n");
    return 2;
  }

  let clarifiedDraft;
  try {
    clarifiedDraft = await clarifyDraft(draft, parsed.values["no-clarify"], options);
  } catch {
    stderr.write("xtprompt: clarification input failed.\n");
    return 1;
  }
  if (!clarifiedDraft) {
    stderr.write("xtprompt: prompt is too vague; provide a concrete outcome or allow interactive clarification.\n");
    return 2;
  }

  let context;
  try {
    context = await readContext(parsed.values.context, options);
  } catch {
    stderr.write("xtprompt: could not read the context file.\n");
    return 2;
  }

  let runtime;
  try {
    runtime = await createRuntime(options.createRuntime);
  } catch {
    stderr.write("xtprompt: could not load Pi model configuration.\n");
    return 1;
  }

  const modelResult = await selectModel(runtime, parsed.values.model, options.settingsManager);
  if (modelResult.error) {
    stderr.write(`xtprompt: ${modelResult.error}\n`);
    return 2;
  }

  const intent = intentOption === "auto" ? detectIntent(clarifiedDraft) : intentOption;
  const request = buildPromptRequest({ draft: clarifiedDraft, intent, context });
  const rewrite = await completeRewrite(runtime, modelResult.model, request, options.signal);
  if (rewrite.error) {
    stderr.write(`xtprompt: ${rewrite.error}\n`);
    return 1;
  }

  if (parsed.values.interactive) {
    return runInteractive({
      currentPrompt: rewrite.prompt,
      intent,
      context,
      runtime,
      model: modelResult.model,
      options,
      stderr,
    });
  }

  if (parsed.values.json) {
    stdout.write(`${JSON.stringify({
      prompt: rewrite.prompt,
      intent,
      model: `${modelResult.model.provider}/${modelResult.model.id}`,
    })}\n`);
  } else {
    stdout.write(`${rewrite.prompt}\n`);
  }

  if (parsed.values.copy) {
    try {
      writeClipboard(rewrite.prompt, clipboardOptions(options, stdout));
    } catch (error) {
      stderr.write(error?.code === "XT_NO_TTY"
        ? "xtprompt: clipboard copy requires a TTY control stream.\n"
        : "xtprompt: clipboard copy failed over OSC 52.\n");
      return 1;
    }
  }
  return 0;
}

function parseCliArgs(args) {
  return parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      model: { type: "string" },
      intent: { type: "string" },
      context: { type: "string" },
      "no-clarify": { type: "boolean" },
      json: { type: "boolean" },
      copy: { type: "boolean" },
      interactive: { type: "boolean", short: "i" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}

async function readDraft(positionals, options) {
  if (positionals.length > 0) return positionals.join(" ").trim();
  if (options.isInputTTY ?? process.stdin.isTTY) return "";
  const readStdin = options.readStdin ?? defaultReadStdin;
  return (await readStdin()).trim();
}

async function defaultReadStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function clarifyDraft(draft, noClarify, options) {
  if (!isVagueDraft(draft)) return draft;
  if (noClarify || !(options.isInputTTY ?? process.stdin.isTTY)) return undefined;
  const clarification = (await options.ask?.("xtprompt: What exact outcome should the rewrite target? "))?.trim();
  return clarification ? buildClarifiedDraft(draft, clarification) : undefined;
}

async function readContext(value, options) {
  if (!value) return "";
  if (!value.startsWith("@")) return normalizeContext(value);
  const path = value.slice(1);
  if (!path) throw new Error("missing path");
  const readFile = options.readFile;
  if (!readFile) {
    const { readFile: readFileFromDisk } = await import("node:fs/promises");
    return normalizeContext(await readFileFromDisk(path, "utf8"));
  }
  return normalizeContext(await readFile(path, "utf8"));
}

async function runInteractive({ currentPrompt, intent, context, runtime, model, options, stderr }) {
  const interactive = options.openInteractive?.();
  if (!interactive) {
    stderr.write("xtprompt: interactive terminal is unavailable.\n");
    return 1;
  }

  let current = currentPrompt;
  let previous;
  showPrompt(stderr, current);
  stderr.write("xtprompt: Enter refinement text, or :help for commands.\n");
  try {
    while (true) {
      let input;
      try {
        input = await interactive.read("xtprompt> ");
      } catch (error) {
        if (error?.code === "XT_SIGINT") {
          stderr.write("xtprompt: interrupted; exiting without copying.\n");
          return 130;
        }
        stderr.write("xtprompt: interactive input failed; current prompt was not copied.\n");
        return 1;
      }

      if (input === undefined) {
        stderr.write("xtprompt: end of input; exiting without copying.\n");
        return 0;
      }

      const line = input.trim();
      if (!line) continue;
      if (line === ":quit") {
        stderr.write("xtprompt: exiting without copying.\n");
        return 0;
      }
      if (line === ":show") {
        showPrompt(stderr, current);
        continue;
      }
      if (line === ":help") {
        stderr.write(INTERACTIVE_HELP);
        continue;
      }
      if (line === ":undo") {
        if (previous === undefined) {
          stderr.write("xtprompt: nothing to undo.\n");
          continue;
        }
        current = previous;
        previous = undefined;
        stderr.write("xtprompt: restored the previous prompt.\n");
        showPrompt(stderr, current);
        continue;
      }
      if (line === ":accept") {
        try {
          writeClipboard(current, clipboardOptions(options, options.stdout ?? process.stdout));
          stderr.write("xtprompt: copied to clipboard. Exiting.\n");
          return 0;
        } catch {
          stderr.write("xtprompt: clipboard copy failed; current prompt preserved. Fix terminal support or try :accept again.\n");
          continue;
        }
      }
      if (line.startsWith(":")) {
        stderr.write("xtprompt: unsupported command. Run :help.\n");
        continue;
      }

      const request = buildRefinementRequest({
        currentPrompt: current,
        instruction: line,
        intent,
        context,
      });
      const rewrite = await completeRewrite(runtime, model, request, options.signal);
      if (rewrite.error) {
        stderr.write(`xtprompt: ${rewrite.error} Current prompt preserved.\n`);
        continue;
      }
      previous = current;
      current = rewrite.prompt;
      stderr.write("xtprompt: prompt refined.\n");
      showPrompt(stderr, current);
    }
  } finally {
    try {
      interactive.close();
    } catch {
      // The command outcome is already explicit; closing an already-closed readline is harmless.
    }
  }
}

const INTERACTIVE_HELP = `Commands:
  :show    Show the current prompt
  :undo    Restore the previous valid prompt
  :help    Show these commands
  :accept  Copy the current prompt and exit
  :quit    Exit without copying
Free text refines the current prompt.
`;

function showPrompt(stderr, prompt) {
  stderr.write(`\n${prompt}\n\n`);
}

function clipboardOptions(options, stdout) {
  return {
    stream: options.controlStream === stdout ? undefined : options.controlStream,
    isTmux: Boolean((options.env ?? process.env).TMUX),
  };
}

async function completeRewrite(runtime, model, request, signal) {
  try {
    const primary = await completeOnce(runtime, model, request, signal);
    const parsed = parseSentinel(extractAssistantText(primary));
    if (isActionableRewrite(parsed)) return { prompt: parsed };

    const retried = await completeOnce(runtime, model, retryRequest(request), signal);
    const retriedParsed = parseSentinel(extractAssistantText(retried));
    return isActionableRewrite(retriedParsed)
      ? { prompt: retriedParsed }
      : { error: "model did not return an actionable <xtprompt> rewrite after one retry." };
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return { error: "model request timed out." };
    }
    return { error: "model request failed." };
  }
}

function isActionableRewrite(prompt) {
  return Boolean(prompt)
    && !isClarificationOnly(prompt)
    && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(prompt);
}
