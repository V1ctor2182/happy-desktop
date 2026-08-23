<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="/.github/logo-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="/.github/logo-light.png">
  <img src="/.github/logo-dark.png" width="160" alt="Happy">
</picture>

<h3>Any team. Any model. One harness.</h3>

<p>
  Happy integrates models, teams, and compute into one secure, open-source
  harness — accessible from terminal, desktop, and mobile, deployable
  anywhere, and adaptable to your team.
</p>

</div>

## What Happy is

Happy is a macOS desktop workspace for doing serious work with coding agents.
It connects to the local Happy Agent daemon and turns that connection into a
complete working environment: your projects and workspaces in the sidebar,
durable agent conversations in the middle, and the files, terminals, and
previews the work actually touches beside them.

Sessions are not chat windows. A conversation streams live while the agent
works, survives restarts, and keeps its full history, so you can leave a task
running, come back later, and pick up exactly where it left off.

## Natively multiplayer

Bring your team into one session with every agent. Anyone can share context,
steer the conversation, approve decisions, and take over in real time — the
session is a shared place to work, not a private transcript.

## One harness. Every agent.

Let Claude plan, Codex build, and Grok review — or run them side by side and
compare. Happy detects the subscriptions already on your machine and mixes
every agent in one harness, so the context stays together across every
handoff instead of being scattered across vendor apps.

## Yours to run. Yours to change.

Happy is open source and built to be changed. Run it on your hardware, in
your cloud, or in ours — then change Happy to fit your team's needs. The app
is an Electron shell around your normal local Happy Agent daemon, speaking
the same `happy-agent-client` protocol whether the renderer runs in the
desktop shell or in a browser during development.

## Secure and compliant

No telemetry. No hosted account, and no third-party servers by default. Your
projects stay ordinary directories on your machine, and Happy runs safely
inside corporate networks without leaking data: every connection between
agents, teammates, and mobile clients is end-to-end encrypted. When a session
uses a hosted model, that provider receives only the prompts and context sent
to it under its own terms; Happy does not upload the rest of your workspace
to a second service.

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

## Packages

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
