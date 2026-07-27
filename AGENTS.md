# Agent Instructions

## Master plans

Read [`master-plans/00-master-plan.md`](master-plans/00-master-plan.md) first,
before any other work. It explains how master plans are used and maintained.
Then find every plan in [`master-plans/`](master-plans/) relevant to your task
and read each one in full before starting.

Master plans are dictated by the user and describe where the product is going,
in what order, and what counts as done. They outrank conclusions drawn from the
existing code. Do not create, edit, rename, or delete a file in `master-plans/`
unless the user explicitly asks for that change in the current task. When the
code contradicts a master plan, report the contradiction instead of revising the
plan.

## Project

Happy (2) is a desktop work and coding app that evolves by adopting itself. It is
desktop-only: do not assume mobile use, add mobile-specific behavior, or adapt
layouts for mobile viewports.

## Feature development workflow

Treat each feature as one atomic, independently mergeable change, not as the
lifetime of a Conductor workspace. A worktree may contain only one unmerged
feature at a time; finish and push the current feature before starting the
next one.

After that merge, reuse the same workspace/worktree when convenient. It does
not need to be recreated, checked out directly on `main`, or have a branch tip
identical to `origin/main` before work starts. The next feature must remain a
separate, reviewable diff and must be rebased onto the latest `origin/main`
during the normal sync-to-main workflow. Create another Conductor workspace
only for parallel work or when another feature must begin while the current one
is still unmerged.

Build each feature in isolation, with an explicit boundary between its server
and UI work. Do not mix unrelated features into the same implementation.

Small UI work does not need this ceremony. For a quick visual or interaction
change, just make it: if it typechecks, builds, and renders correctly, it is
done.

## Tests

Do not write tests unless the user asked for them. No unit tests, no `gym`
tests, no browser tests — not "just one to be safe", not as a side effect of
touching a file that already has tests. Verify your change by building and
running it instead.

When the user does ask for tests, follow the rules in the sections below for
where they live and what they must prove. Keep existing tests passing for the
code you touch.

## Review

Review is optional for every edit and never gates pushing or merging. An
independent review is worth requesting for sizable or critical work — security
or authorization behavior, durable data or migrations, server API contracts,
complex concurrency, substantial UI flows, or broad/high-risk diffs — and only
once the implementation is complete. Routine mechanical, small, and low-risk
changes rely on the implementer's own verification.

When a review is run, address every actionable finding and rerun the relevant
checks. Then run repository-wide `pnpm format` and sync the task to `main`
using the workflow below.

Backward compatibility is not a default product requirement. Prefer the clean
new-server/backend and UI design unless the current task explicitly requires a
compatibility or data-preservation contract; do not add legacy branches solely
to preserve obsolete behavior.

## Order of work

When a feature needs both server and UI work, development starts with the
server feature: design its API and data model carefully, implement it, then
build the UI on top of the finished server behavior. Favor simple,
durable boundaries that will not create foreseeable maintenance or
compatibility problems. Do not add abstractions, options, or behavior solely
for hypothetical future use cases; solve the feature currently being built
well.

## Design system

Before creating or changing any user interface, read and follow `DESIGN.md`.
It is the authoritative contract for component ownership, blueprint coverage,
layout dimensions, icon preparation, optical alignment, and cross-browser
rendering tests. Reusable visual components belong in `happy2-ui`; application
packages may only compose them and supply product state and event handlers. Its
rendering-test rules describe how such tests are written when they are asked
for; they do not override the "Tests" section above.

Use flexbox for layout almost all of the time — it is the default for every row,
column, stack, toolbar, and centered box. Use another mechanism (CSS Grid, and
only for a genuine two-dimensional grid) solely when flexbox cannot express the
layout at all; never fall back to floats, `inline-block` hacks, or layout tables.
See `DESIGN.md` → "Layout with flexbox".

## Icons

Every icon is a font glyph from the two families Happy itself uses — Ionicons
and Octicons, vendored under `packages/happy2-ui/src/assets/fonts/` and
addressed through the generated name maps in `src/vectorIcons/`. Use `Icon` for
the curated house vocabulary and `Ionicon`/`Octicon` for a specific upstream
glyph. Adding an icon means picking the upstream glyph a name maps to.

Do not hand-draw glyphs, do not add an inline-SVG icon component, and do not
change what backs `Icon`. A font glyph is already box-centered, so never assert
an ink centroid on one; prove it with real ink and box geometry instead. If you
believe the icon substrate itself must change, stop and ask — that is a
product-owner decision, not an implementation detail, and swapping it silently
red-lined 50 test files for five days once already. See `DESIGN.md` → "Icon
systems".

## Generated images

Whenever a feature needs a new raster image, generate an original image for
that feature. Never copy or reuse another feature's image as a placeholder.
Every new built-in plugin must include its own newly generated `plugin.png`
whose visual identity matches that plugin.

## Reactivity

Every surface must stay current on its own. A manual "Refresh" button (or any
control whose only job is to re-fetch) is not allowed — if the user has to ask
for fresh data, the screen is broken. Data updates arrive one of two ways:

- Full reactivity via the realtime SSE stream. The primary, focused surface
  reconciles live: subscribe to sync events and reconcile durable state through
  the `happy2-state` difference APIs (realtime events are delivery hints, never
  durable state — see "Client state principles"). This is the default; prefer it.
- Polling only for a secondary surface that has no realtime channel yet. While
  that surface is on screen, poll every few seconds; stop polling the moment it
  unmounts or is no longer visible so a backgrounded view does no work. Polling
  is a stopgap — if a surface matters enough to keep open, give it SSE.

Asynchronous server work (a build, an export, a job) must stream its status
changes to the UI through the same mechanism, not wait for a user-initiated
reload.

## React UI reactivity and identity

React surfaces render immutable `happy2-state` snapshots. Keep component and
DOM identity stable across ordinary store notifications so focus, selection,
scroll, measurements, and local UI state survive updates.

- A framework adapter for a `happy2-state` surface owns one coarse
  `useSyncExternalStore` subscription per materialized store. Repeated rows must
  not subscribe to the product store individually.
- Treat a change of store identity as an explicit lifetime boundary. A changing
  React `key` may remount a tree for a genuinely new store. Notifications from
  the same store must retain existing component and DOM identities.
- Read changing values from props or the current external-store snapshot. Do
  not mirror props or product snapshots into component state, and do not use an
  effect to keep duplicated state synchronized.
- Let React Compiler handle ordinary render memoization. Add manual memoization
  only for a measured identity or performance contract, and document that
  contract beside the code.
- Product state belongs in `happy2-state`. `happy2-app` may not use `useState`
  or `useEffect`; reusable `happy2-ui` components may own narrowly scoped local
  UI state, but may not use `useEffect`. Use an event handler, external-store
  subscription, ref callback, or render-time derivation instead. An imperative
  browser integration may use `useLayoutEffect` only when no declarative or
  event-driven boundary exists, with complete cleanup.
- Key reorderable entity collections by stable entity ID, never by array index.
  Preserve references for unchanged entities; changing one field must update
  its row without replacing that row's DOM node or its siblings.
- Thousands of repeated rows may have normal render bindings, but they must not
  mirror authoritative product state, start transport work, or own server
  synchronization. One surface subscription fans out through immutable props.
- Treat conditional branches and changing keys as potential mount/disposal
  boundaries. Do not place focused controls or stateful panels behind a
  changing key unless resetting them is the product behavior.
- Virtualize collections that can contain thousands of entries. Efficient
  reconciliation does not make thousands of simultaneous DOM nodes, layout
  boxes, images, or observers free.
- When browser tests for a store adapter or repeated-row projection are
  requested, they must prove the lifecycle contract, not only visible text:
  assert child mount count,
  subscription cleanup, exact DOM-node identity, `document.activeElement`,
  selection/local value where relevant, and open local panels or menus across
  local and authoritative store updates. Run those tests in Chromium, Firefox,
  and WebKit.

## Sync to main

When asked to “sync to main,” commit the current work, fetch and rebase it onto
the latest `origin/main`, then push the resulting `HEAD` to `main` with a normal
non-force push. If `main` advances or the push is rejected, fetch, rebase again,
and retry until the push succeeds. Never force-push `main`.

Keep sync validation proportional to the packages that changed. For a
client-only diff limited to `happy2-app`, `happy2-state`, and `happy2-ui` (plus
their docs, assets, or development tooling), formatting plus a typecheck/build
of the touched packages is enough; do not run server gym, server coverage, or
another repository-wide test pass solely because the work is being synced.
These UI and client-state changes cannot corrupt durable server data or
migrations. A server, schema, migration, authentication, or durable-state change
runs the existing server checks for the code it touches.

## Server principles

`happy2-server` is a small desktop-app backend that may run as the complete
server or as a separately deployed authentication service. Its behavior is
configured from a TOML file; do not add deployment-specific switches to code.

When server tests are requested, they belong end to end in `gym`, the
repository's isolated black-box testing environment: put the coverage under
`packages/happy2-gym/tests/server`, since unit tests do not replace end-to-end
coverage. Name each test file after the observable behavior it proves so the
directory reads like an index of supported workflows; do not use generic names
such as `server.test.ts`, `integration.test.ts`, or issue numbers. Read
`packages/happy2-gym/README.md` before writing gym tests for the full naming,
organization, harness, and lifecycle instructions.

- Keep `/` deliberately minimal. Versioned, useful HTTP APIs live under `/v0`.
- Exactly one authentication mechanism is enabled in TOML at a time: OIDC,
  password, or email magic links. SMTP credentials always come from environment
  variables, never the TOML file.
- Session JWTs are RS256 signed and intentionally long lived, but they are not
  self-validating authority. Every authenticated request must confirm that the
  session row still exists and is active in the shared Drizzle/SQLite database.
- Do not make process-local state authoritative. Multiple server instances may
  issue and validate sessions concurrently; use database transactions/locks for
  one-time tokens and migrations.
- Preserve request-security telemetry for each issued, refreshed, and revoked
  session: proxy-aware client IP, provider location headers when supplied,
  device, app version, and user agent. Only trust forwarded headers through the
  configured proxy boundary.
- Password hashes retain a unique random salt per user and use a server-wide
  pepper. The pepper and JWT key pair may come from the environment; otherwise
  they are generated once and persisted to the `.env` beside the TOML file.
- Prefer CUID2 for every newly generated identifier, including accounts, users,
  sessions, files, and other persisted records.
- Keep every Drizzle table in the single authoritative
  `packages/happy2-server/sources/modules/schema.ts` file. Persistence behavior
  must not use `Database`, `*Repository`, store superclasses, or another
  initialized database facade.
- Put each durable server action in its own product-module file. The lower-camel
  filename and exported async function must match exactly, with the entity first
  and operation second (`userCreateProfile`, never `createUserProfile`). Pass the
  `DrizzleExecutor`/transaction as the first argument, followed only by explicit
  plain dependencies and input values.
- Compose action transactions with `withTransaction`: it opens and retries one
  complete top-level SQLite transaction, while a nested action reuses the outer
  transaction and never starts or retries its own partial write. Do not wrap
  `withTransaction` in an additional busy retry.
- Put shared module-private SQL, projections, parsers, and caches only in that
  module's `impl/` or `utils/` directory. Routes and long-lived services call
  public actions, never persistence helpers. Keep helpers focused; do not
  reconstruct a repository as a giant utility or barrel file.
- Run `pnpm --dir packages/happy2-server architecture:check` for server changes;
  it enforces the schema, facade, filename/export, entity-first, executor-first,
  comment, and direct-mutation boundaries.
- Every exported per-file server action must have a short doc comment directly
  above the function. State its observable semantic purpose, the durable state
  or invariant it changes, material side effects/transaction expectations, and
  why this action boundary exists. The comment must be specific enough to
  review the implementation against its promise without merely paraphrasing
  the code.
- Profiles are the product-level `User` model. Authentication `accounts` exist
  only for credentials, activation, and session management; an account without
  an active profile must not be usable by product routes.
- Server URL paths must not use `me` (or other identity placeholders) as a
  nested path segment. For the current authenticated user, use `/v0/me` and
  its action routes directly.
- Server APIs use only GET and POST. POST paths name explicit actions rather
  than CRUD semantics: use `updateProfile`, for example, rather than PATCHing
  a profile object.

## Client state principles

`happy2-state` is the in-memory product-state boundary between application code
and the server. Keep authentication, UI framework bindings, persistence, and the
decision to create a process-global instance outside this package.

- The package receives an already authenticated low-level HTTP/realtime
  transport. Its public actions must not expose URLs, tokens, or wire response
  shapes to application code.
- Realtime events are delivery hints. Reconcile durable state through the sync
  difference APIs; never treat receipt of a realtime event as durable state.
- Every retried mutation must reuse one idempotency key across all attempts.
  Promise actions reject with a displayable `UserError`; optimistic background
  actions return immediately and surface terminal failure through state events.
- State remains memory-only and framework-independent: immutable `get()`
  snapshots plus typed subscriptions are the UI integration contract.
- Split product state into independently constructible, on-demand surface stores
  selected by UI lifetime and update cadence. A store constructor must not open
  transport, persistence, timers, or authentication resources. Repeated rows
  and entities must not require one store or subscription each.
- A surface store may publicly expose synchronous, local `void` actions such as
  `textUpdate`, `attachmentAdd`, `attachmentRemove`, or `textSubmit` alongside
  `get()` and `subscribe()`. Name every action entity-first in lower camel case,
  including actions on an already scoped store. Each action mutates only that
  store first, then may emit a typed output event to the listener supplied by
  its creator. Name output and private-input variants entity-first as well, for
  example `textUpdated`, `textSubmitted`, `attachmentAdded`, and
  `displayNameSaveSucceeded`. The listener is optional and defaults to a no-op,
  so the same concrete store works standalone in Blueprint and tests.
- Keep public snapshot, action, output, and private-input contracts as explicit,
  closed TypeScript trees. For statically known product fields, do not expose
  generic `getField`/`setField`/`updateField` APIs, string paths, `keyof` mutation
  dispatch, `unknown` values, or catch-all record payloads. Give every editable
  field its own typed entity-first actions and event variants, such as
  `displayNameUpdate(value: string)` and
  `notificationLevelUpdate(value: NotificationLevel)`. Genuinely dynamic
  collections remain equally strict: use their branded ID type and concrete
  value type, for example `ReadonlyMap<MessageId, MessageSnapshot>`; dynamic
  cardinality never permits an untyped key or value.
- Store updates and subscriptions are synchronous and require no transaction
  API. A local action performs its store's `set`, then emits output in the same
  call stack; the owner may synchronously update other already materialized
  stores before the action returns. Independent stores notify independently and
  have no cross-store atomic-snapshot contract. State that must be observed
  atomically belongs in one surface store. Do not create a missing store merely
  to deliver an event.
- Do not mirror local state across stores merely to keep them synchronized. An
  output event may feed persistence or a server queue without changing another
  UI store. Update another already materialized store only when that surface
  actually renders a projection changed by the event; keep common high-frequency
  actions on one owning store.
- `HappyState` feature stores are the only client product-state system. Do not
  reintroduce an aggregate root snapshot, generic operation/result facade,
  compatibility shim, adapter, dual-write path, event bridge, or snapshot
  mirroring between surfaces.
- Framework adapters may batch or schedule rendering after several synchronous
  store notifications, but state correctness must not depend on one render or
  DOM commit. A subscriber or derived value that requires a coherent combination
  must read one owning surface store rather than join independent stores.
- Keep authoritative input separate from public local actions. Server results,
  persistence results, differences, and reconciliation enter through a private
  typed writer and must not re-emit store output events. Public actions may
  express intent or optimistic local state, but must not fabricate confirmed,
  saved, pinned, or otherwise server-authoritative state.
- When tests for races and failure handling are requested, write them against
  the programmable fake server in `happy2-state/testing`, and cover the same
  boundary against the real in-memory server through `gym/state`.
