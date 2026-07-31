import type { CSSProperties } from "react";
import type { RigInboxItem, RigInboxItemId, RigInboxSubmission, UserError } from "happy2-state";
import { AvatarBrutalist } from "../../AvatarBrutalist";
import { Banner } from "../../Banner";
import { Button } from "../../Button";
import { EmptyState } from "../../EmptyState";
import { RigUserInputPrompt, type RigUserInputAnswerMap } from "../../RigUserInputPrompt";
import { Toolbar } from "../../Toolbar";

export interface RigInboxPageProps {
    /** Questions still waiting on an answer, oldest first. */
    pending: readonly RigInboxItem[];
    /** Questions already answered, most recently resolved first. */
    answered: readonly RigInboxItem[];
    /** True before the first feed arrives, so an empty queue is not claimed early. */
    loading?: boolean;
    /** The question feed itself failed; retained items stay readable beneath it. */
    error?: UserError;
    /** In-flight and failed answer submissions, by item. */
    submissions?: ReadonlyMap<RigInboxItemId, RigInboxSubmission>;
    onAnswer: (itemId: RigInboxItemId, answers: RigInboxAnswerMap) => void;
    /** Opens the session that asked, for the context a question does not carry. */
    onOpenSession?: (item: RigInboxItem) => void;
    /** Names the project or worktree an item belongs to. */
    itemLocation?: (item: RigInboxItem) => string | undefined;
    /** Renders an item's age the way the rest of the surface renders time. */
    itemTime?: (item: RigInboxItem) => string | undefined;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

export type RigInboxAnswerMap = RigUserInputAnswerMap;

/**
 * RigInboxPage — the queue of questions a Rig's agents are waiting on, answered
 * in place. Pending questions come first in the order they were asked, so
 * working top to bottom unblocks the agent that has waited longest; answered
 * questions stay below as a record of what was decided.
 *
 * It renders exactly what it is handed and reports each answer upward. It holds
 * no queue of its own, so an answered question leaves only when the owner says
 * the Rig resolved it.
 */
export function RigInboxPage(props: RigInboxPageProps) {
    const submissions = props.submissions;
    const pendingCount = props.pending.length;

    return (
        <div
            className={["happy2-rig-inbox", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-inbox"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div className="happy2-rig-inbox__header" data-happy2-ui="rig-inbox-header">
                <Toolbar
                    subtitle={inboxSubtitle(pendingCount, props.answered.length, props.loading)}
                    title="Inbox"
                />
            </div>
            <div className="happy2-rig-inbox__scroll" data-happy2-ui="rig-inbox-scroll">
                <div className="happy2-rig-inbox__content">
                    {props.error ? (
                        <Banner tone="danger" title="Questions may be out of date">
                            {props.error.message}
                        </Banner>
                    ) : null}

                    {pendingCount === 0 && props.answered.length === 0 ? (
                        <EmptyState
                            description={
                                props.loading
                                    ? "Reading what this Rig's agents are waiting on."
                                    : "When an agent needs a decision, it waits for you here."
                            }
                            icon={props.loading ? "clock" : "check-circle"}
                            title={props.loading ? "Loading inbox…" : "Nothing to decide"}
                        />
                    ) : null}

                    {props.pending.map((item) => (
                        <InboxPendingItem
                            item={item}
                            key={item.id}
                            location={props.itemLocation?.(item)}
                            onAnswer={props.onAnswer}
                            {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
                            submission={submissions?.get(item.id)}
                            time={props.itemTime?.(item)}
                        />
                    ))}

                    {pendingCount === 0 && props.answered.length > 0 ? (
                        <EmptyState
                            description="Everything this Rig asked has an answer."
                            icon="check-circle"
                            title="All caught up"
                        />
                    ) : null}

                    {props.answered.length > 0 ? (
                        <>
                            <h2
                                className="happy2-rig-inbox__section"
                                data-happy2-ui="rig-inbox-section"
                            >
                                Answered
                            </h2>
                            {props.answered.map((item) => (
                                <InboxAnsweredItem
                                    item={item}
                                    key={item.id}
                                    location={props.itemLocation?.(item)}
                                    {...(props.onOpenSession
                                        ? { onOpenSession: props.onOpenSession }
                                        : {})}
                                    time={props.itemTime?.(item)}
                                />
                            ))}
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function inboxSubtitle(pending: number, answered: number, loading?: boolean): string {
    if (loading) return "Loading…";
    if (pending === 0) return answered === 0 ? "No questions" : `All ${answered} answered`;
    return `${pending} waiting${answered > 0 ? ` · ${answered} answered` : ""}`;
}

interface InboxItemHeaderProps {
    item: RigInboxItem;
    location?: string;
    onOpenSession?: (item: RigInboxItem) => void;
    time?: string;
}

function InboxItemHeader(props: InboxItemHeaderProps) {
    const title = props.item.sessionTitle ?? "Untitled session";
    return (
        <div className="happy2-rig-inbox__item-header" data-happy2-ui="rig-inbox-item-header">
            <span className="happy2-rig-inbox__item-identity">
                {/* The asking session's own mark, the same one its tab wears, so
                    a question read here and the session it came from are the
                    same thing at a glance rather than two titles to match up. */}
                <AvatarBrutalist
                    aria-label={title}
                    className="happy2-rig-inbox__item-avatar"
                    id={props.item.sessionId}
                    size={20}
                />
                <span className="happy2-rig-inbox__item-title">{title}</span>
                {props.location ? (
                    <span className="happy2-rig-inbox__item-location">{props.location}</span>
                ) : null}
            </span>
            <span className="happy2-rig-inbox__item-meta">
                {props.time ? (
                    <span className="happy2-rig-inbox__item-time">{props.time}</span>
                ) : null}
                {props.onOpenSession ? (
                    <Button
                        data-action="open-session"
                        onClick={() => props.onOpenSession?.(props.item)}
                        size="small"
                        variant="ghost"
                    >
                        Open session
                    </Button>
                ) : null}
            </span>
        </div>
    );
}

interface InboxPendingItemProps extends InboxItemHeaderProps {
    onAnswer: (itemId: RigInboxItemId, answers: RigInboxAnswerMap) => void;
    submission?: RigInboxSubmission;
}

function InboxPendingItem(props: InboxPendingItemProps) {
    const submission = props.submission;
    return (
        <article
            className="happy2-rig-inbox__item"
            data-happy2-ui="rig-inbox-item"
            data-item-id={props.item.id}
            data-status="pending"
        >
            <InboxItemHeader
                item={props.item}
                {...(props.location === undefined ? {} : { location: props.location })}
                {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
                {...(props.time === undefined ? {} : { time: props.time })}
            />
            <RigUserInputPrompt
                {...(submission?.type === "failed" ? { error: submission.error } : {})}
                onAnswer={(_requestId, answers) => props.onAnswer(props.item.id, answers)}
                pending={submission?.type === "pending"}
                request={{
                    requestId: props.item.requestId,
                    questions: props.item.questions,
                }}
            />
        </article>
    );
}

function InboxAnsweredItem(props: InboxItemHeaderProps) {
    return (
        <article
            className="happy2-rig-inbox__item"
            data-happy2-ui="rig-inbox-item"
            data-item-id={props.item.id}
            data-status="answered"
        >
            <InboxItemHeader
                item={props.item}
                {...(props.location === undefined ? {} : { location: props.location })}
                {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
                {...(props.time === undefined ? {} : { time: props.time })}
            />
            <dl className="happy2-rig-inbox__answers" data-happy2-ui="rig-inbox-answers">
                {props.item.questions.map((question) => {
                    const chosen = props.item.answers?.[question.id] ?? [];
                    return (
                        <div className="happy2-rig-inbox__answer" key={question.id}>
                            <dt className="happy2-rig-inbox__answer-question">
                                {question.question}
                            </dt>
                            <dd className="happy2-rig-inbox__answer-value">
                                {chosen.length > 0 ? (
                                    chosen.join(", ")
                                ) : (
                                    <span className="happy2-rig-inbox__answer-empty">
                                        No answer recorded
                                    </span>
                                )}
                            </dd>
                        </div>
                    );
                })}
            </dl>
        </article>
    );
}
