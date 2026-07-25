import { type CSSProperties } from "react";
import type { RigSessionId, RigSessionStatus, RigSessionSummary } from "happy2-state";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

export type RigSessionListPanelProps = {
    /** Session summaries in render order (state supplies newest-created first). */
    sessions: readonly RigSessionSummary[];
    selectedId?: RigSessionId;
    onSelect: (id: RigSessionId) => void;
    onCreate: () => void;
    /**
     * Reference time (epoch ms) for relative timestamps, supplied by the owner so
     * render stays pure — no clock is read here. The owner re-renders to advance it.
     */
    now: number;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

const STATUS_TONE: Record<RigSessionStatus, "active" | "error" | "idle" | "done"> = {
    idle: "idle",
    queued: "active",
    running: "active",
    completed: "done",
    aborted: "error",
    suspended: "idle",
    error: "error",
};

function relativeTime(then: number, now: number): string {
    const delta = Math.max(0, now - then);
    const seconds = Math.floor(delta / 1000);
    if (seconds < 45) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
}

function sessionTitle(session: RigSessionSummary): string {
    if (session.title && session.title.trim().length > 0) return session.title;
    if (session.recap && session.recap.trim().length > 0) return session.recap;
    return `Session ${session.id.slice(0, 8)}`;
}

/**
 * RigSessionListPanel — a flat, chronological list of Rig sessions (no directory
 * grouping): the parent supplies them already sorted newest-created first and this
 * panel renders them in that order, keyed by stable session id so rows keep their
 * identity across updates. Each row shows a status dot, title (or recap or id
 * prefix), dim cwd, and a relative timestamp; the selected row is highlighted.
 */
export function RigSessionListPanel(props: RigSessionListPanelProps) {
    const now = props.now;
    return (
        <div
            className={["happy2-rig-session-list", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-session-list"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div
                className="happy2-rig-session-list__header"
                data-happy2-ui="rig-session-list-header"
            >
                <span className="happy2-rig-session-list__title">Sessions</span>
                <Button
                    aria-label="New session"
                    data-action="create"
                    icon="plus"
                    iconOnly
                    onClick={props.onCreate}
                    size="small"
                    variant="ghost"
                />
            </div>
            {props.sessions.length === 0 ? (
                <EmptyState
                    action={{ label: "New session", icon: "plus", onClick: props.onCreate }}
                    description="Start a session to begin working with Rig."
                    icon="chat"
                    size="panel"
                    title="No sessions yet"
                />
            ) : (
                <div
                    className="happy2-rig-session-list__scroll"
                    data-happy2-ui="rig-session-list-scroll"
                >
                    <div className="happy2-rig-session-list__rows">
                        {props.sessions.map((session) => {
                            const selected = session.id === props.selectedId;
                            const timestamp = session.lastMessageAt ?? session.updatedAt;
                            return (
                                <button
                                    aria-current={selected ? "true" : undefined}
                                    className="happy2-rig-session-row"
                                    data-happy2-ui="rig-session-row"
                                    data-selected={selected ? "" : undefined}
                                    data-session-id={session.id}
                                    key={session.id}
                                    onClick={() => props.onSelect(session.id)}
                                    type="button"
                                >
                                    <span
                                        aria-hidden="true"
                                        className="happy2-rig-session-row__status"
                                        data-tone={STATUS_TONE[session.status]}
                                        data-happy2-ui="rig-session-row-status"
                                    />
                                    <span className="happy2-rig-session-row__body">
                                        <span className="happy2-rig-session-row__top">
                                            <span
                                                className="happy2-rig-session-row__title"
                                                data-happy2-ui="rig-session-row-title"
                                            >
                                                {sessionTitle(session)}
                                            </span>
                                            <span
                                                className="happy2-rig-session-row__time"
                                                data-happy2-ui="rig-session-row-time"
                                            >
                                                {relativeTime(timestamp, now)}
                                            </span>
                                        </span>
                                        <span
                                            className="happy2-rig-session-row__cwd"
                                            data-happy2-ui="rig-session-row-cwd"
                                        >
                                            {session.displayCwd || session.cwd}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
