import { type CSSProperties } from "react";

export interface ContextMeterProps {
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly style?: CSSProperties;
    /** Tokens already spent in the window. */
    readonly usedTokens: number;
    /** The whole context window. */
    readonly totalTokens: number;
    /** True when the underlying count is estimated rather than reported. */
    readonly approximate?: boolean;
}

/** Above this share used, the bar asks for a compaction; above the second, it insists. */
const COMPACT_FRACTION = 0.75;
const CRITICAL_FRACTION = 0.9;

function tokensFormat(tokens: number): string {
    if (tokens < 1000) return String(Math.max(0, Math.round(tokens)));
    const thousands = tokens / 1000;
    if (thousands < 1000)
        return `${thousands < 100 ? thousands.toFixed(1).replace(/\.0$/, "") : String(Math.round(thousands))}k`;
    const millions = thousands / 1000;
    return `${millions.toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * ContextMeter — how much of the model's context window the conversation has
 * spent, as a short bar with the numbers behind it.
 *
 * It rides at the end of the composer's control row, beside the access mode and
 * the speed, because it belongs to the message being written: the reader is
 * about to type one more and wants to know whether it still fits. At rest only
 * the bar shows — the proportion is the whole answer at a glance — and pointing
 * at it slides the percentage and the token counts out to its left.
 *
 * Quiet by default. It takes colour only once compacting is the next thing to
 * do, so the colour means something when it appears.
 */
export function ContextMeter(props: ContextMeterProps) {
    const total = Math.max(0, props.totalTokens);
    const used = Math.max(0, Math.min(props.usedTokens, total));
    const fraction = total === 0 ? 0 : used / total;
    const percent = Math.round(fraction * 100);
    const tone =
        fraction >= CRITICAL_FRACTION
            ? "critical"
            : fraction >= COMPACT_FRACTION
              ? "compact"
              : "ample";
    return (
        <div
            aria-label={`${tokensFormat(used)} of ${tokensFormat(total)} context tokens used${props.approximate ? ", approximate" : ""}`}
            className={["happy2-context-meter", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="context-meter"
            data-testid={props["data-testid"]}
            data-tone={tone}
            role="img"
            style={props.style}
            title={`${tokensFormat(used)} of ${tokensFormat(total)} context tokens used${props.approximate ? " (approximate)" : ""}${tone === "ample" ? "" : " — compact the conversation to free room"}`}
        >
            <span aria-hidden="true" className="happy2-context-meter__readout">
                <span className="happy2-context-meter__percent">
                    {props.approximate ? "~" : ""}
                    {percent}%
                </span>
                <span className="happy2-context-meter__tokens">
                    {tokensFormat(used)}/{tokensFormat(total)}
                </span>
            </span>
            <span
                aria-hidden="true"
                className="happy2-context-meter__track"
                data-happy2-ui="context-meter-track"
            >
                {/*
                 * The fill is a width, not a transform: the bar is one hairline
                 * tall and a scaled fill would smear its rounded end.
                 */}
                <span
                    className="happy2-context-meter__fill"
                    data-happy2-ui="context-meter-fill"
                    style={{ width: `${String(fraction * 100)}%` }}
                />
                {/*
                 * Where compacting becomes the right move, notched into the
                 * track itself, so the fill approaching it is legible before the
                 * colour changes rather than only after.
                 */}
                <span
                    className="happy2-context-meter__threshold"
                    style={{ left: `${String(COMPACT_FRACTION * 100)}%` }}
                />
            </span>
        </div>
    );
}
