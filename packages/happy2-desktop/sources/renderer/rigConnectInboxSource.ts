import type { InboxItem, RigConnection } from "@slopus/rig-connect";
import type { RigInboxSource, RigInboxSourceItem } from "happy2-state";

export interface RigConnectInboxSource extends RigInboxSource {
    close(): void;
}

/**
 * Adapts `rig-connect`'s cross-session question feed to the inbox store's source
 * contract. One daemon stream carries every session's outstanding questions, so
 * the inbox never materializes a chat per asking session just to learn that it
 * asked something.
 *
 * The stream is opened once, when the connection is, rather than when something
 * first watches it. `connectInbox` starts an empty store and is only ever filled
 * by the catalog handshake, which happens once per connection: a subscriber that
 * arrives after the catalog has loaded would otherwise wait for a reconnect to
 * learn what is already waiting. Opening it here costs nothing — the inbox is a
 * view over the connection's single live stream, not a stream of its own — and
 * makes the first snapshot independent of when a surface happens to look.
 */
export function rigConnectInboxSourceCreate(rig: RigConnection): RigConnectInboxSource {
    const listeners = new Set<(items: readonly RigInboxSourceItem[]) => void>();
    const errorListeners = new Set<(error: unknown) => void>();
    let latest: readonly RigInboxSourceItem[] | undefined;
    let closed = false;

    const connection = rig.connectInbox({
        onChange: (items) => {
            if (closed) return;
            latest = items.map(itemProject);
            for (const listener of listeners) listener(latest);
        },
        onError: (error) => {
            if (closed) return;
            for (const listener of errorListeners) listener(error);
        },
    });

    return {
        subscribe(listener, onError) {
            if (closed) return () => undefined;
            listeners.add(listener);
            errorListeners.add(onError);
            // What the stream has already reported is the current queue, so a
            // late subscriber starts from it instead of from an empty inbox.
            // Before the first report there is nothing to replay, and saying so
            // is not the same as saying the queue is empty.
            if (latest !== undefined) listener(latest);
            return () => {
                listeners.delete(listener);
                errorListeners.delete(onError);
            };
        },
        close() {
            if (closed) return;
            closed = true;
            listeners.clear();
            errorListeners.clear();
            connection.close();
        },
    };
}

function itemProject(item: InboxItem): RigInboxSourceItem {
    return {
        id: item.id,
        sessionId: item.sessionId,
        requestId: item.requestId,
        projectId: item.projectId,
        ...(item.workspaceId === undefined ? {} : { workspaceId: item.workspaceId }),
        ...(item.title === undefined ? {} : { sessionTitle: item.title }),
        questions: item.questions.map((question) => ({
            id: question.id,
            header: question.header,
            question: question.question,
            multiSelect: question.multiSelect,
            required: question.required ?? true,
            options: question.options.map((option) => ({
                label: option.label,
                description: option.description,
            })),
        })),
        status: item.status,
        ...(item.answers === undefined ? {} : { answers: item.answers }),
        createdAt: item.createdAt,
        ...(item.resolvedAt === undefined ? {} : { resolvedAt: item.resolvedAt }),
    };
}
