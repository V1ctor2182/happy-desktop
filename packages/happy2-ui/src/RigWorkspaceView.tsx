import { type CSSProperties, type ReactNode } from "react";
import { AppShell } from "./AppShell";
import { EmptyState } from "./EmptyState";
import { RigChatView, type RigChatViewProps } from "./RigChatView";
import { RigSessionListPanel, type RigSessionListPanelProps } from "./RigSessionListPanel";

export type RigWorkspaceViewProps = {
    /** Session sidebar contract (list, selection, create). */
    sessionList: RigSessionListPanelProps;
    /** The selected session's chat surface, or omitted when nothing is selected. */
    chat?: RigChatViewProps;
    /** Optional draggable desktop title bar row. */
    titleBar?: ReactNode;
    /** Enables the macOS traffic-light inset on the sidebar header. */
    windowControls?: boolean;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/**
 * RigWorkspaceView — the top-level Rig workspace: an `AppShell` with the session
 * list as its sidebar and the selected session's `RigChatView` as the main
 * surface. When no session is selected it shows a centered empty state prompting
 * a new session. Pure composition of props; the app layer subscribes to the Rig
 * stores once and threads their snapshots and callbacks through here.
 */
export function RigWorkspaceView(props: RigWorkspaceViewProps) {
    return (
        <AppShell
            className={["happy2-rig-workspace", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-workspace"
            data-testid={props["data-testid"]}
            sidebar={<RigSessionListPanel {...props.sessionList} />}
            style={props.style}
            titleBar={props.titleBar}
            windowControls={props.windowControls}
        >
            {props.chat ? (
                <RigChatView {...props.chat} />
            ) : (
                <div className="happy2-rig-workspace__empty" data-happy2-ui="rig-workspace-empty">
                    <EmptyState
                        action={{
                            label: "New session",
                            icon: "plus",
                            onClick: props.sessionList.onCreate,
                        }}
                        description="Select a session from the list or start a new one to begin."
                        icon="chat"
                        size="panel"
                        title="No session selected"
                    />
                </div>
            )}
        </AppShell>
    );
}
