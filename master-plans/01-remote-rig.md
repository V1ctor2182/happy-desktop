# Remote Rig

## Where we are going

A Rig running on another machine should be usable from Happy exactly like the
local one. Not a lesser version of it, not a separate feature — the same
projects, the same sessions, the same screens, the same code paths. The only
thing that differs is which machine the work happens on.

To reach a remote Rig we need two things: a token and an endpoint (socket or
HTTP). That is the whole connection contract. SSH is how that pair is resolved:
if you have access to the machine, you have access to its endpoint and token, so
you name a machine the way you already reach it and Happy reads the rest itself.

There is already a prototype that connects remote projects. It builds a
parallel state that behaves like the local one. That parallel structure is the
right shape: local and remote Rigs are peers. The two Rigs never talk to each
other directly. Happy is simply an interface onto several machines at once.

## How it behaves

You add a Rig to your local setup. From then on, the app opens a connection to
that Rig when it starts, and every project on that machine appears in the left
sidebar alongside your local projects. Opening one works exactly as it does
locally.

Remote Rigs differ from the local one in one visible way: they have Connect and
Disconnect. Sometimes you have access to a machine and sometimes you do not, so
you can deliberately connect to a remote Rig and it starts working, and
deliberately disconnect from it.

Everything is proxied through the desktop app, as always. The same state, the
same stores, the same reconnect logic that the local Rig already uses. Nothing
about a remote Rig should be visible to the application above the connection
boundary — it is transparent.

## How we know it is done

- A remote Rig is configured by naming the machine over SSH, and its token and
  endpoint are resolved from that access rather than published or copied by hand.
- Its projects appear in the sidebar next to local projects and open the same
  screens through the same state.
- Connect and Disconnect work on demand, and a disconnected Rig degrades
  cleanly instead of breaking the app.
- Reconnection after a dropped link is the existing reconnect behaviour, not a
  second implementation.
- No remote-specific branches in application code above the connection layer.
