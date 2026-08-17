# happy-desktop-gym

`happy-desktop-gym` contains the reusable browser-rendering harness and an
isolated, host-native Electron performance gym for Happy and Rig.

## Electron/Rig gym

The gym creates a disposable run under
`.context/happy-desktop-gym/runs/<profile>-<uuid>` by default. It writes an
ownership marker, temporary `HOME`/`TMPDIR`/Rig server directory/Electron
user-data directory, deterministic Git repositories and real Rig worktrees,
then seeds sessions and history through Rig's HTTP API. It never writes Rig's
SQLite database directly. The realistic manifest reflects the measured local
shape (17 projects including Home, 45 worktrees with 8 ready and 37 archived,
and 524 session rows); Rig 0.2.0 has no public subagent-manufacturing endpoint,
so the subagent-shaped portion is represented by supported primary sessions
with long, tool-heavy Gym responses and is labeled in the manifest.
Preparation proves the exact project/worktree catalog, durable session, and
seeded-turn invariants through Rig APIs. Rig's normal session-summary
projection is intentionally bounded at 500 rows, so `catalog.sessionCount`
records the visible count and `sessionCatalogTruncated` labels when more
durable sessions exist; every seeded session is also re-read by ID. Messages and events are observed durable counts checked
against each profile's declared range, whose non-smoke minima enforce at least
two persisted messages and six lifecycle events per seeded turn; the measured
host snapshot is informational until a real prepare observes it. The run root retains
`achieved.json` before validation, including failed realistic/stress
preparations, so no unprepared host snapshot is claimed as seeded history. The
fixture manifest also validates the regular-repository shape:
smoke is 38 files with 9 changed records, 1,120 large-text lines, and 101,280
large-text bytes; realistic and stress scale those same nested modified,
added, renamed, and deleted paths to their declared file/byte/line targets.

Measured Electron stays host-native on macOS. Docker is intentionally not used
for the measured app; it remains an optional place to isolate a backend/tool
fixture if a workload needs one.

Build the app once, then prepare and run:

```sh
pnpm --dir packages/happy-desktop-electron build:profile:optimized
pnpm --dir packages/happy-desktop-gym gym:electron prepare --profile smoke
pnpm --dir packages/happy-desktop-gym gym:electron run --root .context/happy-desktop-gym/runs/<run> --workload all
```

`build:profile:optimized` enables the checked-in React DevTools profiling bridge
with the production-shaped renderer. The `gym:electron:run` script rebuilds this
optimized flavor, then launches the built `dist/main.js` through host Electron
with `HAPPY2_DESKTOP_PROFILE_MODE=optimized`; it never launches `pnpm dev`,
`dev:electron`, or a Vite server. Runs invoke the app's native profiler bridge
at each workload boundary and record the returned app-owned artifact manifest,
alongside workload timing/context and Playwright action traces under the owned
run root. The app owns React/DevTools, heap/DOM/process, and native trace
collection and artifact writing; Gym only starts/stops that bridge and records
its returned paths. Playwright UI traces are disabled by default and can be
requested with `--ui-trace`; they are debugging aids, not profiler artifacts.
Each workload sample references its unchanged manifest, Chromium trace, raw
metrics, and any React DevTools 6.1.5 backend profile payloads the bridge produced;
scenario timestamps and browser marks are the only Gym metadata added beside
them. An empty React-profile list remains an explicit bridge-capability result,
never a Gym replacement or re-serialization. If the profile build or bridge is
unavailable, Gym falls back to bounded heap/DOM/process snapshots and reports
the capability honestly.

`mixed-replay` is the end-to-end lane. It reads the existing
`gold-five-minute-session.v1.json` recording for its real submitted-message
patterns, submits those prompts concurrently to several durable Rig sessions,
and starts one real isolated `exec_command` turn that appends deterministic
large-file lines through the mounted fixture checkout. A single promise-
coordinated UI lane then switches repeatedly among foreground sessions while
all streams and the Git watcher are live, scrolls a virtualized long transcript
through large jumps, and exercises changed-file, document, and syntax
A→B→A sequences. Rig event history, the exact virtual changed-file row/stat
pair for `src/changes/modified/deep/large-modified.md`, and a host-side fixture
read are durable/event/UI barriers; the row is remounted after the real tool
completes and must report the profile's expected insertions plus `−16`
deletions. The lane does not use fixed sleeps as stream or file-arrival
barriers; the selection diagnostic deliberately holds a native range for two
seconds after the cold worker replacement has settled. SSE collectors
attach before submissions, and each run barrier is keyed by its returned run
ID. Every stream,
session switch, scroll, and file interaction has an ISO timestamp and latency,
alongside per-interaction buffered `PerformanceObserver` long-task observations,
before/after performance capture, and cache-oriented cold/warm timing evidence.
The same UI lane also measures transcript scroll stability directly in the
renderer: it samples message-list scrollTop, bottom distance, the first visible
virtual row, the lowest visible row's bottom-edge offset, row rectangles, and
client/scroll heights on every animation frame while dragging the real left-edge
panel splitter and while growing and shrinking the multiline composer.
Following readers must stay within 8px of the bottom without a temporary
break-and-recovery correction or overlapping virtual rows; parked readers must
retain the same lowest visible row and bottom-edge offset through splitter drags
in both directions and composer resizing. The recorded `scrollStability` phases
distinguish natural text rewrap during panel width changes from a lost scroll
anchor.
Rig 0.2.0's JustBash gym mount is the
actual ready managed worktree at `/workspace`; the live tool mutates that same
worktree while clustered sessions stream and switch in the same run. The
changed-file lane establishes a native browser text range only after the
highlight-first viewer reveals its final diff DOM. `changedFileSelection` then
records the exact native selection at 0, 100, 500, 1,000, and 2,000 milliseconds
while the concurrent streams continue.
Every sample must retain the same text, length, connected endpoints, and diff
mode, and Pierre's settled shadow DOM must not mutate at all. This proves stable
file/options identity prevents unrelated store notifications from rebuilding
an unchanged diff; the product does not bookmark or restore native selections.
highlight lane opens `README.md` → `src/long-transcript.md` → `README.md`
through MarkdownDocument/Pierre, requires the fenced-code completion barrier,
and records the Pierre Markdown A→B→A warm cycle. The mixed document lane uses
non-fenced Markdown paths for transport/file-loading timing separately.
The standalone `long-chat-scroll`, `session-switch-load`, and
`changed-files-warm` workloads expose those dimensions independently; `all`
runs them together with the existing boot/catalog/streaming/memory lanes. The
gold protocol frames are not
fabricated into the server: only the recording's submitted user text is reused
through real `submitMessage` calls, and the result records that limitation.
The launcher uses the workspace's Electron binary; when a package install has
not downloaded it yet, point `HAPPY_DESKTOP_ELECTRON_EXECUTABLE` at an installed
host Electron executable. The measured app is never moved into Docker.

Profiles are deterministic and versioned: `smoke`, `realistic`, and `stress`.
Use `--root` and `--artifact-dir` to choose explicit paths. Artifact paths must
remain in the run root or workspace `.context`.

```sh
pnpm --dir packages/happy-desktop-gym gym:electron prepare --profile realistic
pnpm --dir packages/happy-desktop-gym gym:electron run --root /absolute/run/root --workload mixed-replay
pnpm --dir packages/happy-desktop-gym gym:electron clean --root /absolute/run/root
```

`clean` refuses paths without the Gym ownership marker and refuses broad source
directories. Keep a run for inspection, or clean it explicitly after collecting
the artifacts.

## Local Rig availability

The bundled Rig daemon requires an authenticated inference provider. CI and
release validation deliberately have no provider credentials, so scenarios that
launch the real daemon should use the exported gate:

```ts
import { localRigIsUnavailable } from "happy-desktop-gym";

it.skipIf(localRigIsUnavailable)("starts the bundled Rig daemon", async () => {
    // ...
});
```

The gate is on whenever `CI` is set or
`HAPPY_DESKTOP_SKIP_LOCAL_RIG_TESTS=1`.

## Browser rendering harness

`gym/playwright` owns the reusable real-browser measurement harness. A consumer
supplies only a framework-specific mount callback; the harness supplies
independently sized surfaces, rendered border-box coordinates, computed CSS,
DOM text-baseline metrics, Retina screenshots, and visible-pixel analysis.

Visible pixels are reconstructed by capturing the integer-aligned render surface
against both black and white, then scanning the selected element's region on
that shared backing-pixel grid. For each backing pixel,
`Cwhite - Cblack = 255 * (1 - alpha)`, so the harness recovers coverage without
assuming a foreground color. `visibleMetrics()` reports exact raster bounds,
nonzero backing-pixel count, total alpha mass, and alpha-weighted optical center
relative to the selected element.

`textMetrics().baseline.fromElementTop` and `.fromSurfaceTop` report the live
DOM first-line baseline. `ink.baseline` and `verticalOffset` remain compatibility
aliases. The baseline comes from a temporary zero-size inline probe and is not
inferred from canvas. `textMetrics().fontMetrics` separately exposes the
browser's raw Canvas `TextMetrics` values.

`renderer.visibleMetrics([first, second])` measures independent elements on one
render surface from one black/white screenshot pair. Elements in one batch
cannot contain one another because changing ancestor backgrounds would otherwise
alter a second measurement's paint. `renderer.screenshot()` writes inspection
PNGs only when `VITE_HAPPY_DESKTOP_WRITE_SCREENSHOTS=1`; use
`pnpm --filter happy-desktop-gym test:playwright:artifacts` for a deliberate
artifact refresh.
