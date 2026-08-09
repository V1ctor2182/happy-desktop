import type {
    InboxItem,
    RigConnection,
    RigInboxSubscriptionOptions,
    RigSessionSubscriptionOptions,
    SessionState,
} from "@slopus/rig-connect";
import type { RigAnsweredUserInput, RigSessionId } from "happy-desktop-state";
import { expect, it, vi } from "vitest";
import { rigConnectTranscriptConnectCreate } from "./rigConnectTranscriptSource";

const question = {
    id: "choice",
    header: "Choose",
    question: "Which direction?",
    multiSelect: false,
    required: true,
    options: [{ label: "Native", description: "Keep it quiet." }],
} as const;

function inboxItem(
    input: Partial<InboxItem> & Pick<InboxItem, "id" | "requestId" | "sessionId" | "status">,
): InboxItem {
    return {
        questions: [question],
        createdAt: 1_000,
        ...input,
    };
}

it("combines a session transcript with answered inbox items from the same session", () => {
    let sessionOptions: RigSessionSubscriptionOptions | undefined;
    let inboxOptions: RigInboxSubscriptionOptions | undefined;
    const sessionClose = vi.fn();
    const inboxClose = vi.fn();
    const loadMore = vi.fn();
    const transcriptError = vi.fn();
    const rig = {
        connectSession: (options: RigSessionSubscriptionOptions) => {
            sessionOptions = options;
            return { close: sessionClose, loadMore };
        },
        connectInbox: (options: RigInboxSubscriptionOptions) => {
            inboxOptions = options;
            return { close: inboxClose };
        },
    } as unknown as RigConnection;
    const changes: (readonly RigAnsweredUserInput[] | undefined)[] = [];
    const connection = rigConnectTranscriptConnectCreate(
        rig,
        "http://rig.test",
    )({
        sessionId: "session-1" as RigSessionId,
        onChange: (_elements, _session, answered) => changes.push(answered),
        onError: transcriptError,
    });

    sessionOptions?.onChange([], { connection: "live" } as SessionState);
    expect(changes).toEqual([]);

    inboxOptions?.onChange(
        [
            inboxItem({
                id: "answered-here",
                requestId: "ask-1",
                sessionId: "session-1",
                status: "answered",
                answers: { choice: ["Native"] },
                resolvedAt: 2_000,
            }),
            inboxItem({
                id: "pending-here",
                requestId: "ask-2",
                sessionId: "session-1",
                status: "pending",
            }),
            inboxItem({
                id: "answered-elsewhere",
                requestId: "ask-3",
                sessionId: "session-2",
                status: "answered",
                answers: { choice: ["Elsewhere"] },
                resolvedAt: 2_000,
            }),
        ],
        { connection: "live" },
    );

    expect(changes.at(-1)).toEqual([
        {
            requestId: "ask-1",
            questions: [question],
            answers: { choice: ["Native"] },
            createdAt: 1_000,
            resolvedAt: 2_000,
        },
    ]);

    inboxOptions?.onError?.(new Error("Inbox unavailable"));
    expect(transcriptError).not.toHaveBeenCalled();
    sessionOptions?.onError?.(new Error("Transcript unavailable"));
    expect(transcriptError).toHaveBeenCalledOnce();

    connection.loadMore("older");
    expect(loadMore).toHaveBeenCalledWith("older");
    connection.close();
    expect(sessionClose).toHaveBeenCalledOnce();
    expect(inboxClose).toHaveBeenCalledOnce();
});
