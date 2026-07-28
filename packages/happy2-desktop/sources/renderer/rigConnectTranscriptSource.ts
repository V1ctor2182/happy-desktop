import type { RigConnection } from "@slopus/rig-connect";
import type { RigChatTranscriptConnect } from "happy2-state";

/**
 * Opens rig-connect through Happy's capability-scoped read bridge.
 *
 * Events from a pre-snapshot daemon are ignored: without the opening hello they
 * describe only retained activity, not an authoritative transcript. Happy's
 * existing chat reader remains visible until a complete rig-connect snapshot
 * arrives.
 */
export function rigConnectTranscriptConnectCreate(rig: RigConnection): RigChatTranscriptConnect {
    return (options) => {
        let accepted = false;
        const connection = rig.connectSession({
            sessionId: options.sessionId,
            onChange: (elements, session) => {
                if (session.connection === "live") accepted = true;
                if (accepted) options.onChange(elements, session);
            },
            onError: options.onError,
        });
        return {
            close: () => connection.close(),
            loadMore: (token) => connection.loadMore(token),
        };
    };
}
