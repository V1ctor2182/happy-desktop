import { useState, type ReactNode } from "react";
import { Avatar } from "../../src/Avatar";
import { Button } from "../../src/Button";
import { Sidebar, type SidebarItem, type SidebarSection } from "../../src/Sidebar";
import { SidebarFooter } from "../../src/SidebarFooter";
import { SidebarUpdateAction, type SidebarUpdateActionProps } from "../../src/SidebarUpdateAction";
import { ComponentPage, DimensionRule, Specimen } from "../kit";
const workspaceSections: SidebarSection[] = [
    {
        id: "views",
        items: [
            { badge: 12, icon: "inbox", id: "inbox", kind: "view", label: "Inbox", unread: true },
            {
                changeStats: { added: 128, deleted: 34 },
                icon: "tasks",
                id: "my-issues",
                kind: "view",
                label: "My issues",
            },
            { icon: "spark", id: "agent-runs", kind: "view", label: "Agent runs", meta: "3" },
            { icon: "eye", id: "watching", kind: "view", label: "Watching" },
        ],
    },
    {
        action: { icon: "plus", label: "New project" },
        headingOnly: true,
        id: "projects",
        items: [],
        label: "Projects",
    },
    {
        action: { icon: "plus", label: "Add channel to Product" },
        id: "project-product",
        items: [
            { id: "launch-week", kind: "channel", label: "launch-week" },
            {
                depth: 1,
                id: "launch-week-ios",
                kind: "workspace",
                label: "ios-rollout",
                status: "working",
            },
            {
                archived: true,
                depth: 1,
                id: "launch-week-legacy",
                kind: "channel",
                label: "legacy-notes",
            },
            { badge: 4, id: "eng-core", kind: "channel", label: "eng-core", unread: true },
            { depth: 1, id: "eng-core-infra", kind: "channel", label: "infra", unread: true },
            { id: "design", kind: "channel", label: "design" },
            { archived: true, id: "support-fires", kind: "channel", label: "support-fires" },
            { icon: "lock", id: "founders", kind: "channel", label: "founders" },
            { depth: 1, icon: "lock", id: "founders-hiring", kind: "channel", label: "hiring" },
        ],
        label: "Product",
    },
    {
        action: { icon: "plus", label: "Add channel to Operations" },
        id: "project-operations",
        items: [
            {
                badge: 2,
                icon: "lock",
                id: "security",
                kind: "channel",
                label: "security",
                unread: true,
            },
        ],
        label: "Operations",
    },
    {
        id: "humans",
        items: [
            {
                id: "maya",
                initials: "MJ",
                kind: "person",
                label: "Maya Johnson",
                online: true,
                tone: "rose",
            },
            {
                id: "arun",
                initials: "AP",
                kind: "person",
                label: "Arun Patel",
                meta: "12m",
                tone: "ocean",
            },
            {
                badge: 2,
                id: "sofia",
                initials: "SR",
                kind: "person",
                label: "Sofía Reyes",
                online: true,
                tone: "amber",
                unread: true,
            },
            { id: "invite", kind: "action", label: "Invite teammates" },
        ],
        label: "Humans",
    },
    {
        action: { icon: "plus", label: "Add agent" },
        id: "agents",
        items: [
            {
                id: "claude",
                initials: "CL",
                kind: "agent",
                label: "Claude",
                status: "ready",
                tone: "ember",
            },
            {
                id: "codex",
                initials: "CX",
                kind: "agent",
                label: "Codex",
                status: "working",
                tone: "mint",
            },
            {
                id: "triage-bot",
                initials: "TB",
                kind: "agent",
                label: "Triage bot",
                status: "ready",
                tone: "violet",
            },
        ],
        label: "Agents",
    },
];
/* A tiny inline photo so the blueprint shows the image-avatar row state. */
const PHOTO =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAT0lEQVR4nGPorvk+ufrTrOp3i6perqx8srHiwY6K2wfKrzNgFT1edokBq+j5srMMWEWvlZ5kwCp6r+QIA1bRp8X7GbCKvi3ezYBV9EvRNgD7aoNVazUeBQAAAABJRU5ErkJggg==";
/*
 * A project whose worktrees are in every phase of their own life at once. Each
 * row is the same workspace row, so the specimen shows what the reader actually
 * compares: the leading slot and the trailing word change while the row's name,
 * indent, and branch stay exactly where they were.
 */
const lifecycleSections: SidebarSection[] = [
    {
        id: "lifecycle",
        items: [
            {
                action: { icon: "plus", label: "New workspace", reveal: "hover" },
                id: "lifecycle-project",
                initials: "H",
                kind: "project",
                label: "happy2",
                secondaryAction: { icon: "settings", label: "Project settings", reveal: "hover" },
                tone: "ember",
            },
            {
                action: { icon: "archive", label: "Archive", reveal: "hover" },
                depth: 1,
                id: "lifecycle-creating",
                kind: "workspace",
                label: "fix-login-redirect",
                lifecycle: "creating",
                lifecycleLabel: "creating",
            },
            {
                action: { icon: "archive", label: "Archive", reveal: "hover" },
                changeStats: { added: 42, deleted: 7 },
                depth: 1,
                id: "lifecycle-ready",
                kind: "workspace",
                label: "session-catalogue",
                status: "working",
            },
            {
                action: { icon: "archive", label: "Archive", reveal: "hover" },
                depth: 1,
                id: "lifecycle-failed",
                kind: "workspace",
                label: "port-sharing-spike",
                lifecycle: "failed",
                lifecycleLabel: "failed",
            },
            {
                action: { icon: "archive", label: "Archive", reveal: "hover" },
                depth: 1,
                id: "lifecycle-missing",
                kind: "workspace",
                label: "documents-rewrite",
                lifecycle: "unavailable",
                lifecycleLabel: "missing",
            },
            {
                action: { icon: "archive", label: "Archive", reveal: "hover" },
                depth: 1,
                id: "lifecycle-long",
                kind: "workspace",
                label: "reconcile-worktrees-from-the-catalogue-stream",
                lifecycle: "creating",
                lifecycleLabel: "creating",
            },
        ],
        label: "happy2",
    },
];

const treatmentSections: SidebarSection[] = [
    {
        id: "states",
        items: [
            { icon: "inbox", id: "active", kind: "view", label: "Active row" },
            { icon: "home", id: "resting", kind: "view", label: "Resting row" },
            { id: "unread", kind: "channel", label: "unread-channel", unread: true },
            { icon: "clock", id: "meta", kind: "view", label: "Meta trailing", meta: "4h" },
        ],
        label: "Row states",
    },
    {
        id: "kinds",
        items: [
            { icon: "files", id: "kind-view", kind: "view", label: "View — 16px icon" },
            { id: "kind-channel", kind: "channel", label: "channel — hash" },
            { icon: "lock", id: "kind-channel-lock", kind: "channel", label: "channel — lock" },
            {
                id: "kind-person",
                initials: "MJ",
                kind: "person",
                label: "Person — xs avatar",
                online: true,
                tone: "rose",
            },
            {
                id: "kind-agent",
                initials: "CX",
                kind: "agent",
                label: "Agent — working",
                status: "working",
                tone: "mint",
            },
            {
                action: { icon: "plus", label: "New workspace", reveal: "hover" },
                changeStats: { added: 309, deleted: 324 },
                id: "kind-project",
                initials: "R",
                kind: "project",
                label: "Project — working",
                secondaryAction: { icon: "settings", label: "Project settings", reveal: "hover" },
                status: "working",
                tone: "ember",
            },
            {
                action: { icon: "plus", label: "New workspace", reveal: "hover" },
                changeStats: { added: 1, deleted: 0 },
                id: "kind-project-narrow",
                initials: "N",
                kind: "project",
                label: "Project — narrowest delta under two controls",
                secondaryAction: { icon: "settings", label: "Project settings", reveal: "hover" },
                tone: "mint",
            },
            {
                action: { icon: "plus", label: "New workspace" },
                id: "kind-project-clean",
                initials: "H",
                kind: "project",
                label: "Project — two trailing controls",
                secondaryAction: { icon: "settings", label: "Project settings", reveal: "hover" },
                tone: "ocean",
            },
            {
                icon: "home",
                id: "kind-agent-glyph",
                initials: "H",
                kind: "agent",
                label: "Agent — glyph avatar",
                tone: "brand",
            },
            {
                id: "kind-person-photo",
                imageUrl: PHOTO,
                initials: "MJ",
                kind: "person",
                label: "Person — photo avatar",
                online: true,
                tone: "rose",
            },
            {
                id: "kind-agent-photo",
                imageUrl: PHOTO,
                initials: "CX",
                kind: "agent",
                label: "Agent — photo avatar",
                tone: "mint",
            },
            { id: "kind-action", kind: "action", label: "Action — muted plus" },
        ],
        label: "Row kinds",
    },
];
/* Footer composition used by the app: profile control, then the permission-gated
   Administration cog, then the appearance toggle. Administration is icon-only and
   sits directly before the theme control. */
function FooterUser() {
    return (
        <div
            style={{
                alignItems: "center",
                display: "flex",
                gap: "4px",
                width: "100%",
            }}
        >
            <div
                style={{
                    alignItems: "center",
                    display: "flex",
                    flex: "1 1 auto",
                    gap: "10px",
                    minWidth: "0",
                }}
            >
                <Avatar initials="SK" online size="sm" tone="ocean" />
                <div style={{ display: "flex", flexDirection: "column", minWidth: "0" }}>
                    <span
                        style={{
                            color: "var(--text)",
                            fontSize: "13px",
                            fontWeight: "600",
                            lineHeight: "16px",
                        }}
                    >
                        Sasha K.
                    </span>
                    <span
                        style={{
                            color: "var(--text-secondary)",
                            fontSize: "11px",
                            lineHeight: "14px",
                        }}
                    >
                        Online
                    </span>
                </div>
            </div>
            <Button
                aria-label="Administration"
                icon="settings"
                iconOnly
                size="small"
                variant="ghost"
            />
            <Button
                aria-label="Use light appearance"
                icon="moon"
                iconOnly
                size="small"
                variant="ghost"
            />
        </div>
    );
}
/* Reorder specimen. The tree is held here rather than flattened into items so a
   reported move can be applied the way a product store applies it: a top-level
   row carries its children, a nested row stays inside its own parent. */
interface ReorderNode {
    readonly children: readonly ReorderNode[];
    readonly id: string;
    readonly label: string;
}
const REORDER_TREE: readonly ReorderNode[] = [
    { children: [], id: "chan-one", label: "Chan one" },
    {
        children: [
            { children: [], id: "sub-a", label: "Sub a" },
            { children: [], id: "sub-b", label: "Sub b" },
        ],
        id: "chan-two",
        label: "Chan two",
    },
    { children: [], id: "chan-three", label: "Chan three" },
    {
        children: [
            { children: [], id: "sub-c", label: "Sub c" },
            { children: [], id: "sub-d", label: "Sub d" },
        ],
        id: "chan-four",
        label: "Chan four",
    },
    { children: [], id: "chan-five", label: "Chan five" },
];
function reorderItems(tree: readonly ReorderNode[]): SidebarItem[] {
    return tree.flatMap((node) => [
        { id: node.id, kind: "channel" as const, label: node.label },
        ...node.children.map((child) => ({
            depth: 1,
            id: child.id,
            kind: "channel" as const,
            label: child.label,
        })),
    ]);
}
function listMove<T extends { id: string }>(
    values: readonly T[],
    id: string,
    afterId: string | null,
): readonly T[] {
    const moved = values.find((value) => value.id === id);
    if (!moved) return values;
    const rest = values.filter((value) => value.id !== id);
    const at = afterId === null ? 0 : rest.findIndex((value) => value.id === afterId) + 1;
    const next = [...rest];
    next.splice(at, 0, moved);
    return next;
}
function ReorderDemo() {
    const [tree, setTree] = useState(REORDER_TREE);
    const [move, setMove] = useState<string>("— drag a row —");
    const [added, setAdded] = useState(0);
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <Frame height={420}>
                <Sidebar
                    activeItemId="chan-one"
                    onItemReorder={(sectionId, reorder) => {
                        setMove(
                            `${sectionId}: ${reorder.id} after ${reorder.afterId ?? "«front»"}${
                                reorder.parentId ? ` in ${reorder.parentId}` : ""
                            }`,
                        );
                        setTree((current) =>
                            reorder.parentId === undefined
                                ? listMove(current, reorder.id, reorder.afterId)
                                : current.map((node) =>
                                      node.id === reorder.parentId
                                          ? {
                                                ...node,
                                                children: listMove(
                                                    node.children,
                                                    reorder.id,
                                                    reorder.afterId,
                                                ),
                                            }
                                          : node,
                                  ),
                        );
                    }}
                    onItemSelect={() => {}}
                    sections={[{ id: "channels", items: reorderItems(tree), label: "Channels" }]}
                    title="Reorder"
                />
            </Frame>
            <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
                <Button
                    onClick={() => {
                        // Lands while a drag is still in flight, which is what a
                        // live workspace does when an agent opens a channel
                        // mid-gesture: the drop must survive it.
                        const at = added + 1;
                        setAdded(at);
                        window.setTimeout(
                            () =>
                                setTree((current) => [
                                    ...current,
                                    { children: [], id: `late-${at}`, label: `Late ${at}` },
                                ]),
                            1500,
                        );
                    }}
                    size="small"
                    variant="ghost"
                >
                    Add a channel in 1.5s
                </Button>
                <span
                    data-blueprint="sidebar-reorder-move"
                    style={{ color: "var(--text-secondary)", font: "var(--font-caption)" }}
                >
                    {move}
                </span>
            </div>
            <DimensionRule label="drag a row · nested rows reorder inside their parent" />
        </div>
    );
}

const PINNED_ROWS: SidebarItem[] = [
    { icon: "doc", id: "notes", kind: "action", label: "Notes" },
    { badge: 3, icon: "bell", id: "inbox", kind: "action", label: "Inbox" },
    { icon: "zap", id: "usage", kind: "action", label: "Usage" },
    { icon: "users", id: "friends", kind: "action", label: "Friends" },
    { icon: "plugin", id: "plugin-hello", kind: "action", label: "Hello World" },
];

/**
 * The pinned rows arranged by drag and by keyboard. Both report the same one
 * move, so this demo applies them through the same list operation the product
 * applies its durable order with.
 */
function PinnedReorderDemo() {
    const [rows, setRows] = useState<SidebarItem[]>(PINNED_ROWS);
    const [move, setMove] = useState<string>("— drag a row, or focus one and press ⌥↑ / ⌥↓ —");
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <Frame height={300}>
                <Sidebar
                    actions={rows}
                    activeItemId=""
                    onActionReorder={(reorder) => {
                        setMove(`${reorder.id} after ${reorder.afterId ?? "«front»"}`);
                        setRows((current) => [...listMove(current, reorder.id, reorder.afterId)]);
                    }}
                    onItemSelect={(id) => setMove(`opened ${id}`)}
                    sections={[
                        {
                            id: "projects",
                            items: [{ id: "happy2", kind: "project", label: "happy2" }],
                            label: "Projects",
                        },
                    ]}
                    title="Pinned"
                />
            </Frame>
            <span
                data-blueprint="sidebar-action-reorder-move"
                style={{ color: "var(--text-secondary)", font: "var(--font-caption)" }}
            >
                {move}
            </span>
            <DimensionRule label="pinned rows arrange above the projects · ⌥↑ / ⌥↓ moves the focused row" />
        </div>
    );
}

function Frame(props: { children: ReactNode; height: number }) {
    return (
        <div
            style={{
                border: "1px solid var(--divider)",
                display: "flex",
                height: `${props.height}px`,
                overflow: "hidden",
                width: "max-content",
            }}
        >
            {props.children}
        </div>
    );
}

/** The rows a machine's section holds, reused by each heading-action state. */
const HEADING_ACTION_ITEMS: SidebarItem[] = [
    { id: "happy2", initials: "H", kind: "project", label: "happy2" },
    { id: "rig", initials: "R", kind: "project", label: "rig" },
];

const HEADING_ACTION_STATES: readonly {
    readonly label: string;
    readonly rule: string;
    readonly section: SidebarSection;
}[] = [
    {
        label: "Resting",
        rule: "18 px control · always visible · glyph 12",
        section: {
            action: { icon: "plus", label: "Add project", reveal: "always" },
            id: "rig:local",
            items: HEADING_ACTION_ITEMS,
            label: "This Mac",
        },
    },
    {
        label: "Pending",
        rule: "spinner 12 in the 18 px control · not pressable",
        section: {
            action: { busy: true, icon: "plus", label: "Add project", reveal: "always" },
            id: "rig:local",
            items: HEADING_ACTION_ITEMS,
            label: "This Mac",
        },
    },
    {
        label: "Refused",
        rule: "error under the 24 px heading · 11/15 · pad 0 10",
        section: {
            action: { icon: "plus", label: "Add project", reveal: "always" },
            error: "“notes” is not a Git repository. Add a folder with a repository in it.",
            id: "rig:local",
            items: HEADING_ACTION_ITEMS,
            label: "This Mac",
        },
    },
    {
        label: "Hover-revealed",
        rule: "default reveal · appears on heading hover or focus",
        section: {
            action: { icon: "plus", label: "Add channel" },
            id: "hover",
            items: HEADING_ACTION_ITEMS,
            label: "Hover to reveal",
        },
    },
];

const UPDATE_STATES: readonly {
    readonly label: string;
    readonly update: SidebarUpdateActionProps;
}[] = [
    {
        label: "Available",
        update: { action: "restart", status: "available", version: "0.0.22" },
    },
    {
        label: "Downloading",
        update: {
            action: "restart",
            detail: "64% downloaded",
            status: "downloading",
            version: "0.0.22",
        },
    },
    {
        label: "Native ready",
        update: {
            action: "restart",
            onAction: () => {},
            status: "downloaded",
            version: "0.0.22",
        },
    },
    {
        label: "Web ready",
        update: {
            action: "refresh",
            onAction: () => {},
            status: "downloaded",
            version: "build 8250610",
        },
    },
];

export function SidebarPage() {
    return (
        <ComponentPage
            number="C-009"
            summary="288px workspace navigation column — header with workspace switcher, sectioned rows for views, channels, people, agents, and actions, actionable empty states, and an optional footer."
            title="Sidebar"
        >
            <Specimen
                detail="288 wide · header 52 · rows 32 on a 2px rhythm · footer 52 with top hairline"
                label="Full workspace sidebar"
                number="01"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Frame height={620}>
                        <Sidebar
                            activeItemId="inbox"
                            footer={<FooterUser />}
                            onItemSelect={() => {}}
                            onSectionAction={() => {}}
                            sections={workspaceSections}
                            subtitle="12 members · 3 agents"
                            title="Acme Studio"
                        />
                    </Frame>
                    <DimensionRule label="288 px wide · 620 px viewport" />
                </div>
            </Specimen>

            <Specimen
                detail="The footer stays quiet while an update arrives. A native package becomes Restart; a hosted renderer deploy becomes Refresh."
                label="Desktop update footer"
                number="01c"
                stage="app"
            >
                <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
                    {UPDATE_STATES.map(({ label, update }) => (
                        <div
                            key={label}
                            style={{ display: "flex", flexDirection: "column", gap: "8px" }}
                        >
                            <Frame height={180}>
                                <Sidebar
                                    activeItemId=""
                                    footer={
                                        <SidebarFooter
                                            actions={<SidebarUpdateAction {...update} />}
                                            appearance="light"
                                            onAppearanceToggle={() => {}}
                                            onSettingsOpen={() => {}}
                                        />
                                    }
                                    onItemSelect={() => {}}
                                    sections={[]}
                                    title={label}
                                />
                            </Frame>
                            <DimensionRule label={`${label} · footer 56 px`} />
                        </div>
                    ))}
                </div>
            </Specimen>

            <Specimen
                detail="Drill-down level: back button + title replace the brand; body animates in. Used for the administration sub-navigation."
                label="Back / drill-down header"
                number="01b"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Frame height={460}>
                        <Sidebar
                            activeItemId="users"
                            footer={<FooterUser />}
                            onBack={() => {}}
                            onItemSelect={() => {}}
                            sections={[
                                {
                                    id: "admin",
                                    items: [
                                        {
                                            id: "users",
                                            kind: "view",
                                            icon: "users",
                                            label: "Users",
                                        },
                                        {
                                            id: "reports",
                                            kind: "view",
                                            icon: "shield",
                                            label: "Reports",
                                        },
                                        {
                                            id: "automations",
                                            kind: "view",
                                            icon: "zap",
                                            label: "Automations",
                                        },
                                        {
                                            id: "integrations",
                                            kind: "view",
                                            icon: "link",
                                            label: "Integrations",
                                        },
                                        {
                                            id: "plugins",
                                            kind: "view",
                                            icon: "braces",
                                            label: "Plugins",
                                        },
                                        {
                                            id: "roles",
                                            kind: "view",
                                            icon: "shield",
                                            label: "Roles",
                                        },
                                    ],
                                },
                            ]}
                            title="Administration"
                        />
                    </Frame>
                    <DimensionRule label="back chevron 28px · title 15/700 · sub-nav rows" />
                </div>
            </Specimen>

            <Specimen
                detail="Active = raised + 600 · unread = 700 + dot · direct mention = numeric CountBadge · meta 11px muted"
                label="Row treatments and kinds"
                number="02"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Frame height={460}>
                        <Sidebar
                            activeItemId="active"
                            onItemAction={() => {}}
                            onItemSecondaryAction={() => {}}
                            onItemSelect={() => {}}
                            sections={treatmentSections}
                            title="Row anatomy"
                        />
                    </Frame>
                    <DimensionRule label="row 32 px · radius 6 · pad 0 10 · gap 8" />
                </div>
            </Specimen>

            <Specimen
                detail="A worktree's own phase takes the leading slot and the trailing word: a spinner while its checkout is being prepared, an alert once it could not be, an unlink once its directory has gone. A ready row is unchanged and still reports the work inside it."
                label="Workspace lifecycle rows"
                number="02a"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Frame height={300}>
                        <Sidebar
                            activeItemId="lifecycle-creating"
                            onItemAction={() => {}}
                            onItemSecondaryAction={() => {}}
                            onItemSelect={() => {}}
                            sections={lifecycleSections}
                            title="Lifecycle"
                        />
                    </Frame>
                    <DimensionRule label="leading 16 · trailing label 11px mono · row 32 px unchanged in every phase" />
                </div>
            </Specimen>

            <Specimen
                detail="A top-level row carries its nested rows; a nested row reorders among its siblings and cannot leave its parent. The drop reports one move — the row and the row it now follows — so a list that changes mid-drag cannot lose it."
                label="Reorder by dragging"
                number="02b"
                stage="app"
            >
                <ReorderDemo />
            </Specimen>

            <Specimen
                detail="The pinned rows above the projects arrange the same way, by drag or by ⌥↑ / ⌥↓ on the focused row. A move is announced to a screen reader, the badge and the row's identity travel with it, and the click the browser fires on release does not open what was dragged."
                label="Arrange the pinned rows"
                number="02c"
                stage="app"
            >
                <PinnedReorderDemo />
            </Specimen>

            <Specimen
                detail="A heading control the section exists to offer stands without hover (reveal: always), spins in place while its act runs, and refuses a second press. A refusal is said under the heading in the reader's terms, because the thing it would have added never came into being and has no row to fail on."
                label="Section heading action — resting, pending, refused"
                number="02d"
                stage="app"
            >
                <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
                    {HEADING_ACTION_STATES.map((state) => (
                        <div
                            key={state.label}
                            style={{ display: "flex", flexDirection: "column", gap: "8px" }}
                        >
                            <Frame height={200}>
                                <Sidebar
                                    activeItemId=""
                                    onItemSelect={() => {}}
                                    onSectionAction={() => {}}
                                    sections={[state.section]}
                                    title="This Mac"
                                />
                            </Frame>
                            <DimensionRule label={state.rule} />
                        </div>
                    ))}
                </div>
            </Specimen>

            <Specimen
                detail="No subtitle, no footer, unlabelled section — body starts on the 8px pad"
                label="Minimal"
                number="03"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Frame height={220}>
                        <Sidebar
                            activeItemId="second"
                            onItemSelect={() => {}}
                            sections={[
                                {
                                    id: "only",
                                    items: [
                                        {
                                            icon: "home",
                                            id: "first",
                                            kind: "view",
                                            label: "Overview",
                                        },
                                        {
                                            icon: "inbox",
                                            id: "second",
                                            kind: "view",
                                            label: "Inbox",
                                            badge: 3,
                                            unread: true,
                                        },
                                        {
                                            icon: "settings",
                                            id: "third",
                                            kind: "view",
                                            label: "Settings",
                                        },
                                    ],
                                },
                            ]}
                            title="Minimal"
                        />
                    </Frame>
                    <DimensionRule label="header 52 px · body x-pad 8 px" />
                </div>
            </Specimen>

            <Specimen
                detail="Empty sections keep their heading and expose one compact contextual action"
                label="Empty channels and direct messages"
                number="04"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Frame height={380}>
                        <Sidebar
                            activeItemId=""
                            onCompose={() => {}}
                            onItemSelect={() => {}}
                            onSectionAction={() => {}}
                            sections={[
                                {
                                    action: { icon: "plus", label: "Add channel" },
                                    empty: {
                                        actionLabel: "Create a channel",
                                        description:
                                            "Shared channels keep your team's work in one place.",
                                        icon: "hash",
                                        title: "No shared channels yet",
                                    },
                                    id: "shared",
                                    items: [],
                                    label: "Shared",
                                },
                                {
                                    action: { icon: "plus", label: "Add channel" },
                                    empty: {
                                        actionLabel: "Create a channel",
                                        description:
                                            "Private channels are visible only to members.",
                                        icon: "lock",
                                        title: "No private channels yet",
                                    },
                                    id: "private",
                                    items: [],
                                    label: "Private",
                                },
                                {
                                    action: { icon: "edit", label: "New message" },
                                    empty: {
                                        actionLabel: "Start a conversation",
                                        description: "Message a teammate to start a direct chat.",
                                        icon: "chat",
                                        title: "No direct messages",
                                    },
                                    id: "dms",
                                    items: [],
                                    label: "Humans",
                                },
                            ]}
                            title="Empty workspace"
                        />
                    </Frame>
                    <DimensionRule label="empty row 28 px · copy 11/15 · ghost action" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
