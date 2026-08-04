import type { ComposerAttachment } from "../modules/composer/composerState.js";
import type { RigImageInput } from "./rigTypes.js";

/** Bytes per base64 chunk; keeps the argument list of one `fromCharCode` sane. */
const CHUNK = 0x8000;

/**
 * How large an image may be before it stops travelling inside the turn. Inline
 * bytes are base64 in a JSON body every hop holds in memory at once, and a
 * screenshot is comfortably under this; anything larger is better served as a
 * file the agent opens when it wants it.
 */
const INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function base64Encode(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += CHUNK)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
    return btoa(binary);
}

/**
 * Reads one picked, dropped, or pasted file into a draft attachment. A local
 * session has no upload step, so the bytes are carried by the draft itself: an
 * image small enough to inline travels with the turn, and everything else — a
 * PDF, an archive, a screenshot too large to inline — becomes a copy the send
 * writes into the session's working directory and names by path. `id` is minted
 * by the caller so a retry of one attach keeps the identity the chip row already
 * shows.
 */
export async function rigComposerAttachmentRead(
    id: string,
    file: File,
): Promise<ComposerAttachment> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const data = base64Encode(bytes);
    if (file.type.startsWith("image/") && bytes.byteLength <= INLINE_IMAGE_MAX_BYTES)
        return {
            kind: "inlineImage",
            id,
            name: file.name || "image",
            size: file.size,
            mediaType: file.type,
            data,
        };
    return {
        kind: "workspaceFile",
        id,
        name: file.name || "attachment",
        size: file.size,
        data,
    };
}

/**
 * Names the copies a turn placed in the working directory, so the agent learns
 * about a file it was never shown. The paths are appended rather than woven into
 * what was typed: the sentence someone wrote is theirs, and a bare list under it
 * reads the same whether they wrote "look at this" or nothing at all.
 */
export function rigAttachmentTextAppend(text: string, paths: readonly string[]): string {
    if (paths.length === 0) return text;
    const lines = paths.map((path) => `- ./${path}`).join("\n");
    const heading = paths.length === 1 ? "Attached file:" : "Attached files:";
    return text.trim().length === 0 ? `${heading}\n${lines}` : `${text}\n\n${heading}\n${lines}`;
}

/** The inline images of a draft, in draft order, as the send path carries them. */
export function rigImageInputsOf(
    attachments: readonly ComposerAttachment[],
): readonly RigImageInput[] {
    return attachments
        .filter((attachment) => attachment.kind === "inlineImage")
        .map((attachment) => ({ mediaType: attachment.mediaType, data: attachment.data }));
}
