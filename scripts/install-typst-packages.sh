#!/usr/bin/env sh
# Install the allowlisted Typst packages (typst-packages/allowlist.typ) and their dependencies
# into typst-packages/. This is the only step that downloads packages: the worker renders offline.
# Already installed packages are reused, so running it again is fast.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

typst compile --root "$root" --package-cache-path "$root/typst-packages" \
  "$root/typst-packages/allowlist.typ" "$out/allowlist.pdf"
echo "Typst packages ready in typst-packages/"
