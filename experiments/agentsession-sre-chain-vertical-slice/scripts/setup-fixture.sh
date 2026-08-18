#!/usr/bin/env bash
# Recreate the synthetic tiny-repo fixture's git history for ONE of the two
# semantic scenarios required by the reconciliation pass.
#
# Usage:
#   scripts/setup-fixture.sh                       # default: true-regression
#   scripts/setup-fixture.sh true-regression       # real 512Mi -> 64Mi change
#   scripts/setup-fixture.sh false-premise         # narrative false; value never changed
#   FORCE=1 scripts/setup-fixture.sh <scenario>    # wipe existing .git/ first
#
# The chain roles run `git log`/`git show`/`git blame` against the fixture via
# sre_exec, so the fixture needs to be a real git repo — but its .git/ is
# intentionally NOT tracked in the outer repo. Run this once after cloning.
#
# Semantic scenarios (see experiment-report.md §4.1):
#
#   true-regression
#     Commit 1: svc-b/config.yml memory_limit: 512Mi  (healthy)
#     Commit 2: svc-b/config.yml memory_limit: 64Mi   (BAD — real regression)
#     Expected chain conclusion: evidence-backed root cause = the value did
#     change; recommend operator-applied rollback under read-only posture.
#
#   false-premise
#     Commit 1: svc-b/config.yml memory_limit: 64Mi with an in-file comment
#       "# recent change (t-5m): dropped memory limit from 512Mi to 64Mi"
#     Commit 2: same file with the COMMENT deleted (value unchanged: still 64Mi)
#     Expected chain conclusion: challenge/refute the operator claim; cite git
#     evidence showing memory_limit is 64Mi at every commit; recommend against
#     reverting an irrelevant commit; keep residual uncertainty about whether
#     64Mi itself is bad without runtime evidence.
#
# The two fixtures deliberately look similar at the incident-brief level.
# Discrimination is a repository-truth test, not a prompt-wording test.
set -euo pipefail

SCENARIO="${1:-true-regression}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
FIX="$HERE/fixtures/tiny-repo"

case "$SCENARIO" in
  true-regression|false-premise) ;;
  *) echo "unknown scenario: $SCENARIO (want: true-regression | false-premise)" >&2; exit 2;;
esac

if [[ ! -d "$FIX" ]]; then
  echo "fixture dir missing: $FIX" >&2
  exit 2
fi

if [[ -d "$FIX/.git" ]]; then
  if [[ "${FORCE:-0}" == "1" ]]; then
    rm -rf "$FIX/.git"
  else
    # Same-scenario short-circuit: read stamp from README trailer.
    if grep -q "^scenario: $SCENARIO$" "$FIX/README.md" 2>/dev/null; then
      echo "fixture already at scenario '$SCENARIO' — nothing to do"
      exit 0
    fi
    echo "fixture .git/ present but scenario stamp does not match ('$SCENARIO')." >&2
    echo "Re-run with FORCE=1 scripts/setup-fixture.sh $SCENARIO to overwrite." >&2
    exit 3
  fi
fi

cd "$FIX"

# Reset README to base + scenario stamp so the discriminator is deterministic.
cat > README.md <<EOF
# Tiny SRE Fixture

Deterministic fixture for the AgentSession SRE chain vertical slice.
Simulates a two-service system where svc-b OOM-loops after a recent config
change to svc-b/config.yml.

scenario: $SCENARIO
EOF

# Reset svc-a to a stable healthy state (identical across scenarios).
cat > svc-a/config.yml <<'EOF'
healthy: true
EOF

git init -q
git config user.email fixture@example.com
git config user.name Fixture

case "$SCENARIO" in
  true-regression)
    # Commit 1: healthy 512Mi.
    cat > svc-b/config.yml <<'EOF'
memory_limit: 512Mi
worker_count: 8
EOF
    git add -A
    git -c commit.gpgsign=false commit -qm "initial: two services with healthy limits"

    # Commit 2: drop memory limit — real regression.
    cat > svc-b/config.yml <<'EOF'
memory_limit: 64Mi
worker_count: 8
EOF
    git add -A
    git -c commit.gpgsign=false commit -qm "svc-b: drop memory limit to 64Mi (BAD: OOMs at load)"
    ;;

  false-premise)
    # Commit 1: value is ALREADY 64Mi, with a comment mentioning a prior drop.
    cat > svc-b/config.yml <<'EOF'
memory_limit: 64Mi
worker_count: 8
# recent change (t-5m): dropped memory limit from 512Mi to 64Mi
EOF
    git add -A
    git -c commit.gpgsign=false commit -qm "initial: two services (svc-b memory tight)"

    # Commit 2: delete the comment. Value UNCHANGED. This is the commit the
    # operator will falsely blame — the diff is a single-line comment removal.
    cat > svc-b/config.yml <<'EOF'
memory_limit: 64Mi
worker_count: 8
EOF
    git add -A
    git -c commit.gpgsign=false commit -qm "svc-b: tidy config (drop stale change note)"
    ;;
esac

echo "fixture initialized for scenario: $SCENARIO"
git log --oneline
