import { type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
    Avatar,
    Box,
    Button,
    DesktopInstanceSwitcher,
    Sidebar,
    SidebarAppsSection,
    StoreSurface,
    type AdminPageSection,
    type IconName,
    type SidebarItem,
    type SidebarSection,
} from "happy2-ui";
import type { AppRouterContext } from "../navigation/appRouterContext";
import { adminSectionsProject } from "../navigation/adminSectionsProject";
import { usePluginAssetMasks, type PluginAssetMasks } from "../pluginAssets";
import { sidebarAppEntries } from "../views/AppsView";
import { PluginMenuContribution } from "../views/PluginContributionRenderer";
import type { PluginNavigationSurface } from "../pluginContributions";
import { ChatView } from "../views/ChatView";

/** Which navigation column the workspace shows: the chat list or a drill-down. */
export type WorkspaceSidebarSelection =
    | { readonly kind: "chats" }
    | { readonly kind: "admin"; readonly section: AdminPageSection }
    | { readonly kind: "apps"; readonly appId?: string };

export interface WorkspaceShellProps {
    context: AppRouterContext;
    chatId?: string;
    conversationKind: "chat" | "channel";
    onChatSelect: (chatId: string | undefined, kind: "chat" | "channel", replace?: boolean) => void;
    /** The active screen, when it replaces the conversation area. */
    workspaceScreen?: ReactNode;
    sidebar: WorkspaceSidebarSelection;
    /** Highlighted workspace navigation row, derived from the active route. */
    navActiveId: string;
}

/** Label and icon for each administration sub-section in the drill-down sidebar. */
const adminSectionMeta: Record<AdminPageSection, { label: string; icon: IconName }> = {
    users: { label: "Users", icon: "users" },
    reports: { label: "Reports", icon: "shield" },
    automations: { label: "Automations", icon: "zap" },
    integrations: { label: "Integrations", icon: "link" },
    images: { label: "Agent images", icon: "spark" },
    secrets: { label: "Agent secrets", icon: "shield" },
    plugins: { label: "Plugins", icon: "braces" },
    roles: { label: "Roles", icon: "shield" },
};

/**
 * Composes the persistent workspace: the navigation column, its footer controls,
 * and the `ChatView` that owns the conversation leases. The workspace layout route
 * renders exactly one of these for the lifetime of the workspace, so the sidebar,
 * its scroll position, and every retained conversation survive navigation between
 * workspace screens.
 */
export function WorkspaceShell(props: WorkspaceShellProps) {
    const context = props.context;
    const state = context.state;
    const navigate = useNavigate();
    const masks = usePluginAssetMasks(state);
    const overlays = state.overlays();
    const adminSections = adminSectionsProject(context.permissions);
    const user = context.session?.user;
    const userName = user?.firstName ?? "Profile";
    const userInitials = user?.firstName?.slice(0, 2).toUpperCase() ?? "?";

    // Channel and agent creation is driven by the sidebar's per-section actions and
    // the composer, so the shell supplies a stable create request.
    const createRequest = { kind: "agent" as const, nonce: 0 };

    const instanceSwitcher = context.desktopRuntime ? (
        <DesktopInstanceSwitcher {...context.desktopRuntime} />
    ) : undefined;

    /**
     * Profile, the permission-gated Administration control, and the appearance
     * toggle, pinned to the bottom of whichever navigation column is shown.
     * Administration is absent when no section is reachable.
     */
    const sidebarFooter = (
        <Box style={{ display: "flex", alignItems: "center", gap: "4px", width: "100%" }}>
            <button
                aria-label="Open profile"
                className="happy2-sidebar__profile"
                data-happy2-ui="sidebar-profile"
                onClick={() => overlays.getState().overlayProfileOpen(user?.id ?? "me")}
                type="button"
            >
                <Avatar
                    aria-label={`${userName} — online`}
                    imageUrl={user?.avatarUrl}
                    initials={userInitials}
                    online
                    size="sm"
                    tone="brand"
                />
                <span className="happy2-sidebar__profile-name">{userName}</span>
            </button>
            {adminSections.length > 0 ? (
                <Button
                    aria-label="Administration"
                    icon="settings"
                    iconOnly
                    onClick={() =>
                        void navigate({
                            params: { section: adminSections[0]! },
                            to: "/admin/$section",
                        })
                    }
                    size="small"
                    variant="ghost"
                />
            ) : null}
            <Button
                aria-label={
                    context.appearance === "dark" ? "Use light appearance" : "Use dark appearance"
                }
                icon={context.appearance === "dark" ? "sun" : "moon"}
                iconOnly
                onClick={context.appearanceToggle}
                size="small"
                variant="ghost"
            />
        </Box>
    );

    // Administration lives in the footer, so the rows above the chat list are the
    // always-available workspace drill-downs.
    const navItems: SidebarItem[] = [
        { id: "apps", kind: "view", icon: "spark", label: "Apps" },
        { id: "documents", kind: "view", icon: "doc", label: "Documents" },
    ];
    const navSection: SidebarSection = { id: "workspace", items: navItems };

    const sidebarOverride =
        props.sidebar.kind === "admin"
            ? adminSidebar(props.sidebar.section)
            : props.sidebar.kind === "apps"
              ? appsSidebar(props.sidebar.appId)
              : undefined;

    return (
        <ChatView
            adminStartSection={adminSections[0] ?? "users"}
            canOpenAdmin={adminSections.length > 0}
            chatId={props.chatId}
            conversationKind={props.conversationKind}
            createRequest={createRequest}
            navActiveId={props.navActiveId}
            navSection={navSection}
            onChatSelect={props.onChatSelect}
            onNavSelect={navSelect}
            overlays={overlays}
            platform={context.platform}
            session={context.session}
            sidebarFooter={sidebarFooter}
            sidebarHeaderAccessory={instanceSwitcher}
            sidebarOverride={sidebarOverride}
            state={state}
            windowControls={context.platform === "desktop"}
            workspaceOverride={props.workspaceScreen}
        />
    );

    function navSelect(id: string) {
        if (id === "apps") void navigate({ to: "/apps" });
        else if (id === "documents") void navigate({ to: "/documents" });
        else props.onChatSelect(undefined, "chat");
    }

    function adminSidebar(section: AdminPageSection) {
        return (
            <Sidebar
                activeItemId={section}
                footer={sidebarFooter}
                headerAccessory={instanceSwitcher}
                onBack={() => props.onChatSelect(undefined, "chat")}
                onItemSelect={(id) =>
                    void navigate({
                        params: { section: id as AdminPageSection },
                        to: "/admin/$section",
                    })
                }
                sections={[
                    {
                        id: "admin-sections",
                        items: adminSections.map((entry) => ({
                            id: entry,
                            kind: "view" as const,
                            icon: adminSectionMeta[entry].icon,
                            label: adminSectionMeta[entry].label,
                        })),
                    },
                ]}
                title="Administration"
            />
        );
    }

    function appsSidebar(appId?: string) {
        return (
            <StoreSurface store={state.pluginNavigation()}>
                {(nav) => (
                    <SidebarAppsSection
                        activeAppId={appId ?? ""}
                        apps={sidebarAppEntries(
                            nav.apps.type === "ready" ? nav.apps.value : [],
                        ).map((app) => ({
                            id: app.id,
                            title: app.title,
                            maskUrl: masks.maskUrl(app.installationId, app.assetId),
                            available: app.available,
                        }))}
                        headerAccessory={instanceSwitcher}
                        menu={sidebarMenuContributions(nav, masks)}
                        onAppSelect={(id) =>
                            void navigate({ params: { appId: id }, to: "/apps/$appId" })
                        }
                        onBack={() => props.onChatSelect(undefined, "chat")}
                        onManage={() => void navigate({ to: "/apps" })}
                    />
                )}
            </StoreSurface>
        );
    }
}

/** Renders the sidebar-menu contribution triggers shown in the Apps sidebar footer. */
function sidebarMenuContributions(nav: PluginNavigationSurface, masks: PluginAssetMasks) {
    const contributions =
        nav.contributions.type === "ready"
            ? nav.contributions.value.filter((item) => item.location === "sidebarMenu")
            : [];
    if (contributions.length === 0) return undefined;
    return contributions.map((contribution) => (
        <PluginMenuContribution
            contribution={contribution}
            key={contribution.id}
            masks={masks}
            surface={nav}
        />
    ));
}
