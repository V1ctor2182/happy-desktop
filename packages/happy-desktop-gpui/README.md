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
packages/happy-desktop-gpui/scripts/package-macos.sh phase-02-ui-system
```

The script builds in release mode and creates a new versioned app under `output/happy-gpui-macos/`. It refuses to overwrite an existing phase artifact. A metadata file beside the app records the crate version, commit, build time, architecture, and executable SHA-256.

The package bundles the normal and italic variable faces for Figtree and JetBrains Mono under the SIL Open Font License. It enables GPUI's `font-kit` renderer; disabling that feature produces layout boxes without glyph paint on GPUI 0.2.2.

`assets/fonts/HappyIonicons.ttf` and `HappyOcticons.ttf` are deterministic GPUI adapters generated from the unchanged upstream TTF outlines and PUA mappings. GPUI 0.2.2 refuses custom fonts without an `m` metrics mapping, so `scripts/build-icon-fonts.py` adds only a zero-ink metrics mapping and distinct family names. Before adapting, the generator verifies that both local source TTFs are byte-identical to the authoritative `happy-desktop-ui` fonts and that the parsed maps contain exactly 1,357 Ionicons and 331 Octicons. It then generates typed Rust constants for both complete maps plus the curated house vocabulary. The executable generator declares and resolves its pinned `fonttools` dependency through `uv`, formats its Rust output, and is deterministic across repeated runs. The four panel-affordance names port `happy-desktop-ui/src/drawnGlyphs.tsx`, the one existing exception authorized by `DESIGN.md`: an arrow-free 1 px rail inside the measured 14 × 12 Ionicons ink box. No other native icon uses drawn geometry.

`scripts/build-theme-roles.py` generates the typed 172-role native palette from `happy-desktop-ui/src/theme.css`. Native components resolve these roles directly. There is no second handwritten color palette.

The in-app **UI Gallery** sidebar destination has one selectable page per primitive. Each page renders its supported sizes and representative focus, selected, disabled, invalid, overflow, and placement states at 100% scale. The workbench scrolls in both axes at the 720 px minimum window instead of shrinking or clipping wide fixtures. Set `HAPPY_GPUI_GALLERY=1` to open it directly. Set `HAPPY_GPUI_APPEARANCE=light` or `dark` to force an appearance for parity capture.

The visual-system layer accepts dynamic `SharedString` data and typed callbacks. Buttons and rows support pointer and Enter/Space activation. Tabs use one roving tab stop with automatic Left/Right/Home/End activation. Menus use roving Up/Down/Home/End focus, disabled-item skipping, Enter/Space activation, and typed Escape dismissal. Fields use a native GPUI `EntityInputHandler` with grapheme-aware editing, selection, horizontally revealed caret/IME geometry, clipboard, UTF-16 range conversion, explicit tab-stop handles, and typed change output. Scroll surfaces own persistent scrollbar entities around a structurally identifiable `SharedScrollHandle`: trusted wheel input reveals automatic chrome for a two-second hold and 480 ms fade, wheel ownership, hover, and thumb dragging control its strengths, programmatic scroll and resize stay hidden, and overlay, overflow-only beside, and reserved placements preserve the 8 px track / 6 px ink contract. Modal overlays require stable focus ownership, trap forward/reverse focus, dismiss through backdrop/Escape, block inner clicks, and route bounded bodies through the shared scroll surface. Splitters retain typed start/move/end drag state so unrelated pointer events cannot emit a partial lifecycle.

Every reusable GPUI component must expose test geometry and have a real render/layout unit test that resolves coordinates, dimensions, and padding against `DESIGN.md`. GPUI's test platform renders at a 2× scale; the suite asserts that scale explicitly and proves both adapter-font families paint real glyph ink. Run the 79 current tests with `cargo test -p happy-desktop-gpui`.

### Accessibility status

GPUI 0.2.2 exposes focus and native text-input integration but no public macOS accessibility-node API. The current zero-size labelled icon text is visual/test metadata; it is not claimed as a VoiceOver role or accessible name. Native roles, names, selected/disabled/error states, and label/hint relationships therefore remain an explicit GPUI framework boundary for the parity-hardening phase rather than a false Phase 2 guarantee. Keyboard focus and operation are implemented and render-tested independently.

The package currently attaches no server transport and does not manage the shared Happy Agent daemon. That boundary arrives in a later phase so this app can safely coexist with Electron.
