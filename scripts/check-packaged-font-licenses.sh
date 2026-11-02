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
# Usage: scripts/check-packaged-font-licenses.sh [dist-dir]   (default: dist; relative to the current directory)
# Exit:  0 every packaged copy is identical; 1 a copy differs (or has a file only one side has);
#        2 no dist folder, no packaged app in it, or an app without the licenses folder.
set -euo pipefail

dist_arg="${1:-dist}"
if [ ! -d "$dist_arg" ]; then
  echo "ERROR: $dist_arg does not exist" >&2
  exit 2
fi
dist=$(cd "$dist_arg" && pwd)
cd "$(dirname "$0")/.."
src="src/renderer/assets/fonts/licenses"

case "$(uname -s)" in
  Darwin)
    # every ccRewind.app (dist/mac, dist/mac-arm64, ...): checking only the first one would pass a stale layout
    targets=()
    while IFS= read -r app; do
      targets+=("$app/Contents/Resources/licenses/fonts")
    done < <(find "$dist" -maxdepth 2 -name 'ccRewind.app' -type d)
    ;;
  MINGW* | MSYS* | CYGWIN*)
    targets=("$dist/win-unpacked/resources/licenses/fonts")
    ;;
  *)
    targets=("$dist/linux-unpacked/resources/licenses/fonts")
    ;;
esac
if [ "${#targets[@]}" -eq 0 ]; then
  echo "ERROR: no ccRewind.app under $dist/" >&2
  exit 2
fi

rc=0
for packaged in "${targets[@]}"; do
  if [ ! -d "$packaged" ]; then
    echo "ERROR: $packaged does not exist (extraResources in electron-builder.yml?)" >&2
    rc=2
  elif ! diff -r "$src" "$packaged"; then
    echo "ERROR: $packaged differs from $src" >&2
    [ "$rc" -eq 2 ] || rc=1
  else
    echo "OK: $packaged matches $src"
    ls -1 "$packaged"
  fi
done
exit "$rc"
