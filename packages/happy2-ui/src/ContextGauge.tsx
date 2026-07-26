import { type CSSProperties } from "react";

export interface ContextGaugeProps {
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly style?: CSSProperties;
    /** Share of the context window still free, 0–1. */
    readonly remainingFraction: number;
    /** Tokens still free, for the readout and the tooltip. */
    readonly remainingTokens: number;
    /** The whole window, named only in the tooltip. */
    readonly totalTokens: number;
    /** True when the underlying count is estimated rather than reported. */
    readonly approximate?: boolean;
}

/** Below this share free, the ring warns; below the second, it alarms. */
const LOW_FRACTION = 0.25;
const CRITICAL_FRACTION = 0.1;

function tokensFormat(tokens: number): string {
    if (tokens < 1000) return String(Math.max(0, Math.round(tokens)));
    const thousands = tokens / 1000;
    if (thousands < 1000)
        return `${thousands < 100 ? thousands.toFixed(1).replace(/\.0$/, "") : String(Math.round(thousands))}k`;
    const millions = thousands / 1000;
    return `${millions.toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * ContextGauge — a ring showing how much context window is left, with the
 * percentage beside it.
 *
 * Deliberately phrased as remaining rather than consumed. The reader's question
 * is how much longer this conversation can run before it has to be compacted,
 * and a ring that fills up as things get worse answers that backwards: here the
 * ring empties, and empty means out of room.
 *
 * Drawn with a conic gradient rather than an icon glyph, because the one thing
 * it has to show is a continuous proportion, which no glyph can.
 */
export function ContextGauge(props: ContextGaugeProps) {
    const fraction = Math.max(0, Math.min(1, props.remainingFraction));
    const percent = Math.round(fraction * 100);
    const tone =
        fraction <= CRITICAL_FRACTION ? "critical" : fraction <= LOW_FRACTION ? "low" : "ample";
    const total = tokensFormat(props.totalTokens);
    const remaining = tokensFormat(props.remainingTokens);
    return (
        <span
            // A bare "34%" says nothing on its own, so the whole sentence is the
            // accessible name and the visible parts are decoration under it.
            aria-label={`${remaining} of ${total} context tokens left${props.approximate ? ", approximate" : ""}`}
            className={["happy2-context-gauge", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="context-gauge"
            data-testid={props["data-testid"]}
            data-tone={tone}
            role="img"
            style={props.style}
            title={`${remaining} of ${total} tokens of context left${props.approximate ? " (approximate)" : ""}`}
        >
            <span
                aria-hidden="true"
                className="happy2-context-gauge__ring"
                data-happy2-ui="context-gauge-ring"
                style={{ ["--happy2-context-gauge-turn" as string]: `${fraction}turn` }}
            />
            <span aria-hidden="true" className="happy2-context-gauge__value">
                {percent}%
            </span>
        </span>
    );
}
