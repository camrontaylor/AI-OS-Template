#!/usr/bin/env bash
# Build "Command Centre.app" - a native macOS shell for the AI-OS command centre.
# Re-run this any time (e.g. after a logo change). It builds a fresh .app onto
# your Desktop. The server itself runs via launchd; this app is just the window.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/CommandCentre.swift"
LOGO="$HERE/../public/logo.png"
APP_NAME="Command Centre"
DEST="${1:-$HOME/Desktop}"           # pass a dir to override (e.g. ~/Applications)
APP="$DEST/$APP_NAME.app"
BUILD="$(mktemp -d)"

echo "==> compiling Swift"
swiftc "$SRC" -o "$BUILD/CommandCentre" -framework Cocoa -framework WebKit

echo "==> assembling app bundle"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
mv "$BUILD/CommandCentre" "$APP/Contents/MacOS/CommandCentre"
chmod +x "$APP/Contents/MacOS/CommandCentre"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Command Centre</string>
  <key>CFBundleDisplayName</key><string>Command Centre</string>
  <key>CFBundleIdentifier</key><string>app.aios.command-centre</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>CommandCentre</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

echo "==> building icon from logo.png"
if [ -f "$LOGO" ]; then
  ICONSET="$BUILD/icon.iconset"
  mkdir -p "$ICONSET"
  for sz in 16 32 128 256 512; do
    sips -z $sz $sz "$LOGO" --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null 2>&1
    sips -z $((sz*2)) $((sz*2)) "$LOGO" --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null 2>&1
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns" 2>/dev/null \
    && echo "    icon.icns created" || echo "    icon build skipped (using default)"
else
  echo "    logo.png not found at $LOGO - using default icon"
fi

echo "==> ad-hoc code signing (lets it launch without a developer account)"
# Clear extended attributes first, or codesign rejects the bundle as "detritus".
xattr -cr "$APP" 2>/dev/null || true
codesign --force --sign - "$APP" 2>/dev/null \
  && codesign --verify "$APP" 2>/dev/null \
  && echo "    signed + verified" || echo "    sign skipped"

rm -rf "$BUILD"
echo ""
echo "Built: $APP"
echo "Double-click it, or drag it to the Dock / Applications."
