# Agent Instructions — happy2-app

`happy2-app` is the shared application layer. It is the one place where product
state, navigation, and visual components are composed into whole screens, and it
serves both deployments of Happy: the local desktop app driven by a Rig daemon
and the hosted cloud app driven by `happy2-server`.

Read the repository root `AGENTS.md` and `DESIGN.md` first; everything there
still applies. This file adds the rules specific to this package.

## One interface for local and cloud

There is one application surface, not two. Local and cloud differ only in which
transport and stores back them, never in how a screen looks or how navigation
behaves. A component, sidebar, composer, message list, or settings screen must
never exist in a local variant and a cloud variant.

When a capability exists in only one deployment, express that as absent data or
an unavailable action inside the shared surface. Do not fork the surface. If you
find yourself writing a local-only screen, the shared screen is missing a state
it should already model.

## This package is glue

`happy2-app` loads data, selects the current route, projects product state into
props, and handles callbacks. It owns no visual design.

- Reusable visual components belong in `happy2-ui`. If a screen needs a new
  visual element, build and prove it in `happy2-ui`, add it to the blueprint,
  then import it here.
- Product state belongs in `happy2-state`. This package materializes surface
  stores and reads their immutable snapshots; it does not hold product state.
- Anything requiring Electron, Node, or the local machine belongs in
  `happy2-desktop`.

A file here that defines colors, spacing scales, icons, or a component-local
styling system is a defect. `sources/styles.css` exists only to pull in the
design system, not to add styling of its own.

## Layout

Sources live in `sources/`, never `src/`. Tests live in a separate top-level
`tests/` tree that mirrors `sources/`, so `sources/` contains only shipped
product code:

```
sources/
  components/   Composed app-level boundaries and surfaces
  navigation/   Routing: the route tree, its contracts, and navigation
  onboarding/   First-run flow selection
  views/        One screen or panel per file
  index.ts      The package's only public entry
tests/
  behavior/     Whole-surface tests named after the workflow they prove
  ...           Otherwise mirrors sources/ path for path
```

`tests/setup.ts` and `tests/gymSetup.ts` configure the two suites and are
referenced by `vite.config.ts` and `vite.gym.config.ts`. Update those configs
when a setup file or entry moves.

Name a test file after the file it covers when it is a focused unit test. A test
that drives a whole surface goes in `tests/behavior/` and is named after the
observable workflow it proves, so the directory reads like an index of supported
behavior. Do not use generic names such as `app.test.tsx` or `integration.test.tsx`.

## React hooks

This package may not use `useState`, `useEffect`, `useReducer`, or
`useLayoutEffect`; ESLint enforces this. Read external state through
`useSyncExternalStore` or a `happy2-state` adapter, derive everything else at
render time, and put the rest in event handlers or ref callbacks.

Every surface must stay current on its own. There are no manual refresh
controls; see the root `AGENTS.md` sections on reactivity and on React identity,
both of which this package is the primary subject of.
