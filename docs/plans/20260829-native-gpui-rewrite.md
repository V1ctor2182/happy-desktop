# Native GPUI rewrite

## End result

Happy will have two desktop implementations in this repository:

- the existing Electron/React application, unchanged and still buildable;
- a native macOS application in `packages/happy-desktop-gpui`, written in Rust with GPUI.

The native application will reproduce the current app's routes, stable multi-Happy-Agent state, window structure, layout, light/dark theme, fonts, icon vocabulary, interactions, live data, offline behavior, and macOS packaging. The master plans remain authoritative where they go beyond the current UI.

Every phase must be independently buildable. Before its commit, `packages/happy-desktop-gpui/scripts/package-macos.sh` must create a new, non-overwriting `.app` in `output/happy-gpui-macos/`. The output folder keeps all phase builds side by side and is not committed. Each completed phase is committed and pushed to `feature/gpui-rewrite`.

No phase may modify the Electron host process without two explicit human confirmations. The default design is a parallel native package with its own host boundary.

## Architecture rules

- Keep authoritative data explicit and typed from Happy Agent protocol to GPUI views.
- Treat realtime messages as delivery hints and reconcile durable state through difference APIs.
- Keep every known Happy Agent and its mounted UI identity stable across disconnects.
- Subscribe once per materialized surface store. Do not create per-row transport subscriptions.
- Put reusable GPUI visual elements in the package's `ui` modules. Product views only compose them.
- Use the existing design tokens, Figtree/JetBrains Mono, and Ionicons/Octicons glyph maps as the visual source of truth.
- Every reusable GPUI component must have a real render/layout unit test. The test must resolve and assert its coordinates, dimensions, and padding against `DESIGN.md`; constant-only and snapshot-only checks are insufficient.
- Validate each phase with formatting, `cargo check`, all GPUI geometry tests, a release build, and a packaged macOS app.

## Phases

### Phase 1 — Native foundation and reference shell

- Create the Rust package and pin GPUI.
- Add tokenized light/dark themes and the exact 1280×800 / 720×480 window contracts.
- Reproduce the outer desktop shell: native titlebar lane, 288 px sidebar, workspace, 340 px inspector, headers, tabs, representative transcript, and composer.
- Load the existing Ionicons font through GPUI rather than drawing icons.
- Add non-overwriting macOS `.app` packaging with an artifact checksum and metadata.
- Build `phase-01-foundation-v0.1.5` before commit.

### Phase 2 — Reusable visual system

- Complete native typography with the licensed JetBrains Mono source font and full Figtree weight/italic coverage.
- Port theme roles and the complete curated Ionicons/Octicons vocabulary.
- Add reusable buttons, fields, rows, tabs, menus, modal overlays, badges, avatars, toolbars, scroll surfaces, splitters, and keyboard focus treatments.
- Add an in-app GPUI component gallery for direct parity review against the existing Blueprint fixtures.
- Build `phase-02-ui-system-v0.2.2` before commit.

### Phase 3 — Startup, transport, and stable multi-agent state

- Implement the native Happy Agent host boundary without changing Electron.
- Port initial bootstrap, authenticated HTTP, SSE delivery hints, difference reconciliation, reconnect, and typed user errors.
- Materialize one stable lifetime per known Happy Agent and preserve state through route failure.
- Port startup, onboarding, install-status, and connection-local unavailable states.
- Build `phase-03-connectivity-v0.3.0` before commit.

### Phase 4 — Navigation and workspace catalog

- Port route parsing/history for Happy Agent, project/worktree, session, file, Create, Inbox, Social, Blueprint, and Settings destinations.
- Port the complete sidebar: pinned rows, per-agent Bots/Projects sections, nesting, ordering, collapse, activity, unread, change stats, update state, and footer.
- Port the settings two-pane shell and global command palette.
- Build `phase-04-navigation-v0.4.0` before commit.

### Phase 5 — Core chat work loop

- Port project header, lifecycle states, ordered mixed tabs, session creation/archive, and recent sessions.
- Port virtualized transcript entries, Markdown/code, message grouping, agent events, tool calls, approvals, user input, subagents, and anchored streaming.
- Port composer drafts, attachments, model/effort/permission/audience controls, commands, emoji, context, send, and abort.
- Build `phase-05-chat-v0.5.0` before commit.

### Phase 6 — Files and document previews

- Port the permanent Files inspector with Changes/All Files and List/Tree.
- Port diffs, text editing, Command-S, dirty tabs, bounded syntax cache, and no-flash repeat opens.
- Port Markdown, HTML, image, audio, video, PDF, binary, and lightbox previews.
- Port main/inspector tab transfer and file opens from transcripts.
- Build `phase-06-files-v0.6.0` before commit.

### Phase 7 — Tools and live activity

- Port terminal sessions with the existing Ghostty behavior contract or a native equivalent approved for parity.
- Port browser/webapp panels, Activity, agent traces, processes, Usage, and tool previews.
- Preserve tool identity through panel resize, transfer, disconnect, and reconnect.
- Build `phase-07-tools-v0.7.0` before commit.

### Phase 8 — Secondary product surfaces

- Port Create, Inbox, Happy Social, account/encryption/device flows, all Settings categories, provider usage, instructions, security policy, secrets, Mobile Access, and Dev Tools.
- Port update presentation without changing the Electron host process.
- Build `phase-08-secondary-v0.8.0` before commit.

### Phase 9 — Master-plan completion

- Add Happy-Agent-owned Documents when its server contract is available.
- Add all four Slots and their typed actions when the Happy Agent slot contract is available.
- Verify remote node routing and per-agent namespaces match the Remote Happy Agent plan.
- Verify all known agents remain mounted and usable through arbitrary network failure.
- Build `phase-09-master-plans-v0.9.0` before commit.

### Phase 10 — Full parity and release hardening

- Compare every current production route and reusable visual state against the baseline app at 1280×800 and 720×480 in light and dark appearances.
- Fix geometry, typography, icons, focus, keyboard, scroll, selection, resizing, accessibility, and macOS lifecycle differences.
- Validate release packaging, signing inputs, crash/log output, and clean installation without replacing Electron.
- Build `phase-10-parity-v1.0.0` before the final commit.

## Phase completion record

- [x] Phase 1 — Native foundation and reference shell (`phase-01-foundation-v0.1.5`; 9 rendered geometry tests)
- [x] Phase 2 — Reusable visual system (`phase-02-ui-system-v0.2.2`; review clean; exact authorized panel family; 79 native tests; signed artifact SHA-256 `2546f88c441345453ecacebc41f766179a8dc1b8eef5c8daf11d02e6ded165f4`)
- [ ] Phase 3 — Startup, transport, and stable multi-agent state
- [ ] Phase 4 — Navigation and workspace catalog
- [ ] Phase 5 — Core chat work loop
- [ ] Phase 6 — Files and document previews
- [ ] Phase 7 — Tools and live activity
- [ ] Phase 8 — Secondary product surfaces
- [ ] Phase 9 — Master-plan completion
- [ ] Phase 10 — Full parity and release hardening
