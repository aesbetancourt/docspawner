#!/bin/sh
# Render a PNG of every page of every example, for the README gallery.
# Usage: pnpm previews (run pnpm packages first)
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/docs/images/examples"
mkdir -p "$out"

for dir in "$root"/examples/*/; do
  name="$(basename "$dir")"
  [ -f "$dir/template.typ" ] || continue
  rm -f "$out/$name"-*.png
  typst compile --root "$dir" --package-path "$root/typst-packages" --ignore-system-fonts \
    --creation-timestamp 1763251200 --ppi 60 "$dir/template.typ" "$out/$name-{p}.png"
  echo "Rendered docs/images/examples/$name-*.png"
done
