# Happy Desktop shell

This package is the macOS Electron shell for Happy Desktop. It starts or
connects to the user's normal local Rig daemon, projects the daemon through a
loopback boundary, and hosts the shared local application renderer. The shell
opens one Rig connection — its host — and that Rig owns whatever peering it
does with other machines.

It contains no Happy server, account authentication, hosted workspace topology,
or plugin runtime. Product state lives in `happy-desktop-state`, reusable
visuals in `happy-desktop-ui`, and application composition in
`happy-desktop-app`.

Start the complete Electron development environment:

```sh
pnpm dev
```

The default is Portless loopback mode (`https://…localhost`); it does not
require Wi-Fi. Use `pnpm dev --lan` only for deliberate device testing.

Use `pnpm dev --debug` to start the development-only main-process, renderer, and
Rig inspectors. Electron prints each loopback URL; set
`HAPPY2_DEBUG_RENDERER_PORT` to choose the renderer CDP port explicitly.

Use the browser-only environment when needed:

```sh
pnpm dev:web
```
