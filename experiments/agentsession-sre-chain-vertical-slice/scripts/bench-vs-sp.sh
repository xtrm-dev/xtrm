#!/usr/bin/env bash
# A/B bench: direct createAgentSession vs sp RPC on the same SRE workload.
# Same brief, same target, N trials per side. Peak RSS + CPU + wall + tree-sampled.
#
# Outputs:
#   /tmp/svs-bench.log                — human progress
#   /tmp/svs-bench-samples.jsonl      — every 2s: {ts, trial, pid_count, rss_kb, cpu_pct}
#   /tmp/svs-bench-<label>-<n>.time   — /usr/bin/time -v output
#   /tmp/svs-bench-<label>-<n>.log    — stdout+stderr of the run itself
#   /tmp/svs-bench-summary.md         — final table

set -uo pipefail

TRIALS="${TRIALS:-2}"
TARGET="${TARGET:-/home/dawid/projects/mercury/infra}"
BRIEF="${BRIEF:-Baseline current infra state: what are the top 3-5 SRE observations right now? Any firing alerts, unhealthy containers, resource pressure, recent deploys, unrotated logs?}"

DIRECT_DIR="/home/dawid/dev/xtrm/experiments/agentsession-sre-chain-vertical-slice"

PROGRESS=/tmp/svs-bench.log
SAMPLES=/tmp/svs-bench-samples.jsonl
: > $PROGRESS
: > $SAMPLES
rm -f /tmp/svs-bench-*.time /tmp/svs-bench-*.log /tmp/svs-bench-summary.md

log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a $PROGRESS; }

# ---- process-tree sampler ------------------------------------------------
tree_sampler() {
  local root_pid="$1" label="$2"
  while kill -0 "$root_pid" 2>/dev/null; do
    # Collect descendant pids by walking the process tree
    local all_pids
    all_pids=$(pstree -p "$root_pid" 2>/dev/null | grep -oE '\([0-9]+\)' | tr -d '()' | sort -u)
    [ -z "$all_pids" ] && all_pids="$root_pid"
    local sum_rss=0 sum_cpu=0 count=0
    for pid in $all_pids; do
      local st
      st=$(ps -o rss=,pcpu= -p "$pid" 2>/dev/null | tr -s ' ' | sed 's/^ //')
      [ -z "$st" ] && continue
      local rss cpu
      rss=$(echo "$st" | awk '{print $1}')
      cpu=$(echo "$st" | awk '{print $2}')
      sum_rss=$(( sum_rss + ${rss:-0} ))
      sum_cpu=$(awk -v a="$sum_cpu" -v b="${cpu:-0}" 'BEGIN{print a+b}')
      count=$(( count + 1 ))
    done
    printf '{"ts":"%s","trial":"%s","pid_count":%d,"rss_kb":%d,"cpu_pct":%s}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" "$count" "$sum_rss" "$sum_cpu" >> $SAMPLES
    sleep 2
  done
}

# ---- one trial -----------------------------------------------------------
run_trial() {
  local n="$1" side="$2"
  local label="trial-${n}-${side}"
  local timef="/tmp/svs-bench-${label}.time"
  local runlog="/tmp/svs-bench-${label}.log"

  log "[${label}] START (target=$TARGET)"

  local start_ts=$(date +%s)
  if [[ "$side" == "direct" ]]; then
    (
      cd "$DIRECT_DIR"
      /usr/bin/time -v -o "$timef" \
        bun run src/cli/main.ts \
          --repo "$TARGET" \
          --incident "$BRIEF" \
          --state-dir "$HOME/.cache/agentsession-sre-chain-vertical-slice-bench" \
          > "$runlog" 2>&1
    ) &
    local root_pid=$!
  else
    (
      cd "$TARGET"
      /usr/bin/time -v -o "$timef" \
        sp run sre-coordinator --prompt "$BRIEF" \
          > "$runlog" 2>&1
    ) &
    local root_pid=$!
  fi

  tree_sampler "$root_pid" "$label" &
  local sampler_pid=$!

  wait "$root_pid"
  local exit_code=$?
  local end_ts=$(date +%s)
  local wall=$(( end_ts - start_ts ))

  kill "$sampler_pid" 2>/dev/null
  wait "$sampler_pid" 2>/dev/null

  local peak_rss_kb user_sec sys_sec
  peak_rss_kb=$(grep "Maximum resident set size" "$timef" 2>/dev/null | awk '{print $NF}')
  user_sec=$(grep "User time (seconds)" "$timef" 2>/dev/null | awk '{print $NF}')
  sys_sec=$(grep "System time (seconds)" "$timef" 2>/dev/null | awk '{print $NF}')
  local tree_peak_kb
  tree_peak_kb=$(grep "\"trial\":\"${label}\"" $SAMPLES | jq -s 'map(.rss_kb) | max // 0' 2>/dev/null)

  log "[${label}] DONE exit=$exit_code wall=${wall}s time_peak_rss=$(( ${peak_rss_kb:-0} / 1024 ))MB tree_peak_rss=$(( ${tree_peak_kb:-0} / 1024 ))MB user=${user_sec:-?}s sys=${sys_sec:-?}s"
}

# ---- main ----------------------------------------------------------------
log "bench start: trials=${TRIALS} target=${TARGET}"
log "brief: ${BRIEF:0:80}..."

for n in $(seq 1 "$TRIALS"); do
  run_trial "$n" direct
  sleep 3
  run_trial "$n" sp
  sleep 3
done

# ---- summary -------------------------------------------------------------
{
  echo "# Bench summary — direct AgentSession vs sp RPC"
  echo
  echo "Target: \`$TARGET\`"
  echo "Trials per side: $TRIALS"
  echo "Brief: $BRIEF"
  echo
  echo "| trial | side | wall (s) | time_peak_rss (MB) | tree_peak_rss (MB) | user CPU (s) | sys CPU (s) |"
  echo "|---|---|---|---|---|---|---|"
  for n in $(seq 1 "$TRIALS"); do
    for side in direct sp; do
      local_label="trial-${n}-${side}"
      timef="/tmp/svs-bench-${local_label}.time"
      [[ -f "$timef" ]] || continue
      peak_rss=$(grep "Maximum resident set size" "$timef" 2>/dev/null | awk '{print $NF}')
      user_s=$(grep "User time (seconds)" "$timef" 2>/dev/null | awk '{print $NF}')
      sys_s=$(grep "System time (seconds)" "$timef" 2>/dev/null | awk '{print $NF}')
      wall_s=$(grep "Elapsed (wall clock) time" "$timef" 2>/dev/null | awk -F'): ' '{print $NF}')
      tree_peak=$(grep "\"trial\":\"${local_label}\"" $SAMPLES 2>/dev/null | jq -s 'map(.rss_kb) | max // 0' 2>/dev/null)
      echo "| $n | $side | $wall_s | $(( ${peak_rss:-0}/1024 )) | $(( ${tree_peak:-0}/1024 )) | $user_s | $sys_s |"
    done
  done
} > /tmp/svs-bench-summary.md

log "bench done. summary: /tmp/svs-bench-summary.md"
