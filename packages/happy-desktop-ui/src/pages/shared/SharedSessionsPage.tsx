import { type CSSProperties } from "react";
import { Avatar } from "../../Avatar";
import { Badge } from "../../Badge";
import { Banner } from "../../Banner";
import { EmptyState } from "../../EmptyState";
import { SURFACE_HEADER_HEIGHT } from "../../InfoPanel";
import { Toolbar } from "../../Toolbar";

export interface SharedSessionRow {
    /** Stable identity of this replica. */
    id: string;
    title: string;
    /** Who is sharing it, by the name this machine knows them under. */
    ownerName: string;
    ownerInitials: string;
    ownerPhotoUrl?: string;
    /** Whether the owner is still sharing. */
    live: boolean;
    /** Why it ended, in the surface's own words, when it has. */
    endedReason?: string;
    /** When it started or ended, in the surface's words for time. */
    time?: string;
    /** How many people the owner is showing it to. */
    watching?: number;
}

export interface SharedSessionsPageProps {
    sessions?: readonly SharedSessionRow[];
    loading?: boolean;
    error?: string;
    /** Why this machine cannot do shared sessions at all, when it cannot. */
    unavailable?: string;
    onSessionOpen?: (sessionId: string) => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/** What the header says is here, read once at the top. */
function sessionsSubtitle(
    sessions: readonly SharedSessionRow[],
    loading: boolean | undefined,
    unavailable: string | undefined,
): string {
    if (unavailable) return "Not available here";
    if (loading && sessions.length === 0) return "Loading…";
    const live = sessions.filter((session) => session.live).length;
    if (sessions.length === 0) return "Nothing yet";
    if (live === 0) return sessions.length === 1 ? "1 ended" : `${String(sessions.length)} ended`;
    return live === 1 ? "1 live" : `${String(live)} live`;
}

/** The second line of a row: who, what happened to it, when, and how many saw it. */
function rowNote(session: SharedSessionRow): string {
    const parts = [session.ownerName];
    if (!session.live && session.endedReason) parts.push(session.endedReason);
    if (session.time) parts.push(session.time);
    if (session.watching !== undefined)
        parts.push(
            session.watching === 1
                ? "Only you can see it"
                : `${String(session.watching)} people can see it`,
        );
    return parts.join(" · ");
}

/** One replica, drawn as the person showing it plus what they are showing. */
function SessionRow({ session }: { session: SharedSessionRow }) {
    return (
        <>
            <Avatar
                aria-label={session.ownerName}
                className="happy2-shared-sessions__avatar"
                {...(session.ownerPhotoUrl ? { imageUrl: session.ownerPhotoUrl } : {})}
                initials={session.ownerInitials}
                size="lg"
            />
            <span className="happy2-shared-sessions__body">
                <span className="happy2-shared-sessions__heading">
                    <span
                        className="happy2-shared-sessions__title"
                        data-happy-desktop-ui="shared-sessions-title"
                    >
                        {session.title}
                    </span>
                    <Badge
                        label={session.live ? "Live" : "Ended"}
                        variant={session.live ? "accent" : "neutral"}
                    />
                </span>
                <span
                    className="happy2-shared-sessions__note"
                    data-happy-desktop-ui="shared-sessions-note"
                >
                    {rowNote(session)}
                </span>
            </span>
        </>
    );
}

/**
 * P-018 SharedSessionsPage — the sessions other people are showing this
 * machine.
 *
 * A replica is somebody else's work, so the row leads with them: their face,
 * then what they are showing, then whether it is still running. Nothing here
 * can be started, renamed, left, or passed on — a member has exactly one act,
 * which is to open one and read it — so the surface offers exactly that and
 * nothing more.
 *
 * A session that has ended stays in the list and says why in the same breath as
 * who shared it, because the reader's question about a stopped replica is never
 * "where did it go" but "what happened to it".
 *
 * Props only: it holds no replicas and reports the one act upward.
 */
export function SharedSessionsPage(props: SharedSessionsPageProps) {
    const sessions = props.sessions ?? [];
    return (
        <div
            className={["happy2-shared-sessions", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="shared-sessions"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div
                className="happy2-shared-sessions__header"
                data-happy-desktop-ui="shared-sessions-header"
            >
                <Toolbar
                    height={SURFACE_HEADER_HEIGHT}
                    subtitle={sessionsSubtitle(sessions, props.loading, props.unavailable)}
                    title="Shared with me"
                    titleLevel={1}
                />
            </div>
            <div
                className="happy2-shared-sessions__scroll"
                data-happy-desktop-ui="shared-sessions-scroll"
            >
                <div
                    className="happy2-shared-sessions__content"
                    data-happy-desktop-ui="shared-sessions-content"
                >
                    {props.error ? (
                        <Banner icon="alert" title="This may be out of date" tone="danger">
                            {props.error}
                        </Banner>
                    ) : null}

                    {props.unavailable ? (
                        <EmptyState
                            description={props.unavailable}
                            icon="users"
                            title="Shared sessions are not here yet"
                        />
                    ) : null}

                    {!props.unavailable && props.loading && sessions.length === 0 ? (
                        <EmptyState
                            animation="snail"
                            description="Reading what other people are showing you."
                            icon="clock"
                            title="Loading shared sessions…"
                        />
                    ) : null}

                    {!props.unavailable && !props.loading && sessions.length === 0 ? (
                        <EmptyState
                            description="When a friend shares one, it appears here."
                            icon="eye"
                            title="Nobody is showing you a session yet"
                        />
                    ) : null}

                    {sessions.length > 0 ? (
                        <div
                            className="happy2-shared-sessions__list"
                            data-happy-desktop-ui="shared-sessions-list"
                        >
                            {sessions.map((session) => {
                                const row = <SessionRow session={session} />;
                                return props.onSessionOpen ? (
                                    <button
                                        className="happy2-shared-sessions__row"
                                        data-happy-desktop-ui="shared-sessions-row"
                                        data-live={session.live ? "" : undefined}
                                        key={session.id}
                                        onClick={() => props.onSessionOpen?.(session.id)}
                                        type="button"
                                    >
                                        {row}
                                    </button>
                                ) : (
                                    <div
                                        className="happy2-shared-sessions__row"
                                        data-happy-desktop-ui="shared-sessions-row"
                                        data-live={session.live ? "" : undefined}
                                        key={session.id}
                                    >
                                        {row}
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
