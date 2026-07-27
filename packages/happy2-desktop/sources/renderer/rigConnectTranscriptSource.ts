import { connectSession } from "@slopus/rig-connect";
import type { RigChatTranscriptConnect } from "happy2-state";

const LOCAL_PROXY_TOKEN = "happy2-local-capability";

/**
 * Opens rig-connect through Happy's capability-scoped read bridge.
 *
 * Events from a pre-snapshot daemon are ignored: without the opening hello they
 * describe only retained activity, not an authoritative transcript. Happy's
 * existing chat reader remains visible until a complete rig-connect snapshot
 * arrives.
 */
export function rigConnectTranscriptConnectCreate(baseUrl: string): RigChatTranscriptConnect {
    const endpoint = `${baseUrl.replace(/\/$/, "")}/rig-connect`;
    return (options) => {
        let accepted = false;
        const connection = connectSession({
            endpoint,
            token: LOCAL_PROXY_TOKEN,
            sessionId: options.sessionId,
            onChange: (elements, session) => {
                if (session.connection === "live") accepted = true;
                if (accepted) options.onChange(elements, session);
            },
            onError: options.onError,
        });
        return { close: () => connection.close() };
    };
}
