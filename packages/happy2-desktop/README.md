# Happy Place desktop

The desktop package is macOS-only. Electron owns the window, update lifecycle,
and child-process supervision; it does not run Happy or Rig inside Electron's
event loop.

On first run the user chooses one of two durable connection modes. Happy
remembers that choice and starts it automatically on later launches. Local mode
offers the sidebar instance switcher; the native macOS **Instances** menu remains
available in both modes and can switch a saved target or return to the chooser.

- **Local on this machine** starts one private loopback Happy server, managed by
  its own Rig runtime, with a single durable product user and no account or
  session records. Electron mints a process-local bearer capability for it and
  never writes that capability to settings or Keychain. This mode needs no
  configuration fields.
- **Connect to cloud** loads the existing Happy web app from the supplied HTTPS
  origin with `?desktop=1`. It runs in a separate sandboxed Electron window with
  no preload or native IPC bridge. Authentication cookies, Cloudflare Access,
  API requests, SSE, WebSockets, and uploads therefore remain same-origin.

The remembered settings file has an active-topology pointer and a topology
collection shape; each topology ID owns a distinct runtime root, so its
database, files, plugins, Rig, configuration, and logs never merge with another
topology's. Only the process-memory local capability crosses the narrowly scoped
preload bridge, and it cannot be replaced from the renderer. Cloud credentials
remain owned by the remote origin's browser session and never cross that bridge.

## Development

```sh
pnpm dev:desktop
```

This starts a normal browser-accessible Vite server. The loopback-only server
connects to (and starts when necessary) the user's normal local Rig daemon and
provides the renderer with the same closed Rig operations used by the Electron
preload bridge. Open the URL printed by the command. This development mode does
not expose cloud topology or native desktop features such as directory picking
and in-app Rig installation.

Use `pnpm dev:desktop:electron` when developing the Electron shell itself. The
bundled renderer and preload bridge are used only by that local shell and
topology chooser. Cloud mode loads the remote deployment's ordinary
cookie-authenticated web app instead.

## Packaging

Happy has two independently installable macOS distributions:

- **Happy Place** (`com.slopus.happy2`) is the standard app. It includes the
  renderer and supports both local and cloud topologies.
- **Happy Place Local** (`com.slopus.happy2.local`) is the thin local-only
  shell. It always starts the system Rig daemon and loads its renderer from the
  build-pinned origin `https://local.app.happy.engineering`. The app allows
  navigation and loopback-proxy CORS only for that exact HTTPS origin. Its
  renderer is not packaged in the app.

The separate identifiers give each distribution its own installation identity,
user data, single-app lock, and update channel. Both distributions update from
the same GitHub Release: the standard app reads `latest-mac.yml`, while the
local shell reads `local-mac.yml`, so they cannot update into one another.

Build the renderer that will be hosted at the local origin with:

```sh
pnpm desktop:local:web
```

The deployable static files are written to
`packages/happy2-desktop/release/local-web-site`. Serve `index.html` with
revalidation/no-cache and the hashed assets with immutable caching. Deploying
that directory updates the local app UI without rebuilding, signing, or
notarizing the native shell.

`.github/workflows/local-web-pages.yml` publishes that directory to GitHub
Pages after every push to `main`. Pages uses the custom domain
`local.app.happy.engineering`, which preserves the local shell's unique,
build-pinned security origin; the DNS record is a CNAME to `slopus.github.io`.
Each deployment embeds its Git commit and publishes `local-web-version.json`.
While the Local window is visible, the renderer checks that same-origin
manifest every 15 seconds and stops when hidden. A changed build appears in the
sidebar footer as a versioned Refresh action that reloads the page. Native
release checks run every 15 minutes and use the same footer with Restart; a
downloaded native update takes precedence over a hosted-renderer refresh.

### Signed release build

The fail-closed release command builds both distributions for both
architectures, signs and notarizes every app, staples the ticket, builds DMG and
ZIP artifacts, verifies the signatures and disk images, and writes an updater
manifest in each distribution directory:

```sh
APPLE_ID=... \
APPLE_APP_SPECIFIC_PASSWORD=... \
APPLE_TEAM_ID=... \
pnpm desktop:mac:release
```

For organization automation, prefer an App Store Connect API key:

```sh
APPLE_API_KEY=/secure/path/AuthKey_KEY_ID.p8 \
APPLE_API_KEY_ID=... \
APPLE_API_ISSUER=... \
pnpm desktop:mac:release
```

Use `--arch arm64` or `--arch x64` for a native CI/Mac-mini worker, and
`--flavor standard` or `--flavor local-web` to build one distribution:

```sh
pnpm desktop:mac:release -- --arch arm64 --flavor local-web
```

Signing can use an installed **Developer ID Application** identity, or
`CSC_LINK` plus `CSC_KEY_PASSWORD`. The script refuses to build when
notarization credentials are missing and rejects output that does not pass
`codesign`, `stapler`, `spctl`, and `hdiutil`.

For a quick unsigned/local packaging run, the existing commands remain:

```sh
pnpm desktop:assets
pnpm --dir packages/happy2-desktop dist:mac
```

`desktop:assets` generates `icon.icns` from the source artwork before packaging.

Tags matching the root version trigger `.github/workflows/desktop-release.yml`.
The workflow builds native arm64 and x64 DMG/ZIP artifacts for both
distributions, signs with Developer ID, notarizes with Apple, and creates one
architecture-aware updater manifest per distribution. Both native
distributions are published together in one GitHub Release. The hosted renderer
is uploaded as a separate CI artifact for deployment to
`local.app.happy.engineering`.

Required organization secrets are `MACOS_CERTIFICATE_P12_BASE64`,
`MACOS_CERTIFICATE_PASSWORD`, `APPLE_NOTARY_KEY_P8_BASE64`,
`APPLE_NOTARY_KEY_ID`, `APPLE_NOTARY_ISSUER_ID`, and `APPLE_TEAM_ID`. The
release job fails closed
when any signing or notarization credential is absent.
