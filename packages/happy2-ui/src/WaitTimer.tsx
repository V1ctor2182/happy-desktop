import type { CSSProperties } from "react";

/**
 * How long is left, in the two largest units that still say something. A wait
 * measured in days does not need its seconds, and a wait of forty seconds does
 * not need a leading "0m", so a trailing zero unit is dropped rather than
 * padded.
 */
export function waitRemainingLabel(remainingMs: number): string {
    const total = Math.max(0, Math.ceil(remainingMs / 1000));
    const days = Math.floor(total / 86_400);
    const hours = Math.floor((total % 86_400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    return `${seconds}s`;
}

/** The calendar day a wait ends on, with no clock time — the hover answer. */
function waitFinishDate(finishAt: number): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(finishAt);
}

export type WaitTimerProps = {
    /** Epoch milliseconds the wait began at; the empty end of the ring. */
    startedAt: number;
    /** Epoch milliseconds the wait ends at; the full end of the ring. */
    finishAt: number;
    /**
     * The reference time to render against, from the owning surface's clock.
     * This component owns no timer: the surface already ticks for the elapsed
     * readout beside it, and a second clock here would drift against it.
     */
    now: number;
    /** Diameter of the ring in CSS pixels. */
    size?: number;
    className?: string;
    style?: CSSProperties;
};

/** Ring stroke width in CSS pixels; the track and the fill share it. */
const RING_STROKE = 2;

/**
 * The share of the wait already spent, as an SVG arc. It is a measurement, not
 * an icon: an indeterminate spinner would say "something is happening" when the
 * one thing worth knowing is how much of a known interval is gone.
 */
function WaitTimerRing(props: { progress: number; size: number }) {
    const radius = (props.size - RING_STROKE) / 2;
    const circumference = 2 * Math.PI * radius;
    const center = props.size / 2;
    return (
        <svg
            aria-hidden="true"
            className="happy2-wait-timer__ring"
            data-happy2-ui="wait-timer-ring"
            data-progress={Math.round(props.progress * 100)}
            height={props.size}
            viewBox={`0 0 ${props.size} ${props.size}`}
            width={props.size}
        >
            <circle
                className="happy2-wait-timer__track"
                cx={center}
                cy={center}
                fill="none"
                r={radius}
                strokeWidth={RING_STROKE}
            />
            <circle
                className="happy2-wait-timer__fill"
                cx={center}
                cy={center}
                fill="none"
                r={radius}
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - props.progress)}
                strokeLinecap="round"
                strokeWidth={RING_STROKE}
                transform={`rotate(-90 ${center} ${center})`}
            />
        </svg>
    );
}

/**
 * WaitTimer — what an agent that is deliberately waiting shows while it waits:
 * a determinate ring filling across the interval and the time left beside it.
 * Pointing at it names the day the wait ends on. The countdown already answers
 * everything shorter than a day, so the absolute deadline — which stops being
 * true the moment it is written — stays out of the line.
 */
export function WaitTimer(props: WaitTimerProps) {
    const size = props.size ?? 14;
    const span = props.finishAt - props.startedAt;
    const elapsed = props.now - props.startedAt;
    const progress = span > 0 ? Math.min(1, Math.max(0, elapsed / span)) : 1;
    const remaining = props.finishAt - props.now;
    return (
        <span
            className={["happy2-wait-timer", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="wait-timer"
            style={props.style}
            title={`Until ${waitFinishDate(props.finishAt)}`}
        >
            <WaitTimerRing progress={progress} size={size} />
            <span className="happy2-wait-timer__label" data-happy2-ui="wait-timer-label">
                {remaining > 0 ? `Wait for ${waitRemainingLabel(remaining)}` : "Wait ending"}
            </span>
        </span>
    );
}
