# Tailnet console deploy (xtrm-app)

Operational runbook for the always-on Console v2 instance. This is deployment
state, not architecture: read `docs/README.md` first for the app itself.

## What runs where

| item | value |
|---|---|
| route | `https://<host>.ts.net:8446` → `tailscale serve` → `http://127.0.0.1:5178` |
| supervisor | systemd user unit `xtrm-console-v2.service` (`Restart=always`, enabled, `Linger=yes`) |
| source tree | `~/.xtrm/console-v2` — a git **clone**, pinned to a detached commit on `origin/main` |
| UI revision | the clone's `HEAD`; `npm run research:dev` prints it on start |
| `sb` | the clone's own CLI, `packages/substrate/cli/sb-ux.ts` |
| research CLI | the clone's venv, `packages/research/.venv/bin/xtrm-research` |

## Why a pinned clone outside `~/dev`

`xt worktree reap` (daily, `--all-repos --roots ~/dev --artifacts-older-than 7d
--worktrees-older-than 14d`) discovers linked worktrees and regenerable
artifacts. A console served out of a session worktree therefore has a lifetime
measured in days, and a console served out of any tree under `~/dev` can lose
`node_modules` or `.venv` to artifact reclamation.

A clone at `~/.xtrm/console-v2` is invisible to the reaper: it is not a linked
worktree, and it is outside `--roots`. Verify after any reaper change:

```bash
xt worktree reap --all-repos --dry-run --json | python3 -c \
  "import json,sys; print([c['path'] for c in json.load(sys.stdin)['candidates'] if 'console-v2' in c['path']])"
# expect: []
```

## Why UI and CLI are the same revision

The unit sets `XTRM_SB_BIN` to the clone's `packages/substrate/cli/sb-ux.ts`
(a tracked executable; Node 24 runs the TypeScript directly). Two reasons:

- **No PATH dependence.** A systemd user unit has no nvm on `PATH`. Resolving
  `sb` by name fails with `spawn sb ENOENT`, which the console surfaces as
  "Substrate is unavailable".
- **No version skew.** The npm-published `sb` (0.2.1) does not implement
  `issue query --project`, which the board read model (XTRM-393) calls. The
  pinned checkout does. Pointing the bridge at the same revision as the UI
  removes the skew class instead of tracking it.

The research settings are resolved per-checkout by `scripts/research-dev.mjs`,
which prints all four identities on start and refuses to start when the CLI
belongs to another checkout or lacks a read verb the UI calls.

## Install on a fresh machine

```bash
git clone git@github.com:xtrm-dev/xtrm.git ~/.xtrm/console-v2
git -C ~/.xtrm/console-v2 checkout --detach origin/main
cd ~/.xtrm/console-v2/packages/xtrm-app && npm ci
cd ~/.xtrm/console-v2/packages/research && python3 -m venv .venv && ./.venv/bin/pip install -e '.[dev]'
mkdir -p ~/.config/systemd/user && cp ~/.xtrm/console-v2/packages/xtrm-app/deploy/xtrm-console-v2.service ~/.config/systemd/user/
# adjust the nvm node path in PATH and ExecStart if the pinned version differs
systemctl --user daemon-reload && systemctl --user enable --now xtrm-console-v2.service
```

An optional `git remote add local ~/dev/xtrm` gives the clone an offline fetch
source. Do not pin a session branch tip: the served commit must be reachable from
`origin/main`, so the revision can be audited and re-fetched by anyone.

`tailscale serve` must already map the tailnet port to `127.0.0.1:5178`; the
unit does not change the proxy.

## Update

A restart is the deploy. The unit serves the clone's `HEAD`, so the update is a
pin change plus a restart. The pin must be a commit on `origin/main`.

```bash
git -C ~/.xtrm/console-v2 fetch origin
git -C ~/.xtrm/console-v2 checkout --detach origin/main
cd ~/.xtrm/console-v2/packages/xtrm-app && npm ci
cd ~/.xtrm/console-v2/packages/research && ./.venv/bin/pip install -e '.[dev]'
systemctl --user restart xtrm-console-v2.service
```

Re-run `pip install -e` on every update: the console's research CLI is an
editable install of the clone, and a stale install reports the old revision.

## Verify

```bash
systemctl --user is-active xtrm-console-v2.service
journalctl --user -u xtrm-console-v2.service -n 20 --no-pager   # release identity banner
curl -s http://127.0.0.1:5178/xtrm-api/substrate/query?project=prj_xtrm\&limit=5 | head -c 200
curl -s https://<host>.ts.net:8446/xtrm-api/substrate/projects | head -c 120
```

Expected: `"ok":true` with `"command":"issue.query"` / `"command":"project.list"`.
An `"ok":false` envelope names the failing command and the exact binary the
bridge ran (`sb failed (bin=...)`).

## Failure modes

| symptom | cause | action |
|---|---|---|
| unit restarts in a loop, `--strictPort` error | port 5178 already held | find and stop the other dev server; the unit must own the port |
| `research:dev cannot start` | missing venv, missing registry, or CLI from another checkout | run the install step for `packages/research` |
| `"ok":false` + `unknown flag --project` | bridge running the npm-published `sb` instead of the clone's CLI | check `XTRM_SB_BIN` in the unit |
| console reachable, GitHub/programme panels fail | `console.service` (Console v1, `127.0.0.1:3030`) is down | `systemctl --user status console.service` |

## Known skew

The globally installed `sb` (npm `@jaggerxtrm/substrate` 0.2.1) predates the
bounded board read model, so `sb issue query` is unavailable to interactive
shells and to any other consumer that expects it. The console is insulated by
`XTRM_SB_BIN`. Releasing or installing a newer global `sb` is separate work.
