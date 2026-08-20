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
```

Not-yet-implemented commands exit 1 with a message on stderr. `--help` and
`--version` work now.

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
