import { type CSSProperties } from "react";
import { partitionComponentProps } from "./componentProps";
import { CopyButton } from "./CopyButton";
import { ScrollingText } from "./ScrollingText";
import { Octicon } from "./vectorIcons/VectorIcon";

export interface ConversationErrorCardProps {
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly reason: string;
    readonly style?: CSSProperties;
    readonly title: string;
    readonly tone?: "error" | "warning";
}

/**
 * A failed turn's compact explanation, aligned to the assistant activity rail.
 * It uses the same one-line rhythm as a tool call so failures remain visible
 * without interrupting the transcript with a full alert panel.
 */
export function ConversationErrorCard(props: ConversationErrorCardProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "reason",
        "style",
        "title",
        "tone",
    ]);
    const tone = local.tone ?? "error";
    return (
        <div
            className={["happy-conversation-error-card", local.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="conversation-error-card"
            data-tone={tone}
            data-testid={local["data-testid"]}
            role="alert"
            style={local.style}
        >
            <div
                className="happy-conversation-error-card__bubble"
                data-happy-desktop-ui="conversation-error-bubble"
            >
                <span
                    aria-hidden="true"
                    className="happy-conversation-error-card__icon"
                    data-happy-desktop-ui="conversation-error-icon"
                >
                    <Octicon name={tone === "warning" ? "alert" : "alert-fill"} size={14} />
                </span>
                <span
                    className="happy-conversation-error-card__content"
                    data-happy-desktop-ui="conversation-error-content"
                >
                    <strong
                        className="happy-conversation-error-card__title"
                        data-happy-desktop-ui="conversation-error-title"
                    >
                        {local.title}
                    </strong>
                    <ScrollingText
                        className="happy-conversation-error-card__reason"
                        data-happy-desktop-ui="conversation-error-reason"
                    >
                        {local.reason}
                    </ScrollingText>
                </span>
                {/* A failure is the line a reader most often needs verbatim —
                    in a bug report, a search, or a reply — so the whole reason
                    is one click away, not a careful drag-selection. */}
                <CopyButton
                    data-happy-desktop-ui="conversation-error-copy"
                    label="Copy error"
                    text={`${local.title}: ${local.reason}`}
                />
            </div>
        </div>
    );
}
