#!/usr/bin/env bash
# A1 (XTRM-252.14) single-command reproducible acceptance runner.
# Isolation mandatory: fresh HOME + temp store, never the real ~/.xtrm.
# Invokes the MIRROR's CLI via node (packages/substrate/cli/sb.ts), never PATH sb.
# Usage (from packages/substrate):
#   ./scripts/run-sbcloseout4-acceptance.sh [transcript-path]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRANSCRIPT="${1:-$HERE/../../docs/substrate/sbcloseout4-acceptance-transcript.md}"
A1_HOME="$(mktemp -d)"
A1_DB_DIR="$(mktemp -d)"
A1_DB="$A1_DB_DIR/state.db"
export HOME="$A1_HOME"
export SUBSTRATE_DB="$A1_DB"
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
unset SUBSTRATE_PROJECT || true
echo "A1 acceptance: HOME=$HOME SUBSTRATE_DB=$SUBSTRATE_DB mirror=$HERE" >&2
echo "node $(node --version), sb=$HERE/cli/sb.ts" >&2
node --test tests/sbcloseout4-acceptance.test.ts 2>&1 | tee "$TRANSCRIPT.new"
mv "$TRANSCRIPT.new" "$TRANSCRIPT"
echo "transcript: $TRANSCRIPT" >&2
rm -rf "$A1_HOME" "$A1_DB_DIR"
