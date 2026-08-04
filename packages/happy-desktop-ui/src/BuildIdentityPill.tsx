import type { CSSProperties, ReactElement } from "react";
import type { ToneName } from "./Avatar";

export type BuildIdentityPillProps = {
    className?: string;
    "data-testid"?: string;
    /** Full text shown on hover, e.g. the worktree path. */
    detail?: string;
    /** Short identity shown on the pill, e.g. "dev" or "escape-interrupts-session". */
    label: string;
    /** Optional click action (the app copies the worktree path). */
    onSelect?: () => void;
    style?: CSSProperties;
    tone?: ToneName;
};

/** Excludes "brand" (the product's own colour) and "slate" (reads as disabled chrome). */
const BUILD_IDENTITY_TONES = [
    "violet",
    "ember",
    "mint",
    "ocean",
    "rose",
    "amber",
] as const satisfies readonly ToneName[];

/** Deterministic tone for a build label, so one worktree keeps one colour. */
export function buildIdentityTone(label: string): ToneName {
    let hash = 0;
    for (let index = 0; index < label.length; index++) {
        hash = (hash * 31 + label.charCodeAt(index)) | 0;
    }
    return BUILD_IDENTITY_TONES[Math.abs(hash) % BUILD_IDENTITY_TONES.length];
}

/**
 * C-177 BuildIdentityPill — quiet dev-build identity mark (tone dot + mono
 * label) so a reader can tell one dev window apart from another at a glance:
 * main checkout vs. a git worktree. Renders a <button> when `onSelect` is
 * given, otherwise a plain <span>.
 */
export function BuildIdentityPill(props: BuildIdentityPillProps): ReactElement {
    const tone = props.tone ?? buildIdentityTone(props.label);
    const className = ["happy2-build-identity-pill", props.className].filter(Boolean).join(" ");
    const content = (
        <>
            <span
                aria-hidden="true"
                className="happy2-build-identity-pill__dot"
                data-happy-desktop-ui="build-identity-pill-dot"
            />
            <span
                className="happy2-build-identity-pill__label"
                data-happy-desktop-ui="build-identity-pill-label"
            >
                {props.label}
            </span>
        </>
    );
    return props.onSelect ? (
        <button
            className={className}
            data-happy-desktop-ui="build-identity-pill"
            data-testid={props["data-testid"]}
            data-tone={tone}
            onClick={() => props.onSelect?.()}
            style={props.style}
            title={props.detail ?? props.label}
            type="button"
        >
            {content}
        </button>
    ) : (
        <span
            className={className}
            data-happy-desktop-ui="build-identity-pill"
            data-testid={props["data-testid"]}
            data-tone={tone}
            style={props.style}
            title={props.detail ?? props.label}
        >
            {content}
        </span>
    );
}
