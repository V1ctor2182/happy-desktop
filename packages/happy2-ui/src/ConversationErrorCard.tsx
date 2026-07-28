import { type CSSProperties } from "react";
import { partitionComponentProps } from "./componentProps";
import { Octicon } from "./vectorIcons/VectorIcon";

export interface ConversationErrorCardProps {
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly reason: string;
    readonly style?: CSSProperties;
    readonly title: string;
}

/**
 * A failed turn's readable explanation, aligned to the assistant message rail.
 * The soft error bubble is the one durable failure signal in the transcript:
 * surrounding prose and the settled duration stay visually neutral.
 */
export function ConversationErrorCard(props: ConversationErrorCardProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "reason",
        "style",
        "title",
    ]);
    return (
        <div
            className={["happy2-conversation-error-card", local.className]
                .filter(Boolean)
                .join(" ")}
            data-happy2-ui="conversation-error-card"
            data-testid={local["data-testid"]}
            role="alert"
            style={local.style}
        >
            <div
                className="happy2-conversation-error-card__bubble"
                data-happy2-ui="conversation-error-bubble"
            >
                <span
                    aria-hidden="true"
                    className="happy2-conversation-error-card__icon"
                    data-happy2-ui="conversation-error-icon"
                >
                    <Octicon name="alert-fill" size={16} />
                </span>
                <span
                    className="happy2-conversation-error-card__content"
                    data-happy2-ui="conversation-error-content"
                >
                    <strong
                        className="happy2-conversation-error-card__title"
                        data-happy2-ui="conversation-error-title"
                    >
                        {local.title}
                    </strong>
                    <span
                        className="happy2-conversation-error-card__reason"
                        data-happy2-ui="conversation-error-reason"
                    >
                        {local.reason}
                    </span>
                </span>
            </div>
        </div>
    );
}
