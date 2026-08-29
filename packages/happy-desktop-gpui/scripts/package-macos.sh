#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Happy GPUI packaging currently supports macOS only." >&2
    exit 1
fi

phase="${1:-}"
if [[ -z "$phase" || ! "$phase" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    echo "usage: $0 <phase-label>" >&2
    echo "example: $0 phase-01-foundation" >&2
    exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
package_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$package_dir/../.." && pwd)"
version="$(sed -nE 's/^version = "([^"]+)"/\1/p' "$package_dir/Cargo.toml" | head -1)"
artifact_id="${phase}-v${version}"
output_root="$repo_root/output/happy-gpui-macos"
app_name="Happy GPUI ${artifact_id}.app"
app_path="$output_root/$app_name"
metadata_path="$output_root/${artifact_id}.txt"

if [[ -e "$app_path" || -e "$metadata_path" ]]; then
    echo "Refusing to overwrite retained artifact: $artifact_id" >&2
    exit 1
fi

cargo build --manifest-path "$repo_root/Cargo.toml" --release -p happy-desktop-gpui

contents="$app_path/Contents"
macos="$contents/MacOS"
resources="$contents/Resources"
mkdir -p "$macos" "$resources"
cp "$repo_root/target/release/happy-gpui" "$macos/happy-gpui"
cp "$repo_root/packages/happy-desktop-electron/assets/app-icon/generated/app-icon.icns" \
    "$resources/HappyGPUI.icns"

cat > "$contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>Happy GPUI ${artifact_id}</string>
    <key>CFBundleExecutable</key>
    <string>happy-gpui</string>
    <key>CFBundleIconFile</key>
    <string>HappyGPUI</string>
    <key>CFBundleIdentifier</key>
    <string>com.slopus.happy.gpui</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Happy GPUI</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${version}</string>
    <key>CFBundleVersion</key>
    <string>${version}</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSSupportsAutomaticGraphicsSwitching</key>
    <true/>
</dict>
</plist>
PLIST

plutil -lint "$contents/Info.plist" >/dev/null
codesign --force --deep --sign - "$app_path" >/dev/null

commit="$(git -C "$repo_root" rev-parse --short HEAD)"
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sha256="$(shasum -a 256 "$macos/happy-gpui" | awk '{print $1}')"
architecture="$(uname -m)"
cat > "$metadata_path" <<METADATA
artifact=$artifact_id
app=$app_name
version=$version
commit=$commit
built_at=$built_at
architecture=$architecture
sha256=$sha256
gpui=0.2.2
METADATA

printf 'Created %s\nMetadata %s\n' "$app_path" "$metadata_path"
