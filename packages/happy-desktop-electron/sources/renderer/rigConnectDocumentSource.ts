import type { Document, DocumentState, RigConnection } from "@slopus/rig-connect";
import * as Y from "yjs";
import type {
    RigDocumentActions,
    RigDocumentId,
    RigDocumentReading,
    RigDocumentSource,
} from "happy-desktop-state";

/**
 * Adapts `rig-connect`'s live document feed to the document store's source
 * contract.
 *
 * The connection re-reads the document whenever the Rig reports a new version,
 * so a change made by an agent or in another window arrives here on the same
 * stream as everything else. That is why nothing polls and nothing retries: a
 * dropped stream comes back as `reconnecting` and then `live`, and the store
 * keeps showing the state it already has throughout.
 *
 * The document's state is opaque to the Rig, which stores and returns it without
 * interpreting it. It crosses this boundary as base64 because that is what
 * survives JSON; what the bytes mean is the store's business, not the wire's.
 */
export function rigConnectDocumentSourceCreate(
    rig: RigConnection,
    documentId: RigDocumentId,
): RigDocumentSource {
    return {
        subscribe(listener, onError) {
            let closed = false;
            let connection: ReturnType<RigConnection["connectDocument"]> | undefined;
            try {
                connection = rig.connectDocument({
                    documentId,
                    onChange: (document, _updates, state) => {
                        if (closed) return;
                        listener(readingProject(document, state));
                    },
                    onError: (error) => {
                        if (closed) return;
                        onError(error);
                    },
                });
            } catch (error) {
                // The only thing `connectDocument` refuses is a connection that
                // is already closed, which is a fact rather than a hiccup.
                onError(error);
            }
            return () => {
                if (closed) return;
                closed = true;
                connection?.close();
            };
        },
    };
}

function readingProject(document: Document | undefined, state: DocumentState): RigDocumentReading {
    return {
        connection: state.connection,
        version: document?.version ?? 0,
        ...(stateEncode(document?.state) === undefined
            ? {}
            : { state: stateEncode(document?.state) }),
    };
}

/**
 * The document's opaque state as the store wants it.
 *
 * Rig hands back exactly what was written. Happy writes base64, so anything else
 * came from something that is not this editor and is deliberately not guessed
 * at: an unreadable document reports no state rather than a corrupted one.
 */
function stateEncode(state: unknown): string | undefined {
    return typeof state === "string" ? state : undefined;
}

/** One compare-version-and-write per document, as the connection performs it. */
export function rigConnectDocumentActionsCreate(rig: RigConnection): RigDocumentActions {
    return {
        documentCreate() {
            const document = new Y.Doc();
            const state = stateBase64Encode(Y.encodeStateAsUpdate(document));
            return rig.documents.create({
                mimeType: "text/markdown",
                state,
            }) as RigDocumentId;
        },
        documentWrite(documentId, expectedVersion, input) {
            rig.documents.write(documentId, expectedVersion, {
                state: input.state,
                update: input.update,
            });
        },
    };
}

function stateBase64Encode(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}
