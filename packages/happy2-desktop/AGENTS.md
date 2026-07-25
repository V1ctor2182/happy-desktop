# Agent Instructions — happy2-desktop

`happy2-desktop` is the Electron shell. It is macOS-only and deliberately thin:
it loads the shared UI (`happy2-app` / `happy2-ui`) and binds it to a desktop
environment. It is not where product features are built.

Read the repository root `AGENTS.md` first; everything there still applies. This
file adds the rules specific to this package.

## Keep this package small

The desktop package owns only what genuinely requires Electron or the local
machine:

- window, menu, and update lifecycle;
- child-process supervision (private Happy server, Rig runtime, PTY);
- the local Rig daemon connection and its projection into `happy2-state` shapes;
- durable desktop settings and the topology chooser;
- the narrow preload IPC bridge.

Everything else belongs elsewhere. Product state goes to `happy2-state`, reusable
visual components go to `happy2-ui`, and application composition goes to
`happy2-app`. If a change here starts to look like a feature, it is in the wrong
package. Prefer deleting code in this package over adding to it, and never
duplicate a component or store that another package already owns.

Growth in `sources/main` is acceptable only when the capability cannot exist
outside the main process. Growth in `sources/renderer` almost always means work
that should have gone to `happy2-app`.

## Layout

Sources live in `sources/`, never `src/`, matching the rest of the repository.
The top level splits strictly by Electron process, so a file's directory tells
you which runtime it executes in and what it may import:

```
sources/
  main/       Electron main process (Node): main.ts entry + main-only modules
  renderer/   Browser process: renderer.tsx entry + renderer-only stores
  preload/    Context-isolated bridge: preload.ts only
  shared/     Types and IPC channel names used across processes
```

Rules for the boundary:

- `main/` may use Node and Electron main APIs. It must not import from
  `renderer/` or `preload/`.
- `renderer/` runs in the browser. It must not import Node built-ins, `electron`,
  or anything from `main/`. It reaches the main process only through the bridge
  contract in `shared/`.
- `preload/` contains the bridge and nothing else. Keep it minimal and explicit;
  it is a security boundary, so never expose a general-purpose channel, raw
  `ipcRenderer`, or a capability the renderer can replace.
- `shared/` holds only process-independent types, contracts, and channel names.
  It must contain no runtime behavior that belongs to one process.

Each entry file is named after its process (`main/main.ts`,
`renderer/renderer.tsx`, `preload/preload.ts`) and is referenced by
`vite.main.config.ts`, `index.html`, and `vite.preload.config.ts` respectively.
Update those configs when an entry moves.

Tests live beside their subject inside the same process directory and run with
`pnpm --dir packages/happy2-desktop test`.

## React hooks

This package uses none of `useState`, `useEffect`, `useReducer`, or
`useLayoutEffect`. The renderer reads external stores through
`useSyncExternalStore` and nothing else. `node scripts/check-react-boundaries.mjs`
enforces this over `sources/`; run it for any renderer change.

Desktop stores in `sources/renderer` are thin adapters over the bridge and
`happy2-state`. They must not become a second product-state system.

## Development defaults to local mode

`pnpm dev:desktop` is the default development loop. It serves the renderer over
loopback Vite and automatically connects to the user's normal local Rig daemon,
starting it when necessary. No topology chooser, account, or cloud origin is
involved, so a contributor gets a working Rig client immediately.

How it works, and what to preserve when changing it:

- `pnpm dev` sets `VITE_HAPPY2_BROWSER_LOCAL=1`.
- `browserLocalRigPlugin()` (`sources/main/browserDevServer.ts`) injects a
  `happy2-browser-local` meta tag. A meta tag, not an inline script, because the
  page CSP forbids inline scripts and would silently drop the signal.
- The renderer entry picks the browser dev bridge when that tag is present and
  `window.happyDesktop` is absent.
- The dev server mounts the same `rigProxyHandle` used by the packaged app, so
  the renderer talks to an identical projected Rig surface in both modes.

Keep the development and packaged paths behaviorally identical at that proxy
boundary. A feature that works only in one of them is a bug. Native-only
capabilities (directory picking, in-app Rig installation, cloud topology) are
absent in browser-local mode by design; degrade gracefully rather than branching
product behavior on the environment.

Use `pnpm dev:desktop:electron` only when developing the Electron shell itself.

## Rig boundary

No `@slopus` wire type may cross into the renderer. `sources/main/rigProjection.ts`
projects daemon responses and events into `happy2-state` shapes, and
`sources/main/rigProxyHandle.ts` is the single request handler shared by the
packaged `node:http` proxy and the Vite dev middleware. Add new Rig capability by
extending that projection and handler, and cover it with tests next to them —
never by leaking a protocol type or a raw daemon URL to `renderer/`.

Server paths in the proxy use three segments (`/sessions/:id/:action`); name new
actions to fit that shape.

## Checks

For any change in this package run:

```sh
pnpm --dir packages/happy2-desktop exec tsc -p tsconfig.json --noEmit
node packages/happy2-desktop/node_modules/vitest/vitest.mjs run --dir packages/happy2-desktop
node scripts/check-react-boundaries.mjs
```

Run `pnpm --dir packages/happy2-desktop build` when touching an entry point or a
Vite config, since those failures do not surface in typecheck or tests.
