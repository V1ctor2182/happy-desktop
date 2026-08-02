import { partitionComponentProps } from "./componentProps";
import { type CSSProperties } from "react";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { LottieMark, type LottieMarkName } from "./LottieMark";
export type EmptyStateSize = "panel" | "inline";
export type EmptyStateAction = {
    label: string;
    icon?: IconName;
    onClick: () => void;
};
export type EmptyStateProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    icon: IconName;
    title: string;
    description?: string;
    action?: EmptyStateAction;
    size?: EmptyStateSize;
    /**
     * Draws a small animated mark over the medallion glyph instead of leaving
     * the glyph alone. Reserved for the states where the absence is the good
     * outcome — a caught-up inbox, a quiet home — never for a search that found
     * nothing, which is a miss and should not be congratulated.
     *
     * The glyph stays required and stays rendered underneath: it is what the
     * reader sees before the runtime loads, and what they keep if it cannot
     * load at all.
     */
    animation?: LottieMarkName;
};
/* Icon size for the medallion, per empty-state size. Both land the glyph box on
 * an integer inset inside the medallion (48→14, 40→11) so the composed icon
 * stays optically centered without a bespoke nudge. */
const mediaIconSize: Record<EmptyStateSize, 18 | 20> = { panel: 20, inline: 18 };
/* The mark fills more of the medallion than the glyph does, because sparkles
 * carry their own generous padding inside a 512 box. Still a mark, not a hero:
 * 36 and 30 sit inside the 48 and 40 medallions with the rhythm unchanged. */
const markSize: Record<EmptyStateSize, 30 | 36> = { panel: 36, inline: 30 };
const actionSize: Record<EmptyStateSize, "small" | "medium"> = { panel: "medium", inline: "small" };
/**
 * C-024 EmptyState — centered icon medallion + title + optional description +
 * optional action. Replaces the app's raw `.feature-empty` markup. Props-only,
 * desktop-only; the `panel` size fills and vertically centers inside its host
 * region, `inline` is a compact content-sized block.
 */
export function EmptyState(props: EmptyStateProps) {
    const [local] = partitionComponentProps(props, [
        "action",
        "animation",
        "className",
        "data-testid",
        "description",
        "icon",
        "size",
        "style",
        "title",
    ]);
    const size = () => local.size ?? "panel";
    return (
        <div
            className={["happy2-empty-state", local.className].filter(Boolean).join(" ")}
            data-happy2-ui="empty-state"
            data-size={size()}
            data-testid={local["data-testid"]}
            style={local.style}
        >
            <span
                className="happy2-empty-state__media"
                data-animated={local.animation === undefined ? undefined : ""}
                data-happy2-ui="empty-state-media"
            >
                <Icon name={local.icon} size={mediaIconSize[size()]} />
                {local.animation === undefined ? null : (
                    <LottieMark
                        className="happy2-empty-state__mark"
                        name={local.animation}
                        size={markSize[size()]}
                    />
                )}
            </span>
            <h2 className="happy2-empty-state__title" data-happy2-ui="empty-state-title">
                {local.title}
            </h2>
            {local.description ? (
                <p
                    className="happy2-empty-state__description"
                    data-happy2-ui="empty-state-description"
                >
                    {local.description}
                </p>
            ) : null}
            {local.action
                ? ((action) => (
                      <span
                          className="happy2-empty-state__actions"
                          data-happy2-ui="empty-state-actions"
                      >
                          <Button
                              icon={action.icon}
                              onClick={action.onClick}
                              size={actionSize[size()]}
                              variant="secondary"
                          >
                              {action.label}
                          </Button>
                      </span>
                  ))(local.action)
                : null}
        </div>
    );
}
