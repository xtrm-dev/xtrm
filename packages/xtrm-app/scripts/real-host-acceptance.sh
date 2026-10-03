#!/usr/bin/env bash
# Real-host acceptance runner for the Agent half (XTRM-601). Pattern from XTRM-605 e2e-loop-v2.sh.
#
# It installs a released xtrm-tools (the agent host and the xtrm-agent-host Pi extension it ships) into a
# mktemp prefix, never the operator's global install, and runs one Playwright project against it with:
# CI=1 (no reuse of a running Vite server), a temporary HOME, free host/app/front ports, a read-only
# SUBSTRATE_DB on the operator's board (the bridge runs with XTRM_SUBSTRATE_WRITES=0), and the
# Playwright browsers of the operator. The harness (e2e/real-host/harness.ts) adds the temp socket,
# the private tmux server and the isolated Pi agent dir that holds only the opencode-go credential.
#
# It refuses to start below MIN_AVAIL_MB of available memory, and after the run it reports leftovers
# (a host on this run's port, a live tmux server, harness temp dirs) and removes only its own temp dirs.
#
# Usage: scripts/real-host-acceptance.sh <out-dir> [playwright args...]
#   XT_VERSION=0.14.1 (default)  PW_CONFIG=playwright.acceptance.config.ts (default)
# Run it from packages/xtrm-app.
set -uo pipefail
OUT=${1:?usage: real-host-acceptance.sh <out-dir> [playwright args...]}
shift
XT_VERSION=${XT_VERSION:-0.14.1}
PW_CONFIG=${PW_CONFIG:-playwright.acceptance.config.ts}
MIN_AVAIL_MB=${MIN_AVAIL_MB:-3072}
APP=$(pwd)
[ -f "$APP/package.json" ] && grep -q '"name": "@xtrm/xtrm-app"' "$APP/package.json" || { echo "run from packages/xtrm-app"; exit 2; }

avail_mb() { awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo; }
free_port() { node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }

am=$(avail_mb)
if [ "$am" -lt "$MIN_AVAIL_MB" ]; then echo "PAUSE: MemAvailable ${am} MB < ${MIN_AVAIL_MB} MB"; exit 3; fi

C=$(mktemp -d -t xtrm601-acc-XXXXXX)
cleanup() {
  case "$C" in /tmp/xtrm601-acc-*) rm -rf "$C" ;; esac
  echo "cleanup: $C removed (exists now: $([ -e "$C" ] && echo yes || echo no))"
}
trap cleanup EXIT
mkdir -p "$OUT" "$C/home" "$C/prefix"

# The released host and extension, in a private prefix (HOME and the npm cache inside it as well).
( cd "$C/prefix" && HOME="$C/home" npm_config_prefix="$C/prefix" npm_config_cache="$C/npm-cache" npm i -g --no-audit --no-fund "xtrm-tools@$XT_VERSION" ) > "$OUT/install.log" 2>&1 \
  || { echo "install of xtrm-tools@$XT_VERSION failed; see $OUT/install.log"; exit 4; }
X="$C/prefix/lib/node_modules/xtrm-tools"
EXT_PKG="$X/packages/pi-extensions/package.json"
echo "xt $(node "$X/cli/dist/index.cjs" --version) from $X"
echo "extension $(node -p "const p=require('$EXT_PKG'); p.name+'@'+p.version") ($X/packages/pi-extensions/extensions/xtrm-agent-host)"
echo "xtrm $(git -C "$APP" rev-parse --short HEAD) (tree clean: $([ -z "$(git -C "$APP" status --porcelain)" ] && echo yes || echo no)); pi $(pi --version); memAvailable ${am} MB"

HP=$(free_port) AP=$(free_port) AP2=$(free_port) FP=$(free_port)
tmux_before=$(ls /tmp/tmux-$(id -u)/ 2>/dev/null | sort)
start=$(date +%s)
env CI=1 HOME="$C/home" \
  PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" npm_config_cache="$C/npm-cache" \
  XTRM_CORE_DIR="$X" XTRM_REAL_HOST_XT="$X/cli/dist/index.cjs" \
  XTRM_REAL_HOST_AUTH="${XTRM_REAL_HOST_AUTH:-$HOME/.pi/agent/auth.json}" SUBSTRATE_DB="${SUBSTRATE_DB:-$HOME/.xtrm/state.db}" \
  XTRM_REAL_HOST_PORT="$HP" XTRM_REAL_HOST_APP_PORT="$AP" XTRM_REAL_HOST_APP_PORT2="$AP2" XTRM_REAL_HOST_FRONT_PORT="$FP" \
  npx playwright test -c "$PW_CONFIG" "$@" > "$OUT/playwright.out" 2>&1
rc=$?

newest=$(ls -t "$APP"/.receipts/real-host/run-*.log 2>/dev/null | head -1)
[ -n "$newest" ] && cp "$newest" "$OUT/harness.log"
[ -f "$APP/e2e/.results/acceptance-report.json" ] && cp "$APP/e2e/.results/acceptance-report.json" "$OUT/report.json"
[ $rc -ne 0 ] && [ -d "$APP/e2e/.results/acceptance" ] && cp -r "$APP/e2e/.results/acceptance" "$OUT/results"
hostleft=$(pgrep -f -- "--port $HP" | tr '\n' ' ')
newtmux=$(comm -13 <(echo "$tmux_before") <(ls /tmp/tmux-$(id -u)/ 2>/dev/null | sort) | tr '\n' ' ')
live=""; for t in $newtmux; do tmux -L "$t" -f /dev/null list-sessions >/dev/null 2>&1 && live="$live $t"; done
tmpleft=$(find /tmp -maxdepth 1 \( -name 'xtrm-572-*' -o -name 'xh-*' -o -name 'xtrm-601-device-*' \) -newermt "@$start" 2>/dev/null | tr '\n' ' ')
echo "exit=$rc duration=$(( $(date +%s) - start ))s hostPort=$HP appPorts=$AP,$AP2 frontPort=$FP memAvailAfter=$(avail_mb)MB $(grep -E '[0-9]+ (passed|failed|flaky|skipped)' "$OUT/playwright.out" | tr -s ' ' | tr '\n' ' ') leftovers[host:${hostleft:-none} tmux:${live:-none} tmp:${tmpleft:-none}]"
exit $rc
