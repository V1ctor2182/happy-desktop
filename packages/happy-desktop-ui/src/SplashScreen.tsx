import { partitionComponentProps } from "./componentProps";
import { type CSSProperties } from "react";
import { happyLogoUrl } from "./assets";

export interface SplashScreenProps {
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly style?: CSSProperties;
    /** Accessible name for the mark, e.g. the product it is starting. */
    readonly label?: string;
}

/**
 * C-161 SplashScreen — what the window holds while the app decides what to show:
 * the workspace surface with the Happy mark centered on it, and nothing else. It
 * carries no spinner and no copy, because it is on screen only as long as the
 * first probe takes and anything more would flash. The owner crossfades it to
 * whatever resolves — the sign-in card or the workspace — so the mark dissolves
 * rather than cutting away. Props only: no timers, no state, no animation of its
 * own.
 */
export function SplashScreen(props: SplashScreenProps) {
    const [local] = partitionComponentProps(props, ["className", "data-testid", "style", "label"]);
    return (
        <div
            className={["happy2-splash-screen", local.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="splash-screen"
            data-testid={local["data-testid"]}
            style={local.style}
        >
            <img
                alt={local.label ?? "Happy"}
                className="happy2-splash-screen__mark"
                data-happy-desktop-ui="splash-screen-mark"
                src={happyLogoUrl}
            />
        </div>
    );
}
