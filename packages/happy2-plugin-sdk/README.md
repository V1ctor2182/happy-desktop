# Happy2 plugin SDK

The SDK turns a TypeScript MCP server and optional React MCP Apps into one validated Happy2 plugin
artifact. It wraps the official `@modelcontextprotocol/sdk` and
`@modelcontextprotocol/ext-apps` packages; it does not define a second MCP protocol.

## Minimal package

```text
happy2-plugin-example/
├── happy2.plugin.ts
├── package.json
├── plugin.png
├── skills/                    # optional, copied automatically
└── src/
    ├── server.ts
    └── apps/dashboard.tsx     # optional
```

```ts
// happy2.plugin.ts
import { definePluginConfig } from "happy2-plugin-sdk/build";

export default definePluginConfig({
    apps: { dashboard: "src/apps/dashboard.tsx" },
    manifest: {
        description: "Shows an example dashboard.",
        displayName: "Example",
        permissions: ["apps:manage"],
        shortName: "example",
        version: "1.0.0",
    },
    server: "src/server.ts",
});
```

`happy2-plugin-build` bundles `src/server.ts` as Node 24 ESM and bundles every app entry with the
SDK's shared Vite, React, Tailwind CSS v4, and single-file pipeline. Plugin apps can use statically
detectable Tailwind classes directly in TSX without installing those build dependencies or adding
Vite, PostCSS, or Tailwind configuration. Each app is emitted as one self-contained HTML document.
The builder also copies `skills/`, validates and normalizes declared UI masks to exact 40×40
black/alpha PNGs, and emits the installable tree at `dist/plugin` with its manifest, module marker,
and isolated container Dockerfile.

## Server and app APIs

- `happy2-plugin-sdk/server` re-exports the official MCP server and MCP Apps registration helpers,
  adds `registerHtmlAppResource`, parses Happy's protected viewer/chat/message/instance context,
  and provides `HostClient` for durable app instances and typed native contributions.
- `happy2-plugin-sdk/app` wraps the official strict React `useApp` lifecycle, host styles, durable
  `happy2/instance` context, Happy's `happy2/styles` appearance variables, and predeclared app-open
  requests.
- `happy2-plugin-sdk/build` exports `definePluginConfig` and the programmatic builder.

Model visibility always uses standard `_meta.ui.visibility`. Native Happy controls may call only
their exact registered app-visible tool; defining a native control never makes a tool visible to the
model.

## Designing a plugin app

[`PLUGIN-DESIGN.md`](PLUGIN-DESIGN.md) is the authoritative visual specification for the HTML a
plugin app renders: the presentation surfaces and their dimensions, the complete CSS variable
reference Happy injects and how to fall back when it is absent, the 4 px grid, typography, component
and state patterns, accessibility, anti-patterns, a copyable baseline stylesheet, and a measurement
checklist. Read it before writing any app markup or CSS. It is self-contained — a plugin author does
not read Happy's internal `DESIGN.md`.

`useHappyApp` applies everything it describes: the official `useHostStyles` writes the standard MCP
Apps variables and the `data-theme`/`color-scheme` pair onto `<html>`, and `useHappyStyleVariables`
writes Happy's `--happy-*` extension — the twelve documented names, colour values only, with any
name a later host context stops sending removed rather than left stale. Both follow later
`hostcontextchanged` notifications, so a light/dark switch repaints a running app without a remount.
