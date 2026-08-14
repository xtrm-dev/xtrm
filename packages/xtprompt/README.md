# @xtrm/xtprompt

CLI that turns a rough prompt into a structured prompt and can refine it interactively using models and credentials already configured for [Pi](https://github.com/earendil-works/pi-mono).

It uses `ModelRuntime.completeSimple()`. It does not create an `AgentSession`, load tools, persist conversations, or inspect the current project automatically.

## Install

```bash
npm install -g @xtrm/xtprompt
```

For local development:

```bash
npm install
npm link
```

## Usage

```bash
xtprompt "implement a health command for the cli"

echo "analyze this failure" | xtprompt \
  --model anthropic/claude-sonnet-4-6 \
  --intent analysis

xtprompt "plan the migration" --context @background.md --json

xtprompt --copy "write a release checklist for this package"

xtprompt --interactive "write a release checklist for this package"
# Free text refines the current prompt. Run :accept to copy it and exit.
```

Options:

```text
--model <provider/model>  Pi model to use (default: Pi setting, then first authenticated model)
--intent <intent>         auto, planning, analysis, development, refactor, generic
--context <text|@file>    Add up to 480 characters of advisory context
--no-clarify              Reject vague prompts instead of asking once
--json                    Emit { prompt, intent, model }
--copy                    Also copy the improved prompt through OSC 52
-i, --interactive         Refine until :accept or :quit
-h, --help                Show help
-v, --version             Show version
```

A vague prompt triggers one question when stdin is a terminal. Piped vague input fails with exit code 2 because the CLI cannot ask safely. Supply a more concrete prompt or select `--no-clarify` for explicit fail-fast behavior. A model response that only asks another clarification question is rejected and retried once as an actionable rewrite.

## Interactive mode

Interactive mode requires a TTY. It prints a startup hint for `:help` and keeps only the current prompt and one previous valid revision in memory. Because interactive acceptance copies the prompt itself, `--interactive` cannot be combined with the one-shot `--json` or `--copy` options.

```text
xtprompt> focus on security and tests  Refine the current prompt
xtprompt> :show                       Show the current prompt
xtprompt> :undo                       Restore the previous valid prompt
xtprompt> :help                       Show command help
xtprompt> :accept                     Copy through OSC 52 and exit
xtprompt> :quit                       Exit without copying
```

EOF also exits without copying. Ctrl-C exits without copying with code `130`. Unsupported commands produce a static diagnostic without reflecting terminal control bytes. Model failures preserve the current prompt. A clipboard failure preserves the prompt and returns to the command loop, so terminal support can be fixed before retrying `:accept` or exiting with `:quit`.

## Output and exit codes

- Plain one-shot mode writes only the improved prompt to stdout.
- JSON one-shot mode writes one JSON object to stdout.
- Interactive prompts, state changes, and diagnostics use the terminal on stderr; accepted content is copied rather than written to stdout.
- `--copy` preserves that stdout output and also sends the prompt through OSC 52 on the terminal control stream. Tmux uses its passthrough wrapper.
- Copying requires a TTY on stderr. Unsupported or redirected terminals retain the prompt on stdout, report the copy failure on stderr, and exit with code `1`.
- Diagnostics go to stderr and never include prompt text, resolved credentials, or model response bodies. Model rewrites containing unsafe terminal control bytes are rejected and retried rather than displayed.
- Exit code `0`: success.
- Exit code `1`: runtime or model failure.
- Exit code `2`: invalid input, options, context, or model selection.
- Exit code `130`: interactive mode interrupted by Ctrl-C.

## Context boundary

The standalone CLI has no Pi conversation context. `--context` is explicit, advisory, XML-escaped where required, and capped at 480 characters. Built-in providers and providers configured through Pi `models.json` are supported. Providers registered only by Pi extensions are not loaded.

## Development

```bash
npm test
npm run test:coverage
npm pack --dry-run
```
