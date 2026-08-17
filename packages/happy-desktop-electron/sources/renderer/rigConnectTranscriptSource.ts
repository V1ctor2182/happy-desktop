import type {
    ChatElement,
    InboxItem,
    RigConnection,
    RigSessionConnection,
    SessionState,
} from "@slopus/rig-connect";
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

const TRANSCRIPT_RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000] as const;

function errorStatus(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const candidate = error as { readonly status?: unknown; readonly statusCode?: unknown };
    const status = candidate.status ?? candidate.statusCode;
    return typeof status === "number" ? status : undefined;
}

/**
 * A protocol/authentication refusal cannot be repaired by reconnecting. Network
 * failures and daemon restarts can, so the live snapshot is retained while the
 * connector retries those with a capped backoff.
 */
function connectorErrorIsTerminal(error: unknown): boolean {
    const status = errorStatus(error);
    if (status !== undefined)
        return status >= 400 && status < 500 && status !== 408 && status !== 429;
    if (!(error instanceof Error)) return false;
    return /\b(?:400|401|403|404|409|422)\b|unauthori[sz]ed|forbidden|not found|unsupported|protocol/iu.test(
        error.message,
    );
}

/**
 * Opens rig-connect through Happy's capability-scoped read bridge.
 *
 * Events from a pre-snapshot daemon are ignored: without the opening hello they
 * describe only retained activity, not an authoritative transcript. Happy's
 * existing chat reader remains visible until a complete rig-connect snapshot
 * arrives. Once a snapshot has been accepted, a transient connector failure
 * never erases it: this adapter reconnects the session in place and only uses
 * the legacy reader fallback before the first accepted snapshot.
 */
export function rigConnectTranscriptConnectCreate(
    rig: RigConnection,
    rigHttpUrl: string,
): RigChatTranscriptConnect {
    return (options) => {
        let disposed = false;
        let accepted = false;
        let inboxReady = false;
        let elements: readonly ChatElement[] | undefined;
        let session: SessionState | undefined;
        let answeredUserInputs: readonly RigAnsweredUserInput[] = [];
        let sessionConnection: RigSessionConnection | undefined;
        let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
        let reconnectAttempt = 0;
        let connectionGeneration = 0;
        let sessionLive = false;
        let pendingLoadMore: string | undefined;
        const emit = (): void => {
            if (!accepted || !inboxReady || elements === undefined || session === undefined) return;
            options.onChange(elements, session, answeredUserInputs);
        };

        const pendingLoadMoreFlush = (connection: RigSessionConnection): void => {
            if (!sessionLive || pendingLoadMore === undefined) return;
            const token = pendingLoadMore;
            pendingLoadMore = undefined;
            connection.loadMore(token);
        };

        const sessionError = (generation: number, error: unknown): void => {
            if (disposed || generation !== connectionGeneration) return;
            sessionLive = false;
            const failedConnection = sessionConnection;
            sessionConnection = undefined;
            failedConnection?.close();

            if (connectorErrorIsTerminal(error)) {
                // Preserve an accepted snapshot, but let the owner decide how
                // to surface a permanent connector refusal.
                options.onError(error);
                return;
            }
            if (reconnectAttempt >= TRANSCRIPT_RECONNECT_DELAYS_MS.length) {
                options.onError(error);
                return;
            }

            const delay =
                TRANSCRIPT_RECONNECT_DELAYS_MS[
                    Math.min(reconnectAttempt, TRANSCRIPT_RECONNECT_DELAYS_MS.length - 1)
                ] ?? 5_000;
            reconnectAttempt += 1;
            reconnectTimer = setTimeout(() => {
                reconnectTimer = undefined;
                openSession();
            }, delay);
        };

        const openSession = (): void => {
            if (disposed) return;
            reconnectTimer = undefined;
            connectionGeneration += 1;
            const generation = connectionGeneration;
            sessionLive = false;
            const previousConnection = sessionConnection;
            sessionConnection = undefined;
            previousConnection?.close();
            try {
                const connection = rig.connectSession({
                    sessionId: options.sessionId,
                    onChange: (nextElements, nextSession) => {
                        if (disposed || generation !== connectionGeneration) return;
                        // Keep the last accepted transcript through reconnecting
                        // and closed markers. Only a live snapshot is authoritative.
                        if (nextSession.connection !== "live") {
                            sessionLive = false;
                            return;
                        }
                        accepted = true;
                        reconnectAttempt = 0;
                        sessionLive = true;
                        elements = attachmentUrlsResolve(nextElements, rigHttpUrl);
                        session = nextSession;
                        emit();
                        if (sessionConnection !== undefined)
                            pendingLoadMoreFlush(sessionConnection);
                    },
                    onError: (error) => sessionError(generation, error),
                });
                sessionConnection = connection;
                pendingLoadMoreFlush(connection);
            } catch (error) {
                sessionError(generation, error);
            }
        };

        openSession();
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
                inboxReady = true;
                emit();
            },
        });
        return {
            close: () => {
                disposed = true;
                connectionGeneration += 1;
                if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
                reconnectTimer = undefined;
                sessionConnection?.close();
                sessionConnection = undefined;
                inboxConnection.close();
            },
            loadMore: (token) => {
                if (sessionLive && sessionConnection !== undefined) {
                    sessionConnection.loadMore(token);
                } else {
                    pendingLoadMore = token;
                }
            },
        };
    };
}
