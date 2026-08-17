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
export type DrawnGlyphName = "panel-rail";

/** The rail's stroke centreline, a compartment just under a third across. */
const RAIL_X = 5.5;

/**
 * The rail is a short line rather than a full-height divider or a solid
 * compartment. Both of those were heavier than the outline holding them: a
 * fill puts more ink in this glyph than any Ionicons outline beside it carries
 * in total, and a divider that meets the frame reads as a second frame edge.
 * A line inset 2 from the inner edges says the same thing at the weight of the
 * rest of the set.
 */
const RAIL_INSET = 2;

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

const rail = (
    <line
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={1}
        x1={RAIL_X}
        x2={RAIL_X}
        y1={2.5 + RAIL_INSET}
        y2={13.5 - RAIL_INSET}
    />
);

/*
 * One shape for the affordance, in both of its states. The control is the same
 * act whichever way the panel currently sits, and its label already says which
 * way it goes; a glyph that changed under the pointer would be the only thing
 * in the chrome that does.
 */
export const drawnGlyphs: Record<DrawnGlyphName, ReactNode> = {
    "panel-rail": (
        <>
            {outline}
            {rail}
        </>
    ),
};
