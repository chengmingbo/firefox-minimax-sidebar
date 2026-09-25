#!/usr/bin/env bash
# Build an unsigned .xpi that can be loaded into Firefox via
# about:debugging → This Firefox → Load Temporary Add-on…
#
# Usage:  ./scripts/build.sh [version]
#
# The script assembles a fresh staging directory so we don't have to worry
# about the OS refusing to zip a file that's being written to.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(node -p "require('$ROOT/src/manifest.json').version")}"
STAGE="$ROOT/build/stage"
OUT="$ROOT/build/minimax-sidebar-${VERSION}.xpi"

rm -rf "$STAGE"
mkdir -p "$STAGE" "$ROOT/build"

# Copy everything under src/ to the stage root, preserving paths.
cp -R "$ROOT/src/." "$STAGE/"

# Sanity checks: manifest.json must be at the root, manifest_version present.
if ! command -v jq >/dev/null 2>&1; then
  if command -v python3 >/dev/null 2>&1; then
    validate() { python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$@"; }
  else
    echo "error: need jq or python3 for JSON validation" >&2
    exit 1
  fi
else
  validate() { jq -e . "$1" >/dev/null; }
fi

for f in "$STAGE/manifest.json" \
         "$STAGE/_locales/en/messages.json"; do
  validate "$f"
done

# Zip without compression (PNGs are already compressed) and with no extra
# metadata. Firefox requires the zip to contain manifest.json at the root.
( cd "$STAGE" && zip -X -q -0 -r "$OUT" . )

echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo
echo "To load: about:debugging → This Firefox → Load Temporary Add-on…"
echo "         → pick $OUT (Firefox ignores the .xpi extension for temp loads)."
