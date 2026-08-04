# happy-desktop-gym

`gym` provides Happy Desktop's browser-rendering measurement harness and the
availability gate for scenarios that launch a local Rig daemon.

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
