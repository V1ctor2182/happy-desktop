# Native GPUI rewrite phases

Each phase is independently buildable and committed. Before each phase commit,
the macOS application is archived under a new version in
`output/happy-desktop-rust/` and the component geometry suite is run.

1. **Native shell foundation** — GPUI macOS window, design tokens, title bar,
   feature rail, sidebar, channel header, buttons, app shell, appearance toggle,
   and exact rendered-coordinate tests.
2. **Navigation and conversations** — durable routes, project/workspace/session
   sidebar hierarchy, transcript, message/tool/approval surfaces, composer,
   command palette, and preserved focus/scroll identity.
3. **Files and work surfaces** — Changes/All Files, tree/list views, diff,
   editor, image/video/Markdown preview, terminal, browser/webapp preview, tabs,
   inspector, and bounded parsed-file state.
4. **Happy Agent integration** — typed HTTP/SSE transport, host and remote-node
   connections, immutable surface stores, reconnect-in-place behavior, models,
   permissions, usage, secrets, and session lifecycle.
5. **Documents, slots, social, and settings** — Happy Agent-owned documents,
   slot rendering/actions, onboarding, inbox/social, all settings, update and
   diagnostic surfaces.
6. **Parity closure** — remaining reusable components and states, complete
   keyboard/accessibility behavior, Retina raster/optical audits, performance,
   packaging, and side-by-side sign-off against the original app.

## Archived implementation checkpoints

- `0.1.0` — native shell foundation.
- `0.2.0` — conversation, tool, approval, and composer surfaces.
- `0.3.0` — stable GPUI navigation interactions.
- `0.4.0` — file browser, editor, diff, and preview surfaces.
- `0.5.0` — Inbox, Settings, Documents, and Terminal surfaces.
- `0.6.0` — Rust-owned daemon lifecycle, authenticated in-process capability
  boundary, typed health/bootstrap contracts, and live connection status.
- `0.7.0` — authoritative project/agent navigation projected from daemon
  bootstrap with exact hierarchy-row geometry.
- `0.8.0` — typed agent bootstrap and run-grouped message history, stable live
  transcript rows, and asynchronous conversation selection.

A phase may be split into numbered subphases when it would otherwise stop being
an independently reviewable commit. No later phase is allowed to replace an
earlier phase with a web view or embed the old renderer.
