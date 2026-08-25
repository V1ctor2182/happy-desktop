import { partitionComponentProps } from "./componentProps";
import { type CSSProperties } from "react";
import { happyLogoBlackUrl } from "./assets";
import { SegmentedProgress, type SegmentedProgressSegment } from "./SegmentedProgress";

export interface SplashScreenProps {
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly style?: CSSProperties;
    /** Accessible name for the mark, e.g. the product it is starting. */
    readonly label?: string;
    /**
     * A single quiet reassurance line under the mark, e.g. "Still starting Happy Agent…".
     * Absent by default: most loads resolve before there is anything worth
     * saying, and the mark stays optically centered whether or not this is set.
     */
    readonly note?: string;
    /**
     * The named steps of the start this screen is covering, and where it has
     * got to in them. Absent by default, for the same reason the note is: a load
     * that resolves in a few frames has nothing to report, and the steps belong
     * to whatever is running them rather than to this screen.
     */
    readonly steps?: readonly SegmentedProgressSegment[];
    /** Names the sequence for a screen reader when steps are shown. */
    readonly stepsLabel?: string;
}

/**
 * C-161 SplashScreen — what the window holds while the app decides what to show:
 * the workspace surface with the Happy mark centered on it, and nothing else by
 * default. The mark renders muted rather than at full strength, because this
 * screen means "still waking up", not "here is the Happy brand" — a strong
 * mark reads as a deliberate splash and fights the crossfade
 * it is about to lose. It carries no spinner, because it is on screen only as
 * long as the first probe takes and anything more would flash; the optional
 * `note` and `steps` exist for the case that isn't instant — a local Happy Agent
 * that has to start — and neither shifts the mark's position when it appears.
 * They are held back for the first moments by the stylesheet rather than by a
 * timer here, so a start that resolves quickly shows the mark alone and a start
 * that does not explains itself. The owner crossfades
 * this screen to whatever resolves — the sign-in card or the workspace — so the
 * mark dissolves rather than cutting away. Props only: no timers, no state, no
 * animation of its own.
 */
export function SplashScreen(props: SplashScreenProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "label",
        "note",
        "steps",
        "stepsLabel",
    ]);
    return (
        <div
            className={["happy-splash-screen", local.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="splash-screen"
            data-testid={local["data-testid"]}
            style={local.style}
        >
            <div className="happy-splash-screen__body">
                <img
                    alt={local.label ?? "Happy"}
                    className="happy-brand-logo happy-splash-screen__mark"
                    data-happy-desktop-ui="splash-screen-mark"
                    src={happyLogoBlackUrl}
                />
                {local.note !== undefined || local.steps !== undefined ? (
                    <div
                        className="happy-splash-screen__below"
                        data-happy-desktop-ui="splash-screen-below"
                    >
                        {local.steps !== undefined ? (
                            <SegmentedProgress
                                data-testid="splash-screen-progress"
                                label={local.stepsLabel ?? "Startup progress"}
                                segments={local.steps}
                            />
                        ) : null}
                        {local.note !== undefined ? (
                            <div
                                className="happy-splash-screen__note"
                                data-happy-desktop-ui="splash-screen-note"
                            >
                                {local.note}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
