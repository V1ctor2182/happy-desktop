<div align="center">

<p><img src="./.github/logo.png" alt="Happy" width="160" /></p>

<h3>What Slack would be if agents came first.</h3>

<p>
  A private, distributed workspace for people who would rather own their tools
  than rent their workflow.
</p>

<p>
  <a href="#make-software-personal-again">What to build</a> ·
  <a href="#make-happy-yours">Extend Happy</a> ·
  <a href="#your-machines-your-work">Privacy and ownership</a> ·
  <a href="#one-place-for-many-agents">Multi-agent work</a> ·
  <a href="#collaboration-agent-first">Collaboration</a> ·
  <a href="#development">Development</a>
</p>

</div>

Most AI software starts with the assumption that your work belongs in somebody
else's cloud. Happy starts with your machine.

Happy is a high-efficiency desktop workspace where people and agents build
together. Projects, conversations, files, terminals, documents, permissions,
and model controls live in one place. Agents are not bots bolted onto a human
chat app; they are active participants that can work independently, collaborate,
and hand work to one another.

It works transparently with
[Happy on mobile](https://github.com/slopus/happy), so the same work can follow
you away from your desk without turning the desktop experience into a mobile
interface.

**Start on your Mac. Connect to a more powerful machine. Run several agents in
parallel. Share a live session and terminal with a friend. Keep everything in
one place.**

## Make software personal again

Happy is for people who feel the urge to make the tool they need instead of
waiting for a SaaS company to make it for them.

Experiment with agents, prompts, tools, and workflows on hardware you control.
Use your Mac for a small idea or connect a remote machine for heavier work.
Change the system whenever your idea changes. No cloud deployment is required
before the first useful result.

An idea might begin as a personal automation, become a simple interface for
someone at home, or grow into the internal tool a small business actually needs.
The person using it does not need to be technical or inherit your terminal
setup. You should not need to become an infrastructure specialist or reshape
the idea around another generic subscription product, either.

The common thread is simple: build the system you want, run it where you choose,
share it with people you trust, and keep control of what happens next.

## Make Happy yours

Happy is not a fixed collection of screens. You and your agents can extend it
with small applets and webapps that run directly inside the workspace. A quick
idea can become a dashboard, control panel, intake form, household tool, or
business workflow without first becoming a separate product and deployment.

Applets can open beside a conversation, file, or terminal. Agents can also place
useful text and actions into the sidebar, the project or workspace title, above
the composer, or in its status line. Each addition can belong everywhere, to one
project or workspace, or only to the session that needs it.

Agents can build, install, update, and version these tools while you work. The
result is more than a configurable agent harness: Happy gradually becomes your
own environment, shaped around the people, machines, and work that matter to
you.

## Your machines. Your work.

Every machine running Happy Agent is a real working node. Your Mac can own local
projects, a remote machine can own different ones, and Happy presents them
together without moving everything into a central workspace.

- **Local-first.** Start with one Mac. Happy does not require a hosted account
  or a central service.
- **Peer-to-peer first.** People and machines connect as peers. Work remains
  distributed across the machines that own it.
- **Encrypted collaboration.** Shared sessions move encrypted between peers.
  Coordination infrastructure can carry data without becoming its owner.
- **No telemetry.** Happy does not watch how you use the product or upload your
  workspace for analytics.
- **No lock-in.** Your projects continue to live on ordinary machines and
  filesystems you control.

This is distributed software without the ceremony. There is no blockchain,
mining, token, global ledger, or consensus delay—just fast connections between
the people, agents, and machines doing the work.

If you choose a hosted model, that model provider receives the prompts and
context you send to it under its own terms. Happy does not require you to hand a
second cloud service the rest of your workspace.

## One place for many agents

Agent work gets messy surprisingly quickly: one terminal per project, several
chat windows, background tasks nobody is watching, and a new harness every few
weeks. Happy replaces that pile with one coherent desktop workspace.

Run tasks in parallel across projects and conversations. Give each agent room to
work, delegate tasks between them, inspect what is happening, grant permissions,
and step in when judgment is needed. Sessions keep running while you move
elsewhere, so parallel work feels like a normal workflow rather than an
orchestration project of its own.

Happy brings the whole working context together:

- projects on local and remote machines;
- conversations with people and agents;
- parallel agents and delegated work;
- files, documents, and terminals;
- permissions, model selection, and usage;
- notes, inbox, and agent-built tools.

The goal is not merely more capability. It is a high-quality, predictable tool
for people who enjoy improving their workflow but are tired of unstable
harnesses and disconnected experiments.

## Collaboration, agent-first

Slack was designed for people to talk, then made room for bots. Happy starts
from a different premise: people and agents share the conversation, the project
context, and responsibility for moving work forward.

Start an agent session on your Mac or a remote machine. Bring in specialized
agents. Share the live conversation and terminal with a friend or teammate.
Everyone can follow the same progress and contribute where it matters while the
agents continue working inside the real project environment.

Happy feels familiar enough to be a team messenger, but it is organized around
doing the work—not just talking about it.

## Development

Happy Desktop requires macOS, Node.js 24 or newer, and pnpm 10.28.1 or newer.

Install dependencies and start the desktop development environment:

```sh
pnpm install
pnpm dev
```

`pnpm dev` uses Portless in loopback-only mode, so it does not depend on Wi-Fi
and exposes an `https://…localhost` URL. LAN mode is explicit: use
`pnpm dev --lan` only when testing from another device.

If Portless was previously installed as a startup service, run
`portless service uninstall` once; Happy's development commands do not install a
persistent proxy service. When switching between loopback and `--lan`, stop an
already-running proxy first; Portless prints the exact `portless proxy stop`
command when needed.

Start the browser development entry:

```sh
pnpm dev:web
```

Open the shared component blueprint:

```sh
pnpm blueprint
```

Validate the workspace:

```sh
pnpm check
```

## Project components

| Component | Responsibility |
| --- | --- |
| State | Framework-independent desktop product state |
| UI | Reusable desktop components and component blueprint |
| App | Application composition and workspace routing |
| Desktop | Native desktop shell and local-machine boundary |
| Web | Browser development entry |
| Gym | Rendering and desktop verification utilities |
