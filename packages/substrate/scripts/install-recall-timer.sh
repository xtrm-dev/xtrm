#!/usr/bin/env bash
# Install the Substrate recall index timer for the current user.
#
# Conditions:
#   - The caller is an unprivileged user with a working systemd user session.
#   - `sb` on PATH is version 0.2.6 or later and supports `recall-build`.
#
# Result:
#   - ~/.config/systemd/user/substrate-recall-index.{service,timer} exist.
#   - substrate-recall-index.timer is enabled and started.
#   - The index is built once immediately; later runs are timer-driven.
#
# The timer is a oneshot, not a daemon. It runs with Nice=10 and MemoryMax=150M.
# The indexer additionally applies a load gate and a single-writer lock.

set -euo pipefail

SB_BIN="${1:-$(command -v sb || true)}"
if [[ -z "${SB_BIN}" ]]; then
  echo "usage: $0 [path-to-sb]" >&2
  echo "error: sb is not on PATH; pass the path explicitly" >&2
  exit 2
fi
if [[ ! -x "${SB_BIN}" ]]; then
  echo "error: not executable: ${SB_BIN}" >&2
  exit 2
fi
if ! "${SB_BIN}" recall-build --help >/dev/null 2>&1; then
  echo "error: ${SB_BIN} does not support recall-build (need sb >= 0.2.6)" >&2
  exit 2
fi

UNIT_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOC_PATH="${HERE}/../contrib/systemd/substrate-recall-index.service"

mkdir -p "${UNIT_DIR}"
sed -e "s|@SB_BIN@|${SB_BIN}|g" -e "s|@DOC_PATH@|${DOC_PATH}|g" \
  "${HERE}/../contrib/systemd/substrate-recall-index.service" >"${UNIT_DIR}/substrate-recall-index.service"
cp -f "${HERE}/../contrib/systemd/substrate-recall-index.timer" "${UNIT_DIR}/substrate-recall-index.timer"

systemctl --user daemon-reload
systemctl --user enable --now substrate-recall-index.timer
systemctl --user start substrate-recall-index.service

echo "installed: ${UNIT_DIR}/substrate-recall-index.{service,timer}"
echo "status:    systemctl --user status substrate-recall-index.timer"
echo "index:     ${SUBSTRATE_RECALL_INDEX:-${HOME}/.xtrm/recall/index.sqlite}"
