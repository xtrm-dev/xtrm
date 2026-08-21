# XTS — minimal terminal AI assistant for shell work

XTS is a minimal shell copilot built on the Pi SDK. It answers shell questions,
explains failures, and runs commands through a safety gate. See
[`xts-prd-0.1.0.md`](./xts-prd-0.1.0.md) for the product requirements.

## Usage

```bash
xts                          # interactive session
xts "question"               # one-shot question
command | xts                # question from piped stdin
xts run "command"            # run a command through the XTS safety gate
xts model                    # select the model
xts shellhook                # print the shell hook snippet
```

Flags:

```bash
xts --help                   # show usage
xts --version                # show version
xts --json                   # emit dev output as JSON
xts --show-prompt            # print the assembled prompt envelope and exit (no model call)
```

## Verification

```bash
npm test                     # full unit suite (node --test)
node test/perf.mjs           # startup/memory/prompt-size metrics table
node test/e2e.mjs            # end-to-end smoke (skips live-model steps when unauthenticated)
```

PRD §24 acceptance criteria 1–27 are mapped to concrete evidence in
[`test/acceptance.md`](./test/acceptance.md).

Recorded measurements (see `test/acceptance.md`): cold startup ~39 ms, warm ~45 ms,
time-to-first-TUI ~177 ms, system prompt ~89 tokens, tool schema ~128 tokens,
peak RSS ~46 MB — initialization overhead is far below typical model latency.

Note: run the full suite from a terminal or an isolated/background process;
some agent harnesses interact badly with the PTY-based e2e probes.

## Install

```bash
npm install -g @xtrm/xts
```

Requires Node.js >= 24.

## Dev

```bash
npm test                     # node --test
node src/cli.mjs --help      # run without installing
```

The package has no build step. Entrypoints are plain ESM (`.mjs`). The CLI
lazy-imports heavy modules (the Pi SDK) inside command handlers so `--help`
and `--version` stay fast.

Config lives at `~/.config/xtrm/xts.json`. Set `XTS_CONFIG_DIR` to override
the directory in tests or dev.
