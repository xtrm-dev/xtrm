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
    mkdir -p "$xts_state_dir" 2>/dev/null || return 0
  fi
  [[ -w $xts_state_dir ]] || return 0

  # Last executed command. $history is a tied associative array; HISTCMD is
  # the index of the next command, so HISTCMD-1 is the previous one.
  local xts_last_cmd=""
  (( HISTCMD > 1 )) && xts_last_cmd="$history[$((HISTCMD - 1))]"

  if [[ -n $xts_last_cmd ]]; then
    printf '%s\n' "$xts_last_cmd" >>"$xts_cmds_file" 2>/dev/null
    local xts_tail
    xts_tail=$(tail -n 10 "$xts_cmds_file" 2>/dev/null) || return 0
    printf '%s\n' "$xts_tail" >"$xts_cmds_file" 2>/dev/null
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

  {
    printf '{'
    printf '"cwd":%s' "$xts_cwd_json"
    printf ',"shell":"zsh"'
    printf ',"lastExitCode":%s' "$xts_code"
    printf ',"recentCommands":%s' "$xts_cmds_json"
    printf '}\n'
  } >"$xts_state_file.tmp" 2>/dev/null && mv -f "$xts_state_file.tmp" "$xts_state_file" 2>/dev/null
  return 0
}

autoload -U add-zsh-hook
add-zsh-hook precmd xts_hook
