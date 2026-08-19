<div align="center">

<p><img src="./.github/logo.png" alt="Happy" width="160" /></p>

<h3>A desktop home for working with agents.</h3>

<p>
  Happy is a macOS app built around the agent daemon on your own machine —
  one place to run, watch, and steer real work.
</p>

</div>

## What Happy is

Happy is a macOS desktop workspace for doing serious work with coding agents.
It connects to the local Happy Agent (Rig) daemon and turns that connection
into a complete working environment: your projects and workspaces in the
sidebar, durable agent conversations in the middle, and the files, terminals,
and previews the work actually touches beside them.

Sessions are not chat windows. A conversation streams live while the agent
works, survives restarts, and keeps its full history, so you can leave a task
running, come back later, and pick up exactly where it left off.

## How you work in it

- **Projects, workspaces, and sessions.** Navigate everything the daemon knows
  about, start new sessions where the work belongs, and keep parallel efforts
  organized instead of scattered across terminal tabs.
- **Durable, streaming conversations.** Watch an agent think and act in real
  time; the transcript is a permanent record, not a scrollback buffer.
- **Files, diffs, and editing.** See what changed, review diffs, open and edit
  files, and preview results without leaving the app.
- **Terminals.** Real terminals attached to the machine doing the work.
- **Browser and HTML preview.** Open web content and rendered HTML inside
  Happy instead of bouncing to an external browser.
- **Models, providers, and usage.** Choose models and effort per session, and
  see what your work is costing as it happens.
- **Notes and visibility.** Keep notes alongside the work, and see what agents
  and their processes are doing at any moment.

## Local by design

Happy has no hosted account, no central service, and no telemetry. The app is
an Electron shell that starts or attaches to your normal local Rig daemon and
talks to it over an authenticated local boundary — the same
`happy-agent-client` protocol throughout, whether the renderer runs in the
desktop shell or in a browser during development.

Your projects stay ordinary directories on your machine. When a session uses a
hosted model, that provider receives the prompts and context sent to it under
its own terms; Happy does not upload the rest of your workspace to a second
service.

| Package                  | Responsibility                                         |
| ------------------------ | ------------------------------------------------------ |
| `happy-desktop-state`    | Framework-independent product state and agent protocol |
| `happy-desktop-ui`       | Reusable components and the component blueprint        |
| `happy-desktop-app`      | Application composition and routing                    |
| `happy-desktop-electron` | macOS shell and the local daemon boundary              |
| `happy-desktop-web`      | Browser development entry                              |
| `happy-desktop-gym`      | Rendering and desktop verification utilities           |

## Developing

```sh
pnpm install
pnpm dev
```

That is the whole loop for most changes. Everything else — browser mode, the
component blueprint, profiling, and validation — is in
[DEVELOPMENT.md](./DEVELOPMENT.md).
