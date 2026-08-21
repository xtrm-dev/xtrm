# xts_hook — silent shell context hook for XTS (zsh).
#
# Source this file (or install via `xts shellhook zsh`), then enable the hook:
#
#   source .../hook.zsh
#   autoload -U add-zsh-hook; add-zsh-hook precmd xts_hook
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
  local xts_assignment='([[:alnum:]_]*([Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Aa][Ss][Ss][Ww][Dd]|[Ss][Ee][Cc][Rr][Ee][Tt])|[Aa][Pp][Ii][-_]?[Kk][Ee][Yy])[[:space:]]*=[[:space:]]*[^[:space:]]{8,}'
  local xts_flag='(--password|-p)(=|[[:space:]]+)[^[:space:]]+|-p[^[:space:]]+'
  local xts_bearer='([Bb]earer|[Tt]oken)[[:space:]]+[A-Za-z0-9._~+/=-]{8,}'
  local xts_pem='[Pp][Rr][Ii][Vv][Aa][Tt][Ee][[:space:]]+[Kk][Ee][Yy]|BEGIN[[:space:]]+[Rr][Ss][Aa][[:space:]]+[Pp][Rr][Ii][Vv][Aa][Tt][Ee][[:space:]]+[Kk][Ee][Yy]'
  if [[ "$xts_secret" =~ $xts_assignment || "$xts_secret" =~ $xts_flag || "$xts_secret" =~ $xts_bearer || "$xts_secret" =~ $xts_pem ]]; then
    printf '%s' '[redacted]'
    return 0
  fi
  case "$xts_secret" in
    *TOKEN=*|*token=*|*PASSWORD=*|*password=*|*PASSWD=*|*passwd=*|*API_KEY=*|*api_key=*|*SECRET=*|*secret=*|*AWS_SECRET_ACCESS_KEY=*|*OPENAI_API_KEY=*|*BEGIN\ PRIVATE\ KEY*|*ghp_*|*github_pat_*|*glpat-*|*sk-*)
      printf '%s' '[redacted]'
      ;;
    *) printf '%s' "$xts_secret" ;;
  esac
}

# Replace ", \, newline, tab with JSON-escaped forms. Multi-line commands are
# collapsed to a single line, which keeps the state file compact and valid.
# Note: zsh has no ${s:off:len} slicing (it reads ":i" as a modifier), so
# character extraction uses zsh's 1-based scalar subscript.
xts_json_escape() {
  local s=$1 out= c i
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s[$((i + 1))]}"
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

  if [[ ! -d $xts_state_dir ]]; then
    (umask 077; mkdir -p "$xts_state_dir") 2>/dev/null || return 0
  fi
  chmod 700 "$xts_state_dir" 2>/dev/null || return 0
  [[ -w $xts_state_dir ]] || return 0

  # Last executed command. In precmd, zsh's `fc -ln -1` is the stable
  # previous-event query; direct HISTCMD/history indexing is empty in some
  # non-interactive probes and varies with history options.
  local xts_last_cmd
  xts_last_cmd=$(fc -ln -1 2>/dev/null | tail -n 1)
  xts_last_cmd=${xts_last_cmd#"${xts_last_cmd%%[![:space:]]*}"}

  # Redact before persistence and sanitize older entries when the ring is
  # rewritten.
  if [[ -n $xts_last_cmd ]]; then
    local xts_safe_cmd
    xts_safe_cmd=$(xts_history_redact "$xts_last_cmd") || return 0
    (umask 077; printf '%s\n' "$xts_safe_cmd" >>"$xts_cmds_file") 2>/dev/null || return 0
  fi
  if [[ -f $xts_cmds_file ]]; then
    chmod 600 "$xts_cmds_file" 2>/dev/null || return 0
    local xts_tail xts_cmds_tmp
    xts_tail=$(tail -n 10 "$xts_cmds_file" 2>/dev/null) || return 0
    xts_cmds_tmp=$(umask 077; mktemp "$xts_state_dir/.cmds.XXXXXX") 2>/dev/null || return 0
    while IFS= read -r xts_cmd; do
      xts_history_redact "$xts_cmd"
      printf '\n'
    done <<<"$xts_tail" >"$xts_cmds_tmp" 2>/dev/null
    chmod 600 "$xts_cmds_tmp" 2>/dev/null || return 0
    mv -f "$xts_cmds_tmp" "$xts_cmds_file" 2>/dev/null || return 0
  fi

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

  local xts_cwd xts_cwd_json
  xts_cwd=$(xts_json_escape "$PWD") || xts_cwd=
  xts_cwd_json=$(xts_json_field "$xts_cwd")

  local xts_state_tmp
  xts_state_tmp=$(umask 077; mktemp "$xts_state_dir/.state.XXXXXX") 2>/dev/null || return 0
  {
    printf '{'
    printf '"cwd":%s' "$xts_cwd_json"
    printf ',"shell":"zsh"'
    printf ',"lastExitCode":%s' "$xts_code"
    printf ',"recentCommands":%s' "$xts_cmds_json"
    printf '}\n'
  } >"$xts_state_tmp" 2>/dev/null &&
    chmod 600 "$xts_state_tmp" 2>/dev/null &&
    mv -f "$xts_state_tmp" "$xts_state_file" 2>/dev/null &&
    chmod 600 "$xts_state_file" 2>/dev/null
  return 0
}

autoload -U add-zsh-hook
add-zsh-hook precmd xts_hook
