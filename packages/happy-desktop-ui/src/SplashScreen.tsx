import { partitionComponentProps } from "./componentProps";
import { type CSSProperties } from "react";
import { happyLogoUrl } from "./assets";

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
}

/**
 * C-161 SplashScreen — what the window holds while the app decides what to show:
 * the workspace surface with the Happy mark centered on it, and nothing else by
 * default. The mark renders muted (grayscale, faded) rather than in the brand
 * orange, because this screen means "still waking up", not "here is the Happy
 * brand" — a bright mark reads as a deliberate splash and fights the crossfade
 * it is about to lose. It carries no spinner, because it is on screen only as
 * long as the first probe takes and anything more would flash; the optional
 * `note` exists for the one case that isn't instant — a slow local Happy Agent start —
 * and never shifts the mark's position when it appears. The owner crossfades
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
                    className="happy-splash-screen__mark"
                    data-happy-desktop-ui="splash-screen-mark"
                    src={happyLogoUrl}
                />
                {local.note !== undefined ? (
                    <div
                        className="happy-splash-screen__note"
                        data-happy-desktop-ui="splash-screen-note"
                    >
                        {local.note}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
