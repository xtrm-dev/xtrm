#!/usr/bin/env bash
# board-audit-pr-adapter — PR-checkpoint event adapter.
#
# Publishes a FRESH PR-checkpoint Board-Audit handoff for every push to a
# pull-request branch. Wire it as a client-side pre-push hook (board-audit
# init does this), run it from a self-hosted PR-event executor, or invoke it
# manually.
#
# Post-delivery semantics from a pre-push hook: a plain pre-push fires BEFORE
# the code push succeeds, so it cannot truthfully bind the new head. This
# adapter therefore performs the code push itself (git push --no-verify,
# lease-protected against the remote SHA the hook observed), then runs the
# checkpoint against the now-remote PR head. The handoff is current, not
# stale, and any agent in the repository can verify it with:
#   board-audit pr-status <pr> --check
#
# The adapter never blocks the code push. A failed adapter (missing
# bd/gh/python3, export failure, transport failure) only warns; the code push
# proceeds. There is no allowlist: every PR produces its Board-Audit evidence.
#
# Protocol: as a pre-push hook, refspecs arrive on stdin as
#   <local ref> <local sha> <remote ref> <remote sha>
# and the remote name is argv[1]. Invoked directly with a PR number, it skips
# the push phase and checkpoints that PR.
set -uo pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
PR_FLOW="$SCRIPT_DIR/board-audit-pr.py"

REMOTE="${1:-origin}"
PR="${2:-}"

# Phase 0: if a PR number was given explicitly (direct/manual invocation),
# skip the push phase entirely and checkpoint that PR.
if [ -n "$PR" ] && [[ "$PR" =~ ^[0-9]+$ ]]; then
  export BOARD_AUDIT_PR_TRIGGER="${BOARD_AUDIT_PR_TRIGGER:-auto}"
  exec python3 "$PR_FLOW" pr-checkpoint "$PR" --trigger auto
fi

# Phase 1: perform the code push that git was about to do. Read the refspecs
# from stdin (pre-push protocol), skip tag refs and deletions, and push each
# branch ref with --no-verify (no recursion). Fast-forward and new-branch
# updates use a plain push; a non-fast-forward update (rebase/force workflow)
# is published under an exact lease pinned to the remote SHA the hook
# observed, so a concurrent remote change still fails closed.
refs=()
if [ ! -t 0 ]; then
  while read -r local_ref local_sha remote_ref remote_sha; do
    if [ -z "$local_ref" ]; then
      continue
    fi
    case "$local_ref" in
      refs/heads/*)
        if [ "$local_sha" != "0000000000000000000000000000000000000000" ]; then
          refs+=("$local_ref:$remote_ref:$local_sha:$remote_sha")
        fi
        ;;
    esac
  done
fi
for entry in "${refs[@]}"; do
  local_ref="${entry%%:*}"
  rest="${entry#*:}"
  remote_ref="${rest%%:*}"
  rest="${rest#*:}"
  local_sha="${rest%%:*}"
  remote_sha="${rest#*:}"
  zero="0000000000000000000000000000000000000000"
  if [ "$remote_sha" != "$zero" ] && ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
    echo "board-audit-pr-adapter: non-fast-forward update for $remote_ref; publishing under lease $remote_sha" >&2
    if ! git push --no-verify "--force-with-lease=$remote_ref:$remote_sha" "$REMOTE" "$local_ref:$remote_ref" 2>&1; then
      echo "board-audit-pr-adapter: code push failed (see above); skipping checkpoint" >&2
      exit 0
    fi
  else
    if ! git push --no-verify "$REMOTE" "$local_ref:$remote_ref" 2>&1; then
      echo "board-audit-pr-adapter: code push failed (see above); skipping checkpoint" >&2
      exit 0
    fi
  fi
done

# Phase 2: publish the checkpoint for the current branch's PR. Failures warn
# only; the code push has already landed and must never be reported as failed
# because evidence publication had a problem.
PR_NUMBER=""
if [ -n "${BOARD_AUDIT_PR_JSON:-}" ] && [ -f "$BOARD_AUDIT_PR_JSON" ]; then
  PR_NUMBER="$(python3 -c "import json,os;print(json.load(open(os.environ['BOARD_AUDIT_PR_JSON']))['number'])" 2>/dev/null || true)"
fi
if [ -z "$PR_NUMBER" ]; then
  PR_NUMBER="$(gh pr view --json number --jq .number 2>/dev/null || true)"
fi
if [ -z "$PR_NUMBER" ] || ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "board-audit-pr-adapter: no pull request for the current branch; nothing to publish" >&2
  exit 0
fi

export BOARD_AUDIT_PR_TRIGGER="${BOARD_AUDIT_PR_TRIGGER:-auto}"
if python3 "$PR_FLOW" pr-checkpoint "$PR_NUMBER" --trigger auto; then
  echo "board-audit-pr-adapter: published FRESH Board-Audit checkpoint for PR #$PR_NUMBER" >&2
else
  echo "board-audit-pr-adapter: WARNING — checkpoint for PR #$PR_NUMBER failed; the code push succeeded but the handoff may be stale or missing" >&2
fi
exit 0
