#!/bin/sh
# Render a PNG of every page of every example, for the README gallery.
# Usage: pnpm previews (run pnpm packages first)
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/docs/images/examples"
mkdir -p "$out"

# Render like the worker: no downloads and an empty package cache, so a package outside the allowlist fails here too.
cache="$(mktemp -d)"
trap 'rm -rf "$cache"' EXIT
export HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 NO_PROXY=

for dir in "$root"/examples/*/; do
  name="$(basename "$dir")"
  [ -f "$dir/template.typ" ] || continue
  rm -f "$out/$name"-*.png
  "${TYPST_BIN:-typst}" compile --root "$dir" --package-path "$root/typst-packages" \
    --package-cache-path "$cache" --ignore-system-fonts \
    --creation-timestamp 1763251200 --ppi 60 "$dir/template.typ" "$out/$name-{p}.png"
  echo "Rendered docs/images/examples/$name-*.png"
done
