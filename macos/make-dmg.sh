#!/bin/bash
# Build Storebase.app and wrap it in a DMG. Run this on a Mac with Xcode.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$ROOT/dist}"
DERIVED="${DERIVED:-$ROOT/.derived}"
DMG="$OUT/Storebase.dmg"
STAGE="$OUT/dmg"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This has to run on a Mac. Open macos/Storebase.xcodeproj in Xcode, or copy this folder to a Mac and run ./make-dmg.sh" >&2
  exit 1
fi

mkdir -p "$OUT" "$DERIVED"
rm -rf "$STAGE" "$DMG"

SIGN_ARGS=(CODE_SIGN_STYLE=Automatic)
if [[ -n "${TEAM_ID:-}" ]]; then
  SIGN_ARGS+=(DEVELOPMENT_TEAM="$TEAM_ID")
elif [[ "${UNSIGNED:-}" == "1" ]]; then
  SIGN_ARGS=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO)
fi

xcodebuild \
  -project "$ROOT/Storebase.xcodeproj" \
  -scheme Storebase \
  -configuration Release \
  -derivedDataPath "$DERIVED" \
  -destination 'generic/platform=macOS' \
  "${SIGN_ARGS[@]}" \
  build

APP="$DERIVED/Build/Products/Release/Storebase.app"
if [[ ! -d "$APP" ]]; then
  echo "Build finished but Storebase.app wasn’t at $APP" >&2
  exit 1
fi

mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/Storebase.app"
ln -s /Applications "$STAGE/Applications"

hdiutil create \
  -volname Storebase \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$DMG"

echo
echo "DMG → $DMG"
echo "Open it, drag Storebase onto Applications. Menu bar only — no Dock icon."
if [[ "${UNSIGNED:-}" == "1" ]]; then
  echo "Unsigned: right-click → Open the first time, or xattr -cr /Applications/Storebase.app"
fi
