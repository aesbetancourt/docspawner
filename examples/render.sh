#!/usr/bin/env bash
# Render examples with a running docspawner worker and report metrics for each document.
#
# Usage: examples/render.sh [-n RUNS] [-l REQUESTS] [-c CLIENTS] [example ...]
#   example      a folder in examples/ with template.typ and data.json (default: every example)
#   -n RUNS      render each example RUNS times and report min, mean and max (default: 1)
#   -l REQUESTS  when invoice is selected, send REQUESTS invoices from CLIENTS parallel clients and report latency and throughput (default: 20, 0 to skip)
#   -c CLIENTS   number of clients that send the invoice requests in parallel (default: 4)
#
# The PDF of the last run is saved in the example's folder, for example
# examples/invoice/invoice.pdf. Set DOCSPAWNER_URL when the worker is not at http://127.0.0.1:3000.
# Requires: curl 7.84 or later, jq, awk, perl.
set -euo pipefail

url="${DOCSPAWNER_URL:-http://127.0.0.1:3000}"
examples_dir="$(cd "$(dirname "$0")" && pwd)"
runs=1
load_requests=20
load_clients=4

while getopts "n:l:c:h" option; do
  case "$option" in
    n) runs="$OPTARG" ;;
    l) load_requests="$OPTARG" ;;
    c) load_clients="$OPTARG" ;;
    h) sed -n '2,12p' "$0"; exit 0 ;;
    *) exit 2 ;;
  esac
done
shift $((OPTIND - 1))

if ! [[ "$runs" =~ ^[1-9][0-9]*$ && "$load_clients" =~ ^[1-9][0-9]*$ && "$load_requests" =~ ^[0-9]+$ ]]; then
  echo "Error: -n and -c need a positive whole number, -l needs a whole number." >&2
  exit 2
fi

examples=()
for example in "$@"; do
  # Accept "invoice", "invoice/", and "examples/invoice".
  examples+=("$(basename "$example")")
done
if [ ${#examples[@]} -eq 0 ]; then
  for dir in "$examples_dir"/*/; do
    [ -f "$dir/template.typ" ] && examples+=("$(basename "$dir")")
  done
fi

if [ -t 1 ]; then
  bold=$'\033[1m'; dim=$'\033[2m'; green=$'\033[32m'; red=$'\033[31m'; reset=$'\033[0m'
else
  bold=""; dim=""; green=""; red=""; reset=""
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# --- The worker ------------------------------------------------------------------

if ! health="$(curl -sS --max-time 5 "$url/health")" || [ "$(jq -r '.typstVersion // empty' <<<"$health")" = "" ]; then
  echo "${red}Error:${reset} no docspawner worker at $url (GET /health must report a typstVersion)." >&2
  echo "Start one with 'pnpm start' or 'docker compose up -d', or set DOCSPAWNER_URL." >&2
  exit 1
fi

echo "${bold}docspawner${reset} at $url"
jq -r '"  Typst \(.typstVersion) · render slots \(.renders.maxConcurrent) · queue \(.renders.maxQueued) · now \(.renders.active) active, \(.renders.queued) queued"' <<<"$health"
echo "  ${runs} run(s) per example"
echo

# --- One render --------------------------------------------------------------------

# render <example> <output>: prints "status total_ms render_ms warnings bytes"
render() {
  local dir="$examples_dir/$1" out="$2"
  local curl_out status total_s
  curl_out="$(
    jq -n --rawfile template "$dir/template.typ" --slurpfile data "$dir/data.json" \
      '{template: $template, data: $data[0], options: {timestamp: 1763251200}}' \
    | curl -sS -X POST "$url/render" -H 'content-type: application/json' --data-binary @- \
        -D "$work/headers" -o "$out" -w '%{http_code} %{time_total} %{size_download}'
  )"
  read -r status total_s bytes <<<"$curl_out"
  local render_ms warnings
  render_ms="$(awk 'tolower($1)=="x-render-duration-ms:" {print $2+0}' "$work/headers")"
  warnings="$(awk 'tolower($1)=="x-typst-warnings:" {print $2+0}' "$work/headers")"
  awk -v s="$status" -v t="$total_s" -v r="${render_ms:-0}" -v w="${warnings:-0}" -v b="$bytes" \
    'BEGIN { printf "%s %.0f %s %s %s\n", s, t * 1000, r, w, b }'
}

pages_of() { LC_ALL=C grep -ao '/Type */Page[^s]' "$1" | wc -l | tr -d ' '; }
sha_of() { shasum -a 256 "$1" | cut -c1-12; }
human_size() { awk -v b="$1" 'BEGIN { if (b >= 1048576) printf "%.1f MB", b/1048576; else printf "%.0f KB", b/1024 }'; }

# --- Every example ---------------------------------------------------------------------

printf "${bold}%-24s %6s %8s %20s %10s %5s  %s${reset}\n" "Document" "Pages" "Size" "Worker ms (min/avg/max)" "Round trip" "Warn" "SHA-256"
failed=0
total_pages=0
total_bytes=0
total_render=0
documents=0
chart_names=()
chart_values=()
started=$(date +%s)

for example in "${examples[@]}"; do
  dir="$examples_dir/$example"
  if [ ! -f "$dir/template.typ" ] || [ ! -f "$dir/data.json" ]; then
    printf "%-24s ${red}%s${reset}\n" "$example" "missing template.typ or data.json"
    failed=1
    continue
  fi

  renders=()
  trips=()
  status=""
  for _ in $(seq "$runs"); do
    read -r status trip render_ms warnings bytes < <(render "$example" "$work/out.pdf")
    [ "$status" = "200" ] || break
    renders+=("$render_ms")
    trips+=("$trip")
  done

  if [ "$status" != "200" ] || [ "$(head -c 5 "$work/out.pdf")" != "%PDF-" ]; then
    printf "%-24s ${red}HTTP %s${reset}  %s\n" "$example" "$status" "$(head -c 300 "$work/out.pdf")"
    failed=1
    continue
  fi

  cp "$work/out.pdf" "$dir/$example.pdf"
  pages="$(pages_of "$dir/$example.pdf")"
  stats="$(printf '%s\n' "${renders[@]}" | awk 'NR==1{min=max=$1} {s+=$1; if($1<min)min=$1; if($1>max)max=$1} END{printf "%d / %d / %d", min, s/NR, max}')"
  avg_render="$(printf '%s\n' "${renders[@]}" | awk '{s+=$1} END{printf "%d", s/NR}')"
  avg_trip="$(printf '%s\n' "${trips[@]}" | awk '{s+=$1} END{printf "%d ms", s/NR}')"
  warn_color="$green"; [ "$warnings" != "0" ] && warn_color="$red"

  printf "%-24s %6s %8s %20s %10s ${warn_color}%5s${reset}  ${dim}%s${reset}\n" \
    "$example" "$pages" "$(human_size "$bytes")" "$stats" "$avg_trip" "$warnings" "$(sha_of "$dir/$example.pdf")"

  documents=$((documents + 1))
  total_pages=$((total_pages + pages))
  total_bytes=$((total_bytes + bytes))
  total_render=$((total_render + avg_render))
  chart_names+=("$example")
  chart_values+=("$avg_render")
done

# bar <label> <value> <max> <unit>: one horizontal bar, 40 characters for the max value
bar() {
  awk -v l="$1" -v v="$2" -v m="$3" -v u="$4" -v c="$green" -v r="$reset" 'BEGIN {
    n = (m > 0) ? int(v / m * 40 + 0.5) : 0
    s = ""; for (i = 0; i < n; i++) s = s "█"
    printf "  %-24s %s%s%s %s %s\n", l, c, s, r, v, u
  }'
}

if [ "$documents" -gt 0 ]; then
  echo
  echo "${bold}Time in the worker, one render at a time (mean)${reset}"
  max="$(printf '%s\n' "${chart_values[@]}" | sort -n | tail -1)"
  for i in "${!chart_names[@]}"; do
    bar "${chart_names[$i]}" "${chart_values[$i]}" "$max" "ms"
  done
fi

# --- Invoice under load ------------------------------------------------------------------

# percentile <p> <file>: the p-th percentile of the numbers in the file (nearest rank)
percentile() { sort -n "$2" | awk -v p="$1" '{v[NR]=$1} END { i = int(NR * p / 100 + 0.999); if (i < 1) i = 1; print v[i] }'; }

invoice="$examples_dir/invoice"
if [ "$load_requests" -gt 0 ] && [[ " ${examples[*]} " == *" invoice "* ]] && [ -f "$invoice/template.typ" ]; then
  echo
  echo "${bold}Invoice under load${reset}: $load_requests requests from $load_clients parallel clients"
  jq -n --rawfile template "$invoice/template.typ" --slurpfile data "$invoice/data.json" \
    '{template: $template, data: $data[0], options: {timestamp: 1763251200}}' >"$work/invoice.json"

  # Sample the worker every 100 ms to see how full the render slots and the queue get.
  (
    while :; do
      curl -s --max-time 1 "$url/health" | jq -r '"\(.renders.active) \(.renders.queued)"' 2>/dev/null || true
      sleep 0.1
    done
  ) >"$work/samples" &
  sampler=$!

  load_started="$(perl -MTime::HiRes=time -e 'printf "%.3f", time')"
  seq "$load_requests" | xargs -P "$load_clients" -I{} \
    curl -s -o /dev/null -X POST "$url/render" -H 'content-type: application/json' \
      --data-binary @"$work/invoice.json" \
      -w '%{http_code} %{time_total} %header{x-render-duration-ms}\n' >"$work/load"
  load_ended="$(perl -MTime::HiRes=time -e 'printf "%.3f", time')"
  kill "$sampler" 2>/dev/null || true
  wait "$sampler" 2>/dev/null || true

  awk '$1 == 200 { printf "%.0f\n", $2 * 1000 }' "$work/load" >"$work/trip"
  awk '$1 == 200 { print $3 + 0 }' "$work/load" >"$work/server"
  ok="$(wc -l <"$work/trip" | tr -d ' ')"
  busy="$(awk '$1 == 503' "$work/load" | wc -l | tr -d ' ')"
  other=$((load_requests - ok - busy))
  peak="$(awk 'NR==1{a=$1;q=$2} {if($1>a)a=$1; if($2>q)q=$2} END{printf "%d %d", a, q}' "$work/samples")"

  if [ "$ok" -gt 0 ]; then
    awk -v ok="$ok" -v s="$load_started" -v e="$load_ended" -v pages="$(pages_of "$invoice/invoice.pdf")" 'BEGIN {
      w = e - s
      printf "  Throughput   %.1f invoices/s · %.1f pages/s · %.1f s for the batch\n", ok / w, ok * pages / w, w
    }'
    printf "  Round trip   p50 %s ms · p95 %s ms · max %s ms\n" \
      "$(percentile 50 "$work/trip")" "$(percentile 95 "$work/trip")" "$(percentile 100 "$work/trip")"
    printf "  In worker    p50 %s ms · p95 %s ms · max %s ms (wait for a slot + Typst)\n" \
      "$(percentile 50 "$work/server")" "$(percentile 95 "$work/server")" "$(percentile 100 "$work/server")"
    solo=""
    for i in "${!chart_names[@]}"; do
      [ "${chart_names[$i]}" = "invoice" ] && solo="${chart_values[$i]}"
    done
    if [ -n "$solo" ]; then
      # Timing noise can make the difference negative when nothing waits.
      wait_ms=$(( $(percentile 50 "$work/server") - solo ))
      [ "$wait_ms" -lt 0 ] && wait_ms=0
      echo "  Slot wait    p50 about $wait_ms ms (in worker minus the $solo ms of one render alone)"
    fi
  fi
  read -r peak_active peak_queued <<<"${peak:-0 0}"
  echo "  Worker       peak $peak_active of $(jq -r '.renders.maxConcurrent' <<<"$health") slots busy · peak $peak_queued queued"
  if [ "$busy" -gt 0 ] || [ "$other" -gt 0 ]; then
    echo "  ${red}Results      $ok ok · $busy rejected as busy (503) · $other failed${reset}"
    failed=1
  else
    echo "  Results      ${green}$ok of $load_requests ok${reset}"
  fi
fi

# --- Summary ---------------------------------------------------------------------------

echo
if [ "$documents" -gt 0 ]; then
  awk -v d="$documents" -v p="$total_pages" -v b="$total_bytes" -v r="$total_render" -v n="$runs" 'BEGIN {
    printf "%d documents · %d pages · %.0f KB · %d ms render time for one copy of each", d, p, b/1024, r
    if (r > 0) printf " · %.1f pages/s", p / (r / 1000)
    printf "\n"
  }'
fi
after="$(curl -sS --max-time 5 "$url/health" | jq -r '"Worker after the run: \(.renders.active) active, \(.renders.queued) queued"')"
echo "$after · $(( $(date +%s) - started )) s wall time in total"
echo "${dim}PDFs saved next to each template: examples/<example>/<example>.pdf${reset}"
exit "$failed"
