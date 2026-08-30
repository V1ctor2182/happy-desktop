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
packages/happy-desktop-gpui/scripts/package-macos.sh phase-06-files
```

The script builds in release mode and creates a new versioned app under `output/happy-gpui-macos/`. It refuses to overwrite an existing phase artifact. A metadata file beside the app records the crate version, commit, build time, architecture, and executable SHA-256.

The package bundles the normal and italic variable faces for Figtree and JetBrains Mono under the SIL Open Font License. It enables GPUI's `font-kit` renderer; disabling that feature produces layout boxes without glyph paint on GPUI 0.2.2.

`assets/fonts/HappyIonicons.ttf` and `HappyOcticons.ttf` are deterministic GPUI adapters generated from the unchanged upstream TTF outlines and PUA mappings. GPUI 0.2.2 refuses custom fonts without an `m` metrics mapping, so `scripts/build-icon-fonts.py` adds only a zero-ink metrics mapping and distinct family names. Before adapting, the generator verifies that both local source TTFs are byte-identical to the authoritative `happy-desktop-ui` fonts and that the parsed maps contain exactly 1,357 Ionicons and 331 Octicons. It then generates typed Rust constants for both complete maps plus the curated house vocabulary. The executable generator declares and resolves its pinned `fonttools` dependency through `uv`, formats its Rust output, and is deterministic across repeated runs. The four panel-affordance names port `happy-desktop-ui/src/drawnGlyphs.tsx`, the one existing exception authorized by `DESIGN.md`: an arrow-free 1 px rail inside the measured 14 × 12 Ionicons ink box. No other native icon uses drawn geometry.

`scripts/build-theme-roles.py` generates the typed 172-role native palette from `happy-desktop-ui/src/theme.css`. Native components resolve these roles directly. There is no second handwritten color palette.

The in-app **UI Gallery** sidebar destination has one selectable page per reusable component, including separate ConnectionNotice, StartupSurface, WelcomeDeck, ProfileOnboardingSurface, ProviderOnboardingSurface, InstallProgress, Sidebar, Settings, and Command Palette pages. Each page renders its supported sizes and representative focus, selected, disabled, invalid, overflow, and placement states at 100% scale. The workbench scrolls in both axes at the 720 px minimum window instead of shrinking or clipping wide fixtures. Set `HAPPY_GPUI_GALLERY=1` to open it directly. Set `HAPPY_GPUI_APPEARANCE=light` or `dark` to force an appearance for parity capture.

The visual-system layer accepts dynamic `SharedString` data and typed callbacks. Buttons and rows support pointer and Enter/Space activation. Tabs use one roving tab stop with automatic Left/Right/Home/End activation. Menus use roving Up/Down/Home/End focus, disabled-item skipping, Enter/Space activation, and typed Escape dismissal. Fields use a native GPUI `EntityInputHandler` with grapheme-aware editing, selection, horizontally revealed caret/IME geometry, clipboard, UTF-16 range conversion, explicit tab-stop handles, and typed change output. Scroll surfaces own persistent scrollbar entities around a structurally identifiable `SharedScrollHandle`: trusted wheel input reveals automatic chrome for a two-second hold and 480 ms fade, wheel ownership, hover, and thumb dragging control its strengths, programmatic scroll and resize stay hidden, and overlay, overflow-only beside, and reserved placements preserve the 8 px track / 6 px ink contract. Modal overlays require stable focus ownership, trap forward/reverse focus, dismiss through backdrop/Escape, block inner clicks, and route bounded bodies through the shared scroll surface. Splitters retain typed start/move/end drag state so unrelated pointer events cannot emit a partial lifecycle.

Every reusable GPUI component must expose test geometry and have a real render/layout unit test that resolves coordinates, dimensions, and padding against `DESIGN.md`. GPUI's test platform renders at a 2× scale; the suite asserts that scale explicitly and proves both adapter-font families paint real glyph ink. Run the reusable-component suite with `cargo test -p happy-desktop-gpui`.

### Accessibility status

GPUI 0.2.2 exposes focus and native text-input integration but no public macOS accessibility-node API. The current zero-size labelled icon text is visual/test metadata; it is not claimed as a VoiceOver role or accessible name. Native roles, names, selected/disabled/error states, and label/hint relationships therefore remain an explicit GPUI framework boundary for the parity-hardening phase rather than a false Phase 2 guarantee. Keyboard focus and operation are implemented and render-tested independently.

The native welcome deck uses four original deterministic scene illustrations. `scripts/build-welcome-art.py` retains normalized 640 × 640 masters, derives the packaged 320 × 320 Retina assets, and pins the authoritative same-feature logo and sky inputs by SHA-256. Welcome and three-state appearance choices use parsed versioned records and private atomic writes; failed acknowledgement or appearance writes stay visible instead of claiming success.

The managed local installer always replaces the selected release from a fresh HTTPS archive whose published SHA-256 digest was verified. It never executes an unverified pre-existing version path, rejects symlinked executables, uses private modes, a process-safe bounded install lock, and an atomic macOS directory exchange when replacing a cached version, and reuses one login-shell environment for path resolution, installation, daemon launch, and transport.

### Native Happy Agent boundary

The production app attaches directly to the local Happy Agent through its authenticated Unix socket. Socket and token paths follow `HAPPY_HOME_DIR`, `HAPPY_AGENT_SERVER_SOCKET_PATH`, and `HAPPY_AGENT_SERVER_TOKEN_PATH`; the bearer token stays inside the transport worker and is never exposed to GPUI views, snapshots, logs, or errors. Protocol 23 health and desktop bootstrap responses are projected into explicit Rust types. SSE frames are delivery hints only. Already-readable frames coalesce into one bounded reconciliation batch. Config, onboarding, profile, project, and workspace changes re-read only the affected authoritative routes; cursor gaps and daemon replacement re-read the complete desktop bootstrap. Owned profile and project mutations carry protocol `mutationId` correlation values. Typed 409/412 version conflicts retain the complete API error object and adopt a fresh authoritative snapshot before retry. Daemon draining keeps mounted state available while disabling live mutations. After all authoritative steps are done, the explicit completion surface persists the idempotent `/v0/onboarding/complete` acknowledgement before the shell mounts.

The direct host owns one stable `Entity<AgentLifetime>` under the `host:local` namespace. Bootstrap and reconnect update that entity in place, so a mounted shell, draft, focus, selection, scroll position, and catalog snapshot are not replaced by route failure. Reconnect starts at 250 ms and caps at 5 seconds. Before the first successful local bootstrap only, the app may show the full-window startup/onboarding surface. Later failure is localized to the affected workspace with automatic reconnect; the shell stays mounted.

### Native navigation boundary

The mounted shell owns typed `Route` and bounded `NavigationHistory` values. Paths are parsed and formatted only at external boundaries. All project, workspace, bot, conversation, history, and palette identities include the owning `AgentNamespace`; endpoint text, labels, order keys, cursors, and daemon process IDs are never identities. Private versioned history, sidebar collapse state, and the Social/Inbox pinned order use atomic local persistence. Offline availability changes row status but does not invalidate known destinations or replace the per-agent catalog entity.

The Phase 4 sidebar projects ordered Bots and Projects from the authoritative bootstrap and Git snapshots, including worktree nesting, lifecycle, explicit activity, unread state, and computed change totals. Bot-owned workspace IDs are explicit bot relationships; protocol 23 intentionally does not also publish those workspaces in the normal workspace collection. Protocol-23 repositories without a first commit return `git.head: null`, and binary changed-file rows omit per-file insertion/deletion counts, so both facts are modeled as nullable instead of guessed. Git watch registration deduplicates active, non-archived project, workspace, and bot-workspace IDs because the daemon rejects duplicates. The lease renews every two minutes. Git is a secondary projection: watch or targeted-read failures retain the last good facts and retry after five seconds without taking the authoritative catalog or SSE connection offline.

The product shell reserves a separate 40 px draggable native titlebar lane. Its reusable Sidebar, Settings, and Command Palette surfaces use the 56 px surface-header contract, `clamp(250px, 30vw, 360px)` navigation width, full-bleed caller-owned scrollbars, and controlled route/focus state. Native chat and file routes are retained product surfaces. Create, Inbox, Social, and Settings bodies remain typed placeholders for their later phases. Destructive archive and server reorder affordances stay hidden until the shell can pair them with confirmation and mutation state; no local order mutation is presented as server state.

### Native file boundary

The permanent Files inspector reads protocol-23 file trees and Git facts through typed workspace-relative POSIX paths. Changes and All Files share one bounded, virtualized browser. File tabs use compare-and-swap text saves, retain drafts across conflicts, and keep authoritative reads separate from SSE invalidation hints. Current and Git-base content produce bounded background diffs; syntax, Markdown, HTML sanitation, image validation, and native staging also run off the GPUI thread and apply only to matching document generations.

Ready payloads, parsed editor state, decoded images, staged native files, recent document entities, and visible file tabs have independent limits. Open tabs retain their current content; hidden tabs do not perform transport or projection work. HTML and media enter WebKit only through private owner-only staged files. Sanitization, deny-all CSP, ephemeral web data, disabled JavaScript, exact-file read scopes, and a cancelling navigation delegate prevent daemon credentials, workspace roots, arbitrary paths, and remote resources from entering native previews.

Happy Agent protocol 23 and `@slopus/happy-agent-client@0.0.47` do not publish a typed peer-status or peer-route contract. The registry is ready to retain one stable lifetime per host-published namespace, but this build deliberately does not discover endpoints, accept node credentials, use SSH, or invent a peer route. Remote nodes remain an explicit server-contract blocker.

The native process never stops, replaces, drains, installs, or otherwise manages the Electron app or its host process. It can coexist with Electron against the same Happy Agent.
