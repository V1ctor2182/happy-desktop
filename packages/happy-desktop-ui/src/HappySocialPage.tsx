import { useId, type CSSProperties, type ReactNode } from "react";
import { Avatar } from "./Avatar";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { SURFACE_HEADER_HEIGHT } from "./InfoPanel";
import { ScrollArea } from "./Scrollbar";
import { TextField } from "./TextField";
import { Toolbar } from "./Toolbar";

export interface HappySocialPerson {
    readonly firstName: string;
    readonly lastName?: string;
    readonly username: string;
}

export type HappySocialOperation =
    | { readonly kind: "send"; readonly username: string }
    | { readonly kind: "accept"; readonly username: string }
    | { readonly kind: "reject"; readonly username: string };

export interface HappySocialPageProps {
    readonly status: "loading" | "unenrolled" | "ready" | "error";
    readonly friendUsername: string;
    readonly friends: readonly HappySocialPerson[];
    readonly incomingRequests: readonly HappySocialPerson[];
    readonly outgoingRequests: readonly HappySocialPerson[];
    readonly operation?: HappySocialOperation;
    readonly error?: string;
    readonly unavailable?: string;
    onFriendUsernameChange(value: string): void;
    onFriendRequestSend(): void;
    onFriendRequestAccept(username: string): void;
    onFriendRequestReject(username: string): void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/** A prop-driven Happy Social friends and requests surface. */
export function HappySocialPage(props: HappySocialPageProps) {
    const usernameId = `happy-social-friend-${useId()}`;
    const requestCount = props.incomingRequests.length + props.outgoingRequests.length;
    const ready = props.status === "ready";
    const loading = props.status === "loading";
    return (
        <div
            className={["happy-social-page", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="happy-social-page"
            data-loading={loading ? "" : undefined}
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div
                aria-hidden={loading ? undefined : "true"}
                className="happy-social-page__loading"
                data-happy-desktop-ui="social-loading"
            >
                <EmptyState
                    animation="snail"
                    description="Reading your friends and requests from Happy Social."
                    icon="users"
                    title="Loading social…"
                />
            </div>
            <div
                aria-hidden={loading ? "true" : undefined}
                className="happy-social-page__resolved"
                data-happy-desktop-ui="social-resolved"
                {...(loading ? { inert: true } : {})}
            >
                <div className="happy-social-page__header" data-happy-desktop-ui="social-header">
                    <Toolbar
                        height={SURFACE_HEADER_HEIGHT}
                        subtitle={socialSubtitle(props.status, props.friends.length, requestCount)}
                        title="Social"
                    />
                </div>
                <ScrollArea
                    className="happy-social-page__scroll"
                    data-happy-desktop-ui="social-scroll"
                    viewportClassName="happy-social-page__scroll-viewport"
                >
                    <div className="happy-social-page__content">
                        {props.error ? (
                            <Banner tone="danger" title="Happy Social could not update">
                                {props.error}
                            </Banner>
                        ) : null}
                        {props.unavailable ? (
                            <Banner tone="neutral" title="Happy Agent reconnecting">
                                {props.unavailable}
                            </Banner>
                        ) : null}

                        {props.status === "unenrolled" ? (
                            <EmptyState
                                description="Choose a Happy Social username in Profile settings to connect with friends."
                                icon="users"
                                title="Finish setting up Happy Social"
                            />
                        ) : props.status === "error" ? (
                            <EmptyState
                                description="This Happy Agent did not make its Social friends service available."
                                icon="users"
                                title="Social unavailable"
                            />
                        ) : null}

                        {ready ? (
                            <form
                                className="happy-social-page__add"
                                data-happy-desktop-ui="social-add"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    props.onFriendRequestSend();
                                }}
                            >
                                <label className="happy-social-page__add-copy" htmlFor={usernameId}>
                                    <strong>Add a friend</strong>
                                    <span>Send a request using their Happy Social username.</span>
                                </label>
                                <div className="happy-social-page__add-controls">
                                    <TextField
                                        autoComplete="off"
                                        disabled={props.operation !== undefined}
                                        fullWidth
                                        id={usernameId}
                                        name="happy-social-friend"
                                        onValueChange={props.onFriendUsernameChange}
                                        placeholder="@username"
                                        size="medium"
                                        value={props.friendUsername}
                                    />
                                    <Button
                                        disabled={
                                            props.friendUsername.trim() === "" ||
                                            props.unavailable !== undefined
                                        }
                                        icon="users"
                                        loading={props.operation?.kind === "send"}
                                        size="medium"
                                        type="submit"
                                    >
                                        Send request
                                    </Button>
                                </div>
                            </form>
                        ) : null}

                        {ready ? (
                            <SocialSection count={requestCount} label="Requests">
                                {requestCount === 0 ? (
                                    <p className="happy-social-page__empty-line">
                                        No friend requests.
                                    </p>
                                ) : (
                                    <div className="happy-social-page__list">
                                        {props.incomingRequests.map((person) => (
                                            <SocialPersonRow
                                                key={`incoming:${person.username}`}
                                                person={person}
                                                meta="Wants to be friends"
                                                actions={
                                                    <>
                                                        <Button
                                                            disabled={
                                                                props.operation !== undefined ||
                                                                props.unavailable !== undefined
                                                            }
                                                            loading={
                                                                props.operation?.kind ===
                                                                    "accept" &&
                                                                props.operation.username ===
                                                                    person.username
                                                            }
                                                            onClick={() =>
                                                                props.onFriendRequestAccept(
                                                                    person.username,
                                                                )
                                                            }
                                                            size="small"
                                                            variant="success"
                                                        >
                                                            Accept
                                                        </Button>
                                                        <Button
                                                            disabled={
                                                                props.operation !== undefined ||
                                                                props.unavailable !== undefined
                                                            }
                                                            loading={
                                                                props.operation?.kind ===
                                                                    "reject" &&
                                                                props.operation.username ===
                                                                    person.username
                                                            }
                                                            onClick={() =>
                                                                props.onFriendRequestReject(
                                                                    person.username,
                                                                )
                                                            }
                                                            size="small"
                                                            variant="ghost"
                                                        >
                                                            Reject
                                                        </Button>
                                                    </>
                                                }
                                            />
                                        ))}
                                        {props.outgoingRequests.map((person) => (
                                            <SocialPersonRow
                                                key={`outgoing:${person.username}`}
                                                person={person}
                                                meta="Request sent"
                                                status="Pending"
                                            />
                                        ))}
                                    </div>
                                )}
                            </SocialSection>
                        ) : null}

                        {ready ? (
                            <SocialSection count={props.friends.length} label="Friends">
                                {props.friends.length === 0 ? (
                                    <p className="happy-social-page__empty-line">
                                        Friends you connect with will appear here.
                                    </p>
                                ) : (
                                    <div className="happy-social-page__list">
                                        {props.friends.map((person) => (
                                            <SocialPersonRow
                                                key={person.username}
                                                person={person}
                                            />
                                        ))}
                                    </div>
                                )}
                            </SocialSection>
                        ) : null}
                    </div>
                </ScrollArea>
            </div>
        </div>
    );
}

function SocialSection(props: {
    readonly children: ReactNode;
    readonly count: number;
    readonly label: string;
}) {
    return (
        <section className="happy-social-page__section">
            <h2 className="happy-social-page__section-title">
                <span>{props.label}</span>
                <span className="happy-social-page__section-count">{props.count}</span>
            </h2>
            {props.children}
        </section>
    );
}

function SocialPersonRow(props: {
    readonly actions?: ReactNode;
    readonly meta?: string;
    readonly person: HappySocialPerson;
    readonly status?: string;
}) {
    const name = [props.person.firstName, props.person.lastName].filter(Boolean).join(" ");
    return (
        <div className="happy-social-page__person" data-happy-desktop-ui="social-person">
            <Avatar
                aria-label={name}
                initials={personInitials(props.person)}
                size="md"
                tone="ocean"
            />
            <div className="happy-social-page__person-copy">
                <strong>{name}</strong>
                <span>
                    @{props.person.username}
                    {props.meta ? ` · ${props.meta}` : ""}
                </span>
            </div>
            {props.status ? (
                <span className="happy-social-page__person-status">{props.status}</span>
            ) : null}
            {props.actions ? (
                <div className="happy-social-page__person-actions">{props.actions}</div>
            ) : null}
        </div>
    );
}

function personInitials(person: HappySocialPerson): string {
    return `${person.firstName[0] ?? ""}${person.lastName?.[0] ?? ""}`.toUpperCase();
}

function socialSubtitle(status: HappySocialPageProps["status"], friends: number, requests: number) {
    if (status === "loading") return "Loading friends and requests";
    if (status === "unenrolled") return "Profile setup required";
    if (status === "error") return "Friends unavailable";
    return `${friends} ${friends === 1 ? "friend" : "friends"} · ${requests} ${requests === 1 ? "request" : "requests"}`;
}
