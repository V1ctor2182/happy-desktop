import type { ComposerAttachment } from "../modules/composer/composerState.js";
import type { RigImageInput } from "./rigTypes.js";

/**
 * Bytes per base64 chunk. Divisibility by three means each chunk can be encoded
 * independently without padding in the middle of the joined result.
 */
const CHUNK = 0x6000;

/**
 * How large an image may be before it stops travelling inside the turn. Inline
 * bytes are base64 in a JSON body every hop holds in memory at once, and a
 * screenshot is comfortably under this; anything larger is better served as a
 * file the agent opens when it wants it.
 */
const INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function base64Encode(bytes: Uint8Array): string {
    const encoded: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        const binary = String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
        encoded.push(btoa(binary));
    }
    return encoded.join("");
}

/**
 * The shared local/remote attachment ceiling. A Remote Rig carries the daemon's
 * JSON request through a 40 MiB P2P envelope; 29 MiB of source bytes expands to
 * about 38.7 MiB in base64, leaving room for JSON keys and the destination path.
 */
export const RIG_COMPOSER_FILE_MAX_BYTES = 29 * 1024 * 1024;

function mediaPreviewUrl(file: File): string | undefined {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return undefined;
    if (typeof URL.createObjectURL !== "function") return undefined;
    try {
        return URL.createObjectURL(file);
    } catch {
        return undefined;
    }
}

/**
 * Creates one picked, dropped, or pasted draft attachment without reading its
 * bytes. Selection is synchronous, so an immediate Enter cannot overtake an
 * attachment that is still being prepared. A small image is marked to travel
 * inline with the turn; everything else becomes a copy written into the
 * session's working directory when the draft is submitted.
 */
export function rigComposerAttachmentCreate(id: string, file: File): ComposerAttachment {
    const previewUrl = mediaPreviewUrl(file);
    if (file.type.startsWith("image/") && file.size <= INLINE_IMAGE_MAX_BYTES) {
        return {
            kind: "inlineImage",
            id,
            name: file.name || "image",
            size: file.size,
            mediaType: file.type,
            file,
            ...(previewUrl ? { previewUrl } : {}),
        };
    }
    return {
        kind: "workspaceFile",
        id,
        name: file.name || "attachment",
        size: file.size,
        mediaType: file.type || "application/octet-stream",
        file,
        ...(previewUrl ? { previewUrl } : {}),
    };
}

function attachmentSizeAssert(name: string, size: number): void {
    if (size > RIG_COMPOSER_FILE_MAX_BYTES)
        throw new Error(`${name} is too large to attach. Rig currently accepts files up to 29 MB.`);
}

/** Validates a whole draft before it creates a session or writes its first file. */
export function rigComposerAttachmentsValidate(attachments: readonly ComposerAttachment[]): void {
    for (const attachment of attachments)
        if (attachment.kind === "workspaceFile")
            attachmentSizeAssert(attachment.name, attachment.size);
    const inlineBytes = attachments
        .filter((attachment) => attachment.kind === "inlineImage")
        .reduce((total, attachment) => total + attachment.size, 0);
    if (inlineBytes > RIG_COMPOSER_FILE_MAX_BYTES)
        throw new Error(
            "These images are too large to attach together. Rig currently accepts up to 29 MB per message.",
        );
}

/**
 * Encodes one non-inline attachment only when a send actually needs it. The
 * explicit shared ceiling makes local and Remote Rig sends behave alike.
 */
export async function rigWorkspaceAttachmentData(
    attachment: Extract<ComposerAttachment, { kind: "workspaceFile" }>,
): Promise<string> {
    attachmentSizeAssert(attachment.name, attachment.size);
    return base64Encode(new Uint8Array(await attachment.file.arrayBuffer()));
}

/** Releases the browser resource held by one media preview, when it has one. */
export function rigComposerAttachmentPreviewRelease(attachment: ComposerAttachment): void {
    if (attachment.previewUrl && typeof URL.revokeObjectURL === "function")
        URL.revokeObjectURL(attachment.previewUrl);
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

/** Encodes the inline images of a draft, in draft order, only during submission. */
export async function rigImageInputsOf(
    attachments: readonly ComposerAttachment[],
): Promise<readonly RigImageInput[]> {
    rigComposerAttachmentsValidate(attachments);
    const inline = attachments.filter((attachment) => attachment.kind === "inlineImage");
    const images: RigImageInput[] = [];
    for (const attachment of inline)
        images.push({
            mediaType: attachment.mediaType,
            data: base64Encode(new Uint8Array(await attachment.file.arrayBuffer())),
        });
    return images;
}
