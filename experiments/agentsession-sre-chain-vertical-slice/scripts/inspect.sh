#!/usr/bin/env bash
# One-shot chain observer.
# Merges forensics/messages/evidence/intents into ONE time-sorted stream.
#
# Usage:
#   scripts/inspect.sh                       # latest run
#   scripts/inspect.sh <chain-run-id>        # specific run
#   scripts/inspect.sh <chain-run-id> tail   # follow live (Ctrl+C to stop)
#   STATE_DIR=/some/where scripts/inspect.sh # override state dir
set -euo pipefail

STATE_DIR="${STATE_DIR:-$HOME/.cache/agentsession-sre-chain-vertical-slice}"
RUN="${1:-}"
MODE="${2:-once}"

if [[ -z "$RUN" ]]; then
  RUN=$(ls -t "$STATE_DIR" 2>/dev/null | grep -v smoke | grep -v verb | head -1 || true)
fi
if [[ -z "$RUN" || ! -d "$STATE_DIR/$RUN" ]]; then
  echo "no chain runs under $STATE_DIR" >&2
  exit 2
fi

B="$STATE_DIR/$RUN"

hdr() { printf '\n\033[1m=== %s ===\033[0m\n' "$*"; }

# ---- summary blocks -------------------------------------------------------
show_chain() {
  hdr "chain: $RUN"
  if [[ -f "$B/chain/resolved-chain.json" ]]; then
    jq -r '
      "chain_id: \(.chain_id)",
      "root_bead_id: \(.root_bead_id)",
      "created_at: \(.created_at)",
      "topology:",
      (.topology[] | "  \(.step_id | tostring)  role=\(.role)  class=\(.class)  needs=[\(.needs | join(","))]  model=\(.model)")
    ' "$B/chain/resolved-chain.json"
  else
    echo "(no resolved-chain.json)"
  fi
}

show_state() {
  hdr "state"
  if [[ -f "$B/chain/run-state.json" ]]; then
    jq -r '
      "status: \(.status)",
      "reviewer_verdict: \(.reviewer_verdict // "-")",
      "last_reduce_at: \(.last_reduce_at)",
      "steps:",
      (.steps | to_entries[] | "  \(.key): \(.value.status)  attempts=\(.value.attempts)  loops=\(.value.remediation_loops)  exec=\(.value.last_execution_id // "-")")
    ' "$B/chain/run-state.json"
  else
    echo "(no run-state.json)"
  fi
}

show_beads() {
  hdr "beads"
  if [[ -f "$B/chain/beads-map.json" ]]; then
    jq -r '
      "root: \(.root_bead_id)",
      "steps:",
      (.step_bead_ids | to_entries[] | "  \(.key) -> \(.value)")
    ' "$B/chain/beads-map.json"
  else
    echo "(no beads-map.json)"
  fi
}

# ---- unified event stream -------------------------------------------------
merge_stream() {
  local tmp
  tmp=$(mktemp)
  trap 'rm -f "$tmp"' RETURN

  # forensics facts
  if [[ -f "$B/forensics/events.jsonl" ]]; then
    jq -c '{ts, source:"fact", kind, who:(.role // .participant_id // "-"), detail:(.detail // "")}' \
      "$B/forensics/events.jsonl" >> "$tmp"
  fi

  # channel messages
  if [[ -f "$B/channels/messages.jsonl" ]]; then
    jq -c '
      {
        ts: .created_at,
        source: "msg",
        kind: .kind,
        who: .author.participant_role,
        detail: (
          "#" + (.id|tostring)
          + "  targets=[" + ((.audience.action_targets // []) | join(",")) + "]"
          + "  " + ((((if (.body | type) == "object" then (.body.summary // "") else (.body | tostring) end)) | tostring)[0:120])
          + (if ((.evidence_refs // []) | length) > 0
             then "  refs=[" + ((.evidence_refs // []) | join(",")) + "]"
             else "" end)
        )
      }' "$B/channels/messages.jsonl" >> "$tmp"
  fi

  # evidence envelopes
  if [[ -f "$B/evidence/index.jsonl" ]]; then
    jq -c '
      {
        ts: .created_at,
        source: "ev",
        kind: .kind,
        who: .producer_role,
        detail: (.evidence_id + "  " + ((.summary // "")[0:120]))
      }' "$B/evidence/index.jsonl" >> "$tmp"
  fi

  # scheduler intents (no ts of their own; use file order)
  if [[ -f "$B/chain/scheduler-intents.jsonl" ]]; then
    awk 'BEGIN{i=0} {i++; printf "%s\n", $0}' "$B/chain/scheduler-intents.jsonl" | \
      jq -c '
        {
          ts: "",
          source: "intent",
          kind: .kind,
          who: .participant_id,
          detail: (.step_id + "  attempt=" + (.attempt|tostring) + "  key=" + .idempotency_key)
        }' >> "$tmp" 2>/dev/null || true
  fi

  jq -sc 'sort_by(.ts)[]' "$tmp"
}

render() {
  jq -r '
    def pad(n): tostring | if length < n then . + (" " * (n - length)) else .[0:n] end;
    def col(c; s): "[" + c + "m" + s + "[0m";
    def src_col:
      if .source == "fact"     then "36"
      elif .source == "msg"    then "33"
      elif .source == "ev"     then "32"
      elif .source == "intent" then "35"
      else "0" end;
    def kind_short:
      if   .kind == "step.satisfied"   then "SAT  "
      elif .kind == "step.start"       then "START"
      elif .kind == "step.done"        then "DONE "
      elif .kind == "step.failed"      then "FAIL "
      elif .kind == "step.ready"       then "READY"
      elif .kind == "reviewer.verdict" then "VERD "
      elif .kind == "chain.close"      then "CLOSE"
      elif .kind == "escalation"       then "ESCLT"
      elif .kind == "message.rejected" then "MRJCT"
      elif .kind == "dispatch"         then "DISP "
      else .kind end;
    "\(((.ts // "") | if length >= 19 then .[11:19] else "--:--:--" end))  \(col(src_col; (.source | pad(6))))  \(kind_short | pad(24))  \((.who // "-") | pad(22))  \(.detail // "")"
  '
}

show_stream() {
  hdr "unified event stream (fact | msg | ev | intent) — time-sorted"
  merge_stream | render
}

show_evidence() {
  hdr "evidence bodies (summaries)"
  if [[ -f "$B/evidence/index.jsonl" ]]; then
    jq -r '"\(.evidence_id)  [\(.kind)]  by \(.producer_role) @ \(.step_id)\n  -> \(.summary)"' \
      "$B/evidence/index.jsonl"
  else
    echo "(none)"
  fi
}

show_messages() {
  hdr "messages (full summaries)"
  if [[ -f "$B/channels/messages.jsonl" ]]; then
    jq -r '"#\(.id) \(.kind)  by \(.author.participant_role)  targets=[\((.audience.action_targets // []) | join(","))]\n  summary: \((((if (.body | type) == "object" then (.body.summary // "-") else (.body | tostring) end)) | tostring)[0:220])\n  refs: [\((.evidence_refs // []) | join(","))]"' \
      "$B/channels/messages.jsonl"
  else
    echo "(none)"
  fi
}

show_paths() {
  hdr "artifact paths"
  find "$B" -maxdepth 2 -type f | sort
}

# ---- driver ---------------------------------------------------------------
case "$MODE" in
  tail)
    show_chain; show_state; show_beads
    show_stream
    hdr "following (Ctrl+C to stop)"
    tail -F "$B/forensics/events.jsonl" 2>/dev/null | \
      jq -c '{ts, source:"fact", kind, who:(.role // .participant_id // "-"), detail:(.detail // "")}' | \
      render
    ;;
  *)
    show_chain
    show_state
    show_beads
    show_stream
    show_evidence
    show_messages
    show_paths
    ;;
esac
