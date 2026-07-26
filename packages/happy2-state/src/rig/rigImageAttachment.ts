import type { ComposerAttachment } from "../modules/composer/composerState.js";
import type { RigImageInput } from "./rigTypes.js";

/** Bytes per base64 chunk; keeps the argument list of one `fromCharCode` sane. */
const CHUNK = 0x8000;

function base64Encode(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += CHUNK)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
    return btoa(binary);
}

/**
 * Reads one picked or pasted image into a draft attachment. A local session has
 * no upload step, so the bytes are carried by the draft itself and travel with
 * the message; a non-image file resolves to nothing, since a local turn can only
 * carry images inline. `id` is minted by the caller so a retry of one attach
 * keeps the identity the chip row already shows.
 */
export async function rigImageAttachmentRead(
    id: string,
    file: File,
): Promise<ComposerAttachment | undefined> {
    if (!file.type.startsWith("image/")) return undefined;
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
        kind: "inlineImage",
        id,
        name: file.name || "image",
        size: file.size,
        mediaType: file.type,
        data: base64Encode(bytes),
    };
}

/** The inline images of a draft, in draft order, as the send path carries them. */
export function rigImageInputsOf(
    attachments: readonly ComposerAttachment[],
): readonly RigImageInput[] {
    return attachments
        .filter((attachment) => attachment.kind === "inlineImage")
        .map((attachment) => ({ mediaType: attachment.mediaType, data: attachment.data }));
}
