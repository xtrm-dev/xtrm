#!/usr/bin/env bash
# install-beads-hooks.sh — durable installation of the Beads/Dolt sync hooks.
#
# `bd hooks install` creates the thin shims but NOT the custom Dolt-sync
# chaining: that block and the .bd-sync scripts are hand-added with no
# versioned source, so a fresh checkout silently loses them and a hand
# re-add can reintroduce the broken exit-status idiom. This installer:
#
#   1. refreshes the beads shims (bd hooks install);
#   2. copies the versioned .bd-sync scripts into the active hooks dir;
#   3. appends the custom chaining block to pre-push/post-merge when absent
#      (idempotent; preserved across reinstalls because it lives outside
#      bd's managed markers).
#
# The chaining MUST use the `if` idiom:
#     if [ $rc -ne 0 ]; then exit $rc; fi
# The `&&` form (`[ $rc -ne 0 ] && exit $rc`) makes the false `[` test the
# script's last command on success, so the hook exits 1 on every successful
# push/merge. Never regress to the `&&` form.
set -euo pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPTS_DIR="$(cd "$(dirname "$SELF")/hooks" && pwd)"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: run from inside the repository" >&2
  exit 1
fi
HOOKS_DIR="$(git rev-parse --git-path hooks)"   # respects core.hooksPath
mkdir -p "$HOOKS_DIR"

command -v bd >/dev/null 2>&1 || { echo "error: 'bd' not on PATH" >&2; exit 1; }
bd hooks install

for hook in pre-push post-merge; do
  cp -f "$SCRIPTS_DIR/$hook.bd-sync" "$HOOKS_DIR/$hook.bd-sync"
  chmod 700 "$HOOKS_DIR/$hook.bd-sync"

  target="$HOOKS_DIR/$hook"
  if [ -f "$target" ] && grep -q "$hook.bd-sync" "$target"; then
    echo "preserved existing $hook chaining in $target"
    continue
  fi
  cat >> "$target" <<EOF

# --- BEGIN custom: beads/dolt sync before $hook ---
# Outside bd's managed markers (bd hooks install/upgrade won't clobber).
# Commits pending Beads changes, then pulls and pushes the Dolt remote
# (refs/dolt/data on the GitHub origin). Fails the Git operation on sync failure.
if [ -x "\$(dirname "\$0")/$hook.bd-sync" ]; then
    _bd_timeout=\${BEADS_HOOK_TIMEOUT:-300}
    if command -v timeout >/dev/null 2>&1; then
        timeout "\$_bd_timeout" "\$(dirname "\$0")/$hook.bd-sync" "\$@"
    else
        "\$(dirname "\$0")/$hook.bd-sync" "\$@"
    fi
    rc=\$?
    if [ \$rc -ne 0 ]; then exit \$rc; fi
fi
# --- END custom ---
EOF
  echo "appended $hook chaining to $target"
done

echo "✓ Beads/Dolt sync hooks installed (idempotent; run again after bd upgrades)"
