import type { ChatElement, RigConnection } from "@slopus/rig-connect";
import type { RigChatTranscriptConnect } from "happy-desktop-state";

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
        const connection = rig.connectSession({
            sessionId: options.sessionId,
            onChange: (elements, session) => {
                if (session.connection === "live") accepted = true;
                if (accepted)
                    options.onChange(attachmentUrlsResolve(elements, rigHttpUrl), session);
            },
            onError: options.onError,
        });
        return {
            close: () => connection.close(),
            loadMore: (token) => connection.loadMore(token),
        };
    };
}
