import type { CSSProperties } from "react";
import type {
    RigInboxItem,
    RigInboxItemId,
    RigInboxSubmission,
    UserError,
} from "happy-desktop-state";
import { AvatarBrutalist } from "../../AvatarBrutalist";
import { Banner } from "../../Banner";
import { Button } from "../../Button";
import { EmptyState } from "../../EmptyState";
import { Icon } from "../../Icon";
import { SURFACE_HEADER_HEIGHT } from "../../InfoPanel";
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
 * A waiting question is one block: the session that asked heads it and the
 * question it asked fills it, because the two are the same fact and reading
 * them as separate objects is what made this screen hard to scan. An answered
 * one keeps no container at all — it is a record, not work, so it is a line
 * with what was decided under it and a rule between it and the next.
 *
 * Colour is spent only where it distinguishes: green on a settled question,
 * and the ordinary danger tone when a send failed. Nothing else is coloured.
 *
 * It renders exactly what it is handed and reports each answer upward. It holds
 * no queue of its own, so an answered question leaves only when the owner says
 * the Rig resolved it.
 */
export function RigInboxPage(props: RigInboxPageProps) {
    const submissions = props.submissions;
    const pendingCount = props.pending.length;
    const answeredCount = props.answered.length;

    return (
        <div
            className={["happy2-rig-inbox", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="rig-inbox"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div className="happy2-rig-inbox__header" data-happy-desktop-ui="rig-inbox-header">
                <Toolbar
                    height={SURFACE_HEADER_HEIGHT}
                    subtitle={inboxSubtitle(pendingCount, answeredCount, props.loading)}
                    title="Inbox"
                />
            </div>
            <div className="happy2-rig-inbox__scroll" data-happy-desktop-ui="rig-inbox-scroll">
                <div className="happy2-rig-inbox__content">
                    {props.error ? (
                        <Banner tone="danger" title="Questions may be out of date">
                            {props.error.message}
                        </Banner>
                    ) : null}

                    {pendingCount === 0 && answeredCount === 0 ? (
                        <EmptyState
                            // Sparkles belong to the settled reading only. While
                            // the inbox is still being read nothing is known yet,
                            // and celebrating an emptiness that may not be there
                            // would be a lie told in gold; the snail says the
                            // honest thing instead, which is "still reading".
                            animation={props.loading ? "snail" : "sparkles"}
                            description={
                                props.loading
                                    ? "Reading what this Rig's agents are waiting on."
                                    : "When an agent needs a decision, it waits for you here."
                            }
                            icon={props.loading ? "clock" : "check-circle"}
                            title={props.loading ? "Loading inbox…" : "Nothing to decide"}
                        />
                    ) : null}

                    {pendingCount > 0 ? (
                        <SectionLabel
                            count={pendingCount}
                            label="Waiting"
                            testid="rig-inbox-section-waiting"
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

                    {/* Caught up is a state of the queue, not of the screen: the
                        record below still has to be reachable and is read down
                        the same left edge, so this is one line in that column
                        rather than a centred medallion claiming the panel. */}
                    {pendingCount === 0 && answeredCount > 0 ? (
                        <p
                            className="happy2-rig-inbox__caught-up"
                            data-happy-desktop-ui="rig-inbox-caught-up"
                        >
                            <span aria-hidden="true" className="happy2-rig-inbox__caught-up-mark">
                                <Icon name="check-circle" size={16} />
                            </span>
                            <strong className="happy2-rig-inbox__caught-up-title">
                                All caught up
                            </strong>
                            <span className="happy2-rig-inbox__caught-up-detail">
                                Everything this Rig asked has an answer.
                            </span>
                        </p>
                    ) : null}

                    {answeredCount > 0 ? (
                        <SectionLabel
                            count={answeredCount}
                            label="Answered"
                            testid="rig-inbox-section"
                        />
                    ) : null}

                    {answeredCount > 0 ? (
                        <div
                            className="happy2-rig-inbox__records"
                            data-happy-desktop-ui="rig-inbox-records"
                        >
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
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

/**
 * The name of a run of items and how many are in it. The count belongs beside
 * the name rather than only in the header, because the two groups are read at
 * different points in a long queue.
 */
function SectionLabel(props: { count: number; label: string; testid: string }) {
    return (
        <h2 className="happy2-rig-inbox__section" data-happy-desktop-ui={props.testid}>
            <span className="happy2-rig-inbox__section-label">{props.label}</span>
            <span className="happy2-rig-inbox__section-count">{props.count}</span>
        </h2>
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

/**
 * Who asked, where from, when, and the way back to the conversation. The mark
 * and the title lead because the session is what a question has to be matched
 * to; the time and the way out close the line.
 */
function InboxItemHeader(props: InboxItemHeaderProps & { status?: string }) {
    const title = props.item.sessionTitle ?? "Untitled session";
    return (
        <div
            className="happy2-rig-inbox__item-header"
            data-happy-desktop-ui="rig-inbox-item-header"
        >
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
                {/* Spoken as well as shown: the answer leaves on its own after
                    the form is submitted, so someone who is not watching this
                    line still hears that the send is under way. */}
                {props.status ? (
                    <span
                        className="happy2-rig-inbox__item-status"
                        data-happy-desktop-ui="rig-inbox-item-status"
                        role="status"
                    >
                        {props.status}
                    </span>
                ) : null}
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
            data-happy-desktop-ui="rig-inbox-item"
            data-item-id={props.item.id}
            data-status="pending"
        >
            <InboxItemHeader
                item={props.item}
                {...(props.location === undefined ? {} : { location: props.location })}
                {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
                {...(submission?.type === "pending" ? { status: "Sending…" } : {})}
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
                variant="flat"
            />
        </article>
    );
}

/**
 * A settled question. There is nothing to do with it, so it is drawn as a
 * record rather than as a form: the question in secondary type with what was
 * decided under it, and a check that says the decision was made without
 * repeating the word on every row.
 */
function InboxAnsweredItem(props: InboxItemHeaderProps) {
    return (
        <article
            className="happy2-rig-inbox__item"
            data-happy-desktop-ui="rig-inbox-item"
            data-item-id={props.item.id}
            data-status="answered"
        >
            <InboxItemHeader
                item={props.item}
                {...(props.location === undefined ? {} : { location: props.location })}
                {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
                {...(props.time === undefined ? {} : { time: props.time })}
            />
            <dl className="happy2-rig-inbox__answers" data-happy-desktop-ui="rig-inbox-answers">
                {props.item.questions.map((question) => {
                    const chosen = props.item.answers?.[question.id] ?? [];
                    return (
                        <div className="happy2-rig-inbox__answer" key={question.id}>
                            <dt className="happy2-rig-inbox__answer-question">
                                {/* The mark hangs in the column the session's
                                    own avatar occupies, so the question and the
                                    decision under it keep the title's left edge
                                    whether or not anything was recorded. */}
                                <span aria-hidden="true" className="happy2-rig-inbox__answer-mark">
                                    {chosen.length > 0 ? <Icon name="check" size={12} /> : null}
                                </span>
                                <span className="happy2-rig-inbox__answer-text">
                                    {question.question}
                                </span>
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
