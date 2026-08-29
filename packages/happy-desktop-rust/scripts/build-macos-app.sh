#!/bin/zsh
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
    echo "usage: $0 <version>" >&2
    exit 64
fi

SCRIPT_DIR=${0:A:h}
PACKAGE_DIR=${SCRIPT_DIR:h}
REPOSITORY_DIR=${PACKAGE_DIR:h:h}
VERSION=$1
OUTPUT_DIR="$REPOSITORY_DIR/output/happy-desktop-rust/$VERSION"
APP_DIR="$OUTPUT_DIR/Happy Rust.app"
CONTENTS_DIR="$APP_DIR/Contents"

cargo build --release --manifest-path "$PACKAGE_DIR/Cargo.toml"

mkdir -p "$CONTENTS_DIR/MacOS" "$CONTENTS_DIR/Resources"
cp "$PACKAGE_DIR/target/release/happy-desktop-rust" "$CONTENTS_DIR/MacOS/happy-desktop-rust"
cp "$PACKAGE_DIR/macos/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$REPOSITORY_DIR/packages/happy-desktop-electron/assets/app-icon/generated/app-icon.icns" \
    "$CONTENTS_DIR/Resources/AppIcon.icns"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$CONTENTS_DIR/Info.plist"
plutil -replace CFBundleVersion -string "$VERSION" "$CONTENTS_DIR/Info.plist"
codesign --force --deep --sign - "$APP_DIR"

echo "$APP_DIR"
