#!/bin/sh
# Fast pre-filter for the service-knowledge Claude Code hooks (XTRM-556).
#
# These hooks fire on EVERY tool call, and a `python3` spawn costs ~31 ms on the Mercury
# host before any application code runs (interpreter start + `json` import) — already over
# the 20 ms per-call budget. This wrapper answers the only question the common path needs
# ("can this payload touch a registered service territory?") in awk (~2 ms), and execs the
# real hook only when the answer is maybe. A proven NO is a no-op, exactly as the hook
# itself would have decided, at roughly a sixth of the cost.
#
# Correctness rule: the filter may exit 0 ONLY when it can PROVE no territory matches.
# Every ambiguous input — Bash commands (dispatch/promotion gates and command-based
# territory matching), patterns using [...] character classes, a missing or stale index —
# falls through to the unmodified hook, which stays the single source of truth.
#
# usage: hook_prefilter.sh <pre|post> <script.py> [args...]
#   pre   -> skill_activator.py semantics (PreToolUse evidence/blocking)
#   post  -> drift_detector.py semantics (PostToolUse drift marker)
set -u

mode=${1:-}
script=${2:-}
[ -n "$mode" ] && [ -n "$script" ] || { printf '%s\n' "usage: $0 <pre|post> <script.py> [args...]" >&2; exit 0; }
shift 2

root=${CLAUDE_PROJECT_DIR:-}
self_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
index=$self_dir/../cache/territory.index

# Every fall-through below execs the hook with stdin UNTOUCHED. Draining stdin first
# would hand the hook EOF, and the hook treats unreadable input as a silent no-op --
# which would turn every miss into a skipped hook. No awk, or no usable index ->
# the hook stays authoritative.
command -v awk >/dev/null 2>&1 || exec python3 "$self_dir/$script" "$@"
[ -f "$index" ] || exec python3 "$self_dir/$script" "$@"

# The index records the registry it was built from; a newer registry means stale index.
registry=$(sed -n 1p "$index" 2>/dev/null)
[ -n "$registry" ] || exec python3 "$self_dir/$script" "$@"
[ -f "$registry" ] || exec python3 "$self_dir/$script" "$@"
[ "$index" -nt "$registry" ] || exec python3 "$self_dir/$script" "$@"

tmp=${TMPDIR:-/tmp}/sk-prefilter.$$.json
trap 'rm -f "$tmp"' EXIT INT TERM

# rc: 0 = proven no territory match; 3 = run the hook; 4 = undecided -> run the hook.
awk -v MODE="$mode" -v ROOT="$root" -v IDX="$index" -v TMP="$tmp" '
function startswith(s, p) { return substr(s, 1, length(p)) == p }
function rtrim(s) { sub(/\/+$/, "", s); return s }
# NOTE: mawk index() takes no start offset (unlike gawk), so walk manually.
# NB: no apostrophes anywhere in this awk program -- it lives inside shell single quotes.
function countocc(s, t,   n, p) {
  n = 0
  while ((p = index(s, t)) > 0) { n++; s = substr(s, p + length(t)) }
  return n
}

# fnmatch.translate for the subset we decide on: literals, * and ?. Callers must refuse
# any pattern containing [ or ] (character classes) instead of approximating them.
function fn2re(p,   out, i, ch, n) {
  out = "^"; n = length(p)
  for (i = 1; i <= n; i++) {
    ch = substr(p, i, 1)
    if (ch == "*") out = out ".*"
    else if (ch == "?") out = out "."
    else if (ch == "\\" || ch == "]" || ch == "[" || ch == "^" || ch == "$" || ch == "." ||
             ch == "|" || ch == "(" || ch == ")" || ch == "+" || ch == "{" || ch == "}")
      out = out "\\" ch
    else out = out ch
  }
  return out "$"
}

# Python: pattern.split("/*")[0].split("/**")[0]
function patbase(p,   i, t) {
  t = p
  i = index(t, "/*"); if (i > 0) t = substr(t, 1, i - 1)
  i = index(t, "/**"); if (i > 0) t = substr(t, 1, i - 1)
  return t
}
# Literal text before the first wildcard; pathlib.glob only ever matches below it.
function litprefix(p,   i) {
  i = index(p, "*")
  if (j = index(p, "?")) if (i == 0 || j < i) i = j
  if (j = index(p, "[")) if (i == 0 || j < i) i = j
  return i == 0 ? p : substr(p, 1, i - 1)
}

# Port of skill_activator.match_territory for one pattern. 1 = match, 0 = no, -1 = undecided.
function terr(rel, p,   first, last, prefix, suffix, rel_check, base, segs, re) {
  if (index(p, "[") > 0 || index(p, "]") > 0) return -1
  if (index(p, "**") > 0) {
    if (countocc(p, "**/") == 1) {
      first = index(p, "**/")
      prefix = substr(p, 1, first - 1)
      suffix = substr(p, first + 3)
      rel_check = startswith(rel, prefix) ? substr(rel, length(prefix) + 1) : rel
      if (rel_check ~ fn2re(suffix)) return 1
      re = fn2re(prefix "*/" suffix)
      if (rel ~ re) return 1
      if (prefix != "" && startswith(rel, rtrim(prefix))) return 1
    }
  } else if (rel ~ fn2re(p)) return 1
  base = patbase(p)
  if (base != "" && (rel == base || startswith(rel, base "/"))) return 1
  return 0
}

function extract(buf, key,   re, s) {
  re = "\"" key "\"[ \t]*:[ \t]*\"[^\"]*\""
  if (match(buf, re) == 0) return ""
  s = substr(buf, RSTART, RLENGTH)
  sub("^\"" key "\"[ \t]*:[ \t]*\"", "", s)
  sub("\"$", "", s)
  return s
}
function norm(p) { gsub(/\/\/+/, "/", p); gsub(/\/\.\//, "/", p); sub(/^\.\//, "", p); sub(/\/+$/, "", p); return p }

BEGIN {
  n = 0
  while ((getline line < IDX) > 0) { if (line != "") { n++; pat[n] = line } }
  close(IDX)
  buf = ""
}
{ buf = buf $0 "\n" }
function defer() { printf "%s", buf > TMP; close(TMP); exit 3 }
END {
  if (n == 0) { printf "%s", buf > TMP; close(TMP); exit 3 }
  tool = extract(buf, "tool_name")

  # Bash carries command-based territory matching plus the dispatch/promotion gates.
  # The activator must always see it.
  if (MODE == "pre" && tool ~ /Bash/) defer()

  fp = extract(buf, "file_path")
  if (MODE == "pre") {
    # The activator resolves file_path -> path -> notebook_path.
    if (fp == "") fp = extract(buf, "path")
    if (fp == "") fp = extract(buf, "notebook_path")
    # With no path at all the activator can never match: the value only feeds
    # `if file_path:`, so match stays None and it exits 0. Bash, the one tool that
    # matches on `command`, already deferred above.
    if (fp == "") exit 0
  } else {
    # check-hook reads tool_input.file_path and nothing else.
    if (fp == "") exit 0
  }

  rel = fp
  if (substr(fp, 1, 1) == "/") {
    # match_territory relativizes against the project root and returns False when the
    # path lies outside it, so no service can match.
    if (ROOT == "" || !(fp == ROOT || startswith(fp, ROOT "/"))) exit 0
    rel = (fp == ROOT) ? "." : substr(fp, length(ROOT) + 2)
  }
  rel = norm(rel)

  if (MODE == "post") {
    # find_service_for_path: pathlib.glob equality below the pattern literal prefix,
    # plus a base-prefix test against the raw input string.
    for (i = 1; i <= n; i++) {
      p = pat[i]
      base = patbase(p)
      if (base != "" && (fp == base || startswith(fp, base "/"))) { possible = 1; break }
      lp = litprefix(p)
      if (lp == "") {
        # A leading wildcard leaves no mandatory prefix. When the pattern holds no "/"
        # pathlib can only glob the root entry, so the basename test is exact.
        if (index(p, "/") == 0) {
          if (index(rel, "/") == 0 && rel ~ fn2re(p)) { possible = 1; break }
        } else {
          possible = 1; break            # undecidable without full glob semantics
        }
      } else if (startswith(rel, lp)) {
        possible = 1; break
      }
    }
  } else {
    for (i = 1; i <= n; i++) {
      r = terr(rel, pat[i])
      if (r != 0) { possible = 1; break }
    }
  }
  if (!possible) exit 0

  defer()
}
'
rc=$?

# rc 0 = proven no territory match: the hook would have been a no-op, so exit silently.
# Any other rc means the payload is preserved in $tmp and the real hook decides.
case $rc in
0) exit 0 ;;
*) exec python3 "$self_dir/$script" "$@" <"$tmp" ;;
esac