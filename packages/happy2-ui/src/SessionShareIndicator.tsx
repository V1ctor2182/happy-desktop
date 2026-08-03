import { type CSSProperties } from "react";
import { partitionComponentProps } from "./componentProps";
import { Button } from "./Button";
import { Icon } from "./Icon";

export type SessionShareCondition = "live" | "behind" | "ended";

export interface SessionShareIndicatorProps {
    /** Which of the three conditions the share is in. */
    condition: SessionShareCondition;
    /** How many people can currently see this session. */
    watching: number;
    /** First names of the watchers, for the sentence; may be truncated by the caller. */
    names?: readonly string[];
    /** Opens the panel that lists members and offers the owner's controls. */
    onManage?: () => void;
    /** Ends the share from the indicator itself. Omitted once it has ended. */
    onStop?: () => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * The three conditions a share can be in, in the words the product says them.
 * The panel reads the same map, so one share is never described two ways on two
 * surfaces.
 */
export const SESSION_SHARE_CONDITION_LABELS: Record<SessionShareCondition, string> = {
    live: "Sharing live",
    behind: "Falling behind",
    ended: "Sharing ended",
};

/**
 * Who is watching, as a noun phrase together with the verb agreement it needs.
 * Names are what a person actually recognizes, so they lead; a count stands in
 * only when no name was handed over, and a truncated list says how many more
 * there are rather than pretending the list is everyone.
 */
function watchers(
    watching: number,
    names: readonly string[] | undefined,
): { phrase: string; plural: boolean } {
    const listed = (names ?? []).map((name) => name.trim()).filter((name) => name.length > 0);
    if (listed.length === 0)
        return watching === 1
            ? { phrase: "1 person", plural: false }
            : { phrase: `${String(watching)} people`, plural: true };
    if (listed.length === 1 && watching <= 1) return { phrase: listed[0]!, plural: false };
    const unnamed = Math.max(0, watching - listed.length);
    if (unnamed > 0)
        return {
            phrase: `${listed.join(", ")} and ${String(unnamed)} ${unnamed === 1 ? "other" : "others"}`,
            plural: true,
        };
    if (listed.length === 1) return { phrase: listed[0]!, plural: false };
    const last = listed[listed.length - 1]!;
    return { phrase: `${listed.slice(0, -1).join(", ")} and ${last}`, plural: true };
}

/** The one sentence the strip says about the people on the other end. */
function sentenceOf(
    condition: SessionShareCondition,
    watching: number,
    names: readonly string[] | undefined,
): string {
    if (condition === "ended")
        return "Nobody is being shown this session any more. What they already saw stays with them.";
    const who = watchers(watching, names);
    if (condition === "behind")
        return `${who.phrase} ${who.plural ? "are" : "is"} still catching up.`;
    return `${who.phrase} ${who.plural ? "are" : "is"} watching this session.`;
}

/**
 * C-245 SessionShareIndicator — the reminder that someone else is reading this
 * session, kept in the conversation above the transcript for as long as the
 * share exists.
 *
 * It never collapses and it cannot be dismissed: the whole point of it is that
 * the owner can never type into a shared session having forgotten it is shared.
 * `live` is therefore calm rather than absent — Happy teal, an eye, and the
 * names of the people on the other end. `behind` keeps the same shape and
 * changes only its tone and its verb, so transport pressure reads as pressure
 * and not as failure. `ended` is neutral and past tense, and offers nothing to
 * press, because stopping is irreversible and there is nothing left to manage.
 *
 * Props only: it holds no share, counts nothing itself, and reports both acts
 * upward.
 */
export function SessionShareIndicator(props: SessionShareIndicatorProps) {
    const [local, rest] = partitionComponentProps(props, [
        "condition",
        "watching",
        "names",
        "onManage",
        "onStop",
        "className",
        "data-testid",
        "style",
    ]);
    const ended = local.condition === "ended";
    return (
        <div
            {...rest}
            className={["happy2-session-share-indicator", local.className]
                .filter(Boolean)
                .join(" ")}
            data-condition={local.condition}
            data-happy2-ui="session-share-indicator"
            data-testid={local["data-testid"]}
            role="status"
            style={local.style}
        >
            <span
                aria-hidden="true"
                className="happy2-session-share-indicator__mark"
                data-happy2-ui="session-share-indicator-mark"
            >
                <Icon name="eye" size={16} />
            </span>
            <div
                className="happy2-session-share-indicator__text"
                data-happy2-ui="session-share-indicator-text"
            >
                <span
                    className="happy2-session-share-indicator__line"
                    data-happy2-ui="session-share-indicator-line"
                >
                    <span
                        className="happy2-session-share-indicator__label"
                        data-happy2-ui="session-share-indicator-label"
                    >
                        {SESSION_SHARE_CONDITION_LABELS[local.condition]}
                    </span>
                    <span
                        className="happy2-session-share-indicator__sentence"
                        data-happy2-ui="session-share-indicator-sentence"
                    >
                        {sentenceOf(local.condition, local.watching, local.names)}
                    </span>
                </span>
            </div>
            {local.onManage || (local.onStop && !ended) ? (
                <div
                    className="happy2-session-share-indicator__actions"
                    data-happy2-ui="session-share-indicator-actions"
                >
                    {local.onManage ? (
                        <Button onClick={() => local.onManage?.()} size="small" variant="secondary">
                            {ended ? "See what happened" : "Manage"}
                        </Button>
                    ) : null}
                    {/* Ending is irreversible, so it is offered only while there
                        is something to end. */}
                    {local.onStop && !ended ? (
                        <Button onClick={() => local.onStop?.()} size="small" variant="ghost">
                            Stop sharing
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
