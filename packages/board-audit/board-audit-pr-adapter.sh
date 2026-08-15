#!/usr/bin/env bash
# board-audit-pr-adapter — PR-checkpoint event adapter.
#
# Publishes a PR-checkpoint Board-Audit handoff for the current repository's
# pull request. It is trigger-agnostic: wire it as a client-side Git hook, run
# it from a self-hosted PR-event executor, or invoke it manually.
#
# A plain pre-push hook fires before the code push succeeds, so the adapter
# never fabricates a current handoff: the checkpoint command binds only the
# REMOTE PR head reported by gh, and pr-status flags any un-refreshed binding
# as STALE_CODE_HEAD until the next successful checkpoint.
#
# Automated invocation is fail-closed: set BOARD_AUDIT_PR_AUTHORIZED_REPOS
# (comma-separated owner/repo slugs, or *) to authorize lossless evidence
# publication for this repository.
set -euo pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
PR_FLOW="$SCRIPT_DIR/board-audit-pr.py"

PR="${1:-}"
if [ -z "$PR" ]; then
  PR="$(gh pr view --json number --jq .number 2>/dev/null || true)"
fi
if [ -z "$PR" ] || ! [[ "$PR" =~ ^[0-9]+$ ]]; then
  echo "board-audit-pr-adapter: no pull request for the current branch; nothing to publish" >&2
  exit 0
fi

export BOARD_AUDIT_PR_TRIGGER="${BOARD_AUDIT_PR_TRIGGER:-auto}"
exec python3 "$PR_FLOW" pr-checkpoint "$PR" "${@:2}"
