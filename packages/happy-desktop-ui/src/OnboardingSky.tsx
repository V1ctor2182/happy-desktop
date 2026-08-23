import { welcomeSkyDarkUrl, welcomeSkyUrl } from "./assets";
import type { ThemeMode } from "./ThemeScope";

interface OnboardingSkyProps {
    readonly appearance: ThemeMode;
    readonly className?: string;
}

/**
 * The paired sky paintings behind first-run onboarding.
 *
 * The picture and its contrast veil are one decorative object: every screen
 * that carries this scenery gets the same crop and the same appearance-aware
 * treatment, while the words in front of it remain the screen's own concern.
 */
export function OnboardingSky(props: OnboardingSkyProps) {
    return (
        <div
            aria-hidden="true"
            className={["happy-onboarding-sky", props.className].filter(Boolean).join(" ")}
            data-appearance={props.appearance}
            data-happy-desktop-ui="onboarding-sky"
        >
            <picture>
                {props.appearance === "system" ? (
                    <source media="(prefers-color-scheme: dark)" srcSet={welcomeSkyDarkUrl} />
                ) : null}
                <img
                    alt=""
                    className="happy-onboarding-sky__image"
                    draggable={false}
                    src={props.appearance === "dark" ? welcomeSkyDarkUrl : welcomeSkyUrl}
                />
            </picture>
            <span className="happy-onboarding-sky__scrim" />
        </div>
    );
}
