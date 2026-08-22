import type { ReactNode } from "react";
import { AppShell } from "../../AppShell";
import { Box } from "../../Box";
import { Icon, type IconName } from "../../Icon";
import { PanelHeader } from "../../PanelHeader";
import { ScrollArea } from "../../Scrollbar";
import { Sidebar } from "../../Sidebar";

export interface HappyAgentSettingsCategory {
    readonly id: string;
    readonly label: string;
    readonly icon: IconName;
}

export type HappyAgentSettingsShellProps = {
    activeCategoryId: string;
    categories: readonly HappyAgentSettingsCategory[];
    children: ReactNode;
    /** The open category's own subtitle, shown under its title. */
    description?: string;
    onCategorySelect: (id: string) => void;
    /** Leaves settings and returns to the workspace. */
    onClose: () => void;
    title: string;
    /** Native macOS window chrome, matching the workspace shell it replaces. */
    windowControls?: boolean;
    windowFullScreen?: boolean;
};

/**
 * The local workspace's settings window: a permanent category column beside one
 * category's body.
 *
 * The column is not the workspace sidebar and does not collapse — settings is a
 * two-pane place with nothing to gain from hiding half of it — so the control at
 * the top of that column is the way back out rather than a collapse toggle. It is
 * the `Sidebar` drill-down heading, which puts the back control on the same line
 * as the workspace's own toggle and clear of the native traffic lights.
 */
export function HappyAgentSettingsShell(props: HappyAgentSettingsShellProps) {
    return (
        <AppShell
            windowControls={props.windowControls}
            windowFullScreen={props.windowFullScreen}
            sidebar={
                <Sidebar
                    activeItemId={props.activeCategoryId}
                    onBack={props.onClose}
                    onItemSelect={props.onCategorySelect}
                    sections={[
                        {
                            id: "categories",
                            items: props.categories.map((category) => ({
                                icon: category.icon,
                                id: category.id,
                                kind: "view" as const,
                                label: category.label,
                            })),
                        },
                    ]}
                    title="Settings"
                />
            }
        >
            <PanelHeader>
                <Box className="happy2-happy-agent-settings__heading">
                    <Icon name={categoryIcon(props)} size={16} />
                    <span
                        className="happy2-happy-agent-settings__heading-title"
                        data-happy2-ui="happy-agent-settings-heading-title"
                    >
                        {props.title}
                    </span>
                    {props.description ? (
                        <span
                            className="happy2-happy-agent-settings__heading-description"
                            data-happy2-ui="happy-agent-settings-heading-description"
                        >
                            {props.description}
                        </span>
                    ) : null}
                </Box>
            </PanelHeader>
            <ScrollArea
                className="happy2-happy-agent-settings__body"
                data-happy2-ui="happy-agent-settings-body"
                viewportClassName="happy2-happy-agent-settings__body-viewport"
            >
                <Box className="happy2-happy-agent-settings__content">{props.children}</Box>
            </ScrollArea>
        </AppShell>
    );
}

function categoryIcon(props: HappyAgentSettingsShellProps): IconName {
    return (
        props.categories.find((category) => category.id === props.activeCategoryId)?.icon ??
        "settings"
    );
}

export interface HappyAgentSettingsSectionProps {
    children: ReactNode;
    description?: string;
    /**
     * `form` tiles `FormRow`s, which already carry their own hairline, so the
     * block adds no gap. `cards` separates free-standing cards instead.
     */
    rows?: "form" | "cards";
    title: string;
}

/** One titled block of settings rows inside a category body. */
export function HappyAgentSettingsSection(props: HappyAgentSettingsSectionProps) {
    return (
        <section
            className="happy2-happy-agent-settings__section"
            data-happy2-ui="happy-agent-settings-section"
        >
            <Box className="happy2-happy-agent-settings__section-heading">
                <h2
                    className="happy2-happy-agent-settings__section-title"
                    data-happy2-ui="happy-agent-settings-section-title"
                >
                    {props.title}
                </h2>
                {props.description ? (
                    <p
                        className="happy2-happy-agent-settings__section-description"
                        data-happy2-ui="happy-agent-settings-section-description"
                    >
                        {props.description}
                    </p>
                ) : null}
            </Box>
            <Box
                className="happy2-happy-agent-settings__section-rows"
                data-rows={props.rows ?? "form"}
            >
                {props.children}
            </Box>
        </section>
    );
}
