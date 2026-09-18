#!/bin/bash
# Build Storebase.app and wrap it in a DMG. Run this on a Mac with Xcode.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$ROOT/dist}"
DERIVED="${DERIVED:-$ROOT/.derived}"
DMG="$OUT/Storebase.dmg"
STAGE="$OUT/dmg"
INSTALL="${INSTALL:-1}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This has to run on a Mac. Open macos/Storebase.xcodeproj in Xcode, or copy this folder to a Mac and run ./make-dmg.sh" >&2
  exit 1
fi

if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  echo "Xcode isn’t finished setting up on this Mac. Run these once, then rerun ./make-dmg.sh:" >&2
  echo "  sudo xcodebuild -license" >&2
  echo "  sudo xcodebuild -runFirstLaunch" >&2
  exit 1
fi

# Same bundle id as the first agent build — if that process is still alive,
# launching Storebase.app just foregrounds the old faceless copy.
osascript -e 'tell application "Storebase" to quit' >/dev/null 2>&1 || true
killall -9 Storebase >/dev/null 2>&1 || true
sleep 1

mkdir -p "$OUT"
rm -rf "$STAGE" "$DMG" "$DERIVED"

# Ad-hoc unless TEAM_ID is set. Automatic signing with no team hangs Xcode 26
# in ProcessProductPackaging and dumps thousands of .pcm lines.
SIGN_ARGS=(
  CODE_SIGN_STYLE=Manual
  CODE_SIGN_IDENTITY="-"
  CODE_SIGNING_ALLOWED=YES
  CODE_SIGNING_REQUIRED=NO
  CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO
)
if [[ -n "${TEAM_ID:-}" ]]; then
  SIGN_ARGS=(CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM_ID")
elif [[ "${UNSIGNED:-}" == "1" ]]; then
  SIGN_ARGS=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO)
fi

ARCH="$(uname -m)"
echo "Building Storebase 1.14 for ${ARCH}…"
XCODE_LOG="$OUT/xcodebuild.log"
mkdir -p "$OUT"
XCODEBUILD=(
  xcodebuild
  -project "$ROOT/Storebase.xcodeproj"
  -scheme Storebase
  -configuration Release
  -derivedDataPath "$DERIVED"
  -destination "platform=macOS,arch=${ARCH}"
  ARCHS="${ARCH}"
  ONLY_ACTIVE_ARCH=YES
  "${SIGN_ARGS[@]}"
  build
)
if [[ "${VERBOSE:-}" == "1" ]]; then
  "${XCODEBUILD[@]}"
else
  if ! "${XCODEBUILD[@]}" -quiet >"$XCODE_LOG" 2>&1; then
    echo "Build failed. Last errors:" >&2
    grep -E "error:|warning:|BUILD FAILED" "$XCODE_LOG" | grep -v "SDKExplicitPrecompiledModules\|\.pcm" | tail -n 40 >&2 || true
    echo "Full log: $XCODE_LOG  (or VERBOSE=1 ./make-dmg.sh)" >&2
    exit 1
  fi
fi

APP="$DERIVED/Build/Products/Release/Storebase.app"
if [[ ! -d "$APP" ]]; then
  echo "Build finished but Storebase.app wasn’t at $APP" >&2
  exit 1
fi

cp "$ROOT/Storebase/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

if ! codesign --verify "$APP" >/dev/null 2>&1; then
  echo "No valid signature — ad-hoc signing so Finder treats it as an app."
  codesign --force --deep --sign - --options runtime --timestamp=none \
    --entitlements "$ROOT/Storebase/Storebase.entitlements" "$APP"
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

if [[ "$INSTALL" == "1" ]]; then
  echo "Replacing /Applications/Storebase.app"
  rm -rf /Applications/Storebase.app
  ditto "$APP" /Applications/Storebase.app
  xattr -cr /Applications/Storebase.app >/dev/null 2>&1 || true
  LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  if [[ -x "$LSREGISTER" ]]; then
    "$LSREGISTER" -f /Applications/Storebase.app >/dev/null 2>&1 || true
  fi
  touch /Applications/Storebase.app
  open /Applications/Storebase.app
fi

echo
echo "Storebase 1.14 → $DMG"
echo "You should see a cube icon, a Dock icon, and a window that says 1.14."
echo "If you still see a hard-drive glyph, Spotlight is opening the old copy — quit Storebase and open /Applications/Storebase.app"
if [[ "${UNSIGNED:-}" == "1" ]]; then
  echo "Unsigned: right-click Storebase.app → Open the first time, or xattr -cr /Applications/Storebase.app"
fi
