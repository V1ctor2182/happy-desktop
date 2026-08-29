# Happy Rust

This package is the parallel, native Rust/GPUI implementation of Happy. The
existing Electron, React, and TypeScript packages remain the production app
while this package reaches feature and visual parity phase by phase.

## Development

```sh
cargo run --manifest-path packages/happy-desktop-rust/Cargo.toml
cargo test --manifest-path packages/happy-desktop-rust/Cargo.toml
```

The production root starts or attaches to the normal local Happy Agent daemon.
The native host alone owns its Unix socket and bearer token; GPUI product state
receives a capability-scoped typed client and immutable snapshots. Set both
`HAPPY_AGENT_SERVER_SOCKET_PATH` and `HAPPY_AGENT_SERVER_TOKEN_PATH` to connect
to one exact development daemon without discovery or startup.

## Versioned macOS builds

Every completed phase is archived before its commit:

```sh
packages/happy-desktop-rust/scripts/build-macos-app.sh phase-01-shell
open "output/happy-desktop-rust/phase-01-shell/Happy Rust.app"
```

Builds are intentionally ignored by Git and retained side-by-side in
`output/happy-desktop-rust/` for visual tracing.
