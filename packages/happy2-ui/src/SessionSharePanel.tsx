import { type CSSProperties } from "react";
import { Avatar } from "./Avatar";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { partitionComponentProps } from "./componentProps";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import {
    SESSION_SHARE_CONDITION_LABELS,
    type SessionShareCondition,
} from "./SessionShareIndicator";
import { Switch } from "./Switch";
import { Toolbar } from "./Toolbar";

export interface SessionShareMemberRow {
    /** Stable identity of this membership. */
    id: string;
    /** The name the owner registered for this person. */
    name: string;
    initials: string;
    photoUrl?: string;
    /** What this person can do right now. */
    access: "watching" | "revoked" | "ended";
    /** When they were added, already in the words the surface uses for time. */
    addedTime?: string;
}

export interface SessionShareHealthSummary {
    condition: SessionShareCondition;
    /** Entries not yet delivered to members. */
    pendingEntries: number;
    /** Bytes not yet delivered, already formatted by the caller. */
    pendingSize?: string;
    /** When this reading was taken, in the surface's words for time. */
    checkedTime?: string;
}

export interface SessionSharePanelProps {
    condition: SessionShareCondition;
    members: readonly SessionShareMemberRow[];
    health?: SessionShareHealthSummary;
    /** True before the first reading of members and health arrives. */
    loading?: boolean;
    /** The panel's own feed failed; what was last read stays readable beneath. */
    error?: string;
    /** Whether friend messages reach the agent, and the control that changes it. */
    friendMessagesInContext?: boolean;
    onFriendMessagesChange?: (value: boolean) => void;
    /** Opens the picker that adds another friend. Absent when nobody is left to add. */
    onMemberAdd?: () => void;
    /** Removes one person's access from here on. */
    onMemberRevoke?: (memberId: string) => void;
    /** Ends the share for everyone, permanently. */
    onStop?: () => void;
    /**
     * Starts a new share of this session, once the previous one is over. It is
     * not a resumption — nothing about the old share comes back — so it is
     * offered only after one has ended.
     */
    onShareAgain?: () => void;
    /** True while the share is being ended. */
    stopping?: boolean;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/** What one person can do right now, said the way the product says it. */
const ACCESS_LABELS: Record<SessionShareMemberRow["access"], string> = {
    watching: "Watching",
    revoked: "No longer has access",
    ended: "Sharing ended",
};

/** What the header says is here, read once at the top. */
function membersSubtitle(
    condition: SessionShareCondition,
    members: readonly SessionShareMemberRow[],
    loading: boolean | undefined,
): string {
    if (loading && members.length === 0) return "Loading…";
    if (condition === "ended") return SESSION_SHARE_CONDITION_LABELS.ended;
    const watching = members.filter((member) => member.access === "watching").length;
    if (watching === 0) return "Nobody is watching";
    return watching === 1 ? "1 person watching" : `${String(watching)} people watching`;
}

/** How far behind delivery is, in entries and — when the caller measured it — bytes. */
function backlogLine(health: SessionShareHealthSummary): string {
    if (health.pendingEntries <= 0) return "Everything has reached them.";
    const entries =
        health.pendingEntries === 1
            ? "1 entry has not reached them yet"
            : `${String(health.pendingEntries)} entries have not reached them yet`;
    return health.pendingSize ? `${entries} · ${health.pendingSize}` : `${entries}.`;
}

/**
 * One person's row: the face, the name the owner registered for them, what they
 * can do right now, and — while the share is still running — the one act the
 * owner has over them.
 */
function MemberRow(props: {
    ended: boolean;
    member: SessionShareMemberRow;
    onRevoke?: (memberId: string) => void;
}) {
    const member = props.member;
    const revocable = !props.ended && member.access === "watching" && props.onRevoke !== undefined;
    return (
        <li
            className="happy2-session-share-panel__member"
            data-access={member.access}
            data-happy2-ui="session-share-member"
            data-member-id={member.id}
        >
            <Avatar
                aria-label={member.name}
                className="happy2-session-share-panel__member-avatar"
                {...(member.photoUrl ? { imageUrl: member.photoUrl } : {})}
                initials={member.initials}
                size="md"
            />
            <span
                className="happy2-session-share-panel__member-identity"
                data-happy2-ui="session-share-member-identity"
            >
                <span
                    className="happy2-session-share-panel__member-name"
                    data-happy2-ui="session-share-member-name"
                >
                    {member.name}
                </span>
                <span
                    className="happy2-session-share-panel__member-access"
                    data-happy2-ui="session-share-member-access"
                >
                    {ACCESS_LABELS[member.access]}
                    {member.addedTime ? ` · ${member.addedTime}` : ""}
                </span>
            </span>
            {revocable ? (
                <Button
                    aria-label={`Remove ${member.name}`}
                    onClick={() => props.onRevoke?.(member.id)}
                    size="small"
                    variant="ghost"
                >
                    Remove
                </Button>
            ) : null}
        </li>
    );
}

/**
 * C-246 SessionSharePanel — everything the owner of a share has: who is
 * watching, how far behind those people are, and the three acts only an owner
 * can perform.
 *
 * It is one surface rather than three because they are one question. Adding a
 * person, letting what they write reach the agent, and ending the share all
 * change who sees this session, and a reader deciding any of them needs the
 * other two in view. Health sits with them for the same reason: "falling
 * behind" is about the same people, and it is a delivery reading rather than a
 * failure, so it is stated in the panel instead of interrupting anything.
 *
 * Once the share has ended, every act is gone and nothing is offered that would
 * imply the ending can be walked back. What is left is a record: who was
 * watching, and that it is over.
 *
 * Props only: it holds no membership, revokes nothing itself, and reports every
 * act upward.
 */
export function SessionSharePanel(props: SessionSharePanelProps) {
    const [local, rest] = partitionComponentProps(props, [
        "condition",
        "members",
        "health",
        "loading",
        "error",
        "friendMessagesInContext",
        "onFriendMessagesChange",
        "onMemberAdd",
        "onMemberRevoke",
        "onStop",
        "onShareAgain",
        "stopping",
        "className",
        "data-testid",
        "style",
    ]);
    const ended = local.condition === "ended";
    const health = local.health;
    return (
        <section
            {...rest}
            className={["happy2-session-share-panel", local.className].filter(Boolean).join(" ")}
            data-condition={local.condition}
            data-happy2-ui="session-share-panel"
            data-testid={local["data-testid"]}
            style={local.style}
        >
            <Toolbar
                subtitle={membersSubtitle(local.condition, local.members, local.loading)}
                title="Sharing"
                titleLevel={2}
                trailing={
                    !ended && local.onMemberAdd ? (
                        <Button
                            icon="plus"
                            onClick={() => local.onMemberAdd?.()}
                            size="small"
                            variant="secondary"
                        >
                            Add someone
                        </Button>
                    ) : undefined
                }
            />

            <div
                className="happy2-session-share-panel__body"
                data-happy2-ui="session-share-panel-body"
            >
                {local.error ? (
                    <Banner icon="alert" title="This may be out of date" tone="danger">
                        {local.error}
                    </Banner>
                ) : null}

                {health ? (
                    <div
                        className="happy2-session-share-panel__health"
                        data-condition={health.condition}
                        data-happy2-ui="session-share-health"
                    >
                        <span
                            className="happy2-session-share-panel__health-line"
                            data-happy2-ui="session-share-health-line"
                        >
                            <span
                                aria-hidden="true"
                                className="happy2-session-share-panel__health-mark"
                            >
                                <Icon
                                    name={health.condition === "behind" ? "clock" : "eye"}
                                    size={14}
                                />
                            </span>
                            <span className="happy2-session-share-panel__health-label">
                                {SESSION_SHARE_CONDITION_LABELS[health.condition]}
                            </span>
                            <span className="happy2-session-share-panel__health-backlog">
                                {backlogLine(health)}
                            </span>
                        </span>
                        {health.checkedTime ? (
                            <span
                                className="happy2-session-share-panel__health-checked"
                                data-happy2-ui="session-share-health-checked"
                            >
                                Checked {health.checkedTime}
                            </span>
                        ) : null}
                    </div>
                ) : null}

                {/* What friends write is the one thing about a share that can be
                    changed without changing who is in it, so it sits above the
                    people rather than inside any one of their rows. Once the
                    share has ended it is a fact about what happened, not a
                    control. */}
                {local.friendMessagesInContext !== undefined ? (
                    ended ? (
                        <p
                            className="happy2-session-share-panel__setting-record"
                            data-happy2-ui="session-share-friend-messages"
                        >
                            {local.friendMessagesInContext
                                ? "What they wrote reached the agent."
                                : "What they wrote never reached the agent."}
                        </p>
                    ) : (
                        <Switch
                            checked={local.friendMessagesInContext}
                            className="happy2-session-share-panel__setting"
                            data-testid="session-share-friend-messages"
                            description="What they write arrives in this session as context the agent can read."
                            label="Let them write to the agent"
                            onChange={(value) => local.onFriendMessagesChange?.(value)}
                        />
                    )
                ) : null}

                {local.loading && local.members.length === 0 ? (
                    <EmptyState
                        description="Reading who can see this session."
                        icon="clock"
                        size="inline"
                        title="Loading…"
                    />
                ) : local.members.length === 0 ? (
                    <EmptyState
                        description={
                            ended
                                ? "This session was shared with nobody."
                                : "Nobody can see this session yet. Add someone to show it to them."
                        }
                        icon="users"
                        size="inline"
                        title="Nobody is watching"
                    />
                ) : (
                    <ul
                        className="happy2-session-share-panel__members"
                        data-happy2-ui="session-share-members"
                    >
                        {local.members.map((member) => (
                            <MemberRow
                                ended={ended}
                                key={member.id}
                                member={member}
                                {...(local.onMemberRevoke
                                    ? { onRevoke: local.onMemberRevoke }
                                    : {})}
                            />
                        ))}
                    </ul>
                )}

                {ended ? (
                    <div
                        className="happy2-session-share-panel__record"
                        data-happy2-ui="session-share-record"
                    >
                        <p className="happy2-session-share-panel__record-note">
                            This share is over and cannot be resumed. Everything the people above
                            already saw stays with them.
                        </p>
                        {/* A share cannot be restarted, but the session can be
                            shown again — to whoever the reader chooses now, from
                            this point on. It is a new share with nobody in it
                            yet, which is why it is offered as starting one
                            rather than as resuming anything. */}
                        {local.onShareAgain ? (
                            <Button
                                icon="plus"
                                onClick={() => local.onShareAgain?.()}
                                size="small"
                                variant="secondary"
                            >
                                Share this session again
                            </Button>
                        ) : null}
                    </div>
                ) : local.onStop ? (
                    <div
                        className="happy2-session-share-panel__stop"
                        data-happy2-ui="session-share-stop"
                    >
                        <Button
                            disabled={local.stopping}
                            icon="close"
                            onClick={() => local.onStop?.()}
                            size="small"
                            variant="danger"
                        >
                            {local.stopping ? "Ending…" : "Stop sharing"}
                        </Button>
                        <span className="happy2-session-share-panel__stop-note">
                            Ending is permanent: this share cannot be resumed.
                        </span>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
