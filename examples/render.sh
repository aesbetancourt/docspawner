#!/usr/bin/env sh
# Send an example to a running docspawner worker and save the PDF in the example's folder.
# Usage: examples/render.sh <example>
#   example: a folder in examples/ with template.typ and data.json
# Example: examples/render.sh certificate-of-analysis   → examples/certificate-of-analysis/certificate-of-analysis.pdf
# Set DOCSPAWNER_URL when the worker is not at http://127.0.0.1:3000.
# Requires: curl, jq.
set -eu

example="${1:?usage: examples/render.sh <example>}"
dir="$(cd "$(dirname "$0")" && pwd)/$example"
out="$dir/$example.pdf"
url="${DOCSPAWNER_URL:-http://127.0.0.1:3000}"

if [ ! -f "$dir/template.typ" ] || [ ! -f "$dir/data.json" ]; then
  echo "Error: $dir must contain template.typ and data.json." >&2
  exit 1
fi

# Write to a temp file first, so a failed request never leaves a broken PDF.
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

status="$(
  jq -n \
    --rawfile template "$dir/template.typ" \
    --slurpfile data "$dir/data.json" \
    '{template: $template, data: $data[0], options: {timestamp: 1763251200}}' \
  | curl -sS -X POST "$url/render" \
      -H 'content-type: application/json' \
      --data-binary @- \
      -o "$tmp" \
      -w '%{http_code}'
)"

if [ "$status" != "200" ] || [ "$(head -c 5 "$tmp")" != "%PDF-" ]; then
  echo "Error: the request to $url/render failed with HTTP $status:" >&2
  cat "$tmp" >&2
  echo >&2
  echo "Check that docspawner runs at $url (GET $url/health shows a typstVersion), or set DOCSPAWNER_URL." >&2
  exit 1
fi

mv "$tmp" "$out"
echo "Saved $out ($(wc -c < "$out" | tr -d ' ') bytes)"
