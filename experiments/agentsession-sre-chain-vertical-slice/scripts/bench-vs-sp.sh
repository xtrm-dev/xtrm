#!/usr/bin/env bash
# A/B bench: direct createAgentSession vs sp RPC on the same SRE workload.
# No /usr/bin/time (not installed on this host) — sampler + bash wall.
set -uo pipefail

TRIALS="${TRIALS:-2}"
TARGET="${TARGET:-/home/dawid/projects/mercury/infra}"
BRIEF="${BRIEF:-Full-triage incident investigation (NOT ambient briefing): mercury infra is showing multiple firing alerts including ContainerJsonLogTooLarge on mmd-questdb, ServiceDown on ext-papers:8006, RestoreTestCritical on timescaledb. Fan out to ALL forensics specialists (host + observability + change) in parallel, synthesize their evidence into ranked hypotheses with concrete operator-applied fixes, and produce a full triage report. Do NOT do an ambient briefing — this is a full fan-out request.}"

DIRECT_DIR="/home/dawid/dev/xtrm/experiments/agentsession-sre-chain-vertical-slice"
PROGRESS=/tmp/svs-bench.log
SAMPLES=/tmp/svs-bench-samples.jsonl
: > $PROGRESS
: > $SAMPLES
rm -f /tmp/svs-bench-trial-*.log /tmp/svs-bench-trial-*.meta /tmp/svs-bench-summary.md

log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$PROGRESS"; }

tree_sampler() {
  local root_pid="$1" label="$2"
  while kill -0 "$root_pid" 2>/dev/null; do
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
      sum_cpu=$(awk -v a="$sum_cpu" -v b="${cpu:-0}" 'BEGIN{printf "%.1f", a+b}')
      count=$(( count + 1 ))
    done
    printf '{"ts":"%s","trial":"%s","pid_count":%d,"rss_kb":%d,"cpu_pct":%s}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" "$count" "$sum_rss" "$sum_cpu" >> "$SAMPLES"
    sleep 2
  done
}

run_trial() {
  local n="$1" side="$2"
  local label="trial-${n}-${side}"
  local runlog="/tmp/svs-bench-${label}.log"
  local metaf="/tmp/svs-bench-${label}.meta"

  log "[${label}] START (target=$TARGET)"
  local start_ms=$(($(date +%s%N)/1000000))

  if [[ "$side" == "direct" ]]; then
    (
      cd "$DIRECT_DIR"
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
      sp run sre-coordinator --no-keep-alive --prompt "$BRIEF" > "$runlog" 2>&1
    ) &
    local root_pid=$!
  fi

  tree_sampler "$root_pid" "$label" &
  local sampler_pid=$!

  wait "$root_pid"
  local exit_code=$?
  local end_ms=$(($(date +%s%N)/1000000))
  local wall_ms=$(( end_ms - start_ms ))

  kill "$sampler_pid" 2>/dev/null
  wait "$sampler_pid" 2>/dev/null

  local peak_kb avg_cpu peak_pids
  peak_kb=$(grep "\"trial\":\"${label}\"" "$SAMPLES" | jq -s 'map(.rss_kb) | max // 0')
  avg_cpu=$(grep "\"trial\":\"${label}\"" "$SAMPLES" | jq -s '(map(.cpu_pct | tonumber) | add) / (length | if . == 0 then 1 else . end) | . * 100 | round / 100')
  peak_pids=$(grep "\"trial\":\"${label}\"" "$SAMPLES" | jq -s 'map(.pid_count) | max // 0')

  printf '{"wall_ms":%d,"exit_code":%d,"peak_rss_kb":%d,"avg_cpu_pct":%s,"peak_pids":%d}\n' \
    "$wall_ms" "$exit_code" "$peak_kb" "$avg_cpu" "$peak_pids" > "$metaf"

  log "[${label}] DONE exit=$exit_code wall=${wall_ms}ms peak_rss=$(( peak_kb/1024 ))MB avg_cpu=${avg_cpu}% peak_pids=$peak_pids"
}

log "bench start: trials=${TRIALS} target=${TARGET}"
log "brief: ${BRIEF:0:80}..."

for n in $(seq 1 "$TRIALS"); do
  run_trial "$n" direct
  sleep 3
  run_trial "$n" sp
  sleep 3
done

{
  echo "# Bench summary — direct AgentSession vs sp RPC"
  echo
  echo "- Target: \`$TARGET\`"
  echo "- Trials per side: $TRIALS"
  echo "- Brief: $BRIEF"
  echo
  echo "| trial | side | wall (s) | peak RSS (MB) | avg CPU% | peak PIDs | exit |"
  echo "|---|---|---|---|---|---|---|"
  for n in $(seq 1 "$TRIALS"); do
    for side in direct sp; do
      label="trial-${n}-${side}"
      metaf="/tmp/svs-bench-${label}.meta"
      [[ -f "$metaf" ]] || continue
      wall_s=$(jq -r '.wall_ms/1000' "$metaf")
      peak_mb=$(jq -r '(.peak_rss_kb/1024) | round' "$metaf")
      cpu=$(jq -r '.avg_cpu_pct' "$metaf")
      pids=$(jq -r '.peak_pids' "$metaf")
      ec=$(jq -r '.exit_code' "$metaf")
      echo "| $n | $side | $wall_s | $peak_mb | $cpu | $pids | $ec |"
    done
  done
  echo
  echo "## Per-side averages"
  for side in direct sp; do
    echo
    echo "### $side"
    files=$(ls /tmp/svs-bench-trial-*-${side}.meta 2>/dev/null)
    [[ -z "$files" ]] && { echo "(no data)"; continue; }
    echo '```'
    jq -s '{
      trials: length,
      avg_wall_s: (map(.wall_ms) | add / length / 1000),
      avg_peak_rss_mb: (map(.peak_rss_kb) | add / length / 1024),
      avg_cpu_pct: (map(.avg_cpu_pct) | add / length),
      avg_peak_pids: (map(.peak_pids) | add / length)
    }' $files
    echo '```'
  done
} > /tmp/svs-bench-summary.md

log "bench done. summary: /tmp/svs-bench-summary.md"
