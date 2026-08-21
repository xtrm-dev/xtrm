# xts_hook — silent shell context hook for XTS (bash).
#
# Source this file (or install via `xts shellhook bash`), then enable the hook:
#
#   source .../hook.bash
#   PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND;}xts_hook"
#
# The hook records { cwd, shell, lastExitCode, recentCommands } to
# $XTS_STATE_DIR/xts/state.json (default ~/.local/state/xts/state.json)
# after every prompt. It must never print anything and must never fail
# visibly: all output is redirected, every step is guarded.

xts_state_base="${XTS_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}}"
xts_state_dir="$xts_state_base/xts"
xts_state_file="$xts_state_dir/state.json"
xts_cmds_file="$xts_state_dir/cmds.txt"

# Release-safe history policy: obvious credential-bearing commands are stored
# only as a marker. This is intentionally conservative; it is not a secret
# detector for arbitrary shell expansions.
xts_history_redact() {
  local xts_secret=$1
  case "$xts_secret" in
    *TOKEN=*|*token=*|*PASSWORD=*|*password=*|*PASSWD=*|*passwd=*|*API_KEY=*|*api_key=*|*SECRET=*|*secret=*|*AWS_SECRET_ACCESS_KEY=*|*OPENAI_API_KEY=*|*BEGIN\ PRIVATE\ KEY*|*ghp_*|*github_pat_*|*glpat-*|*sk-*)
      printf '%s' '[redacted]'
      ;;
    *) printf '%s' "$xts_secret" ;;
  esac
}

# Replace ", \, newline, tab with JSON-escaped forms. Multi-line commands are
# collapsed to a single line (a " " separator), which keeps the state file
# compact and valid JSON.
xts_json_escape() {
  local s=$1 out= i c
  out=
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      '"') out+='\"' ;;
      '\') out+='\\' ;;
      $'\t') out+='\t' ;;
      $'\n') out+=' ' ;;
      $'\r') out+=' ' ;;
      *) out+="$c" ;;
    esac
  done
  printf '%s' "$out"
}

# $1 -> json string (escaped) or ""
xts_json_field() {
  if [[ -n $1 ]]; then
    printf '"%s"' "$1"
  else
    printf '""'
  fi
}

xts_hook() {
  # Capture the previous command's exit status FIRST: any command run inside
  # this hook would overwrite $?.
  local xts_code=$?

  # Never touch the shell if the state directory is not writable.
  if [[ ! -d $xts_state_dir ]]; then
    mkdir -p "$xts_state_dir" 2>/dev/null || return 0
  fi
  chmod 700 "$xts_state_dir" 2>/dev/null || return 0
  [[ -w $xts_state_dir ]] || return 0

  # Last executed command (shell expansion happens in the caller's context).
  # `fc -ln` prefixes each entry with leading whitespace; strip it.
  local xts_last_cmd
  xts_last_cmd=$(fc -ln -1 2>/dev/null | tail -n 1)
  xts_last_cmd=${xts_last_cmd#"${xts_last_cmd%%[![:space:]]*}"}

  # Rolling ring of the last 10 commands. Redact before persistence and also
  # sanitize older entries when the ring is rewritten.
  if [[ -n $xts_last_cmd ]]; then
    local xts_safe_cmd
    xts_safe_cmd=$(xts_history_redact "$xts_last_cmd") || return 0
    printf '%s\n' "$xts_safe_cmd" >>"$xts_cmds_file" 2>/dev/null
  fi
  if [[ -f $xts_cmds_file ]]; then
    chmod 600 "$xts_cmds_file" 2>/dev/null || return 0
    local xts_tail xts_cmds_tmp
    xts_tail=$(tail -n 10 "$xts_cmds_file" 2>/dev/null) || return 0
    xts_cmds_tmp="$xts_cmds_file.tmp"
    : >"$xts_cmds_tmp" 2>/dev/null || return 0
    while IFS= read -r xts_cmd; do
      xts_history_redact "$xts_cmd"
      printf '\n'
    done <<<"$xts_tail" >"$xts_cmds_tmp" 2>/dev/null
    chmod 600 "$xts_cmds_tmp" 2>/dev/null || return 0
    mv -f "$xts_cmds_tmp" "$xts_cmds_file" 2>/dev/null || return 0
  fi

  # Recent commands as a JSON array. Only read the ring when it exists
  # (no history yet in a fresh shell); the redirect is guarded and silent.
  local xts_json=()
  local xts_cmd xts_escaped
  if [[ -f $xts_cmds_file ]]; then
    while IFS= read -r xts_cmd; do
      xts_escaped=$(xts_json_escape "$xts_cmd") || xts_escaped=
      xts_json+=("$(xts_json_field "$xts_escaped")")
    done 2>/dev/null <"$xts_cmds_file"
  fi

  local xts_cmds_json
  xts_cmds_json=$(printf '%s,' "${xts_json[@]}" 2>/dev/null)
  xts_cmds_json="[${xts_cmds_json%,}]"

  local xts_cwd xts_shell xts_cwd_json
  xts_cwd=$(xts_json_escape "$PWD") || xts_cwd=
  xts_cwd_json=$(xts_json_field "$xts_cwd")
  xts_shell=bash

  # Atomic-ish write: build then rename, so a reader never sees a torn file.
  {
    printf '{'
    printf '"cwd":%s' "$xts_cwd_json"
    printf ',"shell":"%s"' "$xts_shell"
    printf ',"lastExitCode":%s' "$xts_code"
    printf ',"recentCommands":%s' "$xts_cmds_json"
    printf '}\n'
  } >"$xts_state_file.tmp" 2>/dev/null &&
    chmod 600 "$xts_state_file.tmp" 2>/dev/null &&
    mv -f "$xts_state_file.tmp" "$xts_state_file" 2>/dev/null &&
    chmod 600 "$xts_state_file" 2>/dev/null
  return 0
}

# Keep state dir from being spuriously re-created by the guard on shell exit.
true
