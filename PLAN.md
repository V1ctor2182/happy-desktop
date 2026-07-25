# Plan — local mode and cloud modes as one product

## Product idea

Happy is a desktop app that switches between a **local** workspace and one or
more **cloud** workspaces.

- **Local** is exclusively yours. It runs on your machine, against the local Rig
  daemon, and shows all of your own sessions. No account, no other participants.
  There is always exactly one local workspace.
- **Cloud** is, in practice, a collaboration/review product: people and agents
  work together on a shared server. There can be several cloud workspaces, each
  a separate server the user has joined.

The mental model to copy is Discord: a rail of "places" where one place is your
personal space (local sessions) and the others are servers with a lot of shared
traffic. It is not always the most elegant model, but it is the right one here
— when the shared servers are noisy you can step back into your own quiet
space.

### Future direction (do not implement yet, but do not design against it)

A local session will eventually be able to appear in a cloud workspace in a
reduced form: secrets, tokens, and environment details stripped, most likely
read-only for other members of that server, and only when the owner publishes
it. Keep the local session model and its projections shaped so that a
"published, redacted view of a local session" can be added later without
reworking the local stack.

## Direction of the work: cloud is the reference, Rig is retrofitted

This is the governing rule for every decision below.

The cloud implementation is the good one. Its state modules, its chat and
composer surfaces, its sidebar, its sync/reconciliation model, and its UI
components are the design we want and the design we keep. The Rig/local
integration was built quickly and separately, and it should be treated as the
weaker, provisional side of the codebase.

Therefore: **we pull Rig into the cloud design, never the reverse.**

- When local and cloud disagree about a type, a store shape, a naming scheme, a
  loading vocabulary, or a component, the cloud version wins by default, and the
  Rig side is rewritten to match.
- A change to a good cloud abstraction must be justified by a real product need
  that the cloud side also has — not by "this is how the Rig code already does
  it." Convenience for the existing Rig code is not a reason.
- No cloud surface may acquire an optional field, a mode flag, or a conditional
  branch that exists only to accommodate Rig's current shapes. If Rig needs
  something the cloud model genuinely lacks, extend the cloud model properly, as
  a first-class closed concept, and let cloud use it too where it applies.
- Rig code is expendable. Where the cloud stack already solves a problem,
  delete the Rig version outright rather than adapting it. Backward
  compatibility with existing Rig internals is not a requirement (AGENTS.md:
  backward compatibility is not a default product requirement).
- The only things kept from the Rig side are the ones with no cloud counterpart:
  the daemon transport and its protocol types, connection/install/version
  handling, and genuinely local product concepts (run lifecycle, tasks/goal,
  subagents, background processes, usage/quota, permission modes, workspace
  file search, shell mode). Even those get restated in the cloud stack's
  conventions.

Concretely, "shared" in this document almost always means "the cloud module,
generalized just enough, with Rig projecting into it." Where a name below looks
new (`ConversationEntry`, `conversationListStore`), it is the cloud module
renamed and lightly widened — not a neutral third abstraction invented above
both sides.

## Architectural decision

**Two stacks, one component library.** Do not merge local and cloud into a
single aggregate state tree.

- Local and cloud have different lifetimes, different identity and authorization
  models (Rig daemon vs. account session), different transports, and different
  update cadences. Fusing them produces a state object that is mostly
  conditional and hard to reason about, and it would drag account concepts into
  a mode that has no account at all.
- One local workspace store tree; N cloud workspace store trees, one per joined
  server, materialized on demand. Switching workspaces switches which tree the
  shell renders; it does not merge snapshots.
- The rail that lists workspaces (the one local entry plus each cloud entry) is
  its own small surface store, independent of both stacks.

**One UI vocabulary.** Local and cloud must not each grow their own chat,
session list, or composer. Every visual component lives in `happy2-ui` and is
composed by both stacks with different product state.

- The chat surface must render agent work and human conversation equally well.
  The requirements differ somewhat today, but they converge: in both cases we
  want to *observe* what an agent is doing, and in practice nobody reads tool
  calls line by line. Tool activity trends toward compact, glanceable summaries
  rather than transcripts, in personal and group chats alike.
- Treat every local-only chat component (`Rig*`) as scaffolding scheduled for
  demolition: the resolution is always "render this through the cloud
  component," never "keep both."

## Current state

Modes and shell:

- `packages/happy2-desktop/sources/shared/desktopContract.ts` already models
  `DesktopMode = "local" | "cloud"`, start requests, saved topologies, an active
  target, and an instance switcher (`DesktopInstanceSwitcher` in `happy2-ui`).
- `packages/happy2-desktop/sources/renderer/renderer.tsx` branches at the top
  level: local renders `AppRigView`, cloud renders `App`. The two modes never
  coexist in one shell, and switching is a runtime restart-style transition
  rather than in-app navigation.
- Local mode connects through the main process's loopback Rig HTTP proxy
  (`sources/main/localRig.ts`), including installed-command discovery, version
  compatibility, and an install terminal.

State:

- `packages/happy2-state/src/rig/*` holds the local stack: connection, clock,
  session list, chat, menus, workspace store, transport, client.
- `packages/happy2-state/src/modules/*` holds the cloud stack (chat, composer,
  message, sidebar, sync, notifications, permissions, plugins, etc.).
- The two share `happy2-state` conventions but no product surfaces.

Where the Rig side duplicates something cloud already does better (each of these
resolves toward the cloud version):

- **Conversation content.** Cloud `ChatSnapshot.messages` is
  `readonly ChatMessageItem[]` — a projected `MessageSummary` plus sender
  identity and reaction summaries, with real merge/compare/equivalence helpers
  and reference-stability guarantees. Rig `RigChatSnapshot.transcript` is
  `readonly RigTranscriptEntry[]` plus a bolted-on separate `streaming` field.
  The cloud list is the model; the Rig transcript is rewritten to project into
  it, and the special-cased `streaming` entry becomes an ordinary entry with a
  generation status (which `MessageMarkdown` already understands).
- **Composer.** Cloud has a proper surface store (`composerStoreCreate`) with
  text, attachments, revision/submission lifecycle, focus, audience, agent
  selection, and typed `textUpdated`/`textSubmitted` output. Rig has **no
  composer store at all**: `RigChatView` keeps the draft in React `useState` and
  `RigChatStore.messageSend(text)` takes the text as an argument. This is the
  clearest example of the general pattern — the Rig side skipped the
  architecture. The cloud composer store is adopted as-is for local.
- **List surface.** Cloud `SidebarSnapshot` carries `chats` (display name,
  avatar, participants), `projects`, and `sync` state. Rig
  `RigSessionListSnapshot` carries a flat `sessions` array plus
  `selectedSessionId`. The cloud sidebar projection is the model; Rig sessions
  project into it.
- **Status/loading vocabulary.** Cloud uses `Loadable<T>` and a `SidebarStatus`
  union. Rig uses inline `"loading" | "ready" | "error"` plus loose `error?` and
  `mutationError?` fields. `Loadable<T>` wins; the Rig spelling is deleted.
- **Selection/materialization.** Cloud does it in `chatOpen` + `SyncCoordinator`
  with difference-based reconciliation. Rig does it in `rigWorkspaceStore`.
  Both correctly keep it out of React, so the Rig owner survives — but restated
  in cloud naming and cloud loading vocabulary.
- **Reconciliation discipline.** Cloud treats realtime events strictly as
  delivery hints and reconciles through difference APIs. The Rig stores lean
  more directly on event payloads (upsert-what-arrived). The cloud discipline is
  the standard; Rig's event handling is brought up to it.

What has no cloud counterpart and is therefore kept (restated in cloud
conventions, not preserved as-is): the Rig daemon transport and protocol types,
connection/version/install handling, run lifecycle (`runStatus`, `runId`,
elapsed), pending user-input requests, queued steering messages,
tasks/goal/subagents, background processes, usage/quota, model-effort-permission
menus, workspace file search, and shell mode.

Cloud-only concepts local simply does not populate: members, pins, reactions
with actor loading, typing, audience, plugin/document-write approval requests,
port shares, moderation.

UI:

- Shared: `AppShell`, `Sidebar`, `Rail`, `TitleBar`, `Composer`, `Message`,
  `MessageList`, `EmptyState`, and the rest of the library.
- Cloud chat rendering lives in the mature `Message`/`MessageList`/`Composer`
  family with contribution slots, reactions, audience, moderation affordances,
  virtualization, and full cross-browser rendering coverage.
- Rig parallel implementations, all slated for deletion into the above:
  `RigWorkspaceView`, `RigSessionListPanel`, `RigChatView`, `RigTranscript`.
  `RigWorkspaceView` reuses `AppShell` and `EmptyState` but re-implements the
  session list and chat rendering next to a better version of both.
- Rig components with no cloud counterpart, kept for now: `RigActivityPanel`,
  `RigUsagePanel`, `RigSessionControls`, `RigUserInputPrompt`,
  `RigConnectionStatus`, `RigCommandPalette`, `RigFileMention`, `RigStatusBar`.

So: the mode split and the Rig transport work, the cloud stack is the quality
bar, and the Rig product surfaces are a lower-quality parallel implementation of
things cloud already does well. The work is to delete that parallel
implementation into the cloud one and then put both modes in one navigable
shell.

## State model: what gets unified, and how

The unification happens at three levels, and **not** at a fourth. At every level
the cloud module is the thing that survives and Rig is the thing that is rewritten
to feed it.

- Level 1 — **shared value and projection types**: the cloud message/summary
  types, widened only where a genuine second case exists.
- Level 2 — **shared concrete stores**: the cloud stores, instantiated directly
  by the Rig owner too (not subclassed, not wrapped).
- Level 3 — **shared `happy2-ui` components**: the cloud components, with the
  Rig ones deleted into them.
- Not a level — no `ChatStoreInterface`, no adapter, no facade, no aggregate
  root, no compatibility shim, and specifically no neutral abstraction invented
  "above" cloud and Rig so that neither has to change. AGENTS.md forbids this,
  and it would preserve the weaker design by making it a peer of the stronger
  one. The local stack and each cloud stack stay separate owners; they speak the
  cloud stack's nouns.

### Level 1: the cloud conversation types, widened (`happy2-state/src/conversation/`)

This module is `modules/chat`'s projection types moved out and renamed, plus the
Rig cases folded in as new closed variants. It is not a new vocabulary invented
between the two. Nothing in it mentions HTTP, a Rig session, or a cloud chat id —
those stay in the owning stack.

- `ConversationEntry` — the cloud `ChatMessageItem` generalized into a closed
  discriminated union:
    - `{ kind: "message" }` — the existing cloud case, essentially unchanged:
      authored text/markdown/attachments, `author`, reactions, audience. Rig
      messages project into exactly this and simply leave the collaborative
      fields empty. Streaming assistant output is this case with a generation
      status, not a separate top-level field as Rig has today.
    - `{ kind: "agentActivity" }` — the one genuinely new variant, and it is
      added because **cloud needs it too**: cloud already has `agentActivity` in
      its snapshot and `AgentActivityStrip`/`AgentRunCard` in the UI. A title, a
      status (`running | awaitingApproval | success | failed | stopped`), a
      compact detail (diff, command, path), and an expandable payload. This is
      the "nobody actually reads tool calls" shape — glanceable by default,
      expandable on demand — and it is what Rig's block rendering collapses into.
    - `{ kind: "notice" }` — system notices, joins, resets, compaction marks;
      cloud's existing system-notice message treatment generalized.
    - `{ kind: "request" }` — something is waiting for a human. Cloud already has
      three of these (plugin requests, document-write requests, permission
      reviews) with `ApprovalCard`; Rig's user-input questions become a fourth
      payload under the same kind and the same visual treatment.
- `ConversationAuthor` — cloud's `IdentityProjection` plus its existing
  human/automated distinction, made explicit as
  `{ kind: "person" } | { kind: "agent" }`. Rig synthesizes a "you" person and a
  model agent. `Message` already renders both, so this is renaming, not new UI.
- `ConversationSummary` — cloud's `SidebarChatProjection` renamed and given the
  fields Rig needs and cloud can also use: subtitle (cwd for Rig; participants or
  last message for cloud) and a live-activity marker
  (`running | awaitingInput | idle`), which cloud wants anyway for agent-driven
  chats. `RigSessionSummary` projects into it.
- `Loadable<T>` — cloud's, promoted out of `chatState.ts`. Rig's inline
  `"loading" | "ready" | "error"` + `error?` + `mutationError?` fields are
  deleted, not accommodated.
- `entriesMerge` / `entryEquivalent` / `entryCompare` — cloud's
  `messageItemsMerge` family renamed, keeping its reference-stability guarantees
  intact, since the React row-identity contract depends on them.

### Level 2: the cloud stores, used by both

- **Composer — cloud's store, adopted wholesale.** `composerStoreCreate` becomes
  the composer for local mode. `RigChatView`'s `useState` draft and
  `RigChatStore.messageSend(text)` are deleted; the Rig workspace owner
  materializes a composer store per session, listens for `textSubmitted`, and
  calls the Rig transport. Rig's extra affordances are added to the cloud store
  as first-class closed capabilities rather than as a Rig-specific escape hatch:
  shell mode (`!`), slash commands, and `@` file mentions with entity-first
  actions and events (`shellCommandSubmitted`, `commandInvoked`,
  `mentionQueryUpdated`). These are useful for cloud agent chats too. Cloud's
  audience and agent selection stay and are simply not enabled locally. Closed
  unions on both sides, not optional grab-bags.
- **Conversation list — cloud's sidebar store, with a second feeder.**
  `conversationListStore` is the sidebar store holding
  `Loadable<readonly ConversationSummary[]>`, selection, and grouping.
  `rigSessionListStore` stops being a surface store and becomes a private
  authoritative writer feeding it from Rig global events, exactly as
  `SyncCoordinator` differences feed it on the cloud side. Public actions and
  outputs (`conversationSelect`, `conversationCreate`, `conversationSelected`)
  are the cloud ones.
- **Reconciliation — cloud's discipline applied to Rig.** The Rig feeder must
  treat daemon events as delivery hints and reconcile durable state through a
  difference/refresh path, matching `SyncCoordinator`. Where Rig currently
  upserts whatever a payload carried, that is a defect to fix, not a style to
  keep.
- **Clock — the one place Rig's code is better placed than cloud's.**
  `rigClockStore` is a small, correct ticking-clock store and cloud sidebars need
  the same thing. It moves out of `rig/` into shared state as-is. Noted
  explicitly because it is the exception, not a precedent.
- **Selection → materialization — cloud's pattern, two owners.** Cloud keeps
  `chatOpen` + `SyncCoordinator`; the Rig owner keeps its own implementation
  (different transport, different lifetime) but is restated in cloud naming and
  cloud loading vocabulary, exposing `{ list, conversation }` so the shell picks
  an owner rather than branching on mode.
- **Workspace rail — genuinely new.** `workspaceRailStore` lists the one local
  workspace plus each joined cloud workspace with connection state and unread
  rollups, and owns selection. The only store aware that both modes exist; holds
  no conversation content.

### Level 3: the cloud components, with Rig's deleted into them

- `Message`/`MessageList` gain the `agentActivity`, `notice`, and `request`
  entry kinds. `RigTranscript` and `RigChatView` are **deleted**, not kept
  alongside; local chat renders through the cloud chat surface.
- `Composer` takes the cloud composer snapshot plus a closed capability union;
  Rig's mention, slash-command, and shell affordances migrate into it as gated
  capabilities and `RigChatView`'s copies go away.
- `RigSessionListPanel` and `RigWorkspaceView` are deleted into the cloud
  sidebar and shell, which consume `ConversationSummary` and stay virtualized
  and keyed by entity id.
- Rig components with no cloud counterpart stay for now — `RigActivityPanel`,
  `RigUsagePanel`, `RigSessionControls`, `RigUserInputPrompt`,
  `RigConnectionStatus` — but they must be brought up to the design system's
  bar (blueprint pages, cross-browser rendering tests, shared primitives) rather
  than grandfathered in as-is.

### Ordering constraint

Level 1 lands before level 2, and level 2 before the corresponding level-3
deletion, so no step needs a temporary adapter between old and new shapes. Each
conversion is a single feature: widen the cloud type, convert the Rig producer,
convert the consumer, delete the Rig type. No dual-write, and no parallel
implementation left behind at the end of a step.

## Plan of action

Each step is one atomic, independently mergeable feature. Server work (if any)
comes first with `gym` coverage and explicit approval before the UI work. Every
step below is "move Rig onto the cloud implementation," and each one must end
with the corresponding Rig code deleted.

1. **Promote the cloud conversation types.** *(done)* Move `modules/chat`'s
   projection types into `happy2-state/src/conversation/` as `ConversationEntry`,
   `ConversationAuthor`, `ConversationSummary`, `Loadable`, and the renamed
   merge/compare helpers, adding the `agentActivity` / `notice` / `request`
   variants that cloud also needs. Cloud keeps working unchanged; no Rig work
   yet.
2. **Adopt the cloud composer in local mode.** *(done)* Delete the `useState`
   draft from `RigChatView` and the text argument from
   `RigChatStore.messageSend`, materialize `composerStoreCreate` per Rig session,
   and add shell-mode / slash-command / mention capabilities to the cloud
   composer store as first-class closed concepts. Local product state stops
   living in React.
3. **Render local chat through the cloud chat surface.** *(landed; defects open,
   see "Known defects")* Project the Rig transcript (including streaming) into
   `ConversationEntry`, extend `Message`/`MessageList` to render every entry kind
   with compact, expandable agent activity, and delete `RigTranscript` and
   `RigChatView`.
4. **Render local sessions through the cloud sidebar.** *(landed; parity gaps
   open, see "Known defects")* Turn `rigSessionListStore` into a private feeder
   for `conversationListStore`, bring its event handling up to the
   difference-reconciliation discipline, and delete `RigSessionListPanel` and
   `RigWorkspaceView`.
5. **Workspace rail as the shell's top-level navigation.** Add
   `workspaceRailStore` and render the Discord-style rail: one local entry plus
   each cloud entry. The existing `DesktopInstanceSwitcher` semantics fold into
   it; `renderer.tsx` switches on the selected workspace instead of a start
   request mode.
6. **Cloud workspace trees materialized per server.** Make the cloud stack
   constructible more than once, keyed by server identity, so several cloud
   workspaces can be joined and switched between without a process restart.
   Nothing that is per-workspace may become process-global.
7. **Local mode inside the unified shell.** Connection status, Rig install flow,
   and directory picking become in-shell states of the local workspace rather
   than a pre-shell gate, so switching away and back does not tear it down. The
   surviving Rig-only components are brought up to the design system's blueprint
   and cross-browser testing bar in the same step.
8. **(Later, not now) Publishing a local session to a cloud workspace.** Owner
   opt-in, redaction of tokens/secrets/environment, a read-only projection for
   other members, and the server API and `gym` coverage behind it. The shared
   `ConversationEntry` vocabulary is what makes this cheap: publishing becomes a
   redacting projection, not a second data model.

## Known defects, open after steps 1–4

These are found and reproduced, not speculative. Steps 3 and 4 are not finished
until they are closed.

**The governing lesson.** Almost every defect below is one root cause: a shared
`happy2-ui` component already supports the behavior and the local surface never
opts in. The brand mark, the sidebar footer, and sidebar collapse/resize were all
reported separately by the user and were all this. Close this class by
inspection, not by screenshot: before calling a surface done, diff the props the
cloud caller passes to a shared component against what the local caller passes,
and justify every difference. Then check the stronger condition — that the same
component renders each functional zone in both stacks, not merely that props
line up.

- **Duplicate entry ids corrupt the transcript.** `rigConversationBuild` keys a
  durable tool call by the raw tool-call id
  (`rig/rigConversationProject.ts`, the `toolCall` branch) and the streaming
  projection keys the same call the same way. While a call is both durable and
  streaming, one call yields two entries under one id. `ConversationView` uses
  the entry id as the React key and `MessageList` feeds it to the virtualizer as
  `getItemKey`, so the two rows are measured and positioned as one item: text
  overlaps and scrolling jitters. Every other branch already uses a composite id
  (`${message.id}:${index}`, `${runId}:stream:${index}`); only the tool-call
  branches do not. Fix: emit one entry with stable identity across
  running → finished, plus a regression test asserting no duplicate ids.
  `MessageList` is not at fault and must not be worked around — it is untouched
  in this work and cloud uses it without trouble.
- **`AppShell` capabilities local never enables.** `AppRigView` passes only
  `sidebar`. Missing: `sidebarCollapsible` (no collapse/expand, no resize —
  contract documented on the prop), `windowControls`, `panelResizable`, and the
  `panelMaximizable`/`panelMaximized`/`onPanelMaximizedChange` trio. Cloud passes
  all of these from `ChatPage`. `Sidebar.onSectionAction` is the one genuine
  non-applicability: local has a single section with no create action.
- **Two different model pickers.** Cloud uses `ComposerModelControl`; local
  renders `RigSessionControls` with `fields={["model", "effort"]}` in the same
  composer slot. Local must use the shared control. The adaptation point is that
  `ComposerModelControl` takes flat `{ id, label }` choices while local carries
  `RigModelSelection` (provider + model) — join and parse at the call site, as
  `RigSessionControls` already does with `MODEL_ID_SEP`; do not fork the
  component or add a provider-aware variant. Afterwards, reassess what
  `RigSessionControls` is still for; delete it with its dev page if nothing
  remains.
- **Image paste is inert.** `Composer` implements paste but returns early
  without `onAttachmentsSelect`, and `ConversationView` never passes it. The
  composer snapshot already carries `attachments` and the send button already
  counts them, so state models attachments that nothing can create. Wire it
  through the existing `attachmentAdd`/`attachmentRemove` actions, render pending
  attachments so they can be removed before sending, and check the cloud path for
  the same omission.
- **No routing in local.** Cloud drives navigation with TanStack Router; local
  keeps the selection in `rigWorkspaceStore.selectedId` and renders `AppRigView`
  directly. A local session should be addressable by URL through the same route
  tree, with the shell reading the id from the match so the transcript stays
  mounted across selection changes. Materialization stays a store concern;
  *which* conversation is selected stops being one. Do not leave both
  authoritative.
- **Local is mounted outside the app's shared providers.** `happy2-desktop`'s
  `renderer.tsx` mounts `AppRigView` directly — outside `RouterProvider` and
  outside `ThemeScope`, both of which only `DesktopApp` establishes for the cloud
  tree. This is the structural root of both the missing router and the
  non-functional appearance toggle, and likely of further gaps. The clean
  resolution is probably that local mounts through the same entry shape as cloud
  rather than as a special case; that decision belongs to step 7 and should be
  taken deliberately rather than patched around.
- **Transcript presentation.** Activity rows do not share the message body's left
  inset, so the left edge is ragged; the collapsed `chevron-right` affordance is
  unwanted; activity rows are too loud (link-blue labels, saturated status dots)
  and should read as neutral secondary content with failure legible but
  restrained; and consecutive agent entries are not grouped, so the avatar and
  name repeat through one continuous turn. `Message` already supports `grouped`
  and `ConversationEntryView` forwards it — nothing computes it. Derive grouping
  in the projection and pass it as a prop: with a virtualized list a row must not
  infer its grouping from a sibling DOM node, or grouping flickers as rows mount
  and unmount.
- **Settings entry point.** Moving the local-only settings into a modal was
  right; opening it from a gear beside the composer model pill was an
  under-specified instruction, and it gives local a composer control cloud does
  not have. Reconsider the placement under the rule that local must not grow
  affordances cloud lacks.

## Validation notes

`happy2-ui`'s cross-browser rendering suite does not currently pass on a clean
checkout of `main` in this environment: `Button.test.tsx` fails identically with
and without this work (transparent border colors, missing icon `svg` elements),
which points at an environment/asset problem rather than a regression. Verify UI
work against that baseline — compare a run on your branch with a run on a clean
tree — rather than assuming a red suite is your fault, and fix the baseline
before relying on the suite as a gate.

## Constraints carried from AGENTS.md and DESIGN.md

- Desktop only. No mobile layouts or behavior.
- Every surface stays current on its own: SSE reconciliation for the focused
  surface, visibility-scoped polling only where no realtime channel exists, and
  never a manual refresh control.
- Product state lives in `happy2-state` surface stores with closed, typed,
  entity-first actions and events; `happy2-app` uses no `useState`/`useEffect`.
- Reusable visuals live in `happy2-ui` with blueprint pages and cross-browser
  rendering tests; application packages only compose them.
- No backward-compatibility branches by default: prefer the clean design over
  preserving obsolete behavior. Applied here, this means the Rig internals have
  no claim to survival — nothing is kept merely because it exists.
- When in doubt about any conflict between the two stacks, the cloud
  implementation is right and the Rig implementation is wrong until proven
  otherwise.
