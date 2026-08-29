# Happy Desktop GPUI

This package is the parallel native macOS implementation of Happy. It uses [GPUI](https://gpui.rs/) and does not replace or embed the Electron application.

## Requirements

- macOS and Xcode Command Line Tools
- Xcode's Metal Toolchain component (`xcodebuild -downloadComponent MetalToolchain`)
- current stable Rust

## Development

From the repository root:

```sh
cargo fmt --all
cargo check -p happy-desktop-gpui
cargo run -p happy-desktop-gpui
```

## Create a retained macOS build

```sh
packages/happy-desktop-gpui/scripts/package-macos.sh phase-01-foundation
```

The script builds in release mode and creates a new versioned app under `output/happy-gpui-macos/`. It refuses to overwrite an existing phase artifact. A metadata file beside the app records the crate version, commit, build time, architecture, and executable SHA-256.

The package bundles Figtree under the SIL Open Font License and enables GPUI's `font-kit` renderer; disabling that feature produces layout boxes without glyph paint on GPUI 0.2.2.

`assets/fonts/HappyIonicons.ttf` is a deterministic subset adapter generated from the unchanged upstream `Ionicons.ttf`. GPUI 0.2.2 refuses icon fonts without an `m` metrics mapping, and CoreText does not resolve this font's original private-use cmap through GPUI. `scripts/build-icon-font.py` preserves the exact upstream glyph outlines, adds safe cmap entries, and adds a zero-ink metrics mapping. Regeneration requires Python `fonttools`.

Every reusable GPUI component must expose test geometry and have a real render/layout unit test that resolves coordinates, dimensions, and padding against `DESIGN.md`. Run them with `cargo test -p happy-desktop-gpui`.

The package currently attaches no server transport and does not manage the shared Happy Agent daemon. That boundary arrives in a later phase so this app can safely coexist with Electron.
