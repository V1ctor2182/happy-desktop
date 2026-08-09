import type { ChatElement, InboxItem, RigConnection, SessionState } from "@slopus/rig-connect";
import type {
    RigAnsweredUserInput,
    RigChatTranscriptConnect,
    RigSessionId,
} from "happy-desktop-state";

function attachmentUrlsResolve(
    elements: readonly ChatElement[],
    rigHttpUrl: string,
): readonly ChatElement[] {
    const bridge = `${rigHttpUrl.replace(/\/$/u, "")}/rig-connect`;
    const bridgeUrl = (value: string): string =>
        value.startsWith("http://") || value.startsWith("https://")
            ? value
            : `${bridge}${value.startsWith("/") ? "" : "/"}${value}`;
    return elements.map((element) => {
        if (element.kind !== "agent_attachments") return element;
        return {
            ...element,
            attachments: element.attachments.map((attachment) => {
                if (attachment.kind === "applet")
                    return { ...attachment, image: bridgeUrl(attachment.image) };
                if (!("downloadUrl" in attachment) || !attachment.downloadUrl) return attachment;
                return { ...attachment, downloadUrl: bridgeUrl(attachment.downloadUrl) };
            }),
        };
    });
}

function answeredUserInputsProject(
    items: readonly InboxItem[],
    sessionId: RigSessionId,
): readonly RigAnsweredUserInput[] {
    const answered: RigAnsweredUserInput[] = [];
    for (const item of items) {
        if (
            item.sessionId !== sessionId ||
            item.status !== "answered" ||
            item.answers === undefined ||
            item.resolvedAt === undefined
        )
            continue;
        answered.push({
            requestId: item.requestId,
            questions: item.questions.map((question) => ({
                id: question.id,
                header: question.header,
                question: question.question,
                multiSelect: question.multiSelect,
                required: question.required ?? false,
                options: question.options.map((option) => ({
                    label: option.label,
                    description: option.description,
                })),
            })),
            answers: item.answers,
            createdAt: item.createdAt,
            resolvedAt: item.resolvedAt,
        });
    }
    return answered;
}

/**
 * Opens rig-connect through Happy's capability-scoped read bridge.
 *
 * Events from a pre-snapshot daemon are ignored: without the opening hello they
 * describe only retained activity, not an authoritative transcript. Happy's
 * existing chat reader remains visible until a complete rig-connect snapshot
 * arrives.
 */
export function rigConnectTranscriptConnectCreate(
    rig: RigConnection,
    rigHttpUrl: string,
): RigChatTranscriptConnect {
    return (options) => {
        let accepted = false;
        let inboxReady = false;
        let elements: readonly ChatElement[] | undefined;
        let session: SessionState | undefined;
        let answeredUserInputs: readonly RigAnsweredUserInput[] = [];
        const emit = (): void => {
            if (!accepted || !inboxReady || elements === undefined || session === undefined) return;
            options.onChange(elements, session, answeredUserInputs);
        };
        const sessionConnection = rig.connectSession({
            sessionId: options.sessionId,
            onChange: (nextElements, nextSession) => {
                if (nextSession.connection === "live") accepted = true;
                elements = attachmentUrlsResolve(nextElements, rigHttpUrl);
                session = nextSession;
                emit();
            },
            onError: options.onError,
        });
        const inboxConnection = rig.connectInbox({
            onChange: (items) => {
                answeredUserInputs = answeredUserInputsProject(items, options.sessionId);
                inboxReady = true;
                emit();
            },
            // Answer history enriches an already-authoritative live transcript.
            // Losing that secondary feed must not close the healthy session
            // connector and fall back to the legacy transcript path.
            onError: () => {
                // Answer history enriches the session but must never prevent
                // the conversation itself from opening when that feed fails.
                inboxReady = true;
                emit();
            },
        });
        return {
            close: () => {
                sessionConnection.close();
                inboxConnection.close();
            },
            loadMore: (token) => sessionConnection.loadMore(token),
        };
    };
}
