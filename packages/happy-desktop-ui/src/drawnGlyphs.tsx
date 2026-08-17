import type { ReactNode } from "react";

/*
 * The one hand-drawn family in the house vocabulary.
 *
 * Every other `Icon` name is a font glyph from Ionicons or Octicons. The panel
 * affordance is the exception: neither family ships an arrow-free panel, and
 * Octicons' `sidebar-collapse` reads as a foreign object beside its Ionicons
 * neighbours — it is drawn on the full 16 box with a 1.5px stroke where an
 * Ionicons outline uses 1px inside a 14 x 12 ink box, so it lands a third
 * heavier and a notch larger than the workspace glyph directly above it.
 *
 * These shapes are therefore drawn to Ionicons' own metrics, measured off
 * `file-tray-outline` (the workspace glyph) at a 16px box:
 *
 *   - 1px stroke, round joins and caps;
 *   - a 14 x 12 ink box — outer edges at x 1..15, y 2..14;
 *   - a 2px outer corner radius.
 *
 * Coordinates are stroke centrelines on the 16 grid, so every edge lands on a
 * whole pixel at a 16px box and the shape stays crisp at 1x.
 *
 * Do not add a glyph here because a curated name is missing: pick the upstream
 * Ionicon or Octicon it maps to. This file exists for one shape the two
 * families do not contain.
 */
export type DrawnGlyphName = "panel-rail" | "panel-rail-filled";

/** The rail sits at x 5..6 — a compartment just under a third of the panel. */
const RAIL_CENTRE = 5.5;

/**
 * The panel outline: the 14 x 12 rounded box every panel state shares.
 * `strokeWidth` is on the 16 grid, so it scales with the icon like a glyph.
 */
const outline = (
    <rect
        fill="none"
        height={11}
        rx={1.5}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth={1}
        width={13}
        x={1.5}
        y={2.5}
    />
);

/**
 * The compartment as solid ink, drawn on outer geometry (x 1..5.5, y 2..14)
 * so its edge meets the outer edge of the outline stroke rather than showing a
 * seam inside it.
 */
const railFill = (
    <path
        d={`M ${RAIL_CENTRE} 2 H 3 A 2 2 0 0 0 1 4 V 12 A 2 2 0 0 0 3 14 H ${RAIL_CENTRE} Z`}
        fill="currentColor"
    />
);

const railLine = (
    <line
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={1}
        x1={RAIL_CENTRE}
        x2={RAIL_CENTRE}
        y1={2.5}
        y2={13.5}
    />
);

/*
 * The pair reads as one idea in two states: the panel is there and full, or the
 * panel is there and empty. Same silhouette, so a toggle never jumps.
 */
export const drawnGlyphs: Record<DrawnGlyphName, ReactNode> = {
    "panel-rail": (
        <>
            {outline}
            {railLine}
        </>
    ),
    "panel-rail-filled": (
        <>
            {railFill}
            {outline}
            {railLine}
        </>
    ),
};
