# Multirigs

## Where we are going

Happy is a multi-Rig app. Its local host Rig and every remote Rig the host has
published remain represented and mounted whether their current route is healthy
or not. Connectivity is a changing property of a Rig, never the lifetime of the
Rig's UI or of the application.

Arbitrary network failure must leave the mounted app usable. A full-app loader
is allowed only during initial startup, before Happy has first connected to its
local host. After the app has mounted, losing or reconnecting the local host or
any remote Rig must never unload, reset, or replace the app with a loader.
Failure of one Rig must not interrupt work on another.

An unavailable Rig stays where the user left it. Its affected surfaces explain
their state in context: a terminal, for example, becomes visibly muted and
read-only. Actions that require that Rig to be online are disabled, while
navigation, reading already available state, editing drafts, and every other
offline-capable action continue to work. Errors and reconnecting status belong
beside the affected Rig or surface, not in a global blocking state.

When connectivity returns, Happy reconciles the Rig in place and resumes live
work. Navigation, focus, selection, scroll position, open panels, drafts, and
other UI identity survive the outage and reconnect.

## How we get there

First, make every known Rig a stable app lifetime independent of its connection
state. The direct host and the per-node routes, namespaces, and ordinary Rig
connections from the Remote Rig plan remain the transport model; an unavailable
route changes status, not membership or UI ownership.

Then make availability visible and local to each Rig. Every surface and action
must distinguish what requires a live Rig from what can continue offline, and
degrade only the unavailable part.

Finally, remove connection-driven app loaders, remounts, and resets. Reconnect
each Rig in place, reconcile its current durable state, and restore live
behavior without rebuilding the surrounding app.

## How we know it is done

- The only connection-related full-app loader is the initial local-host
  bootstrap; after the first mount, no disconnect or reconnect can replace the
  app with a loader.
- The local host and every known remote Rig remain mounted and visible through
  offline, reconnecting, and error states, with failures isolated per Rig.
- An open surface keeps its identity and clearly shows degraded availability;
  terminals are visibly muted and read-only while unavailable.
- Online-only actions are disabled with their reason shown in context, while
  all offline-capable navigation, reading, and editing remain usable.
- Reconnecting reconciles fresh Rig state in place without losing navigation,
  focus, selection, scroll position, open panels, or drafts.
- Remote work still uses the host-published routes, ordinary Rig connections,
  and stable per-Rig namespaces defined by the Remote Rig plan; no second
  remote-sync model is introduced.
