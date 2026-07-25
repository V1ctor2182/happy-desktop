import { type CSSProperties, type ReactNode } from "react";
import { Avatar } from "./Avatar";
import { Box } from "./Box";
import { Button } from "./Button";

export type SidebarFooterProps = {
    /** Display name beside the avatar; the identity this surface is rendered for. */
    name: string;
    /** Avatar initials fallback when no image is available. */
    initials: string;
    /** Durable avatar image, when the identity has one. */
    imageUrl?: string;
    /** Shows the presence dot on the avatar. */
    online?: boolean;
    /**
     * Opens the identity's profile. Omit it on a surface with no profile to
     * open — the identity then renders as a plain, non-interactive row rather
     * than a button wired to nothing.
     */
    onProfileOpen?: () => void;
    /**
     * Opens administration. Omit it wherever no administration exists or is
     * reachable; the control is then genuinely absent, not disabled.
     */
    onAdminOpen?: () => void;
    /** Overrides the administration control's label. */
    adminLabel?: string;
    /** Opens this surface's settings. Omit it when the surface has none. */
    onSettingsOpen?: () => void;
    /** Overrides the settings control's label. */
    settingsLabel?: string;
    /** The appearance currently rendered; picks the toggle's icon and label. */
    appearance: "dark" | "light";
    onAppearanceToggle: () => void;
    /** Extra trailing controls, placed before the appearance toggle. */
    actions?: ReactNode;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/**
 * SidebarFooter — the identity strip pinned to the bottom of a navigation
 * column: who the surface is rendered for, the controls that belong to that
 * identity, and the appearance toggle.
 *
 * Every affordance beyond the identity and the appearance toggle is optional,
 * because the surfaces that use this differ in what genuinely exists rather than
 * in what they choose to show. A workspace with an account has a profile to open
 * and may have administration; a local machine-owned workspace has neither. An
 * absent handler removes its control entirely instead of rendering a disabled
 * one, so there is no mode flag here and no control wired to nothing.
 */
export function SidebarFooter(props: SidebarFooterProps) {
    const identity = (
        <>
            <Avatar
                aria-label={props.online ? `${props.name} — online` : props.name}
                imageUrl={props.imageUrl}
                initials={props.initials}
                online={props.online}
                size="sm"
                tone="brand"
            />
            <span className="happy2-sidebar__profile-name">{props.name}</span>
        </>
    );
    return (
        <Box
            className={props.className}
            data-happy2-ui="sidebar-footer"
            data-testid={props["data-testid"]}
            style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                width: "100%",
                ...props.style,
            }}
        >
            {props.onProfileOpen ? (
                <button
                    aria-label="Open profile"
                    className="happy2-sidebar__profile"
                    data-happy2-ui="sidebar-profile"
                    onClick={props.onProfileOpen}
                    type="button"
                >
                    {identity}
                </button>
            ) : (
                <span
                    className="happy2-sidebar__profile happy2-sidebar__profile--static"
                    data-happy2-ui="sidebar-profile"
                >
                    {identity}
                </span>
            )}
            {props.actions}
            {props.onAdminOpen ? (
                <Button
                    aria-label={props.adminLabel ?? "Administration"}
                    icon="settings"
                    iconOnly
                    onClick={props.onAdminOpen}
                    size="small"
                    variant="ghost"
                />
            ) : null}
            {props.onSettingsOpen ? (
                <Button
                    aria-label={props.settingsLabel ?? "Settings"}
                    icon="settings"
                    iconOnly
                    onClick={props.onSettingsOpen}
                    size="small"
                    variant="ghost"
                />
            ) : null}
            <Button
                aria-label={
                    props.appearance === "dark" ? "Use light appearance" : "Use dark appearance"
                }
                icon={props.appearance === "dark" ? "sun" : "moon"}
                iconOnly
                onClick={props.onAppearanceToggle}
                size="small"
                variant="ghost"
            />
        </Box>
    );
}
