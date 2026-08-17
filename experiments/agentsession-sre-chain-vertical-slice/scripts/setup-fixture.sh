#!/usr/bin/env bash
# Recreate the synthetic tiny-repo fixture's git history.
# The chain roles run `git log`/`git show`/`git blame` against it via sre_exec,
# so the fixture needs to be an actual git repo — but its .git/ is intentionally
# NOT tracked in the outer repo. Run this once after cloning.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
FIX="$HERE/fixtures/tiny-repo"

if [[ ! -d "$FIX" ]]; then
  echo "fixture dir missing: $FIX" >&2
  exit 2
fi

if [[ -d "$FIX/.git" ]]; then
  echo "fixture already has .git/ — nothing to do"
  exit 0
fi

cd "$FIX"
git init -q
git config user.email fixture@example.com
git config user.name Fixture

# Snapshot the current tree as commit 1: "healthy limits".
# The fixture files already carry the "bad" limit (memory_limit: 64Mi) as the
# working state — we stage them, but first save a healthy copy for the first
# commit, then re-check-in the bad state as commit 2 to simulate the incident.
mv svc-b/config.yml svc-b/config.yml.bak
cat > svc-b/config.yml <<EOF
memory_limit: 512Mi
worker_count: 8
EOF
git add -A
git -c commit.gpgsign=false commit -qm "initial: two services with healthy limits"

mv svc-b/config.yml.bak svc-b/config.yml
git add -A
git -c commit.gpgsign=false commit -qm "svc-b: drop memory limit to 64Mi (BAD: OOMs at load)"

echo "fixture initialized:"
git log --oneline
