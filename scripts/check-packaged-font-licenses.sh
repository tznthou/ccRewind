#!/usr/bin/env bash
# Check that the packaged app carries the bundled-font license files, byte for byte.
#
# The fonts in src/renderer/assets/fonts/ are under the SIL Open Font License 1.1, and
# src/renderer/assets/fonts/licenses/ holds their license texts plus fonts.json (source and SHA-256 of
# every font file; tests/fontLicenses.test.ts keeps it in step with the fonts). electron-builder copies
# that folder into the app through extraResources (electron-builder.yml). When the source folder is
# missing or moved, electron-builder only logs a warning and packages anyway, so the packaged copy is
# compared with the repo copy after `pnpm dist` (electron-smoke workflow) or `electron-builder --dir`.
#
# Usage: scripts/check-packaged-font-licenses.sh [dist-dir]   (default: dist)
# Exit:  0 identical; 1 files differ, or exist on one side only; 2 no packaged app or no licenses folder in it.
set -euo pipefail

dist="${1:-dist}"
src="src/renderer/assets/fonts/licenses"

case "$(uname -s)" in
  Darwin)
    app=$(find "$dist" -maxdepth 2 -name 'ccRewind.app' -type d -print -quit)
    if [ -z "$app" ]; then
      echo "ERROR: no ccRewind.app under $dist/" >&2
      exit 2
    fi
    packaged="$app/Contents/Resources/licenses/fonts"
    ;;
  MINGW* | MSYS* | CYGWIN*)
    packaged="$dist/win-unpacked/resources/licenses/fonts"
    ;;
  *)
    packaged="$dist/linux-unpacked/resources/licenses/fonts"
    ;;
esac

if [ ! -d "$packaged" ]; then
  echo "ERROR: $packaged does not exist (extraResources in electron-builder.yml?)" >&2
  exit 2
fi
if ! diff -r "$src" "$packaged"; then
  echo "ERROR: $packaged differs from $src" >&2
  exit 1
fi
echo "OK: $packaged matches $src"
ls -1 "$packaged"
