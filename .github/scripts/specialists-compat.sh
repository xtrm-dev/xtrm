#!/usr/bin/env bash
# specialists-compat.sh — bounded harness helpers for the private
# Specialists-compat workflow (bead xtrm-6qu.7.1.1).
#
# Log-hygiene rule: every subcommand prints only pass/fail lines, SHAs,
# package names/versions, and file paths. It never prints private source,
# packed artifacts, tokens, or file contents.
#
# Usage:
#   specialists-compat.sh guard-substrate <substrate-dir>
#   specialists-compat.sh verify-specialists <specialists-dir> <expected-sha>
#   specialists-compat.sh guard-seam <substrate-dir> <specialists-dir>
#   specialists-compat.sh prove-node <specialists-dir>
#   specialists-compat.sh clean-tree <dir>...
set -euo pipefail

fail() { echo "FAIL $*" >&2; exit 1; }
pass() { echo "ok $*"; }

cmd_guard_substrate() {
  local dir="${1:?substrate dir required}"
  [ -f "$dir/package.json" ] || fail "guard-substrate: no package.json in $dir"
  local identity
  identity="$(node --input-type=module -e 'import {readFileSync} from "node:fs";const p=JSON.parse(readFileSync(process.argv[1]+"/package.json","utf8"));process.stdout.write(p.name+"@"+p.version)' "$dir")"
  case "$identity" in "@xtrm/substrate@"*) ;;
    *) fail "guard-substrate: package identity is $identity, want @xtrm/substrate" ;;
  esac
  pass "guard-substrate: identity $identity"
  # Neutral-import guard (xtrm-6qu.7.4 invariant, mirrored from
  # tests/sqlite-runtime.test.ts): no STATIC value import of
  # node:sqlite/bun:sqlite anywhere — the opener selects the driver lazily
  # via conditional require() in src/store/sqlite.ts, so Bun 1.3.14 never
  # resolves its missing node:sqlite built-in. `import type` lines are
  # erased at runtime and safe.
  local offenders
  offenders="$(grep -rn --include='*.ts' -E "from ['\"](node|bun):sqlite['\"]" "$dir/src" "$dir/cli" "$dir/integrations" 2>/dev/null | grep -v 'import type' || true)"
  [ -z "$offenders" ] || fail "guard-substrate: static sqlite value import: $(printf '%s' "$offenders" | cut -d: -f1 | sort -u | tr '\n' ' ')"
  local reqoff
  reqoff="$(grep -rn --include='*.ts' -E "require\(['\"](node|bun):sqlite['\"]\)" "$dir/src" "$dir/cli" "$dir/integrations" 2>/dev/null | grep -v '^[^:]*src/store/sqlite\.ts:' || true)"
  [ -z "$reqoff" ] || fail "guard-substrate: sqlite require() outside src/store/sqlite.ts: $(printf '%s' "$reqoff" | cut -d: -f1 | sort -u | tr '\n' ' ')"
  pass "guard-substrate: neutral imports (lazy driver seam only in src/store/sqlite.ts)"
}

cmd_verify_specialists() {
  local dir="${1:?specialists dir required}"
  local want="${2:?expected SHA required}"
  [[ "$want" =~ ^[0-9a-f]{40}$ ]] || fail "verify-specialists: want is not a full 40-char SHA"
  [ -d "$dir/.git" ] || fail "verify-specialists: no git checkout in $dir"
  local got
  got="$(git -C "$dir" rev-parse HEAD)" || fail "verify-specialists: rev-parse failed"
  [ "$got" = "$want" ] || fail "verify-specialists: HEAD $got != input $want (fail closed)"
  pass "verify-specialists: HEAD == $want"
}

cmd_guard_seam() {
  local subdir="${1:?substrate dir required}"
  local specdir="${2:?specialists dir required}"
  # Substrate deep-import surface the opener consumes. If any file moves,
  # the parity run fails closed with work_item_store_unavailable; this
  # check surfaces the cause early with a path-only diagnostic.
  local f
  for f in src/store/migrations/runner.ts src/service/issue-service.ts src/service/journal-service.ts src/service/provenance-service.ts src/workitems/substrate-store.ts src/workitems/dispatch-gate.ts package.json; do
    [ -f "$subdir/$f" ] || fail "guard-seam: substrate surface missing: $f"
  done
  pass "guard-seam: substrate deep-import surface present (7 paths)"
  for f in src/activation/workitem-store.ts tests/integration/substrate-parity.test.ts package.json bun.lock; do
    [ -f "$specdir/$f" ] || fail "guard-seam: specialists surface missing: $f (SHA predates the A7 boundary)"
  done
  pass "guard-seam: specialists seam surface present (workitem-store.ts + parity test + lockfile)"
}

cmd_prove_node() {
  local dir="${1:?specialists dir required}"
  # Frozen install proof is a separate workflow step; here typecheck/build.
  # Each command's full output is captured to a local log file and only
  # the command name + PASS/FAIL reaches stdout: compiler output may echo
  # source snippets, which must never enter CI logs. Logs starting with
  # $RUNNER_TEMP are runner-local and never uploaded.
  local logbase="${RUNNER_TEMP:-${TMPDIR:-/var/tmp}}"
  run_quiet() {
    local name="$1"; shift
    local log="$logbase/prove-node-$name.log"
    if (cd "$dir" && "$@" >"$log" 2>&1); then
      rm -f -- "$log"
      pass "prove-node: $name PASS"
      return 0
    else
      local rc=$?
      echo "FAIL prove-node: $name (exit $rc) — log retained locally at $log, never uploaded" >&2
      return "$rc"
    fi
  }
  if node -e 'process.exit(typeof require(process.argv[1]+"/package.json").scripts?.typecheck === "string" ? 0 : 1)' "$dir" 2>/dev/null; then
    run_quiet typecheck bun run typecheck || return $?
  elif node -e 'process.exit(typeof require(process.argv[1]+"/package.json").scripts?.lint === "string" ? 0 : 1)' "$dir" 2>/dev/null; then
    run_quiet typecheck bun run lint || return $?
  elif [ -f "$dir/tsconfig.json" ]; then
    run_quiet typecheck bunx tsc --noEmit || return $?
  else
    fail "prove-node: no typecheck/lint script and no tsconfig.json"
  fi
  if node -e 'process.exit(typeof require(process.argv[1]+"/package.json").scripts?.build === "string" ? 0 : 1)' "$dir" 2>/dev/null; then
    # Build emits dist/ (not gitignored upstream), so remove it right
    # away: the clean-tree proof must see the pristine checkout.
    run_quiet build bun run build || rc=$?
    rm -rf -- "$dir/dist"
    [ "${rc:-0}" -eq 0 ] || exit "$rc"
  else
    pass "prove-node: build skipped (no build script; typecheck gates)"
  fi
}

cmd_clean_tree() {
  local d
  for d in "$@"; do
    [ -d "$d" ] || fail "clean-tree: not a directory: $d"
    local dirty
    dirty="$(git -C "$d" status --porcelain | head -n 10)"
    [ -z "$dirty" ] || fail "clean-tree: dirty tree in $d: $dirty"
    pass "clean-tree: $d clean ($(git -C "$d" rev-parse --short HEAD))"
  done
}

sub="${1:?subcommand required}"; shift
case "$sub" in
  guard-substrate) cmd_guard_substrate "$@" ;;
  verify-specialists) cmd_verify_specialists "$@" ;;
  guard-seam) cmd_guard_seam "$@" ;;
  prove-node) cmd_prove_node "$@" ;;
  clean-tree) cmd_clean_tree "$@" ;;
  *) fail "unknown subcommand: $sub" ;;
esac
